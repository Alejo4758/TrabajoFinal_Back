import prisma from "../../lib/prisma.js";
import { normalizeName, parseSuggestionName } from "../services/profileAT.service.js";
import { findSimilarOptions } from "../services/catalogMatch.service.js";

// Sugerencias de especialidades y obras sociales que hacen los A.T. cuando la suya no está en la lista.
// Las revisa un administrador: al aprobarla se agrega al catálogo (o se usa la que ya existe con ese nombre) y queda
// en el perfil de cada A.T. que la pidió. Si ya estaba con otro nombre ("FederadaSalud" -> "Federada Salud"), el
// administrador la indica y queda marcada esa. Al rechazarla, el A.T. ve el motivo en su perfil.
// Todas las rutas pasan antes por verifyToken + requireRole("ADMIN") (admin.routes.js)

const STATUSES = ["PENDING", "APPROVED", "REJECTED"];
const REVIEW_NOTE_MAX = 500;
const LIST_MAX = 200;

// Catálogo y tabla intermedia (A.T. <-> catálogo) de cada tipo de sugerencia
const CATALOGS = {
  ESPECIALITY: { catalog: (db) => db.especiality, link: (db) => db.aT_Especiality, linkField: "especialityId" },
  OBRA_SOCIAL: { catalog: (db) => db.obraSocial, link: (db) => db.aT_OSoc, linkField: "obraSocialId" },
};

// Error para cuando otra persona revisó la sugerencia mientras tanto
class AlreadyReviewedError extends Error {}

// Error para cuando la opción existente que eligió el administrador no está en la lista (la borraron o el id es de otra lista)
class MissingOptionError extends Error {}

const parseId = (value) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

// El usuario ADMIN puede no tener aún su fila en la tabla Admin (igual que en admin.controller.js)
const getAdminId = async (userId) =>
  (await prisma.admin.upsert({ where: { userId }, update: {}, create: { userId }, select: { id: true } })).id;

// Pendientes del mismo tipo y con el mismo nombre (sin importar mayúsculas ni tildes), de cualquier A.T.: se revisan juntas
const findSameNamePending = async (db, suggestion) => {
  const pending = await db.catalogSuggestion.findMany({
    where: { type: suggestion.type, status: "PENDING" },
    select: { id: true, name: true, profileATId: true },
  });
  const key = normalizeName(suggestion.name);
  return pending.filter((item) => normalizeName(item.name) === key);
};

// GET /admin/catalog-suggestions?status=PENDING (por defecto) | APPROVED | REJECTED
export const getCatalogSuggestions = async (req, res) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status.toUpperCase() : "PENDING";
    if (!STATUSES.includes(status)) {
      return res.status(400).json({ error: "El estado no es válido." });
    }

    const [suggestions, especialities, obrasSociales] = await Promise.all([
      prisma.catalogSuggestion.findMany({
        where: { status },
        // Las pendientes, de la más vieja a la más nueva (orden de llegada); las revisadas, la última primero
        orderBy: status === "PENDING" ? { createdAt: "asc" } : { reviewedAt: "desc" },
        take: LIST_MAX,
        select: {
          id: true, type: true, name: true, status: true, reviewNote: true, createdAt: true, reviewedAt: true,
          profileAT: { select: { id: true, user: { select: { name: true, lastName: true, email: true } } } },
        },
      }),
      prisma.especiality.findMany({ select: { id: true, name: true } }),
      prisma.obraSocial.findMany({ select: { id: true, name: true } }),
    ]);

    const catalogs = { ESPECIALITY: especialities, OBRA_SOCIAL: obrasSociales };
    const keyOf = (item) => `${item.type}:${normalizeName(item.name)}`;
    const requests = new Map();
    suggestions.forEach((item) => requests.set(keyOf(item), (requests.get(keyOf(item)) ?? 0) + 1));

    return res.status(200).json({
      data: suggestions.map((item) => ({
        id: item.id,
        type: item.type,
        name: item.name,
        status: item.status,
        reviewNote: item.reviewNote,
        createdAt: item.createdAt,
        reviewedAt: item.reviewedAt,
        at: { profileATId: item.profileAT.id, ...item.profileAT.user },
        // Si ya hay en el catálogo una opción con ese nombre, aprobarla la reutiliza en vez de crear otra
        existing: catalogs[item.type].find((option) => normalizeName(option.name) === normalizeName(item.name)) ?? null,
        // Opciones de la lista que se parecen ("Federada" -> "Federada Salud"): puede ser la misma con otro nombre
        similar: item.status === "PENDING" ? findSimilarOptions(item.name, catalogs[item.type]) : [],
        // Cuántas sugerencias de este estado piden lo mismo (se revisan todas juntas)
        sameNameCount: requests.get(keyOf(item)),
      })),
    });
  } catch (error) {
    console.error("Error en getCatalogSuggestions:", error.code || "", error.message);
    return res.status(500).json({ error: "Error al obtener las sugerencias." });
  }
};

// GET /admin/catalogs
// Especialidades y obras sociales registradas, con cuántos A.T. eligió cada una. Para que el administrador busque si lo
// que le piden ya está con otro nombre
export const getCatalogs = async (req, res) => {
  try {
    const select = { id: true, name: true, _count: { select: { ats: true } } };
    const [especialities, obrasSociales] = await Promise.all([
      prisma.especiality.findMany({ select, orderBy: { name: "asc" } }),
      prisma.obraSocial.findMany({ select, orderBy: { name: "asc" } }),
    ]);
    const toOption = (item) => ({ id: item.id, name: item.name, ats: item._count.ats });

    return res.status(200).json({
      data: { ESPECIALITY: especialities.map(toOption), OBRA_SOCIAL: obrasSociales.map(toOption) },
    });
  } catch (error) {
    console.error("Error en getCatalogs:", error.code || "", error.message);
    return res.status(500).json({ error: "Error al obtener las listas." });
  }
};

// PATCH /admin/catalog-suggestions/:id/review
// body: { status: "APPROVED", name? }       -> name permite corregir cómo se agrega (por ejemplo, la ortografía)
//       { status: "APPROVED", existingId }  -> ya estaba en la lista con otro nombre: se marca esa opción y no se agrega nada
//       { status: "REJECTED", note }        -> el motivo es obligatorio: el A.T. lo ve en su perfil
// Se revisan juntas todas las pendientes del mismo tipo con el mismo nombre, de cualquier A.T.
export const reviewCatalogSuggestion = async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "El id de la sugerencia no es válido." });
    }

    const status = typeof req.body?.status === "string" ? req.body.status.toUpperCase() : "";
    if (!["APPROVED", "REJECTED"].includes(status)) {
      return res.status(400).json({ error: "El estado de la revisión no es válido." });
    }

    const suggestion = await prisma.catalogSuggestion.findUnique({ where: { id }, select: { id: true, type: true, name: true, status: true } });
    if (!suggestion) {
      return res.status(404).json({ error: "No encontramos la sugerencia." });
    }
    if (suggestion.status !== "PENDING") {
      return res.status(409).json({ error: "Esta sugerencia ya fue revisada." });
    }

    let name = suggestion.name;
    let note = null;
    // Opción de la lista que eligió el administrador porque es la misma con otro nombre
    let existingId = null;
    if (status === "APPROVED" && req.body?.existingId !== undefined && req.body?.existingId !== null) {
      existingId = parseId(req.body.existingId);
      if (!existingId) return res.status(400).json({ error: "La opción elegida no es válida." });
    }
    else if (status === "APPROVED" && req.body?.name !== undefined && req.body?.name !== null && req.body?.name !== "") {
      const parsed = parseSuggestionName(req.body.name, "El nombre");
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      name = parsed.value;
    }
    if (status === "REJECTED") {
      note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
      if (!note) return res.status(400).json({ error: "Indicá el motivo del rechazo: el acompañante lo va a ver en su perfil." });
      if (note.length > REVIEW_NOTE_MAX) return res.status(400).json({ error: `El motivo no puede superar los ${REVIEW_NOTE_MAX} caracteres.` });
    }

    const adminId = await getAdminId(req.user.userId);
    const { catalog, link, linkField } = CATALOGS[suggestion.type];

    const result = await prisma.$transaction(async (tx) => {
      const same = await findSameNamePending(tx, suggestion);
      // Otro administrador la revisó entre la lectura de arriba y ahora
      if (!same.some((item) => item.id === id)) throw new AlreadyReviewedError();

      const reviewed = { reviewedAt: new Date(), reviewedById: adminId };

      if (status === "REJECTED") {
        await tx.catalogSuggestion.updateMany({
          where: { id: { in: same.map((item) => item.id) }, status: "PENDING" },
          data: { ...reviewed, status: "REJECTED", reviewNote: note },
        });
        return { resolved: same.length, option: null, created: false };
      }

      let option;
      if (existingId) {
        // La eligió el administrador: tiene que estar en la lista de este tipo
        option = await catalog(tx).findUnique({ where: { id: existingId }, select: { id: true, name: true } });
        if (!option) throw new MissingOptionError();
      }
      else {
        // Si ya existe una opción con ese nombre se usa esa: así no quedan dos "OSDE" en la lista
        const options = await catalog(tx).findMany({ select: { id: true, name: true } });
        option = options.find((item) => normalizeName(item.name) === normalizeName(name));
      }
      const created = !option;
      if (!option) option = await catalog(tx).create({ data: { name }, select: { id: true, name: true } });

      const profileATIds = [...new Set(same.map((item) => item.profileATId))];
      await link(tx).createMany({
        data: profileATIds.map((profileATId) => ({ profileATId, [linkField]: option.id })),
        skipDuplicates: true,
      });

      // El A.T. ve cómo se resolvió: con qué nombre se agregó, o con qué nombre ya estaba en la lista
      for (const item of same) {
        const reviewNote = created
          ? (item.name === option.name ? null : `Se agregó como "${option.name}"`)
          : `Ya estaba en la lista como "${option.name}"`;
        await tx.catalogSuggestion.update({ where: { id: item.id }, data: { ...reviewed, status: "APPROVED", reviewNote } });
      }

      return { resolved: same.length, option, created };
    });

    return res.status(200).json({
      message: status === "APPROVED"
        ? `${result.created ? "Se agregó" : "Ya existía"} "${result.option.name}" y quedó en el perfil de ${result.resolved === 1 ? "quien la sugirió" : `los ${result.resolved} acompañantes que la sugirieron`}.`
        : `Sugerencia rechazada${result.resolved > 1 ? ` (${result.resolved} acompañantes la habían pedido)` : ""}.`,
      data: result,
    });
  } catch (error) {
    if (error instanceof AlreadyReviewedError) {
      return res.status(409).json({ error: "Esta sugerencia ya fue revisada." });
    }
    if (error instanceof MissingOptionError) {
      return res.status(400).json({ error: "La opción elegida ya no está en la lista." });
    }
    console.error("Error en reviewCatalogSuggestion:", error.code || "", error.message);
    return res.status(500).json({ error: "Error al registrar la revisión de la sugerencia." });
  }
};

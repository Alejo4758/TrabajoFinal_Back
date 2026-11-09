import prisma from "../../lib/prisma.js";
import { GENRES, normalizeName, profileATEditSelect, toProfileATResponse, validateProfileAT } from "../services/profileAT.service.js";

// Perfil profesional del A.T. logueado: lo que el registro no pide y se completa desde "Mi perfil".
// El perfil sale siempre del token (req.user.userId): no hay un id en la URL que se pueda cambiar para editar el de otro.

const findMyProfile = (userId) => prisma.profileAT.findUnique({ where: { userId }, select: profileATEditSelect });

// GET /at/me/profile
// Devuelve el perfil y las opciones para el formulario (géneros, especialidades y obras sociales).
// Las localidades no van acá porque son miles: se eligen por provincia y departamento con GET /localities/options
export const getMyProfile = async (req, res) => {
  try {
    const [profile, especialities, obrasSociales] = await Promise.all([
      findMyProfile(req.user.userId),
      prisma.especiality.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
      prisma.obraSocial.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ]);

    if (!profile) {
      return res.status(404).json({ error: "No encontramos tu perfil profesional." });
    }

    return res.status(200).json({
      data: { ...toProfileATResponse(profile), options: { genres: GENRES, especialities, obrasSociales } },
    });
  } catch (error) {
    console.error("Error en getMyProfile:", error.code || "", error.message);
    return res.status(500).json({ error: "Error interno del servidor al obtener el perfil." });
  }
};

// PUT /at/me/profile
// Reemplaza el perfil profesional completo: género, estudios, zonas de trabajo, especialidades, obras sociales y experiencias.
// Body: { genre, studies, localityIds: number[], especialityIds: number[], obraSocialIds: number[],
//         suggestedEspecialities: string[], suggestedObrasSociales: string[],
//         availability?: [{ dayOfWeek: 0-6 (0 = domingo), startTime: "HH:MM", endTime: "HH:MM" }],
//         experiences: [{ title, startDate: "AAAA-MM", finishDate: "AAAA-MM" | null, description }] }
// suggested* son las especialidades y obras sociales que no están en la lista: la lista completa de las que siguen esperando
// revisión (las que se sacan de la lista se retiran). Las revisa un administrador en /admin/catalog-suggestions.
// Se puede guardar incompleto: el A.T. lo va completando de a partes. La respuesta dice qué falta (missingProfileFields)
export const updateMyProfile = async (req, res) => {
  try {
    const current = await prisma.profileAT.findUnique({
      where: { userId: req.user.userId },
      select: { id: true, genre: true },
    });
    if (!current) {
      return res.status(404).json({ error: "No encontramos tu perfil profesional." });
    }

    const { error: validationError, data } = validateProfileAT(req.body, current.genre);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    // Los ids tienen que existir en los catálogos: si no, la relación fallaría y no se sabría por qué
    const [localities, especialities, obrasSociales] = await Promise.all([
      prisma.locality.count({ where: { id: { in: data.localityIds } } }),
      prisma.especiality.count({ where: { id: { in: data.especialityIds } } }),
      prisma.obraSocial.count({ where: { id: { in: data.obraSocialIds } } }),
    ]);
    if (localities !== data.localityIds.length) {
      return res.status(400).json({ error: "Alguna de las zonas de trabajo no existe." });
    }
    if (especialities !== data.especialityIds.length) {
      return res.status(400).json({ error: "Alguna de las especialidades no existe." });
    }
    if (obrasSociales !== data.obraSocialIds.length) {
      return res.status(400).json({ error: "Alguna de las obras sociales no existe." });
    }

    // No se puede sugerir algo que ya está en la lista: se marca la opción en vez de sugerirla
    const [especialityCatalog, obraSocialCatalog, pendingSuggestions] = await Promise.all([
      prisma.especiality.findMany({ select: { name: true } }),
      prisma.obraSocial.findMany({ select: { name: true } }),
      prisma.catalogSuggestion.findMany({
        where: { profileATId: current.id, status: "PENDING" },
        select: { id: true, type: true, name: true },
      }),
    ]);
    // Devuelve { suggested, listed }: lo que escribió el A.T. y cómo figura en la lista ("FederadaSalud" -> "Federada Salud")
    const findListed = (names, catalog) => {
      for (const suggested of names) {
        const listed = catalog.find((item) => normalizeName(item.name) === normalizeName(suggested));
        if (listed) return { suggested, listed: listed.name };
      }
      return null;
    };
    const listedMessage = ({ suggested, listed }, catalogName) =>
      suggested === listed
        ? `"${listed}" ya está en la lista de ${catalogName}: marcala en vez de sugerirla.`
        : `"${suggested}" ya está en la lista de ${catalogName} como "${listed}": marcala en vez de sugerirla.`;
    const listedEspeciality = findListed(data.suggestedEspecialities, especialityCatalog);
    if (listedEspeciality) {
      return res.status(400).json({ error: listedMessage(listedEspeciality, "especialidades") });
    }
    const listedObraSocial = findListed(data.suggestedObrasSociales, obraSocialCatalog);
    if (listedObraSocial) {
      return res.status(400).json({ error: listedMessage(listedObraSocial, "obras sociales") });
    }

    // Las pendientes que siguen en la lista quedan como están (conservan su fecha); se crean las nuevas y se retiran las que se sacaron
    const suggestionKey = (type, name) => `${type}:${normalizeName(name)}`;
    const wanted = [
      ...data.suggestedEspecialities.map((name) => ({ type: "ESPECIALITY", name })),
      ...data.suggestedObrasSociales.map((name) => ({ type: "OBRA_SOCIAL", name })),
    ];
    const wantedKeys = new Set(wanted.map((item) => suggestionKey(item.type, item.name)));
    const pendingKeys = new Set(pendingSuggestions.map((item) => suggestionKey(item.type, item.name)));
    const suggestionsToWithdraw = pendingSuggestions.filter((item) => !wantedKeys.has(suggestionKey(item.type, item.name))).map((item) => item.id);
    const suggestionsToCreate = wanted.filter((item) => !pendingKeys.has(suggestionKey(item.type, item.name)));

    // Un solo update con escrituras anidadas: Prisma lo hace en una transacción, así que se guarda todo o nada.
    // Las listas se reemplazan enteras (borrar y volver a crear), igual que en el seed
    await prisma.profileAT.update({
      where: { id: current.id },
      data: {
        genre: data.genre,
        studies: data.studies,
        localities: { deleteMany: {}, create: data.localityIds.map((localityId) => ({ localityId })) },
        especialities: { deleteMany: {}, create: data.especialityIds.map((especialityId) => ({ especialityId })) },
        obrasSociales: { deleteMany: {}, create: data.obraSocialIds.map((obraSocialId) => ({ obraSocialId })) },
        experiences: { deleteMany: {}, create: data.experiences },
        // Si el pedido no trae la disponibilidad horaria, se deja la guardada
        ...(data.availability !== undefined && { availability: { deleteMany: {}, create: data.availability } }),
        // Solo se tocan las pendientes: las ya revisadas quedan como historial
        catalogSuggestions: {
          deleteMany: { id: { in: suggestionsToWithdraw }, status: "PENDING" },
          create: suggestionsToCreate,
        },
      },
    });

    const profile = await findMyProfile(req.user.userId);

    return res.status(200).json({ data: toProfileATResponse(profile) });
  } catch (error) {
    // Solo se loguea el código y el mensaje: nunca los datos del perfil
    console.error("Error en updateMyProfile:", error.code || "", error.message);
    return res.status(500).json({ error: "Error interno del servidor al guardar el perfil." });
  }
};

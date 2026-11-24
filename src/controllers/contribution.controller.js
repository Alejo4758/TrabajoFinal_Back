import prisma from "../../lib/prisma.js";
import { createNotification } from "../services/notification.service.js";
import { sendError, parseId, resolveNetworkViewer, roleToApi, fullName } from "../services/network.service.js";
import {
  contributionSelect,
  toContributionView,
  validateContribution,
  parseContributionText,
  resolveTarget,
  sectionOfTarget,
  targetTypesFor,
} from "../services/contribution.service.js";

// Aportes de la red de apoyo de un paciente (A.T. y SUPPORT). Las reglas están en src/services/contribution.service.js.
//
// PREVENCIÓN DE IDOR
// El acompañamiento y las secciones visibles los resuelve resolveNetworkViewer con la identidad del token. Un aporte se
// busca SIEMPRE dentro de ese acompañamiento y entre los que quien pide puede ver: el de otro paciente, el de una sección
// que no tiene habilitada o uno oculto ajeno, para quien pregunta no existe (404).

const FORBIDDEN_MESSAGE = "No tenés acceso a este acompañamiento.";
const NOT_FOUND_MESSAGE = "Ese aporte ya no existe.";

// Valida el :patientId y resuelve quién pide. Devuelve { patientId, viewer } o responde el error y devuelve null
const loadViewer = async (req, res) => {
  const patientId = parseId(req.params.patientId);
  if (!patientId) {
    sendError(res, "invalid", "El id del paciente no es válido.");
    return null;
  }

  const viewer = await resolveNetworkViewer(req.user, patientId);
  if (!viewer) {
    sendError(res, "forbidden", FORBIDDEN_MESSAGE);
    return null;
  }
  return { patientId, viewer };
};

// Filtro de los aportes que puede ver quien pide: el A.T., todos; un integrante, los de sus secciones,
// sin los ocultos de otras personas
const visibleWhere = (viewer, userId) =>
  viewer.isAT
    ? { treatmentId: viewer.treatmentId }
    : {
        treatmentId: viewer.treatmentId,
        targetType: { in: targetTypesFor(viewer.sections) },
        OR: [{ hiddenAt: null }, { authorId: userId }],
      };

// Aporte por id, solo si quien pide lo puede ver. Responde 400/404 y devuelve null si no
const findVisible = async (req, res, viewer) => {
  const id = parseId(req.params.id);
  if (!id) {
    sendError(res, "invalid", "El id del aporte no es válido.");
    return null;
  }

  const contribution = await prisma.contribution.findFirst({
    where: { id, ...visibleWhere(viewer, req.user.userId) },
    select: contributionSelect,
  });
  if (!contribution) {
    sendError(res, "not_found", NOT_FOUND_MESSAGE);
    return null;
  }
  return contribution;
};

// GET /api/patients/:patientId/contributions
// Del más antiguo al más reciente
export const listContributions = async (req, res) => {
  try {
    const loaded = await loadViewer(req, res);
    if (!loaded) return;

    const contributions = await prisma.contribution.findMany({
      where: visibleWhere(loaded.viewer, req.user.userId),
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: contributionSelect,
    });

    return res.status(200).json({ data: contributions.map((item) => toContributionView(item, loaded.patientId)) });
  } catch (error) {
    console.error("Error en listContributions:", error.code || "", error.message);
    return res.status(500).json({ error: "Error interno del servidor al obtener los aportes." });
  }
};

// POST /api/patients/:patientId/contributions
// Body: { targetType, targetId, text }. El destino tiene que existir en el acompañamiento y su etiqueta la arma el back
export const createContribution = async (req, res) => {
  try {
    const { error: validationError, data } = validateContribution(req.body);
    if (validationError) return sendError(res, "invalid", validationError);

    const loaded = await loadViewer(req, res);
    if (!loaded) return;
    const { patientId, viewer } = loaded;

    if (!viewer.isAT && !viewer.sections.includes(sectionOfTarget(data.type))) {
      return sendError(res, "forbidden", "No tenés acceso a esta sección del acompañamiento.");
    }

    const target = await resolveTarget(viewer.treatmentId, data.type, data.targetId);
    if (!target) return sendError(res, "not_found", "El registro que querés comentar ya no existe.");

    const contribution = await prisma.contribution.create({
      data: {
        treatmentId: viewer.treatmentId,
        authorId: req.user.userId,
        // Copias: el aporte se sigue leyendo igual si quitan al autor de la red
        authorRole: viewer.isAT ? "AT" : roleToApi(viewer.member.role),
        authorRelationship: viewer.isAT ? null : viewer.member.relationship,
        targetType: target.db,
        targetId: target.targetId,
        targetLabel: target.label,
        text: data.text,
      },
      select: contributionSelect,
    });

    // Aviso al A.T. cuando escribe alguien de la red. Si falla, el aporte ya está guardado
    if (!viewer.isAT) await notifyAT(req, viewer.treatmentId, patientId, contribution);

    return res.status(201).json({ data: toContributionView(contribution, patientId) });
  } catch (error) {
    // Solo el código y el mensaje: nunca el texto del aporte
    console.error("Error en createContribution:", error.code || "", error.message);
    return res.status(500).json({ error: "Error interno del servidor al guardar el aporte." });
  }
};

const notifyAT = async (req, treatmentId, patientId, contribution) => {
  try {
    const treatment = await prisma.treatment.findUnique({
      where: { id: treatmentId },
      select: { profileAT: { select: { userId: true } }, patient: { select: { name: true } } },
    });
    await createNotification(req.app.get("io"), {
      userId: treatment.profileAT.userId,
      type: "NETWORK_CONTRIBUTION",
      title: `Nuevo aporte de ${fullName(contribution.author)} en la red de apoyo`,
      content: `Comentó en "${contribution.targetLabel.slice(0, 60)}" del acompañamiento de ${treatment.patient.name}.`,
      link: `/patient/${patientId}?tab=supportNetwork`,
    });
  } catch (error) {
    console.error("Error al notificar el aporte:", error.code || "", error.message);
  }
};

// Solo el autor edita o borra: si el aporte es visible pero de otra persona, 403
const requireAuthor = (req, res, contribution, action) => {
  if (contribution.authorId === req.user.userId) return true;
  sendError(res, "forbidden", `Solo quien escribió el aporte puede ${action}.`);
  return false;
};

// PATCH /api/patients/:patientId/contributions/:id
// Body: { text }. Solo el autor
export const updateContribution = async (req, res) => {
  try {
    const text = parseContributionText(req.body?.text);
    if (text.error) return sendError(res, "invalid", text.error);

    const loaded = await loadViewer(req, res);
    if (!loaded) return;

    const existing = await findVisible(req, res, loaded.viewer);
    if (!existing || !requireAuthor(req, res, existing, "editarlo")) return;

    const contribution = await prisma.contribution.update({
      where: { id: existing.id },
      data: { text: text.value, editedAt: new Date() },
      select: contributionSelect,
    });

    return res.status(200).json({ data: toContributionView(contribution, loaded.patientId) });
  } catch (error) {
    console.error("Error en updateContribution:", error.code || "", error.message);
    return res.status(500).json({ error: "Error interno del servidor al editar el aporte." });
  }
};

// DELETE /api/patients/:patientId/contributions/:id
// Solo el autor
export const deleteContribution = async (req, res) => {
  try {
    const loaded = await loadViewer(req, res);
    if (!loaded) return;

    const existing = await findVisible(req, res, loaded.viewer);
    if (!existing || !requireAuthor(req, res, existing, "eliminarlo")) return;

    await prisma.contribution.deleteMany({ where: { id: existing.id } });
    return res.status(200).json({ data: { ok: true } });
  } catch (error) {
    console.error("Error en deleteContribution:", error.code || "", error.message);
    return res.status(500).json({ error: "Error interno del servidor al eliminar el aporte." });
  }
};

// PATCH /api/patients/:patientId/contributions/:id/visibility
// Body: { hidden: boolean }. Solo el A.T. del acompañamiento. Queda registrado quién y cuándo, para auditoría
export const setContributionVisibility = async (req, res) => {
  try {
    if (typeof req.body?.hidden !== "boolean") return sendError(res, "invalid", "Indicá si el aporte se oculta o se muestra.");

    const loaded = await loadViewer(req, res);
    if (!loaded) return;
    if (!loaded.viewer.isAT) return sendError(res, "forbidden", "Solo el acompañante puede ocultar aportes.");

    const existing = await findVisible(req, res, loaded.viewer);
    if (!existing) return;

    const { hidden } = req.body;
    const contribution = await prisma.contribution.update({
      where: { id: existing.id },
      data: hidden ? { hiddenAt: new Date(), hiddenById: req.user.userId } : { hiddenAt: null, hiddenById: null },
      select: contributionSelect,
    });

    return res.status(200).json({ data: toContributionView(contribution, loaded.patientId) });
  } catch (error) {
    console.error("Error en setContributionVisibility:", error.code || "", error.message);
    return res.status(500).json({ error: "Error interno del servidor al cambiar la visibilidad del aporte." });
  }
};

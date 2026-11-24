import prisma from "../../lib/prisma.js";
import {
  validateDraftRequest,
  validateRefineRequest,
  validateReport,
  toReportInput,
  reportSelect,
  toReportResponse,
  periodBounds,
} from "../services/report.service.js";
import { generateReportDraft, refineReportDraft, ENCOUNTERS_MAX } from "../services/reportDraft.service.js";
import { AiNotConfiguredError, AiGenerationError } from "../services/gemini.service.js";
import { encounterSelect } from "../services/encounter.service.js";
import { notifyReportShared } from "../services/network.service.js";

// Informes periódicos de un paciente (Feature 15): borrador con IA según destinatario y los informes guardados.
//
// PREVENCIÓN DE IDOR
// El :patientId y el :reportId llegan por la URL: los elige quien hace el pedido, así que no prueban nada.
// La identidad sale SIEMPRE del JWT (req.user) y cada consulta se arma a partir de ella:
//   - A.T.: solo accede si tiene un acompañamiento (Treatment) con ese paciente. Ve y edita únicamente los informes
//     de SU acompañamiento, no los de otros A.T. del mismo paciente.
//   - ADMIN: puede consultar y editar los informes de cualquier paciente (no generar ni crear: no es el autor).
// Si el A.T. no tiene acompañamiento con el paciente se responde 403, sin distinguir si el paciente existe
// (así no se pueden descubrir ids de pacientes probando). Un informe se busca SIEMPRE filtrando por los acompañamientos
// autorizados: si es de otro paciente o de otro profesional, para quien pregunta no existe (404).

const READONLY_STATUS = "FINAL";
const REPORT_FIELDS = ["title", "content", "audience", "periodFrom", "periodTo", "status"];

// Límite de pedidos a la IA por usuario (borradores y mensajes del chat juntos), para cuidar la cuota de Gemini.
// En memoria: se reinicia con el servidor y es por proceso (alcanza para una sola instancia; con varias habría que
// llevarlo a Redis o a la base)
const DRAFT_LIMIT = 30;
const DRAFT_WINDOW_MS = 15 * 60 * 1000;
const draftRequests = new Map();

const consumeDraftQuota = (userId) => {
  const now = Date.now();
  const recent = (draftRequests.get(userId) ?? []).filter((time) => now - time < DRAFT_WINDOW_MS);
  if (recent.length >= DRAFT_LIMIT) {
    draftRequests.set(userId, recent);
    return false;
  }
  recent.push(now);
  draftRequests.set(userId, recent);
  return true;
};

const parseId = (value) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const forbidden = { status: 403, message: "No tenés acceso a los informes de este paciente." };

// Acompañamiento del A.T. autenticado con el paciente, o null. El A.T. sale del token, nunca del pedido
const findOwnTreatment = async (atUserId, patientId, select = { id: true }) => {
  const profileAT = await prisma.profileAT.findUnique({ where: { userId: atUserId }, select: { id: true } });
  if (!profileAT) return null;

  return prisma.treatment.findUnique({
    where: { patientId_profileATId: { patientId, profileATId: profileAT.id } },
    select,
  });
};

// Acompañamientos sobre los que el usuario autenticado puede operar para ese paciente.
// Devuelve { treatmentIds, ownTreatmentId } o { error: { status, message } }
const resolvePatientAccess = async (user, patientId) => {
  if (user?.role === "AT") {
    const treatment = await findOwnTreatment(user.userId, patientId);
    if (!treatment) return { error: forbidden };
    return { treatmentIds: [treatment.id], ownTreatmentId: treatment.id };
  }

  if (user?.role === "ADMIN") {
    const patient = await prisma.patient.findUnique({
      where: { id: patientId },
      select: { treatments: { select: { id: true } } },
    });
    if (!patient) return { error: { status: 404, message: "No encontramos al paciente." } };
    return { treatmentIds: patient.treatments.map((treatment) => treatment.id), ownTreatmentId: null };
  }

  return { error: forbidden };
};

// Informe por id, solo si pertenece a uno de los acompañamientos autorizados
const findAuthorizedReport = (reportId, treatmentIds, select = reportSelect) =>
  prisma.report.findFirst({ where: { id: reportId, treatmentId: { in: treatmentIds } }, select });

// Valida los ids de la URL. Devuelve { patientId, reportId } o responde 400 y devuelve null
const readIds = (req, res, { withReport = false } = {}) => {
  const patientId = parseId(req.params.patientId);
  if (!patientId) {
    res.status(400).json({ error: "El id del paciente no es válido." });
    return null;
  }
  if (!withReport) return { patientId };

  const reportId = parseId(req.params.reportId);
  if (!reportId) {
    res.status(400).json({ error: "El id del informe no es válido." });
    return null;
  }
  return { patientId, reportId };
};

// POST /api/patients/:patientId/reports/generate-draft
// Body: { from, to, audience, extraNotes }. Junta el plan de trabajo y los encuentros del período, los anonimiza,
// le pide el borrador a Gemini y devuelve el HTML rehidratado. El borrador NO se guarda
export const generateDraft = (req, res) =>
  handleAiRequest(req, res, {
    label: "generateDraft",
    validate: validateDraftRequest,
    run: generateReportDraft,
  });

// POST /api/patients/:patientId/reports/refine-draft
// Chat con la IA sobre el borrador. Body: { from, to, audience, extraNotes, currentHtml, instruction, messages }.
// Devuelve { reply, draftHtml, changed, metadata }: draftHtml es null cuando el pedido fue solo una consulta.
// La IA recibe otra vez los datos del período (anonimizados), así puede sumar información que no estaba en el borrador
export const refineDraft = (req, res) =>
  handleAiRequest(req, res, {
    label: "refineDraft",
    validate: validateRefineRequest,
    run: refineReportDraft,
  });

// Junta lo que la IA necesita para trabajar sobre un informe: el acompañamiento del A.T. autenticado con el paciente
// (anti-IDOR: si no existe, 403), el plan, los encuentros del período y la solicitud de origen.
// Devuelve { sources } o { error: { status, message } }
const loadDraftSources = async (atUserId, patientId, request) => {
  const treatment = await findOwnTreatment(atUserId, patientId, {
    id: true,
    status: true,
    startDate: true,
    profileATId: true,
    workPlan: { select: { content: true } },
    patient: {
      select: {
        name: true,
        lastName: true,
        dateOfBirth: true,
        relationship: true,
        diagnosis: true,
        notes: true,
        tutor: { select: { name: true, lastName: true, email: true, documentNumber: true } },
      },
    },
    profileAT: { select: { user: { select: { name: true, lastName: true, email: true, documentNumber: true } } } },
  });
  if (!treatment) return { error: forbidden };

  const encounterWhere = { treatmentId: treatment.id, startDate: periodBounds(request.from, request.to) };

  const [linkRequest, recentEncounters, totals] = await Promise.all([
    // Localidad y obras sociales que indicó la familia en la solicitud que dio origen al acompañamiento
    prisma.linkRequest.findFirst({
      where: { patientId, profileATId: treatment.profileATId, status: "ACCEPTED" },
      orderBy: { updatedAt: "desc" },
      select: { locality: true, socialPrograms: true },
    }),
    prisma.encounter.findMany({
      where: encounterWhere,
      orderBy: [{ startDate: "desc" }, { id: "desc" }],
      take: ENCOUNTERS_MAX,
      select: encounterSelect,
    }),
    prisma.encounter.aggregate({
      where: encounterWhere,
      _count: { _all: true },
      _sum: { durationMinutes: true },
    }),
  ]);

  const planContent = treatment.workPlan?.content ?? null;
  if (!planContent && totals._count._all === 0) {
    return {
      error: {
        status: 409,
        message: "No hay plan de trabajo ni encuentros registrados en el período: no hay información para armar el informe.",
      },
    };
  }

  const { patient, profileAT } = treatment;
  return {
    sources: {
      ...request,
      request,
      patient,
      tutor: patient.tutor,
      atUser: profileAT.user,
      linkRequest,
      treatment,
      planContent,
      // Del más antiguo al más reciente, para que la IA lea la evolución en orden
      encounters: recentEncounters.reverse(),
      totals: { count: totals._count._all, minutes: totals._sum.durationMinutes ?? 0 },
    },
  };
};

// Flujo común de los pedidos a la IA: valida el body, verifica el acceso y carga los datos, consume el cupo y
// traduce los errores de la IA a respuestas HTTP
const handleAiRequest = async (req, res, { label, validate, run }) => {
  try {
    const ids = readIds(req, res);
    if (!ids) return;

    const { error: validationError, data: request } = validate(req.body);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    // Solo A.T. (lo garantiza la ruta). Se trae todo junto con la verificación de acceso
    const { error, sources } = await loadDraftSources(req.user.userId, ids.patientId, request);
    if (error) {
      return res.status(error.status).json({ error: error.message });
    }

    // Recién acá se consume el cupo: un pedido inválido no le cuenta al A.T.
    if (!consumeDraftQuota(req.user.userId)) {
      return res.status(429).json({ error: "Hiciste muchos pedidos a la IA seguidos. Esperá unos minutos e intentá nuevamente." });
    }

    return res.status(200).json({ data: await run(sources) });
  } catch (error) {
    if (error instanceof AiNotConfiguredError) {
      console.error(`Error en ${label}: GEMINI_API_KEY no está configurada`);
      return res.status(503).json({ error: "La generación de informes con IA no está disponible en este momento." });
    }
    if (error instanceof AiGenerationError) {
      // Solo el estado y el motivo: nunca el prompt ni la respuesta (son datos clínicos, aunque anonimizados)
      console.error(`Error en ${label} (Gemini):`, error.status ?? "", error.reason ?? "", error.message);
      if (error.status === 429 || error.status === 503) {
        return res.status(503).json({ error: "El servicio de IA está saturado. Intentá nuevamente en unos minutos." });
      }
      return res.status(502).json({ error: "La IA no pudo responder. Intentá nuevamente en unos minutos." });
    }
    console.error(`Error en ${label}:`, error.code || "", error.message);
    return res.status(500).json({ error: "Error interno del servidor al trabajar con el borrador del informe." });
  }
};

// GET /api/patients/:patientId/reports
// Informes guardados del paciente, del más reciente al más antiguo. El A.T. ve los suyos; el ADMIN, los de todos
export const listReports = async (req, res) => {
  try {
    const ids = readIds(req, res);
    if (!ids) return;

    const access = await resolvePatientAccess(req.user, ids.patientId);
    if (access.error) {
      return res.status(access.error.status).json({ error: access.error.message });
    }

    const reports = await prisma.report.findMany({
      where: { treatmentId: { in: access.treatmentIds } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: reportSelect,
    });

    return res.status(200).json({ data: reports.map(toReportResponse) });
  } catch (error) {
    console.error("Error en listReports:", error.code || "", error.message);
    return res.status(500).json({ error: "Error interno del servidor al obtener los informes." });
  }
};

// GET /api/patients/:patientId/reports/:reportId
export const getReport = async (req, res) => {
  try {
    const ids = readIds(req, res, { withReport: true });
    if (!ids) return;

    const access = await resolvePatientAccess(req.user, ids.patientId);
    if (access.error) {
      return res.status(access.error.status).json({ error: access.error.message });
    }

    const report = await findAuthorizedReport(ids.reportId, access.treatmentIds);
    if (!report) {
      return res.status(404).json({ error: "No encontramos el informe." });
    }

    return res.status(200).json({ data: toReportResponse(report) });
  } catch (error) {
    console.error("Error en getReport:", error.code || "", error.message);
    return res.status(500).json({ error: "Error interno del servidor al obtener el informe." });
  }
};

// POST /api/patients/:patientId/reports
// Guarda el informe que el A.T. revisó: { title, content, audience, periodFrom, periodTo, status }
export const createReport = async (req, res) => {
  try {
    const ids = readIds(req, res);
    if (!ids) return;

    const { error: validationError, data } = validateReport(req.body);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    // Solo A.T. (lo garantiza la ruta): el informe queda en SU acompañamiento con el paciente
    const access = await resolvePatientAccess(req.user, ids.patientId);
    if (access.error) {
      return res.status(access.error.status).json({ error: access.error.message });
    }

    const report = await prisma.report.create({
      data: { ...data, treatmentId: access.ownTreatmentId },
      select: reportSelect,
    });

    // Un informe finalizado se comparte con la red de apoyo (integrantes con acceso a Informes): se les avisa
    if (report.status === READONLY_STATUS) {
      await notifyReportShared(req.app.get("io"), { treatmentId: report.treatmentId, report });
    }

    return res.status(201).json({ data: toReportResponse(report) });
  } catch (error) {
    // Solo se loguea el código y el mensaje: nunca el contenido del informe
    console.error("Error en createReport:", error.code || "", error.message);
    return res.status(500).json({ error: "Error interno del servidor al guardar el informe." });
  }
};

// PUT /api/patients/:patientId/reports/:reportId
// Actualiza un informe. Se pueden mandar solo los campos que cambian: se combinan con los guardados y se valida todo junto.
// Un informe finalizado (FINAL) ya no se modifica: es el que se entregó
export const updateReport = async (req, res) => {
  try {
    const ids = readIds(req, res, { withReport: true });
    if (!ids) return;

    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
      return res.status(400).json({ error: "El informe enviado no es válido." });
    }

    const access = await resolvePatientAccess(req.user, ids.patientId);
    if (access.error) {
      return res.status(access.error.status).json({ error: access.error.message });
    }

    const existing = await findAuthorizedReport(ids.reportId, access.treatmentIds);
    if (!existing) {
      return res.status(404).json({ error: "No encontramos el informe." });
    }
    if (existing.status === READONLY_STATUS) {
      return res.status(409).json({ error: "El informe ya está finalizado y no se puede modificar." });
    }

    const changes = Object.fromEntries(REPORT_FIELDS.filter((field) => field in req.body).map((field) => [field, req.body[field]]));
    const { error: validationError, data } = validateReport({ ...toReportInput(existing), ...changes });
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    // updateMany con el estado en el filtro: si otro pedido lo finalizó entre la lectura y acá, no se pisa
    const { count } = await prisma.report.updateMany({
      where: { id: existing.id, status: { not: READONLY_STATUS } },
      data,
    });
    if (count === 0) {
      return res.status(409).json({ error: "El informe ya está finalizado y no se puede modificar." });
    }

    const report = await prisma.report.findUnique({ where: { id: existing.id }, select: reportSelect });

    // Pasó de borrador a finalizado (uno ya finalizado no llega hasta acá): se comparte con la red y se le avisa
    if (report.status === READONLY_STATUS) {
      await notifyReportShared(req.app.get("io"), { treatmentId: report.treatmentId, report });
    }

    return res.status(200).json({ data: toReportResponse(report) });
  } catch (error) {
    console.error("Error en updateReport:", error.code || "", error.message);
    return res.status(500).json({ error: "Error interno del servidor al actualizar el informe." });
  }
};

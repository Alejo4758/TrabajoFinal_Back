import prisma from "../../lib/prisma.js";
import { toDateOnly } from "../services/patient.service.js";
import { validatePlan, toPlanResponse } from "../services/plan.service.js";

// Pacientes vistos por el A.T.: el detalle de cada uno y su plan de trabajo.
// Un A.T. solo accede a un paciente si tiene un acompañamiento (Treatment) con él.

const ACTIVE_APPOINTMENT_STATES = ["PENDING", "CONFIRMED"];

const parseId = (value) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

// Acompañamiento del A.T. autenticado con ese paciente.
// Prevención de IDOR: el patientId llega por la URL, así que se busca SIEMPRE junto con el A.T. que sale del token.
// Si no hay acompañamiento devuelve null: para este A.T. ese paciente "no existe", sea de otro profesional o no esté cargado
const findTreatment = async (atUserId, patientId, select) => {
  const profileAT = await prisma.profileAT.findUnique({
    where: { userId: atUserId },
    select: { id: true },
  });
  if (!profileAT) return null;

  return prisma.treatment.findUnique({
    where: { patientId_profileATId: { patientId, profileATId: profileAT.id } },
    select,
  });
};

// GET /api/at/patients/:patientId
export const getPatientDetail = async (req, res) => {
  try {
    const patientId = parseId(req.params.patientId);
    if (!patientId) {
      return res.status(400).json({ error: "El id del paciente no es válido." });
    }

    const treatment = await findTreatment(req.user.userId, patientId, {
      id: true,
      status: true,
      startDate: true,
      profileATId: true,
      workPlan: { select: { id: true, content: true, updatedAt: true } },
      patient: {
        select: {
          id: true,
          name: true,
          lastName: true,
          dateOfBirth: true,
          relationship: true,
          diagnosis: true,
          notes: true,
          tutor: { select: { id: true, name: true, lastName: true, email: true } },
        },
      },
    });

    if (!treatment) {
      return res.status(404).json({ error: "No encontramos al paciente." });
    }

    const now = new Date();

    const [linkRequest, lastActivity, nextMeeting] = await Promise.all([
      // El "caso" es lo que la familia contó en la solicitud que dio origen al acompañamiento
      prisma.linkRequest.findFirst({
        where: { patientId, profileATId: treatment.profileATId, status: "ACCEPTED" },
        orderBy: { updatedAt: "desc" },
        select: { description: true, locality: true, socialPrograms: true, otherCoverage: true, createdAt: true },
      }),
      prisma.calendarActivity.findFirst({
        where: {
          patientId,
          profileATId: treatment.profileATId,
          startDate: { lt: now },
          state: { not: "CANCELLED" },
        },
        orderBy: { startDate: "desc" },
        select: { startDate: true },
      }),
      prisma.calendarActivity.findFirst({
        where: {
          patientId,
          profileATId: treatment.profileATId,
          startDate: { gte: now },
          state: { in: ACTIVE_APPOINTMENT_STATES },
        },
        orderBy: { startDate: "asc" },
        select: { id: true, startDate: true, finishDate: true, type: true, title: true },
      }),
    ]);

    const { patient } = treatment;

    return res.status(200).json({
      data: {
        id: patient.id,
        name: patient.name,
        lastName: patient.lastName,
        dateOfBirth: toDateOnly(patient.dateOfBirth),
        relationship: patient.relationship,
        diagnosis: patient.diagnosis,
        notes: patient.notes,
        tutor: patient.tutor,
        treatment: {
          id: treatment.id,
          status: treatment.status,
          startDate: treatment.startDate.toISOString(),
        },
        case: linkRequest,
        // Sin actividades previas, la última actividad es el inicio del acompañamiento
        lastActivity: (lastActivity?.startDate ?? treatment.startDate).toISOString(),
        nextMeeting,
        plan: toPlanResponse(treatment.workPlan),
      },
    });
  } catch (error) {
    console.error("Error en getPatientDetail:", error.code || "", error.message);
    return res.status(500).json({ error: "Error interno del servidor al obtener el paciente." });
  }
};

// PUT /api/at/patients/:patientId/plan
// Crea o reemplaza el plan de trabajo del acompañamiento (como borrador o vigente)
export const savePatientPlan = async (req, res) => {
  try {
    const patientId = parseId(req.params.patientId);
    if (!patientId) {
      return res.status(400).json({ error: "El id del paciente no es válido." });
    }

    const { error: validationError, data: content } = validatePlan(req.body);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const treatment = await findTreatment(req.user.userId, patientId, { id: true, status: true });
    if (!treatment) {
      return res.status(404).json({ error: "No encontramos al paciente." });
    }
    if (treatment.status === "FINISHED") {
      return res.status(409).json({ error: "El acompañamiento ya finalizó: el plan no se puede modificar." });
    }

    const workPlan = await prisma.workPlan.upsert({
      where: { treatmentId: treatment.id },
      create: { treatmentId: treatment.id, content },
      update: { content },
      select: { id: true, content: true, updatedAt: true },
    });

    return res.status(200).json({ data: toPlanResponse(workPlan) });
  } catch (error) {
    // Solo se loguea el código y el mensaje: nunca el contenido del plan
    console.error("Error en savePatientPlan:", error.code || "", error.message);
    return res.status(500).json({ error: "Error interno del servidor al guardar el plan." });
  }
};

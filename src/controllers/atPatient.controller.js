import prisma from "../../lib/prisma.js";
import { toDateOnly, fullName } from "../services/patient.service.js";
import { validatePlan, toPlanResponse } from "../services/plan.service.js";
import {
  encounterSelect,
  encounterEndDate,
  formatLocalDateTime,
  planHasGoals,
  validateEncounter,
  toEncounterResponse,
} from "../services/encounter.service.js";

// Pacientes vistos por el A.T.: el detalle de cada uno, su plan de trabajo y los encuentros registrados.
// Un A.T. solo accede a un paciente si tiene un acompañamiento (Treatment) con él.

const ACTIVE_APPOINTMENT_STATES = ["PENDING", "CONFIRMED"];

// Señal interna para abortar la transacción del alta de un encuentro sin confundirla con un error real
class DuplicateEncounterError extends Error {}

const duplicateEncounterMessage = (startDate) =>
  `Ya registraste un encuentro con este paciente el ${formatLocalDateTime(startDate)}.`;

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

// GET /api/at/patients/:patientId/encounters
// Historial de encuentros del acompañamiento, del más reciente al más antiguo
export const getPatientEncounters = async (req, res) => {
  try {
    const patientId = parseId(req.params.patientId);
    if (!patientId) {
      return res.status(400).json({ error: "El id del paciente no es válido." });
    }

    const treatment = await findTreatment(req.user.userId, patientId, { id: true });
    if (!treatment) {
      return res.status(404).json({ error: "No encontramos al paciente." });
    }

    const encounters = await prisma.encounter.findMany({
      where: { treatmentId: treatment.id },
      orderBy: [{ startDate: "desc" }, { id: "desc" }],
      select: encounterSelect,
    });

    return res.status(200).json({ data: encounters.map(toEncounterResponse) });
  } catch (error) {
    console.error("Error en getPatientEncounters:", error.code || "", error.message);
    return res.status(500).json({ error: "Error interno del servidor al obtener los encuentros." });
  }
};

// Sesión que el A.T. ya tenía agendada con el paciente y que se superpone con el encuentro, sin otro encuentro asociado.
// Si hay varias, la que empieza más cerca de la hora del encuentro. Devuelve null si no hay ninguna
const findScheduledSession = async (tx, { profileATId, patientId, startDate, finishDate }) => {
  const candidates = await tx.calendarActivity.findMany({
    where: {
      profileATId,
      patientId,
      type: "SESSION",
      state: { not: "CANCELLED" },
      encounter: { is: null },
      startDate: { lt: finishDate },
      finishDate: { gt: startDate },
    },
    take: 10,
    select: { id: true, startDate: true },
  });

  const distance = (activity) => Math.abs(activity.startDate.getTime() - startDate.getTime());
  return candidates.sort((a, b) => distance(a) - distance(b))[0] ?? null;
};

// POST /api/at/patients/:patientId/encounters
// Registra un encuentro. Los objetivos y el ámbito tienen que ser del plan de trabajo vigente del acompañamiento.
// El encuentro queda también en el calendario como sesión completada: si ya había una sesión agendada con el paciente
// en ese horario se usa esa (se marca como completada y toma la hora real), y si no se crea una nueva
export const createPatientEncounter = async (req, res) => {
  try {
    const patientId = parseId(req.params.patientId);
    if (!patientId) {
      return res.status(400).json({ error: "El id del paciente no es válido." });
    }

    const treatment = await findTreatment(req.user.userId, patientId, {
      id: true,
      status: true,
      profileATId: true,
      workPlan: { select: { content: true } },
      patient: { select: { id: true, name: true, lastName: true, tutorId: true } },
    });
    if (!treatment) {
      return res.status(404).json({ error: "No encontramos al paciente." });
    }
    if (treatment.status === "FINISHED") {
      return res.status(409).json({ error: "El acompañamiento ya finalizó: no se pueden registrar encuentros." });
    }
    if (!treatment.workPlan || !planHasGoals(treatment.workPlan.content)) {
      return res.status(409).json({
        error: "Para registrar encuentros, primero armá el plan de trabajo con al menos un objetivo específico.",
      });
    }

    const { error: validationError, data } = validateEncounter(req.body, treatment.workPlan.content);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const { goals, ...encounterData } = data;
    const { startDate } = encounterData;
    const finishDate = encounterEndDate(encounterData);

    let encounter;
    try {
      encounter = await prisma.$transaction(async (tx) => {
        // El índice único (acompañamiento, fecha y hora) es la garantía; esto da el error claro sin dejar
        // creada ni modificada la sesión del calendario
        const duplicate = await tx.encounter.findUnique({
          where: { treatmentId_startDate: { treatmentId: treatment.id, startDate } },
          select: { id: true },
        });
        if (duplicate) throw new DuplicateEncounterError();

        const scheduled = await findScheduledSession(tx, {
          profileATId: treatment.profileATId,
          patientId,
          startDate,
          finishDate,
        });

        // Sin descripción: el tutor ve la actividad en su agenda y las observaciones son solo para el A.T.
        const activity = scheduled
          ? await tx.calendarActivity.update({
              where: { id: scheduled.id },
              data: { state: "COMPLETED", startDate, finishDate },
              select: { id: true },
            })
          : await tx.calendarActivity.create({
              data: {
                profileATId: treatment.profileATId,
                userId: treatment.patient.tutorId,
                patientId,
                title: `Encuentro con ${fullName(treatment.patient)}`,
                type: "SESSION",
                state: "COMPLETED",
                startDate,
                finishDate,
              },
              select: { id: true },
            });

        return tx.encounter.create({
          data: { ...encounterData, treatmentId: treatment.id, calendarActivityId: activity.id, goals: { create: goals } },
          select: encounterSelect,
        });
      });
    } catch (error) {
      // P2002: otro pedido registró el mismo encuentro entre el chequeo y el alta
      if (error instanceof DuplicateEncounterError || error.code === "P2002") {
        return res.status(409).json({ error: duplicateEncounterMessage(startDate) });
      }
      throw error;
    }

    return res.status(201).json({ data: toEncounterResponse(encounter) });
  } catch (error) {
    // Solo se loguea el código y el mensaje: nunca las observaciones del encuentro
    console.error("Error en createPatientEncounter:", error.code || "", error.message);
    return res.status(500).json({ error: "Error interno del servidor al registrar el encuentro." });
  }
};

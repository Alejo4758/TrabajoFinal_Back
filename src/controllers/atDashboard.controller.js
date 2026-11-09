import prisma from "../../lib/prisma.js";
import { patientNameSelect } from "../services/patient.service.js";

const ACTIVE_APPOINTMENT_STATES = ["PENDING", "CONFIRMED"];
const UPCOMING_APPOINTMENTS_LIMIT = 5;
const RECENT_NOTIFICATIONS_LIMIT = 5;

// Cuenta mensajes sin leer del AT sin hacer una query por conversación:
// trae el lastReadAt de cada conversación activa y los combina en un único count con OR.
const countUnreadMessages = async (atUserId) => {
  const activeConversations = await prisma.conversationUser.findMany({
    where: { userId: atUserId, leftAt: null },
    select: { conversationId: true, lastReadAt: true },
  });

  if (activeConversations.length === 0) {
    return 0;
  }

  return prisma.message.count({
    where: {
      deletedAt: null,
      senderId: { not: atUserId },
      OR: activeConversations.map(({ conversationId, lastReadAt }) => ({
        conversationId,
        createdAt: { gt: lastReadAt },
      })),
    },
  });
};

// Pacientes con un acompañamiento con este AT (los finalizados no se listan), con su última actividad pasada
// y próxima reunión calculadas en memoria a partir de un único findMany.
// El id que se devuelve es el del paciente, no el del usuario titular de la cuenta.
const getPatients = async (profileATId) => {
  const treatments = await prisma.treatment.findMany({
    where: { profileATId, status: { not: "FINISHED" } },
    orderBy: { startDate: "desc" },
    select: {
      status: true,
      startDate: true,
      patient: { select: patientNameSelect },
    },
  });

  if (treatments.length === 0) {
    return [];
  }

  const activities = await prisma.calendarActivity.findMany({
    where: { profileATId, patientId: { in: treatments.map((treatment) => treatment.patient.id) } },
    select: { patientId: true, startDate: true, state: true },
  });

  const now = new Date();
  const lastActivityByPatient = new Map();
  const nextMeetingByPatient = new Map();

  for (const activity of activities) {
    const isPast = activity.startDate < now;
    const isFuture = activity.startDate >= now;

    if (isPast && activity.state !== "CANCELLED") {
      const current = lastActivityByPatient.get(activity.patientId);
      if (!current || activity.startDate > current) {
        lastActivityByPatient.set(activity.patientId, activity.startDate);
      }
    }

    if (isFuture && ACTIVE_APPOINTMENT_STATES.includes(activity.state)) {
      const current = nextMeetingByPatient.get(activity.patientId);
      if (!current || activity.startDate < current) {
        nextMeetingByPatient.set(activity.patientId, activity.startDate);
      }
    }
  }

  return treatments.map(({ status, startDate, patient }) => ({
    id: patient.id,
    name: patient.name,
    lastName: patient.lastName,
    status,
    // Sin actividades previas, la última actividad es el inicio del acompañamiento
    lastActivity: (lastActivityByPatient.get(patient.id) ?? startDate).toISOString(),
    nextMeeting: nextMeetingByPatient.get(patient.id)?.toISOString() ?? null,
  }));
};

// GET /at/me/dashboard
export const getMyDashboard = async (req, res) => {
  try {
    // El AT sale SIEMPRE del token, nunca de query/params/body
    const atUserId = req.user.userId;

    const profileAT = await prisma.profileAT.findUnique({
      where: { userId: atUserId },
      select: { id: true },
    });

    if (!profileAT) {
      return res.status(404).json({ error: "No se encontró un perfil de acompañante terapéutico para este usuario." });
    }

    const now = new Date();

    const [pendingRequests, patients, appointments, notifications, unreadMessages] = await Promise.all([
      prisma.linkRequest.count({
        where: { profileATId: profileAT.id, status: "PENDING" },
      }),
      getPatients(profileAT.id),
      prisma.calendarActivity.findMany({
        where: {
          profileATId: profileAT.id,
          startDate: { gte: now },
          state: { in: ACTIVE_APPOINTMENT_STATES },
        },
        orderBy: { startDate: "asc" },
        take: UPCOMING_APPOINTMENTS_LIMIT,
        select: {
          id: true,
          startDate: true,
          type: true,
          title: true,
          patient: { select: { name: true, lastName: true } },
        },
      }),
      prisma.notification.findMany({
        where: { userId: atUserId },
        orderBy: { createdAt: "desc" },
        take: RECENT_NOTIFICATIONS_LIMIT,
        select: { id: true, title: true, isRead: true, createdAt: true },
      }),
      countUnreadMessages(atUserId),
    ]);

    return res.status(200).json({
      data: {
        pendingRequests,
        unreadMessages,
        patients,
        appointments: appointments.map((appointment) => ({
          id: appointment.id,
          startDate: appointment.startDate.toISOString(),
          type: appointment.type,
          title: appointment.title,
          // Recordatorios o supervisiones pueden no tener paciente vinculado
          patient: appointment.patient
            ? { name: appointment.patient.name, lastName: appointment.patient.lastName }
            : null,
        })),
        notifications: notifications.map((notification) => ({
          id: notification.id,
          title: notification.title,
          isRead: notification.isRead,
          createdAt: notification.createdAt.toISOString(),
        })),
      },
    });
  } catch (error) {
    console.error("Error en getMyDashboard:", error.code || "", error.message);
    return res.status(500).json({ error: "Error interno del servidor al obtener el dashboard." });
  }
};

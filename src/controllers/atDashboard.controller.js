import prisma from "../../lib/prisma.js";

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

// Clientes con una solicitud ACCEPTED a este AT, sin repetir (se queda con la solicitud más reciente por cliente),
// con su última actividad pasada y próxima reunión calculadas en memoria a partir de un único findMany.
const getPatients = async (profileATId) => {
  const acceptedRequests = await prisma.linkRequest.findMany({
    where: { profileATId, status: "ACCEPTED" },
    orderBy: { updatedAt: "desc" },
    select: {
      updatedAt: true,
      client: { select: { id: true, name: true, lastName: true } },
    },
  });

  const byClientId = new Map();
  for (const request of acceptedRequests) {
    if (!request.client || byClientId.has(request.client.id)) continue;
    byClientId.set(request.client.id, {
      id: request.client.id,
      name: request.client.name,
      lastName: request.client.lastName,
      acceptedUpdatedAt: request.updatedAt,
    });
  }

  const clientIds = [...byClientId.keys()];
  if (clientIds.length === 0) {
    return [];
  }

  const activities = await prisma.calendarActivity.findMany({
    where: { profileATId, userId: { in: clientIds } },
    select: { userId: true, startDate: true, state: true },
  });

  const now = new Date();
  const lastActivityByClient = new Map();
  const nextMeetingByClient = new Map();

  for (const activity of activities) {
    const isPast = activity.startDate < now;
    const isFuture = activity.startDate >= now;

    if (isPast && activity.state !== "CANCELLED") {
      const current = lastActivityByClient.get(activity.userId);
      if (!current || activity.startDate > current) {
        lastActivityByClient.set(activity.userId, activity.startDate);
      }
    }

    if (isFuture && ACTIVE_APPOINTMENT_STATES.includes(activity.state)) {
      const current = nextMeetingByClient.get(activity.userId);
      if (!current || activity.startDate < current) {
        nextMeetingByClient.set(activity.userId, activity.startDate);
      }
    }
  }

  return clientIds.map((clientId) => {
    const patient = byClientId.get(clientId);
    return {
      id: patient.id,
      name: patient.name,
      lastName: patient.lastName,
      lastActivity: (lastActivityByClient.get(clientId) ?? patient.acceptedUpdatedAt).toISOString(),
      nextMeeting: nextMeetingByClient.get(clientId)?.toISOString() ?? null,
    };
  });
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
          user: { select: { name: true, lastName: true } },
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
          client: {
            name: appointment.user.name,
            lastName: appointment.user.lastName,
          },
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

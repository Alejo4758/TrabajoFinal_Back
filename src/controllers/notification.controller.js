import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// 1. Obtener las últimas 20 notificaciones de un usuario y el contador de no leídas
// GET /api/notifications/user/:userId
export const getUserNotifications = async (req, res) => {
  const userId = Number(req.params.userId);

  try {
    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      prisma.notification.count({
        where: { userId, isRead: false },
      }),
    ]);

    res.json({ notifications, unreadCount });
  } catch (error) {
    console.error("Error en getUserNotifications:", error);
    res.status(500).json({ error: "Error al obtener notificaciones" });
  }
};

// 2. Marcar una notificación específica como leída
// PATCH /api/notifications/:id/read
export const markAsRead = async (req, res) => {
  const id = Number(req.params.id);

  try {
    const updated = await prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });
    res.json(updated);
  } catch (error) {
    console.error("Error en markAsRead:", error);
    res.status(500).json({ error: "Error al marcar como leída" });
  }
};

// 3. Marcar todas las notificaciones de un usuario como leídas
// PATCH /api/notifications/user/:userId/read-all
export const markAllAsRead = async (req, res) => {
  const userId = Number(req.params.userId);

  try {
    await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });
    res.json({ message: "Todas las notificaciones marcadas como leídas" });
  } catch (error) {
    console.error("Error en markAllAsRead:", error);
    res.status(500).json({ error: "Error al actualizar notificaciones" });
  }
};
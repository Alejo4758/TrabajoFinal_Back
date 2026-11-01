import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

export const createNotification = async (io, { userId, type, title, content, link = null }) => {
  try {
    // 1. Guardar en PostgreSQL
    const notification = await prisma.notification.create({
      data: {
        userId: Number(userId),
        type,
        title,
        content,
        link,
      },
    });

    // 2. Enviar en vivo por WebSocket a la sala personal del destinatario
    if (io) {
      io.to(`user_${userId}`).emit("new_notification", notification);
    }

    return notification;
  } catch (error) {
    console.error("Error al crear notificación:", error);
  }
};
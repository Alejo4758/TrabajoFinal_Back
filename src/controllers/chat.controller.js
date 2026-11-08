import { PrismaClient } from "@prisma/client";
import { getOrCreateDirectConversation } from "../services/conversation.service.js";
const prisma = new PrismaClient();

// 1. Obtener todas las conversaciones de un usuario (Bandeja de entrada)
// GET /api/users/:userId/conversations
export const getUserConversations = async (req, res) => {
  const userId = Number(req.params.userId);

  try {
    const conversations = await prisma.conversation.findMany({
      where: {
        users: {
          some: {
            userId: userId,
            leftAt: null, // Solo conversaciones activas del usuario
          },
        },
      },
      include: {
        users: {
          include: {
            // Solo los datos que muestra el chat: nombre completo y foto de perfil (null si no subió ninguna)
            user: { select: { id: true, name: true, lastName: true, email: true, profilePicture: true } },
          },
        },
        messages: {
          where: { deletedAt: null },
          orderBy: { createdAt: "desc" },
          take: 1, // Trae el último mensaje para el preview lateral
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    res.json(conversations);
  } catch (error) {
    console.error("Error en getUserConversations:", error);
    res.status(500).json({ error: "Error al obtener conversaciones" });
  }
};

// 2. Obtener el historial de mensajes de una conversación
// GET /api/conversations/:convId/messages
export const getConversationMessages = async (req, res) => {
  const conversationId = Number(req.params.convId);

  try {
    const messages = await prisma.message.findMany({
      where: {
        conversationId: conversationId,
        deletedAt: null,
      },
      include: {
        sender: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    // Se invierte para que en React el más antiguo quede arriba y el nuevo abajo
    res.json(messages.reverse());
  } catch (error) {
    console.error("Error en getConversationMessages:", error);
    res.status(500).json({ error: "Error al obtener los mensajes" });
  }
};

// 3. Crear o abrir un chat 1 a 1 entre dos usuarios
// POST /api/conversations/direct
export const getOrCreateDirectChat = async (req, res) => {
  const { myUserId, targetUserId } = req.body;
  const userA = Number(myUserId);
  const userB = Number(targetUserId);

  try {
    // Busca el chat directo existente o lo crea con ambos usuarios en Conversacion_Usuario
    const conversation = await getOrCreateDirectConversation(prisma, userA, userB);

    res.json(conversation);
  } catch (error) {
    console.error("Error en getOrCreateDirectChat:", error);
    res.status(500).json({ error: "No se pudo crear la conversación" });
  }
};
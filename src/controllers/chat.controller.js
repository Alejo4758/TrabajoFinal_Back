import { PrismaClient } from "@prisma/client";
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
            // Ajusta 'name' y 'email' según cómo se llamen en tu model User
            user: { select: { id: true, name: true, email: true } },
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
    // Buscar si ya tienen un chat directo
    let conversation = await prisma.conversation.findFirst({
      where: {
        isGroup: false,
        AND: [
          { users: { some: { userId: userA } } },
          { users: { some: { userId: userB } } },
        ],
      },
    });

    // Si no existe, lo creamos con ambos usuarios en Conversacion_Usuario
    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          isGroup: false,
          users: {
            create: [{ userId: userA }, { userId: userB }],
          },
        },
      });
    }

    res.json(conversation);
  } catch (error) {
    console.error("Error en getOrCreateDirectChat:", error);
    res.status(500).json({ error: "No se pudo crear la conversación" });
  }
};
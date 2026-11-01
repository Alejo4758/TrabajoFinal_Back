// Lógica compartida para abrir o reutilizar un chat directo entre dos usuarios.
// `client` puede ser el PrismaClient normal o un `tx` de una transacción: Prisma expone
// la misma API en ambos casos, así que esta función sirve para los dos.
export const getOrCreateDirectConversation = async (client, userAId, userBId) => {
  let conversation = await client.conversation.findFirst({
    where: {
      isGroup: false,
      AND: [
        { users: { some: { userId: userAId } } },
        { users: { some: { userId: userBId } } },
      ],
    },
  });

  if (!conversation) {
    conversation = await client.conversation.create({
      data: {
        isGroup: false,
        users: {
          create: [{ userId: userAId }, { userId: userBId }],
        },
      },
    });
  }

  return conversation;
};

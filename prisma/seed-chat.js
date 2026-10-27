import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  // 1. Buscar los primeros 2 usuarios que existan en tu tabla User
  const users = await prisma.user.findMany({ take: 2 });

  if (users.length < 2) {
    console.log("⚠️ Necesitas tener al menos 2 usuarios creados en tu tabla User.");
    return;
  }

  const [userA, userB] = users;
  console.log(`Creando chat entre Usuario #${userA.id} y Usuario #${userB.id}...`);

  // 2. Crear la conversación con ambos usuarios y un mensaje inicial
  const conv = await prisma.conversation.create({
    data: {
      isGroup: false,
      users: {
        create: [
          { userId: userA.id },
          { userId: userB.id },
        ],
      },
      messages: {
        create: {
          senderId: userA.id,
          content: "¡Hola! Este es un mensaje de prueba 👋",
        },
      },
    },
  });

  console.log("✅ Conversación creada con éxito:", conv);
}

main()
  .catch((e) => console.error("❌ Error:", e))
  .finally(() => prisma.$disconnect());
import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth.routes.js";
import atRoutes from './routes/at.routes.js';
import documentoRoutes from "./routes/documento.routes.js"; // <-- Agregamos la importación
import chatRoutes from "./routes/chat.routes.js";

import { PrismaClient } from "@prisma/client";
import { createServer } from "http";
import { Server } from "socket.io";

const app = express();

const httpServer = createServer(app);
const prisma = new PrismaClient();


const io = new Server(httpServer, {
  cors: {
    origin: "*", // En producción pon la URL de tu front (ej. "http://localhost:5173")
    methods: ["GET", "POST"],
  },
});

app.use(cors());
app.use(express.json());

// Health check para monitorear que el servidor está vivo
app.use("/api/health", (req, res) =>
  res.status(200).json({ message: "Todo correcto master 👍" })
);

app.use('/ats', atRoutes); // Habilita: GET /ats/search
app.use('/at', atRoutes);

// Rutas de autenticación de tu plataforma
app.use("/auth", authRoutes);

// Rutas para manejar los documentos de los A.T.
app.use("/api/documentos", documentoRoutes); // <-- Conectamos la ruta

// Rutas de chat
app.use("/api", chatRoutes);


io.on("connection", (socket) => {
  console.log("Cliente conectado al socket:", socket.id);

  // Cuando el usuario selecciona un chat en el front
  socket.on("join_chat", (conversationId) => {
    const roomName = `conv_${conversationId}`;
    socket.join(roomName);
  });

  // Cuando el usuario envía un mensaje
  socket.on("send_message", async ({ conversationId, senderId, content }) => {
    try {
      const convIdNum = Number(conversationId);
      const senderIdNum = Number(senderId);

      // Guardamos el mensaje en Postgres y actualizamos el updatedAt de la conversación
      const [newMessage] = await prisma.$transaction([
        prisma.message.create({
          data: {
            conversationId: convIdNum,
            senderId: senderIdNum,
            content: content,
          },
          include: {
            sender: { select: { id: true, name: true } }, // Ajustar si tu User usa otro campo
          },
        }),
        prisma.conversation.update({
          where: { id: convIdNum },
          data: { updatedAt: new Date() },
        }),
      ]);

      // Emitimos el mensaje recién guardado a todos los que estén en esa conversación
      io.to(`conv_${convIdNum}`).emit("receive_message", newMessage);
    } catch (error) {
      console.error("Error al guardar o emitir mensaje:", error);
      socket.emit("error_message", "No se pudo enviar el mensaje");
    }
  });

  socket.on("disconnect", () => {
    console.log("Cliente desconectado:", socket.id);
  });
});




const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Servidor de Acompañantes Terapéuticos y Socket.io corriendo en http://localhost:${PORT}`);
});
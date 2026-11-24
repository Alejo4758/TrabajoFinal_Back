import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth.routes.js";
import atRoutes from './routes/at.routes.js';
import localityRoutes from './routes/locality.routes.js';
import documentoRoutes from "./routes/documento.routes.js"; // <-- Agregamos la importación
import chatRoutes from "./routes/chat.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import linkRequestRoutes from "./routes/linkRequest.routes.js";
import calendarRoutes from "./routes/calendar.routes.js";
import userRoutes from "./routes/user.routes.js";
import patientRoutes from "./routes/patient.routes.js";
import atPatientRoutes from "./routes/atPatient.routes.js";
import reportRoutes from "./routes/report.routes.js";
import networkRoutes from "./routes/network.routes.js";
import invitationRoutes from "./routes/invitation.routes.js";
import supportNetworkRoutes from "./routes/supportNetwork.routes.js";
import contributionRoutes from "./routes/contribution.routes.js";

import { PrismaClient } from "@prisma/client";
import { createServer } from "http";
import { Server } from "socket.io";

import notificationRoutes from "./routes/notification.routes.js";
import { createNotification } from "./services/notification.service.js";

const app = express();

const httpServer = createServer(app);
const prisma = new PrismaClient();


const io = new Server(httpServer, {
  cors: {
    origin: "*", // En producción pon la URL de tu front (ej. "http://localhost:5173")
    methods: ["GET", "POST"],
  },
});
app.set("io", io); // <-- Permite usar req.app.get("io") en otros controladores

app.use(cors());

// Solicitudes de vinculación cliente -> A.T.
// Va antes del express.json() global porque tiene su propio parser con un límite de 10kb
app.use('/link-requests', linkRequestRoutes);

app.use(express.json());

// Health check para monitorear que el servidor está vivo
app.use("/api/health", (req, res) =>
  res.status(200).json({ message: "Todo correcto master 👍" })
);

app.use('/ats', atRoutes); // Habilita: GET /ats/search
app.use('/at', atRoutes);
app.use('/localities', localityRoutes);

// Rutas del panel de administración (validación de A.T.)
app.use('/admin', adminRoutes);

// Rutas de autenticación de tu plataforma
app.use("/auth", authRoutes);

// Rutas para manejar los documentos de los A.T.
app.use("/api/documentos", documentoRoutes); // <-- Conectamos la ruta

// Rutas del calendario y agenda del A.T.
// Va antes de los routers montados en "/api" para que ninguno intercepte /api/calendar
app.use("/api/calendar", calendarRoutes);

// Rutas de usuario (foto de perfil): POST /api/users/:id/avatar
app.use("/api/users", userRoutes);

// Informes periódicos de un paciente (A.T. y ADMIN), con borrador generado por IA.
// Tiene que ir ANTES de "/api/patients": ese router exige rol CLIENT para todo lo que entra por él
app.use("/api/patients/:patientId/reports", reportRoutes);

// Aportes de la red de apoyo (A.T. y SUPPORT). También va ANTES de "/api/patients", por el mismo motivo
app.use("/api/patients/:patientId/contributions", contributionRoutes);

// Red de apoyo del paciente, del lado del A.T. (invitaciones e integrantes).
// Va antes de "/api/at/patients" para que quede claro que no pasa por ese router
app.use("/api/at/patients/:patientId/network", networkRoutes);

// Invitaciones a la red de apoyo, del lado del invitado: públicas (sin token) y con límite de pedidos por IP
app.use("/api/invitations", invitationRoutes);

// Lo que ve el integrante de la red de apoyo logueado: sus acompañamientos y el tablero de cada uno
app.use("/api/network", supportNetworkRoutes);

// Pacientes: los que carga el titular de la cuenta (/api/patients)
// y los que acompaña el A.T. logueado, con su plan de trabajo (/api/at/patients)
app.use("/api/patients", patientRoutes);
app.use("/api/at/patients", atPatientRoutes);

// Rutas de chat
app.use("/api", chatRoutes);

app.use("/api", notificationRoutes);


io.on("connection", (socket) => {
  console.log("Cliente conectado al socket:", socket.id);

  // Sala personal del usuario: ahí le llegan las notificaciones en vivo
  socket.on("join_user_channel", (userId) => {
    if (userId) {
      socket.join(`user_${userId}`);
    }
  });

  // Cuando el usuario selecciona un chat en el front
  socket.on("join_chat", (conversationId) => {
    const roomName = `conv_${conversationId}`;
    socket.join(roomName);
  });

  // Cuando el usuario envía un mensaje
  socket.on("send_message", async ({ conversationId, senderId, content }) => {
    const convIdNum = Number(conversationId);
    const senderIdNum = Number(senderId);
    let newMessage;

    try {
      // Guardamos el mensaje en Postgres y actualizamos el updatedAt de la conversación
      [newMessage] = await prisma.$transaction([
        prisma.message.create({
          data: {
            conversationId: convIdNum,
            senderId: senderIdNum,
            content: content,
          },
          include: {
            sender: { select: { id: true, name: true, lastName: true } },
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
      return;
    }

    // El mensaje ya se envió: si falla la notificación no se le informa error al remitente
    try {
      const participants = await prisma.conversationUser.findMany({
        where: {
          conversationId: convIdNum,
          userId: { not: senderIdNum },
          leftAt: null,
        },
      });

      for (const p of participants) {
        await createNotification(io, {
          userId: p.userId,
          type: "CHAT_MESSAGE",
          title: `Nuevo mensaje de ${newMessage.sender.name} ${newMessage.sender.lastName}`,
          content: content.length > 50 ? `${content.substring(0, 50)}...` : content,
          link: `/chat`,
        });
      }
    } catch (error) {
      console.error("Error al notificar el mensaje:", error);
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

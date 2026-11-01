import { createNotification } from "../services/notification.service.js";

// Dentro de tu función solicitarEntrevista, después de guardar en BD:
const io = req.app.get("io");

// Supongamos que 'atProfile' tiene el userId del acompañante terapéutico
await createNotification(io, {
  userId: atProfile.userId,
  type: "INTERVIEW_REQUEST",
  title: "Nueva solicitud de entrevista",
  content: `Un cliente te ha enviado una solicitud de entrevista.`,
  link: "/calendario",
});
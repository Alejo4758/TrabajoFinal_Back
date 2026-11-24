import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || "smtp.ethereal.email",
  port: Number(process.env.EMAIL_PORT) || 587,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Asegúrate de que tenga "export" aquí
export const enviarEmailVerificacion = async (destinatario, token) => {
  const urlVerificacion = `http://localhost:3000/auth/verify-email?token=${token}`;

  await transporter.sendMail({
    from: '"Tu App" <no-reply@tuapp.com>',
    to: destinatario,
    subject: "Confirma tu correo electrónico",
    html: `
      <h2>¡Bienvenido!</h2>
      <p>Por favor confirma tu cuenta haciendo clic en el siguiente enlace:</p>
      <a href="${urlVerificacion}" target="_blank">Verificar mi cuenta</a>
      <p>Este enlace expirará en 24 horas.</p>
    `,
  });
};

// Los nombres vienen de la base, pero los carga gente: se escapan antes de meterlos en el HTML del correo
const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

// Invitación a la red de apoyo de un paciente. link = `${FRONTEND_URL}/invitacion/${token}`.
// Va solo el nombre de pila del paciente: nada clínico en un correo
export const enviarEmailInvitacion = async (destinatario, { link, atName, patientFirstName }) => {
  const at = escapeHtml(atName || "Tu acompañante terapéutico");
  const patient = escapeHtml(patientFirstName || "la persona acompañada");

  await transporter.sendMail({
    from: '"Tu App" <no-reply@tuapp.com>',
    to: destinatario,
    subject: `${atName || "Tu acompañante terapéutico"} te invitó a la red de apoyo de ${patientFirstName || "un acompañamiento"}`,
    html: `
      <h2>Te invitaron a una red de apoyo</h2>
      <p>${at} te invitó a formar parte de la red de apoyo del acompañamiento de ${patient}.</p>
      <p>Para aceptar, creá tu cuenta desde este enlace:</p>
      <a href="${escapeHtml(link)}" target="_blank">Aceptar la invitación</a>
      <p>El enlace vence en 7 días y sirve una sola vez.</p>
      <p>Si no esperabas este correo, podés ignorarlo.</p>
    `,
  });
};

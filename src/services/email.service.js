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
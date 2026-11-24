import bcrypt from "bcrypt";
import prisma from "../../lib/prisma.js";
import { createNotification } from "../services/notification.service.js";
import {
  sendError,
  hashToken,
  isValidTokenFormat,
  isExpired,
  validateAccept,
  roleToApi,
  sectionsToApi,
  fullName,
  firstName,
} from "../services/network.service.js";

// Páginas públicas de la invitación a la red de apoyo (sin sesión): ver la invitación y crear la cuenta.
// Lo único que identifica al pedido es el token del enlace. Se busca por su hash (en la base no está el token) y
// se devuelve solo lo mínimo para que la persona sepa a qué la invitaron: el nombre de pila del paciente, nada clínico.
// Las rutas tienen límite de pedidos por IP (src/routes/invitation.routes.js), para que no se puedan probar tokens.

const NOT_FOUND_MESSAGE = "Este enlace de invitación no es válido.";
const USED_MESSAGE = "Esta invitación ya fue utilizada.";
const EXPIRED_MESSAGE = "La invitación venció.";
const EMAIL_TAKEN_MESSAGE = "Ya existe una cuenta con este correo";

// Señal interna para cortar la transacción del alta
class InvitationUsedError extends Error {}

const invitationSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  relationship: true,
  access: true,
  status: true,
  expiresAt: true,
  treatment: {
    select: {
      patient: { select: { id: true, name: true } },
      profileAT: { select: { user: { select: { id: true, name: true, lastName: true } } } },
    },
  },
};

// Busca la invitación del token y revisa que se pueda usar. Devuelve { invitation, atName } o responde el error y devuelve null
const loadUsableInvitation = async (req, res) => {
  const { token } = req.params;
  // Un token con otra forma no puede existir: ni se consulta la base
  if (!isValidTokenFormat(token)) {
    sendError(res, "not_found", NOT_FOUND_MESSAGE);
    return null;
  }

  const invitation = await prisma.networkMember.findUnique({ where: { tokenHash: hashToken(token) }, select: invitationSelect });
  if (!invitation) {
    sendError(res, "not_found", NOT_FOUND_MESSAGE);
    return null;
  }

  const atName = fullName(invitation.treatment.profileAT.user) || "Tu acompañante terapéutico";
  if (invitation.status === "ACTIVE") {
    sendError(res, "used", USED_MESSAGE);
    return null;
  }
  if (isExpired(invitation)) {
    // El nombre del A.T. sirve para que la página le diga a quién pedirle una invitación nueva
    sendError(res, "expired", EXPIRED_MESSAGE, { atName });
    return null;
  }
  return { invitation, atName };
};

// GET /api/invitations/:token
export const getInvitation = async (req, res) => {
  try {
    const loaded = await loadUsableInvitation(req, res);
    if (!loaded) return;

    const { invitation, atName } = loaded;
    return res.status(200).json({
      data: {
        email: invitation.email,
        name: invitation.name ?? "",
        role: roleToApi(invitation.role),
        relationship: invitation.relationship ?? "",
        access: sectionsToApi(invitation.access),
        patientFirstName: firstName(invitation.treatment.patient.name) || "la persona acompañada",
        atName,
        expiresAt: invitation.expiresAt.toISOString(),
      },
    });
  } catch (error) {
    console.error("Error en getInvitation:", error.code || "", error.message);
    return res.status(500).json({ error: "Error interno del servidor al obtener la invitación." });
  }
};

// POST /api/invitations/:token/accept
// Body: { name, lastName, password, role, relationship }. Crea la cuenta SUPPORT con el correo de la invitación
// (ya verificado: la persona llegó desde el enlace que le mandamos) y pasa la invitación a integrante activo.
// El hash del token se conserva: volver a abrir el enlace responde "ya fue utilizada"
export const acceptInvitation = async (req, res) => {
  try {
    const { error: validationError, data } = validateAccept(req.body);
    if (validationError) return sendError(res, "invalid", validationError);

    const loaded = await loadUsableInvitation(req, res);
    if (!loaded) return;
    const { invitation } = loaded;

    const existingUser = await prisma.user.findUnique({ where: { email: invitation.email }, select: { id: true } });
    if (existingUser) return sendError(res, "email_taken", EMAIL_TAKEN_MESSAGE);

    const hashedPassword = await bcrypt.hash(data.password, 10);
    const now = new Date();

    try {
      await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: invitation.email,
            password: hashedPassword,
            name: data.name,
            lastName: data.lastName,
            role: "SUPPORT",
            emailVerified: true,
          },
          select: { id: true },
        });

        // El estado y el vencimiento en el filtro: si otro pedido la aceptó (o venció) entre la lectura y acá, no se pisa
        const { count } = await tx.networkMember.updateMany({
          where: { id: invitation.id, status: "PENDING", expiresAt: { gte: now } },
          data: {
            status: "ACTIVE",
            userId: user.id,
            acceptedAt: now,
            name: `${data.name} ${data.lastName}`,
            role: data.role,
            relationship: data.relationship,
          },
        });
        if (count === 0) throw new InvitationUsedError();
      });
    } catch (error) {
      if (error instanceof InvitationUsedError) return sendError(res, "used", USED_MESSAGE);
      // P2002: se creó una cuenta con ese correo entre el chequeo y el alta
      if (error.code === "P2002") return sendError(res, "email_taken", EMAIL_TAKEN_MESSAGE);
      throw error;
    }

    // Aviso al A.T. Si falla, la cuenta ya está creada: no se informa error
    const { patient, profileAT } = invitation.treatment;
    await createNotification(req.app.get("io"), {
      userId: profileAT.user.id,
      type: "NETWORK_INVITE_ACCEPTED",
      title: "Aceptaron una invitación a la red de apoyo",
      content: `${data.name} ${data.lastName} ya forma parte de la red de apoyo de ${patient.name}.`,
      link: `/patient/${patient.id}?tab=supportNetwork`,
    });

    return res.status(201).json({ data: { ok: true, email: invitation.email } });
  } catch (error) {
    // Nunca se loguea el cuerpo: trae la contraseña
    console.error("Error en acceptInvitation:", error.code || "", error.message);
    return res.status(500).json({ error: "Error interno del servidor al aceptar la invitación." });
  }
};

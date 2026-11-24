import prisma from "../../lib/prisma.js";
import { enviarEmailInvitacion } from "../services/email.service.js";
import {
  sendError,
  parseId,
  findATTreatment,
  validateInvite,
  parseAccess,
  generateInvitationToken,
  invitationExpiry,
  invitationLink,
  isExpired,
  toMemberView,
  fullName,
  firstName,
} from "../services/network.service.js";

// Red de apoyo del paciente vista por el A.T.: invitaciones e integrantes (Red de apoyo en la ficha del paciente).
//
// PREVENCIÓN DE IDOR
// El :patientId y el :memberId llegan por la URL. En cada pedido se busca el acompañamiento del A.T. del token con ese
// paciente (si no existe, 403) y el integrante se busca SIEMPRE dentro de ese acompañamiento: el de otra red, para
// este A.T., no existe (404).

const FORBIDDEN_MESSAGE = "No tenés acceso a la red de apoyo de este paciente.";
const INVITATION_GONE = "La invitación ya no existe.";
const MEMBER_GONE = "El integrante ya no existe.";

// Señal interna para cortar la transacción de la invitación con un 409
class DuplicateInvitationError extends Error {
  constructor(message) {
    super(message);
    this.publicMessage = message;
  }
}

// Valida el :patientId y busca el acompañamiento del A.T. Devuelve el treatment o responde el error y devuelve null
const loadTreatment = async (req, res, select = { id: true }) => {
  const patientId = parseId(req.params.patientId);
  if (!patientId) {
    sendError(res, "invalid", "El id del paciente no es válido.");
    return null;
  }

  const treatment = await findATTreatment(req.user.userId, patientId, select);
  if (!treatment) {
    sendError(res, "forbidden", FORBIDDEN_MESSAGE);
    return null;
  }
  return { ...treatment, patientId };
};

const readMemberId = (req, res) => {
  const memberId = parseId(req.params.memberId);
  if (!memberId) sendError(res, "invalid", "El id del integrante no es válido.");
  return memberId;
};

// Lo que necesita el correo de invitación
const invitationSelect = {
  id: true,
  patient: { select: { name: true } },
  profileAT: { select: { user: { select: { name: true, lastName: true } } } },
};

// Manda el correo. Si falla, la invitación queda creada igual: el A.T. puede copiar el enlace desde la respuesta
const sendInvitationEmail = async (email, token, treatment) => {
  try {
    await enviarEmailInvitacion(email, {
      link: invitationLink(token),
      atName: fullName(treatment.profileAT.user),
      patientFirstName: firstName(treatment.patient.name),
    });
    return true;
  } catch (error) {
    // Ni el token ni el enlace van al log
    console.error("Error al enviar el correo de invitación:", error.code || "", error.message);
    return false;
  }
};

// GET /api/at/patients/:patientId/network
export const listNetwork = async (req, res) => {
  try {
    const treatment = await loadTreatment(req, res);
    if (!treatment) return;

    const members = await prisma.networkMember.findMany({
      where: { treatmentId: treatment.id },
      orderBy: [{ invitedAt: "asc" }, { id: "asc" }],
    });

    return res.status(200).json({ data: members.map((member) => toMemberView(member, treatment.patientId)) });
  } catch (error) {
    console.error("Error en listNetwork:", error.code || "", error.message);
    return res.status(500).json({ error: "Error interno del servidor al obtener la red de apoyo." });
  }
};

// POST /api/at/patients/:patientId/network/invitations
// Body: { name?, email, role, relationship?, access }. Responde el integrante con el token en texto plano
// (es la única vez que viaja, junto con el reenvío) y emailSent, por si el A.T. tiene que compartir el enlace a mano
export const inviteMember = async (req, res) => {
  try {
    const { error: validationError, data } = validateInvite(req.body);
    if (validationError) return sendError(res, "invalid", validationError);

    const treatment = await loadTreatment(req, res, invitationSelect);
    if (!treatment) return;

    const { token, tokenHash } = generateInvitationToken();
    const now = new Date();

    let member;
    try {
      member = await prisma.$transaction(async (tx) => {
        const existing = await tx.networkMember.findUnique({
          where: { treatmentId_email: { treatmentId: treatment.id, email: data.email } },
          select: { id: true, status: true, expiresAt: true },
        });

        if (existing && existing.status === "ACTIVE") {
          throw new DuplicateInvitationError("Esa persona ya forma parte de la red de apoyo.");
        }
        if (existing && !isExpired(existing, now)) {
          throw new DuplicateInvitationError("Ya hay una invitación vigente para ese correo.");
        }
        // Una invitación vencida del mismo correo se reemplaza por la nueva
        if (existing) await tx.networkMember.delete({ where: { id: existing.id } });

        return tx.networkMember.create({
          data: {
            ...data,
            treatmentId: treatment.id,
            status: "PENDING",
            tokenHash,
            invitedAt: now,
            expiresAt: invitationExpiry(now),
          },
        });
      });
    } catch (error) {
      if (error instanceof DuplicateInvitationError) return sendError(res, "duplicate", error.publicMessage);
      // P2002: otro pedido invitó al mismo correo entre el chequeo y el alta
      if (error.code === "P2002") return sendError(res, "duplicate", "Ya hay una invitación vigente para ese correo.");
      throw error;
    }

    const emailSent = await sendInvitationEmail(member.email, token, treatment);

    return res.status(201).json({ data: toMemberView(member, treatment.patientId, { token }), emailSent });
  } catch (error) {
    console.error("Error en inviteMember:", error.code || "", error.message);
    return res.status(500).json({ error: "Error interno del servidor al crear la invitación." });
  }
};

// POST /api/at/patients/:patientId/network/invitations/:memberId/resend
// Genera un token nuevo (el enlace anterior deja de servir) y da 7 días más desde ahora. Sirve también para una vencida
export const resendInvitation = async (req, res) => {
  try {
    const memberId = readMemberId(req, res);
    if (!memberId) return;

    const treatment = await loadTreatment(req, res, invitationSelect);
    if (!treatment) return;

    const { token, tokenHash } = generateInvitationToken();
    const now = new Date();

    // updateMany con el estado en el filtro: si la aceptaron entre tanto, no se le cambia el token
    const { count } = await prisma.networkMember.updateMany({
      where: { id: memberId, treatmentId: treatment.id, status: "PENDING" },
      data: { tokenHash, invitedAt: now, expiresAt: invitationExpiry(now) },
    });
    if (count === 0) return sendError(res, "not_found", INVITATION_GONE);

    const member = await prisma.networkMember.findUnique({ where: { id: memberId } });
    const emailSent = await sendInvitationEmail(member.email, token, treatment);

    return res.status(200).json({ data: toMemberView(member, treatment.patientId, { token }), emailSent });
  } catch (error) {
    console.error("Error en resendInvitation:", error.code || "", error.message);
    return res.status(500).json({ error: "Error interno del servidor al reenviar la invitación." });
  }
};

// DELETE /api/at/patients/:patientId/network/invitations/:memberId
// Cancela una invitación pendiente o vencida. Un integrante activo se quita con DELETE /members/:memberId
export const cancelInvitation = async (req, res) => {
  try {
    const memberId = readMemberId(req, res);
    if (!memberId) return;

    const treatment = await loadTreatment(req, res);
    if (!treatment) return;

    const { count } = await prisma.networkMember.deleteMany({
      where: { id: memberId, treatmentId: treatment.id, status: "PENDING" },
    });
    if (count === 0) return sendError(res, "not_found", INVITATION_GONE);

    return res.status(200).json({ data: { ok: true } });
  } catch (error) {
    console.error("Error en cancelInvitation:", error.code || "", error.message);
    return res.status(500).json({ error: "Error interno del servidor al cancelar la invitación." });
  }
};

// DELETE /api/at/patients/:patientId/network/members/:memberId
// Quita a la persona de la red: pierde el acceso enseguida. Sus aportes se conservan (cuelgan de su usuario, no de esta fila)
// y su cuenta sigue existiendo, por si integra la red de otro paciente
export const removeMember = async (req, res) => {
  try {
    const memberId = readMemberId(req, res);
    if (!memberId) return;

    const treatment = await loadTreatment(req, res);
    if (!treatment) return;

    const { count } = await prisma.networkMember.deleteMany({ where: { id: memberId, treatmentId: treatment.id } });
    if (count === 0) return sendError(res, "not_found", MEMBER_GONE);

    return res.status(200).json({ data: { ok: true } });
  } catch (error) {
    console.error("Error en removeMember:", error.code || "", error.message);
    return res.status(500).json({ error: "Error interno del servidor al quitar al integrante." });
  }
};

// PATCH /api/at/patients/:patientId/network/members/:memberId
// Body: { access }. Cambia qué secciones puede ver. Si le quita una, deja de ver también los aportes de esa sección
export const updateMemberAccess = async (req, res) => {
  try {
    const memberId = readMemberId(req, res);
    if (!memberId) return;

    const access = parseAccess(req.body?.access);
    if (access.error) return sendError(res, "invalid", access.error);

    const treatment = await loadTreatment(req, res);
    if (!treatment) return;

    const { count } = await prisma.networkMember.updateMany({
      where: { id: memberId, treatmentId: treatment.id },
      data: { access: access.value },
    });
    if (count === 0) return sendError(res, "not_found", MEMBER_GONE);

    const member = await prisma.networkMember.findUnique({ where: { id: memberId } });
    return res.status(200).json({ data: toMemberView(member, treatment.patientId) });
  } catch (error) {
    console.error("Error en updateMemberAccess:", error.code || "", error.message);
    return res.status(500).json({ error: "Error interno del servidor al actualizar los accesos." });
  }
};

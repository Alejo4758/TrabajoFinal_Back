// Red de apoyo de un acompañamiento: validaciones, formato de respuesta, tokens de invitación y el control de acceso
// que comparten el tablero del integrante y los aportes.
//
// El contrato es el de los mocks del front (src/services/networkService.js y src/utils/networkModel.js):
// en la API los enums van en minúsculas (role "family", access ["plan", "sessions"...], status "pending"/"active")
// y en la base, en mayúsculas (NetworkRole, NetworkSection, NetworkMemberStatus).

import crypto from "crypto";
import prisma from "../../lib/prisma.js";
import { createNotification } from "./notification.service.js";

export const INVITATION_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const NAME_MAX = 80;
const RELATIONSHIP_MAX = 80;
const EMAIL_MAX = 254;
const PASSWORD_MIN = 8;
// bcrypt solo usa los primeros 72 bytes: más largo no suma seguridad
const PASSWORD_MAX = 72;

// Mismo patrón que EMAIL_REGEX del front
const EMAIL_REGEX =
  /^[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;
// Letras (con tildes), y palabras separadas por espacio, apóstrofo o guion. Igual que validateAccept del front
const LETTERS_REGEX = /^\p{L}+(?:[ '’-]\p{L}+)*$/u;
// El token es crypto.randomBytes(32) en hexadecimal
const TOKEN_REGEX = /^[a-f0-9]{64}$/;

// ---------- Enums: API (minúsculas) <-> base ----------

const ROLES = { family: "FAMILY", education: "EDUCATION", health: "HEALTH", other: "OTHER" };
// En el orden en que las muestra el front (ACCESS_SECTIONS)
const SECTIONS = { plan: "PLAN", sessions: "SESSIONS", progress: "PROGRESS", reports: "REPORTS" };

const invert = (map) => Object.fromEntries(Object.entries(map).map(([api, db]) => [db, api]));
const ROLE_TO_API = invert(ROLES);
const SECTION_TO_API = invert(SECTIONS);

export const ALL_SECTIONS = Object.keys(SECTIONS);
export const roleToApi = (role) => ROLE_TO_API[role] ?? "other";
// Siempre en el orden de SECTIONS, sin repetidas
export const sectionsToApi = (access = []) => ALL_SECTIONS.filter((section) => access.includes(SECTIONS[section]));

// ---------- Errores ----------

// Formato de error que espera el front: { error, code } (y details cuando hace falta)
const CODE_STATUS = {
  invalid: 400,
  forbidden: 403,
  not_found: 404,
  duplicate: 409,
  used: 409,
  email_taken: 409,
  expired: 410,
  rate_limited: 429,
};

export const sendError = (res, code, message, details) =>
  res.status(CODE_STATUS[code] ?? 500).json({ error: message, code, ...(details ? { details } : {}) });

export const parseId = (value) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 && id <= 2147483647 ? id : null;
};

// ---------- Tokens de invitación ----------

// Del token solo se guarda el hash: si se filtra la base, los enlaces no sirven
export const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

export const generateInvitationToken = () => {
  const token = crypto.randomBytes(32).toString("hex");
  return { token, tokenHash: hashToken(token) };
};

export const isValidTokenFormat = (token) => typeof token === "string" && TOKEN_REGEX.test(token);

export const invitationExpiry = (from = new Date()) => new Date(from.getTime() + INVITATION_DAYS * DAY_MS);

export const invitationLink = (token) =>
  `${(process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "")}/invitacion/${token}`;

// "Vencida" no es un estado guardado: es una invitación pendiente con la fecha pasada
export const isExpired = (member, now = new Date()) => member.status === "PENDING" && member.expiresAt < now;

// ---------- Formato de respuesta ----------

export const fullName = (person) => [person?.name, person?.lastName].filter(Boolean).join(" ");

// Nombre de pila: lo único del paciente que ve alguien que todavía no aceptó la invitación
export const firstName = (name) => String(name ?? "").trim().split(/\s+/)[0] || "";

// Integrante o invitación, como lo usa la pestaña Red de apoyo del AT.
// El token en texto plano no se guarda: solo viaja en la respuesta de invitar y de reenviar
export const toMemberView = (member, patientId, { token = null } = {}) => ({
  id: member.id,
  patientId,
  token,
  name: member.name ?? "",
  email: member.email,
  role: roleToApi(member.role),
  relationship: member.relationship ?? "",
  access: sectionsToApi(member.access),
  status: member.status === "ACTIVE" ? "active" : "pending",
  invitedAt: member.invitedAt.toISOString(),
  expiresAt: member.expiresAt.toISOString(),
  acceptedAt: member.acceptedAt ? member.acceptedAt.toISOString() : null,
});

// ---------- Validaciones ----------

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// Texto opcional recortado. Devuelve { value } (null si viene vacío) o { error }
const optionalText = (value, max, label) => {
  if (value === undefined || value === null) return { value: null };
  if (typeof value !== "string") return { error: `${label} no es válido.` };
  const trimmed = value.trim();
  if (trimmed.length > max) return { error: `${label} es demasiado largo.` };
  return { value: trimmed || null };
};

const parseRole = (value, message) => (typeof value === "string" && ROLES[value] ? { value: ROLES[value] } : { error: message });

// Lista de secciones de la API -> enums de la base. Al menos una
export const parseAccess = (value) => {
  if (!Array.isArray(value) || value.length === 0) return { error: "Habilitá al menos una sección." };
  if (value.some((section) => typeof section !== "string" || !SECTIONS[section])) {
    return { error: "Hay una sección que no es válida." };
  }
  return { value: ALL_SECTIONS.filter((section) => value.includes(section)).map((section) => SECTIONS[section]) };
};

// Formulario de invitación: { name?, email, role, relationship?, access }. Como validateInvite del front
// (el consentimiento es una casilla del formulario y no viaja). Devuelve { error } o { data } listo para guardar
export const validateInvite = (body) => {
  if (!isPlainObject(body)) return { error: "La invitación enviada no es válida." };

  const name = optionalText(body.name, NAME_MAX, "El nombre");
  if (name.error) return name;

  if (typeof body.email !== "string" || !body.email.trim()) {
    return { error: "Ingresá el correo electrónico de la persona." };
  }
  const email = body.email.trim().toLowerCase();
  if (email.length > EMAIL_MAX || email.includes("..") || !EMAIL_REGEX.test(email)) {
    return { error: "Ingresá un correo válido, por ejemplo nombre@dominio.com." };
  }

  const role = parseRole(body.role, "Elegí el rol de la persona en el acompañamiento.");
  if (role.error) return role;

  const relationship = optionalText(body.relationship, RELATIONSHIP_MAX, "El vínculo");
  if (relationship.error) return relationship;

  const access = parseAccess(body.access);
  if (access.error) return access;

  return { data: { name: name.value, email, role: role.value, relationship: relationship.value, access: access.value } };
};

const parsePersonName = (value, label) => {
  if (typeof value !== "string" || !value.trim()) return { error: `El ${label} es obligatorio` };
  const trimmed = value.trim();
  if (trimmed.length < 2 || trimmed.length > NAME_MAX || !LETTERS_REGEX.test(trimmed)) {
    return { error: `Ingresá un ${label} válido (solo letras)` };
  }
  return { value: trimmed };
};

// Formulario con el que el invitado crea su cuenta: { name, lastName, password, role, relationship }.
// Como validateAccept del front (la confirmación de la contraseña y el consentimiento se controlan allá)
export const validateAccept = (body) => {
  if (!isPlainObject(body)) return { error: "Los datos ingresados no son válidos." };

  const name = parsePersonName(body.name, "nombre");
  if (name.error) return name;
  const lastName = parsePersonName(body.lastName, "apellido");
  if (lastName.error) return lastName;

  const role = parseRole(body.role, "Elegí tu rol en el acompañamiento");
  if (role.error) return role;

  const { password } = body;
  if (typeof password !== "string" || password.length < PASSWORD_MIN) {
    return { error: `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres` };
  }
  if (/\s/.test(password)) return { error: "La contraseña no puede tener espacios" };
  if (password.length > PASSWORD_MAX) return { error: `La contraseña puede tener hasta ${PASSWORD_MAX} caracteres` };

  const relationship = optionalText(body.relationship, RELATIONSHIP_MAX, "El vínculo");
  if (relationship.error) return relationship;

  return {
    data: { name: name.value, lastName: lastName.value, password, role: role.value, relationship: relationship.value },
  };
};

// ---------- Acceso ----------

// Acompañamiento del A.T. autenticado con el paciente, o null. Igual que findTreatment de atPatient.controller.js:
// el A.T. sale del token y el paciente de la URL, así que se buscan siempre juntos (anti-IDOR)
export const findATTreatment = async (atUserId, patientId, select = { id: true }) => {
  const profileAT = await prisma.profileAT.findUnique({ where: { userId: atUserId }, select: { id: true } });
  if (!profileAT) return null;

  return prisma.treatment.findUnique({
    where: { patientId_profileATId: { patientId, profileATId: profileAT.id } },
    select,
  });
};

// Única puerta de acceso al tablero y a los aportes de un paciente. Devuelve null si quien pide no tiene acceso:
//   - AT: tiene que tener un acompañamiento con el paciente. Ve todas las secciones.
//   - SUPPORT: tiene que ser integrante ACTIVO de la red de un acompañamiento de ese paciente. Ve solo sus secciones.
//     Si integra la red de dos A.T. del mismo paciente, se toma la que aceptó más recientemente
//     (las URLs son por paciente, no por acompañamiento).
// Devuelve { treatmentId, isAT, sections, member }
export const resolveNetworkViewer = async (user, patientId) => {
  if (!user || !patientId) return null;

  if (user.role === "AT") {
    const treatment = await findATTreatment(user.userId, patientId);
    if (!treatment) return null;
    return { treatmentId: treatment.id, isAT: true, sections: [...ALL_SECTIONS], member: null };
  }

  if (user.role === "SUPPORT") {
    const member = await prisma.networkMember.findFirst({
      where: { userId: user.userId, status: "ACTIVE", treatment: { patientId } },
      orderBy: [{ acceptedAt: "desc" }, { id: "desc" }],
      select: { id: true, name: true, role: true, relationship: true, access: true, treatmentId: true },
    });
    if (!member) return null;
    return { treatmentId: member.treatmentId, isAT: false, sections: sectionsToApi(member.access), member };
  }

  return null;
};

// ---------- Avisos a la red ----------

// El A.T. finalizó un informe: se comparte con los integrantes activos que tienen acceso a Informes y se les avisa.
// Si falla, el informe ya está guardado: solo se loguea
export const notifyReportShared = async (io, { treatmentId, report }) => {
  try {
    const [members, treatment] = await Promise.all([
      prisma.networkMember.findMany({
        where: { treatmentId, status: "ACTIVE", access: { has: "REPORTS" }, userId: { not: null } },
        select: { userId: true },
      }),
      prisma.treatment.findUnique({
        where: { id: treatmentId },
        select: { patient: { select: { id: true, name: true } }, profileAT: { select: { user: { select: { name: true, lastName: true } } } } },
      }),
    ]);

    const atName = fullName(treatment.profileAT.user) || "El acompañante";
    for (const { userId } of members) {
      await createNotification(io, {
        userId,
        type: "NETWORK_REPORT_SHARED",
        title: `Nuevo informe de ${treatment.patient.name}`,
        content: `${atName} compartió «${report.title.slice(0, 80)}» en el tablero.`,
        link: `/red/${treatment.patient.id}?seccion=informes`,
      });
    }
  } catch (error) {
    console.error("Error al avisar a la red del informe:", error.code || "", error.message);
  }
};

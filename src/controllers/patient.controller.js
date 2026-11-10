import prisma from "../../lib/prisma.js";
import { toDateOnly, todayString } from "../services/patient.service.js";

// Pacientes vistos por el titular de la cuenta (rol CLIENT): las personas a su cargo que reciben el acompañamiento.
// En todos los endpoints el titular sale SIEMPRE del token, nunca del body ni de la URL.

const RELATIONSHIPS = ["SELF", "PARENT", "CHILD", "SIBLING", "GRANDPARENT", "PARTNER", "LEGAL_GUARDIAN", "OTHER"];
const NAME_MAX = 60;
const DIAGNOSIS_MAX = 200;
const NOTES_MAX = 1000;
const PATIENTS_MAX = 20;
const AGE_MAX_YEARS = 120;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// Lo que ve el titular sobre sus propios pacientes, con los acompañamientos que tiene cada uno
const ownPatientSelect = {
  id: true,
  name: true,
  lastName: true,
  dateOfBirth: true,
  relationship: true,
  diagnosis: true,
  notes: true,
  createdAt: true,
  treatments: {
    orderBy: { startDate: "desc" },
    select: {
      id: true,
      status: true,
      startDate: true,
      profileAT: { select: { id: true, user: { select: { name: true, lastName: true } } } },
    },
  },
};

const toResponse = (patient) => ({ ...patient, dateOfBirth: toDateOnly(patient.dateOfBirth) });

const parseId = (value) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const parseName = (value, label) => {
  if (typeof value !== "string" || !value.trim()) return { error: `${label} es obligatorio.` };
  const trimmed = value.trim();
  if (trimmed.length > NAME_MAX) return { error: `${label} no puede superar los ${NAME_MAX} caracteres.` };
  return { value: trimmed };
};

// Texto opcional: null o "" lo vacían
const parseOptionalText = (value, max, label) => {
  if (value === null) return { value: null };
  if (typeof value !== "string") return { error: `${label} no es válido.` };
  const trimmed = value.trim();
  if (trimmed.length > max) return { error: `${label} no puede superar los ${max} caracteres.` };
  return { value: trimmed || null };
};

// Fecha de nacimiento "YYYY-MM-DD": tiene que existir, no ser futura y dar una edad posible
const parseBirthDate = (value) => {
  if (typeof value !== "string" || !DATE_REGEX.test(value)) {
    return { error: "La fecha de nacimiento es obligatoria." };
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return { error: "La fecha de nacimiento no es válida." };
  }
  const today = todayString();
  if (value > today) return { error: "La fecha de nacimiento no puede ser futura." };
  if (Number(today.slice(0, 4)) - Number(value.slice(0, 4)) > AGE_MAX_YEARS) {
    return { error: "La fecha de nacimiento no es válida." };
  }
  return { value: date };
};

// Valida el body campo por campo, sin convertir tipos. Lista blanca: solo se leen los campos del contrato
// (un tutorId enviado en el body se ignora). Con partial solo se validan los campos que vinieron.
// Devuelve { error } o { data }
const validatePatientBody = (body, { partial = false } = {}) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "El cuerpo de la solicitud no es válido." };
  }

  const data = {};

  if (!partial || body.name !== undefined) {
    const result = parseName(body.name, "El nombre");
    if (result.error) return result;
    data.name = result.value;
  }

  if (!partial || body.lastName !== undefined) {
    const result = parseName(body.lastName, "El apellido");
    if (result.error) return result;
    data.lastName = result.value;
  }

  if (!partial || body.dateOfBirth !== undefined) {
    const result = parseBirthDate(body.dateOfBirth);
    if (result.error) return result;
    data.dateOfBirth = result.value;
  }

  if (!partial || body.relationship !== undefined) {
    if (!RELATIONSHIPS.includes(body.relationship)) {
      return { error: "Indicá qué vínculo tenés con la persona." };
    }
    data.relationship = body.relationship;
  }

  if (body.diagnosis !== undefined) {
    const result = parseOptionalText(body.diagnosis, DIAGNOSIS_MAX, "El diagnóstico");
    if (result.error) return result;
    data.diagnosis = result.value;
  }

  if (body.notes !== undefined) {
    const result = parseOptionalText(body.notes, NOTES_MAX, "La información adicional");
    if (result.error) return result;
    data.notes = result.value;
  }

  return { data };
};

// Una cuenta solo puede tener un paciente "soy yo"
const hasAnotherSelfPatient = async (tutorId, excludeId = null) => {
  const existing = await prisma.patient.findFirst({
    where: { tutorId, relationship: "SELF", ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  return Boolean(existing);
};

// GET /api/patients
export const getMyPatients = async (req, res) => {
  try {
    const patients = await prisma.patient.findMany({
      where: { tutorId: req.user.userId },
      orderBy: { createdAt: "asc" },
      select: ownPatientSelect,
    });

    return res.status(200).json({ data: patients.map(toResponse) });
  } catch (error) {
    console.error("Error en getMyPatients:", error.code || "", error.message);
    return res.status(500).json({ error: "Error interno del servidor al obtener las personas a tu cargo." });
  }
};

// POST /api/patients
export const createPatient = async (req, res) => {
  try {
    const tutorId = req.user.userId;

    const { error: validationError, data } = validatePatientBody(req.body);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const total = await prisma.patient.count({ where: { tutorId } });
    if (total >= PATIENTS_MAX) {
      return res.status(409).json({ error: `No podés cargar más de ${PATIENTS_MAX} personas.` });
    }

    if (data.relationship === "SELF" && (await hasAnotherSelfPatient(tutorId))) {
      return res.status(409).json({ error: "Ya te cargaste a vos como la persona acompañada." });
    }

    let patient;
    try {
      patient = await prisma.patient.create({
        data: { ...data, tutorId },
        select: ownPatientSelect,
      });
    } catch (error) {
      // El usuario del token ya no existe (se borró la cuenta con la sesión abierta)
      if (error.code === "P2003") {
        return res.status(401).json({ error: "Tu sesión no es válida. Volvé a iniciar sesión." });
      }
      throw error;
    }

    return res.status(201).json({ data: toResponse(patient) });
  } catch (error) {
    // Solo se loguea el código y el mensaje: nunca el body (tiene datos de salud) ni el token
    console.error("Error en createPatient:", error.code || "", error.message);
    return res.status(500).json({ error: "Error interno del servidor al guardar los datos." });
  }
};

// PATCH /api/patients/:id
export const updatePatient = async (req, res) => {
  try {
    const tutorId = req.user.userId;

    const id = parseId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "El id indicado no es válido." });
    }

    // Prevención de IDOR: se busca por id Y por el titular del token.
    // Si el paciente es de otra cuenta responde igual que si no existiera
    const existing = await prisma.patient.findFirst({
      where: { id, tutorId },
      select: { id: true },
    });
    if (!existing) {
      return res.status(404).json({ error: "La persona indicada no existe." });
    }

    const { error: validationError, data } = validatePatientBody(req.body, { partial: true });
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: "No se envió ningún cambio." });
    }

    if (data.relationship === "SELF" && (await hasAnotherSelfPatient(tutorId, id))) {
      return res.status(409).json({ error: "Ya te cargaste a vos como la persona acompañada." });
    }

    const patient = await prisma.patient.update({
      where: { id },
      data,
      select: ownPatientSelect,
    });

    return res.status(200).json({ data: toResponse(patient) });
  } catch (error) {
    console.error("Error en updatePatient:", error.code || "", error.message);
    return res.status(500).json({ error: "Error interno del servidor al guardar los datos." });
  }
};

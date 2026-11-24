// Aportes de la red de apoyo: comentarios del A.T. y de los integrantes sobre el plan, un encuentro o un objetivo.
// El contrato es el del mock del front (src/services/contributonService.js y src/utils/boardModel.js).
//
// Reglas (las aplica el controlador con lo que resuelve resolveNetworkViewer):
//  - El autor sale del token, nunca del cuerpo del pedido.
//  - Un integrante lee y escribe solo en las secciones que tiene habilitadas: plan -> "plan", session -> "sessions",
//    goal -> "progress". Si el A.T. le quita una sección, deja de ver también los aportes de esa sección.
//  - Solo el autor edita o borra su aporte. Solo el A.T. del acompañamiento oculta o vuelve a mostrar aportes.
//  - Un aporte oculto no se le devuelve al resto de los integrantes; su autor sí lo recibe, con hiddenAt.

import prisma from "../../lib/prisma.js";
import { getPlanStages } from "./plan.service.js";
import { toLocalDateTime } from "./encounter.service.js";
import { fullName } from "./network.service.js";

export const CONTRIBUTION_MAX = 1000;
const TARGET_ID_MAX = 64;

// Tipo de destino en la API -> enum de la base y sección que hace falta para verlo
const TARGETS = {
  plan: { db: "PLAN", section: "plan" },
  session: { db: "SESSION", section: "sessions" },
  goal: { db: "GOAL", section: "progress" },
};
const TARGET_TO_API = Object.fromEntries(Object.entries(TARGETS).map(([api, { db }]) => [db, api]));

export const sectionOfTarget = (type) => TARGETS[type]?.section ?? null;

// Tipos de destino (de la base) que puede ver alguien con esas secciones
export const targetTypesFor = (sections) =>
  Object.values(TARGETS)
    .filter(({ section }) => sections.includes(section))
    .map(({ db }) => db);

// Identificador del autor que compara el front con viewer.key (`user:${user.id}`) para saber si el aporte es propio
export const authorKey = (userId) => `user:${userId}`;

export const contributionSelect = {
  id: true,
  targetType: true,
  targetId: true,
  targetLabel: true,
  text: true,
  authorId: true,
  authorRole: true,
  authorRelationship: true,
  createdAt: true,
  editedAt: true,
  hiddenAt: true,
  author: { select: { name: true, lastName: true } },
};

export const toContributionView = (contribution, patientId) => ({
  id: contribution.id,
  patientId,
  target: { type: TARGET_TO_API[contribution.targetType], id: contribution.targetId, label: contribution.targetLabel },
  authorKey: authorKey(contribution.authorId),
  authorName: fullName(contribution.author),
  authorRole: contribution.authorRole,
  authorRelationship: contribution.authorRelationship ?? "",
  text: contribution.text,
  createdAt: contribution.createdAt.toISOString(),
  editedAt: contribution.editedAt ? contribution.editedAt.toISOString() : null,
  hiddenAt: contribution.hiddenAt ? contribution.hiddenAt.toISOString() : null,
});

// Texto del aporte. Devuelve { value } recortado o { error }
export const parseContributionText = (value) => {
  if (value !== undefined && value !== null && typeof value !== "string") return { error: "El aporte no es válido." };
  const clean = String(value ?? "").trim();
  if (!clean) return { error: "El aporte no puede estar vacío." };
  if (clean.length > CONTRIBUTION_MAX) return { error: `El aporte puede tener hasta ${CONTRIBUTION_MAX} caracteres.` };
  return { value: clean };
};

// Cuerpo del alta: { targetType, targetId, text }. Devuelve { error } o { data: { type, targetId, text } }
export const validateContribution = (body) => {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { error: "El aporte no es válido." };

  const type = body.targetType;
  if (typeof type !== "string" || !TARGETS[type]) return { error: "No se puede comentar ese registro." };

  const targetId = typeof body.targetId === "number" ? String(body.targetId) : body.targetId;
  if (typeof targetId !== "string" || !targetId.trim() || targetId.length > TARGET_ID_MAX) {
    return { error: "No se puede comentar ese registro." };
  }

  const text = parseContributionText(body.text);
  if (text.error) return text;

  return { data: { type, targetId: targetId.trim(), text: text.value } };
};

const labelDateFormat = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "long", timeZone: "UTC" });

// "Encuentro del 3 de noviembre, 10:00 h": lo mismo que sessionLabel del front, en hora de Argentina
const sessionLabel = (startDate) => {
  const { date, time } = toLocalDateTime(startDate);
  return `Encuentro del ${labelDateFormat.format(new Date(`${date}T00:00:00Z`))}, ${time} h`;
};

// Verifica que el destino exista en ESE acompañamiento y arma su etiqueta (la copia que se guarda con el aporte).
// Devuelve { db, targetId, label } o null si no existe
export const resolveTarget = async (treatmentId, type, targetId) => {
  if (type === "plan") {
    if (targetId !== "plan") return null;
    const plan = await prisma.workPlan.findUnique({ where: { treatmentId }, select: { id: true } });
    return plan ? { db: "PLAN", targetId: "plan", label: "Plan de trabajo" } : null;
  }

  if (type === "session") {
    if (!/^\d{1,9}$/.test(targetId)) return null;
    const encounter = await prisma.encounter.findFirst({
      where: { id: Number(targetId), treatmentId },
      select: { id: true, startDate: true },
    });
    return encounter ? { db: "SESSION", targetId: String(encounter.id), label: sessionLabel(encounter.startDate) } : null;
  }

  if (type === "goal") {
    const plan = await prisma.workPlan.findUnique({ where: { treatmentId }, select: { content: true } });
    const goal = getPlanStages(plan?.content)
      .flatMap((stage) => stage.specificGoals)
      .find((item) => item.id === targetId);
    return goal ? { db: "GOAL", targetId: goal.id, label: goal.text } : null;
  }

  return null;
};

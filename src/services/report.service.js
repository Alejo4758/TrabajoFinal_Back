// Validación y formato de los informes periódicos del A.T. (Feature 15).
// Igual que con el plan y los encuentros, se revisa campo por campo y se guarda solo lo conocido.
//
// El contenido es HTML: el front lo muestra tal cual, así que el backend lo SANITIZA siempre (lo que genera la IA y lo
// que guarda el A.T.) con una lista cerrada de etiquetas y sin atributos. Así ni un texto con <script> en las
// observaciones ni una respuesta manipulada de la IA pueden terminar ejecutando código en el navegador.

import sanitizeHtml from "sanitize-html";
import { isPlainObject, parseText, parseDate } from "./plan.service.js";
import { toDateOnly, todayString } from "./patient.service.js";
import { fromLocalDateTime } from "./encounter.service.js";

export const AUDIENCES = ["OBRA_SOCIAL", "ESCUELA", "FAMILIA", "EQUIPO_MEDICO"];
export const REPORT_STATUSES = ["DRAFT", "FINAL"];

const TITLE_MAX = 200;
const CONTENT_MAX = 50000;
const EXTRA_NOTES_MAX = 2000;
// Un informe cubre como mucho un año
const PERIOD_MAX_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

// Las mismas etiquetas que produce el editor del front (TrabajoFinal_Front/src/utils/reportModel.js > ALLOWED_TAGS),
// más h4 y tablas. El único atributo permitido es style, y dentro de él solo la alineación del texto
const REPORT_HTML_OPTIONS = {
  allowedTags: ["h1", "h2", "h3", "h4", "p", "br", "hr", "ul", "ol", "li", "strong", "em", "u", "s", "blockquote", "table", "thead", "tbody", "tr", "th", "td"],
  allowedAttributes: { "*": ["style"] },
  allowedStyles: { "*": { "text-align": [/^(left|center|right|justify)$/] } },
  allowedSchemes: [],
  // <b> e <i> se pasan a sus equivalentes semánticos
  transformTags: { b: "strong", i: "em" },
  // Las etiquetas no permitidas se sacan pero se conserva su texto; script, style, etc. se borran con su contenido
  disallowedTagsMode: "discard",
};

export const sanitizeReportHtml = (html) => sanitizeHtml(String(html ?? ""), REPORT_HTML_OPTIONS).trim();

// Hay texto visible (no solo etiquetas vacías)
const hasVisibleText = (html) => sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).trim().length > 0;

const dateFromString = (value) => new Date(`${value}T00:00:00Z`);

const nextDay = (value) => new Date(dateFromString(value).getTime() + DAY_MS).toISOString().slice(0, 10);

// Instantes que delimitan un período de fechas de Argentina: desde las 00:00 del primer día hasta las 00:00 del día
// siguiente al último (exclusivo). Sirve para buscar los encuentros, que se guardan como instante
export const periodBounds = (from, to) => ({
  gte: fromLocalDateTime(from, "00:00"),
  lt: fromLocalDateTime(nextDay(to), "00:00"),
});

// Período "YYYY-MM-DD" a "YYYY-MM-DD". Devuelve { value: { from, to } } o { error }
const parsePeriod = (rawFrom, rawTo) => {
  if (!rawFrom) return { error: "Indicá la fecha de inicio del período." };
  if (!rawTo) return { error: "Indicá la fecha de fin del período." };

  const from = parseDate(rawFrom, "La fecha de inicio del período");
  if (from.error) return from;
  const to = parseDate(rawTo, "La fecha de fin del período");
  if (to.error) return to;

  if (to.value < from.value) return { error: "La fecha final del período no puede ser anterior a la inicial." };
  if (from.value > todayString()) return { error: "El período no puede empezar en una fecha futura." };

  const days = (dateFromString(to.value) - dateFromString(from.value)) / DAY_MS + 1;
  if (days > PERIOD_MAX_DAYS) return { error: "El período del informe no puede superar un año." };

  return { value: { from: from.value, to: to.value } };
};

const parseAudience = (value) =>
  AUDIENCES.includes(value) ? { value } : { error: "Elegí un destinatario válido para el informe." };

// Body de POST /reports/generate-draft: { from, to, audience, extraNotes }
export const validateDraftRequest = (body) => {
  if (!isPlainObject(body)) return { error: "El pedido enviado no es válido." };

  const period = parsePeriod(body.from, body.to);
  if (period.error) return period;

  const audience = parseAudience(body.audience);
  if (audience.error) return audience;

  const extraNotes = parseText(body.extraNotes, EXTRA_NOTES_MAX, "El texto de las notas adicionales");
  if (extraNotes.error) return extraNotes;

  return { data: { ...period.value, audience: audience.value, extraNotes: extraNotes.value } };
};

const INSTRUCTION_MAX = 2000;
const MESSAGE_MAX = 4000;
const MESSAGES_ACCEPTED = 100;
// Turnos anteriores que se le mandan a la IA: los últimos. El borrador actual ya refleja todo lo anterior
export const CHAT_HISTORY_MAX = 20;
export const CHAT_ROLES = ["user", "assistant"];

// Body de POST /reports/refine-draft:
// { from, to, audience, extraNotes, currentHtml, instruction, messages: [{ role: "user" | "assistant", content }] }
// messages es el historial del chat (sin el pedido nuevo, que va en instruction). Lo guarda el front:
// el borrador todavía no existe en la base, así que el servidor no guarda estado de la conversación.
// currentHtml es opcional: vacío (o "<p></p>", lo que deja el editor) significa que la IA tiene que redactar el informe
// desde cero siguiendo las instrucciones del chat
export const validateRefineRequest = (body) => {
  const base = validateDraftRequest(body);
  if (base.error) return base;

  const rawHtml = body.currentHtml ?? "";
  if (typeof rawHtml !== "string") return { error: "El borrador enviado no es válido." };
  if (rawHtml.length > CONTENT_MAX) {
    return { error: `El borrador no puede superar los ${CONTENT_MAX} caracteres.` };
  }
  const sanitized = sanitizeReportHtml(rawHtml);
  const currentHtml = hasVisibleText(sanitized) ? sanitized : "";

  const instruction = parseText(body.instruction, INSTRUCTION_MAX, "El mensaje");
  if (instruction.error) return instruction;
  if (!instruction.value) return { error: "Escribí qué querés cambiar o consultar del informe." };

  const rawMessages = body.messages ?? [];
  if (!Array.isArray(rawMessages) || rawMessages.length > MESSAGES_ACCEPTED) {
    return { error: "El historial del chat no es válido." };
  }
  const messages = [];
  for (const message of rawMessages) {
    if (!isPlainObject(message) || !CHAT_ROLES.includes(message.role) || typeof message.content !== "string") {
      return { error: "El historial del chat no es válido." };
    }
    const content = message.content.trim().slice(0, MESSAGE_MAX);
    if (content) messages.push({ role: message.role, content });
  }

  return {
    data: { ...base.data, currentHtml, instruction: instruction.value, messages: messages.slice(-CHAT_HISTORY_MAX) },
  };
};

// Body de POST /reports y PUT /reports/:reportId: { title, content, audience, periodFrom, periodTo, status }.
// Devuelve { error } o { data } listo para prisma.report.create / update (sin el acompañamiento)
export const validateReport = (body) => {
  if (!isPlainObject(body)) return { error: "El informe enviado no es válido." };

  const title = parseText(body.title, TITLE_MAX, "El título");
  if (title.error) return title;
  if (!title.value) return { error: "Indicá un título para el informe." };

  if (typeof body.content !== "string" || !body.content.trim()) {
    return { error: "El informe no puede estar vacío." };
  }
  if (body.content.length > CONTENT_MAX) {
    return { error: `El informe no puede superar los ${CONTENT_MAX} caracteres.` };
  }
  const content = sanitizeReportHtml(body.content);
  if (!hasVisibleText(content)) return { error: "El informe no puede estar vacío." };

  const audience = parseAudience(body.audience);
  if (audience.error) return audience;

  const period = parsePeriod(body.periodFrom, body.periodTo);
  if (period.error) return period;

  const status = body.status ?? "DRAFT";
  if (!REPORT_STATUSES.includes(status)) return { error: "El estado del informe no es válido." };

  return {
    data: {
      title: title.value,
      content,
      audience: audience.value,
      periodFrom: dateFromString(period.value.from),
      periodTo: dateFromString(period.value.to),
      status,
    },
  };
};

// Informe guardado con el formato del body, para combinarlo con un PUT parcial antes de validarlo
export const toReportInput = (report) => ({
  title: report.title,
  content: report.content,
  audience: report.audience,
  periodFrom: toDateOnly(report.periodFrom),
  periodTo: toDateOnly(report.periodTo),
  status: report.status,
});

export const reportSelect = {
  id: true,
  title: true,
  content: true,
  audience: true,
  periodFrom: true,
  periodTo: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  treatmentId: true,
  treatment: {
    select: {
      profileAT: { select: { id: true, user: { select: { name: true, lastName: true } } } },
    },
  },
};

export const toReportResponse = (report) => ({
  id: report.id,
  title: report.title,
  content: report.content,
  audience: report.audience,
  periodFrom: toDateOnly(report.periodFrom),
  periodTo: toDateOnly(report.periodTo),
  status: report.status,
  // Quién lo redactó: un ADMIN puede ver los informes de todos los A.T. de un paciente
  professional: {
    id: report.treatment.profileAT.id,
    name: report.treatment.profileAT.user.name,
    lastName: report.treatment.profileAT.user.lastName,
  },
  createdAt: report.createdAt.toISOString(),
  updatedAt: report.updatedAt.toISOString(),
});

// Validación y formato de los encuentros que registra el A.T. La forma es la que arma el modal de registro del front
// (components/AT/SessionFrom/SessionModal.jsx). Igual que con el plan, se revisa campo por campo y se guarda solo lo conocido.
//
// Los objetivos y el ámbito se validan contra el plan de trabajo guardado: el cliente manda los ids y el texto
// que queda en el historial sale del plan, no del body.
//
// La fecha y la hora llegan por separado ("YYYY-MM-DD" y "HH:MM") y son siempre hora de Argentina, la que carga el A.T.
// Se guardan juntas como un instante (startDate), igual que las actividades del calendario.

import { isPlainObject, parseText, parseDate, getPlanStages } from "./plan.service.js";
import { TIME_ZONE } from "./patient.service.js";

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const MINUTE_MS = 60 * 1000;

// Mismos límites que el modal del front
const DURATION_MIN = 5;
const DURATION_MAX = 480;
const LEVEL_MIN = 1;
const LEVEL_MAX = 5;
const NOTE_MAX = 200;
const OBSERVATIONS_MAX = 600;
// Las actividades del plan pueden tener hasta 600 caracteres; las que agrega el A.T. en el modal, hasta 80
const ACTIVITY_MAX = 600;
const ACTIVITIES_MAX = 40;

export const encounterSelect = {
  id: true,
  startDate: true,
  durationMinutes: true,
  stageId: true,
  stageName: true,
  activities: true,
  observations: true,
  calendarActivityId: true,
  createdAt: true,
  goals: {
    orderBy: { id: "asc" },
    select: { goalId: true, goalText: true, level: true, note: true },
  },
};

// ---------- Fecha y hora en Argentina ----------

const localPartsFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const localParts = (date) =>
  Object.fromEntries(localPartsFormat.formatToParts(date).map((part) => [part.type, part.value]));

// Fecha "YYYY-MM-DD" y hora "HH:MM" de un instante, en Argentina
export const toLocalDateTime = (date) => {
  const parts = localParts(date);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
};

// Instante que corresponde a una fecha y hora de Argentina. Se calcula el desfasaje de la zona en ese momento
// (hoy es UTC-3 todo el año, pero así no se rompe si vuelve el horario de verano)
export const fromLocalDateTime = (date, time) => {
  const asUtc = new Date(`${date}T${time}:00Z`);
  const parts = localParts(asUtc);
  const shown = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return new Date(asUtc.getTime() - (shown - asUtc.getTime()));
};

// "03/11/2026 a las 10:00", para los mensajes de error
export const formatLocalDateTime = (date) => {
  const local = toLocalDateTime(date);
  const [year, month, day] = local.date.split("-");
  return `${day}/${month}/${year} a las ${local.time}`;
};

export const encounterEndDate = (encounter) =>
  new Date(encounter.startDate.getTime() + encounter.durationMinutes * MINUTE_MS);

// Hay algún ámbito con objetivos para trabajar (lo mismo que pide el front para habilitar el registro)
export const planHasGoals = (planContent) => getPlanStages(planContent).some((stage) => stage.specificGoals.length > 0);

const parseActivities = (value) => {
  if (!Array.isArray(value)) return { error: "Las actividades deben ser una lista." };
  if (value.length > ACTIVITIES_MAX) {
    return { error: `No se pueden registrar más de ${ACTIVITIES_MAX} actividades por encuentro.` };
  }

  const activities = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== "string") return { error: "Hay una actividad que no es válida." };
    const trimmed = item.trim();
    if (trimmed.length > ACTIVITY_MAX) {
      return { error: `Cada actividad puede tener hasta ${ACTIVITY_MAX} caracteres.` };
    }
    // Se descartan vacías y repetidas (sin distinguir mayúsculas, como el modal)
    const key = trimmed.toLowerCase();
    if (trimmed && !seen.has(key)) {
      seen.add(key);
      activities.push(trimmed);
    }
  }

  if (activities.length === 0) return { error: "Seleccioná o agregá al menos una actividad." };
  return { value: activities };
};

// Objetivos trabajados: [{ goalId, level, note }]. Cada goalId tiene que ser un objetivo específico del ámbito elegido.
// Se devuelven en el orden del plan, con el texto que tiene el objetivo en el plan
const parseGoals = (value, stage) => {
  if (!Array.isArray(value) || value.length === 0) return { error: "Marcá al menos un objetivo trabajado." };
  if (value.length > stage.specificGoals.length) return { error: "Hay objetivos trabajados que no son válidos." };

  const byId = new Map();
  for (const item of value) {
    if (!isPlainObject(item) || typeof item.goalId !== "string") {
      return { error: "Hay un objetivo trabajado que no es válido." };
    }
    if (byId.has(item.goalId)) return { error: "Hay objetivos trabajados repetidos." };

    const planGoal = stage.specificGoals.find((goal) => goal.id === item.goalId);
    if (!planGoal) {
      return { error: "Uno de los objetivos ya no está en el plan de trabajo. Recargá la página e intentá nuevamente." };
    }

    if (!Number.isInteger(item.level) || item.level < LEVEL_MIN || item.level > LEVEL_MAX) {
      return { error: `El nivel de cada objetivo tiene que ser del ${LEVEL_MIN} al ${LEVEL_MAX}.` };
    }

    const note = parseText(item.note, NOTE_MAX, "La nota de un objetivo");
    if (note.error) return note;

    byId.set(item.goalId, { level: item.level, note: note.value || null });
  }

  const goals = stage.specificGoals
    .filter((goal) => byId.has(goal.id))
    .map((goal) => ({ goalId: goal.id, goalText: goal.text, ...byId.get(goal.id) }));
  return { value: goals };
};

// Devuelve { error } o { data } listo para prisma.encounter.create (con los objetivos aparte, en data.goals).
// No se registran encuentros que todavía no empezaron (now se recibe para poder probarlo)
export const validateEncounter = (body, planContent, now = new Date()) => {
  if (!isPlainObject(body)) return { error: "El encuentro enviado no es válido." };

  if (body.date === undefined || body.date === null || body.date === "") {
    return { error: "Indicá la fecha del encuentro." };
  }
  const date = parseDate(body.date, "La fecha del encuentro");
  if (date.error) return date;

  if (typeof body.time !== "string" || !body.time) return { error: "Indicá la hora de inicio del encuentro." };
  if (!TIME_REGEX.test(body.time)) return { error: "La hora del encuentro no es válida." };

  const startDate = fromLocalDateTime(date.value, body.time);
  if (startDate > now) return { error: "La fecha y hora del encuentro no pueden ser futuras." };

  if (!Number.isInteger(body.duration) || body.duration < DURATION_MIN || body.duration > DURATION_MAX) {
    return { error: `Ingresá una duración entre ${DURATION_MIN} y ${DURATION_MAX} minutos.` };
  }

  const stage = getPlanStages(planContent).find((item) => item.id === body.stageId);
  if (typeof body.stageId !== "string" || !stage || stage.specificGoals.length === 0) {
    return { error: "El ámbito elegido no es parte del plan de trabajo. Recargá la página e intentá nuevamente." };
  }

  const goals = parseGoals(body.goals, stage);
  if (goals.error) return goals;

  const activities = parseActivities(body.activities);
  if (activities.error) return activities;

  const observations = parseText(body.observations, OBSERVATIONS_MAX, "El texto de las observaciones");
  if (observations.error) return observations;

  return {
    data: {
      startDate,
      durationMinutes: body.duration,
      stageId: stage.id,
      stageName: typeof stage.name === "string" ? stage.name : "",
      activities: activities.value,
      observations: observations.value || null,
      goals: goals.value,
    },
  };
};

// Encuentro tal como lo usan las pestañas Encuentros y Evolución del front.
// date y time son la fecha y hora en Argentina (las que cargó el A.T.); startDate es el instante, como en el calendario
export const toEncounterResponse = (encounter) => ({
  id: encounter.id,
  ...toLocalDateTime(encounter.startDate),
  startDate: encounter.startDate.toISOString(),
  duration: encounter.durationMinutes,
  stageId: encounter.stageId,
  stageName: encounter.stageName,
  goalIds: encounter.goals.map((goal) => goal.goalId),
  goals: encounter.goals.map((goal) => ({
    goalId: goal.goalId,
    goalText: goal.goalText,
    level: goal.level,
    note: goal.note ?? "",
  })),
  activities: encounter.activities,
  observations: encounter.observations ?? "",
  calendarActivityId: encounter.calendarActivityId,
  createdAt: encounter.createdAt.toISOString(),
});

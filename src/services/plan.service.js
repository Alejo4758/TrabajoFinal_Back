// Validación del plan de trabajo. El plan se guarda como JSON (WorkPlan.content) con la forma que arma el
// formulario del front (utils/planModel.js). Acá se revisa campo por campo y se devuelve una copia solo con
// los campos conocidos: nada de lo que mande el cliente se guarda tal cual.
//
// Un borrador ("draft") puede estar incompleto. Un plan vigente ("active") tiene que cumplir las mismas
// reglas que el formulario exige antes de dejar guardarlo.

const STATUSES = ["draft", "active"];
const SETTINGS = ["home", "school", "community"];
const FREQUENCIES = ["monthly", "bimonthly", "quarterly", "semiannual", "tbd"];

const LIST_MAX_ITEMS = 40;
const LIST_ITEM_MAX = 600;
const STAGES_MAX = 10;
const RATIONALE_MIN = 30;
const RATIONALE_MAX = 1500;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const STAGE_ID_REGEX = /^[A-Za-z0-9_-]{1,40}$/;
// Admite los UUID que genera el front y los ids que se arman a partir del ámbito ("<id del ámbito>-g<posición>")
const GOAL_ID_REGEX = /^[A-Za-z0-9_-]{1,64}$/;

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// Texto opcional. Devuelve { value } ya recortado ("" si no vino) o { error }
const parseText = (value, max, label) => {
  if (value === undefined || value === null) return { value: "" };
  if (typeof value !== "string") return { error: `${label} no es válido.` };
  const trimmed = value.trim();
  if (trimmed.length > max) return { error: `${label} no puede superar los ${max} caracteres.` };
  return { value: trimmed };
};

// Lista de textos. Devuelve { value } sin elementos vacíos o { error }
const parseTextList = (value, label) => {
  if (value === undefined || value === null) return { value: [] };
  if (!Array.isArray(value)) return { error: `${label} debe ser una lista.` };
  if (value.length > LIST_MAX_ITEMS) {
    return { error: `${label} no puede tener más de ${LIST_MAX_ITEMS} elementos.` };
  }

  const items = [];
  for (const item of value) {
    if (typeof item !== "string") return { error: `${label} tiene un elemento que no es válido.` };
    const trimmed = item.trim();
    if (trimmed.length > LIST_ITEM_MAX) {
      return { error: `Cada elemento de ${label.toLowerCase()} puede tener hasta ${LIST_ITEM_MAX} caracteres.` };
    }
    if (trimmed) items.push(trimmed);
  }
  return { value: items };
};

// Fecha "YYYY-MM-DD" opcional ("" si no vino). Se compara ida y vuelta para rechazar fechas como 2026-02-31
const parseDate = (value, label) => {
  if (value === undefined || value === null || value === "") return { value: "" };
  if (typeof value !== "string" || !DATE_REGEX.test(value)) return { error: `${label} no es una fecha válida.` };
  const date = new Date(`${value}T00:00:00Z`);
  if (isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return { error: `${label} no es una fecha válida.` };
  }
  return { value };
};

// Objetivos específicos de un ámbito. Cada uno es { id, text }: el id lo genera el front y no cambia aunque se corrija el texto,
// porque es lo que referencian los encuentros. También se acepta un texto suelto (la forma anterior), al que se le arma el id
// con el ámbito y la posición, igual que hace el front al leer un plan viejo. Devuelve { value } sin objetivos vacíos o { error }
const parseGoalList = (value, stageId, label) => {
  if (value === undefined || value === null) return { value: [] };
  if (!Array.isArray(value)) return { error: `${label} debe ser una lista.` };
  if (value.length > LIST_MAX_ITEMS) {
    return { error: `${label} no puede tener más de ${LIST_MAX_ITEMS} elementos.` };
  }

  const goals = [];
  for (const item of value) {
    const isText = typeof item === "string";
    if (!isText && !isPlainObject(item)) return { error: `${label} tiene un elemento que no es válido.` };

    const text = isText ? item : item.text;
    const id = isText ? `${stageId}-g${goals.length + 1}` : item.id;
    if (typeof text !== "string" || typeof id !== "string" || !GOAL_ID_REGEX.test(id)) {
      return { error: `${label} tiene un elemento que no es válido.` };
    }

    const trimmed = text.trim();
    if (trimmed.length > LIST_ITEM_MAX) {
      return { error: `Cada elemento de ${label.toLowerCase()} puede tener hasta ${LIST_ITEM_MAX} caracteres.` };
    }
    if (trimmed) goals.push({ id, text: trimmed });
  }
  return { value: goals };
};

const parseStage = (stage, position) => {
  const label = `El ámbito ${position}`;
  if (!isPlainObject(stage)) return { error: `${label} no es válido.` };

  if (typeof stage.id !== "string" || !STAGE_ID_REGEX.test(stage.id)) return { error: `${label} no es válido.` };
  if (!SETTINGS.includes(stage.setting)) return { error: `${label} tiene una modalidad que no es válida.` };

  const name = parseText(stage.name, 80, `El nombre del ámbito ${position}`);
  if (name.error) return name;
  const period = parseText(stage.period, 80, `El período del ámbito ${position}`);
  if (period.error) return period;
  const frequency = parseText(stage.frequency, 80, `La frecuencia del ámbito ${position}`);
  if (frequency.error) return frequency;

  const specificGoals = parseGoalList(stage.specificGoals, stage.id, "Los objetivos específicos");
  if (specificGoals.error) return specificGoals;
  const activities = parseTextList(stage.activities, "Las actividades");
  if (activities.error) return activities;
  const strategies = parseTextList(stage.strategies, "Las estrategias");
  if (strategies.error) return strategies;

  return {
    value: {
      id: stage.id,
      name: name.value,
      setting: stage.setting,
      period: period.value,
      frequency: frequency.value,
      specificGoals: specificGoals.value,
      activities: activities.value,
      strategies: strategies.value,
    },
  };
};

// Reglas que solo se exigen a un plan vigente (las mismas de validatePlan en el front). Devuelve el error o null
const activePlanError = (plan) => {
  if (plan.settings.length === 0) return "Elegí al menos una modalidad de trabajo.";
  if (!plan.validFrom || !plan.validUntil) return "Indicá desde y hasta cuándo rige el plan.";
  if (plan.rationale.length < RATIONALE_MIN) {
    return `La fundamentación debe tener al menos ${RATIONALE_MIN} caracteres.`;
  }
  if (plan.generalGoals.length === 0) return "Agregá al menos un objetivo general.";
  if (plan.stages.length === 0) return "Agregá al menos un ámbito de trabajo.";
  for (const stage of plan.stages) {
    if (!stage.name) return "Todos los ámbitos deben tener un nombre.";
    if (stage.specificGoals.length === 0) return `Agregá al menos un objetivo específico en "${stage.name}".`;
    if (stage.activities.length === 0 && stage.strategies.length === 0) {
      return `Agregá al menos una actividad o una estrategia en "${stage.name}".`;
    }
  }
  if (plan.evaluation.criteria.length === 0) return "Agregá al menos un criterio de evaluación.";
  if (!plan.evaluation.reportsFrequency) return "Elegí cada cuánto se redactan los informes.";
  return null;
};

// Devuelve { error } o { data } con el plan listo para guardar
export const validatePlan = (body) => {
  if (!isPlainObject(body)) return { error: "El plan enviado no es válido." };

  if (!STATUSES.includes(body.status)) return { error: "El estado del plan no es válido." };

  const validFrom = parseDate(body.validFrom, "La fecha de inicio");
  if (validFrom.error) return validFrom;
  const validUntil = parseDate(body.validUntil, "La fecha de fin");
  if (validUntil.error) return validUntil;
  if (validFrom.value && validUntil.value && validUntil.value < validFrom.value) {
    return { error: "La fecha final no puede ser anterior a la inicial." };
  }

  const diagnosis = parseText(body.diagnosis, 200, "El diagnóstico");
  if (diagnosis.error) return diagnosis;
  const weeklyHours = parseText(body.weeklyHours, 120, "La carga horaria");
  if (weeklyHours.error) return weeklyHours;
  const rationale = parseText(body.rationale, RATIONALE_MAX, "La fundamentación");
  if (rationale.error) return rationale;
  const atRole = parseText(body.atRole, 800, "El rol del acompañante");
  if (atRole.error) return atRole;

  const rawSettings = body.settings ?? [];
  if (!Array.isArray(rawSettings) || rawSettings.some((setting) => !SETTINGS.includes(setting))) {
    return { error: "Las modalidades de trabajo no son válidas." };
  }
  const settings = [...new Set(rawSettings)];

  const generalGoals = parseTextList(body.generalGoals, "Los objetivos generales");
  if (generalGoals.error) return generalGoals;
  const areas = parseTextList(body.areas, "Las áreas de intervención");
  if (areas.error) return areas;
  const familyTeam = parseTextList(body.familyTeam, "El trabajo con la familia y el equipo");
  if (familyTeam.error) return familyTeam;

  const rawStages = body.stages ?? [];
  if (!Array.isArray(rawStages)) return { error: "Los ámbitos de trabajo no son válidos." };
  if (rawStages.length > STAGES_MAX) {
    return { error: `El plan no puede tener más de ${STAGES_MAX} ámbitos de trabajo.` };
  }
  const stages = [];
  for (const [index, rawStage] of rawStages.entries()) {
    const stage = parseStage(rawStage, index + 1);
    if (stage.error) return stage;
    stages.push(stage.value);
  }
  if (new Set(stages.map((stage) => stage.id)).size !== stages.length) {
    return { error: "Hay ámbitos de trabajo repetidos." };
  }
  // El id de un objetivo lo identifica en todo el plan (los encuentros lo guardan sin el ámbito): no se puede repetir
  const goalIds = stages.flatMap((stage) => stage.specificGoals.map((goal) => goal.id));
  if (new Set(goalIds).size !== goalIds.length) {
    return { error: "Hay objetivos específicos repetidos." };
  }

  const rawEvaluation = body.evaluation ?? {};
  if (!isPlainObject(rawEvaluation)) return { error: "La evaluación del plan no es válida." };
  const criteria = parseTextList(rawEvaluation.criteria, "Los criterios de evaluación");
  if (criteria.error) return criteria;
  const reportsFrequency = rawEvaluation.reportsFrequency ?? "";
  if (reportsFrequency !== "" && !FREQUENCIES.includes(reportsFrequency)) {
    return { error: "La frecuencia de los informes no es válida." };
  }
  const evaluationNotes = parseText(rawEvaluation.notes, 600, "Las observaciones sobre la evaluación");
  if (evaluationNotes.error) return evaluationNotes;

  const data = {
    status: body.status,
    validFrom: validFrom.value,
    validUntil: validUntil.value,
    diagnosis: diagnosis.value,
    settings,
    weeklyHours: weeklyHours.value,
    rationale: rationale.value,
    generalGoals: generalGoals.value,
    areas: areas.value,
    stages,
    familyTeam: familyTeam.value,
    evaluation: {
      criteria: criteria.value,
      reportsFrequency,
      notes: evaluationNotes.value,
    },
    atRole: atRole.value,
  };

  if (data.status === "active") {
    const error = activePlanError(data);
    if (error) return { error };
  }

  return { data };
};

// Plan tal como lo espera el front: el contenido guardado más su id y la fecha del último cambio
export const toPlanResponse = (workPlan) =>
  workPlan ? { ...workPlan.content, id: workPlan.id, updatedAt: workPlan.updatedAt.toISOString() } : null;

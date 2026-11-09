import { normalizeName } from "./catalogMatch.service.js";

// Datos del perfil profesional del A.T. que el registro no pide y que el A.T. completa después desde "Mi perfil":
// género, estudios, zonas de trabajo, especialidades, obras sociales, experiencia laboral y disponibilidad horaria.
// Se usan para editarlos (GET y PUT /at/me/profile) y para avisarle en la barra de navegación si le falta algo.

// Opciones de género. El front las recibe junto con el perfil, así hay una sola lista
export const GENRES = ["Femenino", "Masculino", "No binario", "Otro", "Prefiero no decirlo"];

const STUDIES_MAX = 200;
const LOCALITIES_MAX = 30;
const EXPERIENCES_MAX = 20;
const EXPERIENCE_TITLE_MAX = 120;
const EXPERIENCE_DESCRIPTION_MAX = 1000;
// Las experiencias se cargan por mes: "AAAA-MM"
const MONTH_REGEX = /^(\d{4})-(0[1-9]|1[0-2])$/;

// Disponibilidad horaria: franjas por día de la semana (0 = domingo ... 6 = sábado), con horas "HH:MM"
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const RANGES_PER_DAY_MAX = 3;
const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

// Sugerencias de especialidades u obras sociales que no están en la lista (las revisa un administrador)
const SUGGESTION_NAME_MIN = 2;
const SUGGESTION_NAME_MAX = 80;
const SUGGESTIONS_MAX = 5;
// Cuántos días se le sigue mostrando al A.T. el resultado de una sugerencia revisada (aprobada o rechazada)
const REVIEWED_VISIBLE_DAYS = 30;

// normalizeName compara nombres sin mayúsculas, tildes, espacios ni signos ("Federada Salud" = "FederadaSalud").
// Se reexporta desde acá porque los controladores lo importan de este servicio
export { normalizeName };

// Para saber si hay localidades, experiencias y obras sociales alcanza con contarlas: no hace falta traerlas.
// Se agrega al include de profileAT: include: { profileAT: { include: profileATCompletenessInclude } }.
// catalogSuggestions cuenta solo las obras sociales sugeridas que esperan revisión (ver getMissingProfileATFields)
export const profileATCompletenessInclude = {
  _count: {
    select: {
      localities: true,
      experiences: true,
      obrasSociales: true,
      catalogSuggestions: { where: { type: "OBRA_SOCIAL", status: "PENDING" } },
    },
  },
};

// Campos que faltan completar, en el orden en que se muestran. Recibe el perfil con el _count de arriba.
// Las especialidades no se exigen. Una obra social sugerida que espera revisión cuenta como cargada: completar el perfil
// no depende del A.T. sino del administrador. Si no hay perfil (no es A.T.), no falta nada
export const getMissingProfileATFields = (profileAT) => {
  if (!profileAT) return [];

  const missing = [];
  if (!profileAT.genre?.trim()) missing.push("genre");
  if (!profileAT.studies?.trim()) missing.push("studies");
  if (!profileAT._count?.localities) missing.push("localities");
  if (!profileAT._count?.experiences) missing.push("experiences");
  if (!profileAT._count?.obrasSociales && !profileAT._count?.catalogSuggestions) missing.push("obrasSociales");
  return missing;
};

// Lo que se lee del perfil para editarlo
export const profileATEditSelect = {
  id: true,
  genre: true,
  studies: true,
  localities: { select: { locality: { select: { id: true, name: true, departmentName: true, provinceName: true } } } },
  especialities: { select: { especialityId: true } },
  obrasSociales: { select: { obraSocialId: true } },
  experiences: {
    orderBy: { startDate: "desc" },
    select: { id: true, title: true, startDate: true, finishDate: true, description: true },
  },
  availability: {
    orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
    select: { dayOfWeek: true, startTime: true, endTime: true },
  },
  // Pendientes (como mucho 5 por catálogo) y las revisadas más recientes, para mostrarle al A.T. cómo se resolvieron
  catalogSuggestions: {
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, type: true, name: true, status: true, reviewNote: true, createdAt: true, reviewedAt: true },
  },
};

// Sugerencias tal como las usa el formulario, por catálogo: las pendientes (se pueden retirar) y las revisadas hace poco.
// approved trae la nota de la revisión: con qué nombre se agregó, o con qué nombre ya estaba en la lista
const toSuggestionsResponse = (suggestions) => {
  const since = Date.now() - REVIEWED_VISIBLE_DAYS * 24 * 60 * 60 * 1000;
  const recent = (type, status) =>
    suggestions
      .filter((item) => item.type === type && item.status === status && item.reviewedAt?.getTime() >= since)
      .map((item) => ({ name: item.name, reviewNote: item.reviewNote ?? "" }));
  const group = (type) => ({
    pending: suggestions.filter((item) => item.type === type && item.status === "PENDING").map((item) => item.name),
    approved: recent(type, "APPROVED"),
    rejected: recent(type, "REJECTED"),
  });

  return { especialities: group("ESPECIALITY"), obrasSociales: group("OBRA_SOCIAL") };
};

// Fecha guardada -> "AAAA-MM". Se guardan a las 00:00 UTC del día 1, así que se toma la parte en UTC
const toMonth = (date) => (date ? date.toISOString().slice(0, 7) : null);

const currentMonth = () => new Date().toISOString().slice(0, 7);

// Perfil tal como lo usa el formulario del front (lee lo que trae profileATEditSelect)
export const toProfileATResponse = (profile) => {
  const missingProfileFields = getMissingProfileATFields({
    genre: profile.genre,
    studies: profile.studies,
    _count: {
      localities: profile.localities.length,
      experiences: profile.experiences.length,
      obrasSociales: profile.obrasSociales.length,
      catalogSuggestions: profile.catalogSuggestions.filter((item) => item.type === "OBRA_SOCIAL" && item.status === "PENDING").length,
    },
  });

  return {
    genre: profile.genre ?? "",
    studies: profile.studies ?? "",
    localities: profile.localities
      .map((item) => item.locality)
      .sort((a, b) => a.name.localeCompare(b.name, "es")),
    especialityIds: profile.especialities.map((item) => item.especialityId),
    obraSocialIds: profile.obrasSociales.map((item) => item.obraSocialId),
    experiences: profile.experiences.map((experience) => ({
      id: experience.id,
      title: experience.title,
      startDate: toMonth(experience.startDate),
      finishDate: toMonth(experience.finishDate),
      description: experience.description ?? "",
    })),
    availability: profile.availability,
    suggestions: toSuggestionsResponse(profile.catalogSuggestions),
    isProfileIncomplete: missingProfileFields.length > 0,
    missingProfileFields,
  };
};

// Texto opcional: "" o null se guardan como null
const parseOptionalText = (value, max, label) => {
  if (value === undefined || value === null) return { value: null };
  if (typeof value !== "string") return { error: `${label} no es válido.` };
  const trimmed = value.trim();
  if (trimmed.length > max) return { error: `${label} no puede superar los ${max} caracteres.` };
  return { value: trimmed || null };
};

// Lista de ids (enteros positivos) sin repetidos
const parseIdList = (value, label, max) => {
  if (value === undefined || value === null) return { value: [] };
  if (!Array.isArray(value)) return { error: `${label} debe ser una lista.` };
  if (value.length > max) return { error: `${label} no puede tener más de ${max} elementos.` };
  if (!value.every((id) => Number.isInteger(id) && id > 0)) return { error: `${label} tiene un elemento que no es válido.` };
  return { value: [...new Set(value)] };
};

// Mes "AAAA-MM" -> Date (día 1, 00:00 UTC). Devuelve { value } (null si no vino y no es obligatorio) o { error }
const parseMonth = (value, label, required) => {
  if (value === undefined || value === null || value === "") {
    return required ? { error: `${label} es obligatoria.` } : { value: null };
  }
  if (typeof value !== "string" || !MONTH_REGEX.test(value)) return { error: `${label} no es válida.` };
  if (value > currentMonth()) return { error: `${label} no puede ser posterior al mes actual.` };
  return { value: new Date(`${value}-01T00:00:00Z`), month: value };
};

const parseExperience = (experience, position) => {
  const label = `La experiencia ${position}`;
  if (experience === null || typeof experience !== "object" || Array.isArray(experience)) return { error: `${label} no es válida.` };

  if (typeof experience.title !== "string" || !experience.title.trim()) {
    return { error: `Indicá el puesto o el lugar de la experiencia ${position}.` };
  }
  const title = experience.title.trim();
  if (title.length > EXPERIENCE_TITLE_MAX) {
    return { error: `El título de la experiencia ${position} no puede superar los ${EXPERIENCE_TITLE_MAX} caracteres.` };
  }

  const start = parseMonth(experience.startDate, `La fecha de inicio de la experiencia ${position}`, true);
  if (start.error) return start;
  const finish = parseMonth(experience.finishDate, `La fecha de fin de la experiencia ${position}`, false);
  if (finish.error) return finish;
  if (finish.month && finish.month < start.month) {
    return { error: `En la experiencia ${position}, la fecha de fin no puede ser anterior a la de inicio.` };
  }

  const description = parseOptionalText(experience.description, EXPERIENCE_DESCRIPTION_MAX, `La descripción de la experiencia ${position}`);
  if (description.error) return description;

  return { value: { title, startDate: start.value, finishDate: finish.value, description: description.value } };
};

// Disponibilidad horaria: [{ dayOfWeek, startTime, endTime }]. Hasta 3 franjas por día, sin superponerse.
// Si no vino, devuelve { value: undefined } y no se toca la que está guardada (así un front anterior no la borra).
// Devuelve { value } ordenada por día y hora, o { error }
const parseAvailability = (value) => {
  if (value === undefined) return { value: undefined };
  if (!Array.isArray(value)) return { error: "La disponibilidad horaria debe ser una lista." };
  if (value.length > RANGES_PER_DAY_MAX * 7) return { error: "La disponibilidad horaria tiene demasiadas franjas." };

  const ranges = [];
  for (const item of value) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return { error: "La disponibilidad horaria no es válida." };
    const { dayOfWeek, startTime, endTime } = item;
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) return { error: "Un día de la disponibilidad horaria no es válido." };
    const day = DAY_NAMES[dayOfWeek];
    if (typeof startTime !== "string" || !TIME_REGEX.test(startTime) || typeof endTime !== "string" || !TIME_REGEX.test(endTime)) {
      return { error: `Un horario del ${day} no es válido.` };
    }
    // "HH:MM" se puede comparar como texto
    if (endTime <= startTime) return { error: `En el ${day}, la hora de fin tiene que ser posterior a la de inicio.` };
    ranges.push({ dayOfWeek, startTime, endTime });
  }

  ranges.sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime));

  for (let index = 0; index < ranges.length; index++) {
    const range = ranges[index];
    const sameDay = ranges.filter((item) => item.dayOfWeek === range.dayOfWeek);
    if (sameDay.length > RANGES_PER_DAY_MAX) {
      return { error: `Podés cargar hasta ${RANGES_PER_DAY_MAX} franjas por día (el ${DAY_NAMES[range.dayOfWeek]} tiene ${sameDay.length}).` };
    }
    const previous = ranges[index - 1];
    if (previous && previous.dayOfWeek === range.dayOfWeek && range.startTime < previous.endTime) {
      return { error: `Los horarios del ${DAY_NAMES[range.dayOfWeek]} se superponen.` };
    }
  }

  return { value: ranges };
};

// Nombre de una sugerencia (sin validar contra el catálogo: eso lo hace el controlador). Devuelve { value } o { error }
export const parseSuggestionName = (value, label = "La sugerencia") => {
  if (typeof value !== "string") return { error: `${label} no es válida.` };
  const name = value.trim().replace(/\s+/g, " ");
  // Se cuentan letras y números: "--" no es un nombre
  if (normalizeName(name).length < SUGGESTION_NAME_MIN) return { error: `${label} tiene que tener al menos ${SUGGESTION_NAME_MIN} letras o números.` };
  if (name.length > SUGGESTION_NAME_MAX) return { error: `${label} no puede superar los ${SUGGESTION_NAME_MAX} caracteres.` };
  return { value: name };
};

// Lista de nombres sugeridos, sin repetidos (sin importar mayúsculas ni tildes)
const parseSuggestionList = (value, label) => {
  if (value === undefined || value === null) return { value: [] };
  if (!Array.isArray(value)) return { error: `${label} debe ser una lista.` };

  const names = [];
  const seen = new Set();
  for (const item of value) {
    const name = parseSuggestionName(item, `Cada nombre en ${label.toLowerCase()}`);
    if (name.error) return name;
    const key = normalizeName(name.value);
    if (!seen.has(key)) {
      seen.add(key);
      names.push(name.value);
    }
  }
  if (names.length > SUGGESTIONS_MAX) return { error: `Podés tener hasta ${SUGGESTIONS_MAX} ${label.toLowerCase()} esperando revisión.` };
  return { value: names };
};

// Valida lo que manda el formulario. currentGenre es el género guardado: se acepta aunque no esté en GENRES,
// para que un valor cargado antes de esta lista no impida guardar el resto del perfil.
// Devuelve { error } o { data } listo para guardar. Que los ids existan lo verifica el controlador contra la base
export const validateProfileAT = (body, currentGenre) => {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return { error: "Los datos enviados no son válidos." };

  const genre = parseOptionalText(body.genre, 40, "El género");
  if (genre.error) return genre;
  if (genre.value && !GENRES.includes(genre.value) && genre.value !== currentGenre) {
    return { error: "El género no es válido." };
  }

  const studies = parseOptionalText(body.studies, STUDIES_MAX, "Los estudios");
  if (studies.error) return studies;

  const localityIds = parseIdList(body.localityIds, "Las zonas de trabajo", LOCALITIES_MAX);
  if (localityIds.error) return localityIds;
  const especialityIds = parseIdList(body.especialityIds, "Las especialidades", 50);
  if (especialityIds.error) return especialityIds;
  const obraSocialIds = parseIdList(body.obraSocialIds, "Las obras sociales", 50);
  if (obraSocialIds.error) return obraSocialIds;

  // Especialidades y obras sociales que no están en la lista: quedan esperando que un administrador las revise
  const suggestedEspecialities = parseSuggestionList(body.suggestedEspecialities, "Especialidades sugeridas");
  if (suggestedEspecialities.error) return suggestedEspecialities;
  const suggestedObrasSociales = parseSuggestionList(body.suggestedObrasSociales, "Obras sociales sugeridas");
  if (suggestedObrasSociales.error) return suggestedObrasSociales;

  const availability = parseAvailability(body.availability);
  if (availability.error) return availability;

  const rawExperiences = body.experiences ?? [];
  if (!Array.isArray(rawExperiences)) return { error: "La experiencia laboral debe ser una lista." };
  if (rawExperiences.length > EXPERIENCES_MAX) {
    return { error: `No se pueden cargar más de ${EXPERIENCES_MAX} experiencias.` };
  }
  const experiences = [];
  for (const [index, rawExperience] of rawExperiences.entries()) {
    const experience = parseExperience(rawExperience, index + 1);
    if (experience.error) return experience;
    experiences.push(experience.value);
  }

  return {
    data: {
      genre: genre.value,
      studies: studies.value,
      localityIds: localityIds.value,
      especialityIds: especialityIds.value,
      obraSocialIds: obraSocialIds.value,
      suggestedEspecialities: suggestedEspecialities.value,
      suggestedObrasSociales: suggestedObrasSociales.value,
      // undefined = no vino en el pedido: se deja la guardada
      availability: availability.value,
      experiences,
    },
  };
};

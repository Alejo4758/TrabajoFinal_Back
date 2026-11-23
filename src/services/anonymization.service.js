// Anonimización de los datos que se mandan a la IA y rehidratación de lo que devuelve.
//
// Flujo (lo orquesta src/services/reportDraft.service.js):
//   1. buildIdentity() junta los datos reales de identidad desde PostgreSQL. NUNCA salen del servidor.
//   2. createRedactor() arma, a partir de esa identidad, las reglas que reemplazan en los textos libres
//      (observaciones, notas, actividades, notas extra del A.T., textos del plan) cada mención del paciente,
//      su tutor y el A.T. por marcadores {{...}}, y borra emails, teléfonos y números de documento sueltos.
//   3. A la IA solo le llegan esos textos ya redactados, la EDAD (no la fecha de nacimiento) y la información clínica.
//   4. rehydrateReport() reemplaza los marcadores del HTML que devolvió la IA por los datos reales
//      (o "No registrado" si falta alguno), escapados como HTML, antes de mandarle el borrador al front.
//
// Criterio: ante la duda se redacta de más. Que una palabra común coincida con un nombre ("Luz", "Rosa") y quede
// reemplazada es un costo aceptable: el A.T. revisa el borrador antes de guardarlo. Que un nombre llegue a la IA, no.

import { fullName, toDateOnly, todayString } from "./patient.service.js";

export const MARKERS = {
  PACIENTE_NOMBRE: "{{PACIENTE_NOMBRE}}",
  PACIENTE_DNI: "{{PACIENTE_DNI}}",
  PACIENTE_DOMICILIO: "{{PACIENTE_DOMICILIO}}",
  PACIENTE_EDAD: "{{PACIENTE_EDAD}}",
  PACIENTE_OBRA_SOCIAL: "{{PACIENTE_OBRA_SOCIAL}}",
  TUTOR_NOMBRE: "{{TUTOR_NOMBRE}}",
  AT_NOMBRE: "{{AT_NOMBRE}}",
};

export const NOT_REGISTERED = "No registrado";

// Lo que se borra sin marcador: no hace falta en ningún informe y no se rehidrata
const REDACTED = {
  DOCUMENT: "[documento omitido]",
  EMAIL: "[email omitido]",
  PHONE: "[teléfono omitido]",
};

// Un marcador ya puesto o un dato ya omitido no se vuelve a tocar (ver replaceOutsideMarkers)
const PROTECTED_SEGMENT = /(\{\{[A-Z_]+\}\}|\[(?:documento|email|teléfono) omitido\])/u;
// Marcadores en la salida de la IA. Se tolera algún espacio adentro ("{{ PACIENTE_NOMBRE }}")
const MARKER_IN_OUTPUT = /\{\{\s*([A-Z_]+)\s*\}\}/g;
// El mismo marcador repetido y separado solo por espacios ("{{PACIENTE_NOMBRE}} {{PACIENTE_NOMBRE}}")
const REPEATED_MARKER = /(\{\{[A-Z_]+\}\})(?:\s+\1)+/g;

// Partículas de los nombres que no se redactan solas (sí dentro del nombre completo)
const NAME_STOPWORDS = new Set(["de", "del", "la", "las", "los", "el", "y", "da", "di", "do", "dos", "van", "von"]);
const MIN_TOKEN_LENGTH = 3;

const ACCENT_VARIANTS = {
  a: "aáàäâã",
  e: "eéèëê",
  i: "iíìïî",
  o: "oóòöôõ",
  u: "uúùüû",
  n: "nñ",
  c: "cç",
};

const SOFT_ENTITY_VALUES = { "&#39;": "'", "&#x27;": "'", "&apos;": "'", "&quot;": '"', "&#34;": '"', "&nbsp;": " ", "&#160;": " " };
const SOFT_ENTITIES = /&(?:#39|#x27|apos|quot|#34|nbsp|#160);/gi;

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const foldAccents = (text) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const escapeHtml = (text) =>
  String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// Regex que encuentra el valor como palabra (o frase) completa, sin distinguir mayúsculas ni tildes:
// "Pérez" encuentra "perez", "PÉREZ" y "Perez", pero no "Perezoso".
// Los límites de palabra se hacen con lookarounds Unicode porque \b de JS no reconoce letras con tilde
const looseWordRegex = (value) => {
  const folded = foldAccents(value.trim().replace(/\s+/g, " "));
  const body = [...folded]
    .map((char) => {
      if (char === " ") return "\\s+";
      const variants = ACCENT_VARIANTS[char];
      return variants ? `[${variants}]` : escapeRegex(char);
    })
    .join("");
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "giu");
};

// Regex de un número de documento conocido, con o sin puntos/espacios entre dígitos ("30123456" o "30.123.456")
const documentRegex = (documentNumber) => {
  const digits = String(documentNumber).replace(/\D/g, "");
  if (digits.length < 6) return null;
  return new RegExp(`(?<!\\d)${digits.split("").join("[.\\s-]?")}(?!\\d)`, "g");
};

// Emails: van ANTES que los nombres. Si no, "ana@mail.com" quedaría "{{PACIENTE_NOMBRE}}@mail.com" y el resto del
// email ya no se reconocería como tal
const EMAIL_RULE = { pattern: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gu, replacement: REDACTED.EMAIL };

// Patrones genéricos, para lo que el A.T. haya escrito y no coincida con un dato conocido
const GENERIC_RULES = [
  // CUIT/CUIL: 20-12345678-9
  { pattern: /(?<!\d)\d{2}-?\d{8}-?\d(?!\d)/g, replacement: REDACTED.DOCUMENT },
  // DNI: 7 u 8 dígitos, con o sin puntos (12.345.678)
  { pattern: /(?<![\d.])\d{1,2}\.?\d{3}\.?\d{3}(?![\d.])/g, replacement: REDACTED.DOCUMENT },
  // Teléfonos: 8 o más dígitos con separadores opcionales, con o sin +54 / 0 / 15 (sin tomar fechas "2026-11-01")
  { pattern: /(?<!\d)(?!\d{4}-\d{2}-\d{2}(?!\d))\+?\d(?:[\s()-]*\d){7,}(?!\d)/g, replacement: REDACTED.PHONE },
];

// Aplica el reemplazo solo fuera de los marcadores y datos ya omitidos, para que una regla posterior
// (por ejemplo un apellido "Nombre") no rompa un marcador que puso una regla anterior
const replaceOutsideMarkers = (text, pattern, replacement) =>
  text
    .split(PROTECTED_SEGMENT)
    .map((segment, index) => (index % 2 === 1 ? segment : segment.replace(pattern, replacement)))
    .join("");

const nameTokens = (person) =>
  [person?.name, person?.lastName]
    .filter((part) => typeof part === "string")
    .flatMap((part) => part.split(/[\s-]+/))
    .map((token) => token.trim())
    .filter((token) => token.length >= MIN_TOKEN_LENGTH && !NAME_STOPWORDS.has(foldAccents(token)));

// Edad en años cumplidos a la fecha de referencia ("YYYY-MM-DD", por defecto hoy en Argentina)
export const calculateAge = (dateOfBirth, reference = todayString()) => {
  const birth = toDateOnly(dateOfBirth);
  if (!birth) return null;

  const [birthYear, birthMonth, birthDay] = birth.split("-").map(Number);
  const [year, month, day] = reference.split("-").map(Number);
  let age = year - birthYear;
  if (month < birthMonth || (month === birthMonth && day < birthDay)) age -= 1;
  return age >= 0 ? age : null;
};

// Identidad real del informe. Se arma en el servidor y nunca se manda a la IA: solo la usan
// createRedactor (para saber qué borrar) y rehydrateReport (para completar los marcadores).
//   - patient: { name, lastName, dateOfBirth, relationship }
//   - tutor:   { name, lastName, email, documentNumber } (titular de la cuenta)
//   - atUser:  { name, lastName, email, documentNumber }
//   - linkRequest: solicitud aceptada que dio origen al acompañamiento ({ locality, socialPrograms }) o null
// El paciente no tiene DNI propio: si es el titular de la cuenta (SELF) su DNI es el del usuario.
// Tampoco tiene domicilio: lo más cercano es la localidad que la familia indicó en la solicitud.
export const buildIdentity = ({ patient, tutor, atUser, linkRequest, reference }) => {
  const isSelf = patient.relationship === "SELF";
  const socialPrograms = (linkRequest?.socialPrograms ?? []).filter((item) => typeof item === "string" && item.trim());

  return {
    patient,
    tutor: isSelf ? null : tutor,
    atUser,
    hasTutor: !isSelf,
    // Documentos que no son del paciente: se borran, no se rehidratan
    otherDocuments: [isSelf ? null : tutor?.documentNumber, atUser?.documentNumber].filter(Boolean),
    values: {
      PACIENTE_NOMBRE: fullName(patient) || null,
      PACIENTE_DNI: isSelf ? tutor?.documentNumber || null : null,
      PACIENTE_DOMICILIO: linkRequest?.locality?.trim() || null,
      PACIENTE_EDAD: calculateAge(patient.dateOfBirth, reference),
      PACIENTE_OBRA_SOCIAL: socialPrograms.length > 0 ? socialPrograms.join(", ") : null,
      TUTOR_NOMBRE: isSelf ? null : fullName(tutor) || null,
      AT_NOMBRE: fullName(atUser) || null,
    },
  };
};

// Devuelve una función redact(texto) con las reglas armadas a partir de la identidad. El orden importa:
//   1. emails (conocidos o no), antes de que un nombre los parta
//   2. nombres completos (los más largos primero, para que "Juan Pérez" gane sobre "Juan")
//   3. cada nombre y apellido suelto. Si el tutor comparte apellido con el paciente, gana el paciente
//   4. documentos conocidos
//   5. localidad (domicilio) y obras sociales
//   6. patrones genéricos de documento y teléfono
// Al final, marcadores iguales seguidos se juntan en uno: "Juan Pérez" (sin el segundo nombre) queda un solo marcador
export const createRedactor = (identity) => {
  const rules = [EMAIL_RULE];
  const people = [
    { person: identity.patient, marker: MARKERS.PACIENTE_NOMBRE },
    { person: identity.tutor, marker: MARKERS.TUTOR_NOMBRE },
    { person: identity.atUser, marker: MARKERS.AT_NOMBRE },
  ].filter((entry) => entry.person);

  const fullNames = people
    .map(({ person, marker }) => ({ value: fullName(person), marker }))
    .filter(({ value }) => value.length >= MIN_TOKEN_LENGTH)
    .sort((a, b) => b.value.length - a.value.length);
  for (const { value, marker } of fullNames) {
    rules.push({ pattern: looseWordRegex(value), replacement: marker });
  }

  const seenTokens = new Set();
  for (const { person, marker } of people) {
    for (const token of nameTokens(person)) {
      const key = foldAccents(token);
      if (seenTokens.has(key)) continue;
      seenTokens.add(key);
      rules.push({ pattern: looseWordRegex(token), replacement: marker });
    }
  }

  const patientDocument = documentRegex(identity.values.PACIENTE_DNI ?? "");
  if (patientDocument) rules.push({ pattern: patientDocument, replacement: MARKERS.PACIENTE_DNI });
  for (const documentNumber of identity.otherDocuments) {
    const pattern = documentRegex(documentNumber);
    if (pattern) rules.push({ pattern, replacement: REDACTED.DOCUMENT });
  }

  if (identity.values.PACIENTE_DOMICILIO && identity.values.PACIENTE_DOMICILIO.length >= MIN_TOKEN_LENGTH) {
    rules.push({ pattern: looseWordRegex(identity.values.PACIENTE_DOMICILIO), replacement: MARKERS.PACIENTE_DOMICILIO });
  }
  for (const program of (identity.values.PACIENTE_OBRA_SOCIAL ?? "").split(", ")) {
    if (program.trim().length >= MIN_TOKEN_LENGTH) {
      rules.push({ pattern: looseWordRegex(program), replacement: MARKERS.PACIENTE_OBRA_SOCIAL });
    }
  }

  rules.push(...GENERIC_RULES);

  return (text) => {
    if (typeof text !== "string" || !text) return text;
    // NFC: así un texto con tildes "descompuestas" (e + ´) se compara igual que uno normal.
    // Entidades HTML: un borrador rehidratado trae los nombres escapados ("O&#39;Connor", "Juan&nbsp;Pérez") y así no
    // coincidirían. Se decodifican solo las que no cambian la estructura del HTML (no &lt; &gt; &amp;)
    const normalized = text.normalize("NFC").replace(SOFT_ENTITIES, (entity) => SOFT_ENTITY_VALUES[entity.toLowerCase()]);
    const redacted = rules.reduce(
      (current, { pattern, replacement }) => replaceOutsideMarkers(current, pattern, replacement),
      normalized
    );
    return redacted.replace(REPEATED_MARKER, "$1");
  };
};

// Aplica redact a todos los textos de un valor (objeto, lista o texto suelto). Lo demás se devuelve igual
export const redactDeep = (value, redact) => {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, redact));
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactDeep(item, redact)]));
  }
  return value;
};

// Marcadores (sin llaves) que aparecen en un texto, sin repetir
export const findMarkers = (text) => [...new Set([...String(text).matchAll(MARKER_IN_OUTPUT)].map((match) => match[1]))];

// Reemplaza los marcadores del HTML que devolvió la IA por los datos reales.
//   - Los valores se escapan como HTML: un nombre como "<b>Ana</b>" no puede inyectar marcado en el informe.
//   - Si falta el dato se pone "No registrado".
//   - Un marcador que no está permitido para el destinatario (allowedMarkers) no se completa aunque la IA lo haya usado:
//     por ejemplo, el DNI o el domicilio en un informe para la escuela. Queda una marca visible para que el A.T. la vea.
//   - Un marcador desconocido (que la IA inventó) se trata como dato faltante.
const rehydrate = (text, identity, allowedMarkers, format) => {
  const allowed = new Set(allowedMarkers);
  const age = identity.values.PACIENTE_EDAD;
  const values = {
    ...identity.values,
    PACIENTE_EDAD: age === null || age === undefined ? null : `${age} ${age === 1 ? "año" : "años"}`,
  };

  return String(text).replace(MARKER_IN_OUTPUT, (match, key) => {
    if (!(key in MARKERS)) return NOT_REGISTERED;
    if (!allowed.has(key)) return "[dato omitido para este destinatario]";
    return format(values[key] ?? NOT_REGISTERED);
  });
};

export const rehydrateReport = (html, identity, allowedMarkers = Object.keys(MARKERS)) =>
  rehydrate(html, identity, allowedMarkers, escapeHtml);

// Igual que rehydrateReport pero para texto plano (las respuestas del chat): no escapa HTML.
// El front tiene que mostrarlo como texto, nunca como HTML
export const rehydrateText = (text, identity, allowedMarkers = Object.keys(MARKERS)) =>
  rehydrate(text, identity, allowedMarkers, String);

// Hay datos que se borraron sin marcador ("[documento omitido]", etc.): la IA no los conoce y no los puede devolver
export const hasRedactedData = (text) => /\[(?:documento|email|teléfono) omitido\]/u.test(String(text));

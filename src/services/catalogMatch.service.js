// Comparación de nombres de especialidades y obras sociales, para no cargar dos veces la misma con otra escritura.
// El front tiene una copia de estas reglas en src/utils/catalogMatch.js: si se cambian acá, hay que cambiarlas allá

// Clave para saber si dos nombres son el mismo: sin mayúsculas, tildes, espacios ni signos.
// "Federada Salud" = "FederadaSalud" = "federada-salud"; "Médife" = "MEDIFE"
export const normalizeName = (name) =>
  name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Palabras tan comunes en estos nombres que compartirlas no indica que sean la misma
const COMMON_WORDS = new Set([
  "obra", "social", "sociales", "salud", "plan", "planes", "medicina", "medica", "medical", "prepaga", "seguro", "seguros",
  "mutual", "asociacion", "servicio", "servicios", "integral", "provincial", "nacional", "personal", "trastorno", "trastornos",
  "para", "con", "del", "las", "los", "por", "una", "uno",
]);

// Desde 3 letras, para que cuenten siglas como "TEA"
const significantWords = (name) =>
  name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !COMMON_WORDS.has(word));

// Misma palabra, o dos palabras largas con la misma raíz: "autismo" y "autista"
const sameWord = (a, b) => a === b || (a.length >= 5 && b.length >= 5 && a.slice(0, 5) === b.slice(0, 5));

// Cantidad mínima de cambios de letras para pasar de a a b. Corta apenas supera max (no hace falta el valor exacto)
const editDistance = (a, b, max) => {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, current[j]);
    }
    if (rowMin > max) return max + 1;
    previous = current;
  }
  return previous[b.length];
};

// Qué tan parecidos son dos nombres (0 = nada). No se usa para nombres iguales: esos ya son el mismo (normalizeName)
const similarity = (name, other) => {
  const a = normalizeName(name);
  const b = normalizeName(other);
  if (a.length < 3 || b.length < 3 || a === b) return 0;

  let score = 0;

  // Uno contiene al otro: "Federada" y "Federada Salud", "OSDE 210" y "OSDE"
  if (Math.min(a.length, b.length) >= 4 && (a.includes(b) || b.includes(a))) score = 3;

  // Error de tipeo: "Federeda Salud" y "Federada Salud". Se tolera un cambio cada 5 letras
  const tolerance = Math.max(1, Math.round(Math.max(a.length, b.length) / 5));
  const distance = editDistance(a, b, tolerance);
  if (distance <= tolerance) score = Math.max(score, 3 - distance / (tolerance + 1));

  // Comparten una palabra que no es común: "Swiss Medical" y "Swiss", "TEA" y "Trastorno del Espectro Autista (TEA)"
  const words = significantWords(name);
  score += significantWords(other).filter((word) => words.some((own) => sameWord(own, word))).length;

  return score;
};

// Opciones del catálogo ({ id, name }) que se parecen a name, de la más a la menos parecida. No incluye la que tiene
// exactamente el mismo nombre (esa ya cuenta como la misma). limit: cuántas devolver como máximo
export const findSimilarOptions = (name, options, limit = 3) =>
  options
    .map((option) => ({ option, score: similarity(name, option.name) }))
    .filter((item) => item.score >= 1)
    .sort((a, b) => b.score - a.score || a.option.name.localeCompare(b.option.name, "es"))
    .slice(0, limit)
    .map((item) => item.option);

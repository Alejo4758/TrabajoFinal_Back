// Cliente de la API de Google Gemini (@google/genai).
// La API key se lee de process.env.GEMINI_API_KEY recién al primer uso: si falta, el resto de la API funciona igual
// y solo la generación con IA responde 503.
// Nunca se loguea el prompt ni la respuesta: aunque están anonimizados, son información clínica.
//
// MODELOS: Google retira modelos viejos (gemini-2.5-flash ya responde 404 a las cuentas nuevas) y los nuevos a veces
// están saturados (503). Por eso se usa una lista de modelos en orden de preferencia: si uno falla por algo que no es
// culpa del pedido (no existe, cuota, saturado, error del servidor o no respondió a tiempo), se prueba el siguiente.
// Si está saturado (503/429) se le da una segunda oportunidad a los pocos segundos antes de pasar al siguiente.
// Se configura con GEMINI_MODELS (separados por coma); si no está, se usa DEFAULT_MODELS.

import { GoogleGenAI } from "@google/genai";

// Orden elegido probando en noviembre de 2026: 3.5-flash respondía siempre; 3.8-flash (el que recomienda Google) estaba
// saturado casi siempre. 3.1-flash-lite es el último respaldo: más simple, pero respondía rápido cuando los otros no.
// Se puede cambiar sin tocar código con GEMINI_MODELS
const DEFAULT_MODELS = ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3.1-flash-lite"];

// Tiempo máximo por intento y para todo el pedido (reintentos y otros modelos incluidos).
// OJO: el SDK le manda este timeout a Google (header X-Server-Timeout) y Google CORTA la generación cuando se cumple,
// respondiendo 504 "Deadline expired". Con un timeout corto, un modelo lento falla aunque iba a responder bien
const ATTEMPT_TIMEOUT_MS = 90 * 1000;
const TOTAL_BUDGET_MS = 170 * 1000;
// Lo mínimo que tiene que quedar del tiempo total para que valga la pena otro intento
const MIN_ATTEMPT_MS = 20 * 1000;

// Errores de Gemini por los que conviene probar con otro modelo. 400 (pedido inválido) y 401/403 (API key) no:
// fallarían igual con cualquier modelo
const RETRIABLE_STATUSES = new Set([404, 408, 429, 500, 502, 503, 504]);
// Saturación o cuota: muchas veces es un pico de segundos, así que antes de pasar al siguiente modelo se reintenta
// el mismo una vez, después de esperar un poco
const BUSY_STATUSES = new Set([429, 503]);
const BUSY_RETRY_DELAY_MS = 3 * 1000;

// Cuánto "razona" el modelo antes de responder. Los Gemini 3.x razonan por defecto, y para redactar un informe a partir
// de datos ya resumidos no hace falta: razonar menos responde mucho más rápido y es menos probable que se corte.
// Se cambia con GEMINI_THINKING_LEVEL (minimal, low, medium, high); "default" deja el del modelo
const DEFAULT_THINKING_LEVEL = "low";

const thinkingConfig = () => {
  const level = (process.env.GEMINI_THINKING_LEVEL ?? DEFAULT_THINKING_LEVEL).trim().toLowerCase();
  return level && level !== "default" ? { thinkingConfig: { thinkingLevel: level.toUpperCase() } } : {};
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const getModels = () => {
  const configured = (process.env.GEMINI_MODELS ?? "")
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
  return configured.length > 0 ? configured : DEFAULT_MODELS;
};

// No hay API key configurada en el servidor
export class AiNotConfiguredError extends Error {}

// La IA no respondió, respondió vacío o bloqueó el pedido. status es el HTTP de Gemini si lo hubo (429 = cuota,
// 503 = saturado); con varios modelos, el del último intento
export class AiGenerationError extends Error {
  constructor(message, { status, reason } = {}) {
    super(message);
    this.status = status;
    this.reason = reason;
  }
}

let client = null;

const getClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new AiNotConfiguredError("Falta GEMINI_API_KEY");
  if (!client) client = new GoogleGenAI({ apiKey });
  return client;
};

// Mensaje de error de Google, sin el resto del cuerpo. No incluye nada del prompt: es seguro loguearlo
const googleMessage = (error) => {
  const text = String(error?.message ?? "");
  return (text.match(/"message":\s*"([^"]{0,160})/) ?? [])[1] ?? text.slice(0, 160);
};

// Sin status es un error de red o un timeout: también vale probar con otro modelo
const isRetriable = (error) => error?.status === undefined || RETRIABLE_STATUSES.has(error.status);

// Genera texto con una instrucción de sistema. contents es un prompt (texto) o una conversación:
// [{ role: "user" | "model", parts: [{ text }] }]. Con jsonSchema la respuesta viene como JSON que cumple ese esquema.
// Devuelve { text, model }: el texto tal cual lo respondió el modelo y qué modelo respondió
export const generateText = async ({ systemInstruction, contents, temperature = 0.4, jsonSchema }) => {
  const ai = getClient();
  const startedAt = Date.now();
  const remaining = () => TOTAL_BUDGET_MS - (Date.now() - startedAt);
  let lastError = null;

  const call = (model, withThinking) =>
    ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction,
        temperature,
        httpOptions: { timeout: Math.min(ATTEMPT_TIMEOUT_MS, remaining()) },
        ...(withThinking ? thinkingConfig() : {}),
        ...(jsonSchema ? { responseMimeType: "application/json", responseJsonSchema: jsonSchema } : {}),
      },
    });

  for (const model of getModels()) {
    let response = null;
    let withThinking = true;
    let busyRetried = false;

    while (!response) {
      if (lastError && remaining() < MIN_ATTEMPT_MS) break;
      try {
        response = await call(model, withThinking);
      } catch (error) {
        lastError = new AiGenerationError("La llamada a Gemini falló", { status: error?.status, reason: error?.name });
        console.error(`Gemini (${model}) falló:`, error?.status ?? error?.name ?? "", googleMessage(error));

        // Un modelo que no admite el nivel de razonamiento pedido: se reintenta el mismo con el suyo por defecto
        if (error?.status === 400 && withThinking && /think/i.test(googleMessage(error))) {
          withThinking = false;
          continue;
        }
        if (!isRetriable(error)) throw lastError;
        if (BUSY_STATUSES.has(error.status) && !busyRetried && remaining() > BUSY_RETRY_DELAY_MS + MIN_ATTEMPT_MS) {
          busyRetried = true;
          await wait(BUSY_RETRY_DELAY_MS);
          continue;
        }
        break;
      }
    }
    if (!response) {
      if (remaining() < MIN_ATTEMPT_MS) break;
      continue;
    }

    const text = response?.text;
    if (typeof text !== "string" || !text.trim()) {
      // Bloqueado por seguridad o vacío: otro modelo respondería parecido, no se reintenta
      const reason = response?.promptFeedback?.blockReason ?? response?.candidates?.[0]?.finishReason;
      throw new AiGenerationError("Gemini no devolvió texto", { reason });
    }
    return { text, model };
  }

  throw lastError ?? new AiGenerationError("No hay modelos de Gemini configurados");
};

// Igual que generateText pero devuelve { value, model } con el JSON ya parseado
export const generateJson = async ({ jsonSchema, ...options }) => {
  const { text, model } = await generateText({ ...options, jsonSchema });
  try {
    const value = JSON.parse(text);
    if (value && typeof value === "object" && !Array.isArray(value)) return { value, model };
  } catch {
    // se informa abajo
  }
  throw new AiGenerationError("Gemini no devolvió un JSON válido");
};

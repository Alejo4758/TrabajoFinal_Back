import prisma from "../../lib/prisma.js";
import { createNotification } from "../services/notification.service.js";
import { getOrCreateDirectConversation } from "../services/conversation.service.js";

const ACTIVITY_TYPES = ["SESSION", "INTERVIEW", "MEETING", "OTHER"];
const ACTIVITY_STATES = ["PENDING", "CONFIRMED", "CANCELLED", "COMPLETED"];

const TITLE_MAX = 120;
const DESCRIPTION_MAX = 2000;
const UBICATION_MAX = 200;
const MESSAGE_MAX = 1000;
const LIST_LIMIT = 500;
const HOUR_MS = 60 * 60 * 1000;
const ACTIVITY_MAX_DURATION_MS = 31 * 24 * HOUR_MS;
const INTERVIEW_MAX_DURATION_MS = 4 * HOUR_MS;
const RANGE_MAX_MS = 400 * 24 * HOUR_MS;

const HOLIDAYS_API_URL = "https://api.argentinadatos.com/v1/feriados";
const HOLIDAYS_TIMEOUT_MS = 5000;
const HOLIDAYS_CACHE_TTL_MS = 24 * HOUR_MS;
const HOLIDAYS_MIN_YEAR = 2000;
const HOLIDAYS_MAX_YEAR = 2100;
const CALENDAR_LINK = "/calendario";
const TIME_ZONE = "America/Argentina/Buenos_Aires";

// Datos públicos de un usuario: nunca se exponen password, tokens ni documento
const userPublicSelect = { id: true, name: true, lastName: true, email: true };

const activityBaseSelect = {
  id: true,
  profileATId: true,
  userId: true,
  title: true,
  description: true,
  ubication: true,
  type: true,
  state: true,
  startDate: true,
  finishDate: true,
  createdAt: true,
  updatedAt: true,
};

// Vista del AT: ve al cliente vinculado (si lo hay)
const activityATSelect = {
  ...activityBaseSelect,
  user: { select: userPublicSelect },
};

// Vista del cliente: ve al profesional
const activityClientSelect = {
  ...activityBaseSelect,
  profileAT: { select: { id: true, user: { select: userPublicSelect } } },
};

// Feriados por año, para no consultar la API externa en cada render del calendario
const holidaysCache = new Map();

// Señal interna para abortar una transacción sin confundirla con un error real
class ScheduleConflictError extends Error {}

const getBody = (req) => {
  const body = req.body;
  return body && typeof body === "object" && !Array.isArray(body) ? body : null;
};

const parseId = (value) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

// Solo se aceptan strings: un número se interpretaría como timestamp sin que el front lo note
const parseDate = (value) => {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
};

// Texto opcional: undefined = no se envió, null/"" = vaciar el campo. Devuelve { error } o { value }
const parseOptionalText = (value, max, label) => {
  if (value === undefined) return { value: undefined };
  if (value === null) return { value: null };
  if (typeof value !== "string") return { error: `${label} no es válida.` };
  const trimmed = value.trim();
  if (trimmed.length > max) return { error: `${label} no puede superar los ${max} caracteres.` };
  return { value: trimmed || null };
};

const parseTitle = (value) => {
  if (typeof value !== "string" || !value.trim()) {
    return { error: "El título es obligatorio." };
  }
  const trimmed = value.trim();
  if (trimmed.length > TITLE_MAX) {
    return { error: `El título no puede superar los ${TITLE_MAX} caracteres.` };
  }
  return { value: trimmed };
};

const validateDateRange = (start, end, maxDurationMs) => {
  if (!start || !end) {
    return "Las fechas de inicio y fin deben ser fechas ISO válidas.";
  }
  if (end <= start) {
    return "La fecha de fin debe ser posterior a la fecha de inicio.";
  }
  if (end - start > maxDurationMs) {
    return "La duración de la actividad es demasiado larga.";
  }
  return null;
};

const formatDate = (date) =>
  date.toLocaleString("es-AR", { timeZone: TIME_ZONE, dateStyle: "short", timeStyle: "short" });

// Lee ?start, ?end e ?includeCancelled y arma el filtro de Prisma. Devuelve { error } o { where }
const parseRangeQuery = (query) => {
  const { start: rawStart, end: rawEnd, includeCancelled } = query;
  const where = {};

  if (includeCancelled !== undefined && includeCancelled !== "true" && includeCancelled !== "false") {
    return { error: "includeCancelled debe ser 'true' o 'false'." };
  }
  if (includeCancelled !== "true") {
    where.state = { not: "CANCELLED" };
  }

  const start = rawStart === undefined ? null : parseDate(rawStart);
  const end = rawEnd === undefined ? null : parseDate(rawEnd);
  if ((rawStart !== undefined && !start) || (rawEnd !== undefined && !end)) {
    return { error: "Los parámetros start y end deben ser fechas ISO válidas." };
  }
  if (start && end) {
    if (end <= start) {
      return { error: "La fecha end debe ser posterior a start." };
    }
    if (end - start > RANGE_MAX_MS) {
      return { error: "El rango de fechas consultado es demasiado amplio." };
    }
  }

  // Actividades que se solapan con el rango (no solo las que empiezan dentro):
  // así una actividad que cruza la medianoche o el cambio de mes aparece igual
  if (start) where.finishDate = { gt: start };
  if (end) where.startDate = { lt: end };

  return { where };
};

const getProfileATByUserId = (userId) =>
  prisma.profileAT.findUnique({
    where: { userId },
    select: { id: true, userId: true, user: { select: { name: true, lastName: true } } },
  });

// Clientes vinculados a un AT: tienen un chat activo con él o algún turno previo en su agenda
const linkedClientsWhere = (atUserId, profileATId) => ({
  role: "CLIENT",
  OR: [
    {
      conversations: {
        some: {
          leftAt: null,
          conversation: {
            isGroup: false,
            users: { some: { userId: atUserId, leftAt: null } },
          },
        },
      },
    },
    { calendarActivities: { some: { profileATId } } },
  ],
});

const isLinkedClient = async (clientId, atUserId, profileATId) => {
  const client = await prisma.user.findFirst({
    where: { id: clientId, ...linkedClientsWhere(atUserId, profileATId) },
    select: { id: true },
  });
  return Boolean(client);
};

// Primera actividad activa del AT que se superpone con [start, end), excluyendo opcionalmente una
const findOverlap = (client, profileATId, start, end, excludeId = null) =>
  client.calendarActivity.findFirst({
    where: {
      profileATId,
      state: { not: "CANCELLED" },
      startDate: { lt: end },
      finishDate: { gt: start },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    orderBy: { startDate: "asc" },
    select: activityATSelect,
  });

const conflictResponse = (res, conflictingActivity) =>
  res.status(409).json({
    warning: true,
    message: `Este horario se superpone con "${conflictingActivity.title}" (${formatDate(
      conflictingActivity.startDate
    )} - ${formatDate(conflictingActivity.finishDate)}). Enviá force: true para agendarla igual.`,
    conflictingActivity,
  });

// GET /api/calendar/me?start=&end=&includeCancelled=
export const getMyATCalendar = async (req, res) => {
  try {
    // El AT sale SIEMPRE del token, nunca de query/params/body
    const profileAT = await getProfileATByUserId(req.user.userId);
    if (!profileAT) {
      return res.status(404).json({ error: "No se encontró un perfil de acompañante terapéutico para este usuario." });
    }

    const { error, where } = parseRangeQuery(req.query);
    if (error) {
      return res.status(400).json({ error });
    }

    const activities = await prisma.calendarActivity.findMany({
      where: { ...where, profileATId: profileAT.id },
      orderBy: { startDate: "asc" },
      take: LIST_LIMIT,
      select: activityATSelect,
    });

    return res.status(200).json({ data: activities });
  } catch (error) {
    console.error("Error en getMyATCalendar:", error.code || "", error.message);
    return res.status(500).json({ error: "Error interno del servidor al obtener la agenda." });
  }
};

// GET /api/calendar/client/me?start=&end=&includeCancelled=
export const getClientCalendar = async (req, res) => {
  try {
    const { error, where } = parseRangeQuery(req.query);
    if (error) {
      return res.status(400).json({ error });
    }

    const activities = await prisma.calendarActivity.findMany({
      where: { ...where, userId: req.user.userId },
      orderBy: { startDate: "asc" },
      take: LIST_LIMIT,
      select: activityClientSelect,
    });

    return res.status(200).json({ data: activities });
  } catch (error) {
    console.error("Error en getClientCalendar:", error.code || "", error.message);
    return res.status(500).json({ error: "Error interno del servidor al obtener tus turnos." });
  }
};

// GET /api/calendar/clients
export const getATLinkedClients = async (req, res) => {
  try {
    const atUserId = req.user.userId;

    const profileAT = await getProfileATByUserId(atUserId);
    if (!profileAT) {
      return res.status(404).json({ error: "No se encontró un perfil de acompañante terapéutico para este usuario." });
    }

    const clients = await prisma.user.findMany({
      where: linkedClientsWhere(atUserId, profileAT.id),
      orderBy: [{ lastName: "asc" }, { name: "asc" }],
      select: userPublicSelect,
    });

    return res.status(200).json({ data: clients });
  } catch (error) {
    console.error("Error en getATLinkedClients:", error.code || "", error.message);
    return res.status(500).json({ error: "Error interno del servidor al obtener los clientes." });
  }
};

// POST /api/calendar
export const createCalendarActivity = async (req, res) => {
  try {
    const atUserId = req.user.userId;

    const body = getBody(req);
    if (!body) {
      return res.status(400).json({ error: "El cuerpo de la solicitud no es válido." });
    }

    // Lista blanca: un profileATId del body se ignora, sale del token
    const { userId, title, description, ubication, type = "SESSION", state = "PENDING", startDate, finishDate, force = false } = body;

    const titleResult = parseTitle(title);
    if (titleResult.error) return res.status(400).json({ error: titleResult.error });

    const descriptionResult = parseOptionalText(description, DESCRIPTION_MAX, "La descripción");
    if (descriptionResult.error) return res.status(400).json({ error: descriptionResult.error });

    const ubicationResult = parseOptionalText(ubication, UBICATION_MAX, "La ubicación");
    if (ubicationResult.error) return res.status(400).json({ error: ubicationResult.error });

    if (!ACTIVITY_TYPES.includes(type)) {
      return res.status(400).json({ error: "El tipo de actividad no es válido." });
    }
    if (!ACTIVITY_STATES.includes(state)) {
      return res.status(400).json({ error: "El estado de la actividad no es válido." });
    }
    if (typeof force !== "boolean") {
      return res.status(400).json({ error: "El campo force debe ser booleano." });
    }

    const start = parseDate(startDate);
    const end = parseDate(finishDate);
    const dateError = validateDateRange(start, end, ACTIVITY_MAX_DURATION_MS);
    if (dateError) return res.status(400).json({ error: dateError });

    const profileAT = await getProfileATByUserId(atUserId);
    if (!profileAT) {
      return res.status(404).json({ error: "No se encontró un perfil de acompañante terapéutico para este usuario." });
    }

    // El cliente es opcional; si viene, tiene que ser uno ya vinculado a este AT
    let clientId = null;
    if (userId !== undefined && userId !== null) {
      clientId = parseId(userId);
      if (!clientId || !(await isLinkedClient(clientId, atUserId, profileAT.id))) {
        return res.status(400).json({ error: "El cliente indicado no está vinculado a tu agenda." });
      }
    }

    if (!force && state !== "CANCELLED") {
      const conflictingActivity = await findOverlap(prisma, profileAT.id, start, end);
      if (conflictingActivity) {
        return conflictResponse(res, conflictingActivity);
      }
    }

    const activity = await prisma.calendarActivity.create({
      data: {
        profileATId: profileAT.id,
        userId: clientId,
        title: titleResult.value,
        description: descriptionResult.value ?? null,
        ubication: ubicationResult.value ?? null,
        type,
        state,
        startDate: start,
        finishDate: end,
      },
      select: activityATSelect,
    });

    // createNotification atrapa sus propios errores: si falla, la actividad igual queda creada
    if (clientId) {
      await createNotification(req.app.get("io"), {
        userId: clientId,
        type: "ACTIVITY_REMINDER",
        title: `${profileAT.user.name} ${profileAT.user.lastName} agendó una actividad`,
        content: `${activity.title} - ${formatDate(activity.startDate)}`,
        link: CALENDAR_LINK,
      });
    }

    return res.status(201).json({ data: activity });
  } catch (error) {
    console.error("Error en createCalendarActivity:", error.code || "", error.message);
    return res.status(500).json({ error: "Error interno del servidor al crear la actividad." });
  }
};

// POST /api/calendar/interview-request
export const requestInterview = async (req, res) => {
  try {
    // El cliente sale SIEMPRE del token, nunca del body
    const clientId = req.user.userId;

    const body = getBody(req);
    if (!body) {
      return res.status(400).json({ error: "El cuerpo de la solicitud no es válido." });
    }

    const { profileATId, startDate, finishDate, message } = body;

    const atProfileId = Number.isInteger(profileATId) ? parseId(profileATId) : null;
    if (!atProfileId) {
      return res.status(400).json({ error: "El profesional indicado no es válido." });
    }

    const start = parseDate(startDate);
    const end = parseDate(finishDate);
    const dateError = validateDateRange(start, end, INTERVIEW_MAX_DURATION_MS);
    if (dateError) return res.status(400).json({ error: dateError });
    if (start <= new Date()) {
      return res.status(400).json({ error: "La entrevista debe solicitarse para una fecha futura." });
    }

    const messageResult = parseOptionalText(message, MESSAGE_MAX, "El mensaje");
    if (messageResult.error) return res.status(400).json({ error: messageResult.error });

    const profileAT = await prisma.profileAT.findUnique({
      where: { id: atProfileId },
      select: { id: true, status: true, userId: true, user: { select: { role: true } } },
    });

    if (!profileAT || profileAT.status !== "APPROVED" || profileAT.user?.role !== "AT") {
      return res.status(404).json({ error: "El profesional no existe o no está disponible." });
    }
    if (profileAT.userId === clientId) {
      return res.status(400).json({ error: "No podés solicitarte una entrevista a vos mismo." });
    }

    const client = await prisma.user.findUnique({
      where: { id: clientId },
      select: { id: true, name: true, lastName: true },
    });
    if (!client) {
      return res.status(401).json({ error: "Tu sesión no es válida. Volvé a iniciar sesión." });
    }

    const pendingInterview = await prisma.calendarActivity.findFirst({
      where: {
        profileATId: profileAT.id,
        userId: clientId,
        type: "INTERVIEW",
        state: "PENDING",
        startDate: { gt: new Date() },
      },
      select: { id: true },
    });
    if (pendingInterview) {
      return res.status(409).json({ error: "Ya tenés una entrevista pendiente con este profesional." });
    }

    const clientName = `${client.name} ${client.lastName}`;
    const messageContent =
      messageResult.value ?? `Hola, me gustaría solicitar una entrevista inicial para el ${formatDate(start)}.`;

    let activity;
    let newMessage;
    try {
      ({ activity, newMessage } = await prisma.$transaction(async (tx) => {
        // Se revisa dentro de la transacción para achicar la ventana entre el chequeo y el alta.
        // Al cliente no se le muestra con qué se superpone: es agenda privada del AT.
        if (await findOverlap(tx, profileAT.id, start, end)) {
          throw new ScheduleConflictError();
        }

        const activity = await tx.calendarActivity.create({
          data: {
            profileATId: profileAT.id,
            userId: clientId,
            title: `Entrevista inicial con ${clientName}`,
            description: messageContent,
            type: "INTERVIEW",
            state: "PENDING",
            startDate: start,
            finishDate: end,
          },
          select: activityClientSelect,
        });

        const conversation = await getOrCreateDirectConversation(tx, clientId, profileAT.userId);

        const newMessage = await tx.message.create({
          data: { conversationId: conversation.id, senderId: clientId, content: messageContent },
          include: { sender: { select: { id: true, name: true, lastName: true } } },
        });

        await tx.conversation.update({
          where: { id: conversation.id },
          data: { updatedAt: new Date() },
        });

        return { activity, newMessage };
      }));
    } catch (error) {
      if (error instanceof ScheduleConflictError) {
        return res.status(409).json({ error: "El horario solicitado no está disponible. Elegí otro horario." });
      }
      throw error;
    }

    const io = req.app.get("io");
    io?.to(`conv_${newMessage.conversationId}`).emit("receive_message", newMessage);

    await createNotification(io, {
      userId: profileAT.userId,
      type: "INTERVIEW_REQUEST",
      title: `Nueva solicitud de entrevista de ${clientName}`,
      content: `Para el ${formatDate(start)}. ${messageContent}`,
      link: CALENDAR_LINK,
    });

    return res.status(201).json({ data: { activity, conversationId: newMessage.conversationId } });
  } catch (error) {
    console.error("Error en requestInterview:", error.code || "", error.message);
    return res.status(500).json({ error: "Error interno del servidor al solicitar la entrevista." });
  }
};

// Arma el aviso para la contraparte según qué cambió
const describeChange = (before, after) => {
  if (after.state !== before.state && after.state === "CANCELLED") return "canceló";
  if (after.state !== before.state && after.state === "CONFIRMED") return "confirmó";
  if (
    after.startDate.getTime() !== before.startDate.getTime() ||
    after.finishDate.getTime() !== before.finishDate.getTime()
  ) {
    return "reprogramó";
  }
  if (after.state !== before.state && after.state === "COMPLETED") return "marcó como completada";
  return "actualizó";
};

// Cambios que puede hacer el AT dueño (o un ADMIN). Devuelve { error } o { data }
const validateATUpdate = (body) => {
  const data = {};

  if (body.title !== undefined) {
    const result = parseTitle(body.title);
    if (result.error) return { error: result.error };
    data.title = result.value;
  }

  const descriptionResult = parseOptionalText(body.description, DESCRIPTION_MAX, "La descripción");
  if (descriptionResult.error) return { error: descriptionResult.error };
  if (descriptionResult.value !== undefined) data.description = descriptionResult.value;

  const ubicationResult = parseOptionalText(body.ubication, UBICATION_MAX, "La ubicación");
  if (ubicationResult.error) return { error: ubicationResult.error };
  if (ubicationResult.value !== undefined) data.ubication = ubicationResult.value;

  if (body.type !== undefined) {
    if (!ACTIVITY_TYPES.includes(body.type)) return { error: "El tipo de actividad no es válido." };
    data.type = body.type;
  }

  if (body.state !== undefined) {
    if (!ACTIVITY_STATES.includes(body.state)) return { error: "El estado de la actividad no es válido." };
    data.state = body.state;
  }

  if (body.userId !== undefined) {
    if (body.userId === null) {
      data.userId = null;
    } else {
      const clientId = parseId(body.userId);
      if (!clientId) return { error: "El cliente indicado no es válido." };
      data.userId = clientId;
    }
  }

  if (body.startDate !== undefined) {
    const start = parseDate(body.startDate);
    if (!start) return { error: "La fecha de inicio debe ser una fecha ISO válida." };
    data.startDate = start;
  }

  if (body.finishDate !== undefined) {
    const end = parseDate(body.finishDate);
    if (!end) return { error: "La fecha de fin debe ser una fecha ISO válida." };
    data.finishDate = end;
  }

  if (body.force !== undefined && typeof body.force !== "boolean") {
    return { error: "El campo force debe ser booleano." };
  }

  return { data, force: body.force === true };
};

// PATCH /api/calendar/:id
export const updateCalendarActivity = async (req, res) => {
  try {
    const { userId: requesterId, role } = req.user;

    const activityId = parseId(req.params.id);
    if (!activityId) {
      return res.status(400).json({ error: "El id de la actividad no es válido." });
    }

    const body = getBody(req);
    if (!body) {
      return res.status(400).json({ error: "El cuerpo de la solicitud no es válido." });
    }

    const activity = await prisma.calendarActivity.findUnique({
      where: { id: activityId },
      select: {
        ...activityBaseSelect,
        profileAT: { select: { userId: true, user: { select: { name: true, lastName: true } } } },
        user: { select: { name: true, lastName: true } },
      },
    });

    if (!activity) {
      return res.status(404).json({ error: "La actividad no existe." });
    }

    let data;
    let force = false;

    if (role === "CLIENT") {
      if (activity.userId !== requesterId) {
        return res.status(403).json({ error: "No tenés permisos para modificar esta actividad." });
      }
      // El cliente solo puede cancelar sus propias entrevistas: cualquier otro campo se rechaza
      const keys = Object.keys(body);
      if (activity.type !== "INTERVIEW" || keys.length !== 1 || keys[0] !== "state" || body.state !== "CANCELLED") {
        return res.status(403).json({ error: "Solo podés cancelar tus propias entrevistas." });
      }
      if (activity.state === "CANCELLED" || activity.state === "COMPLETED") {
        return res.status(409).json({ error: "Esta entrevista ya no se puede cancelar." });
      }
      data = { state: "CANCELLED" };
    } else {
      if (role === "AT") {
        const profileAT = await getProfileATByUserId(requesterId);
        if (!profileAT || activity.profileATId !== profileAT.id) {
          return res.status(403).json({ error: "No tenés permisos para modificar esta actividad." });
        }
      }

      const result = validateATUpdate(body);
      if (result.error) {
        return res.status(400).json({ error: result.error });
      }
      ({ data, force } = result);

      if (Object.keys(data).length === 0) {
        return res.status(400).json({ error: "No se envió ningún cambio." });
      }

      // Al reasignar un cliente, tiene que estar vinculado al AT dueño de la actividad
      if (data.userId && data.userId !== activity.userId) {
        const linked = await isLinkedClient(data.userId, activity.profileAT.userId, activity.profileATId);
        if (!linked) {
          return res.status(400).json({ error: "El cliente indicado no está vinculado a esta agenda." });
        }
      }
    }

    const start = data.startDate ?? activity.startDate;
    const end = data.finishDate ?? activity.finishDate;
    const dateError = validateDateRange(start, end, ACTIVITY_MAX_DURATION_MS);
    if (dateError) {
      return res.status(400).json({ error: dateError });
    }

    // Superposición: si cambian las fechas o si se reactiva una actividad cancelada
    const finalState = data.state ?? activity.state;
    const datesChanged =
      start.getTime() !== activity.startDate.getTime() || end.getTime() !== activity.finishDate.getTime();
    const reactivated = activity.state === "CANCELLED" && finalState !== "CANCELLED";
    if (!force && finalState !== "CANCELLED" && (datesChanged || reactivated)) {
      const conflictingActivity = await findOverlap(prisma, activity.profileATId, start, end, activityId);
      if (conflictingActivity) {
        return conflictResponse(res, conflictingActivity);
      }
    }

    const updated = await prisma.calendarActivity.update({
      where: { id: activityId },
      data,
      select: role === "CLIENT" ? activityClientSelect : activityATSelect,
    });

    // Avisos a la contraparte. createNotification atrapa sus propios errores.
    const io = req.app.get("io");
    const action = describeChange(activity, updated);
    const notificationType = updated.type === "INTERVIEW" ? "INTERVIEW_STATUS" : "ACTIVITY_REMINDER";
    const when = formatDate(updated.startDate);

    if (role === "CLIENT") {
      await createNotification(io, {
        userId: activity.profileAT.userId,
        type: notificationType,
        title: `${activity.user.name} ${activity.user.lastName} canceló la entrevista`,
        content: `${updated.title} - ${when}`,
        link: CALENDAR_LINK,
      });
    } else {
      const atName = `${activity.profileAT.user.name} ${activity.profileAT.user.lastName}`;

      if (updated.userId) {
        await createNotification(io, {
          userId: updated.userId,
          type: notificationType,
          title: `${atName} ${action} una actividad`,
          content: `${updated.title} - ${when}`,
          link: CALENDAR_LINK,
        });
      }

      // Si la actividad se le quitó a un cliente, se le avisa que ya no la tiene
      if (activity.userId && activity.userId !== updated.userId) {
        await createNotification(io, {
          userId: activity.userId,
          type: notificationType,
          title: `${atName} canceló una actividad`,
          content: `${activity.title} - ${formatDate(activity.startDate)}`,
          link: CALENDAR_LINK,
        });
      }

      // Si la modificó un ADMIN, el AT dueño también se entera
      if (role === "ADMIN") {
        await createNotification(io, {
          userId: activity.profileAT.userId,
          type: notificationType,
          title: `Un administrador ${action} una actividad de tu agenda`,
          content: `${updated.title} - ${when}`,
          link: CALENDAR_LINK,
        });
      }
    }

    return res.status(200).json({ data: updated });
  } catch (error) {
    console.error("Error en updateCalendarActivity:", error.code || "", error.message);
    return res.status(500).json({ error: "Error interno del servidor al actualizar la actividad." });
  }
};

// GET /api/calendar/holidays/:year
export const getNationalHolidays = async (req, res) => {
  try {
    const rawYear = req.params.year;
    const year = Number(rawYear);
    if (!/^\d{4}$/.test(rawYear) || year < HOLIDAYS_MIN_YEAR || year > HOLIDAYS_MAX_YEAR) {
      return res.status(400).json({
        error: `El año debe ser un número de 4 dígitos entre ${HOLIDAYS_MIN_YEAR} y ${HOLIDAYS_MAX_YEAR}.`,
      });
    }

    const cached = holidaysCache.get(year);
    if (cached && cached.expiresAt > Date.now()) {
      return res.status(200).json({ data: cached.holidays });
    }

    let response;
    try {
      response = await fetch(`${HOLIDAYS_API_URL}/${year}`, {
        signal: AbortSignal.timeout(HOLIDAYS_TIMEOUT_MS),
        headers: { Accept: "application/json" },
      });
    } catch (error) {
      console.error("Error al consultar feriados:", error.name, error.message);
      return res.status(502).json({ error: "No se pudo consultar el servicio de feriados." });
    }

    if (!response.ok) {
      console.error("Servicio de feriados respondió con estado", response.status);
      return res.status(502).json({ error: "No se pudo consultar el servicio de feriados." });
    }

    const payload = await response.json().catch(() => null);
    if (!Array.isArray(payload)) {
      return res.status(502).json({ error: "El servicio de feriados devolvió una respuesta inválida." });
    }

    // Solo se devuelven los campos conocidos, con el tipo esperado: nada del servicio externo pasa tal cual
    const holidays = payload
      .filter((h) => h && typeof h.fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(h.fecha))
      .map((h) => ({
        date: h.fecha,
        name: typeof h.nombre === "string" ? h.nombre.slice(0, 200) : "Feriado",
        type: typeof h.tipo === "string" ? h.tipo.slice(0, 50) : null,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    holidaysCache.set(year, { holidays, expiresAt: Date.now() + HOLIDAYS_CACHE_TTL_MS });

    return res.status(200).json({ data: holidays });
  } catch (error) {
    console.error("Error en getNationalHolidays:", error.code || "", error.message);
    return res.status(500).json({ error: "Error interno del servidor al obtener los feriados." });
  }
};

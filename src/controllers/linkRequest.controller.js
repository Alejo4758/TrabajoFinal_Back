import prisma from "../../lib/prisma.js";
import { createNotification } from "../services/notification.service.js";
import { getOrCreateDirectConversation } from "../services/conversation.service.js";

const DESCRIPTION_MIN = 20;
const DESCRIPTION_MAX = 500;
const LOCALITY_MAX = 100;
const SOCIAL_PROGRAMS_MAX = 20;
const SOCIAL_PROGRAM_NAME_MAX = 100;
const RECEIVED_LIST_LIMIT = 50;
const RECEIVED_STATUSES = ["PENDING", "ACCEPTED", "REJECTED"];
const RESPOND_STATUSES = ["ACCEPTED", "REJECTED"];

// Señal interna para abortar la transacción de respondLinkRequest sin confundirla con un error real
class AlreadyRespondedError extends Error {}

// Datos públicos de la solicitud: nunca se exponen emails, documentos ni contraseñas
const linkRequestSelect = {
  id: true,
  description: true,
  locality: true,
  socialPrograms: true,
  otherCoverage: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  client: { select: { id: true, name: true, lastName: true } },
  profileAT: {
    select: {
      id: true,
      user: { select: { id: true, name: true, lastName: true } },
    },
  },
};

const normalize = (text) => text.trim().toLocaleLowerCase("es");

// Valida el body campo por campo, sin convertir tipos. Devuelve { error } o { data }
const validateLinkRequestBody = (body) => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "El cuerpo de la solicitud no es válido." };
  }

  // Lista blanca: solo se leen los campos del contrato, el resto se ignora (incluido un clientId)
  const { atId, description, locality, socialPrograms, otherCoverage } = body;

  if (!Number.isInteger(atId) || atId <= 0) {
    return { error: "El profesional indicado no es válido." };
  }

  if (typeof description !== "string") {
    return { error: "La descripción del caso es obligatoria." };
  }
  const descriptionTrimmed = description.trim();
  if (descriptionTrimmed.length < DESCRIPTION_MIN || descriptionTrimmed.length > DESCRIPTION_MAX) {
    return { error: `La descripción debe tener entre ${DESCRIPTION_MIN} y ${DESCRIPTION_MAX} caracteres.` };
  }

  if (typeof locality !== "string" || !locality.trim()) {
    return { error: "La localidad es obligatoria." };
  }
  const localityTrimmed = locality.trim();
  if (localityTrimmed.length > LOCALITY_MAX) {
    return { error: `La localidad no puede superar los ${LOCALITY_MAX} caracteres.` };
  }

  if (!Array.isArray(socialPrograms)) {
    return { error: "Las obras sociales deben enviarse como una lista." };
  }
  if (socialPrograms.length > SOCIAL_PROGRAMS_MAX) {
    return { error: `No podés seleccionar más de ${SOCIAL_PROGRAMS_MAX} obras sociales.` };
  }
  const programsTrimmed = [];
  for (const program of socialPrograms) {
    if (typeof program !== "string" || !program.trim() || program.trim().length > SOCIAL_PROGRAM_NAME_MAX) {
      return { error: "Alguna de las obras sociales seleccionadas no es válida." };
    }
    programsTrimmed.push(program.trim());
  }
  if (new Set(programsTrimmed.map(normalize)).size !== programsTrimmed.length) {
    return { error: "Hay obras sociales repetidas." };
  }

  if (typeof otherCoverage !== "boolean") {
    return { error: "Indicá si tenés otra obra social o ninguna." };
  }

  if (programsTrimmed.length === 0 && !otherCoverage) {
    return { error: "Seleccioná al menos una obra social o indicá que tenés otra o ninguna." };
  }

  return {
    data: {
      atId,
      description: descriptionTrimmed,
      locality: localityTrimmed,
      socialPrograms: programsTrimmed,
      otherCoverage,
    },
  };
};

// POST /link-requests
export const createLinkRequest = async (req, res) => {
  try {
    // El cliente sale SIEMPRE del token, nunca del body
    const clientId = req.user.userId;

    const { error: validationError, data } = validateLinkRequestBody(req.body);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const profileAT = await prisma.profileAT.findUnique({
      where: { id: data.atId },
      include: {
        user: { select: { id: true, role: true } },
        localities: { include: { locality: true } },
        obrasSociales: { include: { obraSocial: true } },
      },
    });

    if (!profileAT || profileAT.status !== "APPROVED" || profileAT.user?.role !== "AT") {
      return res.status(404).json({ error: "El profesional no existe o no está disponible." });
    }

    if (profileAT.userId === clientId) {
      return res.status(400).json({ error: "No podés enviarte una solicitud a vos mismo." });
    }

    // Si el AT tiene zonas cargadas, la localidad tiene que ser una de ellas.
    // Se guarda el nombre tal como lo tiene cargado el AT.
    const atLocalities = profileAT.localities.map((l) => l.locality?.name).filter(Boolean);
    let localityToSave = data.locality;
    if (atLocalities.length > 0) {
      const match = atLocalities.find((name) => normalize(name) === normalize(data.locality));
      if (!match) {
        return res.status(400).json({ error: "El profesional no trabaja en la localidad seleccionada." });
      }
      localityToSave = match;
    }

    // Cada obra social tiene que ser una que el AT acepte
    const atPrograms = new Map(
      profileAT.obrasSociales
        .map((o) => o.obraSocial?.name)
        .filter(Boolean)
        .map((name) => [normalize(name), name])
    );
    const programsToSave = [];
    for (const program of data.socialPrograms) {
      const match = atPrograms.get(normalize(program));
      if (!match) {
        return res.status(400).json({ error: "El profesional no trabaja con alguna de las obras sociales seleccionadas." });
      }
      programsToSave.push(match);
    }

    const client = await prisma.user.findUnique({
      where: { id: clientId },
      select: { id: true, name: true, lastName: true },
    });

    if (!client) {
      return res.status(401).json({ error: "Tu sesión no es válida. Volvé a iniciar sesión." });
    }

    const pending = await prisma.linkRequest.findFirst({
      where: { clientId, profileATId: profileAT.id, status: "PENDING" },
      select: { id: true },
    });

    if (pending) {
      return res.status(409).json({ error: "Ya enviaste una solicitud a este profesional" });
    }

    let linkRequest;
    try {
      linkRequest = await prisma.linkRequest.create({
        data: {
          clientId,
          profileATId: profileAT.id,
          description: data.description,
          locality: localityToSave,
          socialPrograms: programsToSave,
          otherCoverage: data.otherCoverage,
        },
        select: linkRequestSelect,
      });
    } catch (error) {
      // Dos requests simultáneas: el índice único parcial frena la segunda
      if (error.code === "P2002") {
        return res.status(409).json({ error: "Ya enviaste una solicitud a este profesional" });
      }
      throw error;
    }

    // Notificación al AT (destinatario = userId del AT, no el id de ProfileAT).
    // createNotification atrapa sus propios errores: si falla, la solicitud igual queda creada.
    const coverage = [
      ...programsToSave,
      ...(data.otherCoverage ? ["Otra o ninguna"] : []),
    ].join(", ");

    await createNotification(req.app.get("io"), {
      userId: profileAT.userId,
      type: "INTERVIEW_REQUEST",
      title: `Nueva solicitud de ${client.name} ${client.lastName}`,
      content: `${data.description}\nZona: ${localityToSave}\nObras sociales: ${coverage}`,
      link: "/linkRequests",
    });

    return res.status(201).json({ data: linkRequest });
  } catch (error) {
    // Solo se loguea el código y el mensaje: nunca el body ni el token
    console.error("Error en createLinkRequest:", error.code || "", error.message);
    return res.status(500).json({ error: "Error interno del servidor al enviar la solicitud." });
  }
};

// GET /link-requests/received?status=PENDING|ACCEPTED|REJECTED
export const getReceivedLinkRequests = async (req, res) => {
  try {
    // El AT sale SIEMPRE del token, nunca de query/params/body
    const atUserId = req.user.userId;

    const rawStatus = req.query.status;
    if (rawStatus !== undefined && typeof rawStatus !== "string") {
      return res.status(400).json({ error: "El estado indicado no es válido." });
    }
    const status = typeof rawStatus === "string" ? rawStatus.toUpperCase() : "PENDING";
    if (!RECEIVED_STATUSES.includes(status)) {
      return res.status(400).json({ error: "El estado indicado no es válido." });
    }

    const profileAT = await prisma.profileAT.findUnique({
      where: { userId: atUserId },
      select: { id: true },
    });

    if (!profileAT) {
      return res.status(404).json({ error: "No se encontró un perfil de acompañante terapéutico para este usuario." });
    }

    const linkRequests = await prisma.linkRequest.findMany({
      where: { profileATId: profileAT.id, status },
      orderBy: { createdAt: "desc" },
      take: RECEIVED_LIST_LIMIT,
      select: linkRequestSelect,
    });

    return res.status(200).json({ data: linkRequests });
  } catch (error) {
    console.error("Error en getReceivedLinkRequests:", error.code || "", error.message);
    return res.status(500).json({ error: "Error interno del servidor al obtener las solicitudes." });
  }
};

// PATCH /link-requests/:id
export const respondLinkRequest = async (req, res) => {
  try {
    // El AT sale SIEMPRE del token, nunca de query/params/body
    const atUserId = req.user.userId;

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "El id de la solicitud no es válido." });
    }

    // Lista blanca: solo se lee 'status', el resto del body se ignora
    const newStatus = req.body?.status;
    if (!RESPOND_STATUSES.includes(newStatus)) {
      return res.status(400).json({ error: "El estado debe ser ACCEPTED o REJECTED." });
    }

    const profileAT = await prisma.profileAT.findUnique({
      where: { userId: atUserId },
      select: { id: true, user: { select: { name: true, lastName: true } } },
    });

    if (!profileAT) {
      return res.status(404).json({ error: "No se encontró un perfil de acompañante terapéutico para este usuario." });
    }

    // Se chequea existencia y pertenencia antes de la transacción para distinguir 404 de 409.
    // El índice/condición de la transacción (status: "PENDING") es lo que realmente evita la carrera.
    const existing = await prisma.linkRequest.findFirst({
      where: { id, profileATId: profileAT.id },
      select: { clientId: true, status: true },
    });

    if (!existing) {
      // No existe o es de otro AT: mismo mensaje en los dos casos para no revelar cuál es
      return res.status(404).json({ error: "La solicitud no existe." });
    }

    if (existing.status !== "PENDING") {
      return res.status(409).json({ error: "Esta solicitud ya fue respondida" });
    }

    let updatedLinkRequest;
    try {
      updatedLinkRequest = await prisma.$transaction(async (tx) => {
        // Cambio de estado atómico: si otra pestaña ya respondió, count da 0
        const { count } = await tx.linkRequest.updateMany({
          where: { id, profileATId: profileAT.id, status: "PENDING" },
          data: { status: newStatus },
        });

        if (count === 0) {
          throw new AlreadyRespondedError();
        }

        if (newStatus === "ACCEPTED") {
          // El cliente podrá hablar con el AT por el chat ya aceptada la solicitud
          await getOrCreateDirectConversation(tx, existing.clientId, atUserId);
        }

        return tx.linkRequest.findUnique({ where: { id }, select: linkRequestSelect });
      });
    } catch (error) {
      if (error instanceof AlreadyRespondedError) {
        return res.status(409).json({ error: "Esta solicitud ya fue respondida" });
      }
      throw error;
    }

    // Notificación al cliente. createNotification atrapa sus propios errores:
    // si falla, la respuesta igual es 200 porque el estado ya quedó guardado.
    const atName = `${profileAT.user.name} ${profileAT.user.lastName}`;
    const accepted = newStatus === "ACCEPTED";

    await createNotification(req.app.get("io"), {
      userId: existing.clientId,
      type: "INTERVIEW_STATUS",
      title: accepted ? `${atName} aceptó tu solicitud` : `${atName} rechazó tu solicitud`,
      content: accepted
        ? "Tu solicitud fue aceptada. Ya podés hablar con el profesional por el chat."
        : "Tu solicitud no fue aceptada por el profesional.",
      link: accepted ? "/chat" : null,
    });

    return res.status(200).json({ data: updatedLinkRequest });
  } catch (error) {
    console.error("Error en respondLinkRequest:", error.code || "", error.message);
    return res.status(500).json({ error: "Error interno del servidor al responder la solicitud." });
  }
};

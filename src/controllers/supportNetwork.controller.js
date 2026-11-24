import prisma from "../../lib/prisma.js";
import { toPlanResponse } from "../services/plan.service.js";
import { encounterSelect, toEncounterResponse } from "../services/encounter.service.js";
import { reportSelect, toReportResponse } from "../services/report.service.js";
import { scopeBoardData } from "../services/board.service.js";
import {
  sendError,
  parseId,
  resolveNetworkViewer,
  roleToApi,
  sectionsToApi,
  fullName,
} from "../services/network.service.js";

// Lo que ve el integrante de la red de apoyo logueado (rol SUPPORT): sus acompañamientos y el tablero de cada uno.
// El acceso sale SIEMPRE de su fila activa en la red (resolveNetworkViewer): el :patientId de la URL no prueba nada.
// Si no es integrante activo de ese paciente (nunca lo fue, lo quitaron o es de otra red) se responde 403.

const FORBIDDEN_MESSAGE = "No formás parte de la red de apoyo de este acompañamiento, o tu acceso fue revocado.";

// GET /api/network/patients
// [{ patientId, patientName, atName, role, relationship, access }]. Si integra la red de dos A.T. del mismo paciente,
// va una sola entrada (la que aceptó más recientemente), la misma que usa el tablero
export const listMyNetworks = async (req, res) => {
  try {
    const memberships = await prisma.networkMember.findMany({
      where: { userId: req.user.userId, status: "ACTIVE" },
      orderBy: [{ acceptedAt: "desc" }, { id: "desc" }],
      select: {
        role: true,
        relationship: true,
        access: true,
        treatment: {
          select: {
            patient: { select: { id: true, name: true, lastName: true } },
            profileAT: { select: { user: { select: { name: true, lastName: true } } } },
          },
        },
      },
    });

    const seen = new Set();
    const data = [];
    for (const membership of memberships) {
      const { patient, profileAT } = membership.treatment;
      if (seen.has(patient.id)) continue;
      seen.add(patient.id);
      data.push({
        patientId: patient.id,
        patientName: fullName(patient),
        atName: fullName(profileAT.user),
        role: roleToApi(membership.role),
        relationship: membership.relationship ?? "",
        access: sectionsToApi(membership.access),
      });
    }

    return res.status(200).json({ data });
  } catch (error) {
    console.error("Error en listMyNetworks:", error.code || "", error.message);
    return res.status(500).json({ error: "Error interno del servidor al obtener tus acompañamientos." });
  }
};

// GET /api/network/patients/:patientId/board
// { patient: { id, name }, atName, member: { name, role, relationship, access }, plan, sessions, reports },
// ya recortado según los accesos. Lo que no tiene habilitado ni siquiera se consulta
export const getBoard = async (req, res) => {
  try {
    const patientId = parseId(req.params.patientId);
    if (!patientId) return sendError(res, "invalid", "El id del paciente no es válido.");

    const viewer = await resolveNetworkViewer(req.user, patientId);
    if (!viewer || viewer.isAT) return sendError(res, "forbidden", FORBIDDEN_MESSAGE);

    const { sections, member, treatmentId } = viewer;
    const can = (section) => sections.includes(section);
    const needsPlan = can("plan") || can("progress");
    const needsSessions = can("sessions") || can("progress");

    const [treatment, encounters, reports] = await Promise.all([
      prisma.treatment.findUnique({
        where: { id: treatmentId },
        select: {
          patient: { select: { id: true, name: true, lastName: true } },
          profileAT: { select: { user: { select: { name: true, lastName: true } } } },
          ...(needsPlan ? { workPlan: { select: { id: true, content: true, updatedAt: true } } } : {}),
        },
      }),
      // Mismo orden que el historial del A.T.: del más reciente al más antiguo
      needsSessions
        ? prisma.encounter.findMany({
            where: { treatmentId },
            orderBy: [{ startDate: "desc" }, { id: "desc" }],
            select: encounterSelect,
          })
        : [],
      // Solo los informes finalizados: un borrador todavía no es para compartir
      can("reports")
        ? prisma.report.findMany({
            where: { treatmentId, status: "FINAL" },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: reportSelect,
          })
        : [],
    ]);

    const scoped = scopeBoardData(
      {
        plan: needsPlan ? toPlanResponse(treatment.workPlan) : null,
        sessions: encounters.map(toEncounterResponse),
        reports: reports.map(toReportResponse),
      },
      sections
    );

    return res.status(200).json({
      data: {
        patient: { id: treatment.patient.id, name: fullName(treatment.patient) },
        atName: fullName(treatment.profileAT.user),
        member: {
          name: member.name ?? "",
          role: roleToApi(member.role),
          relationship: member.relationship ?? "",
          access: sections,
        },
        ...scoped,
      },
    });
  } catch (error) {
    console.error("Error en getBoard:", error.code || "", error.message);
    return res.status(500).json({ error: "Error interno del servidor al obtener el tablero." });
  }
};

// Datos de prueba de la red de apoyo, sobre el acompañamiento de Tomás Ruiz con Laura Gómez (lo crea prisma/seed.js).
// Se llama al final de seed.js y también se puede correr solo: node prisma/seed-network.js
// Se puede ejecutar varias veces: no duplica nada y no pisa un plan de trabajo que ya exista.
//
// Cuentas (contraseña 123456):
//   red.familia@test.com  Roberto Ruiz, padre: ve todo (plan, encuentros, evolución e informes)
//   red.docente@test.com  Marta Giménez, docente: ve el plan y la evolución
// Invitaciones para probar las páginas públicas (/invitacion/<token> en el front, GET /api/invitations/<token>):
//   vigente: SEED_PENDING_TOKEN (abuela.ruiz@test.com)     vencida: SEED_EXPIRED_TOKEN (psicopedagoga@test.com)
// Los tokens son fijos SOLO acá, para poder probarlos: en la base se guarda su hash, como con cualquier invitación.

import path from "path";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcrypt";
import { validatePlan } from "../src/services/plan.service.js";
import { hashToken, invitationExpiry } from "../src/services/network.service.js";

export const SEED_PENDING_TOKEN = "a1".repeat(32);
export const SEED_EXPIRED_TOKEN = "b2".repeat(32);

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days) => new Date(Date.now() - days * DAY_MS);

const SEED_PLAN = {
  status: "active",
  validFrom: "2026-08-01",
  validUntil: "2027-01-31",
  diagnosis: "Trastorno del Espectro Autista (TEA)",
  settings: ["school", "home"],
  weeklyHours: "6 horas semanales",
  rationale: "Acompañar a Tomás en la integración con sus compañeros y en la anticipación de las rutinas escolares.",
  generalGoals: ["Favorecer la integración de Tomás en el aula y en los recreos."],
  areas: ["Social", "Comunicación"],
  stages: [
    {
      id: "seed-escuela",
      name: "Escuela",
      setting: "school",
      period: "Agosto a diciembre",
      frequency: "Tres veces por semana",
      specificGoals: [
        { id: "seed-escuela-g1", text: "Que participe en un juego grupal durante el recreo." },
        { id: "seed-escuela-g2", text: "Que anticipe los cambios de actividad con la agenda visual." },
      ],
      activities: ["Juegos reglados con dos compañeros."],
      strategies: ["Agenda visual al comenzar la jornada."],
    },
  ],
  familyTeam: ["Reunión mensual con la familia y la docente."],
  evaluation: { criteria: ["Registro de participación en los recreos."], reportsFrequency: "monthly", notes: "" },
  atRole: "Mediar en las situaciones sociales y acompañar a la docente con las adaptaciones.",
};

export async function seedSupportNetwork(prisma) {
  const treatment = await prisma.treatment.findFirst({
    where: {
      patient: { name: "Tomás", lastName: "Ruiz", tutor: { email: "familia@test.com" } },
      profileAT: { user: { email: "laura.gomez@test.com" } },
    },
    select: { id: true, profileAT: { select: { userId: true } } },
  });
  if (!treatment) {
    console.log("⚠️ No está el acompañamiento de Tomás Ruiz con Laura Gómez: corré primero prisma/seed.js");
    return;
  }

  // Plan de trabajo (los aportes del plan y de los objetivos necesitan uno). Si ya hay, no se toca
  const { error, data: content } = validatePlan(SEED_PLAN);
  if (error) throw new Error(`El plan de prueba no es válido: ${error}`);
  await prisma.workPlan.upsert({ where: { treatmentId: treatment.id }, update: {}, create: { treatmentId: treatment.id, content } });

  const password = await bcrypt.hash("123456", 10);
  const ensureSupportUser = (email, name, lastName) =>
    prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, password, name, lastName, role: "SUPPORT", emailVerified: true },
    });

  const roberto = await ensureSupportUser("red.familia@test.com", "Roberto", "Ruiz");
  const marta = await ensureSupportUser("red.docente@test.com", "Marta", "Giménez");

  const ensureMember = (email, data) =>
    prisma.networkMember.upsert({
      where: { treatmentId_email: { treatmentId: treatment.id, email } },
      update: data,
      create: { treatmentId: treatment.id, email, ...data },
    });

  await ensureMember(roberto.email, {
    userId: roberto.id,
    name: "Roberto Ruiz",
    role: "FAMILY",
    relationship: "Padre",
    access: ["PLAN", "SESSIONS", "PROGRESS", "REPORTS"],
    status: "ACTIVE",
    tokenHash: hashToken("c3".repeat(32)),
    invitedAt: daysAgo(30),
    expiresAt: daysAgo(23),
    acceptedAt: daysAgo(29),
  });
  await ensureMember(marta.email, {
    userId: marta.id,
    name: "Marta Giménez",
    role: "EDUCATION",
    relationship: "Docente de grado",
    access: ["PLAN", "PROGRESS"],
    status: "ACTIVE",
    tokenHash: hashToken("d4".repeat(32)),
    invitedAt: daysAgo(20),
    expiresAt: daysAgo(13),
    acceptedAt: daysAgo(19),
  });
  // Pendiente vigente: vence a los 7 días de cada ejecución del seed
  await ensureMember("abuela.ruiz@test.com", {
    name: "Elsa Ruiz",
    role: "FAMILY",
    relationship: "Abuela",
    access: ["PLAN", "PROGRESS"],
    status: "PENDING",
    tokenHash: hashToken(SEED_PENDING_TOKEN),
    invitedAt: new Date(),
    expiresAt: invitationExpiry(new Date()),
  });
  await ensureMember("psicopedagoga@test.com", {
    name: null,
    role: "HEALTH",
    relationship: "Psicopedagoga",
    access: ["PLAN", "SESSIONS", "PROGRESS", "REPORTS"],
    status: "PENDING",
    tokenHash: hashToken(SEED_EXPIRED_TOKEN),
    invitedAt: daysAgo(12),
    expiresAt: daysAgo(5),
  });

  // Aportes: solo la primera vez
  const existing = await prisma.contribution.count({ where: { treatmentId: treatment.id } });
  if (existing === 0) {
    await prisma.contribution.createMany({
      data: [
        {
          treatmentId: treatment.id,
          authorId: treatment.profileAT.userId,
          authorRole: "AT",
          targetType: "PLAN",
          targetId: "plan",
          targetLabel: "Plan de trabajo",
          text: "Les comparto el plan para este cuatrimestre. Cualquier cosa que vean en casa o en el aula, la pueden sumar acá.",
          createdAt: daysAgo(18),
        },
        {
          treatmentId: treatment.id,
          authorId: roberto.id,
          authorRole: "family",
          authorRelationship: "Padre",
          targetType: "GOAL",
          targetId: "seed-escuela-g2",
          targetLabel: "Que anticipe los cambios de actividad con la agenda visual.",
          text: "En casa empezamos a usar la agenda visual a la mañana y le está sirviendo.",
          createdAt: daysAgo(10),
        },
        {
          treatmentId: treatment.id,
          authorId: marta.id,
          authorRole: "education",
          authorRelationship: "Docente de grado",
          targetType: "GOAL",
          targetId: "seed-escuela-g1",
          targetLabel: "Que participe en un juego grupal durante el recreo.",
          text: "Esta semana jugó a la mancha con dos compañeros sin que se lo propongamos.",
          createdAt: daysAgo(4),
        },
      ],
    });
  }

  console.log("✅ Red de apoyo de Tomás Ruiz: red.familia@test.com y red.docente@test.com / 123456");
  console.log(`   Invitación vigente: /invitacion/${SEED_PENDING_TOKEN}`);
  console.log(`   Invitación vencida: /invitacion/${SEED_EXPIRED_TOKEN}`);
}

// Ejecución directa: node prisma/seed-network.js
// (en Windows la letra de la unidad puede venir en otra mayúscula, por eso se compara en minúsculas)
const isDirectRun =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isDirectRun) {
  const prisma = new PrismaClient();
  seedSupportNetwork(prisma)
    .catch((error) => {
      console.error("❌ Error cargando la red de apoyo:", error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}

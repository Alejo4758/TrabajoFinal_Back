-- CreateEnum
CREATE TYPE "Parentesco" AS ENUM ('TITULAR', 'MADRE_PADRE', 'HIJO', 'HERMANO', 'ABUELO', 'PAREJA', 'TUTOR_LEGAL', 'OTRO');

-- CreateEnum
CREATE TYPE "EstadoAcompanamiento" AS ENUM ('ACTIVO', 'EN_PAUSA', 'FINALIZADO');

-- CreateTable
CREATE TABLE "Paciente" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,
    "apellidos" TEXT NOT NULL,
    "fecha_nac" DATE,
    "parentesco" "Parentesco" NOT NULL,
    "diagnostico" TEXT,
    "notas" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tutorId" INTEGER NOT NULL,

    CONSTRAINT "Paciente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Acompanamiento" (
    "id" SERIAL NOT NULL,
    "estado" "EstadoAcompanamiento" NOT NULL DEFAULT 'ACTIVO',
    "fecha_inicio" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "pacienteId" INTEGER NOT NULL,
    "perfilATId" INTEGER NOT NULL,

    CONSTRAINT "Acompanamiento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanTrabajo" (
    "id" SERIAL NOT NULL,
    "contenido" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "acompanamientoId" INTEGER NOT NULL,

    CONSTRAINT "PlanTrabajo_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Actividad_Calendario" ADD COLUMN     "pacienteId" INTEGER;

-- AlterTable (manual: se agrega opcional, se completa con los datos existentes y recién después pasa a obligatoria)
ALTER TABLE "SolicitudVinculacion" ADD COLUMN     "pacienteId" INTEGER;

-- ============================================================================
-- Migración de datos (manual)
-- Hasta acá el usuario cliente ERA el paciente. Para no perder nada, a cada usuario que ya
-- tenía solicitudes o actividades se le crea un paciente con su mismo nombre (parentesco
-- TITULAR = "soy yo") y todo lo que tenía pasa a apuntar a ese paciente.
-- Si en realidad la cuenta es de un familiar, se corrige después desde la app.
-- ============================================================================

INSERT INTO "Paciente" ("nombre", "apellidos", "parentesco", "updatedAt", "tutorId")
SELECT u."nombre", u."apellidos", 'TITULAR', CURRENT_TIMESTAMP, u."id"
FROM "Usuario" u
WHERE u."id" IN (
    SELECT "clienteId" FROM "SolicitudVinculacion"
    UNION
    SELECT "usuarioId" FROM "Actividad_Calendario" WHERE "usuarioId" IS NOT NULL
);

-- En este punto cada tutor tiene un único paciente (el recién creado), así que el cruce no es ambiguo
UPDATE "SolicitudVinculacion" s
SET "pacienteId" = p."id"
FROM "Paciente" p
WHERE p."tutorId" = s."clienteId";

UPDATE "Actividad_Calendario" a
SET "pacienteId" = p."id"
FROM "Paciente" p
WHERE p."tutorId" = a."usuarioId";

-- Un acompañamiento por cada par paciente / A.T. que ya tenía una solicitud aceptada
INSERT INTO "Acompanamiento" ("pacienteId", "perfilATId", "fecha_inicio", "updatedAt")
SELECT s."pacienteId", s."perfilATId", MIN(s."updatedAt"), CURRENT_TIMESTAMP
FROM "SolicitudVinculacion" s
WHERE s."estado" = 'ACEPTADA'
GROUP BY s."pacienteId", s."perfilATId";

-- Ya con todas las solicitudes completas, la columna pasa a ser obligatoria
ALTER TABLE "SolicitudVinculacion" ALTER COLUMN "pacienteId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Paciente_tutorId_idx" ON "Paciente"("tutorId");

-- CreateIndex
CREATE INDEX "Acompanamiento_perfilATId_estado_idx" ON "Acompanamiento"("perfilATId", "estado");

-- CreateIndex
CREATE UNIQUE INDEX "Acompanamiento_pacienteId_perfilATId_key" ON "Acompanamiento"("pacienteId", "perfilATId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanTrabajo_acompanamientoId_key" ON "PlanTrabajo"("acompanamientoId");

-- CreateIndex
CREATE INDEX "Actividad_Calendario_pacienteId_fecha_inicio_idx" ON "Actividad_Calendario"("pacienteId", "fecha_inicio");

-- CreateIndex
CREATE INDEX "SolicitudVinculacion_pacienteId_idx" ON "SolicitudVinculacion"("pacienteId");

-- AddForeignKey
ALTER TABLE "Actividad_Calendario" ADD CONSTRAINT "Actividad_Calendario_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "Paciente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SolicitudVinculacion" ADD CONSTRAINT "SolicitudVinculacion_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "Paciente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Paciente" ADD CONSTRAINT "Paciente_tutorId_fkey" FOREIGN KEY ("tutorId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Acompanamiento" ADD CONSTRAINT "Acompanamiento_pacienteId_fkey" FOREIGN KEY ("pacienteId") REFERENCES "Paciente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Acompanamiento" ADD CONSTRAINT "Acompanamiento_perfilATId_fkey" FOREIGN KEY ("perfilATId") REFERENCES "PerfilAT"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanTrabajo" ADD CONSTRAINT "PlanTrabajo_acompanamientoId_fkey" FOREIGN KEY ("acompanamientoId") REFERENCES "Acompanamiento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Índice único parcial (manual: Prisma no soporta índices parciales en el schema)
-- La solicitud pendiente única pasa de ser por cliente a ser por paciente: un tutor con dos pacientes
-- puede pedir el mismo A.T. para cada uno, pero no dos veces para el mismo paciente.
DROP INDEX IF EXISTS "SolicitudVinculacion_pendiente_unica";
CREATE UNIQUE INDEX "SolicitudVinculacion_pendiente_unica" ON "SolicitudVinculacion"("pacienteId", "perfilATId") WHERE "estado" = 'PENDIENTE';

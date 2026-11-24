-- CreateEnum
CREATE TYPE "RolRed" AS ENUM ('FAMILIA', 'EDUCACION', 'SALUD', 'OTRO');

-- CreateEnum
CREATE TYPE "SeccionRed" AS ENUM ('PLAN', 'ENCUENTROS', 'EVOLUCION', 'INFORMES');

-- CreateEnum
CREATE TYPE "EstadoIntegranteRed" AS ENUM ('PENDIENTE', 'ACTIVO');

-- CreateEnum
CREATE TYPE "DestinoAporte" AS ENUM ('PLAN', 'ENCUENTRO', 'OBJETIVO');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'RED_APOYO';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TipoNotificacion" ADD VALUE 'RED_INVITACION_ACEPTADA';
ALTER TYPE "TipoNotificacion" ADD VALUE 'RED_APORTE';

-- AlterTable
ALTER TABLE "Usuario" ALTER COLUMN "tipo_doc" DROP NOT NULL,
ALTER COLUMN "nro_doc" DROP NOT NULL;

-- CreateTable
CREATE TABLE "IntegranteRed" (
    "id" SERIAL NOT NULL,
    "correo" TEXT NOT NULL,
    "nombre" TEXT,
    "rol" "RolRed" NOT NULL,
    "vinculo" TEXT,
    "accesos" "SeccionRed"[],
    "estado" "EstadoIntegranteRed" NOT NULL DEFAULT 'PENDIENTE',
    "token_hash" TEXT,
    "fecha_invitacion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vence" TIMESTAMP(3) NOT NULL,
    "fecha_aceptacion" TIMESTAMP(3),
    "acompanamientoId" INTEGER NOT NULL,
    "usuarioId" INTEGER,

    CONSTRAINT "IntegranteRed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Aporte" (
    "id" SERIAL NOT NULL,
    "destino_tipo" "DestinoAporte" NOT NULL,
    "destino_id" TEXT NOT NULL,
    "destino" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "rol_autor" TEXT NOT NULL,
    "vinculo_autor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editado_en" TIMESTAMP(3),
    "oculto_en" TIMESTAMP(3),
    "oculto_por" INTEGER,
    "acompanamientoId" INTEGER NOT NULL,
    "autorId" INTEGER NOT NULL,

    CONSTRAINT "Aporte_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IntegranteRed_token_hash_key" ON "IntegranteRed"("token_hash");

-- CreateIndex
CREATE INDEX "IntegranteRed_usuarioId_idx" ON "IntegranteRed"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "IntegranteRed_acompanamientoId_correo_key" ON "IntegranteRed"("acompanamientoId", "correo");

-- CreateIndex
CREATE INDEX "Aporte_acompanamientoId_createdAt_idx" ON "Aporte"("acompanamientoId", "createdAt");

-- AddForeignKey
ALTER TABLE "IntegranteRed" ADD CONSTRAINT "IntegranteRed_acompanamientoId_fkey" FOREIGN KEY ("acompanamientoId") REFERENCES "Acompanamiento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegranteRed" ADD CONSTRAINT "IntegranteRed_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Aporte" ADD CONSTRAINT "Aporte_oculto_por_fkey" FOREIGN KEY ("oculto_por") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Aporte" ADD CONSTRAINT "Aporte_acompanamientoId_fkey" FOREIGN KEY ("acompanamientoId") REFERENCES "Acompanamiento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Aporte" ADD CONSTRAINT "Aporte_autorId_fkey" FOREIGN KEY ("autorId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

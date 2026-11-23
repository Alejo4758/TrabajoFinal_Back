-- Informes periódicos del A.T. por acompañamiento y destinatario (Feature 15).

-- CreateEnum
CREATE TYPE "DestinatarioInforme" AS ENUM ('OBRA_SOCIAL', 'ESCUELA', 'FAMILIA', 'EQUIPO_MEDICO');

-- CreateEnum
CREATE TYPE "EstadoInforme" AS ENUM ('BORRADOR', 'FINALIZADO');

-- CreateTable
CREATE TABLE "Informe" (
    "id" SERIAL NOT NULL,
    "titulo" TEXT NOT NULL,
    "contenido" TEXT NOT NULL,
    "destinatario" "DestinatarioInforme" NOT NULL,
    "periodo_desde" DATE NOT NULL,
    "periodo_hasta" DATE NOT NULL,
    "estado" "EstadoInforme" NOT NULL DEFAULT 'BORRADOR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "acompanamientoId" INTEGER NOT NULL,

    CONSTRAINT "Informe_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Informe_acompanamientoId_createdAt_idx" ON "Informe"("acompanamientoId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "Informe" ADD CONSTRAINT "Informe_acompanamientoId_fkey" FOREIGN KEY ("acompanamientoId") REFERENCES "Acompanamiento"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- Agregado a mano (Prisma no soporta CHECK en el schema): el período no puede terminar antes de empezar
ALTER TABLE "Informe" ADD CONSTRAINT "Informe_periodo_check" CHECK ("periodo_hasta" >= "periodo_desde");

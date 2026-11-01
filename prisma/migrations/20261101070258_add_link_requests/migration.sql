-- CreateEnum
CREATE TYPE "EstadoSolicitud" AS ENUM ('PENDIENTE', 'ACEPTADA', 'RECHAZADA');

-- CreateTable
CREATE TABLE "SolicitudVinculacion" (
    "id" SERIAL NOT NULL,
    "descripcion" TEXT NOT NULL,
    "localidad" TEXT NOT NULL,
    "obras_sociales" TEXT[],
    "otra_cobertura" BOOLEAN NOT NULL,
    "estado" "EstadoSolicitud" NOT NULL DEFAULT 'PENDIENTE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "clienteId" INTEGER NOT NULL,
    "perfilATId" INTEGER NOT NULL,

    CONSTRAINT "SolicitudVinculacion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SolicitudVinculacion_perfilATId_estado_idx" ON "SolicitudVinculacion"("perfilATId", "estado");

-- CreateIndex
CREATE INDEX "SolicitudVinculacion_clienteId_idx" ON "SolicitudVinculacion"("clienteId");

-- AddForeignKey
ALTER TABLE "SolicitudVinculacion" ADD CONSTRAINT "SolicitudVinculacion_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SolicitudVinculacion" ADD CONSTRAINT "SolicitudVinculacion_perfilATId_fkey" FOREIGN KEY ("perfilATId") REFERENCES "PerfilAT"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- CreateIndex (manual: Prisma no soporta índices parciales en el schema)
-- Garantiza una sola solicitud pendiente por cliente y A.T., aunque lleguen dos requests al mismo tiempo
CREATE UNIQUE INDEX "SolicitudVinculacion_pendiente_unica" ON "SolicitudVinculacion"("clienteId", "perfilATId") WHERE "estado" = 'PENDIENTE';

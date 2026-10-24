/*
  Warnings:

  - A unique constraint covering the columns `[georef_id]` on the table `Localidad` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Mensaje_conv_id_idx";

-- AlterTable
ALTER TABLE "Conversacion_Usuario" ADD COLUMN     "ultima_lectura" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Localidad" ADD COLUMN     "departamento" TEXT,
ADD COLUMN     "georef_id" TEXT,
ADD COLUMN     "provincia" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Localidad_georef_id_key" ON "Localidad"("georef_id");

-- CreateIndex
CREATE INDEX "Localidad_provincia_nombre_idx" ON "Localidad"("provincia", "nombre");

-- CreateIndex
CREATE INDEX "idx_mensaje_conv_fecha" ON "Mensaje"("conv_id", "createdAt" DESC);

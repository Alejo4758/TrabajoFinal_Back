-- CreateEnum
CREATE TYPE "TipoSugerencia" AS ENUM ('ESPECIALIDAD', 'OBRA_SOCIAL');

-- CreateEnum
CREATE TYPE "EstadoSugerencia" AS ENUM ('PENDIENTE', 'APROBADA', 'RECHAZADA');

-- CreateTable
CREATE TABLE "SugerenciaCatalogo" (
    "id" SERIAL NOT NULL,
    "tipo" "TipoSugerencia" NOT NULL,
    "nombre" TEXT NOT NULL,
    "estado" "EstadoSugerencia" NOT NULL DEFAULT 'PENDIENTE',
    "observaciones" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_revision" TIMESTAMP(3),
    "perfilATId" INTEGER NOT NULL,
    "adminId" INTEGER,

    CONSTRAINT "SugerenciaCatalogo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SugerenciaCatalogo_estado_tipo_idx" ON "SugerenciaCatalogo"("estado", "tipo");

-- CreateIndex
CREATE INDEX "SugerenciaCatalogo_perfilATId_idx" ON "SugerenciaCatalogo"("perfilATId");

-- AddForeignKey
ALTER TABLE "SugerenciaCatalogo" ADD CONSTRAINT "SugerenciaCatalogo_perfilATId_fkey" FOREIGN KEY ("perfilATId") REFERENCES "PerfilAT"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SugerenciaCatalogo" ADD CONSTRAINT "SugerenciaCatalogo_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

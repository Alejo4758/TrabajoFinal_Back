-- CreateTable
CREATE TABLE "Encuentro" (
    "id" SERIAL NOT NULL,
    "fecha" DATE NOT NULL,
    "duracion_min" INTEGER NOT NULL,
    "ambitoId" TEXT NOT NULL,
    "ambito" TEXT NOT NULL,
    "actividades" TEXT[],
    "observaciones" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "acompanamientoId" INTEGER NOT NULL,

    CONSTRAINT "Encuentro_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EncuentroObjetivo" (
    "id" SERIAL NOT NULL,
    "objetivoId" TEXT NOT NULL,
    "objetivo" TEXT NOT NULL,
    "nivel" INTEGER NOT NULL,
    "nota" TEXT,
    "encuentroId" INTEGER NOT NULL,

    CONSTRAINT "EncuentroObjetivo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Encuentro_acompanamientoId_fecha_idx" ON "Encuentro"("acompanamientoId", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "EncuentroObjetivo_encuentroId_objetivoId_key" ON "EncuentroObjetivo"("encuentroId", "objetivoId");

-- AddForeignKey
ALTER TABLE "Encuentro" ADD CONSTRAINT "Encuentro_acompanamientoId_fkey" FOREIGN KEY ("acompanamientoId") REFERENCES "Acompanamiento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EncuentroObjetivo" ADD CONSTRAINT "EncuentroObjetivo_encuentroId_fkey" FOREIGN KEY ("encuentroId") REFERENCES "Encuentro"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Restricciones manuales (Prisma no soporta CHECK en el schema): la API ya las valida,
-- esto evita que un dato fuera de rango llegue a la base por otro camino
ALTER TABLE "EncuentroObjetivo" ADD CONSTRAINT "EncuentroObjetivo_nivel_rango" CHECK ("nivel" BETWEEN 1 AND 5);
ALTER TABLE "Encuentro" ADD CONSTRAINT "Encuentro_duracion_rango" CHECK ("duracion_min" BETWEEN 5 AND 480);

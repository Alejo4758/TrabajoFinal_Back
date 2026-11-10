-- El encuentro pasa de tener solo fecha a tener fecha y hora de inicio, y se vincula con su sesión del calendario.

-- DropIndex
DROP INDEX "Encuentro_acompanamientoId_fecha_idx";

-- AlterTable: la columna nueva se completa a partir de la fecha anterior (00:00 en Argentina) antes de hacerla obligatoria.
-- Si un paciente tenía más de un encuentro el mismo día, se separan por minutos para que entren en el índice único
ALTER TABLE "Encuentro" ADD COLUMN "actividadId" INTEGER,
ADD COLUMN "fecha_inicio" TIMESTAMP(3);

UPDATE "Encuentro" e
SET "fecha_inicio" = ((e."fecha"::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires') AT TIME ZONE 'UTC')
  + (o.n - 1) * INTERVAL '1 minute'
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "acompanamientoId", "fecha" ORDER BY "id") AS n
  FROM "Encuentro"
) o
WHERE o."id" = e."id";

ALTER TABLE "Encuentro" ALTER COLUMN "fecha_inicio" SET NOT NULL;
ALTER TABLE "Encuentro" DROP COLUMN "fecha";

-- CreateIndex
CREATE UNIQUE INDEX "Encuentro_actividadId_key" ON "Encuentro"("actividadId");

-- CreateIndex
CREATE UNIQUE INDEX "Encuentro_acompanamientoId_fecha_inicio_key" ON "Encuentro"("acompanamientoId", "fecha_inicio");

-- AddForeignKey
ALTER TABLE "Encuentro" ADD CONSTRAINT "Encuentro_actividadId_fkey" FOREIGN KEY ("actividadId") REFERENCES "Actividad_Calendario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterEnum
ALTER TYPE "TipoNotificacion" ADD VALUE 'RECORDATORIO_ACTIVIDAD';

-- DropForeignKey
ALTER TABLE "Actividad_Calendario" DROP CONSTRAINT "Actividad_Calendario_usuarioId_fkey";

-- AlterTable
ALTER TABLE "Actividad_Calendario" ALTER COLUMN "usuarioId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Actividad_Calendario" ADD CONSTRAINT "Actividad_Calendario_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

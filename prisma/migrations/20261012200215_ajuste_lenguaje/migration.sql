-- AlterTable
ALTER TABLE "Usuario"
ALTER COLUMN "rol" TYPE "Role" USING ("rol"::"Role");

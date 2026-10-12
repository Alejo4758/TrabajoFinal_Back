/*
  Warnings:

  - You are about to drop the column `updatedAt` on the `Usuario` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[verificationToken]` on the table `Usuario` will be added. If there are existing duplicate values, this will fail.
  - Changed the type of `rol` on the `Usuario` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "Usuario" DROP COLUMN "updatedAt",
ADD COLUMN     "emailVerificado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tokenExpira" TIMESTAMP(3),
ADD COLUMN     "verificationToken" TEXT,
DROP COLUMN "rol",
ADD COLUMN     "rol" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_verificationToken_key" ON "Usuario"("verificationToken");

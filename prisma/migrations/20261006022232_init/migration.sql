-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CLIENTE', 'AT', 'ADMIN');

-- CreateEnum
CREATE TYPE "EstadoAT" AS ENUM ('PENDIENTE', 'APROBADO', 'RECHAZADO');

-- CreateTable
CREATE TABLE "Usuario" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "apellidos" TEXT NOT NULL,
    "tipo_doc" TEXT NOT NULL,
    "nro_doc" TEXT NOT NULL,
    "rol" "Role" NOT NULL DEFAULT 'CLIENTE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerfilAT" (
    "id" SERIAL NOT NULL,
    "fecha_nac" TIMESTAMP(3) NOT NULL,
    "estado" "EstadoAT" NOT NULL DEFAULT 'PENDIENTE',
    "usuarioId" INTEGER NOT NULL,

    CONSTRAINT "PerfilAT_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentoAT" (
    "id" SERIAL NOT NULL,
    "titulo" TEXT NOT NULL,
    "urlArchivo" TEXT NOT NULL,
    "perfilATId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentoAT_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_nro_doc_key" ON "Usuario"("nro_doc");

-- CreateIndex
CREATE UNIQUE INDEX "PerfilAT_usuarioId_key" ON "PerfilAT"("usuarioId");

-- AddForeignKey
ALTER TABLE "PerfilAT" ADD CONSTRAINT "PerfilAT_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentoAT" ADD CONSTRAINT "DocumentoAT_perfilATId_fkey" FOREIGN KEY ("perfilATId") REFERENCES "PerfilAT"("id") ON DELETE CASCADE ON UPDATE CASCADE;

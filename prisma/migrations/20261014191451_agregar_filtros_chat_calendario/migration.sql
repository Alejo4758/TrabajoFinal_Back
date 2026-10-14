-- CreateEnum
CREATE TYPE "TipoActividad" AS ENUM ('SESION', 'ENTREVISTA', 'REUNION', 'OTRO');

-- CreateEnum
CREATE TYPE "EstadoActividad" AS ENUM ('PENDIENTE', 'CONFIRMADO', 'CANCELADO', 'COMPLETADO');

-- AlterTable
ALTER TABLE "PerfilAT" ADD COLUMN     "estudios" TEXT,
ADD COLUMN     "genero" TEXT;

-- AlterTable
ALTER TABLE "Usuario" ALTER COLUMN "rol" SET DEFAULT 'CLIENTE';

-- CreateTable
CREATE TABLE "Admin" (
    "id" SERIAL NOT NULL,
    "usuarioId" INTEGER NOT NULL,

    CONSTRAINT "Admin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Validacion" (
    "id" SERIAL NOT NULL,
    "estado" "EstadoAT" NOT NULL DEFAULT 'PENDIENTE',
    "observaciones" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "adminId" INTEGER,
    "perfilATId" INTEGER NOT NULL,

    CONSTRAINT "Validacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Localidad" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,

    CONSTRAINT "Localidad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AT_Localidad" (
    "atId" INTEGER NOT NULL,
    "localidadId" INTEGER NOT NULL,

    CONSTRAINT "AT_Localidad_pkey" PRIMARY KEY ("atId","localidadId")
);

-- CreateTable
CREATE TABLE "Especialidad" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,

    CONSTRAINT "Especialidad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AT_Especialidad" (
    "atId" INTEGER NOT NULL,
    "espId" INTEGER NOT NULL,

    CONSTRAINT "AT_Especialidad_pkey" PRIMARY KEY ("atId","espId")
);

-- CreateTable
CREATE TABLE "ObraSocial" (
    "id" SERIAL NOT NULL,
    "nombre" TEXT NOT NULL,

    CONSTRAINT "ObraSocial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AT_OSoc" (
    "atId" INTEGER NOT NULL,
    "osId" INTEGER NOT NULL,

    CONSTRAINT "AT_OSoc_pkey" PRIMARY KEY ("atId","osId")
);

-- CreateTable
CREATE TABLE "Experiencia" (
    "id" SERIAL NOT NULL,
    "titulo" TEXT NOT NULL,
    "fecha_inicio" TIMESTAMP(3) NOT NULL,
    "fecha_fin" TIMESTAMP(3),
    "descripcion" TEXT,
    "atId" INTEGER NOT NULL,

    CONSTRAINT "Experiencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisponibilidadHoraria" (
    "id" SERIAL NOT NULL,
    "dia_semana" INTEGER NOT NULL,
    "hora_inicio" TEXT NOT NULL,
    "hora_fin" TEXT NOT NULL,
    "atId" INTEGER NOT NULL,

    CONSTRAINT "DisponibilidadHoraria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversacion" (
    "id" SERIAL NOT NULL,
    "es_grupo" BOOLEAN NOT NULL DEFAULT false,
    "titulo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversacion_Usuario" (
    "conv_id" INTEGER NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "fecha_union" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fecha_salida" TIMESTAMP(3),

    CONSTRAINT "Conversacion_Usuario_pkey" PRIMARY KEY ("conv_id","usuario_id")
);

-- CreateTable
CREATE TABLE "Mensaje" (
    "id" SERIAL NOT NULL,
    "conv_id" INTEGER NOT NULL,
    "remitente_id" INTEGER NOT NULL,
    "contenido" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eliminado_en" TIMESTAMP(3),

    CONSTRAINT "Mensaje_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Actividad_Calendario" (
    "id" SERIAL NOT NULL,
    "atId" INTEGER NOT NULL,
    "usuarioId" INTEGER NOT NULL,
    "titulo" TEXT NOT NULL,
    "descripcion" TEXT,
    "ubicacion" TEXT,
    "tipo" "TipoActividad" NOT NULL DEFAULT 'SESION',
    "estado" "EstadoActividad" NOT NULL DEFAULT 'PENDIENTE',
    "fecha_inicio" TIMESTAMP(3) NOT NULL,
    "fecha_fin" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Actividad_Calendario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Admin_usuarioId_key" ON "Admin"("usuarioId");

-- CreateIndex
CREATE INDEX "Mensaje_conv_id_idx" ON "Mensaje"("conv_id");

-- CreateIndex
CREATE INDEX "Mensaje_remitente_id_idx" ON "Mensaje"("remitente_id");

-- CreateIndex
CREATE INDEX "Actividad_Calendario_atId_fecha_inicio_fecha_fin_idx" ON "Actividad_Calendario"("atId", "fecha_inicio", "fecha_fin");

-- CreateIndex
CREATE INDEX "Actividad_Calendario_usuarioId_fecha_inicio_idx" ON "Actividad_Calendario"("usuarioId", "fecha_inicio");

-- AddForeignKey
ALTER TABLE "Admin" ADD CONSTRAINT "Admin_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Validacion" ADD CONSTRAINT "Validacion_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Validacion" ADD CONSTRAINT "Validacion_perfilATId_fkey" FOREIGN KEY ("perfilATId") REFERENCES "PerfilAT"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AT_Localidad" ADD CONSTRAINT "AT_Localidad_atId_fkey" FOREIGN KEY ("atId") REFERENCES "PerfilAT"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AT_Localidad" ADD CONSTRAINT "AT_Localidad_localidadId_fkey" FOREIGN KEY ("localidadId") REFERENCES "Localidad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AT_Especialidad" ADD CONSTRAINT "AT_Especialidad_atId_fkey" FOREIGN KEY ("atId") REFERENCES "PerfilAT"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AT_Especialidad" ADD CONSTRAINT "AT_Especialidad_espId_fkey" FOREIGN KEY ("espId") REFERENCES "Especialidad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AT_OSoc" ADD CONSTRAINT "AT_OSoc_atId_fkey" FOREIGN KEY ("atId") REFERENCES "PerfilAT"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AT_OSoc" ADD CONSTRAINT "AT_OSoc_osId_fkey" FOREIGN KEY ("osId") REFERENCES "ObraSocial"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Experiencia" ADD CONSTRAINT "Experiencia_atId_fkey" FOREIGN KEY ("atId") REFERENCES "PerfilAT"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisponibilidadHoraria" ADD CONSTRAINT "DisponibilidadHoraria_atId_fkey" FOREIGN KEY ("atId") REFERENCES "PerfilAT"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversacion_Usuario" ADD CONSTRAINT "Conversacion_Usuario_conv_id_fkey" FOREIGN KEY ("conv_id") REFERENCES "Conversacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversacion_Usuario" ADD CONSTRAINT "Conversacion_Usuario_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mensaje" ADD CONSTRAINT "Mensaje_conv_id_fkey" FOREIGN KEY ("conv_id") REFERENCES "Conversacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mensaje" ADD CONSTRAINT "Mensaje_remitente_id_fkey" FOREIGN KEY ("remitente_id") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Actividad_Calendario" ADD CONSTRAINT "Actividad_Calendario_atId_fkey" FOREIGN KEY ("atId") REFERENCES "PerfilAT"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Actividad_Calendario" ADD CONSTRAINT "Actividad_Calendario_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

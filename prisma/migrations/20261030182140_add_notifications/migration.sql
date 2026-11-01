-- CreateEnum
CREATE TYPE "TipoNotificacion" AS ENUM ('CHAT_MENSAJE', 'SOLICITUD_ENTREVISTA', 'ESTADO_ENTREVISTA', 'PERFIL_VALIDADO');

-- CreateTable
CREATE TABLE "Notificacion" (
    "id" SERIAL NOT NULL,
    "usuario_id" INTEGER NOT NULL,
    "tipo" "TipoNotificacion" NOT NULL,
    "titulo" TEXT NOT NULL,
    "contenido" TEXT NOT NULL,
    "enlace" TEXT,
    "leido" BOOLEAN NOT NULL DEFAULT false,
    "creado_en" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notificacion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notificacion_usuario_id_leido_idx" ON "Notificacion"("usuario_id", "leido");

-- CreateIndex
CREATE INDEX "Notificacion_usuario_id_creado_en_idx" ON "Notificacion"("usuario_id", "creado_en" DESC);

-- AddForeignKey
ALTER TABLE "Notificacion" ADD CONSTRAINT "Notificacion_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;


import express, { Router } from "express";
import { verifyToken, requireRole } from "../middlewares/auth.middleware.js";
import {
  createLinkRequest,
  getReceivedLinkRequests,
  respondLinkRequest,
} from "../controllers/linkRequest.controller.js";

const router = Router();

// Parser propio con límite chico: el body de una solicitud no supera unos pocos KB.
// Esta ruta se monta en index.js antes del express.json() global para que este límite sea el que aplica.
router.use(express.json({ limit: "10kb" }));

// Rutas estáticas primero, antes de la ruta con parámetro (/:id)
// Solo los A.T. logueados pueden ver las solicitudes que recibieron
router.get("/received", verifyToken, requireRole("AT"), getReceivedLinkRequests);

// Solo los clientes logueados pueden enviar solicitudes
router.post("/", verifyToken, requireRole("CLIENT"), createLinkRequest);

// Solo los A.T. logueados pueden aceptar o rechazar las solicitudes que recibieron
router.patch("/:id", verifyToken, requireRole("AT"), respondLinkRequest);

// JSON mal formado o demasiado grande: respuesta en español, sin el stack de Express.
// Va al final para también atrapar cualquier error inesperado de las rutas de arriba.
router.use((err, req, res, next) => {
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "La solicitud es demasiado grande." });
  }

  if (err.type === "entity.parse.failed" || err.status === 400) {
    return res.status(400).json({ error: "El cuerpo de la solicitud no es un JSON válido." });
  }

  console.error("Error en link-requests:", err.message);
  return res.status(500).json({ error: "Error interno del servidor al enviar la solicitud." });
});

export default router;

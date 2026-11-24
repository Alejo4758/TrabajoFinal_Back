import { Router } from "express";
import { verifyToken, requireRole } from "../middlewares/auth.middleware.js";
import { listMyNetworks, getBoard } from "../controllers/supportNetwork.controller.js";

// Lo que pide el integrante de la red de apoyo logueado. Se monta en /api/network.
// Que sea integrante activo de ESE paciente (y qué secciones ve) lo resuelve el controlador en cada pedido
const router = Router();

router.use(verifyToken, requireRole("SUPPORT"));

router.get("/patients", listMyNetworks);
router.get("/patients/:patientId/board", getBoard);

export default router;

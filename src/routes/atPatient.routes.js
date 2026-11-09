import { Router } from "express";
import { verifyToken, requireRole } from "../middlewares/auth.middleware.js";
import { getPatientDetail, savePatientPlan } from "../controllers/atPatient.controller.js";

const router = Router();

// Pacientes del A.T. logueado. El controlador verifica en cada pedido que exista
// un acompañamiento entre ese A.T. (sale del token) y el paciente de la URL
router.use(verifyToken, requireRole("AT"));

router.get("/:patientId", getPatientDetail);
router.put("/:patientId/plan", savePatientPlan);

export default router;

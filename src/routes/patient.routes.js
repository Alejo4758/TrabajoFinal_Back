import { Router } from "express";
import { verifyToken, requireRole } from "../middlewares/auth.middleware.js";
import { getMyPatients, createPatient, updatePatient } from "../controllers/patient.controller.js";

const router = Router();

// Personas a cargo del titular de la cuenta. Solo los clientes tienen pacientes,
// y cada uno ve y modifica únicamente los suyos (el titular sale del token)
router.use(verifyToken, requireRole("CLIENT"));

router.get("/", getMyPatients);
router.post("/", createPatient);
router.patch("/:id", updatePatient);

export default router;

import { Router } from "express";
import { verifyToken, requireRole } from "../middlewares/auth.middleware.js";
import {
  generateDraft,
  refineDraft,
  listReports,
  getReport,
  createReport,
  updateReport,
} from "../controllers/report.controller.js";

// Informes de un paciente. Se monta en /api/patients/:patientId/reports (mergeParams para leer :patientId).
// Acá se filtra por rol; que el usuario tenga acceso a ESE paciente y a ESE informe (anti-IDOR) lo verifica
// el controlador en cada pedido, con la identidad del token
const router = Router({ mergeParams: true });

router.use(verifyToken, requireRole("AT", "ADMIN"));

// Generar, revisar por chat y crear: solo el A.T. que acompaña al paciente (es el autor del informe)
router.post("/generate-draft", requireRole("AT"), generateDraft);
router.post("/refine-draft", requireRole("AT"), refineDraft);
router.post("/", requireRole("AT"), createReport);

// Consultar y editar: el A.T. sus propios informes; el ADMIN, cualquiera
router.get("/", listReports);
router.get("/:reportId", getReport);
router.put("/:reportId", updateReport);

export default router;

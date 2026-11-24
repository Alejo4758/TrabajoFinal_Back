import { Router } from "express";
import { verifyToken, requireRole } from "../middlewares/auth.middleware.js";
import {
  listContributions,
  createContribution,
  updateContribution,
  deleteContribution,
  setContributionVisibility,
} from "../controllers/contribution.controller.js";

// Aportes de la red de apoyo de un paciente. Se monta en /api/patients/:patientId/contributions (mergeParams para leer
// :patientId). Acá se filtra por rol; el acceso a ESE paciente, las secciones y quién es el autor los resuelve el
// controlador en cada pedido, con la identidad del token
const router = Router({ mergeParams: true });

router.use(verifyToken, requireRole("AT", "SUPPORT"));

router.get("/", listContributions);
router.post("/", createContribution);
router.patch("/:id/visibility", setContributionVisibility);
router.patch("/:id", updateContribution);
router.delete("/:id", deleteContribution);

export default router;

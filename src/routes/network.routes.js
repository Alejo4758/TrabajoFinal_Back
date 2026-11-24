import { Router } from "express";
import { verifyToken, requireRole } from "../middlewares/auth.middleware.js";
import {
  listNetwork,
  inviteMember,
  resendInvitation,
  cancelInvitation,
  removeMember,
  updateMemberAccess,
} from "../controllers/network.controller.js";

// Red de apoyo de un paciente, del lado del A.T. Se monta en /api/at/patients/:patientId/network (mergeParams para
// leer :patientId). Que el A.T. del token acompañe a ESE paciente lo verifica el controlador en cada pedido
const router = Router({ mergeParams: true });

router.use(verifyToken, requireRole("AT"));

router.get("/", listNetwork);
router.post("/invitations", inviteMember);
router.post("/invitations/:memberId/resend", resendInvitation);
router.delete("/invitations/:memberId", cancelInvitation);
router.delete("/members/:memberId", removeMember);
router.patch("/members/:memberId", updateMemberAccess);

export default router;

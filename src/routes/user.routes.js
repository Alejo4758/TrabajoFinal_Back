import { Router } from "express";
import { verifyToken, requireSelfOrAdmin } from "../middlewares/auth.middleware.js";
import { uploadAvatarFile } from "../middlewares/upload.middleware.js";
import { uploadAvatar } from "../controllers/user.controller.js";

const router = Router();

// POST /api/users/:id/avatar — sube o reemplaza la foto de perfil
// El orden es parte de la seguridad (prevención de IDOR):
//   1. verifyToken        -> identifica a quien hace la petición a partir del JWT
//   2. requireSelfOrAdmin -> 403 si el :id no es el suyo y no es ADMIN
//   3. uploadAvatarFile   -> recién acá Multer lee el archivo (upload.single("avatar"))
//   4. uploadAvatar       -> Cloudinary + Prisma
// Un pedido sobre la cuenta de otro se rechaza en el paso 2, sin llegar a leer el archivo ni tocar Cloudinary.
router.post(
  "/:id/avatar",
  verifyToken,
  requireSelfOrAdmin,
  uploadAvatarFile,
  uploadAvatar
);

export default router;

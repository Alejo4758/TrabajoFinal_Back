import { Router } from "express";
import { register, registerAT, login, logout, verifyEmail } from "../controllers/auth.controller.js";
import upload from "../middlewares/upload.middleware.js";

const router = Router();

// Registro normal (Clientes)
router.post("/register", register);

// Registro de AT con subida de archivo (El nombre "credentials" debe coincidir con el del frontend)
router.post("/register-at", upload.single("credentials"), registerAT);

// Rutas de sesión y verificación
router.get("/verify-email", verifyEmail);
router.post("/login", login);
router.post("/logout", logout);

export default router;
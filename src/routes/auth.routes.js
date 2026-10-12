import { Router } from "express";
import { register, login, logout, verifyEmail } from "../controllers/auth.controller.js";

const router = Router();

router.post("/register", register);
router.get("/verify-email", verifyEmail);
router.post("/login", login);
router.post("/logout", logout);

export default router;

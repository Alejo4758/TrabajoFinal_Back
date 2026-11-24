import { Router } from "express";
import rateLimit from "express-rate-limit";
import { getInvitation, acceptInvitation } from "../controllers/invitation.controller.js";

// Invitaciones a la red de apoyo, del lado del invitado. Se monta en /api/invitations y NO lleva autenticación:
// lo que identifica al pedido es el token del enlace. Por eso tiene límite de pedidos por IP, para que no se puedan
// probar tokens ni contraseñas a ciegas. El límite es en memoria (por proceso), igual que el cupo de la IA de informes
const limitReached = (req, res) =>
  res.status(429).json({ error: "Hiciste muchos pedidos seguidos. Esperá unos minutos e intentá nuevamente.", code: "rate_limited" });

const WINDOW_MS = 15 * 60 * 1000;

const viewLimiter = rateLimit({ windowMs: WINDOW_MS, limit: 60, standardHeaders: "draft-7", legacyHeaders: false, handler: limitReached });
// Crear la cuenta es más caro (bcrypt) y más sensible
const acceptLimiter = rateLimit({ windowMs: WINDOW_MS, limit: 10, standardHeaders: "draft-7", legacyHeaders: false, handler: limitReached });

const router = Router();

router.get("/:token", viewLimiter, getInvitation);
router.post("/:token/accept", acceptLimiter, acceptInvitation);

export default router;

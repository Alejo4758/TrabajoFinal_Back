import { Router } from 'express';
import { verifyToken, requireRole } from '../middlewares/auth.middleware.js';
import {
    getPendingATs,
    getAllATs,
    reviewAT
} from '../controllers/admin.controller.js';

const router = Router();

// Todas las rutas de administración requieren un usuario ADMIN logueado
router.use(verifyToken, requireRole('ADMIN'));

router.get('/at/pending', getPendingATs);
router.get('/at', getAllATs);
router.patch('/at/:id/validation', reviewAT);

export default router;

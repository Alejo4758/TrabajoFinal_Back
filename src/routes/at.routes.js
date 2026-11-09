import { Router } from 'express';
import {
    searchATs,
    getATById,
    getFilterOptions
} from '../controllers/at.controller.js';
import { getMyDashboard } from '../controllers/atDashboard.controller.js';
import { getMyProfile, updateMyProfile } from '../controllers/atProfile.controller.js';
import { verifyToken, requireRole } from '../middlewares/auth.middleware.js';

const router = Router();

// Rutas estáticas primero
router.get('/search', searchATs);
router.get('/filters-options', getFilterOptions); // <-- Habilita GET /ats/filters-options
router.get('/me/dashboard', verifyToken, requireRole('AT'), getMyDashboard); // <-- Antes de '/:id': es estática
// Perfil profesional del A.T. logueado (sale del token): lo que completa después del registro
router.get('/me/profile', verifyToken, requireRole('AT'), getMyProfile);
router.put('/me/profile', verifyToken, requireRole('AT'), updateMyProfile);

// Ruta con parámetro dinámico al final
router.get('/:id', getATById);

export default router;
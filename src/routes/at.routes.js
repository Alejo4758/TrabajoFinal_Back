import { Router } from 'express';
import {
    searchATs,
    getATById,
    getFilterOptions
} from '../controllers/at.controller.js';
import { getMyDashboard } from '../controllers/atDashboard.controller.js';
import { verifyToken, requireRole } from '../middlewares/auth.middleware.js';

const router = Router();

// Rutas estáticas primero
router.get('/search', searchATs);
router.get('/filters-options', getFilterOptions); // <-- Habilita GET /ats/filters-options
router.get('/me/dashboard', verifyToken, requireRole('AT'), getMyDashboard); // <-- Antes de '/:id': es estática

// Ruta con parámetro dinámico al final
router.get('/:id', getATById);

export default router;
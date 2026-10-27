import { Router } from 'express';
import { 
    searchATs, 
    getATById, 
    getFilterOptions 
} from '../controllers/at.controller.js';

const router = Router();

// Rutas estáticas primero
router.get('/search', searchATs);
router.get('/filters-options', getFilterOptions); // <-- Habilita GET /ats/filters-options

// Ruta con parámetro dinámico al final
router.get('/:id', getATById);

export default router;
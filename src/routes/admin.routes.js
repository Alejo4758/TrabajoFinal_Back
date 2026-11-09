import { Router } from 'express';
import { verifyToken, requireRole } from '../middlewares/auth.middleware.js';
import {
    getPendingATs,
    getAllATs,
    reviewAT
} from '../controllers/admin.controller.js';
import { getCatalogs, getCatalogSuggestions, reviewCatalogSuggestion } from '../controllers/catalogSuggestion.controller.js';

const router = Router();

// Todas las rutas de administración requieren un usuario ADMIN logueado
router.use(verifyToken, requireRole('ADMIN'));

router.get('/at/pending', getPendingATs);
router.get('/at', getAllATs);
router.patch('/at/:id/validation', reviewAT);

// Especialidades y obras sociales que sugieren los A.T. porque no están en la lista
router.get('/catalog-suggestions', getCatalogSuggestions);
router.patch('/catalog-suggestions/:id/review', reviewCatalogSuggestion);
// Especialidades y obras sociales registradas, para buscar si lo que piden ya está con otro nombre
router.get('/catalogs', getCatalogs);

export default router;

import { Router } from 'express';
import { searchATs, getATById } from '../controllers/at.controller.js';

const router = Router();

// Coincide con: `${BASE_URL}/ats/search`
router.get('/search', searchATs);

// Coincide con: `${BASE_URL}/at/${id}`
router.get('/:id', getATById);

export default router;
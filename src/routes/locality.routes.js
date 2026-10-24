import { Router } from 'express';
import {
    getDepartments,
    getLocalities,
    getProvinces
} from '../controllers/locality.controller.js';

const router = Router();

router.get('/provinces', getProvinces);
router.get('/departments', getDepartments);
router.get('/', getLocalities);

export default router;

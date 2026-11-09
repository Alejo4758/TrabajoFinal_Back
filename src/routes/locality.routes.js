import { Router } from 'express';
import {
    getDepartments,
    getLocalities,
    getLocalityOptions,
    getProvinces
} from '../controllers/locality.controller.js';

const router = Router();

router.get('/provinces', getProvinces);
router.get('/departments', getDepartments);
router.get('/options', getLocalityOptions);
router.get('/', getLocalities);

export default router;

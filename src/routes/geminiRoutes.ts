import { Router } from 'express';
import { generateImageHandler } from '../controllers/geminiController.js';

const router = Router();

router.post('/generate-image', generateImageHandler);

export default router;

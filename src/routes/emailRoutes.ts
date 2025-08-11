import { Router } from 'express';
import { sendEmailHandler } from '../controllers/emailController.js';
import { sendEmailRateLimiter } from '../middleware/rateLimit.js';

const router = Router();

router.post('/send-email', sendEmailRateLimiter, sendEmailHandler);

export default router;

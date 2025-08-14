import { Router } from 'express';
import { sendEmailHandler, sendEmailBatchHandler } from '../controllers/emailController.js';
import { sendEmailRateLimiter } from '../middleware/rateLimit.js';

const router = Router();

router.post('/send-email', sendEmailRateLimiter, sendEmailHandler);
router.post('/send-email-batch', sendEmailRateLimiter, sendEmailBatchHandler);

export default router;

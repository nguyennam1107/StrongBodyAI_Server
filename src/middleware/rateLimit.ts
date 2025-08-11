import rateLimit from 'express-rate-limit';

export const sendEmailRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { message: 'Too many requests', type: 'RATE_LIMIT' } }
});

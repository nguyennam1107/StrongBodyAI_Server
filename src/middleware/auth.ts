import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';

export function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const key = req.header('x-api-key') || req.query.api_key;
  if (!key || key !== env.API_KEY) {
    return res.status(401).json({ success: false, error: { message: 'Unauthorized', type: 'AUTH' } });
  }
  next();
}

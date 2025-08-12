import { NextFunction, Request, Response } from 'express';
import { logger } from '../utils/logger.js';

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction) {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ success: false, error: { message: 'Payload too large', type: 'PAYLOAD_TOO_LARGE' } });
  }
  if (err?.success === false && err.error) {
    // Already mapped error
    return res.status(mapStatus(err.error.type)).json(err);
  }
  logger.error({ err }, 'Unhandled error');
  return res.status(500).json({ success: false, error: { message: err?.message || 'Internal Server Error', type: 'INTERNAL_ERROR' } });
}

function mapStatus(type: string): number {
  switch (type) {
  case 'DAILY_LIMIT': return 429;
  case 'INVALID_RECIPIENT': return 400;
  case 'AUTH_BROWSER_INTERACTION_REQUIRED': return 401;
  case 'SMTP_SYNTAX': return 502;
  default: return 500;
  }
}

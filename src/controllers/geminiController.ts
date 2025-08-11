import { Request, Response } from 'express';
import { z } from 'zod';
import { generateImages } from '../services/gemini/geminiClient.js';

const generateSchema = z.object({
  prompt: z.string().min(3).max(5000),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  style: z.string().max(100).optional(),
  n: z.number().int().min(1).max(10).optional(),
  return: z.enum(['base64', 'url']).optional(),
  client_request_id: z.string().max(100).optional()
});

export async function generateImageHandler(req: Request, res: Response) {
  const parsed = generateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: { message: parsed.error.message, type: 'VALIDATION' } });
  }
  const data = parsed.data;

  try {
    const result = await generateImages(data);
    return res.json({ success: true, message: 'Generated', info: result });
  } catch (err: any) {
    if (err?.success === false) return res.status(mapStatus(err.error.type)).json(err);
    return res.status(500).json({ success: false, error: { message: err?.message || 'Internal', type: 'INTERNAL_ERROR' } });
  }
}

function mapStatus(type: string): number {
  switch (type) {
  case 'PROVIDER_KEYS_EXHAUSTED': return 503;
  case 'GEMINI_ERROR': return 502;
  default: return 500;
  }
}

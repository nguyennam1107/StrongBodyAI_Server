import { Request, Response } from 'express';
import { z } from 'zod';
import { generateImages } from '../services/gemini/geminiClient.js';

const generateSchema = z.object({
  prompt: z.string().min(3).max(5000),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  style: z.string().max(100).optional(),
  n: z.number().int().min(1).max(10).default(1),
  return: z.enum(['base64', 'url', 'binary']).optional(),
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

    // If binary requested, only support when exactly one image
    if (data.return === 'binary') {
      if (!result.images.length) {
        return res.status(500).json({ success: false, error: { message: 'No image generated', type: 'INTERNAL_ERROR' } });
      }
      if (result.images.length > 1) {
        return res.status(400).json({ success: false, error: { message: 'binary return only supported with n=1', type: 'VALIDATION' } });
      }
      const img = result.images[0];
      if (!img.data_base64) {
        return res.status(500).json({ success: false, error: { message: 'Image data unavailable for binary return', type: 'INTERNAL_ERROR' } });
      }
      const buffer = Buffer.from(img.data_base64, 'base64');
      res.setHeader('Content-Type', img.mime || 'application/octet-stream');
      res.setHeader('Content-Length', buffer.length.toString());
      // Provide a filename hint
      res.setHeader('Content-Disposition', `inline; filename="${img.id}.${mimeToExt(img.mime)}"`);
      return res.status(200).send(buffer);
    }

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

function mimeToExt(mime?: string) {
  if (!mime) return 'bin';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  return 'bin';
}

import { Request, Response } from 'express';
import { z } from 'zod';
import { generateImages } from '../services/gemini/geminiClient.js';
import { buildGoogleImagePrompt } from '../template.js';

const generateSchema = z.object({
  prompt: z.string().min(3).max(15000),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  style: z.string().max(100).optional(),
  n: z.number().int().min(1).max(10).default(1),
  return: z.enum(['base64', 'url', 'binary']).optional(),
  client_request_id: z.string().max(100).optional(),
  use_template: z.boolean().optional().default(false)
});

export async function generateImageHandler(req: Request, res: Response) {
  const parsed = generateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: { message: parsed.error.message, type: 'VALIDATION' } });
  }
  const duLieu = parsed.data;

  try {
    // Nếu bật dùng template, chuẩn hoá prompt theo mẫu Google
    const promptDaChuanHoa = duLieu.use_template
      ? buildGoogleImagePrompt({
        prompt: duLieu.prompt,
        width: duLieu.width,
        height: duLieu.height,
        style: duLieu.style
      })
      : duLieu.prompt;

    const ketQua = await generateImages({
      prompt: promptDaChuanHoa,
      width: duLieu.width,
      height: duLieu.height,
      style: duLieu.style,
      n: duLieu.n,
      return: duLieu.return,
      client_request_id: duLieu.client_request_id
    });

    // Nếu client yêu cầu trả về nhị phân thì chỉ hỗ trợ n=1
    if (duLieu.return === 'binary') {
      if (!ketQua.images.length) {
        return res.status(500).json({ success: false, error: { message: 'Không tạo được ảnh', type: 'INTERNAL_ERROR' } });
      }
      if (ketQua.images.length > 1) {
        return res.status(400).json({ success: false, error: { message: 'binary chỉ hỗ trợ khi n=1', type: 'VALIDATION' } });
      }
      const anh = ketQua.images[0];
      if (!anh.data_base64) {
        return res.status(500).json({ success: false, error: { message: 'Thiếu dữ liệu ảnh để trả về nhị phân', type: 'INTERNAL_ERROR' } });
      }
      const buffer = Buffer.from(anh.data_base64, 'base64');
      res.setHeader('Content-Type', anh.mime || 'application/octet-stream');
      res.setHeader('Content-Length', buffer.length.toString());
      // Gợi ý tên file
      res.setHeader('Content-Disposition', `inline; filename="${anh.id}.${mimeToExt(anh.mime)}"`);
      return res.status(200).send(buffer);
    }

    return res.json({ success: true, message: 'Generated', info: ketQua });
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
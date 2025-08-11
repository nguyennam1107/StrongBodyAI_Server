import { Request, Response } from 'express';
import { z } from 'zod';
import { sendEmail } from '../services/emailService.js';
import { getIdempotent, setIdempotent } from '../lib/idempotencyStore.js';
import { logger } from '../utils/logger.js';
import crypto from 'crypto';

const attachmentSchema = z.object({
  filename: z.string().min(1).regex(/\.pdf$/i, 'Only .pdf allowed'),
  content_base64: z.string().min(10)
});

const emailSchema = z.object({
  to_email: z.string().min(1),
  subject: z.string().max(255).optional(),
  body: z.string().max(200_000).optional(),
  smtp_user: z.string().email(),
  smtp_pass: z.string().min(1).transform(v => v.replace(/\s+/g, '')),
  smtp_server: z.string().min(1),
  smtp_port: z.coerce.number().int().positive(),
  idempotency_key: z.string().uuid().optional(),
  reply_to: z.string().email().optional(),
  cc: z.string().optional(),
  bcc: z.string().optional(),
  attachments: z.array(attachmentSchema).max(5).optional()
});

function deriveKey(payload: any): string {
  // Loại bỏ idempotency_key nếu có và chuẩn hóa các field chính tạo fingerprint
  const base = {
    to_email: payload.to_email,
    subject: payload.subject || '',
    body: payload.body || '',
    smtp_user: payload.smtp_user,
    smtp_server: payload.smtp_server,
    smtp_port: payload.smtp_port,
    reply_to: payload.reply_to || '',
    cc: payload.cc || '',
    bcc: payload.bcc || ''
  };
  const json = JSON.stringify(base);
  return crypto.createHash('sha256').update(json).digest('hex').slice(0, 32); // 32 hex chars
}

export async function sendEmailHandler(req: Request, res: Response) {
  const parsed = emailSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: { message: parsed.error.message, type: 'VALIDATION' } });
  }
  const data = parsed.data;

  const recipients = data.to_email.split(',').map((e: string) => e.trim()).filter((v: string) => Boolean(v));
  if (!recipients.length) {
    return res.status(400).json({ success: false, error: { message: 'The recipient address is empty', type: 'INVALID_RECIPIENT' } });
  }
  if (recipients.some((r: string) => r.includes(' '))) {
    return res.status(400).json({ success: false, error: { message: 'The recipient address contains space', type: 'INVALID_RECIPIENT' } });
  }

  // Lấy key client gửi hoặc tự suy diễn để chống duplicate cùng payload
  const key = data.idempotency_key || deriveKey(data);
  const existing = getIdempotent(key);
  if (existing && existing.status === 'success') {
    logger.info({ key }, 'Idempotent replay prevented (return cached response)');
    return res.json(existing.response);
  }

  try {
    const info = await sendEmail({
      smtp_user: data.smtp_user,
      smtp_pass: data.smtp_pass,
      smtp_server: data.smtp_server,
      smtp_port: data.smtp_port,
      to: recipients,
      subject: data.subject,
      body: data.body,
      replyTo: data.reply_to,
      cc: data.cc ? data.cc.split(',').map((s: string) => s.trim()).filter((v: string) => Boolean(v)) : undefined,
      bcc: data.bcc ? data.bcc.split(',').map((s: string) => s.trim()).filter((v: string) => Boolean(v)) : undefined,
      attachments: data.attachments
    });

    const response = { success: true, message: 'Email sent', info: { idempotency_key: key, messageId: info.messageId, providerResponse: info } };
    setIdempotent(key, { status: 'success', response, createdAt: Date.now() });
    return res.json(response);
  } catch (err: any) {
    setIdempotent(key, { status: 'error', response: err, createdAt: Date.now() });
    return res.status(mapStatus(err?.error?.type)).json(err);
  }
}

function mapStatus(type: string | undefined): number {
  switch (type) {
  case 'DAILY_LIMIT': return 429;
  case 'INVALID_RECIPIENT': return 400;
  case 'AUTH_BROWSER_INTERACTION_REQUIRED': return 401;
  case 'SMTP_SYNTAX': return 502;
  default: return 500;
  }
}

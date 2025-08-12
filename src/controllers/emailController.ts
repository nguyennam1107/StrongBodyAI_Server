import { Request, Response } from 'express';
import { z } from 'zod';
import { sendEmail } from '../services/emailService.js';
import { getIdempotent, setIdempotent } from '../lib/idempotencyStore.js';
import { logger } from '../utils/logger.js';
import crypto from 'crypto';

const MAX_ATTACHMENT_BYTES = 1.6 * 1024 * 1024; // ~1.6MB sau decode (an toàn cho file gốc ~1.2MB)
const MAX_TOTAL_ATTACHMENTS_BYTES = 6 * 1024 * 1024; // tổng ~6MB

const attachmentSchema = z.object({
  filename: z.string().min(1).regex(/\.pdf$/i, 'Only .pdf allowed'),
  content_base64: z.string().min(10)
});

const emailSchema = z.object({
  to_email: z.string().min(1),
  subject: z.string().max(255).optional(),
  body: z.string().max(200_000).optional(),
  dear_name: z.string().max(255).optional(),
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

function buildSuccessResponse(params: { key: string; info: any; subject?: string; smtpUser: string; }): any {
  const sent_time = new Date().toISOString();
  return {
    success: true,
    message: 'Email sent',
    // Các field phục vụ n8n Code node gom nhóm
    subject: params.subject || '',
    assigned_account_email: params.smtpUser,
    sent_time,
    // Thông tin thêm
    idempotency_key: params.key,
    messageId: params.info.messageId,
    providerResponse: params.info
  };
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

  // Validate attachment sizes
  if (data.attachments?.length) {
    let total = 0;
    for (const a of data.attachments) {
      let b64 = a.content_base64.trim();
      const m = b64.match(/^data:application\/pdf;base64,(.+)$/i);
      if (m) b64 = m[1];
      try {
        const buf = Buffer.from(b64, 'base64');
        const size = buf.length;
        total += size;
        if (size > MAX_ATTACHMENT_BYTES) {
          return res.status(400).json({ success: false, error: { message: `Attachment ${a.filename} too large (> ${(MAX_ATTACHMENT_BYTES/1024/1024).toFixed(1)}MB)`, type: 'VALIDATION' } });
        }
      } catch {
        return res.status(400).json({ success: false, error: { message: `Attachment ${a.filename} base64 invalid`, type: 'VALIDATION' } });
      }
    }
    if (total > MAX_TOTAL_ATTACHMENTS_BYTES) {
      return res.status(400).json({ success: false, error: { message: `Total attachments exceed ${(MAX_TOTAL_ATTACHMENTS_BYTES/1024/1024).toFixed(1)}MB`, type: 'VALIDATION' } });
    }
  }

  // Lấy key client gửi hoặc tự suy diễn để chống duplicate cùng payload
  const key = data.idempotency_key || deriveKey(data);
  const existing = getIdempotent(key);
  if (existing && existing.status === 'success') {
    logger.info({ key }, 'Idempotent replay prevented (return cached response)');
    const cached = existing.response;
    // Đảm bảo format mới nếu bản cũ chưa có
    if (cached && cached.success && (cached.subject === undefined || cached.assigned_account_email === undefined || cached.sent_time === undefined)) {
      return res.json({
        ...cached,
        subject: cached.subject ?? data.subject ?? '',
        assigned_account_email: cached.assigned_account_email ?? data.smtp_user,
        sent_time: cached.sent_time ?? new Date(existing.createdAt).toISOString()
      });
    }
    return res.json(cached);
  }

  // Prep body với Dear Sir
  const decoratedBody = data.dear_name ? `<p>Dear Sir ${escapeHtml(data.dear_name)}</p>\n${data.body || ''}` : data.body;

  try {
    const info = await sendEmail({
      smtp_user: data.smtp_user,
      smtp_pass: data.smtp_pass,
      smtp_server: data.smtp_server,
      smtp_port: data.smtp_port,
      to: recipients,
      subject: data.subject,
      body: decoratedBody,
      replyTo: data.reply_to,
      cc: data.cc ? data.cc.split(',').map((s: string) => s.trim()).filter((v: string) => Boolean(v)) : undefined,
      bcc: data.bcc ? data.bcc.split(',').map((s: string) => s.trim()).filter((v: string) => Boolean(v)) : undefined,
      attachments: data.attachments
    });

    const response = buildSuccessResponse({ key, info, subject: data.subject, smtpUser: data.smtp_user });
    setIdempotent(key, { status: 'success', response, createdAt: Date.now() });
    return res.json(response);
  } catch (err: any) {
    setIdempotent(key, { status: 'error', response: err, createdAt: Date.now() });
    return res.status(mapStatus(err?.error?.type)).json(err);
  }
}

function escapeHtml(str: string) {
  return str.replace(/[&<>"]+/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[s] || s));
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

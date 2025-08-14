import { Request, Response } from 'express';
import { z } from 'zod';
import { sendEmail, sendEmailBatch } from '../services/emailService.js';
import { getIdempotent, setIdempotent } from '../lib/idempotencyStore.js';
import { logger } from '../utils/logger.js';
import crypto from 'crypto';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { AttachmentInput } from '../services/emailService.js';

const MAX_ATTACHMENT_BYTES = 1.6 * 1024 * 1024; // ~1.6MB sau decode (an toàn cho file gốc ~1.2MB)
const MAX_TOTAL_ATTACHMENTS_BYTES = 6 * 1024 * 1024; // tổng ~6MB
const DEFAULT_PDF_PATH = path.resolve(process.cwd(), 'PDF', 'PITCH DECK STRONGBODYAI.pdf');

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

const batchEmailSchema = z.object({
  smtp_user: z.string().email(),
  smtp_pass: z.string().min(1).transform(v => v.replace(/\s+/g, '')),
  smtp_server: z.string().min(1),
  smtp_port: z.coerce.number().int().positive(),
  idempotency_key: z.string().uuid().optional(),
  // Legacy batch (items based)
  default_subject: z.string().max(255).optional(),
  default_body: z.string().max(200_000).optional(),
  default_attachments: z.array(attachmentSchema).max(5).optional(),
  items: z.array(z.object({
    to_email: z.string().min(1),
    subject: z.string().max(255).optional(),
    body: z.string().max(200_000).optional(),
    dear_name: z.string().max(255).optional(),
    cc: z.string().optional(),
    bcc: z.string().optional(),
    attachments: z.array(attachmentSchema).max(5).optional()
  })).max(500).optional(),
  // New bulk simple mode
  email_bulk: z.string().optional(), // comma separated emails
  sender_names: z.string().optional(), // comma separated names aligned with emails
  subject: z.string().max(255).optional(), // subject for bulk mode
  body_template: z.string().max(200_000).optional(), // body for bulk mode
  attachments: z.array(attachmentSchema).max(5).optional() // default attachments alias
}).refine(d => (d.items && d.items.length) || d.email_bulk, {
  message: 'Provide either items[] or email_bulk',
  path: ['items']
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

function escapeHtml(str: string) {
  return str.replace(/[&<>"]+/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[s] || s));
}

function buildFooterHtml(senderEmail: string): string {
  // Lưu ý: <img src="./Image/logo.jpeg"> sẽ không hiển thị trong đa số email client trừ khi dùng URL public hoặc CID
  return `
  <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #ccc;">
    <img src="./Image/logo.jpeg" alt="StrongBody Logo" style="max-width: 150px; height: auto;">
    <br>
    <p><strong>Email:</strong> ${escapeHtml(senderEmail)}</p>
    <p><strong>Website:</strong> <a href="https://strongbody.ai" target="_blank">strongbody.ai</a></p>
    <p><strong>Address:</strong> 105 CECIL STREET #18-20 THE OCTAGON SINGAPORE 069534</p>
  </div>`;
}

async function loadDefaultPdfAttachment(): Promise<AttachmentInput> {
  const pdfBuffer = await readFile(DEFAULT_PDF_PATH);
  const content_base64 = pdfBuffer.toString('base64');
  return { filename: 'PITCH DECK STRONGBODYAI.pdf', content_base64 };
}

function getBase64SizeBytes(content_base64: string): number {
  let b64 = content_base64.trim();
  const m = b64.match(/^data:application\/pdf;base64,(.+)$/i);
  if (m) b64 = m[1];
  return Buffer.from(b64, 'base64').length;
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

  // Prep body với Dear Sir + Footer công ty
  const decoratedBody = data.dear_name ? `<p>Dear Sir ${escapeHtml(data.dear_name)}</p>\n${data.body || ''}` : (data.body || '');
  const footerHtml = buildFooterHtml(data.smtp_user);
  const finalBody = `${decoratedBody}\n${footerHtml}`;

  try {
    // Nếu client không gửi attachments, sử dụng PDF mặc định; ngược lại dùng attachments của client
    let combined: AttachmentInput[];
    if (data.attachments?.length) {
      combined = data.attachments;
    } else {
      const defaultAttachment = await loadDefaultPdfAttachment();
      combined = [defaultAttachment];
    }

    // Validate kích thước từng file và tổng
    let grandTotal = 0;
    for (const a of combined) {
      const size = getBase64SizeBytes(a.content_base64);
      if (size > MAX_ATTACHMENT_BYTES) {
        return res.status(400).json({ success: false, error: { message: `Attachment ${a.filename} too large (> ${(MAX_ATTACHMENT_BYTES/1024/1024).toFixed(1)}MB)`, type: 'VALIDATION' } });
      }
      grandTotal += size;
    }
    if (grandTotal > MAX_TOTAL_ATTACHMENTS_BYTES) {
      return res.status(400).json({ success: false, error: { message: `Total attachments exceed ${(MAX_TOTAL_ATTACHMENTS_BYTES/1024/1024).toFixed(1)}MB`, type: 'VALIDATION' } });
    }

    const info = await sendEmail({
      smtp_user: data.smtp_user,
      smtp_pass: data.smtp_pass,
      smtp_server: data.smtp_server,
      smtp_port: data.smtp_port,
      to: recipients,
      subject: data.subject,
      body: finalBody,
      replyTo: data.reply_to,
      cc: data.cc ? data.cc.split(',').map((s: string) => s.trim()).filter((v: string) => Boolean(v)) : undefined,
      bcc: data.bcc ? data.bcc.split(',').map((s: string) => s.trim()).filter((v: string) => Boolean(v)) : undefined,
      attachments: combined
    });

    const response = buildSuccessResponse({ key, info, subject: data.subject, smtpUser: data.smtp_user });
    setIdempotent(key, { status: 'success', response, createdAt: Date.now() });
    return res.json(response);
  } catch (err: any) {
    setIdempotent(key, { status: 'error', response: err, createdAt: Date.now() });
    return res.status(mapStatus(err?.error?.type)).json(err);
  }
}

export async function sendEmailBatchHandler(req: Request, res: Response) {
  const parsed = batchEmailSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: { message: parsed.error.message, type: 'VALIDATION' } });
  }
  const data = parsed.data;

  // Normalize: if bulk mode provided, transform to items[]
  let workingItems = data.items ? [...data.items] : [];
  if ((!workingItems || workingItems.length === 0) && data.email_bulk) {
    const emails = data.email_bulk.split(',').map(s => s.trim()).filter(Boolean);
    const names = (data.sender_names || '').split(',').map(s => s.trim());
    if (names.length && names.length !== emails.length) {
      return res.status(400).json({ success: false, error: { message: 'sender_names count mismatch with email_bulk', type: 'VALIDATION' } });
    }
    workingItems = emails.map((e, idx) => ({
      to_email: e,
      dear_name: names[idx] || undefined,
      subject: data.subject, // per-item subject (can be undefined, fallback later)
      body: data.body_template
    }));
    // Map aliases to legacy defaults if not explicitly set
    if (!data.default_subject && data.subject) data.default_subject = data.subject;
    if (!data.default_body && data.body_template) data.default_body = data.body_template;
    if (!data.default_attachments && data.attachments) data.default_attachments = data.attachments;
  }

  if (!workingItems.length) {
    return res.status(400).json({ success: false, error: { message: 'No batch items after normalization', type: 'VALIDATION' } });
  }

  // Key hash (use either explicit items or normalized)
  const keyBase = JSON.stringify({
    smtp_user: data.smtp_user,
    smtp_server: data.smtp_server,
    smtp_port: data.smtp_port,
    default_subject: data.default_subject || '',
    default_body: data.default_body || '',
    items: workingItems.map(i => ({ to_email: i.to_email, subject: i.subject || '', body: i.body || '', dear_name: i.dear_name || '' }))
  });
  const key = data.idempotency_key || crypto.createHash('sha256').update(keyBase).digest('hex').slice(0, 32);
  const existing = getIdempotent(key);
  if (existing && existing.status === 'success') {
    logger.info({ key }, 'Idempotent replay prevented (batch)');
    return res.json(existing.response);
  }

  // Choose default attachments precedence: explicit default_attachments -> attachments alias -> fallback PDF
  let defaultAttachments: AttachmentInput[] | undefined = undefined;
  if (data.default_attachments?.length) defaultAttachments = data.default_attachments;
  else if (data.attachments?.length) defaultAttachments = data.attachments;
  else {
    try {
      const def = await loadDefaultPdfAttachment();
      defaultAttachments = [def];
    } catch (e) { logger.warn({ e }, 'Cannot load default PDF for batch'); }
  }

  // Validate default attachments
  if (defaultAttachments?.length) {
    let total = 0;
    for (const a of defaultAttachments) {
      const size = getBase64SizeBytes(a.content_base64);
      if (size > MAX_ATTACHMENT_BYTES) {
        return res.status(400).json({ success: false, error: { message: `Default attachment ${a.filename} too large (> ${(MAX_ATTACHMENT_BYTES/1024/1024).toFixed(1)}MB)`, type: 'VALIDATION' } });
      }
      total += size;
    }
    if (total > MAX_TOTAL_ATTACHMENTS_BYTES) {
      return res.status(400).json({ success: false, error: { message: `Default attachments exceed ${(MAX_TOTAL_ATTACHMENTS_BYTES/1024/1024).toFixed(1)}MB`, type: 'VALIDATION' } });
    }
  }

  // Build items for sendEmailBatch
  const items = [] as any[];
  for (const it of workingItems) {
    const recipients = it.to_email.split(',').map((e: string) => e.trim()).filter((v: string) => v);
    if (!recipients.length) {
      return res.status(400).json({ success: false, error: { message: 'One of batch items has empty recipient', type: 'INVALID_RECIPIENT' } });
    }

    // Personal greeting variant: Dear <Name>, (no 'Sir')
    const dear = it.dear_name ? `<p>Dear ${escapeHtml(it.dear_name)},</p>\n` : '';
    const footer = buildFooterHtml(data.smtp_user);
    const finalBody = `${dear}${it.body || data.default_body || ''}\n${footer}`;

    // Validate per-item attachments
    if (it.attachments?.length) {
      let totalPerItem = 0;
      for (const a of it.attachments) {
        const size = getBase64SizeBytes(a.content_base64);
        if (size > MAX_ATTACHMENT_BYTES) {
          return res.status(400).json({ success: false, error: { message: `Attachment ${a.filename} too large in one item`, type: 'VALIDATION' } });
        }
        totalPerItem += size;
      }
      if (totalPerItem > MAX_TOTAL_ATTACHMENTS_BYTES) {
        return res.status(400).json({ success: false, error: { message: 'Total attachments exceed limit in one item', type: 'VALIDATION' } });
      }
    }

    items.push({
      to: recipients,
      subject: it.subject || data.default_subject,
      body: finalBody,
      cc: it.cc ? it.cc.split(',').map((s: string) => s.trim()).filter((v: string) => Boolean(v)) : undefined,
      bcc: it.bcc ? it.bcc.split(',').map((s: string) => s.trim()).filter((v: string) => Boolean(v)) : undefined,
      attachments: it.attachments
    });
  }

  try {
    const batchResult = await sendEmailBatch({
      smtp_user: data.smtp_user,
      smtp_pass: data.smtp_pass,
      smtp_server: data.smtp_server,
      smtp_port: data.smtp_port,
      items,
      defaultSubject: data.default_subject,
      defaultBody: data.default_body,
      defaultAttachments
    });
    setIdempotent(key, { status: 'success', response: { ...batchResult, idempotency_key: key }, createdAt: Date.now() });
    return res.json({ ...batchResult, idempotency_key: key });
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

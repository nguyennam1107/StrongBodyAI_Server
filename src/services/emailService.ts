import nodemailer from 'nodemailer';
import { logger } from '../utils/logger.js';
import { ApiError } from '../types/email.js';

export interface SmtpParams {
  smtp_user: string;
  smtp_pass: string;
  smtp_server: string;
  smtp_port: number;
}

export interface AttachmentInput {
  filename: string; // expect .pdf
  content_base64: string; // base64 encoded PDF
}

export interface SendParams extends SmtpParams {
  to: string[];
  subject?: string;
  body?: string;
  replyTo?: string;
  cc?: string[];
  bcc?: string[];
  attachments?: AttachmentInput[];
}

export interface BatchEmailItem {
  to: string[]; // each item can include multiple recipients (comma already split)
  subject?: string;
  body?: string; // html
  replyTo?: string;
  cc?: string[];
  bcc?: string[];
  attachments?: AttachmentInput[]; // optional override per item (else use defaultAttachments)
}

export interface SendBatchParams extends SmtpParams {
  items: BatchEmailItem[];
  defaultSubject?: string;
  defaultBody?: string;
  defaultAttachments?: AttachmentInput[];
}

export interface BatchEmailResultItem {
  to: string[];
  subject?: string;
  success: boolean;
  messageId?: string;
  error?: { message: string; type: string };
}

export interface BatchEmailResultSummary {
  success: boolean;
  message: string;
  total: number;
  sent: number;
  failed: number;
  results: BatchEmailResultItem[];
}

export async function sendEmail(params: SendParams) {
  const { smtp_user, smtp_pass, smtp_server, smtp_port } = params;
  const transporter = nodemailer.createTransport({
    host: smtp_server,
    port: smtp_port,
    secure: smtp_port === 465,
    auth: { user: smtp_user, pass: smtp_pass },
    tls: { rejectUnauthorized: true }
  });

  const attachments = params.attachments?.length ? params.attachments.map(a => ({
    filename: a.filename,
    content: Buffer.from(a.content_base64, 'base64'),
    contentType: 'application/pdf'
  })) : undefined;

  try {
    const info = await transporter.sendMail({
      from: smtp_user,
      to: params.to.join(', '),
      subject: params.subject,
      html: params.body,
      text: params.body, // fallback
      replyTo: params.replyTo,
      cc: params.cc?.length ? params.cc.join(', ') : undefined,
      bcc: params.bcc?.length ? params.bcc.join(', ') : undefined,
      attachments
    });
    logger.info({ action: 'email_sent', messageId: info.messageId, to: params.to, attachments: attachments?.length || 0 }, 'Email sent');
    return info;
  } catch (err: any) {
    logger.error({ err, action: 'email_send_error' }, 'Send email failed');
    throw mapSmtpError(err);
  }
}

export async function sendEmailBatch(params: SendBatchParams): Promise<BatchEmailResultSummary> {
  const { smtp_user, smtp_pass, smtp_server, smtp_port, items, defaultSubject, defaultBody, defaultAttachments } = params;
  const transporter = nodemailer.createTransport({
    host: smtp_server,
    port: smtp_port,
    secure: smtp_port === 465,
    auth: { user: smtp_user, pass: smtp_pass },
    // enable pooled / persistent connection
    pool: true,
    maxConnections: 1,
    maxMessages: items.length,
    tls: { rejectUnauthorized: true }
  } as any);

  const results: BatchEmailResultItem[] = [];
  for (const item of items) {
    const attachments = (item.attachments?.length ? item.attachments : defaultAttachments)?.map(a => ({
      filename: a.filename,
      content: Buffer.from(a.content_base64, 'base64'),
      contentType: 'application/pdf'
    }));
    try {
      const info = await transporter.sendMail({
        from: smtp_user,
        to: item.to.join(', '),
        subject: item.subject || defaultSubject,
        html: item.body || defaultBody,
        text: item.body || defaultBody,
        replyTo: item.replyTo,
        cc: item.cc?.length ? item.cc.join(', ') : undefined,
        bcc: item.bcc?.length ? item.bcc.join(', ') : undefined,
        attachments
      });
      logger.info({ action: 'batch_email_sent', messageId: info.messageId, to: item.to }, 'Email sent (batch)');
      results.push({ to: item.to, subject: item.subject || defaultSubject, success: true, messageId: info.messageId });
    } catch (err: any) {
      const mapped = mapSmtpError(err);
      logger.error({ err, action: 'batch_email_send_error', to: item.to }, 'Email failed (batch)');
      results.push({ to: item.to, subject: item.subject || defaultSubject, success: false, error: mapped.error });
    }
  }

  try { transporter.close(); } catch {}

  const sent = results.filter(r => r.success).length;
  const failed = results.length - sent;
  return {
    success: failed === 0,
    message: failed === 0 ? 'All emails sent' : (sent ? 'Partial success' : 'All failed'),
    total: results.length,
    sent,
    failed,
    results
  };
}

function mapSmtpError(err: any): ApiError {
  const raw = (err?.message || '').toString();
  let type = 'SMTP_ERROR';
  let message = raw;

  if (raw.includes('Daily user sending limit exceeded')) type = 'DAILY_LIMIT';
  else if (raw.includes('The recipient address')) type = 'INVALID_RECIPIENT';
  else if (raw.includes('Please log in with your web browser and then try again')) type = 'AUTH_BROWSER_INTERACTION_REQUIRED';
  else if (raw.includes('Syntax error, cannot decode response')) type = 'SMTP_SYNTAX';

  return { success: false, error: { message, type } };
}

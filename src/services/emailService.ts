import nodemailer from 'nodemailer';
import { logger } from '../utils/logger.js';
import { ApiError } from '../types/email.js';

export interface SmtpParams {
  smtp_user: string;
  smtp_pass: string;
  smtp_server: string;
  smtp_port: number;
}

export interface SendParams extends SmtpParams {
  to: string[];
  subject?: string;
  body?: string;
  replyTo?: string;
  cc?: string[];
  bcc?: string[];
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

  try {
    const info = await transporter.sendMail({
      from: smtp_user,
      to: params.to.join(', '),
      subject: params.subject,
      html: params.body,
      text: params.body, // fallback
      replyTo: params.replyTo,
      cc: params.cc?.length ? params.cc.join(', ') : undefined,
      bcc: params.bcc?.length ? params.bcc.join(', ') : undefined
    });
    logger.info({ action: 'email_sent', messageId: info.messageId, to: params.to }, 'Email sent');
    return info;
  } catch (err: any) {
    logger.error({ err, action: 'email_send_error' }, 'Send email failed');
    throw mapSmtpError(err);
  }
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

export interface SendEmailRequestBody {
  to_email: string;
  subject?: string;
  body?: string;
  smtp_user: string;
  smtp_pass: string;
  smtp_server: string;
  smtp_port: number;
  idempotency_key?: string;
  reply_to?: string;
  cc?: string;
  bcc?: string;
}

export interface ApiSuccess<T = any> {
  success: true;
  message: string;
  info?: T;
}

export interface ApiError {
  success: false;
  error: {
    message: string;
    type: string;
  };
}

export type ApiResponse<T = any> = ApiSuccess<T> | ApiError;

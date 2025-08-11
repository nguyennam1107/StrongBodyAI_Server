# SMTP Email API

API gửi email qua SMTP với validation, rate limit, idempotency, và mapping lỗi chuẩn cho n8n.

## Cài đặt

```bash
npm install
cp .env.example .env
# sửa API_KEY trong .env
npm run dev
```

Gọi thử:

```bash
curl -X POST http://localhost:3000/send-email \
  -H 'x-api-key: <API_KEY>' \
  -H 'Content-Type: application/json' \
  -d '{
    "to_email":"test@example.com",
    "subject":"Hello",
    "body":"<b>Test</b>",
    "smtp_user":"your@gmail.com",
    "smtp_pass":"app_password",
    "smtp_server":"smtp.gmail.com",
    "smtp_port":587
  }'
```

## Response

Success:

```json
{
  "success": true,
  "message": "Email sent",
  "info": { "messageId": "<id>", "providerResponse": { }
  }
}
```

Error:

```json
{
  "success": false,
  "error": { "message": "The recipient address ...", "type": "INVALID_RECIPIENT" }
}
```

## Cấu trúc thư mục

```text
src/
  config/        # env
  controllers/   # request handlers
  middleware/    # auth, error, rate limit
  routes/        # route modules
  services/      # business logic (send email)
  lib/           # infra helpers (idempotency)
  types/         # TypeScript types
  utils/         # logger, helpers
```

## Nâng cấp tiềm năng

- Thêm queue (Redis) cho gửi async
- Thêm test (Jest) và CI
- Thêm attachment (multipart)
- Triển khai Docker

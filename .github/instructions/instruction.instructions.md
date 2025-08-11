1. Mục tiêu ngắn gọn
Nhận POST request từ n8n chứa thông tin smtp (smtp_user, smtp_pass, server, port) + email payload (to_email, subject, body).

Thực hiện kết nối SMTP theo thông tin request và gửi email.

Trả về JSON có cấu trúc chuẩn (success / error) để n8n có thể dùng Switch/IF kiểm tra {{$json.error.message}} (hoặc error.type) như bạn đã liệt kê.

Không lưu trữ credential nhạy cảm lâu dài; log có mask.

2. API contract (endpoint & request)
Endpoint: /send-email (POST)

Headers yêu cầu:

Accept: application/json

Content-Type: application/x-www-form-urlencoded (n8n đang dùng Form Urlencoded) — server nên hỗ trợ cả application/json để thuận tiện.

(Tùy chọn) Authorization: Basic ... hoặc x-api-key để bảo vệ API.

Body fields (form-urlencoded hoặc JSON):

to_email — required — single email or comma-separated list. (trim spaces)

subject — optional — string (max 255 chars)

body — optional — string (HTML allowed; also provide text fallback)

smtp_user — required — username (email)

smtp_pass — required — app password / SMTP password

smtp_server — required — e.g. smtp.gmail.com

smtp_port — required — e.g. 587 or 465

(optional) idempotency_key — để tránh gửi trùng khi retry từ client

(optional) reply_to, cc, bcc, attachments (attachments => multipart/form-data)

3. Response format (chuẩn để n8n match)
Thành công (200 OK)

json
Sao chép
Chỉnh sửa
{
  "success": true,
  "message": "Email sent",
  "info": { "messageId": "<smtp message id>", "providerResponse": { ... } }
}
Lỗi (status phù hợp + body)

Chuẩn chung trả về:

json
Sao chép
Chỉnh sửa
{
  "success": false,
  "error": {
    "message": "<human-readable smtp/provider error message>",
    "type": "<ERROR_CODE>"
  }
}
Lưu ý: trả nguyên error.message (bao gồm fragment text như provider trả về) để n8n dùng contains match. Đồng thời thêm error.type (ví dụ DAILY_LIMIT, INVALID_RECIPIENT, AUTH_ERROR, SMTP_SYNTAX, TEMPORARY_FAILURE) để dễ xử lý programmatic.

4. Validation & business rules (trước khi gọi SMTP)
Trim mọi input string, reject nếu to_email rỗng.

Kiểm tra nhanh email format (basic regex) — nếu chứa khoảng trắng giữa địa chỉ → trả lỗi validation với error.message chứa chuỗi "The recipient address" (hoặc tùy theo mapping bạn muốn).

Giới hạn kích thước:

subject ≤ 255 ký tự

body ≤ 200KB (tùy nhu cầu)

attachments ≤ 10MB (tùy policy)

Chỉ chấp nhận smtp_port là số hợp lệ (25, 465, 587, 2525, ...).

(Tùy chọn) whitelist các smtp_server nếu muốn giảm rủi ro (hoặc log + rate-limit nếu cho phép arbitrary).

5. Phân loại lỗi & mapping cho n8n (chuẩn để dùng Switch/IF)
DAILY LIMIT

Khi provider trả lỗi dạng "Daily user sending limit exceeded" → trả error.message chứa chính xác substring đó.

error.type = "DAILY_LIMIT".

HTTP status: 429 hoặc 502/500 (tốt nhất: 429).

n8n Switch rule: {{$json.error.message}} contains "Daily user sending limit exceeded" → output name: Đạt giới hạn gửi mail hàng ngày

INVALID RECIPIENT / SPACES

Khi recipient có khoảng trắng hoặc lỗi provider bắt đầu "The recipient address" → trả lỗi với message chứa substring "The recipient address".

error.type = "INVALID_RECIPIENT".

HTTP status: 400.

n8n Switch rule: contains "The recipient address" → output name: email chứa dấu cách

AUTH / LOGIN BLOCKED

Gmail cụ thể có lỗi: "Please log in with your web browser and then try again" (thường do bảo mật, 2FA, chưa dùng app password).

error.type = "AUTH_BROWSER_INTERACTION_REQUIRED".

HTTP status: 401 or 403.

n8n Switch rule: contains "Please log in with your web browser and then try again" → output name: Please log in with your web browser and then try again

SMTP SYNTAX / RESPONSE DECODE

Khi provider trả "Syntax error, cannot decode response" → error.type = "SMTP_SYNTAX".

HTTP status: 502 hoặc 500.

n8n Switch rule: contains "Syntax error, cannot decode response" → output name: Syntax error, cannot decode response

GENERAL SMTP ERRORS: trả error.message nguyên văn và error.type = "SMTP_ERROR".

6. Bảo mật & privacy
Luôn chạy API qua HTTPS (TLS terminate ở reverse-proxy).

Không log smtp_pass hoặc log phải mask ******. Nếu phải lưu credential tạm, mã hóa (AES) và xóa ngay sau sử dụng.

Authentication to API: bắt buộc 1 lớp (API key, Basic Auth, OAuth client) để tránh abuse.

Rate limiting: áp limit theo smtp_user và theo IP (ví dụ 50 req/min) để ngăn spam.

Quarantine / Abuse: nếu tài khoản gửi nhiều mail fail→ block tạm thời.

Rotate & purge: ko lưu app passwords lâu dài; nếu lưu cache thì expiry ngắn (ví dụ 5 phút).

CORS: chỉ mở cho origin cần thiết (nếu có UI).

7. Reliability, retries & idempotency
Retry: client (n8n) có thể retry; server nên:

hỗ trợ idempotency_key: nếu cùng key đã gửi thành công → trả success không gửi lại.

nếu gửi thất bại vì lỗi tạm thời (4xx/5xx transient) → cho phép client retry với exponential backoff.

Queue: nếu cần xử lý nhiều request, tách nhận request → enqueue → background worker gửi mail (giúp scale & tránh timeout HTTP).

Timeouts: set SMTP connect & send timeout (ví dụ 10–30s). Trả lỗi rõ ràng nếu timeout.

8. Logging, metrics & monitoring
Logs structed (JSON) gồm: timestamp, request_id, smtp_user (masked), to_email, status, error.type, latency. Không include smtp_pass.

Metrics: total_sent, total_failed_by_type, avg_send_latency, queue_depth.

Alerting: cảnh báo khi daily failed > threshold hoặc spikes rate limit.

Healthcheck: /healthz trả 200 OK (DB/queue/SMTP reachability optional).

9. Test & QA (kiểm thử)
Unit tests: validation rules, error mapping.

Integration tests:

dùng testing SMTP providers: Ethereal, Mailtrap, or a sandbox SMTP to simulate provider errors (daily limit, invalid recipient).

test with Gmail app password (enable 2FA → create app password).

test all error scenarios (invalid email, auth blocked, provider syntax error).

Load test: simulate concurrent sends to ensure queue/worker scale.

Security test: ensure credentials not leaked in logs; pen-test basic auth.

10. Deployment & ops (gợi ý)
Containerize (Docker) và chạy behind reverse-proxy (nginx) with TLS (Let’s Encrypt).

Process manager: PM2 / systemd for single instance; or deploy as service on Cloud Run / ECS for autoscale.

Scaling: use worker pool + message queue (Redis/RabbitMQ) để xử lý gửi mail.

Backups & rollback: versioned releases, health checks, quick rollback plan.

11. Hướng dẫn cấu hình n8n (tương ứng)
HTTP Request node

Method: POST

URL: https://<your-server>/send-email

Authentication: (nếu bạn bật) Basic Auth → điền credentials của client.

Headers: accept: application/json

Content-Type: Form Urlencoded

Body fields (Form Urlencoded):

to_email → {{ $json.Email }}

subject → {{ $json.Subject_Template }}

body → {{ $json.Content_Template }}

smtp_user → {{ $json["Email người gửi"] }}

smtp_pass → {{ $json.stmp_pass }}

smtp_server → smtp.gmail.com

smtp_port → 587

Switch / IF Node ngay sau node HTTP Request:

Kiểm {{$json.error.message}} contains "Daily user sending limit exceeded" → output name: Đạt giới hạn gửi mail hàng ngày

Kiểm {{$json.error.message}} contains "The recipient address" → output: email chứa dấu cách

Kiểm {{$json.error.message}} contains "Please log in with your web browser and then try again" → output: Please log in with your web browser and then try again

Kiểm {{$json.error.message}} contains "Syntax error, cannot decode response" → output: Syntax error, cannot decode response

(Tốt hơn) nếu server trả error.type, kiểm $json.error.type == "DAILY_LIMIT" — sẽ chính xác hơn.

12. Checklist trước khi go-live
TLS hoạt động & redirect HTTP->HTTPS.

API authentication cấu hình & client (n8n) đã có credentials.

Masking logs & purge sensitive data.

Rate limit & abuse protection hoạt động.

Test gửi thành công với Gmail app-password và sandbox SMTP.

Monitoring + alert rule cơ bản (error rate, latency, queue depth).

Run load test nhỏ.

13. Nâng cấp / tính năng mở rộng (tùy chọn)
Hỗ trợ OAuth2 cho Gmail (nếu bạn muốn dùng OAuth thay vì app password).

Template rendering (Handlebars) + partials.

Attachment upload (multipart) + virus scanning.

DKIM signing nếu gửi qua relay riêng.

Bounce handling & webhook callbacks từ mail provider.
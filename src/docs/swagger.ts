export const swaggerSpec = {
  openapi: '3.0.3',
  info: {
    title: 'SMTP Email API',
    version: '1.0.0',
    description: 'API gửi email qua SMTP với validation, idempotency, rate limit và batch persistent connection.'
  },
  servers: [
    { url: 'http://localhost:3000', description: 'Local' }
  ],
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'x-api-key'
      }
    },
    schemas: {
      Attachment: {
        type: 'object',
        required: ['filename', 'content_base64'],
        properties: {
          filename: { type: 'string', example: 'invoice.pdf', description: 'Tên file .pdf' },
          content_base64: { type: 'string', example: 'JVBERi0xLjQKJcTl8uXrp...', description: 'Base64 nội dung PDF' }
        }
      },
      SendEmailRequest: {
        type: 'object',
        required: ['to_email', 'smtp_user', 'smtp_pass', 'smtp_server', 'smtp_port'],
        properties: {
          to_email: { type: 'string', example: 'user1@example.com,user2@example.com' },
          subject: { type: 'string', example: 'Hello' },
          dear_name: { type: 'string', example: 'John Doe' },
          body: { type: 'string', example: '<b>Hi</b>' },
          smtp_user: { type: 'string', example: 'your@gmail.com' },
          smtp_pass: { type: 'string', example: 'app_password', description: 'App password (khoảng trắng sẽ tự loại bỏ)' },
          smtp_server: { type: 'string', example: 'smtp.gmail.com' },
          smtp_port: { type: 'integer', example: 587 },
          idempotency_key: { type: 'string', format: 'uuid', description: 'Tùy chọn. Nếu không gửi server sẽ tự tạo hash từ payload.' },
          reply_to: { type: 'string', example: 'reply@example.com' },
          cc: { type: 'string', example: 'cc1@example.com,cc2@example.com' },
          bcc: { type: 'string', example: 'bcc1@example.com' },
          attachments: {
            type: 'array',
            maxItems: 5,
            description: 'Up to 5 PDF attachments. Each <= ~1.6MB decoded; total <= ~6MB. Accepts raw base64 or data URI (data:application/pdf;base64,...)',
            items: {
              type: 'object',
              required: ['filename', 'content_base64'],
              properties: {
                filename: { type: 'string', example: 'file.pdf' },
                content_base64: { type: 'string', description: 'Base64 content of PDF (no newlines). May include data URI prefix.' }
              }
            }
          }
        }
      },
      SendEmailSuccess: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string', example: 'Email sent' },
          info: {
            type: 'object',
            properties: {
              idempotency_key: { type: 'string', example: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6' },
              messageId: { type: 'string', example: '<id>' }
            }
          }
        }
      },
      ApiError: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: {
            type: 'object',
            properties: {
              message: { type: 'string' },
              type: { type: 'string', example: 'INVALID_RECIPIENT' }
            }
          }
        }
      },
      // -------- Batch Schemas --------
      BatchEmailItem: {
        type: 'object',
        required: ['to_email'],
        properties: {
          to_email: { type: 'string', example: 'user@example.com,user2@example.com', description: 'Danh sách người nhận cách nhau dấu phẩy' },
          subject: { type: 'string', example: 'Custom subject for this recipient' },
          body: { type: 'string', example: '<p>HTML content riêng</p>' },
          dear_name: { type: 'string', example: 'Alex' },
          cc: { type: 'string', example: 'cc1@example.com,cc2@example.com' },
          bcc: { type: 'string', example: 'hidden@example.com' },
          attachments: { $ref: '#/components/schemas/SendEmailRequest/properties/attachments' }
        }
      },
      BatchSendEmailRequest: {
        type: 'object',
        description: 'Batch send: dùng items[] (chi tiết mỗi phần tử) hoặc chế độ đơn giản email_bulk + sender_names + subject + body_template. Cần cung cấp 1 trong 2: items hoặc email_bulk.',
        properties: {
          smtp_user: { type: 'string', format: 'email', example: 'your@gmail.com' },
          smtp_pass: { type: 'string', example: 'app_password' },
          smtp_server: { type: 'string', example: 'smtp.gmail.com' },
          smtp_port: { type: 'integer', example: 587 },
          idempotency_key: { type: 'string', format: 'uuid', example: '550e8400-e29b-41d4-a716-446655440000' },
          // Legacy detailed mode defaults
          default_subject: { type: 'string', example: 'Global Subject (override by item.subject)' },
          default_body: { type: 'string', example: '<p>Global HTML body</p>' },
          default_attachments: { $ref: '#/components/schemas/SendEmailRequest/properties/attachments' },
          // New SIMPLE bulk mode fields
          email_bulk: { type: 'string', example: 'a@example.com,b@example.com,c@example.com', description: 'Chuỗi email cách nhau dấu phẩy (simple mode). Nếu dùng email_bulk có thể bỏ items.' },
          sender_names: { type: 'string', example: 'Alice,Bob,Charlie', description: 'Chuỗi tên tương ứng (same length với email_bulk). Greeting tạo: Dear {Name},' },
          subject: { type: 'string', example: 'StrongBody.AI: $3M Investment', description: 'Subject cho simple mode (map sang default_subject nếu không có).' },
          body_template: { type: 'string', example: 'I hope you\'re doing well...<br><br>Warm regards,<br>Alex-StrongBody', description: 'HTML body cho simple mode (map sang default_body). Tự động thêm footer.' },
          attachments: { $ref: '#/components/schemas/SendEmailRequest/properties/attachments', description: 'Attachments cho simple mode (map sang default_attachments).' },
          // Detailed per-item mode
          items: {
            type: 'array',
            minItems: 1,
            maxItems: 500,
            items: { $ref: '#/components/schemas/BatchEmailItem' }
          }
        },
        anyOf: [
          { required: ['items'] },
          { required: ['email_bulk'] }
        ]
      },
      BatchEmailResultItem: {
        type: 'object',
        properties: {
          to: { type: 'array', items: { type: 'string', format: 'email' } },
          subject: { type: 'string' },
          success: { type: 'boolean' },
          messageId: { type: 'string', example: '<id@domain>' },
          error: { type: 'object', properties: { message: { type: 'string' }, type: { type: 'string' } } }
        }
      },
      BatchSendEmailSuccess: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string', example: 'All emails sent' },
          idempotency_key: { type: 'string', example: 'abcd1234abcd1234abcd1234abcd1234' },
          total: { type: 'integer', example: 10 },
          sent: { type: 'integer', example: 10 },
          failed: { type: 'integer', example: 0 },
          results: { type: 'array', items: { $ref: '#/components/schemas/BatchEmailResultItem' } }
        }
      },
      GenerateImageRequest: {
        type: 'object',
        required: ['prompt'],
        properties: {
          prompt: { type: 'string', example: 'A futuristic city at sunset with flying cars' },
          width: { type: 'integer', example: 1024 },
          height: { type: 'integer', example: 1024 },
          style: { type: 'string', example: 'photorealistic' },
          n: { type: 'integer', example: 2, description: 'Số ảnh cần tạo (<= GEMINI_MAX_IMAGES) nếu không có mặc định là 1' },
          return: { type: 'string', enum: ['base64', 'url', 'binary'], example: 'base64' },
          client_request_id: { type: 'string', example: 'req_12345' },
          use_template: { type: 'boolean', example: true, description: 'Bật dùng mẫu prompt Google để tăng độ bám sát yêu cầu' }
        }
      },
      GenerateImageSuccess: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string', example: 'Generated' },
          info: {
            type: 'object',
            properties: {
              request_id: { type: 'string', example: 'k9x8yzsj2n' },
              model: { type: 'string', example: 'gemini-2.0-flash-preview-image-generation' },
              images: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', example: '1712749234000_0' },
                    mime: { type: 'string', example: 'image/png' },
                    data_base64: { type: 'string', example: 'iVBORw0KGgoAAAANSUhEUgAA...' },
                    size_bytes: { type: 'integer', example: 12345 }
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  security: [{ ApiKeyAuth: [] }],
  paths: {
    '/healthz': {
      get: {
        tags: ['System'],
        summary: 'Health check',
        responses: { '200': { description: 'OK' } }
      }
    },
    '/send-email': {
      post: {
        summary: 'Send an email via custom SMTP',
        tags: ['Email'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  to_email: { type: 'string', description: 'Recipient email(s), comma separated' },
                  subject: { type: 'string', maxLength: 255 },
                  body: { type: 'string', maxLength: 200000 },
                  dear_name: { type: 'string', maxLength: 255, description: 'Optional name to prepend greeting paragraph: <p>Dear Sir {dear_name}</p>' },
                  smtp_user: { type: 'string', format: 'email' },
                  smtp_pass: { type: 'string', description: 'SMTP password (internal whitespace removed automatically)' },
                  smtp_server: { type: 'string' },
                  smtp_port: { type: 'integer' },
                  idempotency_key: { type: 'string', format: 'uuid', description: 'Optional; auto-derived hash if omitted' },
                  reply_to: { type: 'string', format: 'email' },
                  cc: { type: 'string', description: 'Comma separated list' },
                  bcc: { type: 'string', description: 'Comma separated list' },
                  attachments: {
                    type: 'array',
                    maxItems: 5,
                    description: 'Up to 5 PDF attachments. Each <= ~1.6MB decoded; total <= ~6MB. Accepts raw base64 or data URI (data:application/pdf;base64,...)',
                    items: {
                      type: 'object',
                      required: ['filename', 'content_base64'],
                      properties: {
                        filename: { type: 'string', example: 'file.pdf' },
                        content_base64: { type: 'string', description: 'Base64 content of PDF (no newlines). May include data URI prefix.' }
                      }
                    }
                  }
                },
                required: ['to_email', 'smtp_user', 'smtp_pass', 'smtp_server', 'smtp_port'
                ]
              }
            }
          }
        },
        responses: {
          '200': { description: 'Email sent', content: { 'application/json': { schema: { $ref: '#/components/schemas/SendEmailSuccess' } } } },
          '400': { description: 'Validation / invalid recipient', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
          '401': { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
          '429': { description: 'Rate limit', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
          '500': { description: 'Server error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } }
        }
      }
    },
    '/send-email-batch': {
      post: {
        summary: 'Send multiple personalized emails in one persistent SMTP session (batch)',
        tags: ['Email'],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/BatchSendEmailRequest' }, examples: {
            simpleBulk: {
              summary: 'Simple bulk personalized',
              value: {
                smtp_user: 'partner@strongbody.ai',
                smtp_pass: 'app_pass',
                smtp_server: 'smtp.gmail.com',
                smtp_port: 587,
                email_bulk: 'a@example.com,b@example.com,c@example.com',
                sender_names: 'Alice,Bob,Charlie',
                subject: 'StrongBody.AI: $3M Investment',
                body_template: 'I hope you\'re doing well...<br><br>Warm regards,<br>Alex-StrongBody'
              }
            },
            detailedItems: {
              summary: 'Detailed items mode',
              value: {
                smtp_user: 'partner@strongbody.ai',
                smtp_pass: 'app_pass',
                smtp_server: 'smtp.gmail.com',
                smtp_port: 587,
                default_subject: 'StrongBody.AI: $3M Investment',
                default_body: '<p>Base body</p>',
                items: [
                  { to_email: 'a@example.com', dear_name: 'Alice' },
                  { to_email: 'b@example.com', dear_name: 'Bob', subject: 'Custom Subject' }
                ]
              }
            }
          } } }
        },
        responses: {
          '200': { description: 'Batch summary', content: { 'application/json': { schema: { $ref: '#/components/schemas/BatchSendEmailSuccess' } } } },
          '400': { description: 'Validation / invalid recipient', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
          '401': { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
          '429': { description: 'Rate limit', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
          '500': { description: 'Server error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } }
        }
      }
    },
    '/generate-image': {
      post: {
        tags: ['Gemini'],
        summary: 'Sinh ảnh từ prompt (đa key Gemini)',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/GenerateImageRequest' } } }
        },
        responses: {
          '200': { description: 'Generated', content: { 'application/json': { schema: { $ref: '#/components/schemas/GenerateImageSuccess' } } } },
          '400': { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
          '401': { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
          '502': { description: 'Provider error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
          '503': { description: 'All keys exhausted', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } },
          '500': { description: 'Server error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } } }
        }
      }
    }
  }
};

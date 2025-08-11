export const swaggerSpec = {
  openapi: '3.0.3',
  info: {
    title: 'SMTP Email API',
    version: '1.0.0',
    description: 'API gửi email qua SMTP với validation, idempotency, rate limit.'
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
      SendEmailRequest: {
        type: 'object',
        required: ['to_email', 'smtp_user', 'smtp_pass', 'smtp_server', 'smtp_port'],
        properties: {
          to_email: { type: 'string', example: 'user1@example.com,user2@example.com' },
          subject: { type: 'string', example: 'Hello' },
          body: { type: 'string', example: '<b>Hi</b>' },
          smtp_user: { type: 'string', example: 'your@gmail.com' },
          smtp_pass: { type: 'string', example: 'app_password' },
          smtp_server: { type: 'string', example: 'smtp.gmail.com' },
          smtp_port: { type: 'integer', example: 587 },
          idempotency_key: { type: 'string', format: 'uuid', description: 'Tùy chọn. Nếu không gửi server sẽ tự tạo hash từ payload.' },
          reply_to: { type: 'string', example: 'reply@example.com' },
          cc: { type: 'string', example: 'cc1@example.com,cc2@example.com' },
          bcc: { type: 'string', example: 'bcc1@example.com' }
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
      GenerateImageRequest: {
        type: 'object',
        required: ['prompt'],
        properties: {
          prompt: { type: 'string', example: 'A futuristic city at sunset with flying cars' },
          width: { type: 'integer', example: 1024 },
          height: { type: 'integer', example: 1024 },
          style: { type: 'string', example: 'photorealistic' },
          n: { type: 'integer', example: 2, description: 'Số ảnh cần tạo (<= GEMINI_MAX_IMAGES) nếu không có mặc định là 1' },
          return: { type: 'string', enum: ['base64', 'url'], example: 'base64' },
          client_request_id: { type: 'string', example: 'req_12345' }
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
        tags: ['Email'],
        summary: 'Gửi email qua SMTP',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/SendEmailRequest' } } }
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

import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('3000'),
  API_KEY: z.string().min(10, 'API_KEY required for auth'),
  LOG_LEVEL: z.string().default('info'),
  GEMINI_API_KEYS: z.string().min(1, 'GEMINI_API_KEYS required (comma separated)'),
  GEMINI_MODEL: z.string().default('gemini-2.0-flash-preview-image-generation'),
  GEMINI_TIMEOUT_MS: z.string().transform(Number).default('30000'),
  GEMINI_MAX_IMAGES: z.string().transform(Number).default('4')
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment variables', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const geminiKeys = env.GEMINI_API_KEYS.split(',').map(k => k.trim()).filter(Boolean);

import { env } from '../../config/env.js';
import { pickKey, reportError, reportSuccess } from './keyManager.js';
import { logger } from '../../utils/logger.js';

interface GenerateImageParams {
  prompt: string;
  width?: number;
  height?: number;
  style?: string;
  n?: number;
  return?: 'base64' | 'url' | 'binary'; // added binary
  client_request_id?: string;
}

interface GeneratedImage {
  id: string;
  mime: string;
  data_base64?: string;
  url?: string;
  size_bytes?: number;
}

export interface GenerateImageResult {
  request_id: string;
  model: string;
  images: GeneratedImage[];
  usage?: any;
}

// Placeholder Gemini call (to be replaced with real SDK usage)
async function callGemini(apiKey: string, prompt: string, n: number): Promise<GeneratedImage[]> {
  // Simulate latency
  await new Promise(r => setTimeout(r, 300));
  // Fake images
  return Array.from({ length: n }).map((_, i) => ({
    id: `${Date.now()}_${i}`,
    mime: 'image/png',
    data_base64: Buffer.from(`fake_image_${prompt}_${i}`).toString('base64'),
    size_bytes: 32
  }));
}

export async function generateImages(params: GenerateImageParams): Promise<GenerateImageResult> {
  const n = Math.min(params.n || 1, env.GEMINI_MAX_IMAGES);
  const reqId = cryptoRandomId();
  const keyState = pickKey();
  if (!keyState) {
    throw { success: false, error: { message: 'All provider keys unavailable', type: 'PROVIDER_KEYS_EXHAUSTED' } };
  }
  const key = keyState.key;
  try {
    const images = await callGemini(key, params.prompt, n);
    reportSuccess(key);
    return { request_id: reqId, model: env.GEMINI_MODEL, images };
  } catch (err: any) {
    const status = err?.status || err?.code;
    const severe = status === 403 || status === 401;
    reportError(key, severe);
    logger.error({ err, key: 'gemini', severe }, 'Gemini call failed');
    throw mapGeminiError(err);
  }
}

function mapGeminiError(err: any) {
  const msg = err?.message || 'Gemini request failed';
  return { success: false, error: { message: msg, type: 'GEMINI_ERROR' } };
}

function cryptoRandomId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

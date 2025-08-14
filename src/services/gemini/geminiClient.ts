import { env } from '../../config/env.js';
import { pickKey, reportError, reportSuccess } from './keyManager.js';
import { logger } from '../../utils/logger.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createCanvas } from 'canvas';

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

function selectImageModel(configuredModel: string): string {
  const normalized = (configuredModel || '').toLowerCase();
  const isImageCapable = normalized.includes('image') || normalized.includes('imagen');
  if (!isImageCapable) {
    const fallback = 'gemini-2.0-flash-preview-image-generation';
    logger.warn({ configuredModel }, 'Configured GEMINI_MODEL is not an image-capable model. Falling back to image-generation model');
    return fallback;
  }
  return configuredModel;
}

// Real Gemini API call for image generation using the new model
async function callGemini(apiKey: string, prompt: string, n: number, width?: number, height?: number, style?: string): Promise<GeneratedImage[]> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const selectedModel = selectImageModel(env.GEMINI_MODEL);
  
  try {
    const images: GeneratedImage[] = [];
    
    // Generate images based on the request count
    for (let i = 0; i < n; i++) {
      // Nếu phía controller chưa chuẩn hoá, thì mới tăng cường thêm style/size ở đây
      let effectivePrompt = prompt;
      const hasStructured = prompt.includes('Mô tả ảnh chi tiết:') || prompt.includes('Ràng buộc chất lượng:');
      if (!hasStructured) {
        if (style) {
          effectivePrompt += ` in ${style} style`;
        }
        if (width && height) {
          effectivePrompt += `. Image dimensions should be ${width}x${height} pixels`;
        }
      }
      
      try {
        // Use the image generation model
        const model = genAI.getGenerativeModel({ 
          model: selectedModel
        });

        logger.info({ prompt: effectivePrompt, model: selectedModel }, 'Attempting Gemini image generation');

        // Với prompt đã chuẩn hoá, không thêm tiền tố "Generate an image"
        const result = await model.generateContent({
          contents: [
            { role: 'user', parts: [{ text: effectivePrompt }] }
          ],
          // SDK @google/generative-ai hiện chưa export typings cho responseModalities; ép kiểu any để truyền đúng schema backend
          generationConfig: ({ responseModalities: ['TEXT', 'IMAGE'] } as any)
        } as any);

        const response = result.response;
        logger.info({ response: JSON.stringify(response, null, 2) }, 'Gemini API response received');

        // Check if there's image data in the response
        if (response.candidates && response.candidates.length > 0) {
          const candidate = response.candidates[0];
          
          // Look for image data in the response
          if (candidate.content && candidate.content.parts) {
            let imageFound = false;
            for (const part of candidate.content.parts) {
              if (part.inlineData && part.inlineData.mimeType && part.inlineData.data) {
                logger.info({ mimeType: part.inlineData.mimeType }, 'Found image data in Gemini response');
                images.push({
                  id: `gemini_${Date.now()}_${i}`,
                  mime: part.inlineData.mimeType,
                  data_base64: part.inlineData.data,
                  size_bytes: Buffer.from(part.inlineData.data, 'base64').length
                });
                imageFound = true;
                break;
              }
            }
            
            if (!imageFound) {
              logger.warn({ 
                prompt: effectivePrompt, 
                candidateContent: JSON.stringify(candidate.content, null, 2)
              }, 'No image data found in Gemini response, using fallback');
              
              const mockImageBase64 = await generateMockImage(effectivePrompt, width || 1024, height || 1024);
              images.push({
                id: `gemini_fallback_${Date.now()}_${i}`,
                mime: 'image/png',
                data_base64: mockImageBase64,
                size_bytes: Buffer.from(mockImageBase64, 'base64').length
              });
            }
          } else {
            logger.warn({ prompt: effectivePrompt }, 'No content parts in Gemini response, using fallback');
            const mockImageBase64 = await generateMockImage(effectivePrompt, width || 1024, height || 1024);
            images.push({
              id: `gemini_fallback_${Date.now()}_${i}`,
              mime: 'image/png',
              data_base64: mockImageBase64,
              size_bytes: Buffer.from(mockImageBase64, 'base64').length
            });
          }
        } else {
          logger.warn({ prompt: effectivePrompt }, 'No candidates in Gemini response, using fallback');
          const mockImageBase64 = await generateMockImage(effectivePrompt, width || 1024, height || 1024);
          images.push({
            id: `gemini_fallback_${Date.now()}_${i}`,
            mime: 'image/png',
            data_base64: mockImageBase64,
            size_bytes: Buffer.from(mockImageBase64, 'base64').length
          });
        }

      } catch (imageError: any) {
        logger.error({ 
          error: imageError.message || imageError, 
          stack: imageError.stack,
          prompt: effectivePrompt,
          model: selectedModel
        }, 'Failed to generate image with Gemini, using fallback');
        
        // Fallback to mock image if Gemini fails
        const mockImageBase64 = await generateMockImage(effectivePrompt, width || 1024, height || 1024);
        images.push({
          id: `gemini_fallback_${Date.now()}_${i}`,
          mime: 'image/png',
          data_base64: mockImageBase64,
          size_bytes: Buffer.from(mockImageBase64, 'base64').length
        });
      }
    }
    
    return images;
  } catch (error) {
    logger.error({ error, prompt }, 'Gemini API call failed completely');
    throw error;
  }
}

// Temporary function to generate a proper mock image until Gemini supports image generation
async function generateMockImage(prompt: string, width: number, height: number): Promise<string> {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  
  // Create gradient background
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#4facfe');
  gradient.addColorStop(1, '#00f2fe');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  
  // Add text
  ctx.fillStyle = '#ffffff';
  ctx.font = `${Math.min(width, height) / 20}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  
  // Wrap text
  const words = prompt.split(' ');
  const lines = [] as string[];
  const maxWidth = width * 0.8;
  let currentLine = '';
  
  for (const word of words) {
    const testLine = currentLine + word + ' ';
    const metrics = ctx.measureText(testLine);
    
    if (metrics.width > maxWidth && currentLine !== '') {
      lines.push(currentLine);
      currentLine = word + ' ';
    } else {
      currentLine = testLine;
    }
  }
  lines.push(currentLine);
  
  const lineHeight = Math.min(width, height) / 15;
  const startY = height / 2 - (lines.length - 1) * lineHeight / 2;
  
  lines.forEach((line, index) => {
    ctx.fillText(line, width / 2, startY + index * lineHeight);
  });
  
  // Convert to base64
  const buffer = canvas.toBuffer('image/png');
  return buffer.toString('base64');
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
    const images = await callGemini(key, params.prompt, n, params.width, params.height, params.style);
    reportSuccess(key);
    const selectedModel = selectImageModel(env.GEMINI_MODEL);
    return { request_id: reqId, model: selectedModel, images };
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

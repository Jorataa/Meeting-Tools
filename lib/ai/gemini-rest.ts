import 'server-only';
import { geminiKeys } from './config';

export class GeminiAPIError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string
  ) {
    super(message);
    this.name = 'GeminiAPIError';
  }
}

export const PREFERRED_AI_MODELS = [
  'gemini-3.8-flash',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
];

export const PREFERRED_VOICE_MODELS = [
  'gemini-3.8-flash-lite-tts',
  'gemini-3.8-flash-tts',
];

type GeminiContentPart = { text?: string; thought?: boolean; inlineData?: { data?: string; mimeType?: string } };
type GeminiResponse = { candidates?: { finishReason?: string; content?: { parts?: GeminiContentPart[] } }[]; __modelUsed?: string };

export async function callGeminiGenerateContent(
  modelOrModels: string | string[],
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<GeminiResponse> {
  const models = Array.isArray(modelOrModels) ? modelOrModels : [modelOrModels];
  const keys = geminiKeys();
  if (!keys.length) {
    throw new GeminiAPIError('Gemini API key is not configured on the server.', 503, 'NOT_CONFIGURED');
  }

  let lastStatus = 502;
  let lastModel = models[0];

  for (let m = 0; m < models.length; m++) {
    const currentModel = models[m];
    // Gemini 3 uses a different thinking configuration than legacy 2.5 models.
    // Do not carry a legacy numeric budget into a newer fallback request.
    let requestBody = body;
    if (currentModel.startsWith('gemini-3') && body.generationConfig) {
      const generationConfig = body.generationConfig as Record<string, unknown>;
      const thinkingConfig = generationConfig.thinkingConfig as Record<string, unknown> | undefined;
      if (thinkingConfig && 'thinkingBudget' in thinkingConfig) {
        const config = { ...generationConfig };
        delete config.thinkingConfig;
        requestBody = { ...body, generationConfig: config };
      }
    }
    lastModel = currentModel;
    let shouldTryNextModel = false;
    const timeoutSignal = AbortSignal.timeout(35000);
    const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(currentModel)}:generateContent`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': key,
            },
            body: JSON.stringify(requestBody),
            signal: combinedSignal,
          }
        );

        lastStatus = response.status;
        if (response.ok) {
          const result = await response.json();
          result.__modelUsed = currentModel;
          return result;
        }
        await response.body?.cancel();

        // On 429 quota exhaustion or 404, if fallback models exist, move to next model immediately
        if ((lastStatus === 429 || lastStatus === 404) && m < models.length - 1) {
          console.warn(`Model ${currentModel} returned ${lastStatus}; attempting fallback model ${models[m + 1]}`);
          shouldTryNextModel = true;
          break;
        }

        if ([400, 401, 403, 429, 500, 502, 503, 504].includes(lastStatus) && i < keys.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 500 * (i + 1)));
          continue;
        }
        break;
      } catch (err: unknown) {
        const error = err as Error;
        if (error.name === 'AbortError' || error.name === 'TimeoutError') {
          throw new GeminiAPIError('AI request timed out.', 504, 'TIMEOUT');
        }
        if (i < keys.length - 1) continue;
        if (m < models.length - 1) {
          shouldTryNextModel = true;
          break;
        }
        throw new GeminiAPIError('Could not reach Gemini service.', 502, 'NETWORK_ERROR');
      }
    }

    if (!shouldTryNextModel) {
      break;
    }
  }

  if (lastStatus === 429) {
    throw new GeminiAPIError('Gemini quota reached across available models. Audio and notes are saved; retry shortly.', 429, 'RATE_LIMITED');
  }
  if (lastStatus === 401 || lastStatus === 403) {
    throw new GeminiAPIError('Gemini API key is invalid or unauthorized.', 401, 'AUTH_ERROR');
  }
  if (lastStatus === 404) {
    throw new GeminiAPIError(`Model "${lastModel}" is not available for this API key.`, 404, 'MODEL_UNAVAILABLE');
  }
  throw new GeminiAPIError(`Gemini service error (${lastStatus}).`, lastStatus >= 400 && lastStatus < 500 ? lastStatus : 502, 'SERVICE_ERROR');
}

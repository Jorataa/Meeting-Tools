import 'server-only';
import { geminiKeys } from './config';
import { callGeminiGenerateContent, GeminiAPIError, PREFERRED_VOICE_MODELS } from './gemini-rest';
import { wav } from '@/lib/audio/wav';

type AudioData = { data?: string; mimeType?: string; mime_type?: string };
/** Gemini 3.8 uses Interactions; earlier TTS models use generateContent. */
export async function generateVoice(text: string, signal: AbortSignal): Promise<Uint8Array> {
  const keys = geminiKeys();
  if (!keys.length) throw new GeminiAPIError('Voice is not configured.', 503, 'NOT_CONFIGURED');
  const models = [...new Set([process.env.GEMINI_TTS_MODEL?.trim(), ...PREFERRED_VOICE_MODELS, 'gemini-2.5-flash-preview-tts'].filter(Boolean))] as string[];
  let lastStatus = 502;
  for (const model of models) {
    let audio: AudioData | undefined;
    if (model.startsWith('gemini-3.8')) {
      for (const key of keys) {
        const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, signal,
          body: JSON.stringify({ model, input: [{ type: 'user_input', content: [{ type: 'text', text }] }],
            response_format: { type: 'audio' }, generation_config: { speech_config: [{ voice: 'Kore' }] }, store: false }),
        });
        lastStatus = response.status;
        if (response.ok) {
          const data = await response.json();
          audio = data.steps?.filter((step: { type: string }) => step.type === 'model_output')
            .flatMap((step: { content?: { type?: string }[] }) => step.content || []).filter((part: { type?: string }) => part.type === 'audio').at(-1);
          break;
        }
        // Key-specific errors can use another configured key. Model errors use a fallback model.
        if (![401, 403, 429].includes(response.status)) break;
      }
    } else {
      try {
        const result = await callGeminiGenerateContent(model, {
          contents: [{ role: 'user', parts: [{ text }] }],
          generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } } },
        }, signal);
        audio = result.candidates?.[0]?.content?.parts?.find(part => part.inlineData?.data)?.inlineData;
      } catch (error) {
        if (error instanceof GeminiAPIError) { lastStatus = error.status; if (error.code === 'TIMEOUT') throw error; }
        else throw error;
      }
    }
    if (audio?.data) {
      if (audio.data.length > 4000000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(audio.data)) break;
      const bytes = Buffer.from(audio.data, 'base64');
      const mime = audio.mime_type || audio.mimeType || 'audio/wav';
      if (mime.startsWith('audio/wav') && bytes.length > 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE') return bytes;
      if (/^audio\/(L16|pcm)/i.test(mime) && bytes.length > 0 && bytes.length % 2 === 0) {
        const samples = new Int16Array(bytes.length / 2);
        for (let i = 0; i < samples.length; i++) samples[i] = bytes.readInt16LE(i * 2);
        return new Uint8Array(wav(samples, 24000));
      }
      break;
    }
    if (signal.aborted) throw new GeminiAPIError('Voice request timed out.', 504, 'TIMEOUT');
    if (lastStatus === 401 || lastStatus === 403) break;
  }
  throw new GeminiAPIError('Voice service is temporarily unavailable.', lastStatus === 429 ? 429 : 502, 'TTS_ERROR');
}

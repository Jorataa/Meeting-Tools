import { transcribeAudio, TranscriptionError } from '@/lib/ai/transcribe';
import { audioMimeType, hasAudioHeader, MAX_AUDIO_BYTES, validateAudio } from '@/lib/audio/validation';
import { rateLimit, sameOrigin, sessionId } from '@/lib/server-session';
import {securityLog} from '@/lib/security/log';
import {enforceAiQuota} from '@/lib/security/ai-quota';

export const runtime = 'nodejs';
export const maxDuration = 120;
const MAX_BODY_BYTES = MAX_AUDIO_BYTES + 64 * 1024;
const headers = { 'Cache-Control': 'no-store' };
function failure(message: string, status: number, code: string) {
  securityLog('transcription.failed',{route:'/api/transcribe',status,code});
  return Response.json({ error: message, code }, { status, headers: { ...headers, ...(status === 429 ? { 'Retry-After': '60' } : {}) } });
}

async function boundedFormData(request: Request): Promise<FormData> {
  if (!request.body || Number(request.headers.get('content-length')) > MAX_BODY_BYTES) {
    throw new TranscriptionError('This audio is too large. Choose a file under 12 MB.', 413, 'TOO_LARGE');
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new TranscriptionError('This audio is too large. Choose a file under 12 MB.', 413, 'TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = Buffer.concat(chunks, size);
  try {
    return await new Response(bytes, { headers: { 'Content-Type': request.headers.get('content-type') || '' } }).formData();
  } catch { throw new TranscriptionError('Choose a valid audio file and try again.', 400, 'INVALID_INPUT'); }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return failure('This request is not allowed. Open the app and try again.', 403, 'ORIGIN');
  const id = await sessionId();
  if (!id) return failure('Your session expired. Please try again.', 401, 'SESSION');
  if (!request.headers.get('content-type')?.startsWith('multipart/form-data;')) return failure('Choose an audio file to transcribe.', 400, 'INVALID_INPUT');
  if (!rateLimit(`transcribe:${id}`, 6) || !rateLimit(`transcribe-hour:${id}`, 40, 3600000)) return failure('You have sent several recordings. Please wait a moment and try again.', 429, 'RATE_LIMITED');
  const quota=await enforceAiQuota('transcribe');if(quota)return quota;
  try {
    const form = await boundedFormData(request);
    const audio = form.get('audio');
    if (!(audio instanceof File) || form.getAll('audio').length !== 1 || [...form.keys()].some(key => key !== 'audio')) return failure('Choose one audio file to transcribe.', 400, 'INVALID_INPUT');
    const invalid = validateAudio(audio);
    if (invalid) return failure(invalid, audio.size > MAX_AUDIO_BYTES ? 413 : 400, 'INVALID_AUDIO');
    const mimeType = audioMimeType(audio)!;
    const bytes = new Uint8Array(await audio.arrayBuffer());
    if (!hasAudioHeader(bytes, mimeType)) return failure("This file doesn't contain supported audio. Choose MP3, WAV, M4A, WebM, or OGG.", 400, 'INVALID_AUDIO');
    const transcript = await transcribeAudio(bytes, mimeType, request.signal);
    return Response.json({ transcript }, { headers });
  } catch (error) {
    if (error instanceof TranscriptionError) return failure(error.message, error.status, error.code);
    return failure("We couldn't transcribe this recording. Please try again.", 502, 'TRANSCRIPTION_FAILED');
  }
}

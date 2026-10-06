import { z } from 'zod';
import { transcribeAudio, TranscriptionError } from '@/lib/ai/transcribe';
import { hasAudioHeader } from '@/lib/audio/validation';
import { rateLimit, sameOrigin, sessionId } from '@/lib/server-session';
import { BodyTooLarge, boundedText } from '@/lib/bounded-text';
export const runtime = 'nodejs';
export const maxDuration = 35;
const inputSchema = z.object({ audio: z.string().min(64).max(900000).regex(/^[A-Za-z0-9+/]+={0,2}$/) });
const headers = { 'Cache-Control': 'no-store' };
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: 'Request not allowed.' }, { status: 403, headers });
  const id = await sessionId();
  if (!id) return Response.json({ error: 'Session expired. Please reconnect.' }, { status: 401, headers });
  if (!rateLimit(`live-transcribe:${id}`, 16) || !rateLimit(`live-transcribe-hour:${id}`, 700, 3600000)) return Response.json({ error: 'Live transcription is busy. Recording can continue.' }, { status: 429, headers });
  try {
    const text = await boundedText(request, 910000);
    if (text.length > 910000) return Response.json({ error: 'Audio clip is too large.' }, { status: 413, headers });
    const input = inputSchema.parse(JSON.parse(text));
    const bytes = Buffer.from(input.audio, 'base64');
    if (!hasAudioHeader(bytes, 'audio/wav') || bytes.length > 640044 || bytes.readUInt16LE(20) !== 1
      || bytes.readUInt16LE(22) !== 1 || bytes.readUInt32LE(24) !== 16000 || bytes.readUInt16LE(34) !== 16
      || bytes.toString('ascii', 36, 40) !== 'data' || bytes.readUInt32LE(40) !== bytes.length - 44) return Response.json({ error: 'Invalid audio clip.' }, { status: 400, headers });
    return Response.json({ transcript: await transcribeAudio(bytes, 'audio/wav', request.signal, { allowSilence: true, timeoutMs: 25000 }) }, { headers });
  } catch (error) {
    if (error instanceof BodyTooLarge) return Response.json({ error: 'Audio clip is too large.' }, { status: 413, headers });
    return Response.json({ error: 'Live transcription is temporarily unavailable. Recording can continue.' }, { status: error instanceof TranscriptionError ? error.status : 400, headers });
  }
}

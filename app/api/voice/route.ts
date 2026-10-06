import { z } from 'zod';
import { GeminiAPIError } from '@/lib/ai/gemini-rest';
import { generateVoice } from '@/lib/ai/voice';
import { rateLimit, sameOrigin, sessionId } from '@/lib/server-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 25;

const voiceRequestSchema = z.object({
  text: z.string().trim().min(1, 'Text is required').max(2500, 'Text is too long (maximum 2,500 characters)'),
});

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return Response.json({ error: 'Request origin not allowed.', code: 'ORIGIN' }, { status: 403 });
  }

  const sid = await sessionId();
  if (!sid) {
    return Response.json({ error: 'Session expired. Refresh to reconnect.', code: 'SESSION' }, { status: 401 });
  }

  if (!rateLimit(`voice:${sid}`, 30) || !rateLimit(`voice-hour:${sid}`, 400, 3600000)) {
    return Response.json(
      { error: 'Voice service is busy. Please wait a moment and try again.', code: 'RATE_LIMITED' },
      { status: 429, headers: { 'Retry-After': '15', 'Cache-Control': 'no-store' } }
    );
  }

  let bodyJson: unknown;
  try {
    bodyJson = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON request body.', code: 'INVALID_JSON' }, { status: 400 });
  }

  const parsed = voiceRequestSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || 'Invalid voice input.', code: 'INVALID_INPUT' },
      { status: 400 }
    );
  }

  const { text } = parsed.data;

  try {
    const audioBuffer = await generateVoice(text, AbortSignal.any([request.signal, AbortSignal.timeout(16000)]));
    return new Response(new Uint8Array(audioBuffer).buffer, {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': String(audioBuffer.byteLength),
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof GeminiAPIError) {
      return Response.json(
        { error: 'AI voice is temporarily unavailable. Recording can continue.', code: error.code },
        { status: error.status, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    return Response.json(
      { error: 'Voice service is temporarily unavailable.', code: 'TTS_ERROR' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

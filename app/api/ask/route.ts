import { z } from 'zod';
import { callGeminiGenerateContent, GeminiAPIError } from '@/lib/ai/gemini-rest';
import { geminiMeetingModels } from '@/lib/ai/config';
import { MANUAL_ASK_INSTRUCTION } from '@/lib/ai/meeting-instructions';
import { askedInterruptionSchema, contextSchema } from '@/lib/live/policy';
import { sameOrigin, sessionId, rateLimit } from '@/lib/server-session';
import { BodyTooLarge, boundedText } from '@/lib/bounded-text';
import { securityLog } from '@/lib/security/log';
import { enforceAiQuota } from '@/lib/security/ai-quota';

export const runtime = 'nodejs';
export const maxDuration = 45;
const inputSchema = z.object({
  question: z.string().trim().min(1).max(1000),
  transcript: z.string().trim().min(1).max(60000),
  notes: z.string().max(16000),
  context: contextSchema.optional(),
  asked: z.array(askedInterruptionSchema).max(50).optional(),
}).strict();
const answerSchema = z.object({ answer: z.string().trim().min(1).max(4000) }).strict();
const headers = { 'Cache-Control': 'no-store' };

/** Read-only assistance: this endpoint has no tools or database mutation capability. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: 'Request not allowed.' }, { status: 403, headers });
  const id = await sessionId();
  if (!id) return Response.json({ error: 'Sign in to ask about this meeting.' }, { status: 401, headers });
  if (!rateLimit(`ask:${id}`, 6) || !rateLimit(`ask-hour:${id}`, 80, 3600000)) return Response.json({ error: 'Please wait a moment before asking again. Recording continues.' }, { status: 429, headers: { ...headers, 'Retry-After': '30' } });
  const quota = await enforceAiQuota('ask');
  if (quota) return quota;
  try {
    const input = inputSchema.parse(JSON.parse(await boundedText(request, 100000)));
    const data = await callGeminiGenerateContent(geminiMeetingModels(), {
      systemInstruction: { parts: [{ text: MANUAL_ASK_INSTRUCTION }] },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify(input) }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', responseJsonSchema: z.toJSONSchema(answerSchema), maxOutputTokens: 2000 },
    }, AbortSignal.any([request.signal, AbortSignal.timeout(30000)]));
    const candidate = data.candidates?.[0];
    if (candidate?.finishReason && candidate.finishReason !== 'STOP') throw new Error('Incomplete output');
    const raw = candidate?.content?.parts?.filter(part => !part.thought).map(part => part.text || '').join('');
    return Response.json(answerSchema.parse(JSON.parse(raw || '{}')), { headers });
  } catch (error) {
    const status = error instanceof BodyTooLarge ? 413 : error instanceof z.ZodError || error instanceof SyntaxError ? 422 : error instanceof GeminiAPIError ? error.status : 502;
    securityLog('ai.manual_ask_failed', { route: '/api/ask', status });
    return Response.json({ error: status === 413 ? 'Meeting context is too large.' : status === 422 ? 'Please ask a short question about a meeting with transcript text.' : 'AI is temporarily unavailable. Recording continues.' }, { status, headers });
  }
}

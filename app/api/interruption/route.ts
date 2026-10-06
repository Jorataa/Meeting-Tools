import { z } from 'zod';
import { callGeminiGenerateContent, GeminiAPIError } from '@/lib/ai/gemini-rest';
import { interruptionSchema, contextSchema, askedInterruptionSchema, MIN_INTERRUPT_CONFIDENCE, MIN_INTERRUPT_RELEVANCE, isRepeated, isUsefulQuestion } from '@/lib/live/policy';
import { rateLimit, sameOrigin, sessionId } from '@/lib/server-session';
import { BodyTooLarge, boundedText } from '@/lib/bounded-text';
import { geminiMeetingModels } from '@/lib/ai/config';
import { CLARIFICATION_INSTRUCTION } from '@/lib/ai/meeting-instructions';
import { securityLog } from '@/lib/security/log';
import { enforceAiQuota } from '@/lib/security/ai-quota';

export const runtime = 'nodejs';
export const maxDuration = 45;
const inputSchema = z.object({
  transcript: z.string().trim().min(1).max(60000),
  notes: z.string().max(16000),
  asked: z.array(askedInterruptionSchema).max(50),
  context: contextSchema.optional(),
  final: z.boolean().optional().default(false),
}).strict();
const headers = { 'Cache-Control': 'no-store' };
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: 'Request not allowed.' }, { status: 403, headers });
  const id = await sessionId();
  if (!id) return Response.json({ error: 'Session expired. Please reconnect.' }, { status: 401, headers });
  if (!rateLimit(`interrupt:${id}`, 12) || !rateLimit(`interrupt-hour:${id}`, 400, 3600000)) return Response.json({ error: 'AI is busy. Recording can continue.' }, { status: 429, headers: { ...headers, 'Retry-After': '30' } });
  const quota = await enforceAiQuota('interruption');
  if (quota) return quota;
  try {
    const text = await boundedText(request, 100000);
    const input = inputSchema.parse(JSON.parse(text));
    const models = geminiMeetingModels();
    const data = await callGeminiGenerateContent(models, {
      systemInstruction: { parts: [{ text: CLARIFICATION_INSTRUCTION }] },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify(input) }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json', responseJsonSchema: z.toJSONSchema(interruptionSchema), maxOutputTokens: 6000,
        ...(models[0].startsWith('gemini-2.5') ? { thinkingConfig: { thinkingBudget: 0 } } : {}) },
    }, AbortSignal.any([request.signal, AbortSignal.timeout(30000)]));
    const candidate = data.candidates?.[0];
    if (candidate?.finishReason && candidate.finishReason !== 'STOP') throw new Error('Incomplete output');
    const raw = candidate?.content?.parts?.filter(part => !part.thought).map(part => part.text || '').join('');
    const result = interruptionSchema.parse(JSON.parse(raw || '{}'));
    if (input.final || result.confidence < MIN_INTERRUPT_CONFIDENCE || (result.relevance ?? result.confidence) < MIN_INTERRUPT_RELEVANCE || result.category === 'none'
      || !isUsefulQuestion(result) || isRepeated(result, input.asked)) result.shouldInterrupt = false;
    return Response.json(result, { headers });
  } catch (error) {
    securityLog('ai.analysis_failed', { route: '/api/interruption', status: error instanceof GeminiAPIError ? error.status : error instanceof BodyTooLarge ? 413 : error instanceof z.ZodError || error instanceof SyntaxError ? 422 : 502 });
    if (error instanceof BodyTooLarge) return Response.json({ error: 'Meeting context is too large.' }, { status: 413, headers });
    if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ error: 'AI could not read the meeting context. Recording can continue.' }, { status: 422, headers });
    return Response.json({ error: 'AI is temporarily unavailable. Recording can continue.' }, { status: error instanceof GeminiAPIError ? error.status : 502, headers });
  }
}

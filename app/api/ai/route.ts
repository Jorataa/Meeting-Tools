import { z } from 'zod';
import { callGeminiGenerateContent, GeminiAPIError, PREFERRED_AI_MODELS } from '@/lib/ai/gemini-rest';
import { rateLimit, sameOrigin, sessionId } from '@/lib/server-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const requestSchema = z.object({
  message: z.string().min(1, 'Message is required').max(50000, 'Message is too long'),
  context: z.string().max(20000).optional(),
});

const aiResponseSchema = z.object({
  shouldSpeak: z.boolean(),
  spokenText: z.string().default(''),
  notes: z.string().default(''),
  reason: z.string().default(''),
});

export type AIResponse = z.infer<typeof aiResponseSchema>;

const SYSTEM_INSTRUCTION = `You are Hush, a quiet, thoughtful AI meeting assistant.
Your job is to:
1. Understand what participants are discussing.
2. Generate concise, useful meeting notes capturing key facts, decisions, and action items.
3. Detect important ambiguities, missing owners, or unclear deadlines.
4. Decide if clarification is CRITICALLY needed:
   - Only set shouldSpeak: true if:
     * an important deadline is ambiguous (e.g., "sometime next month" for a major milestone)
     * a responsible person/owner is unclear for an assigned action item
     * an important number/value is unclear
     * a decision cannot be accurately recorded without clarification
     * two statements directly contradict each other
   - Do NOT set shouldSpeak: true for:
     * casual conversation, greetings, humor, or side remarks
     * minor uncertainties that can reasonably be inferred
     * grammar or conversational phrasing
     * every single sentence
   - Most meeting turns should have shouldSpeak: false!
   - When shouldSpeak is true, make spokenText ONE short, polite, conversational question (max 1-2 sentences).
   - When shouldSpeak is false, spokenText must be empty "".
5. Always return a valid JSON object matching the requested schema.`;

export async function POST(request: Request) {
  if (!sameOrigin(request)) {
    return Response.json({ error: 'Request origin not allowed.', code: 'ORIGIN' }, { status: 403 });
  }

  const sid = await sessionId();
  if (!sid) {
    return Response.json({ error: 'Session expired. Refresh to reconnect.', code: 'SESSION' }, { status: 401 });
  }

  if (!rateLimit(`ai:${sid}`, 20) || !rateLimit(`ai-hour:${sid}`, 300, 3600000)) {
    return Response.json(
      { error: 'Taking a short breather. Please wait a moment and try again.', code: 'RATE_LIMITED' },
      { status: 429, headers: { 'Retry-After': '15', 'Cache-Control': 'no-store' } }
    );
  }

  let bodyJson: unknown;
  try {
    bodyJson = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON request body.', code: 'INVALID_JSON' }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(bodyJson);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || 'Invalid input.', code: 'INVALID_INPUT' },
      { status: 400 }
    );
  }

  const { message, context } = parsed.data;
  const userPrompt = context
    ? `Meeting context:\n${context}\n\nLatest meeting transcript/update:\n${message}`
    : `Meeting transcript/update:\n${message}`;

  try {
    const data = await callGeminiGenerateContent(
      PREFERRED_AI_MODELS,
      {
        systemInstruction: {
          parts: [{ text: SYSTEM_INSTRUCTION }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: userPrompt }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
          responseJsonSchema: z.toJSONSchema(aiResponseSchema),
          maxOutputTokens: 2048,
        },
      },
      request.signal
    );

    const rawText = data.candidates?.[0]?.content?.parts
      ?.filter((p: { thought?: boolean }) => !p.thought)
      ?.map((p: { text?: string }) => p.text || '')
      ?.join('')
      ?.trim();

    if (!rawText) {
      return Response.json(
        { error: 'AI returned an empty response. Please try again.', code: 'EMPTY_RESPONSE' },
        { status: 502 }
      );
    }

    let parsedResult: unknown;
    try {
      parsedResult = JSON.parse(rawText);
    } catch {
      // Attempt to extract JSON block if rawText has extraneous formatting
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) {
        parsedResult = JSON.parse(match[0]);
      } else {
        throw new Error('AI returned non-JSON text');
      }
    }

    const validated = aiResponseSchema.safeParse(parsedResult);
    if (!validated.success) {
      console.error('Invalid AI response schema:', rawText);
      return Response.json(
        { error: 'AI returned malformed meeting notes. Please retry.', code: 'MALFORMED_OUTPUT' },
        { status: 502 }
      );
    }

    return Response.json(validated.data, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof GeminiAPIError) {
      return Response.json(
        { error: error.message, code: error.code },
        { status: error.status, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    console.error('AI assistant error:', error);
    return Response.json(
      { error: 'AI connection interrupted. Your notes are saved; retry shortly.', code: 'AI_ERROR' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

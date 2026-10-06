import { callGeminiGenerateContent, GeminiAPIError } from '@/lib/ai/gemini-rest';
import {rateLimit,sameOrigin,sessionId} from '@/lib/server-session';
import {geminiConfigured} from '@/lib/ai/config';
import {enforceAiQuota} from '@/lib/security/ai-quota';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handleHealthCheck() {
  try {
    const data = await callGeminiGenerateContent('gemini-3.8-flash', {
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Reply exactly with: Gemini connected' }],
        },
      ],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 50,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts
      ?.filter((p: { thought?: boolean }) => !p.thought)
      ?.map((p: { text?: string }) => p.text || '')
      ?.join('')
      ?.trim();

    return Response.json(
      {
        success: true,
        text: text || 'Gemini connected',
      },
      {
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  } catch (error) {
    if (error instanceof GeminiAPIError) {
      return Response.json(
        {
          success: false,
          error: error.message,
          code: error.code,
        },
        {
          status: error.status,
          headers: { 'Cache-Control': 'no-store' },
        }
      );
    }
    return Response.json(
      {
        success: false,
        error: 'Failed to connect to Gemini AI.',
        code: 'UNKNOWN_ERROR',
      },
      {
        status: 500,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }
}

export async function GET() {
  if(!await sessionId())return Response.json({error:'Sign in to check AI availability.'},{status:401});
  return Response.json({configured:geminiConfigured()},{headers:{'Cache-Control':'no-store'}});
}

export async function POST(request:Request) {
  if(!sameOrigin(request))return Response.json({error:'Request origin not allowed.'},{status:403});
  const id=await sessionId();if(!id)return Response.json({error:'Sign in to check AI availability.'},{status:401});
  if(!rateLimit(`diagnostic:${id}`,3))return Response.json({error:'Please wait before checking again.'},{status:429,headers:{'Retry-After':'60'}});
  const quota=await enforceAiQuota('diagnostic');if(quota)return quota;
  return handleHealthCheck();
}

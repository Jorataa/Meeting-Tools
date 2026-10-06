import {z} from 'zod';
import {provider,ProviderError} from '@/lib/ai/gemini';
import {entitySchema,noteSchema} from '@/lib/model';
import {rateLimit,sameOrigin,sessionId} from '@/lib/server-session';
import {BodyTooLarge,boundedText} from '@/lib/bounded-text';
import {securityLog} from '@/lib/security/log';
import {enforceAiQuota} from '@/lib/security/ai-quota';
export const maxDuration=60;
const inputSchema=z.object({memory:z.object({topic:z.string().max(200),notes:z.array(noteSchema).max(200),entities:z.array(entitySchema).max(200),previousQuestions:z.array(z.object({id:z.string().max(100),gapKey:z.string().max(120),text:z.string().max(240),at:z.number(),answer:z.string().max(1000).optional(),skipped:z.boolean().optional()})).max(60)}),recent:z.array(z.object({id:z.string().max(100),speaker:z.string().max(100),text:z.string().max(3000),at:z.number()})).max(60),language:z.enum(['mixed','en','id']),final:z.boolean(),audio:z.object({base64:z.string().max(1400000).regex(/^[A-Za-z0-9+/=]+$/),mimeType:z.literal('audio/wav')}).optional()});
export async function POST(request:Request){
 if(!sameOrigin(request))return Response.json({error:'Request origin not allowed.'},{status:403});
 const id=await sessionId();if(!id)return Response.json({error:'Session expired. Refresh to reconnect.'},{status:401});
 if(!rateLimit(`process:${id}`,8)||!rateLimit(`hour:${id}`,350,3600000))return Response.json({error:'Taking a short breather. Your audio is saved; retry shortly.'},{status:429,headers:{'Retry-After':'15'}});
 const quota=await enforceAiQuota('process');if(quota)return quota;
 try{
  const text=await boundedText(request,1800000);
  const input=inputSchema.parse(JSON.parse(text));
  if(!input.audio&&!input.recent.length&&!input.final)return Response.json({error:'Nothing new to process.'},{status:400});
  return Response.json(await provider.analyze(input),{headers:{'Cache-Control':'no-store'}});
 }catch(error){if(error instanceof BodyTooLarge)return Response.json({error:'Audio clip is too large.'},{status:413});if(error instanceof z.ZodError||error instanceof SyntaxError)return Response.json({error:'Invalid meeting input.'},{status:400});securityLog('ai.process_failed',{route:'/api/process',status:error instanceof ProviderError?error.status:502,code:'PROCESS_FAILED'});if(error instanceof ProviderError)return Response.json({error:'AI analysis is temporarily unavailable.'},{status:error.status});return Response.json({error:'AI connection timed out. Audio and notes are saved; retry shortly.'},{status:502});}
}

import {createSession,rateLimit,sameOrigin,sessionId} from '@/lib/server-session';
import {geminiConfigured} from '@/lib/ai/config';
export async function POST(request:Request){
 if(!sameOrigin(request))return Response.json({error:'Request origin not allowed.'},{status:403});
 if(!await sessionId()){
  const ip=request.headers.get('x-forwarded-for')?.split(',')[0]||'local';
  if(!rateLimit(`bootstrap:${ip}`,60,3600000))return Response.json({error:'Too many sessions. Please try again later.'},{status:429});
  await createSession();
 }
 return Response.json({ai:geminiConfigured()},{headers:{'Cache-Control':'no-store'}});
}

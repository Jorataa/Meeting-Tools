import {createSession,rateLimit,sameOrigin,sessionId} from '@/lib/server-session';
import {geminiConfigured} from '@/lib/ai/config';
import {authMode,refreshAuthSession} from '@/lib/auth/server';
export async function POST(request:Request){
 if(!sameOrigin(request))return Response.json({error:'Request origin not allowed.'},{status:403});
 if(!await sessionId()){
  if(authMode()==='supabase'){
   if(!await refreshAuthSession()||!await sessionId())return Response.json({error:'Sign in to start a meeting.',code:'AUTH_REQUIRED'},{status:401,headers:{'Cache-Control':'no-store'}});
  }else if(authMode()!=='demo')return Response.json({error:'Authentication is not configured. Contact the app owner.',code:'AUTH_UNAVAILABLE'},{status:503,headers:{'Cache-Control':'no-store'}});
  else {
  const ip=request.headers.get('x-forwarded-for')?.split(',')[0]||'local';
  if(!rateLimit(`bootstrap:${ip}`,60,3600000))return Response.json({error:'Too many sessions. Please try again later.'},{status:429});
  await createSession();
  }
 }
 return Response.json({ai:geminiConfigured()},{headers:{'Cache-Control':'no-store'}});
}

import 'server-only';
import {accessToken,authMode,serverSupabase} from '@/lib/auth/server';
import {securityLog} from './log';
export type AiScope='transcribe'|'interruption'|'ask'|'voice'|'ai'|'process'|'diagnostic'|'live-create';
/** Shared account quotas survive deploys/instances; PCM frames bypass this gate. */
export async function enforceAiQuota(scope:AiScope):Promise<Response|null>{
 if(authMode()!=='supabase')return null;
 const token=await accessToken(),client=token?serverSupabase(token):null;
 if(!client)return Response.json({error:'Sign in to use AI.',code:'AUTH_REQUIRED'},{status:401,headers:{'Cache-Control':'no-store'}});
 try{
  const{data,error}=await client.rpc('hush_consume_ai_quota',{requested_scope:scope});
  if(error||typeof data!=='boolean')throw new Error('Quota unavailable');
  if(data)return null;
  securityLog('ai.quota_rejected',{status:429,code:'RATE_LIMITED'});
  return Response.json({error:'Please wait a moment before trying AI again. Live transcription can continue.',code:'RATE_LIMITED'},{status:429,headers:{'Retry-After':'60','Cache-Control':'no-store'}});
 }catch{
  securityLog('ai.quota_unavailable',{status:503,code:'QUOTA_UNAVAILABLE'});
  return Response.json({error:'AI access is temporarily unavailable. Your transcript is still available.',code:'QUOTA_UNAVAILABLE'},{status:503,headers:{'Cache-Control':'no-store'}});
 }
}

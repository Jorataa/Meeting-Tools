import 'server-only';
import {z} from 'zod';
import {authMode,serverSupabase,setAuthSession} from './server';
import {rateLimit,sameOrigin} from '@/lib/server-session';
import {BodyTooLarge,boundedText} from '@/lib/bounded-text';
import {securityLog} from '@/lib/security/log';
const schema=z.object({email:z.email().max(254),password:z.string().min(1).max(200)}).strict();
const headers={'Cache-Control':'no-store'};
export async function credentials(request:Request,signup:boolean){
 if(!sameOrigin(request))return Response.json({error:'Request origin not allowed.'},{status:403,headers});
 if(authMode()!=='supabase')return Response.json({error:'Account sign-in is not configured.'},{status:503,headers});
 const ip=request.headers.get('x-forwarded-for')?.split(',')[0].trim()||'local';
 if(!rateLimit(`auth:${ip}`,10,600000))return Response.json({error:'Please wait before trying again.'},{status:429,headers:{...headers,'Retry-After':'600'}});
 try{
  if(!request.headers.get('content-type')?.startsWith('application/json'))return Response.json({error:'Send a valid sign-in request.'},{status:400,headers});
  const parsed=schema.safeParse(JSON.parse(await boundedText(request,2000)));
  if(!parsed.success||(signup&&parsed.data.password.length<8))return Response.json({error:signup?'Enter a valid email and a password with at least 8 characters.':'Enter a valid email and password.'},{status:400,headers});
  const client=serverSupabase()!;
  const{data,error}=signup?await client.auth.signUp(parsed.data):await client.auth.signInWithPassword(parsed.data);
  if(error){securityLog('auth.credentials_rejected',{status:401,code:'SIGN_IN_FAILED'});return Response.json({error:signup?'Unable to create this account. Check your email or try signing in.':'Email or password is incorrect.'},{status:401,headers});}
  if(data.session)await setAuthSession(data.session);
  return Response.json({success:true,confirmationRequired:!data.session},{headers});
 }catch(error){
  if(error instanceof BodyTooLarge)return Response.json({error:'Sign-in request is too large.'},{status:413,headers});
  if(error instanceof SyntaxError)return Response.json({error:'Invalid sign-in request.'},{status:400,headers});
  securityLog('auth.failed',{status:503,code:'AUTH_PROVIDER'});return Response.json({error:'Sign-in is temporarily unavailable. Please retry.'},{status:503,headers});
 }
}

import 'server-only';
import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {cookies} from 'next/headers';
import {authMode,verifiedRequestIdentity} from '@/lib/auth/server';
const ephemeral=randomBytes(32).toString('hex');
function secret(){return process.env.SESSION_SECRET||ephemeral;}
const cookieName='hush_session';
export async function createSession(){
 if(authMode()!=='demo')throw new Error('Demo sessions are disabled.');
 const payload=`${randomBytes(18).toString('hex')}.${Date.now()+12*3600000}`;
 const signature=createHmac('sha256',secret()).update(payload).digest('hex');
 (await cookies()).set(cookieName,`${payload}.${signature}`,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:12*3600});
}
export async function sessionId(){
 if(authMode()==='supabase')return (await verifiedRequestIdentity())?.id??null;
 if(authMode()!=='demo')return null;
 const value=(await cookies()).get(cookieName)?.value;if(!value)return null;
 const pieces=value.split('.');if(pieces.length!==3)return null;
 const [id,expires,signature]=pieces;
 if(!/^[a-f0-9]{36}$/.test(id)||!/^\d{13}$/.test(expires)||!Number.isSafeInteger(Number(expires))||Number(expires)<Date.now()||!/^[a-f0-9]{64}$/.test(signature))return null;
 const expected=createHmac('sha256',secret()).update(`${id}.${expires}`).digest('hex');const a=Buffer.from(signature),b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b)?id:null;
}
const buckets=new Map<string,{at:number;count:number}>();
export function rateLimit(key:string,limit:number,window=60000){const now=Date.now();if(buckets.size>5000){for(const [k,v]of buckets)if(now-v.at>3600000)buckets.delete(k);if(buckets.size>10000&&!buckets.has(key))return false;}const b=buckets.get(key);if(!b||now-b.at>=window){buckets.set(key,{at:now,count:1});return true;}b.count++;return b.count<=limit;}
export function sameOrigin(request:Request){
 const origin=request.headers.get('origin');if(!origin)return false;
 try{
  const supplied=new URL(origin),url=new URL(request.url);
  // Next can use its bind address (0.0.0.0) for request.url. The browser's
  // Host header retains the public hostname, including a forwarded dev port.
  const host=request.headers.get('host')||url.host;
  const protocol=(request.headers.get('x-forwarded-proto')?.split(',')[0].trim()||url.protocol.replace(':',''))+':';
  return ['http:','https:'].includes(supplied.protocol)&&supplied.host===host&&supplied.protocol===protocol;
 }catch{return false;}
}

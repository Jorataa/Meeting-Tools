import 'server-only';
import {createHash} from 'node:crypto';
import {cookies} from 'next/headers';
import {createClient, type Session, type SupabaseClient} from '@supabase/supabase-js';
import {securityLog} from '@/lib/security/log';

export type AuthUser = {id:string; email:string | null};
export const ACCESS_COOKIE='hush_access';
export const REFRESH_COOKIE='hush_refresh';
export function authMode(): 'supabase'|'demo'|'unavailable' {
 if(process.env.HUSH_AUTH_MODE==='demo') return process.env.NODE_ENV!=='production'||(process.env.SESSION_SECRET?.length??0)>=32?'demo':'unavailable';
 if(process.env.NODE_ENV==='test'&&!process.env.HUSH_AUTH_MODE) return 'demo';
 return supabaseConfig() ? 'supabase' : 'unavailable';
}
function supabaseConfig() {
 const url=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL;
 const key=process.env.SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
 if(!url||!key) return null;
 try {const parsed=new URL(url); if(parsed.protocol!=='https:'&&!(process.env.NODE_ENV!=='production'&&['localhost','127.0.0.1'].includes(parsed.hostname)))return null;}catch{return null;}
 // Never let an accidentally configured privileged key become a normal client.
 if(key.startsWith('sb_secret_'))return null;
 if(key.split('.').length===3) try {if(JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString()).role!=='anon')return null;}catch{return null;}
 return {url,key};
}
export function serverSupabase(accessToken?:string): SupabaseClient | null {
 const config=supabaseConfig(); if(!config)return null;
 return createClient(config.url,config.key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
  global:{...(accessToken?{headers:{Authorization:`Bearer ${accessToken}`}}:{}),fetch:(input,init)=>fetch(input,{...init,signal:init?.signal?AbortSignal.any([init.signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000)})}});
}
const verified=new Map<string,{until:number;user:AuthUser}>();
const pending=new Map<string,Promise<AuthUser|null>>();
const refreshing=new Map<string,Promise<Session|null>>();
function tokenKey(token:string){return createHash('sha256').update(token).digest('hex');}
export async function accessToken(){return (await cookies()).get(ACCESS_COOKIE)?.value??null;}
export async function verifiedRequestIdentity():Promise<AuthUser|null> {
 if(authMode()!=='supabase')return null;
 const token=await accessToken(); if(!token||token.length>12000)return null;
 const key=tokenKey(token),cached=verified.get(key);if(cached&&cached.until>Date.now())return cached.user;
 const existing=pending.get(key);if(existing)return existing;
 if(pending.size>=256){securityLog('auth.busy',{code:'AUTH_CAPACITY'});return null;}
 const task=(async()=>{
  try {const client=serverSupabase();if(!client)return null;
   const {data,error}=await client.auth.getUser(token);
   if(error||!data.user||data.user.is_anonymous){securityLog('auth.rejected',{code:'INVALID_SESSION'});return null;}
   const user={id:data.user.id,email:data.user.email??null};
   if(verified.size>=2000){for(const[k,v]of verified)if(v.until<Date.now())verified.delete(k);if(verified.size>=2000)verified.delete(verified.keys().next().value!);}
   verified.set(key,{until:Date.now()+30000,user});return user;
  }catch{securityLog('auth.unavailable',{code:'AUTH_PROVIDER'});return null;}
 })();pending.set(key,task);
 try{return await task;}finally{pending.delete(key);}
}
const options=()=>({httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict' as const,path:'/'});
export async function setAuthSession(session:Session){
 const store=await cookies();store.set(ACCESS_COOKIE,session.access_token,{...options(),maxAge:Math.max(1,session.expires_in)});
 store.set(REFRESH_COOKIE,session.refresh_token,{...options(),maxAge:30*86400});
}
export async function refreshAuthSession(){
 const client=serverSupabase(),refresh=(await cookies()).get(REFRESH_COOKIE)?.value;
 if(!client||!refresh||refresh.length>12000)return false;
 const key=tokenKey(refresh);
 let task=refreshing.get(key);
 if(!task&&refreshing.size>=256)return false;
 if(!task){task=(async()=>{try{const{data,error}=await client.auth.refreshSession({refresh_token:refresh});return error||!data.session||data.user?.is_anonymous?null:data.session;}catch{return null;}})();refreshing.set(key,task);}
 try{const session=await task;if(!session)return false;await setAuthSession(session);return true;}
 finally{if(refreshing.get(key)===task)refreshing.delete(key);}
}
export async function clearAuthSession(){
 const store=await cookies(),token=store.get(ACCESS_COOKIE)?.value;
 if(token)verified.delete(tokenKey(token));
 store.set(ACCESS_COOKIE,'',{...options(),maxAge:0});store.set(REFRESH_COOKIE,'',{...options(),maxAge:0});store.set('hush_session','',{...options(),maxAge:0});
 if(token){const config=supabaseConfig();if(config)try{await fetch(`${config.url}/auth/v1/logout?scope=local`,{method:'POST',headers:{apikey:config.key,Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(5000)});}catch{securityLog('auth.logout_provider_failed',{code:'AUTH_PROVIDER'});}}
}

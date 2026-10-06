import 'server-only';
import {geminiKeys} from '@/lib/ai/config';
import {securityLog} from '@/lib/security/log';

export function ephemeralLiveTransport() {
 const configured = process.env.GEMINI_LIVE_TRANSPORT;
 if (configured === 'relay' || configured === 'server') return false;
 return configured === 'ephemeral' || process.env.VERCEL === '1' || !configured;
}

/** Provider-enforced, immutable transcription setup; the browser never receives a durable key. */
export async function createTranscriptionToken() {
 const keys = geminiKeys();
 if (!keys.length) throw new Error('Live transcription needs a Gemini API key configured on the server.');
 const setup = {
  model: `models/${(process.env.GEMINI_LIVE_MODEL || 'gemini-3.5-transcribe-live').replace(/^models\//, '')}`,
  generationConfig: {responseModalities:['TEXT']},
  inputAudioTranscription: {languageCodes:[]},
 };
 const expiresAt = Date.now() + 16 * 60000;
 const deadline = Date.now() + 12000;
 for (let index = 0; index < keys.length; index++) {
  if (Date.now() >= deadline) break;
  try {
   const response = await fetch('https://generativelanguage.googleapis.com/v1beta/auth_tokens', {
    method:'POST', headers:{'Content-Type':'application/json','x-goog-api-key':keys[index]},
    body:JSON.stringify({uses:1,expireTime:new Date(expiresAt).toISOString(),newSessionExpireTime:new Date(Date.now()+60000).toISOString(),bidiGenerateContentSetup:setup}),
    signal:AbortSignal.timeout(Math.max(1,deadline-Date.now())), cache:'no-store',
   });
   if (!response.ok) { securityLog('transcription.token_failed',{status:response.status,code:'LIVE_TOKEN_PROVIDER'}); continue; }
   const data = await response.json();
   if (typeof data.name !== 'string' || !data.name || data.name.length > 8192) throw new Error('Invalid provider token');
   // The REST API ignores all browser setup overrides because fieldMask is empty.
   // No tools, system actions, recording store, or other users' data are configured.
   return {transport:'ephemeral' as const,token:data.name,setup,expiresAt};
  } catch { securityLog('transcription.token_failed',{status:503,code:'LIVE_TOKEN_UNAVAILABLE'}); }
 }
 throw new Error('Live transcription could not connect. Check Gemini model access, quota, and server connection.');
}

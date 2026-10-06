import { createLiveSession, getLiveSession } from '@/lib/live/transcription-server';
import { rateLimit, sameOrigin, sessionId } from '@/lib/server-session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 14400;
const headers = {'Cache-Control':'no-store'};
const failure = (error: string, status: number) => Response.json({error}, {status, headers});

async function owner(request: Request, reading = false) {
 // Same-origin GET fetches can omit Origin. Strict session cookies and Fetch Metadata
 // still exclude cross-site reads, while every mutation requires a matching Origin.
 if (!sameOrigin(request) && !(reading && !request.headers.get('origin') && request.headers.get('sec-fetch-site') !== 'cross-site')) return null;
 return sessionId();
}

export async function POST(request: Request) {
 const identity = await owner(request);
 if (!identity) return failure('Your recording session expired. Refresh and try again.', 401);
 const url = new URL(request.url), id = url.searchParams.get('id');
 if (!id) {
  if (!rateLimit(`live:create:${identity}`, 12)) return failure('Too many recording attempts. Wait a minute and retry.', 429);
  try { return Response.json({id:createLiveSession(identity).id}, {headers}); }
  catch (cause) {
   // Factory errors can contain authenticated upstream URLs. Only public messages
   // generated here or by the session's deliberate validation reach the browser.
   const message = cause instanceof Error && /^(Live transcription needs a Gemini API key configured on the server\.|Another live transcription is active\. Stop it before starting a new recording\.)$/.test(cause.message)
    ? cause.message : 'Live transcription could not start. Check the server configuration and connection.';
   return failure(message, 503);
  }
 }
 const session = getLiveSession(id, identity);
 if (!session) return failure('Live transcription session expired. Stop and start a new recording.', 410);
 if (!rateLimit(`live:audio:${identity}`, 1200)) return failure('Audio is arriving too quickly. Stop and try again.', 429);
 const action = url.searchParams.get('action');
 if (action === 'pause' || action === 'resume' || action === 'end' || action === 'cancel') {
  if (action === 'end') session.end();
  else if (action === 'cancel') session.close();
  else session.setPaused(action === 'pause');
  return Response.json({ok:true}, {headers});
 }
 if (request.headers.get('content-type') !== 'application/octet-stream') return failure('Expected PCM audio bytes.', 415);
 const frame = Number(url.searchParams.get('frame'));
 if (!url.searchParams.has('frame') || !Number.isSafeInteger(frame) || frame < 0) return failure('Invalid audio sequence.', 400);
 const declared = Number(request.headers.get('content-length') || 0);
 if (declared > 12800) return failure('Audio frame is too large.', 413);
 const reader = request.body?.getReader();
 if (!reader) return failure('Audio frame is empty.', 400);
 const chunks: Uint8Array[] = []; let size = 0;
 let bodyTimer: ReturnType<typeof setTimeout> | undefined;
 const bodyDeadline = new Promise<never>((_, reject) => {
  bodyTimer = setTimeout(() => reject(new Error('Audio body timed out.')), 5000);
 });
 try {
  while (true) {
   const chunk = await Promise.race([reader.read(), bodyDeadline]); if (chunk.done) break;
   size += chunk.value.length;
   if (size > 12800) { await reader.cancel().catch(() => {}); return failure('Audio frame is too large.', 413); }
   chunks.push(chunk.value);
  }
  if (!size || size % 2) return failure('Invalid 16-bit PCM audio frame.', 400);
  session.append(Buffer.concat(chunks), frame);
  return Response.json({ok:true}, {headers});
 } catch { return failure('Live audio stream was interrupted. Stop and retry.', 409); }
 finally {
  if (bodyTimer) clearTimeout(bodyTimer);
  void reader.cancel().catch(() => {});
  reader.releaseLock();
 }
}

export async function GET(request: Request) {
 const identity = await owner(request, true);
 if (!identity) return failure('Your recording session expired. Refresh and try again.', 401);
 const url = new URL(request.url);
 const session = getLiveSession(url.searchParams.get('id') || '', identity);
 if (!session) return failure('Live transcription session expired. Stop and start a new recording.', 410);
 if (!rateLimit(`live:subscribe:${identity}`, 60)) return failure('Too many reconnection attempts. Wait a minute and retry.', 429);
 const encoder = new TextEncoder();
 let unsubscribe = () => {}; let heartbeat: ReturnType<typeof setInterval> | undefined;
 let ended = false;
 const cleanup = () => { ended = true; unsubscribe(); if (heartbeat) clearInterval(heartbeat); };
 const stream = new ReadableStream<Uint8Array>({
  start(controller) {
   const listener = (event: Parameters<Parameters<typeof session.subscribe>[0]>[0]) => {
    if (ended) return;
    try {
     // Refuse unbounded buffering if a browser stops reading.
     if ((controller.desiredSize || 0) < -512) { cleanup(); controller.close(); return; }
     controller.enqueue(encoder.encode(`id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`));
     if (event.type === 'done') { cleanup(); controller.close(); }
    } catch { cleanup(); }
   };
   unsubscribe = session.subscribe(listener, Math.max(0, Number(url.searchParams.get('after')) || 0));
   if (ended) { unsubscribe(); return; }
   heartbeat = setInterval(() => {
    try {
     if ((controller.desiredSize || 0) < -512) { cleanup(); controller.close(); return; }
     session.touch();
     controller.enqueue(encoder.encode(': heartbeat\n\n'));
    } catch { cleanup(); }
   }, 10000);
   request.signal.addEventListener('abort', () => { cleanup(); try { controller.close(); } catch {} }, {once:true});
  },
  cancel() { cleanup(); },
 });
 return new Response(stream, {headers:{...headers, 'Content-Type':'text/event-stream', 'Connection':'keep-alive', 'X-Accel-Buffering':'no'}});
}

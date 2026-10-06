import 'server-only';
import { randomUUID } from 'node:crypto';
import { geminiKeys } from '../ai/config';

export type StreamEvent = { sequence: number; type: 'ready' | 'partial' | 'final' | 'status' | 'done'; text?: string; at?: number; id?: string; status?: 'connecting' | 'listening' | 'reconnecting' | 'error'; notice?: string };
type Listener = (event: StreamEvent) => void;
const MAX_PENDING_AUDIO = 96000; // Three seconds, never an unbounded recording queue.
const UPSTREAM = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

/** A server-owned Gemini connection. Only sanitized events cross the browser boundary. */
export class LiveTranscriptionSession {
 readonly id = randomUUID();
 readonly events: StreamEvent[] = [];
 private listeners = new Set<Listener>();
 private socket: WebSocket | null = null;
 private queued: Buffer[] = [];
 private queuedBytes = 0;
 private sequence = 0;
 private utterance = 0;
 private utteranceAt = 0;
 private sawPartial = false;
 private ready = false;
 private closed = false;
 private ending = false;
 private paused = false;
 private pausedAt: number | null = null;
 private pausedSeconds = 0;
 private attempts = 0;
 private keyIndex = 0;
 private retry: ReturnType<typeof setTimeout> | null = null;
 private setupTimeout: ReturnType<typeof setTimeout> | null = null;
 private finishTimeout: ReturnType<typeof setTimeout> | null = null;
 private maintenance: ReturnType<typeof setInterval>;
 private draining: ReturnType<typeof setInterval>;
 private touched = Date.now();
 private lastFrame = -1;
 private audioSeconds = 0;
 private boundaryPending = false;
 private keys: string[];

 constructor(readonly owner: string, private remove: () => void, private socketFactory: (url: string) => WebSocket = url => new WebSocket(url)) {
  this.keys = geminiKeys();
  if (!this.keys.length) throw new Error('Live transcription needs a Gemini API key configured on the server.');
  this.maintenance = setInterval(() => {
   if (Date.now() - this.touched > 60000) this.close();
  }, 15000);
  this.maintenance.unref?.();
  this.draining = setInterval(() => this.drainAudio(), 100);
  this.draining.unref?.();
 }
 connect() {
  if (this.closed || this.ending) return;
  this.emit({type:'status', status: this.attempts ? 'reconnecting' : 'connecting', notice: this.attempts ? 'Reconnecting transcription. Your transcript is retained; there may be a brief gap.' : undefined});
  let socket: WebSocket;
  try { socket = this.socketFactory(`${UPSTREAM}?key=${encodeURIComponent(this.keys[this.keyIndex % this.keys.length])}`); }
  catch { this.fail('Live transcription could not reach Gemini. Check the server network connection.'); return; }
  this.socket = socket;
  this.setupTimeout = setTimeout(() => { if (!this.ready && this.socket === socket) socket.close(); }, 12000);
  this.setupTimeout.unref?.();
  socket.addEventListener('open', () => {
   if (this.socket !== socket || this.closed) return;
   socket.send(JSON.stringify({setup: {
    model: `models/${(process.env.GEMINI_LIVE_MODEL || 'gemini-3.5-transcribe-live').replace(/^models\//, '')}`,
    generationConfig: {responseModalities:['TEXT']},
    inputAudioTranscription: {languageCodes:[]},
   }}));
  });
  socket.addEventListener('message', async event => {
   if (this.socket !== socket || this.closed) return;
   try {
    const raw = typeof event.data === 'string' ? event.data : event.data instanceof Blob ? await event.data.text() : new TextDecoder().decode(event.data);
    if (this.socket !== socket || this.closed) return;
    this.receive(JSON.parse(raw));
   } catch { this.fail('Live transcription returned an unreadable response. Please stop and retry.'); }
  });
  // Close is authoritative; native WebSocket error events do not include safe details.
  socket.addEventListener('error', () => {});
  socket.addEventListener('close', event => {
   if (this.socket !== socket || this.closed) return;
   this.ready = false;
   if (this.setupTimeout) clearTimeout(this.setupTimeout);
   if (this.ending) { this.close(); return; }
   if ([1008, 1003].includes(event.code)) {
    if (this.keyIndex + 1 < this.keys.length) this.keyIndex++;
    else { this.fail('Gemini Live transcription is unavailable for this API key or model. Check GEMINI_LIVE_MODEL and Gemini access on the server.'); return; }
   }
   this.attempts++;
   if (this.attempts > 5) { this.fail('Live transcription could not reconnect. Your transcript and local recording are retained. Stop and try again.'); return; }
   this.retry = setTimeout(() => this.connect(), Math.min(4000, 350 * 2 ** (this.attempts - 1)));
   this.retry.unref?.();
  });
 }
 receive(message: Record<string, unknown>) {
  if (message.error) { this.fail('Gemini Live transcription could not start. Check the server API key, model access, and quota.'); return; }
  if (message.setupComplete !== undefined) {
   this.ready = true; this.attempts = 0;
   if (this.setupTimeout) clearTimeout(this.setupTimeout);
   this.emit({type:'ready', status:'listening'});
   this.drainAudio();
   return;
  }
  const content = message.serverContent as {interimInputTranscription?: {text?: string}; inputTranscription?: {text?: string}; turnComplete?: boolean} | undefined;
  if (!content) return;
  const interim = content.interimInputTranscription?.text;
  // Empty hypotheses never erase the previous readable preview.
  if (typeof interim === 'string' && interim.trim()) {
   if (!this.sawPartial) this.utteranceAt = Math.max(0, this.audioSeconds + this.pausedSeconds - .3);
   this.sawPartial = true;
   this.emit({type:'partial', text:interim.trim(), at:this.utteranceAt});
  }
  const final = content.inputTranscription?.text?.trim();
  if (final) {
   this.emit({type:'final', text:final, at:this.sawPartial ? this.utteranceAt : Math.max(0, this.audioSeconds + this.pausedSeconds - 1), id:`${this.id}:${++this.utterance}`});
   this.sawPartial = false;
  }
 }
 append(audio: Buffer, frame: number) {
  this.touched = Date.now();
  if (this.closed || this.ending) throw new Error('Transcription session ended. Start a new recording.');
  if (frame <= this.lastFrame) return; // An acknowledged HTTP retry cannot duplicate audio.
  if (frame !== this.lastFrame + 1) throw new Error('Audio frame arrived out of order.');
  this.lastFrame = frame;
  if (this.paused) return;
  this.audioSeconds += audio.length / 32000;
  {
   this.queued.push(audio); this.queuedBytes += audio.length;
   let dropped = false;
   while (this.queuedBytes > MAX_PENDING_AUDIO) { this.queuedBytes -= this.queued.shift()!.length; dropped = true; }
   if (dropped) this.emit({type:'status', status:'reconnecting', notice:'The connection is slow. Some recent audio could not be streamed; your local recording is retained.'});
  }
  this.drainAudio();
 }
 setPaused(value: boolean) {
  this.touch();
  if (this.paused === value) return;
  this.paused = value;
  if (value) { this.pausedAt = Date.now(); this.finishAudio(); }
  else if (this.pausedAt !== null) {
   this.pausedSeconds += (Date.now() - this.pausedAt) / 1000;
   this.pausedAt = null;
  }
 }
 touch() { this.touched = Date.now(); }
 finishAudio() {
  // A pause or stop must follow the final queued PCM, including after reconnect.
  this.boundaryPending = true;
  this.drainAudio();
 }
 end() {
  if (this.closed || this.ending) return;
  this.ending = true;
  this.finishAudio();
  // Keep the return stream alive for the provider's authoritative final transcript.
  this.finishTimeout = setTimeout(() => this.close(), 1800);
  this.finishTimeout.unref?.();
 }
 subscribe(listener: Listener, after = 0) {
  for (const event of this.events) if (event.sequence > after) listener(event);
  if (!this.closed) this.listeners.add(listener);
  return () => this.listeners.delete(listener);
 }
 close() {
  if (this.closed) return;
  this.closed = true;
  if (this.retry) clearTimeout(this.retry);
  if (this.setupTimeout) clearTimeout(this.setupTimeout);
  if (this.finishTimeout) clearTimeout(this.finishTimeout);
  clearInterval(this.maintenance);
  clearInterval(this.draining);
  this.emit({type:'done', notice:this.sawPartial ? 'The last preview was not finalized. Your recording is retained.' : undefined});
  this.socket?.close(); this.socket = null; this.listeners.clear();
  this.queued = []; this.queuedBytes = 0; this.remove();
 }
 private sendAudio(audio: Buffer) {
  this.socket?.send(JSON.stringify({realtimeInput:{audio:{data:audio.toString('base64'), mimeType:'audio/pcm;rate=16000'}}}));
 }
 private drainAudio() {
  if (!this.ready || this.closed || this.socket?.readyState !== WebSocket.OPEN) return;
  while (this.queued.length && this.socket.bufferedAmount < MAX_PENDING_AUDIO) {
   const audio = this.queued.shift()!; this.queuedBytes -= audio.length;
   try { this.sendAudio(audio); } catch {
    this.queued.unshift(audio); this.queuedBytes += audio.length;
    this.socket.close(); return;
   }
  }
  if (this.boundaryPending && !this.queued.length && this.socket.bufferedAmount < MAX_PENDING_AUDIO) {
   try {
    this.socket.send(JSON.stringify({realtimeInput:{audioStreamEnd:true}}));
    this.boundaryPending = false;
   } catch { this.socket.close(); }
  }
 }
 private fail(notice: string) { this.emit({type:'status', status:'error', notice}); this.close(); }
 private emit(event: Omit<StreamEvent, 'sequence'>) {
  const item = {...event, sequence:++this.sequence};
  this.events.push(item);
  if (this.events.length > 512) this.events.shift();
  for (const listener of this.listeners) listener(item);
 }
}

const globalSessions = globalThis as typeof globalThis & {hushLiveSessions?: Map<string, LiveTranscriptionSession>};
const sessions = globalSessions.hushLiveSessions ||= new Map<string, LiveTranscriptionSession>();
export function createLiveSession(owner: string) {
 if (sessions.size >= 64 || [...sessions.values()].filter(session => session.owner === owner).length >= 2) throw new Error('Another live transcription is active. Stop it before starting a new recording.');
 const session = new LiveTranscriptionSession(owner, () => sessions.delete(session.id));
 sessions.set(session.id, session); session.connect(); return session;
}
export function getLiveSession(id: string, owner: string) {
 const session = sessions.get(id);
 return session?.owner === owner ? session : undefined;
}

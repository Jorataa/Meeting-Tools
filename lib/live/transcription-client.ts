'use client';
import {DirectTranscription,type TranscriptionCredential} from './transcription-direct';

type Callbacks = {
 onPartial: (text: string, at: number) => void;
 onFinal: (text: string, at: number, id: string) => void;
 onStatus: (status: 'connecting' | 'listening' | 'reconnecting' | 'error', notice?: string) => void;
 onLevel: (level: number, voice: boolean) => void;
};
type WireEvent = { sequence: number; type: string; text?: string; at?: number; id?: string; status?: 'connecting' | 'listening' | 'reconnecting' | 'error'; notice?: string };
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Raw PCM capture and transport only. AI reasoning is a separate consumer. */
export class StreamingTranscription {
 private context?: AudioContext;
 private node?: AudioWorkletNode;
 private source?: MediaStreamAudioSourceNode;
 private silent?: GainNode;
 private abort = new AbortController();
 private id = '';
 private paused = false;
 private suppressed = false;
 private stopping = false;
 private cancelled = false;
 private ready = false;
 private ended = false;
 private serverClosed = false;
 private after = 0;
 private queue: Uint8Array[] = [];
 private heldAudio: Uint8Array[] = [];
 private pendingControls = 0;
 private serverPaused = false;
 private queuedBytes = 0;
 private frame = 0;
 private startedAt = 0;
 private sending = false;
 private readerTask?: Promise<void>;
 private activeReader?: ReadableStreamDefaultReader<Uint8Array>;
 private controls: Promise<void> = Promise.resolve();
 private resolveReady?: () => void;
 private rejectReady?: (error: Error) => void;
 private readyTimer?: ReturnType<typeof setTimeout>;
 private direct?: DirectTranscription;
 private directSequence = 0;
 constructor(private callbacks: Callbacks) {}

 async start(stream: MediaStream): Promise<void> {
  this.startedAt = Date.now();
  this.callbacks.onStatus('connecting');
  try {
   this.context = new AudioContext({latencyHint:'interactive'});
   await this.context.resume();
   await this.context.audioWorklet.addModule('/audio-worklet.js');
   if (this.cancelled) return;
   this.source = this.context.createMediaStreamSource(stream);
   this.node = new AudioWorkletNode(this.context, 'hush-capture');
   this.silent = this.context.createGain(); this.silent.gain.value = 0;
   this.node.port.onmessage = event => this.capture(event.data as Float32Array);
   this.source.connect(this.node); this.node.connect(this.silent); this.silent.connect(this.context.destination);
   const session = await this.request('/api/session', {method:'POST'}, 15000);
   if (!session.ok) throw new Error('Could not establish a secure recording session. Refresh and retry.');
   const created = await this.request('/api/live/stream', {method:'POST'}, 15000);
   if (!created.ok) throw new Error(await this.errorMessage(created, 'Live transcription could not connect.'));
   const data = await created.json();
   if (!data || typeof data !== 'object') throw new Error('Live transcription could not create a session.');
   if (data.transport === 'ephemeral') {
    this.direct = new DirectTranscription(event => this.handle({...event,sequence:++this.directSequence}), async () => {
     const renewed = await this.request('/api/live/stream',{method:'POST'},15000);
     if (!renewed.ok) throw new Error(await this.errorMessage(renewed,'Live transcription could not reconnect.'));
     const credential = await renewed.json();
     if (credential.transport !== 'ephemeral' || typeof credential.token !== 'string') throw new Error('Live transcription could not reconnect.');
     return credential as TranscriptionCredential;
    }, () => { void this.pump(); });
    await this.direct.start(data as TranscriptionCredential); return;
   }
   if (typeof data.id !== 'string') throw new Error('Live transcription could not create a session.');
   this.id = data.id;
   const ready = new Promise<void>((resolve, reject) => {
    this.resolveReady = resolve; this.rejectReady = reject;
    this.readyTimer = setTimeout(() => reject(new Error('Live transcription did not connect in time. Check your connection and Gemini model access.')), 20000);
   });
   this.readerTask = this.readEvents();
   await ready;
   void this.pump();
  } catch (cause) {
   if (this.cancelled) return;
   const message = cause instanceof Error ? cause.message : 'Live microphone streaming is unavailable in this browser.';
   this.callbacks.onStatus('error', message); this.cancel(); throw new Error(message);
  }
 }
 setPaused(paused: boolean) {
  if (this.paused === paused || this.cancelled || this.stopping) return;
  this.paused = paused; this.node?.port.postMessage('discard');
  this.callbacks.onLevel(0, false);
  // Ordered after already captured audio so pause cannot overtake speech.
  this.enqueueControl(paused || this.suppressed ? 'pause' : 'resume');
 }
 setSuppressed(suppressed: boolean) {
  if (this.suppressed === suppressed || this.cancelled || this.stopping) return;
  this.suppressed = suppressed; this.node?.port.postMessage('discard');
  this.callbacks.onLevel(0, false);
  this.enqueueControl(suppressed || this.paused ? 'pause' : 'resume');
 }
 async stop(): Promise<void> {
  if (this.cancelled || this.stopping) return;
  // Flush the worklet's final sub-frame before detaching its source.
  const finishBy = Date.now() + 5500;
  this.node?.port.postMessage('flush');
  await delay(35);
  this.stopping = true;
  this.source?.disconnect();
  const deadline = Date.now() + 3000;
  await Promise.race([this.controls, delay(Math.max(0, deadline - Date.now()))]);
  while ((this.sending || this.queue.length) && Date.now() < deadline && !this.cancelled) { void this.pump(); await delay(20); }
  if (this.queue.length || this.heldAudio.length || this.sending) this.callbacks.onStatus('error', 'The connection did not finish sending the last audio. Your local recording is retained.');
  if (this.direct && !this.cancelled) {
   await Promise.race([this.direct.finish(),delay(Math.max(0,finishBy-Date.now()))]);this.cancel();return;
  }
  if (this.id && !this.cancelled) {
   try {
    const response = await this.request(this.url('end'), {method:'POST'}, 700);
    if (!response.ok) throw new Error('The finalization request failed.');
   }
   catch { this.callbacks.onStatus('error', 'Live transcription could not finalize the last audio. Your local recording is retained.'); }
   await Promise.race([this.readerTask || Promise.resolve(), delay(Math.max(0, finishBy - Date.now()))]);
  }
  this.cancel();
 }
 cancel() {
  if (this.cancelled) return;
  this.cancelled = true;
  if (this.readyTimer) clearTimeout(this.readyTimer);
  this.resolveReady?.();
  this.abort.abort(); this.queue = []; this.heldAudio = []; this.queuedBytes = 0;
  this.direct?.cancel();
  void this.activeReader?.cancel().catch(() => {});
  this.node?.disconnect(); this.source?.disconnect(); this.silent?.disconnect();
  if (this.node) this.node.port.onmessage = null;
  void this.context?.close().catch(() => {});
  this.callbacks.onLevel(0, false);
  if (this.id && !this.serverClosed) void fetch(this.url('cancel'), {method:'POST', keepalive:true}).catch(() => {});
 }
 private capture(samples: Float32Array) {
  if (this.cancelled || this.stopping || this.paused || this.suppressed || !(samples instanceof Float32Array)) return;
  let energy = 0;
  const bytes = new Uint8Array(samples.length * 2); const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples.length; index++) {
   const value = Math.max(-1, Math.min(1, samples[index])); energy += value * value;
   view.setInt16(index * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  const rms = Math.sqrt(energy / Math.max(1, samples.length));
  this.callbacks.onLevel(Math.min(1, rms * 5), rms > .012);
  (this.pendingControls || this.serverPaused ? this.heldAudio : this.queue).push(bytes); this.queuedBytes += bytes.length;
  let dropped = false;
  while (this.queuedBytes > 96000) { this.queuedBytes -= (this.queue.shift() || this.heldAudio.shift())!.length; dropped = true; }
  if (dropped) this.callbacks.onStatus('reconnecting', 'The connection is slow. Some recent audio could not be streamed; your local recording is retained.');
  void this.pump();
 }
 private async pump() {
  if (this.sending || this.serverPaused || !this.ready || (!this.id && !this.direct) || this.cancelled || this.ended) return;
  this.sending = true;
  try {
   while (this.queue.length && !this.serverPaused && !this.cancelled && !this.ended) {
    if (this.direct) {
     const bytes=this.queue[0];
     if(!this.direct.send(bytes))break;
     this.queue.shift();this.queuedBytes-=bytes.length;continue;
    }
    // Batch pending frames up to 400ms only when network backpressure builds.
    const parts: Uint8Array[] = []; let size = 0;
    while (this.queue.length && size + this.queue[0].length <= 12800) {
     const part = this.queue.shift()!; parts.push(part); size += part.length; this.queuedBytes -= part.length;
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.length; }
    let delivered = false;
    for (let retry = 0; retry < 3 && !this.cancelled; retry++) {
     try {
      const response = await this.request(`${this.url()}&frame=${this.frame}`, {method:'POST', headers:{'Content-Type':'application/octet-stream'}, body:bytes}, 5000);
      if (!response.ok) throw new Error(await this.errorMessage(response, 'Live audio could not be sent.'));
      if (retry > 0) this.callbacks.onStatus('listening');
      delivered = true; break;
     } catch (cause) {
      if (this.cancelled) return;
      if (retry === 2) throw cause;
      this.callbacks.onStatus('reconnecting', 'Reconnecting live audio. Your existing transcript is retained.');
      await delay(250 * (retry + 1));
     }
    }
    if (delivered) this.frame++;
   }
  } catch (cause) {
   if (!this.cancelled) {
    this.callbacks.onStatus('error', cause instanceof Error ? cause.message : 'Live audio connection was lost. Stop and retry.');
    this.ended = true; this.ready = false;
   }
  } finally { this.sending = false; }
 }
 private async readEvents() {
  let attempts = 0;
  while (!this.cancelled && !this.ended) {
   try {
    const response = await this.request(`${this.url()}&after=${this.after}`, {method:'GET', headers:{Accept:'text/event-stream'}}, undefined);
    if (!response.ok || !response.body) throw new Error(await this.errorMessage(response, 'Live transcript connection was lost.'));
    if (attempts > 0 && this.ready) this.callbacks.onStatus('listening');
    const reader = response.body.getReader(), decoder = new TextDecoder(); let pending = '';
    this.activeReader = reader;
    try { while (!this.cancelled && !this.ended) {
     const chunk = await reader.read(); if (chunk.done) break;
     pending += decoder.decode(chunk.value, {stream:true});
     let boundary: number;
     while ((boundary = pending.indexOf('\n\n')) >= 0) {
      const block = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
      const line = block.split('\n').find(value => value.startsWith('data: '));
      if (line) { this.handle(JSON.parse(line.slice(6)) as WireEvent); attempts = 0; }
     }
     if (pending.length > 262144) throw new Error('Live transcript response exceeded its limit.');
    } } finally {
     await reader.cancel().catch(() => {});
     reader.releaseLock();
     if (this.activeReader === reader) this.activeReader = undefined;
    }
    if (!this.ended && !this.cancelled) throw new Error('Live transcript stream disconnected.');
   } catch (cause) {
    if (this.cancelled || this.ended) return;
    if (++attempts > 5) {
     const error = new Error(cause instanceof Error ? cause.message : 'Live transcript could not reconnect. Stop and retry.');
     this.callbacks.onStatus('error', error.message); this.rejectReady?.(error); this.ended = true; return;
    }
    this.callbacks.onStatus('reconnecting', 'Reconnecting the transcript. Existing text is retained.');
    await delay(Math.min(3000, 300 * 2 ** (attempts - 1)));
   }
  }
 }
 private handle(event: WireEvent) {
  if (!Number.isSafeInteger(event.sequence) || event.sequence <= this.after) return;
  this.after = event.sequence;
  if (event.type === 'ready') {
   this.ready = true; if (this.readyTimer) clearTimeout(this.readyTimer);
   this.resolveReady?.(); this.callbacks.onStatus('listening'); void this.pump();
  } else if (event.type === 'partial' && event.text) this.callbacks.onPartial(event.text, this.startedAt + (event.at || 0) * 1000);
  else if (event.type === 'final' && event.text && event.id) this.callbacks.onFinal(event.text, this.startedAt + (event.at || 0) * 1000, event.id);
  else if (event.type === 'status' && event.status) {
   this.callbacks.onStatus(event.status, event.notice);
   if (event.status === 'error') this.rejectReady?.(new Error(event.notice || 'Live transcription failed.'));
  } else if (event.type === 'done') {
   this.ended = true; this.serverClosed = true;
   if (event.notice) this.callbacks.onStatus('error', event.notice);
  }
 }
 private async controlAfterAudio(action: string) {
  const deadline = Date.now() + 2000;
  while ((this.sending || this.queue.length) && Date.now() < deadline && !this.cancelled) { void this.pump(); await delay(15); }
  if(this.direct&&!this.cancelled){
   this.direct.setPaused(action==='pause');this.serverPaused=action==='pause';
   if(!this.serverPaused){this.queue.push(...this.heldAudio);this.heldAudio=[];void this.pump();}
   return;
  }
  if (this.id && !this.cancelled) {
   try {
    const response = await this.request(this.url(action), {method:'POST'}, 3000);
    if (!response.ok) throw new Error(await this.errorMessage(response, 'The audio control could not be sent.'));
    this.serverPaused = action === 'pause';
    if (!this.serverPaused) { this.queue.push(...this.heldAudio); this.heldAudio = []; void this.pump(); }
   } catch (cause) {
    if (!this.cancelled) this.callbacks.onStatus('error', cause instanceof Error ? cause.message : 'The audio control could not be sent. Stop and retry.');
   }
  }
 }
 private enqueueControl(action: string) {
  this.pendingControls++;
  this.controls = this.controls.then(() => this.controlAfterAudio(action)).finally(() => { this.pendingControls--; });
 }
 private url(action?: string) { return `/api/live/stream?id=${encodeURIComponent(this.id)}${action ? `&action=${action}` : ''}`; }
 private request(url: string, options: RequestInit, timeout?: number) {
  return fetch(url, {...options, signal:timeout ? AbortSignal.any([this.abort.signal, AbortSignal.timeout(timeout)]) : this.abort.signal});
 }
 private async errorMessage(response: Response, fallback: string) {
  try { const body = await response.json(); return typeof body.error === 'string' ? body.error : fallback; } catch { return fallback; }
 }
}

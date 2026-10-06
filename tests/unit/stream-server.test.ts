import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/ai/config', () => ({ geminiKeys: () => ['private-server-key'] }));
import { LiveTranscriptionSession } from '@/lib/live/transcription-server';

class FakeSocket extends EventTarget {
 readyState: number = WebSocket.CONNECTING;
 bufferedAmount = 0;
 sent: Record<string, unknown>[] = [];
 send = vi.fn((text: string) => { this.sent.push(JSON.parse(text)); });
 close = vi.fn(() => {
  this.readyState = WebSocket.CLOSED;
  this.dispatchEvent(Object.assign(new Event('close'), { code: 1000 }));
 });
 open() { this.readyState = WebSocket.OPEN; this.dispatchEvent(new Event('open')); }
 message(value: unknown) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })); }
 disconnect(code = 1006) {
  this.readyState = WebSocket.CLOSED;
  this.dispatchEvent(Object.assign(new Event('close'), { code }));
 }
}
let session: LiveTranscriptionSession;
let sockets: FakeSocket[];
let removed: () => void;
beforeEach(() => {
 vi.useFakeTimers(); sockets = []; removed = vi.fn();
 session = new LiveTranscriptionSession('owner', removed, () => {
  const socket = new FakeSocket(); sockets.push(socket); return socket as unknown as WebSocket;
 });
});
afterEach(() => { session.close(); vi.useRealTimers(); });
function connect() { session.connect(); sockets[0].open(); sockets[0].message({ setupComplete: {} }); return sockets[0]; }

describe('server-owned Gemini streaming transcription', () => {
 it('requests the dedicated live model and streams PCM only after setup completion', () => {
  session.connect(); session.append(Buffer.from([1, 0, 2, 0]), 0);
  const socket = sockets[0]; expect(socket.send).not.toHaveBeenCalled(); socket.open();
  expect(socket.sent[0]).toMatchObject({ setup: { model: 'models/gemini-3.5-transcribe-live', generationConfig: { responseModalities: ['TEXT'] }, inputAudioTranscription: { languageCodes: [] } } });
  expect(socket.sent).toHaveLength(1); socket.message({ setupComplete: {} });
  expect(socket.sent[1]).toEqual({ realtimeInput: { audio: { data: 'AQACAA==', mimeType: 'audio/pcm;rate=16000' } } });
  expect(JSON.stringify(session.events)).not.toContain('private-server-key');
 });
 it('replaces progressive interim text and commits only authoritative finals with unique IDs', () => {
  const socket = connect(); session.append(Buffer.alloc(3200), 0);
  for (const text of ['Today', 'Today we need', 'Today we need to finish']) socket.message({ serverContent: { interimInputTranscription: { text } } });
  socket.message({ serverContent: { interimInputTranscription: { text: '' }, turnComplete: true } });
  expect(session.events.filter(event => event.type === 'partial').map(event => event.text)).toEqual(['Today', 'Today we need', 'Today we need to finish']);
  expect(session.events.filter(event => event.type === 'final')).toHaveLength(0);
  socket.message({ serverContent: { inputTranscription: { text: 'Today we need to finish.' } } });
  // A participant may legitimately repeat exactly the same words.
  socket.message({ serverContent: { inputTranscription: { text: 'Today we need to finish.' } } });
  const finals = session.events.filter(event => event.type === 'final');
  expect(finals).toHaveLength(2); expect(finals[0].id).not.toBe(finals[1].id); expect(finals[0].at).toBeGreaterThanOrEqual(0);
 });
 it('deduplicates acknowledged frame retries and rejects frame reordering', () => {
  const socket = connect(); const bytes = Buffer.alloc(3200);
  session.append(bytes, 0); session.append(bytes, 0);
  expect(socket.sent.filter(item => item.realtimeInput)).toHaveLength(1);
  expect(() => session.append(bytes, 2)).toThrow('out of order');
  session.append(bytes, 1); expect(socket.sent.filter(item => item.realtimeInput)).toHaveLength(2);
 });
 it('drains ordered audio and the pause boundary once socket backpressure clears', async () => {
  const socket = connect(); socket.bufferedAmount = 100000;
  session.append(Buffer.from([1, 0]), 0); session.append(Buffer.from([2, 0]), 1); session.setPaused(true);
  expect(socket.sent).toHaveLength(1); socket.bufferedAmount = 0;
  await vi.advanceTimersByTimeAsync(100);
  expect(socket.sent.slice(1)).toEqual([
   { realtimeInput: { audio: { data: 'AQA=', mimeType: 'audio/pcm;rate=16000' } } },
   { realtimeInput: { audio: { data: 'AgA=', mimeType: 'audio/pcm;rate=16000' } } },
   { realtimeInput: { audioStreamEnd: true } },
  ]);
  session.append(Buffer.from([3, 0]), 2); expect(socket.sent).toHaveLength(4);
  session.setPaused(false); session.append(Buffer.from([4, 0]), 3); expect(socket.sent).toHaveLength(5);
 });
 it('replays only SSE events after the last acknowledged sequence', () => {
  const socket = connect(); socket.message({ serverContent: { interimInputTranscription: { text: 'Today' } } });
  const after = session.events.at(-1)!.sequence;
  socket.message({ serverContent: { inputTranscription: { text: 'Today.' } } });
  const listener = vi.fn(); const unsubscribe = session.subscribe(listener, after);
  expect(listener).toHaveBeenCalledTimes(1); expect(listener.mock.calls[0][0].type).toBe('final');
  unsubscribe(); socket.message({ serverContent: { interimInputTranscription: { text: 'Tomorrow' } } });
  expect(listener).toHaveBeenCalledTimes(1);
 });
 it('reconnects with retained transcript and drains audio captured during disconnect', async () => {
  const socket = connect(); socket.message({ serverContent: { inputTranscription: { text: 'Committed.' } } });
  socket.disconnect(); session.append(Buffer.from([5, 0]), 0); await vi.advanceTimersByTimeAsync(350);
  expect(sockets).toHaveLength(2); sockets[1].open(); sockets[1].message({ setupComplete: {} });
  expect(sockets[1].sent[1]).toEqual({ realtimeInput: { audio: { data: 'BQA=', mimeType: 'audio/pcm;rate=16000' } } });
  expect(session.events.some(event => event.text === 'Committed.')).toBe(true);
  expect(session.events.some(event => event.status === 'reconnecting')).toBe(true);
 });
 it('retains a frame when send throws and retries it on the replacement connection', async () => {
  const socket = connect(); socket.send.mockImplementationOnce(() => { throw new Error('socket closed'); });
  session.append(Buffer.from([6, 0]), 0); await vi.advanceTimersByTimeAsync(350);
  sockets[1].open(); sockets[1].message({ setupComplete: {} });
  expect(sockets[1].sent[1]).toMatchObject({ realtimeInput: { audio: { data: 'BgA=' } } });
 });
 it('waits briefly for a final after stop and cleans all timers and sockets', async () => {
  const socket = connect(); socket.message({ serverContent: { interimInputTranscription: { text: 'Unfinished' } } });
  session.end(); expect(socket.sent.at(-1)).toEqual({ realtimeInput: { audioStreamEnd: true } });
  socket.message({ serverContent: { inputTranscription: { text: 'Finished.' } } });
  await vi.advanceTimersByTimeAsync(1800);
  expect(session.events.at(-1)).toMatchObject({ type: 'done' }); expect(session.events.at(-1)?.notice).toBeUndefined();
  expect(removed).toHaveBeenCalledTimes(1); expect(socket.close).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
 });
 it('keeps paused sessions alive with heartbeats and expires abandoned ones', async () => {
  connect(); session.setPaused(true);
  for (let i = 0; i < 8; i++) { await vi.advanceTimersByTimeAsync(10000); session.touch(); }
  expect(removed).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(75000); expect(removed).toHaveBeenCalledOnce();
 });
 it('preserves elapsed timestamp offsets across a long pause', async () => {
  const socket = connect(); session.append(Buffer.alloc(3200), 0); session.setPaused(true);
  await vi.advanceTimersByTimeAsync(30000); session.setPaused(false); session.append(Buffer.alloc(3200), 1);
  socket.message({ serverContent: { interimInputTranscription: { text: 'After the pause' } } });
  expect(session.events.at(-1)?.at).toBeCloseTo(29.9);
 });
 it('reports model access failure without leaking authenticated socket errors', () => {
  connect().disconnect(1008);
  expect(session.events.find(event => event.status === 'error')?.notice).toContain('API key or model');
  expect(JSON.stringify(session.events)).not.toContain('private-server-key'); expect(removed).toHaveBeenCalledOnce();
 });
});

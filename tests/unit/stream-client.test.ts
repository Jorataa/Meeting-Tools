import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StreamingTranscription } from '@/lib/live/transcription-client';

class FakeWorklet {
 static current: FakeWorklet;
 port = { onmessage: null as ((event: { data: Float32Array }) => void) | null, postMessage: vi.fn() };
 connect = vi.fn(); disconnect = vi.fn();
 constructor() { FakeWorklet.current = this; }
 capture() { this.port.onmessage?.({ data: new Float32Array(1600).fill(.1) }); }
}
class FakeContext {
 static current: FakeContext;
 destination = {};
 audioWorklet = { addModule: vi.fn(async () => {}) };
 resume = vi.fn(async () => {}); close = vi.fn(async () => {});
 createMediaStreamSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }));
 createGain = vi.fn(() => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }));
 constructor() { FakeContext.current = this; }
}
const callbacks = () => ({ onPartial: vi.fn(), onFinal: vi.fn(), onStatus: vi.fn(), onLevel: vi.fn() });
let client: StreamingTranscription;
let fetcher: ReturnType<typeof vi.fn<(url: string, options: RequestInit) => Promise<Response>>>;
let eventStream: ReadableStreamDefaultController<Uint8Array>;
let streamCancel: ReturnType<typeof vi.fn<() => void>>;
const send = (value: Record<string, unknown>) => eventStream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(value)}\n\n`));
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
beforeEach(() => {
 vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-06T10:00:00Z'));
 vi.stubGlobal('AudioContext', FakeContext); vi.stubGlobal('AudioWorkletNode', FakeWorklet);
 streamCancel = vi.fn(); fetcher = vi.fn(async (url: string, options: RequestInit) => {
  if (options.method === 'GET') return new Response(new ReadableStream<Uint8Array>({ start(controller) { eventStream = controller; }, cancel: streamCancel }), { headers: { 'Content-Type': 'text/event-stream' } });
  if (url === '/api/live/stream') return Response.json({ id: 'opaque-live-session' });
  return Response.json({ ok: true });
 });
 vi.stubGlobal('fetch', fetcher);
});
afterEach(async () => { client?.cancel(); await settle(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function start() {
 const handler = callbacks(); client = new StreamingTranscription(handler);
 const starting = client.start({} as MediaStream); await settle(); send({ type: 'ready', sequence: 1 }); await starting;
 return handler;
}
describe('microphone streaming client', () => {
 it('renders progressive transcript immediately, uses absolute timestamps, and deduplicates SSE replay by sequence', async () => {
  const handlers = await start();
  send({ type: 'partial', sequence: 2, text: 'Today', at: 1 });
  send({ type: 'partial', sequence: 3, text: 'Today we need', at: 1 });
  send({ type: 'final', sequence: 4, text: 'Today we need.', at: 1, id: 'utterance-1' });
  send({ type: 'final', sequence: 4, text: 'Today we need.', at: 1, id: 'utterance-1' });
  send({ type: 'final', sequence: 5, text: 'Today we need.', at: 2, id: 'utterance-2' });
  await settle();
  expect(handlers.onPartial.mock.calls).toEqual([['Today', Date.now() + 1000], ['Today we need', Date.now() + 1000]]);
  expect(handlers.onFinal).toHaveBeenCalledTimes(2);
  expect(handlers.onFinal.mock.calls[1]).toEqual(['Today we need.', Date.now() + 2000, 'utterance-2']);
 });
 it('streams actual captured PCM and gates resumed speech until server acknowledges resume', async () => {
  const handlers = await start(); FakeWorklet.current.capture(); await settle();
  const first = fetcher.mock.calls.find(([url]) => String(url).includes('&frame=0'))!;
  expect((first[1] as RequestInit).headers).toEqual({ 'Content-Type': 'application/octet-stream' });
  expect(((first[1] as RequestInit).body as Uint8Array).length).toBe(3200);
  expect(handlers.onLevel.mock.calls[0][0]).toBeCloseTo(.5); expect(handlers.onLevel.mock.calls[0][1]).toBe(true);
  client.setPaused(true); await settle(); FakeWorklet.current.capture(); await settle();
  expect(fetcher.mock.calls.filter(([url]) => String(url).includes('&frame='))).toHaveLength(1);
  let acknowledgeResume: ((response: Response) => void) | undefined;
  const previous = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((url: string, options: RequestInit) => String(url).endsWith('action=resume')
   ? new Promise<Response>(resolve => { acknowledgeResume = resolve; }) : previous(url, options));
  client.setPaused(false); await settle(); FakeWorklet.current.capture(); await settle();
  expect(fetcher.mock.calls.filter(([url]) => String(url).includes('&frame='))).toHaveLength(1);
  acknowledgeResume!(Response.json({ ok: true })); await settle();
  expect(fetcher.mock.calls.filter(([url]) => String(url).includes('&frame='))).toHaveLength(2);
 });
 it('retries a failed PCM POST with the same frame number and recovers listening status', async () => {
  const handlers = await start(); const previous = fetcher.getMockImplementation()!; let failed = false;
  fetcher.mockImplementation((url: string, options: RequestInit) => {
   if (String(url).includes('&frame=0') && !failed) { failed = true; return Promise.reject(new Error('temporarily offline')); }
   return previous(url, options);
  });
  FakeWorklet.current.capture(); await settle(); await vi.advanceTimersByTimeAsync(250); await settle();
  expect(fetcher.mock.calls.filter(([url]) => String(url).includes('&frame=0'))).toHaveLength(2);
  expect(handlers.onStatus).toHaveBeenCalledWith('reconnecting', expect.any(String)); expect(handlers.onStatus.mock.calls.at(-1)).toEqual(['listening']);
 });
 it('reconnects SSE from the last received sequence and preserves final text', async () => {
  const handlers = await start(); send({ type: 'final', sequence: 2, text: 'Saved.', at: 1, id: 'saved' }); await settle();
  eventStream.close(); await settle(); await vi.advanceTimersByTimeAsync(300); await settle();
  expect(fetcher.mock.calls.filter(([, options]) => options.method === 'GET').at(-1)?.[0]).toContain('&after=2');
  send({ type: 'final', sequence: 2, text: 'Saved.', at: 1, id: 'saved' });
  send({ type: 'partial', sequence: 3, text: 'New words', at: 2 }); await settle();
  expect(handlers.onFinal).toHaveBeenCalledOnce(); expect(handlers.onPartial).toHaveBeenCalledWith('New words', Date.now() - 300 + 2000);
 });
 it('flushes audio on stop and accepts the final transcript before disconnecting', async () => {
  const handlers = await start(); FakeWorklet.current.capture(); await settle();
  const previous = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((url: string, options: RequestInit) => {
   if (url.endsWith('action=end')) {
    send({ type: 'final', sequence: 2, text: 'Last spoken words.', at: 1, id: 'last' }); send({ type: 'done', sequence: 3 });
   }
   return previous(url, options);
  });
  const stopping = client.stop(); await vi.advanceTimersByTimeAsync(35); await stopping;
  expect(FakeWorklet.current.port.postMessage).toHaveBeenCalledWith('flush');
  expect(handlers.onFinal).toHaveBeenCalledWith('Last spoken words.', Date.now() - 35 + 1000, 'last');
  expect(FakeContext.current.close).toHaveBeenCalledOnce(); expect(fetcher.mock.calls.some(([url]) => url.endsWith('action=cancel'))).toBe(false);
 });
 it('cancels and releases the SSE reader, audio graph, and private server session', async () => {
  await start(); client.cancel(); await settle();
  expect(FakeContext.current.close).toHaveBeenCalledOnce(); expect(FakeWorklet.current.disconnect).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('action=cancel'))).toBe(true);
  expect(streamCancel).toHaveBeenCalledOnce();
 });
});

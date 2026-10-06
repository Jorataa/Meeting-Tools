import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({
 sessionId: vi.fn(async ():Promise<string|null> => 'owner'), sameOrigin: vi.fn(() => true), rateLimit: vi.fn(() => true),
 create: vi.fn(), get: vi.fn(), append: vi.fn(), end: vi.fn(), close: vi.fn(), pause: vi.fn(), touch: vi.fn(), subscribe: vi.fn(),
 quota:vi.fn(),ephemeral:vi.fn(),token:vi.fn(),
}));
vi.mock('@/lib/server-session', () => ({ sessionId: mocks.sessionId, sameOrigin: mocks.sameOrigin, rateLimit: mocks.rateLimit }));
vi.mock('@/lib/live/transcription-server', () => ({ createLiveSession: mocks.create, getLiveSession: mocks.get }));
vi.mock('@/lib/security/ai-quota',()=>({enforceAiQuota:mocks.quota}));
vi.mock('@/lib/live/transcription-token',()=>({ephemeralLiveTransport:mocks.ephemeral,createTranscriptionToken:mocks.token}));
import { GET, POST } from '@/app/api/live/stream/route';
const session = { id: 'live-id', append: mocks.append, end: mocks.end, close: mocks.close, setPaused: mocks.pause, touch: mocks.touch, subscribe: mocks.subscribe };
function request(query = '', body?: Uint8Array, patch: Record<string, string> = {}) {
 return new Request(`http://localhost:3000/api/live/stream${query}`, {
  method: 'POST', body: body?.slice().buffer as ArrayBuffer | undefined, headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/octet-stream', ...patch },
 });
}
beforeEach(() => {
 vi.resetAllMocks(); mocks.sessionId.mockResolvedValue('owner'); mocks.sameOrigin.mockReturnValue(true); mocks.rateLimit.mockReturnValue(true);
 mocks.create.mockReturnValue(session); mocks.get.mockReturnValue(session); mocks.subscribe.mockReturnValue(vi.fn());
 mocks.quota.mockResolvedValue(null);mocks.ephemeral.mockReturnValue(false);mocks.token.mockResolvedValue({transport:'ephemeral',token:'scoped-fixture'});
});
afterEach(() => vi.useRealTimers());
describe('secured live stream routes', () => {
 it('creates only a server-owned opaque session', async () => {
  const response = await POST(request()); expect(await response.json()).toEqual({ id: 'live-id' });
  expect(mocks.create).toHaveBeenCalledWith('owner');
 });
 it('mints constrained credentials only after authentication and durable quota checks',async()=>{
  mocks.ephemeral.mockReturnValue(true);
  const response=await POST(request());expect(await response.json()).toEqual({transport:'ephemeral',token:'scoped-fixture'});
  expect(mocks.quota).toHaveBeenCalledWith('live-create');expect(mocks.token).toHaveBeenCalledOnce();expect(mocks.create).not.toHaveBeenCalled();
  mocks.sessionId.mockResolvedValue(null);expect((await POST(request())).status).toBe(401);expect(mocks.token).toHaveBeenCalledOnce();
 });
 it('fails closed on quota rejection without charging normal PCM or recording controls',async()=>{
  mocks.quota.mockResolvedValue(Response.json({error:'Wait'},{status:429}));expect((await POST(request())).status).toBe(429);expect(mocks.create).not.toHaveBeenCalled();expect(mocks.token).not.toHaveBeenCalled();
  expect((await POST(request('?id=live-id&frame=0',new Uint8Array([1,0])))).status).toBe(200);
  expect((await POST(request('?id=live-id&action=pause'))).status).toBe(200);expect(mocks.quota).toHaveBeenCalledOnce();
 });
 it('rejects unauthenticated mutations and cross-origin reads', async () => {
  mocks.sameOrigin.mockReturnValue(false); expect((await POST(request())).status).toBe(401);
  expect((await GET(new Request('http://localhost:3000/api/live/stream?id=live-id', { headers: { Origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } }))).status).toBe(401);
  expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.get).not.toHaveBeenCalled();
 });
 it('enforces session ownership and reports expiration without accepting PCM', async () => {
  mocks.get.mockReturnValue(undefined);
  expect((await POST(request('?id=other&frame=0', new Uint8Array([1, 0])))).status).toBe(410);
  expect(mocks.get).toHaveBeenCalledWith('other', 'owner'); expect(mocks.append).not.toHaveBeenCalled();
 });
 it('accepts PCM with ordered sequence and executes recording controls', async () => {
  expect((await POST(request('?id=live-id&frame=0', new Uint8Array([1, 0, 2, 0])))).status).toBe(200);
  expect(mocks.append).toHaveBeenCalledWith(Buffer.from([1, 0, 2, 0]), 0);
  for (const action of ['pause', 'resume', 'end', 'cancel']) expect((await POST(request(`?id=live-id&action=${action}`))).status).toBe(200);
  expect(mocks.pause.mock.calls).toEqual([[true], [false]]); expect(mocks.end).toHaveBeenCalledOnce(); expect(mocks.close).toHaveBeenCalledOnce();
 });
 it.each([
  ['?id=live-id', new Uint8Array([1, 0]), {}, 400],
  ['?id=live-id&frame=-1', new Uint8Array([1, 0]), {}, 400],
  ['?id=live-id&frame=0', new Uint8Array([1]), {}, 400],
  ['?id=live-id&frame=0', new Uint8Array(12802), {}, 413],
  ['?id=live-id&frame=0', new Uint8Array([1, 0]), { 'content-length': '12802' }, 413],
  ['?id=live-id&frame=0', new Uint8Array([1, 0]), { 'content-type': 'audio/webm' }, 415],
 ] as const)('rejects invalid or oversized audio %s', async (query, body, headers, status) => {
  expect((await POST(request(query, body, headers))).status).toBe(status); expect(mocks.append).not.toHaveBeenCalled();
 });
 it('bounds reading time for an audio body that never completes', async () => {
  vi.useFakeTimers(); const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({ cancel });
  const req = new Request('http://localhost:3000/api/live/stream?id=live-id&frame=0', {
   method: 'POST', body, duplex: 'half', headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/octet-stream' },
  } as RequestInit);
  const response = POST(req); await vi.advanceTimersByTimeAsync(5000);
  expect((await response).status).toBe(409); expect(cancel).toHaveBeenCalledOnce(); expect(body.locked).toBe(false);
 });
 it('sanitizes factory and append exceptions that contain the private upstream URL', async () => {
  mocks.create.mockImplementation(() => { throw new Error('wss://upstream?key=very-private-secret'); });
  const created = await POST(request()); expect(created.status).toBe(503); expect(await created.text()).not.toContain('very-private-secret');
  mocks.append.mockImplementation(() => { throw new Error('key=very-private-secret'); });
  const audio = await POST(request('?id=live-id&frame=0', new Uint8Array([1, 0])));
  expect(audio.status).toBe(409); expect(await audio.text()).not.toContain('very-private-secret');
 });
 it('replays event sequences through SSE and keeps paused sessions alive until cancellation', async () => {
  vi.useFakeTimers(); const unsubscribe = vi.fn();
  mocks.subscribe.mockImplementation(listener => { listener({ type: 'partial', sequence: 8, text: 'Today we need', at: 2 }); return unsubscribe; });
  const response = await GET(new Request('http://localhost:3000/api/live/stream?id=live-id&after=7'));
  expect(response.headers.get('content-type')).toBe('text/event-stream'); expect(mocks.subscribe.mock.calls[0][1]).toBe(7);
  const reader = response.body!.getReader(); const first = await reader.read(); expect(new TextDecoder().decode(first.value)).toContain('Today we need');
  await vi.advanceTimersByTimeAsync(10000); expect(mocks.touch).toHaveBeenCalledOnce();
  await reader.cancel(); expect(unsubscribe).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
 });
});

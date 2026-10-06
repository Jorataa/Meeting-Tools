import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-session', () => ({ sessionId: vi.fn(async () => 'test'), sameOrigin: vi.fn(() => true), rateLimit: vi.fn(() => true) }));
import { POST as interrupt } from '@/app/api/interruption/route';
import { POST as transcribe } from '@/app/api/live/transcribe/route';
import { POST as voice } from '@/app/api/voice/route';
import { sameOrigin, sessionId, rateLimit } from '@/lib/server-session';
import { wav } from '@/lib/audio/wav';
const fetcher = vi.fn();
const result = { shouldInterrupt: true, confidence: .92, category: 'deadline', question: 'What exact date is the launch deadline?', reason: 'Ambiguous deadline.', gapKey: 'deadline:launch', notes: 'Launch date unresolved.' };
const input = { transcript: 'We must launch next month.', notes: '', asked: [] };
const request = (body: unknown) => new Request('http://localhost:3000/api/test', { method: 'POST', body: JSON.stringify(body), headers: { Origin: 'http://localhost:3000', 'Content-Type': 'application/json' } });
const provider = (value: unknown) => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] });
beforeEach(() => {
  vi.stubGlobal('fetch', fetcher); fetcher.mockReset();
  for (const name of ['GEMINI_API_KEY', 'GEMINI_API_KEYS', ...Array.from({ length: 5 }, (_, i) => `GEMINI_API_KEY_${i + 1}`)]) vi.stubEnv(name, '');
  vi.stubEnv('GEMINI_API_KEY_1', 'server-private-key'); vi.stubEnv('GEMINI_MODEL', 'gemini-2.5-flash'); vi.stubEnv('GEMINI_TTS_MODEL', '');
  vi.mocked(sameOrigin).mockReturnValue(true); vi.mocked(sessionId).mockResolvedValue('test'); vi.mocked(rateLimit).mockReturnValue(true);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('secure structured clarification', () => {
  it('supports current models without passing a legacy thinking budget to the fallback', async () => {
    fetcher.mockResolvedValueOnce(new Response('', { status: 429 }));
    fetcher.mockResolvedValueOnce(new Response('', { status: 429 }));
    fetcher.mockResolvedValueOnce(provider(result));
    expect((await interrupt(request(input))).status).toBe(200);
    expect(fetcher.mock.calls[2][0]).toContain('gemini-3.5-flash-lite');
    expect(JSON.parse(fetcher.mock.calls[0][1].body).generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(JSON.parse(fetcher.mock.calls[2][1].body).generationConfig.thinkingConfig).toBeUndefined();
    expect(JSON.parse(fetcher.mock.calls[2][1].body).generationConfig.responseJsonSchema).toBeDefined();
  });
  it('sends context and history to Gemini with a structured schema and private header', async () => {
    fetcher.mockResolvedValueOnce(provider(result)); const response = await interrupt(request(input));
    expect(await response.json()).toEqual(result);
    const [url, options] = fetcher.mock.calls[0]; expect(url).not.toContain('server-private-key');
    expect(options.headers['x-goog-api-key']).toBe('server-private-key');
    expect(JSON.parse(options.body).generationConfig.responseJsonSchema.properties.confidence).toBeDefined();
    expect(JSON.parse(options.body).systemInstruction.parts[0].text).toContain('Never interrupt for grammar');
  });
  it.each([{ confidence: .81 }, { relevance: .79 }, { category: 'none' }, { question: '' }])('suppresses unsafe model output %j', async patch => {
    fetcher.mockResolvedValueOnce(provider({ ...result, ...patch }));
    expect((await (await interrupt(request(input))).json()).shouldInterrupt).toBe(false);
  });
  it('preserves validated structured meeting context without deriving facts from question premises', async () => {
    const context = { summary: 'Launch is planned for next month.', topics: ['Launch'], decisions: [], actionItems: ['Confirm launch date.'], unresolvedQuestions: ['Which date next month?'] };
    fetcher.mockResolvedValueOnce(provider({ ...result, relevance: .91, context }));
    expect((await (await interrupt(request(input))).json()).context).toEqual(context);
    fetcher.mockResolvedValueOnce(provider({ ...result, context: { ...context, topics: [12] } }));
    expect((await interrupt(request(input))).status).toBe(422);
  });
  it('suppresses final questions and paraphrases already asked', async () => {
    fetcher.mockResolvedValueOnce(provider(result));
    expect((await (await interrupt(request({ ...input, final: true }))).json()).shouldInterrupt).toBe(false);
    fetcher.mockResolvedValueOnce(provider(result));
    expect((await (await interrupt(request({ ...input, asked: [{ ...result, question: 'Tanggal berapa deadline?' }] }))).json()).shouldInterrupt).toBe(false);
  });
  it('fails safely for malformed model output, missing keys and upstream errors', async () => {
    fetcher.mockResolvedValueOnce(provider({ ...result, confidence: 'yes' })); expect((await interrupt(request(input))).status).toBe(422);
    vi.stubEnv('GEMINI_API_KEY_1', ''); expect((await interrupt(request(input))).status).toBe(503);
    vi.stubEnv('GEMINI_API_KEY_1', 'server-private-key'); fetcher.mockImplementation(async () => new Response('secret internal error server-private-key', { status: 429 }));
    const response = await interrupt(request(input)); expect(response.status).toBe(429); expect(await response.text()).not.toContain('server-private-key');
  });
  it('rejects invalid input, origins, expired sessions and rate limits', async () => {
    expect((await interrupt(request({ ...input, transcript: '' }))).status).toBe(422);
    vi.mocked(sameOrigin).mockReturnValueOnce(false); expect((await interrupt(request(input))).status).toBe(403);
    vi.mocked(sessionId).mockResolvedValueOnce(null); expect((await interrupt(request(input))).status).toBe(401);
    vi.mocked(rateLimit).mockReturnValueOnce(false); expect((await interrupt(request(input))).status).toBe(429);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
describe('actual live audio', () => {
  it('sends identical standalone PCM WAV bytes and accepts silence without an error', async () => {
    const bytes = Buffer.from(wav(new Int16Array(1600))); fetcher.mockResolvedValueOnce(provider({ transcript: '' }));
    const response = await transcribe(request({ audio: bytes.toString('base64') })); expect(response.status).toBe(200); expect(await response.json()).toEqual({ transcript: '' });
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(Buffer.from(body.contents[0].parts.find((part: { inlineData?: unknown }) => part.inlineData).inlineData.data, 'base64')).toEqual(bytes);
  });
  it('rejects non-WAV, incorrect sample rates, empty and oversized clips', async () => {
    for (const bytes of [Buffer.from('not actual audio'), Buffer.from(wav(new Int16Array(100), 24000)), Buffer.from(wav(new Int16Array())), Buffer.from(wav(new Int16Array(320001)))]) {
      expect((await transcribe(request({ audio: bytes.toString('base64') }))).status).toBe(400);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
});
describe.each([
  { name: 'live transcription', post: transcribe, limit: 910000, message: 'Audio clip is too large.' },
  { name: 'interruption analysis', post: interrupt, limit: 100000, message: 'Meeting context is too large.' },
])('$name request body limits', ({ post, limit, message }) => {
  it.each([undefined, '1'])('stops reading an oversized stream with Content-Length %s', async contentLength => {
    const chunk = new TextEncoder().encode(' '.repeat(64000));
    const cancel = vi.fn();
    const requiredReads = Math.floor(limit / chunk.length) + 1;
    let reads = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        reads++;
        if (reads <= requiredReads + 2) controller.enqueue(chunk);
        else controller.close();
      },
      cancel,
    }, { highWaterMark: 0 });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (contentLength !== undefined) headers['Content-Length'] = contentLength;
    const response = await post(new Request('http://localhost:3000/api/test', { method: 'POST', body, headers, duplex: 'half' } as RequestInit));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: message });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(cancel).toHaveBeenCalledOnce();
    expect(reads).toBe(requiredReads);
    expect(body.locked).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects an oversized declared byte length before reading the stream', async () => {
    const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => controller.close());
    const body = new ReadableStream<Uint8Array>({ pull }, { highWaterMark: 0 });
    const response = await post(new Request('http://localhost:3000/api/test', {
      method: 'POST', body, headers: { 'Content-Length': String(limit * 3 + 4) }, duplex: 'half',
    } as RequestInit));
    expect(response.status).toBe(413);
    expect(pull).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
describe('streamed meeting text', () => {
  it('preserves multibyte text across chunks and the existing character limit', async () => {
    const meeting = { ...input, transcript: '会'.repeat(50000) };
    const json = JSON.stringify(meeting);
    const bytes = new TextEncoder().encode(json.padEnd(100000, ' '));
    const split = new TextEncoder().encode('{"transcript":"').length + 1;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.subarray(0, split));
        controller.enqueue(bytes.subarray(split));
        controller.close();
      },
    });
    fetcher.mockResolvedValueOnce(provider(result));
    const response = await interrupt(new Request('http://localhost:3000/api/test', { method: 'POST', body, duplex: 'half' } as RequestInit));
    expect(response.status).toBe(200);
    const sent = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(JSON.parse(sent.contents[0].parts[0].text).transcript).toBe(meeting.transcript);
  });
});
describe('compatible TTS audio', () => {
  it('wraps legacy raw PCM in a browser-playable 24 kHz WAV after unavailable primary models', async () => {
    fetcher.mockResolvedValueOnce(new Response(null, { status: 404 })).mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from([1, 0, 2, 0]).toString('base64'), mimeType: 'audio/L16;codec=pcm;rate=24000' } }] } }] }));
    const response = await voice(request({ text: 'Tanggal berapa?' })); expect(response.status).toBe(200);
    const bytes = Buffer.from(await response.arrayBuffer()); expect(bytes.toString('ascii', 0, 4)).toBe('RIFF'); expect(bytes.readUInt32LE(24)).toBe(24000); expect(bytes.subarray(44)).toEqual(Buffer.from([1, 0, 2, 0]));
    expect(JSON.parse(fetcher.mock.calls[2][1].body).generationConfig.responseModalities).toEqual(['AUDIO']);
  });
});

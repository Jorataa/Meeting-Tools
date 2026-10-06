import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioMimeType, hasAudioHeader, MAX_AUDIO_BYTES, validateAudio } from '@/lib/audio/validation';
import { wav } from '@/lib/audio/wav';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-session', () => ({
  sessionId: vi.fn(async () => 'test-session'), sameOrigin: vi.fn(() => true), rateLimit: vi.fn(() => true),
}));
import { geminiKeys } from '@/lib/ai/config';
import { transcribeAudio, transcriptionInstruction } from '@/lib/ai/transcribe';
import { POST } from '@/app/api/transcribe/route';
import { rateLimit, sameOrigin, sessionId } from '@/lib/server-session';
const audio = new Uint8Array(wav(new Int16Array(1600).fill(300)));
const response = (transcript = 'Selamat pagi. The budget is 42 million rupiah.', finishReason = 'STOP') =>
  Response.json({ candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify({ transcript }) }] } }] });
const fetchMock = vi.fn<typeof fetch>();
function request(file: File, extra?: File) {
  const form = new FormData(); form.append('audio', file); if (extra) form.append('audio', extra);
  return new Request('http://localhost:3000/api/transcribe', { method: 'POST', headers: { Origin: 'http://localhost:3000' }, body: form });
}
const file = () => new File([audio], 'meeting.wav', { type: 'audio/wav' });
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  for (const name of ['GEMINI_API_KEY', 'GEMINI_API_KEYS', ...Array.from({length:5}, (_, i) => `GEMINI_API_KEY_${i + 1}`)]) vi.stubEnv(name, '');
  vi.stubEnv('GEMINI_API_KEY_1', 'private-test-key'); vi.stubEnv('GEMINI_MODEL', 'gemini-2.5-flash');
  vi.mocked(sessionId).mockResolvedValue('test-session'); vi.mocked(sameOrigin).mockReturnValue(true); vi.mocked(rateLimit).mockReturnValue(true);
  fetchMock.mockReset(); fetchMock.mockResolvedValue(response());
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('audio validation', () => {
  it.each([['mp3', 'audio/mpeg'], ['wav', 'audio/wav'], ['m4a', 'audio/m4a'], ['webm', 'audio/webm'], ['ogg', 'audio/ogg']])('accepts %s', (extension, type) => {
    expect(validateAudio({ name: `audio.${extension}`, type, size: 200 })).toBeNull();
  });
  it('accepts Safari MP4 and browser codec MIME types', () => {
    expect(audioMimeType({ name: 'audio.m4a', type: 'audio/mp4' })).toBe('audio/m4a');
    expect(audioMimeType({ name: 'audio.webm', type: 'audio/webm;codecs=opus' })).toBe('audio/webm');
  });
  it('handles missing MIME but refuses mismatches and misleading extensions', () => {
    expect(audioMimeType({ name: 'AUDIO.MP3', type: '' })).toBe('audio/mpeg');
    expect(audioMimeType({ name: 'audio.mp3', type: 'text/plain' })).toBeNull();
    expect(audioMimeType({ name: 'audio.exe', type: 'audio/mpeg' })).toBeNull();
  });
  it('rejects empty and oversized audio', () => {
    expect(validateAudio({ name: 'audio.wav', type: 'audio/wav', size: 0 })).toContain('empty');
    expect(validateAudio({ name: 'audio.wav', type: 'audio/wav', size: MAX_AUDIO_BYTES + 1 })).toContain('too large');
  });
  it('verifies real container signatures', () => {
    expect(hasAudioHeader(audio, 'audio/wav')).toBe(true);
    expect(hasAudioHeader(new TextEncoder().encode('this is not an audio file'), 'audio/wav')).toBe(false);
  });
});
describe('Gemini transcription', () => {
  it('prioritizes numbered keys and keeps legacy keys working without duplicates', () => {
    vi.stubEnv('GEMINI_API_KEY_2', 'secondary'); vi.stubEnv('GEMINI_API_KEY', 'legacy'); vi.stubEnv('GEMINI_API_KEYS', 'secondary, last');
    expect(geminiKeys()).toEqual(['private-test-key', 'secondary', 'legacy', 'last']);
  });
  it('sends actual audio bytes and language-preserving instructions, with the key only in server headers', async () => {
    expect(await transcribeAudio(audio, 'audio/wav')).toContain('Selamat pagi');
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).not.toContain('private-test-key');
    expect(options?.headers).toHaveProperty('x-goog-api-key', 'private-test-key');
    const body = JSON.parse(options?.body as string);
    expect(Buffer.from(body.contents[0].parts[1].inlineData.data, 'base64')).toEqual(Buffer.from(audio));
    expect(body.contents[0].parts[1].inlineData.mimeType).toBe('audio/wav');
    expect(body.systemInstruction.parts[0].text).toContain('Do not summarize');
    expect(transcriptionInstruction).toContain('Indonesian, English'); expect(transcriptionInstruction).toContain('[unclear]');
    expect(options?.body).not.toContain('private-test-key');
  });
  it('gracefully handles missing keys without making a request', async () => {
    vi.stubEnv('GEMINI_API_KEY_1', '');
    await expect(transcribeAudio(audio, 'audio/wav')).rejects.toMatchObject({ status: 503, code: 'NOT_CONFIGURED' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('uses a fallback key after an authentication failure', async () => {
    vi.stubEnv('GEMINI_API_KEY_2', 'fallback'); fetchMock.mockResolvedValueOnce(new Response('sensitive upstream details', { status: 403 }));
    expect(await transcribeAudio(audio, 'audio/wav')).toContain('Selamat'); expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1]?.headers).toHaveProperty('x-goog-api-key', 'fallback');
  });
  it('uses the audio-capable fallback model after quota exhaustion without exposing keys', async () => {
    fetchMock.mockResolvedValueOnce(new Response('quota exhausted', { status: 429 }));
    expect(await transcribeAudio(audio, 'audio/wav')).toContain('Selamat pagi');
    expect(String(fetchMock.mock.calls[1][0])).toContain('gemini-2.5-flash-lite');
    expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string).contents[0].parts[1].inlineData.mimeType).toBe('audio/wav');
  });
  it('falls back to current Flash-Lite when legacy model quotas are unavailable', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 429 }));
    fetchMock.mockResolvedValueOnce(new Response('', { status: 429 }));
    expect(await transcribeAudio(audio, 'audio/wav')).toContain('Selamat pagi');
    expect(String(fetchMock.mock.calls[2][0])).toContain('gemini-3.5-flash-lite');
    const body = JSON.parse(fetchMock.mock.calls[2][1]!.body as string);
    expect(body.generationConfig.thinkingConfig).toBeUndefined();
    expect(body.contents[0].parts[1].inlineData.mimeType).toBe('audio/wav');
  });
  it.each([[403, 'SERVICE_CONFIGURATION'], [429, 'RATE_LIMITED'], [503, 'SERVICE_UNAVAILABLE']])('sanitizes upstream status %i', async (status, code) => {
    fetchMock.mockResolvedValue(new Response('private-test-key INTERNAL STACK', { status }));
    await expect(transcribeAudio(audio, 'audio/wav')).rejects.toMatchObject({ code });
  });
  it('handles network failure', async () => {
    fetchMock.mockRejectedValue(new Error('INTERNAL NETWORK DETAILS'));
    await expect(transcribeAudio(audio, 'audio/wav')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });
  it('handles silence, malformed JSON, blocked and incomplete output', async () => {
    fetchMock.mockResolvedValueOnce(response('')); await expect(transcribeAudio(audio, 'audio/wav')).rejects.toMatchObject({ code: 'NO_SPEECH' });
    fetchMock.mockResolvedValueOnce(Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'invalid JSON' }] } }] }));
    await expect(transcribeAudio(audio, 'audio/wav')).rejects.toMatchObject({ code: 'TRANSCRIPTION_FAILED' });
    fetchMock.mockResolvedValueOnce(response('partial transcript', 'MAX_TOKENS')); await expect(transcribeAudio(audio, 'audio/wav')).rejects.toMatchObject({ code: 'INCOMPLETE' });
    fetchMock.mockResolvedValueOnce(response('blocked', 'SAFETY')); await expect(transcribeAudio(audio, 'audio/wav')).rejects.toMatchObject({ code: 'TRANSCRIPTION_FAILED' });
  });
});
describe('transcription API', () => {
  it('passes uploaded binary audio to Gemini and returns only the transcript', async () => {
    const result = await POST(request(file()));
    expect(result.status).toBe(200); expect(await result.json()).toEqual({ transcript: 'Selamat pagi. The budget is 42 million rupiah.' });
    expect(result.headers.get('cache-control')).toBe('no-store');
  });
  it('rejects other origins and expired sessions', async () => {
    vi.mocked(sameOrigin).mockReturnValueOnce(false); expect((await POST(request(file()))).status).toBe(403);
    vi.mocked(sessionId).mockResolvedValueOnce(null); expect((await POST(request(file()))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rate limits before accepting audio', async () => {
    vi.mocked(rateLimit).mockReturnValueOnce(false); const result = await POST(request(file()));
    expect(result.status).toBe(429); expect(result.headers.get('retry-after')).toBe('60'); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rejects a disguised text file and duplicate audio fields', async () => {
    const fake = new File(['fake audio contents'], 'fake.wav', { type: 'audio/wav' });
    expect((await POST(request(fake))).status).toBe(400); expect((await POST(request(file(), file()))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('rejects empty files and oversize bodies', async () => {
    expect((await POST(request(new File([], 'empty.wav', { type: 'audio/wav' })))).status).toBe(400);
    const large = request(file()); large.headers.set('content-length', String(MAX_AUDIO_BYTES + 65537));
    expect((await POST(large)).status).toBe(413); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('bounds chunked uploads without trusting Content-Length', async () => {
    const req = new Request('http://localhost:3000/api/transcribe', { method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=test' }, body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(MAX_AUDIO_BYTES + 65537)); c.close(); } }), duplex: 'half' } as RequestInit);
    expect((await POST(req)).status).toBe(413); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('keeps upstream sensitive error text out of the response', async () => {
    fetchMock.mockResolvedValueOnce(new Response('private-test-key stacktrace', { status: 403 }));
    const result = await POST(request(file())); const json = await result.json();
    expect(result.status).toBe(502); expect(json.code).toBe('SERVICE_CONFIGURATION'); expect(JSON.stringify(json)).not.toContain('private-test-key');
  });
});

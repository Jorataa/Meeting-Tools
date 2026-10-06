import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/server-session', () => ({
  sessionId: vi.fn(async () => 'test-session'),
  sameOrigin: vi.fn(() => true),
  rateLimit: vi.fn(() => true),
}));

import { POST as postAiTest } from '@/app/api/ai/test/route';
import { POST as postAi } from '@/app/api/ai/route';
import { callGeminiGenerateContent } from '@/lib/ai/gemini-rest';
import { rateLimit, sameOrigin, sessionId } from '@/lib/server-session';

const fetchMock = vi.fn<typeof fetch>();
const getAiTest=()=>postAiTest(new Request('http://localhost:3000/api/ai/test',{method:'POST',headers:{Origin:'http://localhost:3000'}}));

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  for (const name of ['GEMINI_API_KEY', 'GEMINI_API_KEYS', ...Array.from({ length: 5 }, (_, i) => `GEMINI_API_KEY_${i + 1}`)]) {
    vi.stubEnv(name, '');
  }
  vi.stubEnv('GEMINI_API_KEY', 'private-test-key');
  vi.mocked(sessionId).mockResolvedValue('test-session');
  vi.mocked(sameOrigin).mockReturnValue(true);
  vi.mocked(rateLimit).mockReturnValue(true);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('STEP A: /api/ai/test health check', () => {
  it('tries the next model after a network failure', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(Response.json({ candidates: [] }));

    const result = await callGeminiGenerateContent(['primary-model', 'fallback-model'], {});

    expect(result.__modelUsed).toBe('fallback-model');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/models/primary-model:generateContent');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/models/fallback-model:generateContent');
  });

  it('returns success and text when Gemini responds', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        candidates: [
          {
            finishReason: 'STOP',
            content: { parts: [{ text: 'Gemini connected' }] },
          },
        ],
      })
    );

    const res = await getAiTest();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({
      success: true,
      text: 'Gemini connected',
    });

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain('gemini-3.8-flash');
    expect(options?.headers).toMatchObject({
      'Content-Type': 'application/json',
      'x-goog-api-key': 'private-test-key',
    });
  });

  it('handles missing API keys gracefully with 503', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    const res = await getAiTest();
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.code).toBe('NOT_CONFIGURED');
  });

  it('handles upstream 429 quota exhaustion', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'Quota exceeded' } }), { status: 429 })
    );
    const res = await getAiTest();
    expect(res.status).toBe(429);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.code).toBe('RATE_LIMITED');
  });
});

describe('STEP B: /api/ai structured meeting analysis', () => {
  function aiRequest(body: unknown) {
    return new Request('http://localhost:3000/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify(body),
    });
  }

  it('returns validated structured output for meeting message', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        candidates: [
          {
            finishReason: 'STOP',
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    shouldSpeak: true,
                    spokenText: 'Which date next month should I record for launch?',
                    notes: 'Launch scheduled for next month; exact date pending.',
                    reason: 'Ambiguous launch deadline.',
                  }),
                },
              ],
            },
          },
        ],
      })
    );

    const res = await postAi(aiRequest({ message: "We'll probably launch sometime next month." }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({
      shouldSpeak: true,
      spokenText: 'Which date next month should I record for launch?',
      notes: 'Launch scheduled for next month; exact date pending.',
      reason: 'Ambiguous launch deadline.',
    });
  });

  it('rejects empty message with 400', async () => {
    const res = await postAi(aiRequest({ message: '' }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.code).toBe('INVALID_INPUT');
  });

  it('rejects unauthorized origin with 403', async () => {
    vi.mocked(sameOrigin).mockReturnValueOnce(false);
    const res = await postAi(aiRequest({ message: 'Hello' }));
    expect(res.status).toBe(403);
  });

  it('rejects expired session with 401', async () => {
    vi.mocked(sessionId).mockResolvedValueOnce(null);
    const res = await postAi(aiRequest({ message: 'Hello' }));
    expect(res.status).toBe(401);
  });
});

describe('STEP C: /api/voice Gemini TTS', () => {
  function voiceRequest(body: unknown) {
    return new Request('http://localhost:3000/api/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify(body),
    });
  }

  it('returns audio/wav binary buffer from gemini-3.8-flash-lite-tts', async () => {
    const fakeWavBase64 = Buffer.from('RIFF....WAVEfmt ').toString('base64');
    fetchMock.mockResolvedValueOnce(Response.json({ steps: [{ type: 'model_output', content: [{ type: 'audio', mime_type: 'audio/wav', data: fakeWavBase64 }] }] }));

    const { POST: postVoice } = await import('@/app/api/voice/route');
    const res = await postVoice(voiceRequest({ text: 'Hello. The AI voice system is working.' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('audio/wav');
    const buffer = await res.arrayBuffer();
    expect(Buffer.from(buffer).toString()).toBe('RIFF....WAVEfmt ');

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain('/v1beta/interactions');
    expect(JSON.parse(options!.body as string)).toMatchObject({ model: 'gemini-3.8-flash-lite-tts', response_format: { type: 'audio' }, generation_config: { speech_config: [{ voice: 'Kore' }] } });
  });

  it('rejects empty text with 400', async () => {
    const { POST: postVoice } = await import('@/app/api/voice/route');
    const res = await postVoice(voiceRequest({ text: '   ' }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.code).toBe('INVALID_INPUT');
  });

  it('handles missing audio data in response with 502', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({
        candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'No audio' }] } }],
      })
    );
    const { POST: postVoice } = await import('@/app/api/voice/route');
    const res = await postVoice(voiceRequest({ text: 'Hello' }));
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.code).toBe('TTS_ERROR');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Voice } from '@/lib/audio/speech';

describe('STEP E: Voice service with Gemini TTS and SpeechSynthesis fallback', () => {
  let voice: Voice;

  beforeEach(() => {
    voice = new Voice();
  });

  afterEach(() => {
    voice.cancel();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('tries Gemini TTS first and succeeds with audio blob', async () => {
    const playMock = vi.fn().mockResolvedValue(undefined);
    const pauseMock = vi.fn();

    class FakeAudio {
      src = '';
      onplay: (() => void) | null = null;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      play = playMock;
      pause = pauseMock;
      currentTime = 0;
      constructor(src: string) {
        this.src = src;
        setTimeout(() => {
          this.onplay?.();
          setTimeout(() => this.onended?.(), 10);
        }, 5);
      }
    }

    const createObjectURLMock = vi.fn(() => 'blob:http://localhost/fake-audio');
    const revokeObjectURLMock = vi.fn();

    vi.stubGlobal('Audio', FakeAudio);
    vi.stubGlobal('URL', {
      createObjectURL: createObjectURLMock,
      revokeObjectURL: revokeObjectURLMock,
    });

    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { 'Content-Type': 'audio/wav' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const onStart = vi.fn();
    const onEnd = vi.fn();
    const onBeforeStart = vi.fn(() => expect(playMock).not.toHaveBeenCalled());

    const result = await voice.speak('Hello from Gemini TTS', {
      onStart,
      onEnd,
      onBeforeStart,
      preferGeminiTTS: true,
    });

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/voice',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ text: 'Hello from Gemini TTS' }),
      })
    );
    expect(createObjectURLMock).toHaveBeenCalled();
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:http://localhost/fake-audio');
    expect(onStart).toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalled();
    expect(onBeforeStart).toHaveBeenCalledOnce();
  });

  it('falls back to window.speechSynthesis when Gemini TTS fails', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('Network error'));
    vi.stubGlobal('fetch', fetchMock);

    const speakMock = vi.fn((utterance: { onstart?: (() => void) | null; onend?: (() => void) | null }) => {
      setTimeout(() => {
        utterance.onstart?.();
        setTimeout(() => utterance.onend?.(), 10);
      }, 5);
    });
    const cancelMock = vi.fn();

    class FakeUtterance {
      text = '';
      lang = '';
      voice = null;
      rate = 1;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((e: { error: string }) => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
    }

    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    vi.stubGlobal('speechSynthesis', {
      speak: speakMock,
      cancel: cancelMock,
      getVoices: () => [],
    });

    const onStart = vi.fn();
    const onEnd = vi.fn();

    const result = await voice.speak('Fallback test speech', {
      onStart,
      onEnd,
      preferGeminiTTS: true,
    });

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalled();
    expect(speakMock).toHaveBeenCalled();
    expect(onStart).toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalled();
  });
});

describe('voice lifecycle safety', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  it('never plays a late TTS response after cancellation', async () => {
    let complete!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { complete = resolve; })));
    const audio = vi.fn(); vi.stubGlobal('Audio', audio);
    const voice = new Voice(); const pending = voice.speak('Late question'); voice.cancel();
    complete(new Response(new Uint8Array([1, 2]), { headers: { 'Content-Type': 'audio/wav' } }));
    expect(await pending).toBe(false); expect(audio).not.toHaveBeenCalled();
  });
  it('checks the natural-pause gate after TTS preparation and skips browser fallback if unsafe', async () => {
    let allowed = true, complete!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { complete = resolve; })));
    const speak = vi.fn(); vi.stubGlobal('speechSynthesis', { speak, cancel: vi.fn(), getVoices: () => [] });
    const voice = new Voice(); const pending = voice.speak('Question', { shouldStart: () => allowed }); allowed = false;
    complete(new Response(new Uint8Array([1, 2]), { headers: { 'Content-Type': 'audio/wav' } }));
    expect(await pending).toBe(false); expect(speak).not.toHaveBeenCalled(); voice.cancel();
  });
  it('cancellation settles a playing audio promise and releases its URL', async () => {
    let started!: () => void; const onStart = new Promise<void>(resolve => { started = resolve; });
    class FakeAudio { onplay?: () => void; onended?: () => void; onerror?: () => void; pause = vi.fn(); currentTime = 0; play = async () => { this.onplay?.(); }; }
    vi.stubGlobal('Audio', FakeAudio); vi.stubGlobal('URL', { createObjectURL: () => 'blob:test', revokeObjectURL: vi.fn() });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2]), { headers: { 'Content-Type': 'audio/wav' } })));
    const voice = new Voice(); const pending = voice.speak('Question', { onStart: started }); await onStart; voice.cancel();
    expect(await pending).toBe(false); expect(voice.isSpeaking()).toBe(false); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test');
  });
});

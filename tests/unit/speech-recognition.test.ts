import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserSpeechRecognition, isBrowserSpeechSupported } from '@/lib/live/speech-recognition';

describe('BrowserSpeechRecognition', () => {
  let instances: FakeSpeechRecognition[] = [];

  class FakeSpeechRecognition {
    continuous = false;
    interimResults = false;
    maxAlternatives = 1;
    lang = '';
    onresult: ((event: unknown) => void) | null = null;
    onerror: ((event: { error: string; message?: string }) => void) | null = null;
    onend: (() => void) | null = null;
    startMock = vi.fn();
    stopMock = vi.fn();
    abortMock = vi.fn();

    constructor() {
      instances.push(this);
    }
    start() {
      this.startMock();
    }
    stop() {
      this.stopMock();
      this.onend?.();
    }
    abort() {
      this.abortMock();
      this.onend?.();
    }
  }

  beforeEach(() => {
    instances = [];
    vi.stubGlobal('SpeechRecognition', FakeSpeechRecognition);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('detects browser support correctly', () => {
    expect(isBrowserSpeechSupported()).toBe(true);
    vi.stubGlobal('SpeechRecognition', undefined);
    vi.stubGlobal('webkitSpeechRecognition', undefined);
    expect(isBrowserSpeechSupported()).toBe(false);
  });

  it('configures language according to user preference', () => {
    const callbacks = { onPartial: vi.fn(), onFinal: vi.fn() };

    const recEn = new BrowserSpeechRecognition(callbacks, 'en');
    recEn.start();
    expect(instances[0].lang).toBe('en-US');

    const recId = new BrowserSpeechRecognition(callbacks, 'id');
    recId.start();
    expect(instances[1].lang).toBe('id-ID');

    vi.stubGlobal('navigator', { language: 'id-ID' });
    const recAuto = new BrowserSpeechRecognition(callbacks, 'auto');
    recAuto.start();
    expect(instances[2].lang).toBe('id-ID');
  });

  it('streams interim results as partial and final results as final', () => {
    const onPartial = vi.fn();
    const onFinal = vi.fn();
    const recognition = new BrowserSpeechRecognition({ onPartial, onFinal }, 'en');
    recognition.start();

    const instance = instances[0];
    expect(instance.continuous).toBe(true);
    expect(instance.interimResults).toBe(true);

    // Interim event
    instance.onresult?.({
      resultIndex: 0,
      results: [
        {
          isFinal: false,
          length: 1,
          0: { transcript: 'We need to finish', confidence: 0.9 },
        },
      ],
    });

    expect(onPartial).toHaveBeenCalledWith('We need to finish', expect.any(Number));
    expect(onFinal).not.toHaveBeenCalled();

    // Final event
    instance.onresult?.({
      resultIndex: 0,
      results: [
        {
          isFinal: true,
          length: 1,
          0: { transcript: 'We need to finish the landing page.', confidence: 0.95 },
        },
      ],
    });

    expect(onFinal).toHaveBeenCalledWith(
      'We need to finish the landing page.',
      expect.any(Number),
      expect.stringContaining('browser-speech-')
    );
  });

  it('handles pause and resume cleanly', () => {
    const recognition = new BrowserSpeechRecognition({ onPartial: vi.fn(), onFinal: vi.fn() }, 'en');
    recognition.start();
    const instance = instances[0];

    recognition.setPaused(true);
    expect(instance.stopMock).toHaveBeenCalled();

    recognition.setPaused(false);
    expect(instance.startMock).toHaveBeenCalledTimes(2);
  });

  it('stops and cancels without throwing', () => {
    const rec1 = new BrowserSpeechRecognition({ onPartial: vi.fn(), onFinal: vi.fn() }, 'en');
    rec1.start();
    const inst1 = instances[0];
    rec1.stop();
    expect(inst1.stopMock).toHaveBeenCalled();

    const rec2 = new BrowserSpeechRecognition({ onPartial: vi.fn(), onFinal: vi.fn() }, 'en');
    rec2.start();
    const inst2 = instances[1];
    rec2.cancel();
    expect(inst2.abortMock).toHaveBeenCalled();
  });
});

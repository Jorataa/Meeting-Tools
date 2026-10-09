'use client';

type SpeechCallbacks = {
  onPartial: (text: string, at: number) => void;
  onFinal: (text: string, at: number, id: string) => void;
  onError?: (error: string) => void;
};

interface SpeechRecognitionItem {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResultItem {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionItem;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultItem;
  };
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

function getConstructor(): SpeechRecognitionConstructor | undefined {
  const scope = typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : undefined;
  if (!scope) return undefined;
  const win = scope as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return win.SpeechRecognition || win.webkitSpeechRecognition;
}

export function isBrowserSpeechSupported(): boolean {
  return typeof getConstructor() !== 'undefined';
}

/**
 * High-performance, zero-latency browser speech recognition adapter.
 * Runs in parallel or standalone to provide progressive, word-by-word streaming
 * with native support for English and Indonesian.
 */
export class BrowserSpeechRecognition {
  private instance?: SpeechRecognitionInstance;
  private running = false;
  private paused = false;
  private cancelled = false;
  private sequence = 0;
  private restartTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private callbacks: SpeechCallbacks,
    private preferredLang: 'auto' | 'en' | 'id' = 'auto',
  ) {}

  start(): boolean {
    const Ctor = getConstructor();
    if (!Ctor) return false;

    this.cancelled = false;
    this.paused = false;

    try {
      const rec = new Ctor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      // Select recognition language based on user preference or browser default
      if (this.preferredLang === 'id') {
        rec.lang = 'id-ID';
      } else if (this.preferredLang === 'en') {
        rec.lang = 'en-US';
      } else {
        // Auto / mixed: use user's browser language if available, defaulting to bilingual-capable locales
        rec.lang = typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en-US';
      }

      rec.onresult = (event: SpeechRecognitionEventLike) => {
        if (this.cancelled || this.paused) return;
        const now = Date.now();
        let currentInterim = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          const text = result[0]?.transcript?.trim() || '';
          if (!text) continue;

          if (result.isFinal) {
            this.callbacks.onFinal(text, now, `browser-speech-${++this.sequence}-${Date.now()}`);
          } else {
            currentInterim = currentInterim ? `${currentInterim} ${text}` : text;
          }
        }

        if (currentInterim) {
          this.callbacks.onPartial(currentInterim, now);
        }
      };

      rec.onerror = (event) => {
        if (this.cancelled) return;
        // Benign errors: 'no-speech' is expected during pauses, 'aborted' on user action
        if (event.error === 'no-speech' || event.error === 'aborted') {
          return;
        }
        this.callbacks.onError?.(event.message || event.error);
      };

      rec.onend = () => {
        this.running = false;
        // In continuous mode, browsers might still stop after prolonged silence.
        // Automatically restart if recording is still active and not paused.
        if (!this.cancelled && !this.paused) {
          clearTimeout(this.restartTimer);
          this.restartTimer = setTimeout(() => {
            if (!this.cancelled && !this.paused) {
              try {
                this.instance?.start();
                this.running = true;
              } catch {
                // If start fails, attempt recreation on next tick
                this.start();
              }
            }
          }, 150);
        }
      };

      rec.start();
      this.instance = rec;
      this.running = true;
      return true;
    } catch {
      return false;
    }
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    if (paused) {
      clearTimeout(this.restartTimer);
      try {
        this.instance?.stop();
      } catch {
        // ignore
      }
      this.running = false;
    } else if (!this.cancelled) {
      if (!this.running) {
        try {
          this.instance?.start();
          this.running = true;
        } catch {
          this.start();
        }
      }
    }
  }

  stop() {
    this.cancelled = true;
    clearTimeout(this.restartTimer);
    if (this.instance) {
      try {
        this.instance.stop();
      } catch {
        // ignore
      }
      this.instance = undefined;
    }
    this.running = false;
  }

  cancel() {
    this.cancelled = true;
    clearTimeout(this.restartTimer);
    if (this.instance) {
      try {
        this.instance.abort();
      } catch {
        // ignore
      }
      this.instance = undefined;
    }
    this.running = false;
  }
}

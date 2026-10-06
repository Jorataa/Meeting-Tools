export type SpeechLanguage = 'en' | 'id' | 'mixed';
export interface SpeakOptions {
  language?: SpeechLanguage; onBeforeStart?: () => void; onStart?: () => void; onEnd?: () => void;
  preferGeminiTTS?: boolean; shouldStart?: () => boolean;
}
function getSpeechSynthesis(): SpeechSynthesis | undefined {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) return window.speechSynthesis;
  return typeof globalThis !== 'undefined' && 'speechSynthesis' in globalThis ? globalThis.speechSynthesis : undefined;
}

export class Voice {
  private currentAudio?: HTMLAudioElement;
  private currentBlobUrl?: string;
  private active = false;
  private generation = 0;
  private request?: AbortController;
  private settle?: () => void;
  supported() { return (typeof window !== 'undefined' && 'Audio' in window) || !!getSpeechSynthesis(); }
  isSpeaking() { return this.active; }
  stopSpeaking() { this.cancel(); }
  cancel() {
    this.generation++; this.active = false; this.request?.abort(); this.request = undefined;
    const settle = this.settle; this.settle = undefined; settle?.();
    if (this.currentAudio) {
      this.currentAudio.onplay = null; this.currentAudio.onended = null; this.currentAudio.onerror = null;
      try { this.currentAudio.pause(); this.currentAudio.currentTime = 0; } catch {}
      this.currentAudio = undefined;
    }
    if (this.currentBlobUrl) { URL.revokeObjectURL(this.currentBlobUrl); this.currentBlobUrl = undefined; }
    try { getSpeechSynthesis()?.cancel(); } catch {}
  }
  async speak(text: string, languageOrOptions: SpeechLanguage | SpeakOptions = 'en', onStartCallback?: () => void, onEndCallback?: () => void): Promise<boolean> {
    if (!text.trim()) return false;
    this.cancel();
    const generation = this.generation;
    const options: SpeakOptions = typeof languageOrOptions === 'string'
      ? { language: languageOrOptions, onStart: onStartCallback, onEnd: onEndCallback } : languageOrOptions;
    const allowed = () => generation === this.generation && (options.shouldStart?.() ?? true);
    const start = () => { if (!allowed()) { this.cancel(); return; } this.active = true; options.onStart?.(); };
    const abort = new AbortController(); this.request = abort;
    try {
      if (!allowed()) return false;
      if (options.preferGeminiTTS !== false && typeof fetch !== 'undefined') {
        try {
          const response = await fetch('/api/voice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: text.trim() }), signal: AbortSignal.any([abort.signal, AbortSignal.timeout(18000)]) });
          if (!response.ok) throw new Error('Voice unavailable');
          const blob = await response.blob();
          if (!allowed()) return false;
          if (!blob.size || !blob.type.startsWith('audio/')) throw new Error('Voice unavailable');
          if (await this.playAudio(blob, allowed, start, options.onBeforeStart)) return true;
        } catch { /* A failed primary voice must never stop the meeting. */ }
      }
      if (!allowed()) return false;
      return await this.playBrowser(text.trim(), options.language || 'mixed', allowed, start, options.onBeforeStart);
    } finally {
      if (generation === this.generation) { this.active = false; this.request = undefined; }
      options.onEnd?.();
    }
  }
  private playAudio(blob: Blob, allowed: () => boolean, onStart: () => void, onBeforeStart?: () => void): Promise<boolean> {
    return new Promise(resolve => {
      if (!allowed()) { resolve(false); return; }
      const url = URL.createObjectURL(blob); this.currentBlobUrl = url;
      const audio = new Audio(url); this.currentAudio = audio;
      let done = false;
      const finish = (success: boolean) => {
        if (done) return; done = true; clearTimeout(watchdog);
        audio.onplay = null; audio.onended = null; audio.onerror = null;
        if (this.currentBlobUrl === url) { URL.revokeObjectURL(url); this.currentBlobUrl = undefined; }
        if (this.currentAudio === audio) this.currentAudio = undefined;
        this.settle = undefined; resolve(success);
      };
      const watchdog = setTimeout(() => { audio.pause(); finish(false); }, 30000);
      this.settle = () => { audio.pause(); finish(false); };
      audio.onplay = () => { if (!allowed()) { audio.pause(); finish(false); return; } onStart(); };
      audio.onended = () => finish(true); audio.onerror = () => finish(false);
      if (!allowed()) { finish(false); return; }
      try { onBeforeStart?.(); void audio.play().catch(() => finish(false)); } catch { finish(false); }
    });
  }
  private playBrowser(text: string, language: SpeechLanguage, allowed: () => boolean, onStart: () => void, onBeforeStart?: () => void): Promise<boolean> {
    const synth = getSpeechSynthesis();
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return Promise.resolve(false);
    return new Promise(resolve => {
      if (!allowed()) { resolve(false); return; }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = language === 'id' || (language === 'mixed' && /\b(siapa|kapan|yang|untuk|apa|akan|dan|tanggal)\b/i.test(text)) ? 'id-ID' : 'en-US';
      try { utterance.voice = synth.getVoices().find(v => v.lang.startsWith(utterance.lang.split('-')[0])) || null; } catch {}
      utterance.rate = 0.94;
      let done = false;
      const finish = (success: boolean) => {
        if (done) return; done = true; clearTimeout(watchdog); this.settle = undefined;
        utterance.onstart = null; utterance.onend = null; utterance.onerror = null; resolve(success);
      };
      const watchdog = setTimeout(() => { finish(false); synth.cancel(); }, 30000);
      this.settle = () => finish(false);
      utterance.onstart = () => { if (!allowed()) { finish(false); synth.cancel(); return; } onStart(); };
      utterance.onend = () => finish(true); utterance.onerror = () => finish(false);
      try { if (allowed()) { onBeforeStart?.(); synth.speak(utterance); } else finish(false); } catch { finish(false); }
    });
  }
}

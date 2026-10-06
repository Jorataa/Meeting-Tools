import { Voice } from '@/lib/audio/speech';
import { ANALYSIS_INTERVAL_MS, canInterrupt, emptyMeetingContext, interruptionSchema, MIN_INTERRUPT_CONFIDENCE, MIN_INTERRUPT_RELEVANCE, isRepeated, type AskedInterruption, type Interruption, type MeetingContext } from './policy';

export type LiveSnapshot = {
  active: boolean; transcript: string; notes: string; question: string;
  status: 'idle' | 'connecting' | 'listening' | 'transcribing' | 'thinking' | 'waiting' | 'speaking';
  notice: string; asked: AskedInterruption[]; suppressCapture: boolean;
  context: MeetingContext; questionReason: string; questionConfidence: number;
};
export const emptyLiveSnapshot: LiveSnapshot = {
  active: false, transcript: '', notes: '', question: '', status: 'idle', notice: '', asked: [],
  suppressCapture: false, context: emptyMeetingContext, questionReason: '', questionConfidence: 0,
};
type VoiceService = Pick<Voice, 'speak' | 'cancel'>;
type Dependencies = { fetch?: typeof fetch; now?: () => number; voice?: VoiceService };

/** Observes human transcript events independently of microphone capture and transcription. */
export class LiveInterruptionController {
  private view: LiveSnapshot = { ...emptyLiveSnapshot, asked: [] };
  private voice: VoiceService;
  private fetcher: typeof fetch;
  private now: () => number;
  private epoch = 0;
  private revision = 0;
  private observation = 0;
  private analyzedRevision = -1;
  private committedTranscript = '';
  private partial = false;
  private paused = false;
  private candidate?: { result: Interruption; revision: number; at: number };
  private analysisBusy = false;
  private voiceBusy = false;
  private spoken = false;
  private sessionReady = false;
  private enabled = true;
  private voiceEnabled = true;
  private startedAt = 0;
  private lastVoiceAt = 0;
  private lastQuestionAt = -Infinity;
  private lastVoiceAttempt = -Infinity;
  private lastAnalysisAt = -Infinity;
  private analysisRetryAt = 0;
  private sessionRetryAt = 0;
  private sessionBusy = false;
  private requests = new Set<AbortController>();
  private timer?: ReturnType<typeof setInterval>;
  private finalizedTranscript = '';
  private finalizingTranscript = '';
  private finalizationVersion = 0;
  constructor(private onChange: (snapshot: LiveSnapshot) => void, dependencies: Dependencies = {}) {
    this.fetcher = dependencies.fetch || fetch.bind(globalThis);
    this.now = dependencies.now || Date.now;
    this.voice = dependencies.voice || new Voice();
  }
  private publish(patch: Partial<LiveSnapshot> = {}) {
    // Microphone activity can arrive many times per second. Publish only visible
    // changes so audio frames do not continually rerender the entire workspace.
    if (Object.entries(patch).every(([key, value]) => this.view[key as keyof LiveSnapshot] === value)) return;
    this.view = { ...this.view, ...patch };
    this.onChange({ ...this.view, asked: [...this.view.asked] });
  }
  private clearCandidate() {
    this.candidate = undefined;
    this.publish({ question: '', questionReason: '', questionConfidence: 0 });
  }
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) { this.cancelVoice(); this.clearCandidate(); }
  }
  setVoiceEnabled(enabled: boolean) { this.voiceEnabled = enabled; if (!enabled) this.cancelVoice(); }
  setPaused(paused: boolean) {
    this.paused = paused; this.observation++;
    if (paused) { this.cancelVoice(); this.clearCandidate(); }
    else { this.lastVoiceAt = this.now(); void this.tick(); }
    this.publish({ status: this.view.active ? 'listening' : 'idle' });
  }
  onVoice() {
    if (!this.view.active || this.paused || this.spoken || this.view.suppressCapture) return;
    this.lastVoiceAt = this.now(); this.observation++;
    if (this.voiceBusy) this.cancelVoice();
    this.clearCandidate();
  }
  /** text is the complete human transcript, including the current partial when partial=true. */
  acceptTranscript(text: string, partial: boolean) {
    if (!this.view.active || this.paused || this.view.suppressCapture) return;
    const previousPartial = this.partial;
    const changed = text !== this.view.transcript || partial !== previousPartial;
    if (!changed) return;
    this.partial = partial; this.observation++; this.lastVoiceAt = this.now();
    this.cancelVoice(); this.clearCandidate();
    this.publish({ transcript: text, status: 'listening' });
    if (!partial && text.trim() !== this.committedTranscript) {
      this.committedTranscript = text.trim(); this.revision++;
    }
    void this.tick();
  }
  async start() {
    this.stop(); this.view = { ...emptyLiveSnapshot, asked: [] };
    this.revision = 0; this.observation = 0; this.analyzedRevision = -1; this.committedTranscript = '';
    this.partial = false; this.paused = false; this.analysisBusy = false; this.voiceBusy = false;
    this.sessionReady = false; this.sessionBusy = false; this.sessionRetryAt = 0;
    this.finalizedTranscript = ''; this.finalizingTranscript = ''; this.finalizationVersion++;
    this.analysisRetryAt = 0; this.lastQuestionAt = -Infinity; this.lastVoiceAttempt = -Infinity; this.lastAnalysisAt = -Infinity;
    this.startedAt = this.lastVoiceAt = this.now();
    this.publish({ active: true, status: 'connecting' });
    this.timer = setInterval(() => void this.tick(), 200);
    await this.connectSession(this.epoch);
  }
  private async connectSession(epoch: number) {
    if (this.sessionBusy || this.now() < this.sessionRetryAt) return;
    this.sessionBusy = true;
    try {
      const response = await this.request('/api/session', undefined, 15000);
      if (epoch !== this.epoch) return;
      if (!response.ok) throw new Error('Session unavailable');
      this.sessionReady = true; this.publish({ status: 'listening', notice: '' }); void this.tick();
    } catch {
      if (epoch !== this.epoch) return;
      this.sessionRetryAt = this.now() + 15000;
      this.publish({ notice: 'AI could not connect. Transcript capture continues; clarification will reconnect automatically.', status: 'listening' });
    } finally { if (epoch === this.epoch) this.sessionBusy = false; }
  }
  private async request(url: string, input: unknown, timeout: number) {
    const abort = new AbortController(); this.requests.add(abort);
    try {
      return await this.fetcher(url, { method: 'POST', ...(input === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }), signal: AbortSignal.any([abort.signal, AbortSignal.timeout(timeout)]) });
    } finally { this.requests.delete(abort); }
  }
  private readyToAsk(candidate: NonNullable<LiveInterruptionController['candidate']>) {
    return !this.paused && this.now() - this.lastVoiceAttempt >= 30000
      && canInterrupt(candidate.result, {
        now: this.now(), lastVoiceAt: this.lastVoiceAt, lastQuestionAt: this.lastQuestionAt, startedAt: this.startedAt,
        active: this.view.active, enabled: this.enabled, voiceEnabled: this.voiceEnabled, speaking: this.spoken,
        pendingAudio: this.partial, analyzing: this.analysisBusy, revision: this.revision, candidateRevision: candidate.revision,
      }, this.view.asked);
  }
  async tick() {
    if (!this.view.active) return;
    const epoch = this.epoch;
    if (!this.sessionReady) { void this.connectSession(epoch); return; }
    if (this.paused) return;
    if (!this.analysisBusy && !this.voiceBusy && !this.partial && this.committedTranscript
      && this.analyzedRevision !== this.revision && this.now() >= this.analysisRetryAt
      && this.now() - this.lastAnalysisAt >= ANALYSIS_INTERVAL_MS) {
      void this.analyze(epoch, false);
    }
    const candidate = this.candidate;
    if (candidate && this.now() - candidate.at > 20000) this.clearCandidate();
    else if (candidate && !this.voiceBusy && this.readyToAsk(candidate)) void this.ask(candidate, epoch);
    if (!this.analysisBusy && !this.voiceBusy) this.publish({ status: this.candidate && this.enabled ? 'waiting' : 'listening' });
  }
  private async analyze(epoch: number, final: boolean, transcript = this.committedTranscript, finalizationVersion?: number): Promise<boolean> {
    const revision = this.revision, observation = this.observation;
    this.analysisBusy = true; this.lastAnalysisAt = this.now();
    if (!final) { this.clearCandidate(); this.publish({ status: 'thinking' }); }
    try {
      const response = await this.request('/api/interruption', {
        transcript: transcript.slice(-60000), notes: this.view.notes.slice(0, 16000), asked: this.view.asked.slice(-50), final,
      }, 35000);
      if (!response.ok) {
        if (response.status === 401) { this.sessionReady = false; this.sessionRetryAt = 0; }
        throw new Error('Analysis unavailable');
      }
      const result = interruptionSchema.parse(await response.json());
      if (epoch !== this.epoch || (!final && (revision !== this.revision || observation !== this.observation || this.partial || this.paused))
        || (final && finalizationVersion !== this.finalizationVersion)) return false;
      this.analyzedRevision = revision;
      this.publish({ notes: result.notes, context: result.context ?? { ...emptyMeetingContext, summary: result.notes.slice(0, 3000) }, notice: '' });
      if (!final && this.enabled && result.shouldInterrupt && result.confidence >= MIN_INTERRUPT_CONFIDENCE
        && (result.relevance ?? result.confidence) >= MIN_INTERRUPT_RELEVANCE && result.category !== 'none'
        && result.question.trim() && result.gapKey.trim() && !isRepeated(result, this.view.asked)) {
        this.candidate = { result, revision, at: this.now() };
        this.publish({ question: result.question, questionReason: result.reason, questionConfidence: result.confidence });
      }
      return true;
    } catch {
      if (epoch !== this.epoch || (final && finalizationVersion !== this.finalizationVersion)) return false;
      this.analysisRetryAt = this.now() + 20000;
      this.publish({ notice: 'AI analysis is temporarily unavailable. Recording continues; your transcript is safe.' });
      return false;
    } finally { if (epoch === this.epoch) this.analysisBusy = false; }
  }
  private async ask(candidate: NonNullable<LiveInterruptionController['candidate']>, epoch: number) {
    this.voiceBusy = true; this.publish({ status: 'waiting' });
    let didStart = false;
    try {
      const success = await this.voice.speak(candidate.result.question, {
        preferGeminiTTS: true, language: 'mixed',
        shouldStart: () => epoch === this.epoch && this.candidate === candidate && this.readyToAsk(candidate),
        onBeforeStart: () => { if (epoch === this.epoch) this.publish({ suppressCapture: true }); },
        onStart: () => {
          if (epoch !== this.epoch) return;
          didStart = true; this.spoken = true; this.lastQuestionAt = this.lastVoiceAttempt = this.now();
          const result = candidate.result;
          this.publish({ status: 'speaking', asked: [...this.view.asked, { gapKey: result.gapKey, question: result.question, category: result.category, at: this.now() }] });
        },
      });
      if (epoch !== this.epoch) return;
      if (!success && this.candidate === candidate && this.view.active && this.enabled && this.voiceEnabled && !this.paused) {
        this.lastVoiceAttempt = this.now();
        this.publish({ notice: 'AI voice could not play. Recording continues; read the clarification on screen.' });
      }
    } catch {
      if (epoch === this.epoch) {
        this.lastVoiceAttempt = this.now(); this.publish({ notice: 'AI voice is unavailable. Recording continues; read the clarification on screen.' });
      }
    } finally {
      if (epoch === this.epoch) {
        this.spoken = false; this.voiceBusy = false; this.publish({ suppressCapture: false });
        if (didStart) { this.lastQuestionAt = this.lastVoiceAt = this.now(); this.clearCandidate(); this.publish({ status: 'listening' }); }
      }
    }
  }
  private cancelVoice() {
    this.voice.cancel(); this.spoken = false;
    if (this.view.suppressCapture) this.publish({ suppressCapture: false });
  }
  stop() {
    this.epoch++; if (this.timer) clearInterval(this.timer); this.timer = undefined;
    this.requests.forEach(request => request.abort()); this.requests.clear();
    this.cancelVoice(); this.candidate = undefined; this.voiceBusy = false; this.sessionReady = false;
    this.publish({ active: false, status: 'idle', question: '', questionReason: '', questionConfidence: 0, suppressCapture: false });
  }
  reset() {
    this.stop(); this.finalizedTranscript = ''; this.finalizingTranscript = ''; this.finalizationVersion++;
    this.publish({ ...emptyLiveSnapshot, asked: [] });
  }
  async finalize(transcript: string) {
    if (!transcript.trim() || transcript === this.finalizedTranscript || transcript === this.finalizingTranscript) return;
    const version = ++this.finalizationVersion;
    this.finalizingTranscript = transcript;
    try {
      if (await this.analyze(this.epoch, true, transcript, version)) this.finalizedTranscript = transcript;
    } finally { if (version === this.finalizationVersion) this.finalizingTranscript = ''; }
  }
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import { canInterrupt, isUsefulQuestion, type InterruptGate, type Interruption } from '@/lib/live/policy';
import { LiveInterruptionController, type LiveSnapshot } from '@/lib/live/controller';

const gap: Interruption = { shouldInterrupt: true, confidence: 0.92, category: 'deadline', question: 'Tanggal berapa deadline peluncuran?', reason: 'Tanggal belum jelas.', gapKey: 'deadline:launch', notes: 'Peluncuran: tanggal belum jelas.' };
const gate: InterruptGate = { now: 100000, lastVoiceAt: 97000, lastQuestionAt: 60000, startedAt: 10000, active: true, enabled: true, voiceEnabled: true, speaking: false, pendingAudio: false, analyzing: false, revision: 1, candidateRevision: 1 };
afterEach(() => vi.useRealTimers());
describe('conservative interruption policy', () => {
  it('accepts the exact confidence, cooldown and pause boundaries', () => {
    expect(canInterrupt({ ...gap, confidence: .82 }, { ...gate, lastVoiceAt: 97800, lastQuestionAt: 70000 }, [])).toBe(true);
  });
  it.each([
    { enabled: false }, { voiceEnabled: false }, { active: false }, { speaking: true }, { pendingAudio: true }, { analyzing: true },
    { candidateRevision: 0 }, { lastVoiceAt: 98000 }, { lastQuestionAt: 70001 }, { startedAt: 93000 },
  ])('blocks unsafe gate %j', patch => expect(canInterrupt(gap, { ...gate, ...patch }, [])).toBe(false));
  it('rejects low confidence and non-actionable categories', () => {
    expect(canInterrupt({ ...gap, confidence: .819 }, gate, [])).toBe(false);
    expect(canInterrupt({ ...gap, category: 'none' }, gate, [])).toBe(false);
    expect(canInterrupt({ ...gap, question: '' }, gate, [])).toBe(false);
    expect(canInterrupt({ ...gap, relevance: .79 }, gate, [])).toBe(false);
  });
  it('blocks translated or paraphrased questions for the same underlying gap', () => {
    expect(canInterrupt(gap, gate, [{ ...gap, question: 'What exact date is the launch deadline?' }])).toBe(false);
    expect(canInterrupt({ ...gap, gapKey: 'different-id' }, gate, [{ ...gap, question: gap.question.toUpperCase() }])).toBe(false);
  });
  it('rejects verbose questions and model requests for credentials or another user', () => {
    for (const question of ['What is your API key?', 'Can you share another user\'s transcript?', 'Apa kata sandi Anda?', 'word '.repeat(33)]) {
      expect(isUsefulQuestion({ ...gap, question })).toBe(false);
      expect(canInterrupt({ ...gap, question }, gate, [])).toBe(false);
    }
    expect(isUsefulQuestion({ ...gap, category: 'owner', question: 'Who will deploy the landing page?' })).toBe(true);
    expect(isUsefulQuestion({ ...gap, category: 'scope', question: 'Which requirements are necessary for launch?' })).toBe(true);
  });
  it('treats dismissed questions as considered gaps', () => {
    expect(canInterrupt(gap, gate, [{ gapKey: gap.gapKey, question: gap.question, category: gap.category, disposition: 'dismissed' }])).toBe(false);
  });
});

function harness() {
  vi.useFakeTimers();
  let time = 100000;
  let snapshot: LiveSnapshot;
  const voice = { speak: vi.fn(async (_text: string, options: import('@/lib/audio/speech').SpeakOptions) => {
    if (!options.shouldStart?.()) return false;
    options.onBeforeStart?.(); options.onStart?.(); return true;
  }), cancel: vi.fn() };
  const fetcher = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
    if (url === '/api/session') return Response.json({ ai: true });
    const input = JSON.parse(options!.body as string);
    return Response.json(input.asked.length ? { ...gap, notes: 'Deadline: 15 November, dikonfirmasi Rina.', shouldInterrupt: false } : gap);
  });
  const controller = new LiveInterruptionController(value => { snapshot = value; }, { now: () => time, fetch: fetcher as typeof fetch, voice });
  const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
  return { controller, voice, fetcher, flush, get snapshot() { return snapshot!; }, advance: (ms: number) => { time += ms; } };
}
describe('live recording lifecycle', () => {
  it('dismisses a silent clarification and retains review history without asking again', async () => {
    const h = harness(); await h.controller.start(); h.controller.setVoiceEnabled(false);
    h.controller.acceptTranscript('We will launch next month.', false); await h.flush();
    h.controller.dismissQuestion();
    expect(h.snapshot.question).toBe(''); expect(h.snapshot.asked[0].disposition).toBe('dismissed');
    expect(h.snapshot.questionHistory[0].disposition).toBe('dismissed');
    h.advance(40000); h.controller.acceptTranscript('We will launch next month. The landing page is almost ready.', false); await h.flush();
    expect(h.snapshot.question).toBe(''); expect(h.voice.speak).not.toHaveBeenCalled(); h.controller.stop();
  });
  it('carries early owners and structured context into later analyses and resolves questions', async () => {
    const h = harness(); await h.controller.start();
    const context = { summary: 'Jovan owns deployment.', topics: ['Launch'], decisions: ['Jovan will deploy.'], actionItems: ['Deploy landing page.'], unresolvedQuestions: ['What day?'], structuredActionItems: [{ task: 'Deploy landing page', owner: 'Jovan', deadline: null }], people: ['Jovan'], deadlines: [], resolvedQuestions: [] };
    h.fetcher.mockImplementationOnce(async () => Response.json({ ...gap, context }));
    h.controller.acceptTranscript('Jovan will deploy it.', false); await h.flush();
    h.advance(9000);
    const transcript = `Jovan will deploy it. ${'Project discussion. '.repeat(4000)} We will launch Friday.`;
    h.fetcher.mockImplementationOnce(async (_url, options) => {
      const input = JSON.parse(options!.body as string);
      expect(input.transcript.startsWith('Jovan will deploy it.')).toBe(true);
      expect(input.transcript.endsWith('We will launch Friday.')).toBe(true);
      expect(input.transcript.length).toBeLessThanOrEqual(60000);
      expect(input.context.structuredActionItems[0].owner).toBe('Jovan');
      return Response.json({ ...gap, shouldInterrupt: false, context: { ...context, unresolvedQuestions: [], deadlines: ['Friday'], resolvedQuestions: ['Launch deadline: Friday'], structuredActionItems: [{ task: 'Deploy landing page', owner: 'Jovan', deadline: 'Friday' }] } });
    });
    h.controller.acceptTranscript(transcript, false); await h.flush();
    expect(h.snapshot.question).toBe(''); expect(h.snapshot.context.unresolvedQuestions).toEqual([]);
    expect(h.snapshot.context.structuredActionItems?.[0]).toEqual({ task: 'Deploy landing page', owner: 'Jovan', deadline: 'Friday' }); h.controller.stop();
  });
  it('preserves edited notes during an in-flight and subsequent analysis', async () => {
    const h = harness(); await h.controller.start();
    let complete!: (value: Response) => void;
    h.fetcher.mockImplementationOnce(async () => new Promise(resolve => { complete = resolve; }));
    h.controller.acceptTranscript('Launch next month.', false); await h.flush();
    h.controller.updateNotes('My reviewed notes.'); complete(Response.json(gap)); await h.flush();
    expect(h.snapshot.notes).toBe('My reviewed notes.');
    await h.controller.finalize('Launch next month.'); expect(h.snapshot.notes).toBe('My reviewed notes.'); h.controller.stop();
  });
  it('manual assistance remains read-only and independent of interruption settings and speech', async () => {
    const h = harness(); await h.controller.start(); h.controller.setEnabled(false);
    h.fetcher.mockImplementationOnce(async (url, options) => {
      expect(url).toBe('/api/ask'); expect(JSON.parse(options!.body as string).transcript).toBe('Jovan will deploy on Friday.');
      h.controller.acceptTranscript('Live speech continues.', true);
      return Response.json({ answer: 'Jovan will deploy on Friday.' });
    });
    await h.controller.askAI('Who will deploy?', 'Jovan will deploy on Friday.');
    expect(h.snapshot.manualResponse).toBe('Jovan will deploy on Friday.'); expect(h.snapshot.transcript).toBe('Live speech continues.');
    expect(h.snapshot.manualBusy).toBe(false); expect(h.voice.speak).not.toHaveBeenCalled(); h.controller.stop();
  });
  it('does not let stale manual answers cross into another meeting', async () => {
    const h = harness(); await h.controller.start();
    let complete!: (value: Response) => void;
    h.fetcher.mockImplementationOnce(async () => new Promise(resolve => { complete = resolve; }));
    const pending = h.controller.askAI('Summarize', 'Sensitive first meeting.'); await h.flush();
    h.controller.reset(); complete(Response.json({ answer: 'First meeting details.' })); await pending;
    expect(h.snapshot.manualResponse).toBe(''); expect(h.snapshot.manualBusy).toBe(false);
  });
  it('observes frequent microphone activity without repeated voice cancellation or UI updates', async () => {
    const changes = vi.fn();
    const voice = { speak: vi.fn(async () => true), cancel: vi.fn() };
    const controller = new LiveInterruptionController(changes, {
      fetch: vi.fn(async () => Response.json({ ai: true })) as typeof fetch,
      voice,
    });
    await controller.start(); changes.mockClear(); voice.cancel.mockClear();
    for (let i = 0; i < 100; i++) controller.onVoice();
    expect(changes).not.toHaveBeenCalled();
    expect(voice.cancel).not.toHaveBeenCalled();
    controller.stop();
  });
  it('observes committed speech, waits for a pause, asks once, and incorporates the answer', async () => {
    const h = harness(); await h.controller.start();
    h.controller.acceptTranscript('Kita akan launch bulan depan.', false); await h.flush();
    expect(h.snapshot.transcript).toContain('bulan depan');
    expect(h.fetcher.mock.calls.some(([url]) => url === '/api/live/transcribe')).toBe(false);
    expect(h.snapshot.question).toBe(gap.question);
    h.advance(1000); await h.controller.tick(); await h.flush(); expect(h.voice.speak).not.toHaveBeenCalled();
    h.advance(9000); await h.controller.tick(); await h.flush();
    expect(h.voice.speak).toHaveBeenCalledOnce(); expect(h.snapshot.asked).toHaveLength(1);
    expect(h.snapshot.transcript).not.toContain('Hush:'); expect(h.snapshot.suppressCapture).toBe(false);
    h.advance(9000); h.controller.acceptTranscript('Kita akan launch bulan depan. Rina: Tanggal 15 November.', false); await h.flush();
    expect(h.snapshot.notes).toContain('15 November'); expect(h.snapshot.transcript).toContain('Rina:');
    h.advance(31000); await h.controller.tick(); await h.flush();
    expect(h.voice.speak).toHaveBeenCalledOnce(); h.controller.stop();
  });
  it('displays partials without analyzing unfinished speech or erasing committed text', async () => {
    const h = harness(); await h.controller.start();
    h.controller.acceptTranscript('Today we', true); await h.flush();
    expect(h.snapshot.transcript).toBe('Today we'); expect(h.fetcher).toHaveBeenCalledTimes(1);
    h.controller.acceptTranscript('Today we need to launch next week.', false); await h.flush();
    expect(h.snapshot.question).toBe(gap.question);
    h.controller.acceptTranscript('Today we need to launch next week. On', true); await h.flush();
    expect(h.snapshot.transcript).toContain('next week. On'); expect(h.snapshot.question).toBe('');
    h.advance(10000); await h.controller.tick(); await h.flush();
    expect(h.voice.speak).not.toHaveBeenCalled(); expect(h.fetcher).toHaveBeenCalledTimes(2);
    h.controller.stop();
  });
  it('cancels a prepared question when participant speech resumes', async () => {
    const h = harness(); await h.controller.start();
    h.controller.acceptTranscript('Launch next month.', false); await h.flush(); h.advance(10000);
    let prepared!: import('@/lib/audio/speech').SpeakOptions;
    let finish!: (value: boolean) => void;
    h.voice.speak.mockImplementationOnce(async (_text, options) => { prepared = options; return new Promise(resolve => { finish = resolve; }); });
    await h.controller.tick(); await h.flush(); expect(prepared).toBeDefined();
    h.controller.onVoice();
    expect(prepared.shouldStart?.()).toBe(false); expect(h.snapshot.suppressCapture).toBe(false);
    finish(false); await h.flush(); expect(h.snapshot.asked).toEqual([]); h.controller.stop();
  });
  it('suppresses capture before actual playback, ignores AI echo, then returns to listening', async () => {
    const h = harness(); await h.controller.start(); h.controller.acceptTranscript('Launch next month.', false); await h.flush();
    h.voice.speak.mockImplementationOnce(async (_text, options) => {
      expect(options.shouldStart?.()).toBe(true); options.onBeforeStart?.();
      expect(h.snapshot.suppressCapture).toBe(true); options.onStart?.();
      h.controller.acceptTranscript('AI echo', false); h.controller.onVoice();
      expect(h.snapshot.transcript).toBe('Launch next month.'); return true;
    });
    h.advance(10000); await h.controller.tick(); await h.flush();
    expect(h.snapshot.suppressCapture).toBe(false); expect(h.snapshot.status).toBe('listening'); h.controller.stop();
  });
  it('keeps useful questions readable when voice is off and blocks all speech while paused', async () => {
    const h = harness(); await h.controller.start(); h.controller.setVoiceEnabled(false);
    h.controller.acceptTranscript('Launch next month.', false); await h.flush();
    h.advance(10000); await h.controller.tick(); await h.flush();
    expect(h.voice.speak).not.toHaveBeenCalled(); expect(h.snapshot.question).toBe(gap.question);
    expect(h.snapshot.questionHistory[0].disposition).toBe('suggested');
    h.controller.setPaused(true); h.controller.setVoiceEnabled(true);
    h.controller.acceptTranscript('Uncaptured paused speech', false); await h.controller.tick(); await h.flush();
    expect(h.voice.speak).not.toHaveBeenCalled(); expect(h.snapshot.transcript).toBe('Launch next month.');
    h.controller.setPaused(false); h.controller.setEnabled(false); h.controller.stop();
  });
  it('AI and TTS failures leave recording active and readable questions intact', async () => {
    const h = harness(); await h.controller.start();
    h.fetcher.mockImplementationOnce(async () => new Response(null, { status: 502 }));
    h.controller.acceptTranscript('Launch next month.', false); await h.flush();
    expect(h.snapshot.active).toBe(true); expect(h.snapshot.notice).toContain('Recording continues');
    h.advance(21000); h.voice.speak.mockResolvedValue(false); await h.controller.tick(); await h.flush();
    await h.controller.tick(); await h.flush();
    expect(h.snapshot.active).toBe(true); expect(h.snapshot.notice).toContain('voice'); expect(h.snapshot.question).toBe(gap.question);
    h.controller.stop();
  });
  it('ignores analysis responses arriving after resumed speech or stop; final notes never speak', async () => {
    const h = harness(); await h.controller.start();
    let complete!: (response: Response) => void;
    h.fetcher.mockImplementationOnce(async () => new Promise(resolve => { complete = resolve; }));
    h.controller.acceptTranscript('Launch next month.', false); await h.flush();
    h.controller.acceptTranscript('Launch next month. Specifically', true);
    complete(Response.json(gap)); await h.flush(); expect(h.snapshot.question).toBe('');
    h.advance(9000); h.fetcher.mockImplementationOnce(async () => new Promise(resolve => { complete = resolve; }));
    h.controller.acceptTranscript('Launch next month. Specifically November.', false); await h.flush();
    h.controller.stop(); complete(Response.json(gap)); await h.flush(); expect(h.snapshot.question).toBe('');
    expect(h.voice.speak).not.toHaveBeenCalled();
    h.fetcher.mockImplementation(async () => Response.json(gap)); await h.controller.finalize('Deadline November 15.');
    expect(h.snapshot.notes).toBe(gap.notes); expect(h.voice.speak).not.toHaveBeenCalled();
  });
  it('retries session connection without coupling it to microphone capture', async () => {
    const h = harness(); h.fetcher.mockImplementationOnce(async () => new Response(null, { status: 502 }));
    await h.controller.start(); h.controller.acceptTranscript('Launch next month.', false);
    expect(h.snapshot.active).toBe(true); expect(h.snapshot.transcript).toContain('Launch');
    h.advance(16000); await h.controller.tick(); await h.flush();
    expect(h.snapshot.question).toBe(gap.question); expect(h.fetcher.mock.calls.filter(([url]) => url === '/api/session')).toHaveLength(2);
    h.controller.stop();
  });
  it('retries failed final notes and refreshes them when the transcript is edited', async () => {
    const h = harness(); h.fetcher.mockImplementationOnce(async () => new Response(null, { status: 502 }));
    await h.controller.finalize('Initial transcript.'); expect(h.snapshot.notice).toContain('temporarily unavailable');
    await h.controller.finalize('Initial transcript.'); expect(h.snapshot.notes).toBe(gap.notes);
    h.fetcher.mockImplementationOnce(async (_url, options) => Response.json({ ...gap, notes: `Updated from: ${JSON.parse(options!.body as string).transcript}` }));
    await h.controller.finalize('Edited transcript.'); expect(h.snapshot.notes).toBe('Updated from: Edited transcript.');
    expect(h.fetcher.mock.calls.filter(([url]) => url === '/api/interruption')).toHaveLength(3); h.controller.stop();
  });
});

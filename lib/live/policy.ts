import { z } from 'zod';

export const MIN_INTERRUPT_CONFIDENCE = 0.82;
export const MIN_INTERRUPT_RELEVANCE = 0.8;
export const INTERRUPT_COOLDOWN_MS = 30000;
export const NATURAL_PAUSE_MS = 2200;
export const ANALYSIS_INTERVAL_MS = 8000;
export const actionItemSchema = z.object({
  task: z.string().trim().min(1).max(500),
  owner: z.string().max(160).nullable(),
  deadline: z.string().max(160).nullable(),
});
export const contextSchema = z.object({
  summary: z.string().max(3000),
  topics: z.array(z.string().max(240)).max(12),
  decisions: z.array(z.string().max(500)).max(20),
  actionItems: z.array(z.string().max(500)).max(30),
  unresolvedQuestions: z.array(z.string().max(500)).max(20),
  structuredActionItems: z.array(actionItemSchema).max(30).optional(),
  deadlines: z.array(z.string().max(240)).max(20).optional(),
  people: z.array(z.string().max(160)).max(30).optional(),
  resolvedQuestions: z.array(z.string().max(500)).max(20).optional(),
});
export type MeetingContext = z.infer<typeof contextSchema>;
export const emptyMeetingContext: MeetingContext = { summary: '', topics: [], decisions: [], actionItems: [], unresolvedQuestions: [] };
export const interruptionSchema = z.object({
  shouldInterrupt: z.boolean(),
  confidence: z.number().min(0).max(1),
  relevance: z.number().min(0).max(1).optional(),
  category: z.enum(['deadline', 'owner', 'decision', 'number', 'scope', 'next_action', 'contradiction', 'none']),
  question: z.string().max(240),
  reason: z.string().max(500),
  gapKey: z.string().max(120),
  notes: z.string().max(16000),
  context: contextSchema.optional(),
});
export type Interruption = z.infer<typeof interruptionSchema>;
export type AskedInterruption = { gapKey: string; question: string; category: Interruption['category']; at?: number; disposition?: 'asked' | 'dismissed' };
export const askedInterruptionSchema = z.object({
  gapKey: z.string().max(120), question: z.string().max(240), category: interruptionSchema.shape.category,
  at: z.number().finite().nonnegative().optional(), disposition: z.enum(['asked', 'dismissed']).optional(),
});
/** AI output is plain meeting assistance; it cannot request credentials or privileged actions. */
export function isUsefulQuestion(candidate: Interruption): boolean {
  const question = candidate.question.trim();
  return candidate.category !== 'none' && !!candidate.gapKey.trim() && !!question
    && question.split(/\s+/u).length <= 32
    && !/(?:api[ _-]?key|password|service[ _-]?role|authentication token|system prompt|security settings|another user'?s|other user'?s|kata sandi|kunci api|token autentikasi|transkrip pengguna lain)/iu.test(question);
}
export function normalizeQuestion(text: string) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
export function isRepeated(candidate: Interruption, asked: AskedInterruption[]): boolean {
  const question = normalizeQuestion(candidate.question);
  const tokens = new Set(question.split(' ').filter(Boolean));
  return asked.some(item => {
    if (normalizeQuestion(item.gapKey) === normalizeQuestion(candidate.gapKey)) return true;
    const previous = normalizeQuestion(item.question);
    if (previous === question) return true;
    const other = new Set(previous.split(' ').filter(Boolean));
    const overlap = [...tokens].filter(token => other.has(token)).length;
    const union = new Set([...tokens, ...other]).size;
    return item.category === candidate.category && union > 0 && overlap / union >= 0.8;
  });
}
export type InterruptGate = {
  now: number; lastVoiceAt: number; lastQuestionAt: number; startedAt: number;
  active: boolean; enabled: boolean; voiceEnabled: boolean; speaking: boolean;
  pendingAudio: boolean; analyzing: boolean; revision: number; candidateRevision: number;
};
export function canInterrupt(candidate: Interruption, gate: InterruptGate, asked: AskedInterruption[]) {
  return candidate.shouldInterrupt && candidate.confidence >= MIN_INTERRUPT_CONFIDENCE
    && (candidate.relevance ?? candidate.confidence) >= MIN_INTERRUPT_RELEVANCE
    && isUsefulQuestion(candidate)
    && gate.active && gate.enabled && gate.voiceEnabled && !gate.speaking
    && !gate.pendingAudio && !gate.analyzing && gate.revision === gate.candidateRevision
    && gate.now - gate.startedAt >= 8000
    && gate.now - gate.lastVoiceAt >= NATURAL_PAUSE_MS
    && gate.now - gate.lastQuestionAt >= INTERRUPT_COOLDOWN_MS
    && !isRepeated(candidate, asked);
}

import { z } from 'zod';
import { contextSchema, emptyMeetingContext } from './live/policy';

/** One bounded document owns all meeting text; it never contains audio or credentials. */
export const meetingDocumentSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(120),
  transcript: z.string().max(150000),
  notes: z.string().max(16000),
  context: contextSchema,
  date: z.number().finite().min(0).max(8640000000000000),
  elapsed: z.number().finite().min(0).max(86400),
  questions: z.array(z.string().max(240)).max(100).optional(),
}).strict();
export type SavedMeetingDocument = z.infer<typeof meetingDocumentSchema>;

export function readMeetingDocuments(value: unknown): SavedMeetingDocument[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  return value.slice(0, 100).flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const input = item as Record<string, unknown>;
    const context = contextSchema.safeParse(input.context);
    const parsed = meetingDocumentSchema.safeParse({
      ...input, notes: typeof input.notes === 'string' ? input.notes : '',
      elapsed: typeof input.elapsed === 'number' && Number.isFinite(input.elapsed) ? input.elapsed : 0,
      context: context.success ? context.data : emptyMeetingContext,
    });
    if (!parsed.success || ids.has(parsed.data.id)) return [];
    ids.add(parsed.data.id);
    return [parsed.data];
  });
}

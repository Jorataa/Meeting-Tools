import { z } from 'zod';
import { accessToken, serverSupabase, verifiedRequestIdentity } from '@/lib/auth/server';
import { sameOrigin, rateLimit } from '@/lib/server-session';
import { boundedText, BodyTooLarge } from '@/lib/bounded-text';
import { meetingDocumentSchema, readMeetingDocuments } from '@/lib/meeting-document';
import { securityLog } from '@/lib/security/log';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store' };
const failure = (error: string, status: number) => Response.json({ error }, { status, headers });
async function connection(request: Request, mutate: boolean) {
  if (mutate && !sameOrigin(request)) return failure('Request not allowed.', 403);
  const identity = await verifiedRequestIdentity();
  if (!identity) { securityLog('meeting.auth_rejected', { route: '/api/meetings', status: 401 }); return failure('Sign in to access your meetings.', 401); }
  if (!rateLimit(`meetings:${identity.id}`, 120)) return failure('Please wait before trying again.', 429);
  const token = await accessToken();
  const client = token ? serverSupabase(token) : null;
  if (!client) return failure('Meeting storage is unavailable.', 503);
  return { identity, client };
}
export async function GET(request: Request) {
  const result = await connection(request, false); if (result instanceof Response) return result;
  try {
    // Explicit predicate and RLS both apply. No service role, even on the server.
    const { data, error } = await result.client.from('hush_meetings').select('document').eq('user_id', result.identity.id).order('started_at', { ascending: false }).limit(100);
    if (error) throw new Error('Storage unavailable');
    return Response.json({ meetings: readMeetingDocuments(data.map(row => row.document)) }, { headers });
  } catch { securityLog('meeting.load_failed', { route: '/api/meetings', status: 503 }); return failure('Your meeting history could not load. Please retry.', 503); }
}
export async function PUT(request: Request) {
  const result = await connection(request, true); if (result instanceof Response) return result;
  try {
    const document = meetingDocumentSchema.parse(JSON.parse(await boundedText(request, 220000)));
    // Ownership comes exclusively from verified identity. Unknown client fields are rejected.
    const { error } = await result.client.from('hush_meetings').upsert({
      id: document.id, user_id: result.identity.id, title: document.title,
      started_at: new Date(document.date).toISOString(), duration: Math.floor(document.elapsed),
      document, updated_at: new Date().toISOString(),
    }, { onConflict: 'id' });
    if (error) throw new Error('Save rejected');
    return Response.json({ saved: true }, { headers });
  } catch (error) {
    if (error instanceof BodyTooLarge) return failure('This meeting is too large to save.', 413);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return failure('Meeting content is invalid.', 400);
    securityLog('meeting.save_failed', { route: '/api/meetings', status: 503 }); return failure('This meeting could not be saved to your account. Your device copy is available.', 503);
  }
}
export async function DELETE(request: Request) {
  const result = await connection(request, true); if (result instanceof Response) return result;
  try {
    const input = z.union([z.object({ id: z.string().uuid() }).strict(), z.object({ all: z.literal(true), confirmation: z.literal('delete-all-meetings') }).strict()]).parse(JSON.parse(await boundedText(request, 256)));
    let query = result.client.from('hush_meetings').delete().eq('user_id', result.identity.id);
    if ('id' in input) query = query.eq('id', input.id);
    const { error } = await query;
    if (error) throw new Error('Deletion unavailable');
    return Response.json({ deleted: true }, { headers });
  } catch (error) {
    if (error instanceof BodyTooLarge) return failure('Request is too large.', 413);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return failure('Confirm the meeting deletion before continuing.', 400);
    securityLog('meeting.delete_failed', { route: '/api/meetings', status: 503 }); return failure('Deletion could not complete. Please retry.', 503);
  }
}

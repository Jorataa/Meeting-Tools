import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/server', () => ({ verifiedRequestIdentity: vi.fn(), accessToken: vi.fn(async () => 'test-access'), serverSupabase: vi.fn() }));
vi.mock('@/lib/server-session', () => ({ sameOrigin: vi.fn(() => true), rateLimit: vi.fn(() => true) }));
import { GET, PUT, DELETE } from '@/app/api/meetings/route';
import { accessToken, serverSupabase, verifiedRequestIdentity } from '@/lib/auth/server';
import { sameOrigin, rateLimit } from '@/lib/server-session';
import { meetingDocumentSchema, readMeetingDocuments } from '@/lib/meeting-document';

const owner = '11111111-1111-4111-8111-111111111111';
const document = { id: '22222222-2222-4222-8222-222222222222', title: 'Private planning', transcript: 'Rina deploys Friday.', notes: 'Rina owns deployment.', date: 1000, elapsed: 10, context: { summary: 'Launch Friday.', topics: [], decisions: [], actionItems: [], unresolvedQuestions: [] }, questions: ['Which Friday?'] };
const req = (method: string, body?: unknown, origin = 'http://localhost:3000') => new Request('http://localhost:3000/api/meetings', { method, headers: { Origin: origin, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
let query: Record<string, ReturnType<typeof vi.fn>>;
let from: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.mocked(verifiedRequestIdentity).mockResolvedValue({ id: owner, email: 'owner@example.test' });
  vi.mocked(accessToken).mockResolvedValue('test-access'); vi.mocked(sameOrigin).mockReturnValue(true); vi.mocked(rateLimit).mockReturnValue(true);
  query = Object.fromEntries(['select', 'eq', 'order', 'delete'].map(name => [name, vi.fn()]));
  Object.values(query).forEach(mock => mock.mockReturnValue(query));
  query.limit = vi.fn(async () => ({ data: [{ document }], error: null }));
  query.upsert = vi.fn(async () => ({ error: null }));
  from = vi.fn(() => query);
  vi.mocked(serverSupabase).mockReturnValue({ from } as never);
});
afterEach(() => vi.clearAllMocks());
describe('private meeting API', () => {
  it.each(['GET', 'PUT', 'DELETE'])('rejects unauthenticated %s without touching storage', async method => {
    vi.mocked(verifiedRequestIdentity).mockResolvedValue(null);
    const result = method === 'GET' ? await GET(req(method)) : method === 'PUT' ? await PUT(req(method, document)) : await DELETE(req(method, { id: document.id }));
    expect(result.status).toBe(401); expect(from).not.toHaveBeenCalled();
  });
  it('reads only the verified account and uses its RLS token', async () => {
    const response = await GET(req('GET'));
    expect(await response.json()).toEqual({ meetings: [document] });
    expect(query.eq).toHaveBeenCalledWith('user_id', owner);
    expect(serverSupabase).toHaveBeenCalledWith('test-access');
  });
  it('derives owner server-side and rejects client identity injection', async () => {
    expect((await PUT(req('PUT', { ...document, user_id: 'another-user' }))).status).toBe(400);
    expect(query.upsert).not.toHaveBeenCalled();
    expect((await PUT(req('PUT', document))).status).toBe(200);
    expect(query.upsert.mock.calls[0][0]).toMatchObject({ id: document.id, user_id: owner, document });
  });
  it('cannot transfer a row owned by another account, and sanitizes database errors', async () => {
    query.upsert.mockResolvedValue({ error: { message: 'secret database internals', code: '42501' } });
    const response = await PUT(req('PUT', document));
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('secret database');
  });
  it('deletes using both owner and ID; bulk deletion requires explicit confirmation', async () => {
    expect((await DELETE(req('DELETE', { all: true }))).status).toBe(400);
    expect(query.delete).not.toHaveBeenCalled();
    expect((await DELETE(req('DELETE', { id: document.id }))).status).toBe(200);
    expect(query.eq).toHaveBeenCalledWith('user_id', owner); expect(query.eq).toHaveBeenCalledWith('id', document.id);
  });
  it('rejects foreign origins, rate limit abuse, executable fields, and large bodies', async () => {
    vi.mocked(sameOrigin).mockReturnValueOnce(false); expect((await PUT(req('PUT', document))).status).toBe(403);
    vi.mocked(rateLimit).mockReturnValueOnce(false); expect((await GET(req('GET'))).status).toBe(429);
    expect((await PUT(req('PUT', { ...document, execute: 'delete all users' }))).status).toBe(400);
    expect((await PUT(req('PUT', { ...document, transcript: 'x'.repeat(220001) }))).status).toBe(413);
    expect(query.upsert).not.toHaveBeenCalled();
  });
});
describe('bounded meeting documents', () => {
  it('validates context, owners, deadlines and questions without HTML execution', () => {
    const value = { ...document, notes: '<img src=x onerror=alert(1)>', context: { ...document.context, structuredActionItems: [{ task: 'Deploy', owner: 'Rina', deadline: 'Friday' }], people: ['Rina'], deadlines: ['Friday'] } };
    expect(meetingDocumentSchema.parse(value)).toEqual(value);
  });
  it('rejects oversized/malformed records and duplicate IDs from device storage', () => {
    expect(readMeetingDocuments([document, document, { ...document, transcript: 'x'.repeat(150001) }, { id: 'invalid' }])).toEqual([document]);
    expect(meetingDocumentSchema.safeParse({ ...document, context: { ...document.context, structuredActionItems: [{ task: 'Deploy', owner: 7, deadline: null }] } }).success).toBe(false);
  });
});

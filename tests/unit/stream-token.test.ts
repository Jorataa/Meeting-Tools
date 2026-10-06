import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
vi.mock('@/lib/ai/config',()=>({geminiKeys:()=>['permanent-server-key']}));
vi.mock('@/lib/security/log',()=>({securityLog:vi.fn()}));
import {createTranscriptionToken,ephemeralLiveTransport} from '@/lib/live/transcription-token';
let fetcher:ReturnType<typeof vi.fn>;
beforeEach(()=>{fetcher=vi.fn(async()=>Response.json({name:'scoped-credential'}));vi.stubGlobal('fetch',fetcher);vi.stubEnv('GEMINI_LIVE_TRANSPORT','');vi.stubEnv('VERCEL','');vi.stubEnv('GEMINI_LIVE_MODEL','gemini-3.5-transcribe-live');});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe('server-only live token provisioning',()=>{
 it('locks complete transcription setup, single use, 60sec creation and16min expiry',async()=>{
  const now=Date.now(),data=await createTranscriptionToken();const request=fetcher.mock.calls[0][1];const body=JSON.parse(request.body);
  expect(request.headers['x-goog-api-key']).toBe('permanent-server-key');expect(body.uses).toBe(1);expect(body.fieldMask).toBeUndefined();expect(body.bidiGenerateContentSetup).toEqual(data.setup);
  expect(body.bidiGenerateContentSetup.tools).toBeUndefined();expect(Date.parse(body.newSessionExpireTime)-now).toBeLessThanOrEqual(60100);expect(Date.parse(body.expireTime)-now).toBeGreaterThanOrEqual(16*60000);expect(Date.parse(body.expireTime)-now).toBeLessThan(16*60000+100);
  expect(JSON.stringify(data)).not.toContain('permanent-server-key');expect(data.token).toBe('scoped-credential');
 });
 it('selects constrained direct transport onVercel and permits explicit relay compatibility',()=>{
  vi.stubEnv('VERCEL','1');expect(ephemeralLiveTransport()).toBe(true);vi.stubEnv('GEMINI_LIVE_TRANSPORT','relay');expect(ephemeralLiveTransport()).toBe(false);vi.stubEnv('VERCEL','');vi.stubEnv('GEMINI_LIVE_TRANSPORT','ephemeral');expect(ephemeralLiveTransport()).toBe(true);
 });
 it('does not disclose upstream errors or API keys',async()=>{
  fetcher.mockResolvedValue(Response.json({error:{message:'permanent-server-key'}},{status:403}));await expect(createTranscriptionToken()).rejects.toThrow('Check Gemini model access');
 });
 it('rejects malformed or oversize credentials safely',async()=>{
  fetcher.mockResolvedValue(Response.json({name:'a'.repeat(8193)}));await expect(createTranscriptionToken()).rejects.toThrow('Live transcription could not connect');
 });
});

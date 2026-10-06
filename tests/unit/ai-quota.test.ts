import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({mode:vi.fn(),token:vi.fn(),rpc:vi.fn(),client:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/auth/server',()=>({authMode:mocks.mode,accessToken:mocks.token,serverSupabase:mocks.client}));
import {enforceAiQuota} from '@/lib/security/ai-quota';
beforeEach(()=>{vi.clearAllMocks();mocks.mode.mockReturnValue('supabase');mocks.token.mockResolvedValue('private-token');mocks.client.mockReturnValue({rpc:mocks.rpc});});
describe('shared account AI quotas',()=>{
 it('does not require a database for explicitly configured demo',async()=>{mocks.mode.mockReturnValue('demo');expect(await enforceAiQuota('transcribe')).toBeNull();expect(mocks.rpc).not.toHaveBeenCalled();});
 it('uses the user token and a fixed server-selected scope',async()=>{mocks.rpc.mockResolvedValue({data:true,error:null});expect(await enforceAiQuota('interruption')).toBeNull();expect(mocks.client).toHaveBeenCalledWith('private-token');expect(mocks.rpc).toHaveBeenCalledWith('hush_consume_ai_quota',{requested_scope:'interruption'});});
 it('rejects account quota exhaustion with retry metadata',async()=>{mocks.rpc.mockResolvedValue({data:false,error:null});const response=await enforceAiQuota('ask');expect(response?.status).toBe(429);expect(response?.headers.get('Retry-After')).toBe('60');});
 it('fails closed if the shared quota schema is missing',async()=>{mocks.rpc.mockResolvedValue({data:null,error:{message:'private upstream details'}});const response=await enforceAiQuota('live-create');expect(response?.status).toBe(503);expect(await response?.text()).not.toContain('private upstream details');});
 it('fails closed for malformed responses or missing user tokens',async()=>{mocks.rpc.mockResolvedValue({data:'true',error:null});expect((await enforceAiQuota('voice'))?.status).toBe(503);mocks.token.mockResolvedValue(null);expect((await enforceAiQuota('voice'))?.status).toBe(401);});
});

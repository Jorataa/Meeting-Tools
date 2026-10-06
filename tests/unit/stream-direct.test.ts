import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {DirectTranscription,type TranscriptionCredential} from '@/lib/live/transcription-direct';
class FakeSocket extends EventTarget {
 static OPEN=1;static instances:FakeSocket[]=[];
 readyState=0;bufferedAmount=0;sent:string[]=[];
 constructor(readonly url:string){super();FakeSocket.instances.push(this);}
 send(value:string){this.sent.push(value);}
 close(){this.readyState=3;this.dispatchEvent(new Event('close'));}
 open(){this.readyState=1;this.dispatchEvent(new Event('open'));}
 message(value:unknown){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(value)}));}
}
const credential=():TranscriptionCredential=>({transport:'ephemeral',token:'short-lived-test-token',expiresAt:Date.now()+16*60000,setup:{model:'models/gemini-3.5-transcribe-live',generationConfig:{responseModalities:['TEXT']},inputAudioTranscription:{languageCodes:[]}}});
type TestEvent={type:string;text?:string;id?:string;at?:number;status?:string;notice?:string};
let direct:DirectTranscription;let emit:ReturnType<typeof vi.fn<(event:TestEvent)=>void>>;let provision:ReturnType<typeof vi.fn<()=>Promise<TranscriptionCredential>>>;let drain:ReturnType<typeof vi.fn<()=>void>>;
const settle=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-06T10:00:00Z'));FakeSocket.instances=[];vi.stubGlobal('WebSocket',FakeSocket);emit=vi.fn();provision=vi.fn(async()=>credential());drain=vi.fn();direct=new DirectTranscription(emit,provision,drain);});
afterEach(()=>{direct.cancel();vi.unstubAllGlobals();vi.useRealTimers();});
async function start(){const task=direct.start(credential());const socket=FakeSocket.instances.at(-1)!;socket.open();socket.message({setupComplete:{}});await task;return socket;}
describe('constrained direct Gemini transport',()=>{
 it('uses a scoped token and immutable setup, waits for setup before sending actual PCM',async()=>{
  const task=direct.start(credential());const socket=FakeSocket.instances[0];expect(direct.send(new Uint8Array([1,2]))).toBe(false);
  expect(socket.url).toContain('BidiGenerateContentConstrained?access_token=short-lived-test-token');expect(socket.url).not.toContain('?key=');
  socket.open();expect(JSON.parse(socket.sent[0])).toEqual({setup:credential().setup});socket.message({setupComplete:{}});await task;
  expect(direct.send(new Uint8Array([1,2]))).toBe(true);expect(JSON.parse(socket.sent[1])).toEqual({realtimeInput:{audio:{data:'AQI=',mimeType:'audio/pcm;rate=16000'}}});
 });
 it('preserves partial words, finalizes with unique IDs and timestamps across sequential utterances',async()=>{
  const socket=await start();socket.message({serverContent:{interimInputTranscription:{text:'Today'}}});socket.message({serverContent:{interimInputTranscription:{text:'Today we need'}}});socket.message({serverContent:{interimInputTranscription:{text:''}}});
  socket.message({serverContent:{inputTranscription:{text:'Today we need.'}}});socket.message({serverContent:{inputTranscription:{text:'Today we need.'}}});
  expect(emit.mock.calls.filter(([e])=>e.type==='partial').map(([e])=>e.text)).toEqual(['Today','Today we need']);
  const finals=emit.mock.calls.filter(([e])=>e.type==='final').map(([e])=>e);expect(finals).toHaveLength(2);expect(finals[0].id).not.toEqual(finals[1].id);expect(finals[0].at).toBe(0);
 });
 it('applies bounded WebSocket backpressure and drains every100ms',async()=>{
  const socket=await start();socket.bufferedAmount=96001;expect(direct.send(new Uint8Array([1,2]))).toBe(false);socket.bufferedAmount=0;
  await vi.advanceTimersByTimeAsync(100);expect(drain).toHaveBeenCalledTimes(2);expect(direct.send(new Uint8Array([1,2]))).toBe(true);
 });
 it('reconnects with a fresh single-use token and never replays acknowledged audio',async()=>{
  const socket=await start();direct.send(new Uint8Array([1,2]));socket.close();await vi.advanceTimersByTimeAsync(300);await settle();expect(provision).toHaveBeenCalledOnce();
  const second=FakeSocket.instances[1];second.open();second.message({setupComplete:{}});expect(second.sent).toHaveLength(1);expect(emit).toHaveBeenCalledWith(expect.objectContaining({status:'reconnecting'}));
 });
 it('reconnects after sustained WebSocket backpressure instead of silently stalling audio',async()=>{
  const socket=await start();socket.bufferedAmount=96001;expect(direct.send(new Uint8Array([1,2]))).toBe(false);await vi.advanceTimersByTimeAsync(5001);
  expect(direct.send(new Uint8Array([1,2]))).toBe(false);expect(socket.readyState).toBe(3);await vi.advanceTimersByTimeAsync(300);expect(provision).toHaveBeenCalledOnce();
 });
 it('keeps paused audio private and reconnects only when the user resumes',async()=>{
  const socket=await start();direct.setPaused(true);expect(JSON.parse(socket.sent.at(-1)!)).toEqual({realtimeInput:{audioStreamEnd:true}});socket.close();await vi.advanceTimersByTimeAsync(3000);expect(provision).not.toHaveBeenCalled();
  direct.setPaused(false);await vi.advanceTimersByTimeAsync(0);await settle();expect(provision).toHaveBeenCalledOnce();
 });
 it('renews before token expiry and preserves prior finalized transcript state',async()=>{
  const socket=await start();socket.message({serverContent:{inputTranscription:{text:'Saved.'}}});await vi.advanceTimersByTimeAsync(15*60000+300);expect(provision).toHaveBeenCalledOnce();expect(emit.mock.calls.filter(([e])=>e.type==='final')).toHaveLength(1);
 });
 it('waits for the provider final on stop and cancels all resources',async()=>{
  const socket=await start();const finishing=direct.finish();socket.message({serverContent:{inputTranscription:{text:'Last words.'}}});await finishing;direct.cancel();expect(vi.getTimerCount()).toBe(0);expect(socket.readyState).toBe(3);
 });
 it('returns sanitized errors after reconnect exhaustion without disclosing credentials',async()=>{
  const socket=await start();provision.mockRejectedValue(new Error('private-token-and-api-key'));socket.close();await vi.advanceTimersByTimeAsync(20000);
  expect(emit).toHaveBeenCalledWith(expect.objectContaining({status:'error',notice:expect.stringContaining('could not reconnect')}));expect(JSON.stringify(emit.mock.calls)).not.toContain('private-token');
 });
});

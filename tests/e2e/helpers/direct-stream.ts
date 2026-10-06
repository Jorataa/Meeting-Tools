import type {Page} from '@playwright/test';

/** Actual browser capture with a constrained provider fixture; permanent keys never enter it. */
export async function mockDirectStream(page:Page) {
 await page.addInitScript(()=>{
  let current:ProviderSocket|undefined;
  const state={connected:false,connections:0,frames:0,bytes:0,nonzero:false,
   emit(type:'partial'|'final',text:string){current?.message({serverContent:{[type==='partial'?'interimInputTranscription':'inputTranscription']:{text}}});},
   disconnect(){current?.close();},
  };
  const OriginalWebSocket = window.WebSocket;
  class ProviderSocket extends EventTarget {
   static OPEN=1;static CONNECTING=0;static CLOSED=3;static CLOSING=2;
   readyState=0;bufferedAmount=0;binaryType='blob';
   constructor(readonly url:string|URL){
    super();
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    current=this;state.connections++;
    queueMicrotask(()=>{this.readyState=1;this.dispatchEvent(new Event('open'));});
   }
   send(raw:string){
    const value=JSON.parse(raw);
    if(value.setup){state.connected=true;queueMicrotask(()=>this.message({setupComplete:{}}));}
    if(value.realtimeInput?.audio){
     const bytes=atob(value.realtimeInput.audio.data);state.frames++;state.bytes+=bytes.length;state.nonzero||=[...bytes].some(byte=>byte.charCodeAt(0)!==0);
    }
   }
   message(value:unknown){if(this.readyState===1)this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(value)}));}
   close(){if(this.readyState===3)return;this.readyState=3;state.connected=false;this.dispatchEvent(new CloseEvent('close',{code:1000}));}
  }
  (window as unknown as {testDirect:typeof state}).testDirect=state;
  const SocketProxy = function(url: string | URL, protocols?: string | string[]) {
   if (String(url).includes('generativelanguage.googleapis.com')) {
    return new ProviderSocket(url);
   }
   return new OriginalWebSocket(url, protocols);
  };
  SocketProxy.OPEN = 1; SocketProxy.CONNECTING = 0; SocketProxy.CLOSING = 2; SocketProxy.CLOSED = 3;
  window.WebSocket = SocketProxy as unknown as typeof WebSocket;
 });
 await page.route('**/api/auth',route=>route.fulfill({json:{mode:'demo',user:null}}));
 await page.route('**/api/session',route=>route.fulfill({json:{ai:true}}));
 await page.route('**/api/live/stream',route=>{
  if(route.request().method()==='POST'&&!route.request().url().includes('?id=')){
   return route.fulfill({json:{
    transport:'ephemeral',token:'single-use-scoped-fixture',expiresAt:Date.now()+16*60000,
    setup:{model:'models/gemini-3.5-transcribe-live',generationConfig:{responseModalities:['TEXT']},inputAudioTranscription:{languageCodes:[]}},
   }});
  }
  return route.continue();
 });
 await page.route('**/api/interruption',route=>route.fulfill({json:{shouldInterrupt:false,confidence:0,category:'none',question:'',reason:'',gapKey:'',notes:''}}));
}

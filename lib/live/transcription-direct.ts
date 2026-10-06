'use client';

export type TranscriptionCredential = {
 transport:'ephemeral'; token:string; expiresAt:number;
 setup:{model:string;generationConfig:{responseModalities:string[]};inputAudioTranscription:{languageCodes:string[]}};
};
type Event = {type:'ready'|'partial'|'final'|'status';text?:string;at?:number;id?:string;status?:'connecting'|'listening'|'reconnecting'|'error';notice?:string};
const endpoint = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained';

/** Transport adapter for serverless hosting. Capture and AI analysis remain separate. */
export class DirectTranscription {
 private socket?:WebSocket;
 private ready=false;
 private cancelled=false;
 private stopping=false;
 private paused=false;
 private retries=0;
 private sequence=0;
 private sawPartial=false;
 private utteranceAt=0;
 private startedAt=Date.now();
 private writableAt=Date.now();
 private id=crypto.randomUUID();
 private retryTimer?:ReturnType<typeof setTimeout>;
 private setupTimer?:ReturnType<typeof setTimeout>;
 private startTimer?:ReturnType<typeof setTimeout>;
 private renewalTimer?:ReturnType<typeof setTimeout>;
 private drainTimer?:ReturnType<typeof setInterval>;
 private resolveStart?:()=>void;
 private rejectStart?:(error:Error)=>void;
 private finalReceived?:()=>void;
 constructor(private emit:(event:Event)=>void,private provision:()=>Promise<TranscriptionCredential>,private drain:()=>void) {}
 start(credential:TranscriptionCredential):Promise<void> {
  this.drainTimer=setInterval(()=>this.drain(),100);
  return new Promise((resolve,reject)=>{
   this.resolveStart=resolve;this.rejectStart=reject;
   this.startTimer=setTimeout(()=>{reject(new Error('Live transcription did not connect in time. Check your connection and Gemini model access.'));this.cancel();},20000);
   this.connect(credential);
  });
 }
 send(audio:Uint8Array):boolean {
  if(this.paused||!this.ready||this.socket?.readyState!==WebSocket.OPEN)return false;
  if(this.socket.bufferedAmount>96000){if(Date.now()-this.writableAt>5000)this.socket.close();return false;}
  try {
   let binary='';for(const byte of audio)binary+=String.fromCharCode(byte);
   this.socket.send(JSON.stringify({realtimeInput:{audio:{data:btoa(binary),mimeType:'audio/pcm;rate=16000'}}}));this.writableAt=Date.now();return true;
  }catch{this.socket.close();return false;}
 }
 setPaused(paused:boolean) {
  this.paused=paused;
  if(paused)this.boundary();
  else if(!this.ready&&!this.cancelled)this.scheduleReconnect(0);
 }
 async finish() {
  this.stopping=true;
  if(!this.ready)return;
  await new Promise<void>(resolve=>{
   const timeout=setTimeout(()=>{this.finalReceived=undefined;resolve();},2200);
   this.finalReceived=()=>{clearTimeout(timeout);this.finalReceived=undefined;resolve();};
   this.boundary();
  });
 }
 cancel() {
  if(this.cancelled)return;
  this.cancelled=true;this.ready=false;
  clearTimeout(this.retryTimer);clearTimeout(this.setupTimer);clearTimeout(this.startTimer);clearTimeout(this.renewalTimer);clearInterval(this.drainTimer);
  this.resolveStart?.();this.finalReceived?.();this.socket?.close();this.socket=undefined;
 }
 private boundary() {
  if(this.ready&&this.socket?.readyState===WebSocket.OPEN){try{this.socket.send(JSON.stringify({realtimeInput:{audioStreamEnd:true}}));}catch{this.socket.close();}}
 }
 private connect(credential:TranscriptionCredential) {
  if(this.cancelled||this.stopping)return;
  let socket:WebSocket;
  try{socket=new WebSocket(`${endpoint}?access_token=${encodeURIComponent(credential.token)}`);}catch{this.scheduleReconnect();return;}
  this.socket=socket;this.ready=false;
  this.setupTimer=setTimeout(()=>socket.close(),12000);
  socket.addEventListener('open',()=>{if(this.socket===socket&&!this.cancelled)socket.send(JSON.stringify({setup:credential.setup}));});
  // The credential is deliberately never copied to logs, storage, errors, or app state.
  socket.addEventListener('message',async event=>{
   if(this.socket!==socket||this.cancelled)return;
   try{
    const raw=typeof event.data==='string'?event.data:event.data instanceof Blob?await event.data.text():new TextDecoder().decode(event.data);
    if(raw.length>262144)throw new Error('Live response too large');
    if(this.socket!==socket||this.cancelled)return;
    const message=JSON.parse(raw);
    if(message.error){socket.close();return;}
    if(message.setupComplete!==undefined){
     clearTimeout(this.setupTimer);clearTimeout(this.startTimer);this.ready=true;this.writableAt=Date.now();this.retries=0;this.resolveStart?.();this.emit({type:'ready'});this.drain();
     // Renew before the provider's hard expiry. A fresh transcription session never
     // resends acknowledged audio, and the existing transcript stays in app state.
     this.renewalTimer=setTimeout(()=>socket.close(),Math.max(1000,credential.expiresAt-Date.now()-60000));
    }
    const content=message.serverContent;
    const partial=content?.interimInputTranscription?.text;
    if(typeof partial==='string'&&partial.trim()){
     if(!this.sawPartial)this.utteranceAt=Math.max(0,(Date.now()-this.startedAt)/1000-.3);
     this.sawPartial=true;this.emit({type:'partial',text:partial.trim(),at:this.utteranceAt});
    }
    const final=content?.inputTranscription?.text;
    if(typeof final==='string'&&final.trim()){
     this.emit({type:'final',text:final.trim(),at:this.sawPartial?this.utteranceAt:Math.max(0,(Date.now()-this.startedAt)/1000-1),id:`${this.id}:${++this.sequence}`});
     this.sawPartial=false;this.finalReceived?.();
    }
   }catch{this.emit({type:'status',status:'error',notice:'Live transcription returned an unreadable response. Your local recording is retained.'});socket.close();}
  });
  socket.addEventListener('error',()=>{});
  socket.addEventListener('close',()=>{
   if(this.socket!==socket||this.cancelled)return;
   this.ready=false;clearTimeout(this.setupTimer);clearTimeout(this.renewalTimer);
   if(!this.stopping&&!this.paused)this.scheduleReconnect();
  });
 }
 private scheduleReconnect(delay?:number) {
  if(this.cancelled||this.stopping||this.retryTimer)return;
  if(++this.retries>5){
   const error=new Error('Live transcription could not reconnect. Your transcript and local recording are retained. Stop and retry.');
   this.emit({type:'status',status:'error',notice:error.message});this.rejectStart?.(error);this.cancel();return;
  }
  this.emit({type:'status',status:'reconnecting',notice:'Reconnecting live transcription. Existing text is retained; there may be a brief gap.'});
  this.retryTimer=setTimeout(async()=>{
   this.retryTimer=undefined;
   try{const credential=await this.provision();if(!this.cancelled)this.connect(credential);}
   catch{this.scheduleReconnect();}
  },delay??Math.min(3000,300*2**(this.retries-1)));
 }
}

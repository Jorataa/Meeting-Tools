import {joinSamples} from './wav';
export type CaptureCallbacks={onLevel:(level:number,voice:boolean)=>void;onChunk:(samples:Int16Array,at:number,hasSpeech:boolean)=>void;onInterrupted:()=>void};
export class Microphone {
 private stream?:MediaStream;private context?:AudioContext;private node?:AudioWorkletNode;private source?:MediaStreamAudioSourceNode;private output?:GainNode;private timer?:ReturnType<typeof setInterval>;private frames:Int16Array[]=[];private count=0;private voice=false;private chunkAt=0;private paused=false;private closing=false;
 constructor(private callbacks:CaptureCallbacks){}
 async start(){
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('Microphone access needs a secure browser connection. Try Chrome, Edge, or Safari.');
  try {
   this.stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
   this.context=new AudioContext();await this.context.resume();await this.context.audioWorklet.addModule('/audio-worklet.js');
   this.source=this.context.createMediaStreamSource(this.stream);this.node=new AudioWorkletNode(this.context,'hush-capture');this.output=this.context.createGain();this.output.gain.value=0;
   this.source.connect(this.node);this.node.connect(this.output);this.output.connect(this.context.destination);
   this.node.port.onmessage=event=>this.receive(event.data);
   this.stream.getAudioTracks().forEach(track=>track.onended=()=>{if(!this.closing)this.callbacks.onInterrupted();});
   this.context.onstatechange=()=>{if(this.context?.state==='suspended'&&!this.paused&&!this.closing)this.callbacks.onInterrupted();};
   this.chunkAt=Date.now();this.timer=setInterval(()=>this.flush(),12000);
  }catch(error){await this.stop();throw error;}
 }
 private receive(frame:Float32Array){if(this.paused)return;let square=0;const pcm=new Int16Array(frame.length);for(let i=0;i<frame.length;i++){const sample=Math.max(-1,Math.min(1,frame[i]));square+=sample*sample;pcm[i]=Math.round(sample*32767);}const rms=Math.sqrt(square/frame.length);const voice=rms>.018;this.callbacks.onLevel(Math.min(1,rms*8),voice);this.voice||=voice;this.frames.push(pcm);this.count+=pcm.length;if(this.count>=16000*15)this.flush();}
 flush(){if(!this.count)return;const samples=joinSamples(this.frames);this.callbacks.onChunk(samples,this.chunkAt,this.voice);this.frames=[];this.count=0;this.voice=false;this.chunkAt=Date.now();}
 async setPaused(paused:boolean){if(paused){this.node?.port.postMessage('flush');await new Promise(r=>setTimeout(r,50));this.flush();}this.paused=paused;this.stream?.getAudioTracks().forEach(t=>{t.enabled=!paused;});if(!paused){this.chunkAt=Date.now();await this.context?.resume();}this.callbacks.onLevel(0,false);}
 hasUnprocessedSpeech(){return this.voice;}
 async stop(){this.closing=true;if(this.timer)clearInterval(this.timer);this.node?.port.postMessage('flush');await new Promise(r=>setTimeout(r,80));this.flush();this.stream?.getTracks().forEach(t=>t.stop());this.node?.disconnect();this.source?.disconnect();this.output?.disconnect();await this.context?.close();this.stream=undefined;this.context=undefined;}
}

// Capture mono PCM. Resampling maintains fractional position across render blocks.
class HushCapture extends AudioWorkletProcessor {
 constructor(){super();this.samples=[];this.position=0;this.last=0;this.port.onmessage=e=>{if(e.data==='flush')this.send();if(e.data==='discard')this.samples=[];};}
 send(){if(this.samples.length){const data=Float32Array.from(this.samples);this.port.postMessage(data,[data.buffer]);this.samples=[];}}
 process(inputs){const channels=inputs[0];if(!channels||!channels[0])return true;const n=channels[0].length;const mono=new Float32Array(n+1);mono[0]=this.last;for(let i=0;i<n;i++){let v=0;for(const ch of channels)v+=ch[i];mono[i+1]=v/channels.length;}
 const step=sampleRate/16000;while(this.position<n){const index=Math.floor(this.position),f=this.position-index;this.samples.push(mono[index]*(1-f)+mono[index+1]*f);this.position+=step;}this.position-=n;this.last=mono[n];if(this.samples.length>=2048)this.send();return true;}
}
registerProcessor('hush-capture',HushCapture);

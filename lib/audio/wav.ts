export function wav(samples:Int16Array,sampleRate=16000):ArrayBuffer {
 const buffer=new ArrayBuffer(44+samples.length*2);const view=new DataView(buffer);
 const str=(at:number,s:string)=>{for(let i=0;i<s.length;i++)view.setUint8(at+i,s.charCodeAt(i));};
 str(0,'RIFF');view.setUint32(4,36+samples.length*2,true);str(8,'WAVE');str(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);str(36,'data');view.setUint32(40,samples.length*2,true);
 for(let i=0;i<samples.length;i++)view.setInt16(44+i*2,samples[i],true);return buffer;
}
export function base64(buffer:ArrayBuffer){const bytes=new Uint8Array(buffer);let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(binary);}
export function joinSamples(parts:Int16Array[]){const combined=new Int16Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){combined.set(p,at);at+=p.length;}return combined;}

import { joinSamples } from './wav';

type CaptureCallbacks = { onVoice: () => void; onAudio: (samples: Int16Array) => void; onUnavailable: () => void };
/** Side tap on MediaRecorder's stream. Uses the existing mono 16 kHz worklet;
 * never requests another microphone or stops the recording's tracks. */
export class LiveAudioCapture {
  private context?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private node?: AudioWorkletNode;
  private output?: GainNode;
  private timer?: ReturnType<typeof setInterval>;
  private frames: Int16Array[] = [];
  private count = 0;
  private hasSpeech = false;
  private lastVoiceAt = 0;
  private suppressed = false;
  private closed = false;
  constructor(private callbacks: CaptureCallbacks) {}
  async start(stream: MediaStream) {
    try {
      const context = new AudioContext(); this.context = context;
      await context.resume(); await context.audioWorklet.addModule('/audio-worklet.js');
      if (this.closed) { if (context.state !== 'closed') await context.close(); return; }
      this.source = context.createMediaStreamSource(stream);
      this.node = new AudioWorkletNode(context, 'hush-capture');
      this.output = context.createGain(); this.output.gain.value = 0;
      this.source.connect(this.node); this.node.connect(this.output); this.output.connect(context.destination);
      this.node.port.onmessage = event => this.receive(event.data);
      context.onstatechange = () => { if (!this.closed && context.state === 'suspended') this.callbacks.onUnavailable(); };
      this.timer = setInterval(() => { if (this.hasSpeech && Date.now() - this.lastVoiceAt >= 900) this.flush(); }, 100);
    } catch { await this.stop(); this.callbacks.onUnavailable(); }
  }
  private receive(frame: Float32Array) {
    if (this.closed || this.suppressed) return;
    let sum = 0;
    const samples = new Int16Array(frame.length);
    for (let index = 0; index < frame.length; index++) {
      const value = Math.max(-1, Math.min(1, frame[index])); sum += value * value; samples[index] = Math.round(value * 32767);
    }
    if (Math.sqrt(sum / frame.length) > 0.012) {
      this.hasSpeech = true; this.lastVoiceAt = Date.now(); this.callbacks.onVoice();
    }
    this.frames.push(samples); this.count += samples.length;
    if (this.count >= 16000 * 6) this.flush();
  }
  flush() {
    if (this.hasSpeech && this.count) this.callbacks.onAudio(joinSamples(this.frames));
    this.frames = []; this.count = 0; this.hasSpeech = false;
  }
  hasPendingSpeech() { return this.hasSpeech; }
  setSuppressed(value: boolean) {
    this.suppressed = value; this.frames = []; this.count = 0; this.hasSpeech = false;
    this.node?.port.postMessage('discard');
  }
  async stop() {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    this.node?.disconnect(); this.source?.disconnect(); this.output?.disconnect();
    if (this.context) { this.context.onstatechange = null; if (this.context.state !== 'closed') await this.context.close(); }
    this.frames = []; this.count = 0; this.hasSpeech = false;
  }
}

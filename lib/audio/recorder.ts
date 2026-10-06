import { MAX_AUDIO_BYTES, MAX_RECORDING_SECONDS } from './validation';

const recordingTypes = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg'];
export function recordingMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return recordingTypes.find(type => MediaRecorder.isTypeSupported(type));
}
export function microphoneError(error: unknown): string {
  const name = error instanceof Error || error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microphone access is blocked. Allow microphone permission or upload an audio file instead.';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'No microphone was found. Connect a microphone or upload an audio file instead.';
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'Your microphone is unavailable. Close other apps using it, then try again or upload audio.';
  return 'Recording could not start. Please try again or upload an audio file instead.';
}
type RecorderCallbacks = { onReady: (file: File, notice?: string) => void; onError: (message: string) => void; onStream?: (stream: MediaStream) => void; onCaptureEnd?: () => void };

export class AudioRecorder {
  private stream?: MediaStream;
  private recorder?: MediaRecorder;
  private chunks: Blob[] = [];
  private bytes = 0;
  private cancelled = false;
  private stopped = false;
  private notice?: string;
  private limitTimer?: ReturnType<typeof setTimeout>;
  constructor(private callbacks: RecorderCallbacks) {}
  async start(): Promise<boolean> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone recording needs a supported browser and HTTPS. You can upload an audio file instead.');
    const mimeType = recordingMimeType();
    if (!mimeType) throw new Error('Audio recording is not supported in this browser. Upload an audio file instead.');
    try {
      // Called only from the user's Start recording action.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (this.cancelled) { stream.getTracks().forEach(track => track.stop()); return false; }
      this.stream = stream;
      this.recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 96000 });
      this.recorder.ondataavailable = event => {
        if (this.cancelled || !event.data.size) return;
        this.chunks.push(event.data); this.bytes += event.data.size;
        // Timeslices share container headers. Future chunking must remux audio
        // at safe boundaries, not submit these blobs independently.
        if (this.bytes >= MAX_AUDIO_BYTES - 128 * 1024 && !this.stopped) this.stop('The recording reached the size limit and was stopped.');
      };
      this.recorder.onstop = () => {
        this.release();
        if (this.cancelled) return;
        const blob = new Blob(this.chunks, { type: this.recorder?.mimeType || mimeType }); this.chunks = [];
        if (!blob.size) { this.callbacks.onError('No recording was detected. Try again or upload audio.'); return; }
        if (blob.size > MAX_AUDIO_BYTES) { this.callbacks.onError('This recording is too large. Please make a shorter recording.'); return; }
        const extension = mimeType.startsWith('audio/mp4') ? 'm4a' : mimeType.startsWith('audio/ogg') ? 'ogg' : 'webm';
        this.callbacks.onReady(new File([blob], `Recording-${new Date().toISOString().replace(/[:.]/g, '-')}.${extension}`, { type: blob.type }), this.notice);
      };
      this.recorder.onerror = () => { this.cancel(); this.callbacks.onError('Recording was interrupted. Please try again or upload an audio file.'); };
      stream.getAudioTracks().forEach(track => { track.onended = () => { if (!this.stopped && !this.cancelled) this.stop('The microphone disconnected. The captured audio is ready below.'); }; });
      this.recorder.start(1000);
      this.callbacks.onStream?.(stream);
      this.limitTimer = setTimeout(() => this.stop('The 15-minute recording limit was reached. Your audio is ready below.'), MAX_RECORDING_SECONDS * 1000);
      return true;
    } catch (error) { this.release(); throw error; }
  }
  stop(notice?: string) {
    if (this.stopped || this.cancelled) return;
    this.stopped = true; this.notice = notice;
    if (this.recorder?.state !== 'inactive') this.recorder?.stop();
    this.release();
  }
  pause() {
    if (this.stopped || this.cancelled) return;
    if (this.recorder?.state === 'recording') this.recorder.pause();
    this.stream?.getAudioTracks().forEach(track => { track.enabled = false; });
  }
  resume() {
    if (this.stopped || this.cancelled) return;
    this.stream?.getAudioTracks().forEach(track => { track.enabled = true; });
    if (this.recorder?.state === 'paused') this.recorder.resume();
  }
  cancel() {
    this.cancelled = true;
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    this.release(); this.chunks = [];
  }
  private release() {
    if (this.limitTimer) clearTimeout(this.limitTimer);
    if (this.stream) this.callbacks.onCaptureEnd?.();
    this.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); }); this.stream = undefined;
  }
}

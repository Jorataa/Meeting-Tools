import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioRecorder } from '@/lib/audio/recorder';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function microphone() {
  vi.useFakeTimers();
  const track = { enabled: true, onended: null, stop: vi.fn() };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const devices = { getUserMedia: vi.fn(async () => stream) };
  vi.stubGlobal('navigator', { mediaDevices: devices });
  class Recorder {
    static isTypeSupported = () => true;
    state = 'inactive';
    start() { this.state = 'recording'; }
    pause() { this.state = 'paused'; }
    resume() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; }
  }
  vi.stubGlobal('MediaRecorder', Recorder);
  const callbacks = { onReady: vi.fn(), onError: vi.fn(), onStream: vi.fn(), onCaptureEnd: vi.fn() };
  const recorder = new AudioRecorder(callbacks);
  return { recorder, track, devices, stream, callbacks };
}

describe('microphone recording lifecycle', () => {
  it('pauses microphone capture and resumes the same stream without another permission request', async () => {
    const h = microphone();
    await h.recorder.start();
    h.recorder.pause(); expect(h.track.enabled).toBe(false);
    h.recorder.resume(); expect(h.track.enabled).toBe(true);
    expect(h.devices.getUserMedia).toHaveBeenCalledOnce();
    h.recorder.cancel(); expect(h.track.stop).toHaveBeenCalledOnce();
    expect(h.callbacks.onCaptureEnd).toHaveBeenCalledOnce();
  });
  it('releases a paused microphone on stop and cannot resume an ended recording', async () => {
    const h = microphone(); await h.recorder.start(); h.recorder.pause(); h.recorder.stop();
    h.recorder.resume(); expect(h.track.enabled).toBe(false);
    expect(h.track.stop).toHaveBeenCalledOnce();
  });
  it('releases a stream granted after cancellation without starting live services', async () => {
    const h = microphone();
    let grant!: (stream: typeof h.stream) => void;
    h.devices.getUserMedia.mockImplementationOnce(() => new Promise(resolve => { grant = resolve; }));
    const start = h.recorder.start(); h.recorder.cancel(); grant(h.stream);
    expect(await start).toBe(false); expect(h.track.stop).toHaveBeenCalledOnce();
    expect(h.callbacks.onStream).not.toHaveBeenCalled();
  });
});

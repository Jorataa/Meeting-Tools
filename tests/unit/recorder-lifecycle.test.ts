import { afterEach, describe, expect, it, vi } from 'vitest';
import { AudioRecorder } from '@/lib/audio/recorder';
import { MAX_RECORDING_SECONDS } from '@/lib/audio/validation';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

function capture() {
  vi.useFakeTimers();
  const track: { enabled: boolean; onended: (() => void) | null; stop: ReturnType<typeof vi.fn> } = { enabled: true, onended: null, stop: vi.fn() };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const devices = { getUserMedia: vi.fn(async () => stream) };
  vi.stubGlobal('navigator', { mediaDevices: devices });
  const instance: { current?: Recorder } = {};
  class Recorder {
    static isTypeSupported = () => true;
    state = 'inactive';
    mimeType: string;
    ondataavailable?: (event: { data: Blob }) => void;
    onstop?: () => void;
    onerror?: () => void;
    constructor(_stream: unknown, options: { mimeType: string }) { this.mimeType = options.mimeType; instance.current = this; }
    start = vi.fn(() => { this.state = 'recording'; });
    pause = vi.fn(() => { this.state = 'paused'; });
    resume = vi.fn(() => { this.state = 'recording'; });
    stop = vi.fn(() => { this.state = 'inactive'; setTimeout(() => this.onstop?.(), 0); });
    append(text: string) { this.ondataavailable?.({ data: new Blob([text], { type: this.mimeType }) }); }
  }
  vi.stubGlobal('MediaRecorder', Recorder);
  const callbacks = { onReady: vi.fn(), onError: vi.fn(), onStream: vi.fn(), onCaptureEnd: vi.fn() };
  const recorder = new AudioRecorder(callbacks);
  return { recorder, track, devices, callbacks, get media() { return instance.current!; } };
}

describe('captured audio lifecycle', () => {
  it('retains all recorded chunks when a paused meeting stops and releases the mic once', async () => {
    const h = capture(); await h.recorder.start();
    h.media.append('container header'); h.media.append('audio samples');
    h.recorder.pause(); h.recorder.stop(); h.recorder.stop();
    await vi.advanceTimersByTimeAsync(0);
    const [file, notice] = h.callbacks.onReady.mock.calls[0];
    expect(file).toBeInstanceOf(File); expect(file.name).toMatch(/\.webm$/);
    expect(await file.text()).toBe('container headeraudio samples');
    expect(notice).toBeUndefined(); expect(h.callbacks.onReady).toHaveBeenCalledOnce();
    expect(h.callbacks.onError).not.toHaveBeenCalled();
    expect(h.track.stop).toHaveBeenCalledOnce(); expect(h.callbacks.onCaptureEnd).toHaveBeenCalledOnce();
    expect(h.track.onended).toBeNull(); expect(vi.getTimerCount()).toBe(0);
  });

  it('makes the captured recording available when the microphone disconnects', async () => {
    const h = capture(); await h.recorder.start(); h.media.append('retained speech');
    h.track.onended?.(); await vi.advanceTimersByTimeAsync(0);
    expect(h.callbacks.onReady).toHaveBeenCalledOnce();
    expect(h.callbacks.onReady.mock.calls[0][1]).toContain('microphone disconnected');
    expect(await h.callbacks.onReady.mock.calls[0][0].text()).toBe('retained speech');
    expect(h.track.stop).toHaveBeenCalledOnce(); expect(h.callbacks.onCaptureEnd).toHaveBeenCalledOnce();
  });

  it('stops automatically at the recording limit and preserves the file with a useful notice', async () => {
    const h = capture(); await h.recorder.start(); h.media.append('retained speech');
    await vi.advanceTimersByTimeAsync(MAX_RECORDING_SECONDS * 1000 + 1);
    expect(h.callbacks.onReady).toHaveBeenCalledOnce();
    expect(h.callbacks.onReady.mock.calls[0][1]).toContain('15-minute recording limit');
    expect(h.track.stop).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });

  it('does not create a file after cancel, including delayed recorder data and stop events', async () => {
    const h = capture(); await h.recorder.start(); h.media.append('discarded speech');
    h.recorder.cancel(); h.media.append('late data');
    await vi.advanceTimersByTimeAsync(0);
    expect(h.callbacks.onReady).not.toHaveBeenCalled(); expect(h.callbacks.onError).not.toHaveBeenCalled();
    expect(h.track.stop).toHaveBeenCalledOnce(); expect(h.callbacks.onCaptureEnd).toHaveBeenCalledOnce();
  });

  it('reports a recorder error once and stops both recording and live capture', async () => {
    const h = capture(); await h.recorder.start(); h.media.append('unavailable audio');
    h.media.onerror?.(); await vi.advanceTimersByTimeAsync(0);
    expect(h.callbacks.onError).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('Recording was interrupted'));
    expect(h.callbacks.onReady).not.toHaveBeenCalled();
    expect(h.track.stop).toHaveBeenCalledOnce(); expect(h.callbacks.onCaptureEnd).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports empty captured audio instead of submitting an empty file', async () => {
    const h = capture(); await h.recorder.start(); h.recorder.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.callbacks.onError).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('No recording was detected'));
    expect(h.callbacks.onReady).not.toHaveBeenCalled(); expect(h.track.stop).toHaveBeenCalledOnce();
  });

  it('does not start live capture or leave timers behind after permission is denied', async () => {
    const h = capture(); const denied = new DOMException('Permission denied', 'NotAllowedError');
    h.devices.getUserMedia.mockRejectedValueOnce(denied);
    await expect(h.recorder.start()).rejects.toBe(denied);
    expect(h.callbacks.onStream).not.toHaveBeenCalled(); expect(h.callbacks.onCaptureEnd).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('releases an already granted microphone if MediaRecorder construction fails', async () => {
    const h = capture();
    class BrokenRecorder {
      static isTypeSupported = () => true;
      constructor() { throw new Error('Encoder unavailable'); }
    }
    vi.stubGlobal('MediaRecorder', BrokenRecorder);
    await expect(h.recorder.start()).rejects.toThrow('Encoder unavailable');
    expect(h.track.stop).toHaveBeenCalledOnce(); expect(h.callbacks.onCaptureEnd).toHaveBeenCalledOnce();
    expect(h.callbacks.onStream).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
});

'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { emptyLiveSnapshot, LiveInterruptionController } from './live/controller';
export function useLiveInterruption() {
  const [snapshot, setSnapshot] = useState(emptyLiveSnapshot);
  const [enabled, setEnabled] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const controller = useRef<LiveInterruptionController | null>(null);
  useEffect(() => {
    const live = new LiveInterruptionController(setSnapshot); controller.current = live;
    return () => { live.stop(); controller.current = null; };
  }, []);
  const start = useCallback(() => { void controller.current?.start(); }, []);
  const stop = useCallback(() => { controller.current?.stop(); }, []);
  const setPaused = useCallback((paused: boolean) => { controller.current?.setPaused(paused); }, []);
  const onVoice = useCallback(() => { controller.current?.onVoice(); }, []);
  const acceptTranscript = useCallback((text: string, partial: boolean) => { controller.current?.acceptTranscript(text, partial); }, []);
  const reset = useCallback(() => { controller.current?.reset(); }, []);
  const finalize = useCallback((transcript: string) => { void controller.current?.finalize(transcript); }, []);
  const toggleEnabled = () => { const next = !enabled; setEnabled(next); controller.current?.setEnabled(next); };
  const toggleVoice = () => { const next = !voiceEnabled; setVoiceEnabled(next); controller.current?.setVoiceEnabled(next); };
  return { ...snapshot, enabled, voiceEnabled, start, stop, setPaused, onVoice, acceptTranscript, onStream: start, onCaptureEnd: stop, reset, finalize, toggleEnabled, toggleVoice };
}

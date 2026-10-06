'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioRecorder, microphoneError } from './audio/recorder';
import { validateAudio } from './audio/validation';
import { StreamingTranscription } from './live/transcription-client';
import type { Segment } from './model';

export type TranscriptionState = 'initial' | 'requesting' | 'recording' | 'paused' | 'stopping' | 'audio-ready' | 'uploading' | 'transcribing' | 'success' | 'error';
const genericError = "We couldn't transcribe this recording. Please try again.";
const knownCodes = new Set(['NOT_CONFIGURED', 'INCOMPLETE', 'TRANSCRIPTION_FAILED', 'NO_SPEECH', 'TIMEOUT', 'RATE_LIMITED', 'SERVICE_CONFIGURATION', 'SERVICE_UNAVAILABLE', 'TOO_LARGE', 'INVALID_INPUT', 'INVALID_AUDIO', 'ORIGIN', 'SESSION']);

export type MicrophonePermission = 'unknown' | 'prompt' | 'granted' | 'denied' | 'unavailable';
export type LiveCallbacks = {
  onMeetingStart?: () => void; onMeetingStop?: () => void;
  onTranscript?: (text: string, partial: boolean) => void;
  onVoice?: () => void; onPaused?: (paused: boolean) => void; suppressed?: boolean;
};
export function useTranscription(live?: LiveCallbacks) {
  const liveRef = useRef(live); liveRef.current = live;
  const [state, setState] = useState<TranscriptionState>('initial');
  const [ready, setReady] = useState(false);
  const mounted = useRef(false);
  const [audio, setAudio] = useState<File | null>(null);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState(0);
  const [partialTranscript, setPartialTranscript] = useState('');
  const [segments, setSegments] = useState<Segment[]>([]);
  const [level, setLevel] = useState(0);
  const [micPermission, setMicPermission] = useState<MicrophonePermission>('unknown');
  const [streamStatus, setStreamStatus] = useState<'idle' | 'connecting' | 'listening' | 'reconnecting' | 'error'>('idle');
  const [liveNotice, setLiveNotice] = useState('');
  const streaming = useRef<StreamingTranscription | null>(null);
  const liveFinish = useRef<Promise<void> | null>(null);
  const finishingTransport = useRef<StreamingTranscription | null>(null);
  const committed = useRef<Segment[]>([]);
  const partial = useRef('');
  const partialAt = useRef(0);
  const accumulatedMs = useRef(0);
  const stopping = useRef(false);
  const liveGeneration = useRef(0);
  useEffect(() => { streaming.current?.setSuppressed(!!live?.suppressed); }, [live?.suppressed]);
  useEffect(() => {
    let disposed = false;
    let permission: PermissionStatus | undefined;
    if (!navigator.mediaDevices?.getUserMedia) { setMicPermission('unavailable'); return; }
    void navigator.permissions?.query({ name: 'microphone' as PermissionName }).then(value => {
      if (disposed) return;
      permission = value;
      const updatePermission = () => setMicPermission(value.state);
      updatePermission(); value.onchange = updatePermission;
    }).catch(() => {});
    return () => { disposed = true; if (permission) permission.onchange = null; };
  }, []);
  const recorder = useRef<AudioRecorder | null>(null);
  const request = useRef<XMLHttpRequest | null>(null);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const startedAt = useRef(0);
  const locked = useRef(false);
  const stateRef = useRef(state); stateRef.current = state;
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (['recording', 'paused', 'stopping', 'uploading', 'transcribing'].includes(stateRef.current) || audio || transcript) event.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [audio, transcript]);
  useEffect(() => {
    mounted.current = true; setReady(true);
    const lifecycle = { recording: generation, streaming: liveGeneration };
    return () => {
      mounted.current = false;
      lifecycle.recording.current++; lifecycle.streaming.current++;
      streaming.current?.cancel(); finishingTransport.current?.cancel(); recorder.current?.cancel(); request.current?.abort(); controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (state !== 'recording') return;
    const tick = () => setElapsed(Math.floor((accumulatedMs.current + Date.now() - startedAt.current) / 1000)); tick();
    const timer = setInterval(tick, 250); return () => clearInterval(timer);
  }, [state]);

  const transcribe = useCallback(async (file: File) => {
    if (locked.current) return;
    const invalid = validateAudio(file);
    if (invalid) { setError(invalid); setState('error'); return; }
    locked.current = true;
    const currentGeneration = ++generation.current;
    setAudio(file); setError(''); setProgress(0); setState('uploading');
    const abort = new AbortController(); controller.current = abort;
    try {
      const session = await fetch('/api/session', { method: 'POST', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]) });
      if (!session.ok) throw new Error(session.status === 429 ? 'Too many requests. Please wait a moment and try again.' : 'Could not connect. Check your internet connection and try again.');
      if (currentGeneration !== generation.current) return;
      const body = new FormData(); body.append('audio', file);
      const xhr = new XMLHttpRequest(); request.current = xhr;
      await new Promise<void>((resolve, reject) => {
        xhr.open('POST', '/api/transcribe'); xhr.timeout = 135000;
        xhr.upload.onprogress = event => {
          if (currentGeneration !== generation.current) return;
          if (event.lengthComputable) setProgress(Math.round(event.loaded / event.total * 100));
        };
        xhr.upload.onload = () => { if (currentGeneration === generation.current) setState('transcribing'); };
        xhr.onload = () => {
          if (currentGeneration !== generation.current) { resolve(); return; }
          let parsed: unknown;
          try { parsed = JSON.parse(xhr.responseText); } catch {
            reject(new Error(xhr.status === 413 ? 'This upload exceeds the server limit. Please use a smaller audio file.' : genericError)); return;
          }
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { reject(new Error(genericError)); return; }
          const data = parsed as Record<string, unknown>;
          if (xhr.status < 200 || xhr.status >= 300) {
            reject(new Error(typeof data.code === 'string' && knownCodes.has(data.code) && typeof data.error === 'string' ? data.error : genericError)); return;
          }
          if (typeof data.transcript !== 'string' || !data.transcript.trim()) { reject(new Error(genericError)); return; }
          setTranscript(data.transcript); setState('success'); resolve();
        };
        xhr.onerror = () => reject(new Error('Connection lost. Your audio is still here. Check your connection and try again.'));
        xhr.ontimeout = () => reject(new Error('Transcription took too long. Try again or choose a shorter recording.'));
        xhr.onabort = () => resolve(); xhr.send(body);
      });
    } catch (cause) {
      if (currentGeneration !== generation.current) return;
      setError(cause instanceof Error && cause.name === 'Error' ? cause.message : 'Could not connect. Check your internet connection and try again.'); setState('error');
    } finally {
      if (currentGeneration === generation.current) { locked.current = false; request.current = null; controller.current = null; }
    }
  }, []);

  const publishTranscript = useCallback((isPartial: boolean) => {
    const text = committed.current.map(segment => segment.text).join('\n\n');
    setTranscript(text); setSegments([...committed.current]); setPartialTranscript(partial.current);
    liveRef.current?.onTranscript?.([text, partial.current].filter(Boolean).join('\n\n'), isPartial);
  }, []);
  const finishLive = useCallback((): Promise<void> => {
    if (liveFinish.current) return liveFinish.current;
    const transport = streaming.current; streaming.current = null;
    finishingTransport.current = transport;
    const epoch = liveGeneration.current;
    const pending = (async () => {
      try { await transport?.stop(); } catch { /* Full captured audio remains available. */ }
      if (finishingTransport.current === transport) finishingTransport.current = null;
      if (epoch !== liveGeneration.current) return;
      liveGeneration.current++;
      // Keep an unconfirmed last hypothesis visible until file reconciliation.
      setLevel(0); setStreamStatus('idle'); liveRef.current?.onMeetingStop?.();
    })();
    liveFinish.current = pending;
    return pending;
  }, []);
  const startRecording = useCallback(async () => {
    if (!mounted.current || locked.current) return;
    locked.current = true; stopping.current = false;
    const currentGeneration = ++generation.current;
    const epoch = ++liveGeneration.current;
    liveFinish.current = null;
    committed.current = []; partial.current = ''; partialAt.current = 0;
    accumulatedMs.current = 0;
    setTranscript(''); setSegments([]); setPartialTranscript(''); setLevel(0);
    setError(''); setNotice(''); setLiveNotice(''); setStreamStatus('idle'); setElapsed(0); setState('requesting');
    const capture = new AudioRecorder({
      onStream: stream => {
        if (currentGeneration !== generation.current) return;
        setMicPermission('granted'); liveRef.current?.onMeetingStart?.();
        const transport = new StreamingTranscription({
          onPartial: (text, at) => {
            if (epoch !== liveGeneration.current) return;
            if (!partial.current) partialAt.current = at;
            // Interim events replace only the active hypothesis. Empty service
            // updates must not erase already visible words.
            if (text.trim()) partial.current = text;
            publishTranscript(true);
          },
          onFinal: (text, at, id) => {
            if (epoch !== liveGeneration.current || !text.trim()) return;
            if (committed.current.some(segment => segment.id === id)) return;
            committed.current.push({ id, text: text.trim(), at: partialAt.current || at, speaker: 'Participant', source: 'human' });
            partial.current = ''; partialAt.current = 0; publishTranscript(false);
          },
          onStatus: (status, message) => {
            if (epoch !== liveGeneration.current) return;
            setStreamStatus(status); setLiveNotice(message || '');
          },
          onLevel: (value, voice) => {
            if (epoch !== liveGeneration.current || stateRef.current === 'paused') return;
            setLevel(value); if (voice) liveRef.current?.onVoice?.();
          },
        });
        streaming.current = transport; transport.setSuppressed(!!liveRef.current?.suppressed);
        void transport.start(stream).catch(cause => {
          if (epoch !== liveGeneration.current) return;
          setStreamStatus('error');
          setLiveNotice(`${cause instanceof Error ? cause.message : 'Live transcription could not connect.'} Your audio is still recording; Stop will transcribe the saved recording.`);
        });
      },
      onCaptureEnd: () => { void finishLive(); },
      onReady: async (file, message) => {
        if (currentGeneration !== generation.current) return;
        recorder.current = null;
        setAudio(file); setNotice(message || '');
        // Drain outstanding final events before full-file reconciliation.
        await finishLive();
        if (currentGeneration !== generation.current) return;
        locked.current = false;
        setState('audio-ready'); if (!message) void transcribe(file);
      },
      onError: message => {
        if (currentGeneration !== generation.current) return;
        locked.current = false; recorder.current = null; setError(message); setState('error');
      },
    }); recorder.current = capture;
    try {
      const started = await capture.start();
      if (!started || currentGeneration !== generation.current) return;
      setAudio(null); startedAt.current = Date.now(); setState('recording');
    } catch (cause) {
      if (currentGeneration !== generation.current) return;
      locked.current = false; recorder.current = null;
      const name = cause instanceof Error ? cause.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') setMicPermission('denied');
      else if (name === 'NotFoundError' || name === 'NotReadableError') setMicPermission('unavailable');
      setError(cause instanceof Error && cause.name === 'Error' ? cause.message : microphoneError(cause)); setState('error');
    }
  }, [finishLive, publishTranscript, transcribe]);
  const cancel = useCallback(() => {
    const discardCapture = ['requesting', 'recording', 'paused'].includes(stateRef.current);
    generation.current++; liveGeneration.current++;
    streaming.current?.cancel(); streaming.current = null;
    finishingTransport.current?.cancel(); finishingTransport.current = null;
    recorder.current?.cancel(); recorder.current = null; liveRef.current?.onMeetingStop?.();
    request.current?.abort(); request.current = null; controller.current?.abort(); controller.current = null;
    locked.current = false; stopping.current = false; accumulatedMs.current = 0;
    if (discardCapture) {
      committed.current = []; partial.current = ''; partialAt.current = 0;
      setTranscript(''); setSegments([]); setPartialTranscript('');
    }
    setLevel(0); setStreamStatus('idle'); setLiveNotice(''); setError(''); setNotice(''); setElapsed(0); setState(audio ? 'audio-ready' : 'initial');
  }, [audio]);
  const reset = useCallback(() => {
    cancel(); committed.current = []; partial.current = ''; partialAt.current = 0;
    setAudio(null); setTranscript(''); setSegments([]); setPartialTranscript(''); setState('initial');
  }, [cancel]);
  const pauseRecording = useCallback(() => {
    if (stateRef.current !== 'recording' || !recorder.current || stopping.current) return;
    accumulatedMs.current += Date.now() - startedAt.current;
    recorder.current.pause(); streaming.current?.setPaused(true); liveRef.current?.onPaused?.(true);
    setLevel(0); setState('paused'); stateRef.current = 'paused';
  }, []);
  const resumeRecording = useCallback(() => {
    if (stateRef.current !== 'paused' || !recorder.current || stopping.current) return;
    startedAt.current = Date.now(); recorder.current.resume(); streaming.current?.setPaused(false);
    liveRef.current?.onPaused?.(false); setState('recording'); stateRef.current = 'recording';
  }, []);
  const selectAudio = useCallback((file: File) => {
    if (locked.current) return;
    const invalid = validateAudio(file); setError(invalid || ''); setNotice('');
    if (invalid) { setState('error'); return; }
    setAudio(file); setElapsed(0); setState('audio-ready');
  }, []);
  const stopRecording = useCallback(() => {
    if (!recorder.current) return;
    if (stopping.current) return;
    stopping.current = true;
    if (stateRef.current === 'recording') accumulatedMs.current += Date.now() - startedAt.current;
    setElapsed(Math.floor(accumulatedMs.current / 1000)); setState('stopping');
    stateRef.current = 'stopping';
    liveRef.current?.onPaused?.(true); recorder.current.stop();
  }, []);
  return { state, ready, audio, transcript, partialTranscript, segments, level, micPermission, streamStatus, liveNotice, pauseRecording, resumeRecording, setTranscript, error, notice, elapsed, progress, startRecording, stopRecording, selectAudio, transcribe, cancel, reset };
}

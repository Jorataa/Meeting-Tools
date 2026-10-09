'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Voice } from './audio/speech';

/** Explicit playback shares the existing voice service and suppresses capture before sound starts. */
export function useWhisperVoice(question: string, allowed: boolean) {
  const voice = useRef<Voice | null>(null);
  const generation = useRef(0);
  const [busy, setBusy] = useState(false);
  const [suppressed, setSuppressed] = useState(false);
  const [notice, setNotice] = useState('');
  const current = useRef({ question, allowed });
  current.current = { question, allowed };
  const cancel = useCallback(() => {
    generation.current++; voice.current?.cancel();
    setBusy(false); setSuppressed(false);
  }, []);
  useEffect(() => {
    voice.current = new Voice();
    const lifecycle = { generation };
    return () => { lifecycle.generation.current++; voice.current?.cancel(); voice.current = null; };
  }, []);
  useEffect(() => { cancel(); setNotice(''); }, [question, allowed, cancel]);
  const speak = useCallback(async () => {
    if (!current.current.allowed || !question || busy) return;
    const epoch = ++generation.current;
    setBusy(true); setNotice('');
    try {
      const success = await voice.current?.speak(question, {
        language: 'mixed', preferGeminiTTS: true,
        shouldStart: () => epoch === generation.current && current.current.allowed && current.current.question === question,
        onBeforeStart: () => { if (epoch === generation.current) setSuppressed(true); },
      });
      if (epoch === generation.current && !success) setNotice('Voice could not play. Your recording continues; read the question above.');
    } finally {
      if (epoch === generation.current) { setBusy(false); setSuppressed(false); }
    }
  }, [question, busy]);
  return { speak, cancel, busy, suppressed, notice };
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { BookmarkPlus, Sparkles, Volume2, X } from 'lucide-react';

export function WhisperCard({ question, reason, speaking, voiceMuted, voiceBusy, onAcknowledge, onDismiss, onSpeak }: {
  question: string; reason: string; speaking: boolean; voiceMuted: boolean; voiceBusy: boolean;
  onAcknowledge: () => void; onDismiss: () => void; onSpeak: () => void;
}) {
  const [leaving, setLeaving] = useState(false);
  const [action, setAction] = useState<'dismiss' | 'acknowledge' | null>(null);
  const callbacks = useRef({ onAcknowledge, onDismiss });
  callbacks.current = { onAcknowledge, onDismiss };
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => { if (action === 'acknowledge') callbacks.current.onAcknowledge(); else callbacks.current.onDismiss(); }, 170);
    return () => clearTimeout(timer);
  }, [leaving, action]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault(); setAction('dismiss'); setLeaving(true);
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, []);
  return <section className={`ai-question-card ${leaving ? 'is-leaving' : ''}`} aria-label="AI clarification"><div className="ai-question-heading"><span className="sparkle-badge"><Sparkles size={16} aria-hidden="true" /></span><span>{speaking ? 'AI question' : 'A thought, when you’re ready'}</span><button className="question-dismiss" onClick={() => { setAction('dismiss'); setLeaving(true); }} aria-label="Dismiss AI question"><X size={13} aria-hidden="true" />Dismiss<kbd>Esc</kbd></button></div><p className="ai-question-body">{question}</p>{reason && <p className="question-reason">{reason}</p>}<div className="whisper-actions"><button className="text-button" disabled={leaving} onClick={() => { setAction('acknowledge'); setLeaving(true); }}><BookmarkPlus size={15} aria-hidden="true" />Acknowledge<span>Pin to agenda</span></button>{voiceMuted && <button className="secondary-button" disabled={voiceBusy || leaving} onClick={onSpeak}><Volume2 size={15} aria-hidden="true" />{voiceBusy ? 'Preparing voice…' : 'Ask aloud'}</button>}</div></section>;
}

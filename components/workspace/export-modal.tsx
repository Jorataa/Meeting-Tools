'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Copy, Download, FileText } from 'lucide-react';
import { download, formatMeeting, type MeetingExport, type ShareFormat } from '@/lib/export';

export function ExportMenu({ meeting, audio }: { meeting: MeetingExport; audio?: File | null }) {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    first.current?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const buttons = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') || []);
        const index = buttons.findIndex(button => button === document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
    };
    const node = root.current;
    document.addEventListener('pointerdown', outside);
    node?.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('pointerdown', outside); node?.removeEventListener('keydown', keydown); };
  }, [open]);
  useEffect(() => { if (!feedback) return; const timer = setTimeout(() => setFeedback(''), 3000); return () => clearTimeout(timer); }, [feedback]);
  async function copy(format: ShareFormat) {
    try { await navigator.clipboard.writeText(formatMeeting(meeting, format)); setFeedback(`Copied for ${format === 'slack' ? 'Slack' : 'Notion'}`); }
    catch { setFeedback('Clipboard unavailable. Download Markdown to share.'); }
    setOpen(false); trigger.current?.focus();
  }
  function save(extension: 'md' | 'txt') {
    const text = extension === 'md' ? formatMeeting(meeting) : meeting.transcript;
    const filename = extension === 'md' ? `${meeting.title.replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().slice(0, 80) || 'meeting'}.md` : 'meeting-transcript.txt';
    download(new Blob([text], { type: extension === 'md' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8' }), filename);
    setOpen(false); trigger.current?.focus();
  }
  return <div className="export-menu" ref={root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button ref={trigger} className="secondary-button" aria-haspopup="menu" aria-expanded={open} aria-controls="meeting-export-menu" onClick={() => setOpen(value => !value)}><Download size={15} aria-hidden="true" />Share & export<ChevronDown size={13} aria-hidden="true" /></button>
    {open && <div className="export-options" id="meeting-export-menu" role="menu" aria-label="Share meeting"><span>TAKE THE CLARITY WITH YOU</span><button ref={first} role="menuitem" onClick={() => void copy('slack')}><Copy size={15} aria-hidden="true" />Copy for Slack</button><button role="menuitem" onClick={() => void copy('notion')}><Copy size={15} aria-hidden="true" />Copy for Notion</button><button role="menuitem" onClick={() => save('md')}><FileText size={15} aria-hidden="true" />Export Markdown (.md)</button><button role="menuitem" onClick={() => save('txt')}><FileText size={15} aria-hidden="true" />Raw text (.txt)</button>{audio && <button role="menuitem" onClick={() => { download(audio, audio.name); setOpen(false); trigger.current?.focus(); }}><Download size={15} aria-hidden="true" />Download audio</button>}</div>}
    {feedback && <span className="export-feedback" role="status"><Check size={13} aria-hidden="true" />{feedback}</span>}
  </div>;
}

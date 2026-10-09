'use client';

import { useState } from 'react';
import { Check, Copy, Download, FileText, Pencil, Trash2 } from 'lucide-react';
import { download, type MeetingExport } from '@/lib/export';
import { renameSpeaker, transcriptTurns } from '@/lib/workspace-text';
import { ExecutiveBrief } from './executive-brief';
import { ExportMenu } from './export-modal';

export function CompletedSession({ meeting, audio, retentionLabel, onTranscript, onToggleAction, onResolve, onNew, onDelete, confirming, deleting, onConfirmDelete, onKeep, copyFeedback, onCopy }: {
  meeting: MeetingExport; audio?: File | null; retentionLabel: string; onTranscript: (text: string) => void;
  onToggleAction: (task: string) => void; onResolve: (question: string) => void; onNew: () => void; onDelete: () => void;
  confirming: boolean; deleting: boolean; onConfirmDelete: () => void; onKeep: () => void; copyFeedback: string; onCopy: () => void;
}) {
  const [editingSpeaker, setEditingSpeaker] = useState<string | null>(null);
  const [speakerName, setSpeakerName] = useState('');
  const turns = transcriptTurns(meeting.transcript);
  function commitName() {
    if (editingSpeaker) onTranscript(renameSpeaker(meeting.transcript, editingSpeaker, speakerName));
    setEditingSpeaker(null);
  }
  return <>
    <ExecutiveBrief context={meeting.context} notes={meeting.notes} onToggleAction={onToggleAction} onResolve={onResolve} />
    <section className="transcript-card completed-transcript" aria-label="Transcription result"><div className="transcript-toolbar"><h2><FileText size={16} aria-hidden="true" />Meeting transcript</h2><ExportMenu meeting={meeting} audio={audio} /></div>
      <div className="speaker-transcript" aria-label="Speaker transcript">{turns.map((turn, index) => <article className="transcript-entry" key={index}><div className="speaker-avatar">{turn.speaker.slice(0, 1)}</div><div><div className="transcript-entry-heading">{editingSpeaker === turn.speaker && turns.findIndex(item => item.speaker === turn.speaker) === index ? <form className="speaker-rename" onSubmit={event => { event.preventDefault(); commitName(); }}><input autoFocus aria-label={`Rename ${turn.speaker}`} value={speakerName} maxLength={80} onChange={event => setSpeakerName(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setEditingSpeaker(null); } }} /><button className="icon-button" aria-label="Save speaker name" type="submit"><Check size={14} aria-hidden="true" /></button></form> : <button className="speaker-name" title="Rename this speaker across the meeting" aria-label={`Rename speaker ${turn.speaker}`} onClick={() => { setEditingSpeaker(turn.speaker); setSpeakerName(turn.speaker); }}>{turn.speaker}<Pencil size={11} aria-hidden="true" /></button>}{turn.timestamp && <time>{turn.timestamp}</time>}</div><p>{turn.text}</p></div></article>)}</div>
      <div className="transcript-result"><div className="transcript-heading"><label htmlFor="transcript">Meeting transcript</label><span>Click to edit · {retentionLabel}</span></div><textarea id="transcript" aria-label="Meeting transcript" maxLength={150000} value={meeting.transcript} onChange={event => onTranscript(event.target.value)} spellCheck rows={8} /><div className="result-actions"><button className="primary-button" onClick={onCopy} disabled={!meeting.transcript.trim()}>{copyFeedback === 'Copied' ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}{copyFeedback === 'Copied' ? 'Copied' : 'Copy transcript'}</button><button className="secondary-button" onClick={() => download(new Blob([meeting.transcript], { type: 'text/plain;charset=utf-8' }), 'meeting-transcript.txt')} disabled={!meeting.transcript.trim()}><Download size={16} aria-hidden="true" />Download .txt</button><button className="text-button" onClick={onNew}>New transcription</button><button className="text-button delete-meeting" onClick={onDelete}><Trash2 size={14} aria-hidden="true" />Delete meeting</button></div>{confirming && <div className="delete-confirmation" role="alert"><p>Delete this meeting and its notes from this workspace?</p><button className="danger-button" disabled={deleting} onClick={onConfirmDelete}>Confirm delete meeting</button><button className="text-button" onClick={onKeep} disabled={deleting}>Keep meeting</button></div>}<p className="copy-feedback" role="status">{copyFeedback}</p><p className="edit-caption">Review names and numbers before sharing.</p></div>
    </section>
  </>;
}

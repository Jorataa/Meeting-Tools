'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, FileAudio, Mic, Sparkles } from 'lucide-react';
import { download } from '@/lib/export';
import type { Segment } from '@/lib/model';
import type { useTranscription } from '@/lib/use-transcription';
import { Welcome } from './welcome';

type Flow = ReturnType<typeof useTranscription>;
const stateLabels = { initial: 'Ready to listen', requesting: 'Waiting for microphone permission', recording: 'Listening attentively', paused: 'Recording paused', stopping: 'Finishing live transcript', 'audio-ready': 'Audio ready', uploading: 'Uploading audio', transcribing: 'Finalizing transcript', success: 'Meeting complete', error: 'Needs attention' };

export function LiveSession({ flow, timeline, onCancel, onUpload, onPreset, selectedPreset }: {
  flow: Flow; timeline: Segment[]; onCancel: () => void; onUpload: () => void;
  onPreset: (title: string, topics: string[]) => void; selectedPreset: string;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const paused = flow.state === 'paused';
  const recording = flow.state === 'recording';
  const busy = ['uploading', 'transcribing', 'stopping'].includes(flow.state);
  const showLive = recording || paused || busy || flow.segments.length > 0 || !!flow.partialTranscript;
  const canChoose = !busy && !recording && !paused && flow.state !== 'requesting';
  useEffect(() => {
    const element = scroll.current;
    if (element && nearBottom.current) element.scrollTo({ top: element.scrollHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [flow.partialTranscript, timeline]);
  return <section className={`transcript-card ${canChoose && !flow.audio ? 'welcome-card' : ''}`} aria-label="Audio transcription" aria-busy={busy}>
    {(showLive || !!flow.audio || flow.state === 'requesting') && <div className="transcript-toolbar"><h2><Mic size={16} aria-hidden="true" />Live transcript</h2><span className="transcript-state" role="status"><span className={`status-dot ${recording ? 'is-recording' : ''}`} />{stateLabels[flow.state]}</span></div>}
    {flow.state === 'requesting' && <div className="permission-state"><span className="microphone-mark"><Mic size={24} aria-hidden="true" /></span><h2>Allow your microphone</h2><p>Choose Allow in your browser’s permission prompt to start recording.</p><button className="text-button" onClick={onCancel}>Cancel</button></div>}
    {showLive && <section className="live-transcript" aria-label="Live transcript"><div ref={scroll} className="transcript-scroll" onScroll={event => { const node = event.currentTarget; nearBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100; }}>
      {!flow.segments.length && !flow.partialTranscript && <div className="transcript-waiting"><span className="listening-mark"><Mic size={24} aria-hidden="true" /></span><h3>{paused ? 'Your recording is paused' : 'Listening to your conversation'}</h3><p>{paused ? 'Resume when you are ready. Your transcript stays here.' : 'Be present. Your words will appear here as you speak.'}</p></div>}
      {timeline.map(segment => <article className={`transcript-entry ${segment.source === 'ai' ? 'ai-transcript-entry' : ''}`} key={segment.id}><div className="speaker-avatar">{segment.source === 'ai' ? <Sparkles size={14} aria-hidden="true" /> : segment.speaker.slice(0, 1)}</div><div><div className="transcript-entry-heading"><strong>{segment.speaker}</strong>{segment.at > 0 && <time>{new Date(segment.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>}{segment.source === 'ai' && <span>Clarification</span>}</div><p>{segment.text}</p></div></article>)}
      {flow.partialTranscript && <article className="transcript-entry is-partial"><div className="speaker-avatar">P</div><div><div className="transcript-entry-heading"><strong>Participant</strong><span className="partial-label">Speaking…</span></div><p aria-live="polite" aria-atomic="true">{flow.partialTranscript}<span className="transcript-cursor" aria-hidden="true" /></p></div></article>}
    </div><div className="transcript-live-footer"><span><span className={`status-dot ${recording ? 'is-recording' : ''}`} />{paused ? 'Paused · transcript preserved' : flow.streamStatus === 'reconnecting' ? 'Reconnecting the live stream' : flow.streamStatus === 'connecting' ? 'Connecting live transcription' : recording ? 'Updates as you speak' : busy ? 'Live text preserved while we finalize' : 'Captured transcript'}</span><span>{flow.segments.length} finalized {flow.segments.length === 1 ? 'turn' : 'turns'}</span></div></section>}
    {busy && <div className="processing-state"><span className="loading-ring" aria-hidden="true" /><div><h2>{flow.state === 'uploading' ? 'Sending your audio…' : flow.state === 'stopping' ? 'Finishing live transcript…' : 'Transcribing…'}</h2><p>{flow.state === 'uploading' ? `${flow.progress}% uploaded` : flow.state === 'stopping' ? 'Collecting the final words from the stream.' : 'Checking the complete recording for a polished final transcript.'}</p></div><button className="text-button" onClick={onCancel}>Cancel transcription</button></div>}
    {canChoose && (flow.audio ? <div className="audio-ready"><div className="selected-file"><FileAudio size={28} aria-hidden="true" /><div><strong>{flow.audio.name}</strong><span>{(flow.audio.size / 1024 / 1024).toFixed(1)} MB · Ready to transcribe</span></div></div><AudioPreview file={flow.audio} /><div className="action-row"><button className="primary-button" onClick={() => void flow.transcribe(flow.audio!)}>{flow.state === 'error' ? 'Try transcription again' : 'Transcribe audio'}</button><button className="text-button" onClick={() => download(flow.audio!, flow.audio!.name)}><Download size={15} aria-hidden="true" />Save audio</button></div><div className="replace-actions"><button className="text-button" onClick={onUpload}>Choose another file</button><button className="text-button" onClick={() => void flow.startRecording()}>Record instead</button></div></div> : <Welcome ready={flow.ready} onStart={() => void flow.startRecording()} onUpload={onUpload} onPreset={onPreset} selectedPreset={selectedPreset} />)}
  </section>;
}

export function AudioPreview({ file }: { file: File }) {
  const [url, setUrl] = useState('');
  useEffect(() => { const next = URL.createObjectURL(file); setUrl(next); return () => URL.revokeObjectURL(next); }, [file]);
  return url ? <audio controls preload="metadata" src={url} aria-label="Preview selected audio" /> : null;
}

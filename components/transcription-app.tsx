'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, Clock3, Copy, Download, FileAudio, FileText, Mic, Pause, Play, Search, ShieldCheck, Sparkles, Square, Upload } from 'lucide-react';
import { useLiveInterruption } from '@/lib/use-live-interruption';
import { useTranscription } from '@/lib/use-transcription';
import { AUDIO_ACCEPT } from '@/lib/audio/validation';
import { download } from '@/lib/export';
import { WorkspaceSidebar, type SavedMeeting, type WorkspaceView } from './workspace-sidebar';
import { WorkspaceContext, emptyContext, type MeetingContext } from './workspace-context';

const storageKey = 'hush.meetings.v1';
const stateLabels = { initial: 'Ready to listen', requesting: 'Waiting for microphone permission', recording: 'Listening', paused: 'Recording paused', stopping: 'Finishing live transcript', 'audio-ready': 'Audio ready', uploading: 'Uploading audio', transcribing: 'Finalizing transcript', success: 'Meeting complete', error: 'Needs attention' };
function clock(seconds: number) { return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
function dateLabel(date: number) { return new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
function safeContext(value: unknown): MeetingContext {
  if (!value || typeof value !== 'object') return emptyContext;
  const item = value as Record<string, unknown>;
  const strings = (key: string) => Array.isArray(item[key]) ? item[key].filter((entry: unknown): entry is string => typeof entry === 'string').slice(0, 50) : [];
  return { summary: typeof item.summary === 'string' ? item.summary : '', topics: strings('topics'), decisions: strings('decisions'), actionItems: strings('actionItems'), unresolvedQuestions: strings('unresolvedQuestions') };
}

export function TranscriptionApp() {
  const live = useLiveInterruption();
  const { finalize } = live;
  const flow = useTranscription({ onMeetingStart: live.start, onMeetingStop: live.stop, onTranscript: live.acceptTranscript, onVoice: live.onVoice, onPaused: live.setPaused, suppressed: live.suppressCapture });
  const fileInput = useRef<HTMLInputElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const transcriptScroll = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const meetingId = useRef('');
  const [title, setTitle] = useState('Untitled meeting');
  const [view, setView] = useState<WorkspaceView>('meeting');
  const [panel, setPanel] = useState<'transcript' | 'context'>('transcript');
  const [meetings, setMeetings] = useState<SavedMeeting[]>([]);
  const [opened, setOpened] = useState<SavedMeeting | null>(null);
  const [historyReady, setHistoryReady] = useState(false);
  const [storageNotice, setStorageNotice] = useState('');
  const [copyFeedback, setCopyFeedback] = useState('');
  const [query, setQuery] = useState('');
  const busy = flow.state === 'uploading' || flow.state === 'transcribing' || flow.state === 'stopping';
  const recording = flow.state === 'recording';
  const paused = flow.state === 'paused';
  const requesting = flow.state === 'requesting';
  const active = recording || paused;
  const locked = active || busy || requesting;
  const finished = flow.state === 'success' || !!opened;
  const transcript = opened ? opened.transcript : flow.transcript;
  const context = opened ? opened.context : live.context;
  const notes = opened ? opened.notes : live.notes;
  const canChoose = !locked && !finished;
  const showLive = active || busy || (!finished && (flow.segments.length > 0 || !!flow.partialTranscript));
  const aiLabel = !live.enabled ? 'Clarifications paused' : paused ? 'Paused' : live.status === 'speaking' ? 'AI asking' : live.status === 'waiting' ? 'Possible clarification' : live.status === 'thinking' ? 'Understanding' : active ? 'Listening' : 'Ready to listen';

  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]');
      if (Array.isArray(saved)) setMeetings(saved.filter((item): item is SavedMeeting => !!item && typeof item === 'object' && typeof item.id === 'string' && typeof item.title === 'string' && typeof item.transcript === 'string' && typeof item.date === 'number').map(item => ({ ...item, notes: typeof item.notes === 'string' ? item.notes : '', elapsed: Number.isFinite(item.elapsed) ? item.elapsed : 0, context: safeContext(item.context) })).slice(0, 30));
    } catch { setStorageNotice('Meeting history is unavailable. You can still copy or download your transcript.'); }
    setHistoryReady(true);
  }, []);
  useEffect(() => {
    if (!historyReady) return;
    try { localStorage.setItem(storageKey, JSON.stringify(meetings)); }
    catch { setStorageNotice('Device storage is full or unavailable. Download your transcript to keep a copy.'); }
  }, [meetings, historyReady]);
  useEffect(() => { if (flow.state === 'success' && !opened) finalize(flow.transcript); }, [flow.state, flow.transcript, finalize, opened]);
  useEffect(() => { if (finished && view === 'meeting' && panel === 'transcript') editor.current?.focus(); }, [finished, view, panel]);
  useEffect(() => {
    if (flow.state !== 'success' || opened || !historyReady) return;
    if (!meetingId.current) meetingId.current = crypto.randomUUID();
    const id = meetingId.current;
    setMeetings(previous => {
      const existing = previous.find(item => item.id === id);
      const next = { id, title: title.trim() || 'Untitled meeting', transcript: flow.transcript, notes: live.notes, context: live.context, date: existing?.date ?? Date.now(), elapsed: flow.elapsed };
      return [next, ...previous.filter(item => item.id !== id)].slice(0, 30);
    });
  }, [flow.state, flow.transcript, flow.elapsed, title, live.notes, live.context, opened, historyReady]);
  useEffect(() => { setCopyFeedback(''); }, [transcript]);
  useEffect(() => {
    if (!copyFeedback) return;
    const timer = setTimeout(() => setCopyFeedback(''), 2500);
    return () => clearTimeout(timer);
  }, [copyFeedback]);
  useEffect(() => {
    const element = transcriptScroll.current;
    if (element && nearBottom.current) element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
  }, [flow.partialTranscript, flow.segments, live.asked]);

  function cancel() { flow.cancel(); live.reset(); }
  function newMeeting() { if (locked) return; flow.reset(); live.reset(); setOpened(null); meetingId.current = ''; setTitle('Untitled meeting'); setView('meeting'); setPanel('transcript'); nearBottom.current = true; }
  function openMeeting(id: string) { if (locked) return; const item = meetings.find(meeting => meeting.id === id); if (!item) return; flow.reset(); live.reset(); setOpened(item); meetingId.current = item.id; setTitle(item.title); setView('meeting'); setPanel('transcript'); }
  const saveOpened = useCallback((updates: Partial<SavedMeeting>) => {
    setOpened(current => current ? { ...current, ...updates } : current);
    setMeetings(previous => previous.map(item => item.id === meetingId.current ? { ...item, ...updates } : item));
  }, []);
  function updateTitle(value: string) { setTitle(value); if (opened) saveOpened({ title: value.trim() || 'Untitled meeting' }); }
  async function copyTranscript() {
    try { await navigator.clipboard.writeText(transcript); setCopyFeedback('Copied'); }
    catch { editor.current?.focus(); editor.current?.select(); setCopyFeedback('Select and copy the transcript, or download it below.'); }
  }
  const matches = meetings.filter(meeting => `${meeting.title} ${meeting.transcript} ${meeting.notes}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  const elapsed = opened ? opened.elapsed : flow.elapsed;
  const timeline = [...flow.segments, ...live.asked.map((asked, index) => ({ id: `ai-${index}-${asked.gapKey}`, speaker: 'Hush:', text: asked.question, at: asked.at ?? 0, source: 'ai' as const }))].sort((a, b) => a.at - b.at);

  return <div className={`workspace-shell ${panel === 'context' && view === 'meeting' ? 'context-visible' : ''}`}>
    <WorkspaceSidebar view={view} meetings={meetings} selectedId={opened?.id ?? (finished ? meetingId.current : null)} onView={setView} onNew={newMeeting} onOpen={openMeeting} locked={locked} />
    <main className="workspace-main">
      <header className="workspace-header"><div className="workspace-breadcrumb">Your workspace<ChevronRight size={12} aria-hidden="true" /><span>{view === 'meeting' ? 'Meeting' : view.charAt(0).toUpperCase() + view.slice(1)}</span></div><span className="privacy-label"><ShieldCheck size={13} aria-hidden="true" />Private workspace</span></header>
      {view === 'meeting' ? <>
        <div className="meeting-heading"><div><label htmlFor="meeting-title" className="eyebrow">{finished ? 'COMPLETED MEETING' : 'MEETING WORKSPACE'}</label><input id="meeting-title" aria-label="Meeting title" className="meeting-title" value={title} maxLength={120} onChange={event => updateTitle(event.target.value)} /><p>{opened ? dateLabel(opened.date) : 'A clear transcript. Thoughtful questions. Every next step.'}</p></div><span className={`meeting-badge ${active ? 'is-live' : ''}`}><span className="status-dot" />{finished ? 'Saved meeting' : paused ? 'Paused' : recording ? 'LIVE' : 'Ready'}</span></div>
        <div className="meeting-meta"><span><Clock3 size={14} aria-hidden="true" /><time className="recording-time" aria-label={`${Math.floor(elapsed / 60)} minutes ${elapsed % 60} seconds`}>{clock(elapsed)}</time></span><span><Mic size={14} aria-hidden="true" />{recording ? 'Microphone on' : paused ? 'Microphone paused' : flow.micPermission === 'denied' ? 'Microphone blocked' : flow.micPermission === 'unavailable' ? 'Microphone unavailable' : flow.micPermission === 'granted' ? 'Microphone ready' : requesting ? 'Permission requested' : 'Microphone permission on start'}</span><span className="language-label">EN / ID · Auto language</span></div>
        <div className="workspace-tabs" role="tablist" aria-label="Meeting panels"><button role="tab" aria-selected={panel === 'transcript'} onClick={() => setPanel('transcript')}><FileText size={14} aria-hidden="true" />Transcript</button><button role="tab" aria-selected={panel === 'context'} onClick={() => setPanel('context')}><Sparkles size={14} aria-hidden="true" />Context & notes</button></div>
        <div className="meeting-body">
          {flow.error && <div className="error-message" role="alert">{flow.error}</div>}
          {flow.notice && <p className="notice-message" role="status">{flow.notice}</p>}
          {flow.liveNotice && <p className="notice-message" role="status">{flow.liveNotice}</p>}
          {storageNotice && <p className="notice-message" role="status">{storageNotice}</p>}
          <section className="transcript-card" aria-label={finished ? 'Transcription result' : 'Audio transcription'} aria-busy={busy}>
            <div className="transcript-toolbar"><h2><FileText size={16} aria-hidden="true" />{finished ? 'Meeting transcript' : 'Live transcript'}</h2><span className="transcript-state" role="status"><span className={`status-dot ${recording ? 'is-recording' : ''} ${flow.state === 'error' ? 'is-error' : ''}`} />{opened ? 'Meeting complete' : stateLabels[flow.state]}</span></div>
            {requesting && <div className="permission-state"><span className="microphone-mark"><Mic size={24} aria-hidden="true" /></span><h2>Allow your microphone</h2><p>Choose Allow in your browser’s permission prompt to start recording.</p><button className="text-button" onClick={cancel}>Cancel</button></div>}
            {showLive && <section className="live-transcript" aria-label="Live transcript"><div ref={transcriptScroll} className="transcript-scroll" onScroll={event => { const node = event.currentTarget; nearBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100; }}>
              {!flow.segments.length && !flow.partialTranscript && <div className="transcript-waiting"><span className="listening-mark"><Mic size={20} aria-hidden="true" /></span><h3>{paused ? 'Your recording is paused' : 'Listening to your conversation'}</h3><p>{paused ? 'Resume when you are ready. Your transcript stays here.' : 'Your words will appear here as you speak.'}</p></div>}
              {timeline.map(segment => <article className={`transcript-entry ${segment.source === 'ai' ? 'ai-transcript-entry' : ''}`} key={segment.id}><div className="speaker-avatar">{segment.source === 'ai' ? <Sparkles size={13} aria-hidden="true" /> : segment.speaker.slice(0, 1)}</div><div><div className="transcript-entry-heading"><strong>{segment.speaker}</strong>{segment.at > 0 && <time>{new Date(segment.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>}<span>{segment.source === 'ai' ? 'Clarification' : 'Final'}</span></div><p>{segment.text}</p></div></article>)}
              {flow.partialTranscript && <article className="transcript-entry is-partial"><div className="speaker-avatar">P</div><div><div className="transcript-entry-heading"><strong>Participant</strong><time>{new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time><span className="partial-label">Speaking…</span></div><p>{flow.partialTranscript}<span className="transcript-cursor" aria-hidden="true" /></p></div></article>}
            </div><div className="transcript-live-footer"><span><span className={`status-dot ${recording ? 'is-recording' : ''}`} />{paused ? 'Paused · transcript preserved' : flow.streamStatus === 'reconnecting' ? 'Reconnecting the live stream' : flow.streamStatus === 'connecting' ? 'Connecting live transcription' : recording ? 'Updates as you speak' : busy ? 'Live text preserved while we finalize' : 'Captured transcript'}</span><span>{flow.segments.length} finalized {flow.segments.length === 1 ? 'turn' : 'turns'}</span></div></section>}
            {busy && <div className="processing-state"><span className="loading-ring" aria-hidden="true" /><div><h2>{flow.state === 'uploading' ? 'Sending your audio…' : flow.state === 'stopping' ? 'Finishing live transcript…' : 'Transcribing…'}</h2><p>{flow.state === 'uploading' ? `${flow.progress}% uploaded` : flow.state === 'stopping' ? 'Collecting the final words from the stream.' : 'Checking the complete recording for a polished final transcript.'}</p></div><button className="text-button" onClick={cancel}>Cancel transcription</button></div>}
            {canChoose && (flow.audio ? <div className="audio-ready"><div className="selected-file"><FileAudio size={24} aria-hidden="true" /><div><strong>{flow.audio.name}</strong><span>{(flow.audio.size / 1024 / 1024).toFixed(1)} MB · Ready to transcribe</span></div></div><AudioPreview file={flow.audio} /><div className="action-row"><button className="primary-button" onClick={() => void flow.transcribe(flow.audio!)}>{flow.state === 'error' ? 'Try transcription again' : 'Transcribe audio'}</button><button className="text-button" onClick={() => download(flow.audio!, flow.audio!.name)}><Download size={15} aria-hidden="true" />Save audio</button></div><div className="replace-actions"><button className="text-button" onClick={() => fileInput.current?.click()}>Choose another file</button><button className="text-button" onClick={() => void flow.startRecording()}>Record instead</button></div></div> : <div className="initial-controls"><span className="microphone-mark"><Mic size={27} aria-hidden="true" /></span><h2>Let the conversation flow.</h2><p>Speak naturally. Hush captures your words as you talk<br className="desktop-break" /> and helps clarify the details that matter.</p><div className="initial-actions"><button className="primary-button" disabled={!flow.ready} onClick={() => void flow.startRecording()}><Mic size={17} aria-hidden="true" />Start recording</button><button className="secondary-button" onClick={() => fileInput.current?.click()}><Upload size={17} aria-hidden="true" />Upload audio</button></div><p className="file-hint">MP3, WAV, M4A, WebM, OGG · Up to 12 MB</p><p className="recording-hint">Record up to 15 minutes at a time.</p></div>)}
            {finished && <div className="transcript-result"><div className="transcript-heading"><label htmlFor="transcript">Meeting transcript</label><span>Click to edit · saved on this device</span></div><textarea ref={editor} id="transcript" value={transcript} onChange={event => opened ? saveOpened({ transcript: event.target.value }) : flow.setTranscript(event.target.value)} spellCheck rows={12} /><div className="result-actions"><button className="primary-button" onClick={() => void copyTranscript()} disabled={!transcript.trim()}>{copyFeedback === 'Copied' ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}{copyFeedback === 'Copied' ? 'Copied' : 'Copy transcript'}</button><button className="secondary-button" onClick={() => download(new Blob([transcript], { type: 'text/plain;charset=utf-8' }), 'meeting-transcript.txt')} disabled={!transcript.trim()}><Download size={16} aria-hidden="true" />Download .txt</button><button className="text-button" onClick={newMeeting}>New transcription</button></div><p className="copy-feedback" role="status">{copyFeedback}</p><p className="edit-caption">Review names and numbers before sharing.</p></div>}
          </section>
          {active && live.question && <section className="ai-question-card" aria-label="AI clarification"><div className="ai-question-heading"><Sparkles size={16} aria-hidden="true" /><span>{live.status === 'speaking' ? 'AI question' : 'Possible clarification'}</span><span className="question-confidence">{Math.round(live.questionConfidence * 100)}% confidence</span></div><p className="ai-question-body">{live.question}</p>{live.questionReason && <p className="question-reason">{live.questionReason}</p>}</section>}
          <div className="meeting-guidance"><ShieldCheck size={15} aria-hidden="true" /><p>{finished ? 'Your transcript and notes are saved on this browser. Audio is not stored in meeting history.' : 'Questions wait for natural pauses. Recording keeps your complete audio available for transcription.'}</p></div>
        </div>
        <div className="meeting-control-dock"><div className="capture-status"><div className={`capture-icon ${recording ? 'is-recording' : ''}`}><Mic size={18} aria-hidden="true" /></div><div><strong>{recording ? 'Microphone active' : paused ? 'Recording paused' : finished ? 'Meeting complete' : busy ? 'Finishing your meeting' : 'Ready for your next conversation'}</strong><span>{recording ? live.status === 'speaking' ? 'AI is asking a question…' : aiLabel : paused ? 'Resume to continue capturing' : 'Indonesian, English, or a little of both'}</span></div></div><Waveform level={flow.level} active={recording && !live.suppressCapture} /><div className="capture-actions">{active && <><button className="secondary-button" onClick={paused ? flow.resumeRecording : flow.pauseRecording}>{paused ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}{paused ? 'Resume recording' : 'Pause recording'}</button><button className="primary-button stop-button" onClick={flow.stopRecording}><Square size={13} fill="currentColor" aria-hidden="true" />Stop recording</button><button className="text-button cancel-recording" onClick={cancel}>Cancel recording</button></>}</div></div>
        <input ref={fileInput} className="visually-hidden" type="file" accept={AUDIO_ACCEPT} aria-label="Choose audio file" tabIndex={-1} disabled={!canChoose} onChange={event => { const file = event.target.files?.[0]; if (file) flow.selectAudio(file); event.target.value = ''; }} />
      </> : <section className="workspace-library" aria-label={view === 'settings' ? 'Workspace settings' : 'Saved meetings'}><div className="library-heading"><span className="eyebrow">YOUR WORKSPACE</span><h1>{view === 'meetings' ? 'Meetings' : view === 'notes' ? 'Meeting notes' : view === 'search' ? 'Find a conversation' : 'Settings'}</h1><p>{view === 'settings' ? 'Choose how Hush participates in your meetings.' : 'Your completed conversations, saved on this device.'}</p></div>{locked && <p className="notice-message" role="status">Your recording continues. Return to Workspace for the live transcript and recording controls.</p>}{view === 'settings' ? <><div className="settings-card"><div><h2>AI clarifications</h2><p>Ask useful questions when important details are missing, at natural pauses.</p></div><button className={`ai-voice-toggle ${live.enabled ? 'is-active' : ''}`} aria-pressed={live.enabled} onClick={live.toggleEnabled}>AI Interruption: {live.enabled ? 'ON' : 'OFF'}</button></div><div className="settings-card"><div><h2>Spoken questions</h2><p>Play clarification questions aloud. You can always read them on screen.</p></div><button className={`ai-voice-toggle ${live.voiceEnabled ? 'is-active' : ''}`} aria-pressed={live.voiceEnabled} onClick={live.toggleVoice}>AI Voice: {live.voiceEnabled ? 'ON' : 'OFF'}</button></div><div className="settings-card"><div><h2>Meeting storage</h2><p>Up to 30 completed meetings are saved in this browser. Audio is available during your session and can be downloaded.</p></div><span className="setting-value">{meetings.length} meetings</span></div></> : <>{view === 'search' && <label className="meeting-search"><Search size={18} aria-hidden="true" /><input aria-label="Search meetings" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search titles, transcripts, or notes…" /></label>}<div className="meeting-list">{(view === 'search' ? matches : meetings).length ? (view === 'search' ? matches : meetings).map(meeting => <button className="saved-meeting-card" key={meeting.id} onClick={() => openMeeting(meeting.id)} disabled={locked}><FileText size={19} aria-hidden="true" /><div><h2>{meeting.title}</h2><span>{dateLabel(meeting.date)} · {clock(meeting.elapsed)}</span><p>{view === 'notes' ? meeting.notes || meeting.context.summary || 'No AI notes for this meeting. Open to review its transcript.' : meeting.context.summary || meeting.transcript.slice(0, 180)}</p></div><ChevronRight size={16} aria-hidden="true" /></button>) : <div className="library-empty"><FileText size={26} aria-hidden="true" /><h2>{view === 'search' && query ? 'No matching meetings' : 'Your conversations belong here.'}</h2><p>{view === 'search' && query ? 'Try another word from the title, transcript, or notes.' : 'Complete a recording or upload audio to save your first meeting.'}</p><button className="primary-button" onClick={newMeeting} disabled={locked}>New Meeting</button></div>}</div></>}</section>}
    </main>
    <div className={`context-wrapper ${view !== 'meeting' ? 'is-library-context' : ''}`}><WorkspaceContext context={context} status={paused ? 'paused' : live.status} notes={notes} notice={opened ? '' : live.notice} enabled={live.enabled} active={active && !paused} retry={flow.state === 'success' && !opened ? () => finalize(flow.transcript) : undefined} /><div className="context-controls" aria-label="AI meeting controls"><button className={`ai-voice-toggle ${live.enabled ? 'is-active' : ''}`} aria-pressed={live.enabled} onClick={live.toggleEnabled}>AI Interruption: {live.enabled ? 'ON' : 'OFF'}</button><button className={`ai-voice-toggle ${live.voiceEnabled ? 'is-active' : ''}`} aria-pressed={live.voiceEnabled} onClick={live.toggleVoice}>AI Voice: {live.voiceEnabled ? 'ON' : 'OFF'}</button></div></div>
  </div>;
}

function Waveform({ level, active }: { level: number; active: boolean }) {
  return <div className={`audio-waveform ${active ? 'is-active' : ''}`} aria-label={active ? 'Microphone audio level' : 'Microphone idle'} role="img">{Array.from({ length: 20 }, (_, index) => <i key={index} style={{ height: `${active ? 4 + Math.min(level * 120, 28) * (0.3 + (Math.sin(index * 1.8) + 1) / 3) : 4}px` }} />)}</div>;
}
function AudioPreview({ file }: { file: File }) {
  const [url, setUrl] = useState('');
  useEffect(() => { const audioUrl = URL.createObjectURL(file); setUrl(audioUrl); return () => URL.revokeObjectURL(audioUrl); }, [file]);
  return url ? <audio controls preload="metadata" src={url} aria-label="Preview selected audio" /> : null;
}

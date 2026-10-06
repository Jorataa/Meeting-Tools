'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronRight, Clock3, Copy, Download, FileAudio, FileText, Mic, Pause, Play, Search, ShieldCheck, Sparkles, Square, Trash2, Upload } from 'lucide-react';
import { useLiveInterruption } from '@/lib/use-live-interruption';
import type { MeetingContext } from '@/lib/live/policy';
import { useTranscription } from '@/lib/use-transcription';
import { AUDIO_ACCEPT } from '@/lib/audio/validation';
import { download } from '@/lib/export';
import { useMeetingHistory } from '@/lib/meeting-storage';
import { WorkspaceSidebar, type SavedMeeting, type WorkspaceView } from './workspace-sidebar';
import { WorkspaceContext } from './workspace-context';
import { WorkspaceSettings } from './workspace-settings';

const stateLabels = { initial: 'Ready to listen', requesting: 'Waiting for microphone permission', recording: 'Listening', paused: 'Recording paused', stopping: 'Finishing live transcript', 'audio-ready': 'Audio ready', uploading: 'Uploading audio', transcribing: 'Finalizing transcript', success: 'Meeting complete', error: 'Needs attention' };
function clock(seconds: number) { return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
function dateLabel(date: number) { return new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
export function TranscriptionApp({ ownerId = 'demo', accountEmail, onSignOut }: { ownerId?: string; accountEmail?: string; onSignOut?: () => void }) {
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
  const { meetings, setMeetings, historyReady, storageNotice, retention, setRetention, removeMeeting, clearHistory } = useMeetingHistory(ownerId);
  const [opened, setOpened] = useState<SavedMeeting | null>(null);
  const [restoredNotice, setRestoredNotice] = useState('');
  const restoredOnce = useRef(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState<'meeting' | 'history' | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState('');
  const [query, setQuery] = useState('');
  const busy = flow.state === 'uploading' || flow.state === 'transcribing' || flow.state === 'stopping';
  const recording = flow.state === 'recording';
  const paused = flow.state === 'paused';
  const requesting = flow.state === 'requesting';
  const active = recording || paused;
  const locked = active || busy || requesting || deleting;
  const finished = flow.state === 'success' || !!opened;
  const transcript = opened ? opened.transcript : flow.transcript;
  const context = opened ? opened.context : live.context;
  const notes = opened ? opened.notes : live.notes;
  const canChoose = !locked && !finished;
  const showLive = active || busy || (!finished && (flow.segments.length > 0 || !!flow.partialTranscript));
  const aiLabel = !live.enabled ? 'Clarifications paused' : paused ? 'Paused' : live.status === 'speaking' ? 'AI asking' : live.status === 'waiting' ? 'Possible clarification' : live.status === 'thinking' ? 'Understanding' : active ? 'Listening' : 'Ready to listen';

  useEffect(() => { if (flow.state === 'success' && !opened) finalize(flow.transcript); }, [flow.state, flow.transcript, finalize, opened]);
  useEffect(() => { if (finished && view === 'meeting' && panel === 'transcript') editor.current?.focus(); }, [finished, view, panel]);
  useEffect(() => {
    if (!historyReady || restoredOnce.current) return;
    restoredOnce.current = true;
    try {
      const activeId = sessionStorage.getItem(`hush.activeMeeting.${encodeURIComponent(ownerId)}`);
      if (!activeId) return;
      const match = meetings.find(item => item.id === activeId);
      if (match) {
        setOpened(match);
        meetingId.current = match.id;
        setTitle(match.title);
        setView('meeting');
        setPanel('transcript');
        setRestoredNotice('Meeting restored');
        const timer = setTimeout(() => setRestoredNotice(''), 4000);
        return () => clearTimeout(timer);
      }
    } catch { /* storage fallback */ }
  }, [historyReady, meetings, ownerId]);
  useEffect(() => {
    try {
      if (opened?.id) sessionStorage.setItem(`hush.activeMeeting.${encodeURIComponent(ownerId)}`, opened.id);
    } catch { /* storage fallback */ }
  }, [opened?.id, ownerId]);
  useEffect(() => {
    if (flow.state !== 'success' || opened || !historyReady) return;
    if (!meetingId.current) meetingId.current = crypto.randomUUID();
    const id = meetingId.current;
    try { sessionStorage.setItem(`hush.activeMeeting.${encodeURIComponent(ownerId)}`, id); } catch { /* storage fallback */ }
    setMeetings(previous => {
      const existing = previous.find(item => item.id === id);
      const next = { id, title: title.trim() || 'Untitled meeting', transcript: flow.transcript, notes: live.notes, context: live.context, date: existing?.date ?? Date.now(), elapsed: flow.elapsed, questions: live.questionHistory.map(item => `${item.question.slice(0, item.disposition === 'dismissed' ? 228 : 240)}${item.disposition === 'dismissed' ? ' (dismissed)' : ''}`) };
      return [next, ...previous.filter(item => item.id !== id)].slice(0, 30);
    });
  }, [flow.state, flow.transcript, flow.elapsed, title, live.notes, live.context, live.questionHistory, opened, historyReady, setMeetings, ownerId]);
  useEffect(() => { setCopyFeedback(''); }, [transcript]);
  useEffect(() => {
    if (!copyFeedback) return;
    const timer = setTimeout(() => setCopyFeedback(''), 2500);
    return () => clearTimeout(timer);
  }, [copyFeedback]);
  useEffect(() => {
    const element = transcriptScroll.current;
    if (element && nearBottom.current) element.scrollTo({ top: element.scrollHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [flow.partialTranscript, flow.segments, live.asked]);

  function cancel() { flow.cancel(); live.reset(); }
  function newMeeting() {
    if (locked) return;
    setDeleteConfirmation(null);
    flow.reset();
    live.reset();
    setOpened(null);
    meetingId.current = '';
    setTitle('Untitled meeting');
    setView('meeting');
    setPanel('transcript');
    nearBottom.current = true;
    try { sessionStorage.removeItem(`hush.activeMeeting.${encodeURIComponent(ownerId)}`); } catch { /* storage fallback */ }
  }
  function openMeeting(id: string) {
    if (locked) return;
    setDeleteConfirmation(null);
    const item = meetings.find(meeting => meeting.id === id);
    if (!item) return;
    flow.reset();
    live.reset();
    setOpened(item);
    meetingId.current = item.id;
    setTitle(item.title);
    setView('meeting');
    setPanel('transcript');
    try { sessionStorage.setItem(`hush.activeMeeting.${encodeURIComponent(ownerId)}`, item.id); } catch { /* storage fallback */ }
  }
  const saveOpened = useCallback((updates: Partial<SavedMeeting>) => {
    setOpened(current => current ? { ...current, ...updates } : current);
    setMeetings(previous => previous.map(item => item.id === meetingId.current ? { ...item, ...updates } : item));
  }, [setMeetings]);
  const [frequency, setFrequency] = useState<'balanced' | 'minimal'>('balanced');
  const [language, setLanguage] = useState<'auto' | 'en' | 'id'>('auto');
  const [summaryStyle, setSummaryStyle] = useState<'concise' | 'structured'>('concise');

  useEffect(() => {
    try {
      const stored = localStorage.getItem(`hush.prefs.${encodeURIComponent(ownerId)}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.frequency) setFrequency(parsed.frequency);
        if (parsed.language) setLanguage(parsed.language);
        if (parsed.summaryStyle) setSummaryStyle(parsed.summaryStyle);
      }
    } catch { /* storage fallback */ }
  }, [ownerId]);

  const updateFrequency = useCallback((val: 'balanced' | 'minimal') => {
    setFrequency(val);
    try {
      const stored = JSON.parse(localStorage.getItem(`hush.prefs.${encodeURIComponent(ownerId)}`) || '{}');
      localStorage.setItem(`hush.prefs.${encodeURIComponent(ownerId)}`, JSON.stringify({ ...stored, frequency: val }));
    } catch { /* noop */ }
  }, [ownerId]);

  const updateLanguage = useCallback((val: 'auto' | 'en' | 'id') => {
    setLanguage(val);
    try {
      const stored = JSON.parse(localStorage.getItem(`hush.prefs.${encodeURIComponent(ownerId)}`) || '{}');
      localStorage.setItem(`hush.prefs.${encodeURIComponent(ownerId)}`, JSON.stringify({ ...stored, language: val }));
    } catch { /* noop */ }
  }, [ownerId]);

  const updateSummaryStyle = useCallback((val: 'concise' | 'structured') => {
    setSummaryStyle(val);
    try {
      const stored = JSON.parse(localStorage.getItem(`hush.prefs.${encodeURIComponent(ownerId)}`) || '{}');
      localStorage.setItem(`hush.prefs.${encodeURIComponent(ownerId)}`, JSON.stringify({ ...stored, summaryStyle: val }));
    } catch { /* noop */ }
  }, [ownerId]);

  const handleApproveActionItem = useCallback((index: number) => {
    const updater = (current: MeetingContext): MeetingContext => {
      const items = current.structuredActionItems ? [...current.structuredActionItems] : [];
      if (!items[index]) return current;
      items[index] = { ...items[index], approved: true };
      return { ...current, structuredActionItems: items };
    };
    if (opened) saveOpened({ context: updater(opened.context) });
    else live.updateContext(updater);
  }, [opened, saveOpened, live]);

  const handleDismissActionItem = useCallback((index: number) => {
    const updater = (current: MeetingContext): MeetingContext => {
      const items = current.structuredActionItems ? current.structuredActionItems.filter((_, i) => i !== index) : [];
      return { ...current, structuredActionItems: items };
    };
    if (opened) saveOpened({ context: updater(opened.context) });
    else live.updateContext(updater);
  }, [opened, saveOpened, live]);

  const handleResolveQuestion = useCallback((questionText: string) => {
    const updater = (current: MeetingContext): MeetingContext => {
      const unresolved = current.unresolvedQuestions.filter(q => q !== questionText);
      const resolved = current.resolvedQuestions ? [...current.resolvedQuestions, questionText] : [questionText];
      return { ...current, unresolvedQuestions: unresolved, resolvedQuestions: resolved };
    };
    if (opened) saveOpened({ context: updater(opened.context) });
    else live.updateContext(updater);
  }, [opened, saveOpened, live]);
  async function deleteMeeting() {
    if (deleting) return;
    setDeleting(true);
    const id = meetingId.current;
    const deleted = await removeMeeting(id);
    setDeleting(false);
    if (deleted) {
      flow.reset(); live.reset(); setOpened(null); meetingId.current = ''; setTitle('Untitled meeting'); setDeleteConfirmation(null);
      try { sessionStorage.removeItem(`hush.activeMeeting.${encodeURIComponent(ownerId)}`); } catch { /* storage fallback */ }
    }
  }
  async function deleteHistory() {
    if (deleteConfirmation !== 'history') { setDeleteConfirmation('history'); return; }
    if (deleting) return;
    setDeleting(true);
    const deleted = await clearHistory();
    setDeleting(false);
    if (deleted) {
      flow.reset(); live.reset(); setOpened(null); meetingId.current = ''; setTitle('Untitled meeting'); setDeleteConfirmation(null);
      try { sessionStorage.removeItem(`hush.activeMeeting.${encodeURIComponent(ownerId)}`); } catch { /* storage fallback */ }
    }
  }
  function updateTitle(value: string) { setTitle(value); if (opened) saveOpened({ title: value.trim() || 'Untitled meeting' }); }
  async function copyTranscript() {
    try { await navigator.clipboard.writeText(transcript); setCopyFeedback('Copied'); }
    catch { editor.current?.focus(); editor.current?.select(); setCopyFeedback('Select and copy the transcript, or download it below.'); }
  }
  const matches = useMemo(() => meetings.filter(meeting => `${meeting.title} ${meeting.transcript} ${meeting.notes} ${JSON.stringify(meeting.context)} ${(meeting.questions || []).join(' ')}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [meetings, query]);
  const elapsed = opened ? opened.elapsed : flow.elapsed;
  const timeline = useMemo(() => [...flow.segments, ...live.asked.filter(item => item.disposition !== 'dismissed').map((asked, index) => ({ id: `ai-${index}-${asked.gapKey}`, speaker: 'Hush:', text: asked.question, at: asked.at ?? 0, source: 'ai' as const }))].sort((a, b) => a.at - b.at), [flow.segments, live.asked]);

  return <div className={`workspace-shell ${view !== 'meeting' ? 'library-view' : ''} ${panel === 'context' && view === 'meeting' ? 'context-visible' : ''}`}>
    <WorkspaceSidebar view={view} meetings={meetings} selectedId={opened?.id ?? (finished ? meetingId.current : null)} onView={setView} onNew={newMeeting} onOpen={openMeeting} locked={locked} accountEmail={accountEmail} onSignOut={onSignOut} />
    <main className="workspace-main">
      <header className="workspace-header"><div className="workspace-breadcrumb">Your workspace<ChevronRight size={12} aria-hidden="true" /><span>{view === 'meeting' ? 'Meeting' : view.charAt(0).toUpperCase() + view.slice(1)}</span></div><span className="privacy-label"><ShieldCheck size={13} aria-hidden="true" />{accountEmail ? 'Personal workspace' : 'On this device'}</span></header>
      {view === 'meeting' ? <>
        <div className="meeting-heading"><div><label htmlFor="meeting-title" className="eyebrow">{finished ? 'COMPLETED MEETING' : 'MEETING WORKSPACE'}</label><input id="meeting-title" aria-label="Meeting title" className="meeting-title" value={title} maxLength={120} onChange={event => updateTitle(event.target.value)} /><p>{opened ? dateLabel(opened.date) : 'Stay in the conversation. We’ll keep the details.'}</p></div><span className={`meeting-badge ${active ? 'is-live' : ''}`}><span className="status-dot" />{finished ? 'Saved meeting' : paused ? 'Paused' : recording ? 'LIVE' : 'Ready'}</span></div>
        <div className="meeting-meta"><span><Clock3 size={14} aria-hidden="true" /><time className="recording-time" aria-label={`${Math.floor(elapsed / 60)} minutes ${elapsed % 60} seconds`}>{clock(elapsed)}</time></span><span><Mic size={14} aria-hidden="true" />{recording ? 'Microphone on' : paused ? 'Microphone paused' : flow.micPermission === 'denied' ? 'Microphone blocked' : flow.micPermission === 'unavailable' ? 'Microphone unavailable' : flow.micPermission === 'granted' ? 'Microphone ready' : requesting ? 'Permission requested' : 'Microphone permission on start'}</span><span className="language-label">EN / ID · Auto language</span></div>
        <div className="workspace-tabs" role="tablist" aria-label="Meeting panels"><button role="tab" aria-selected={panel === 'transcript'} onClick={() => setPanel('transcript')}><FileText size={14} aria-hidden="true" />Transcript</button><button role="tab" aria-selected={panel === 'context'} onClick={() => setPanel('context')}><Sparkles size={14} aria-hidden="true" />Context & notes</button></div>
        <div className="meeting-body">
          {flow.error && <div className="error-message" role="alert">{flow.error}</div>}
          {flow.notice && <p className="notice-message" role="status">{flow.notice}</p>}
          {flow.liveNotice && <p className="notice-message" role="status">{flow.liveNotice}</p>}
          {storageNotice && <p className="notice-message" role="status">{storageNotice}</p>}
          {restoredNotice && <p className="notice-message restored-notice" role="status">{restoredNotice}</p>}
          <section className="transcript-card" aria-label={finished ? 'Transcription result' : 'Audio transcription'} aria-busy={busy}>
            <div className="transcript-toolbar"><h2><FileText size={16} aria-hidden="true" />{finished ? 'Meeting transcript' : 'Live transcript'}</h2><span className="transcript-state" role="status"><span className={`status-dot ${recording ? 'is-recording' : ''} ${flow.state === 'error' ? 'is-error' : ''}`} />{opened ? 'Meeting complete' : stateLabels[flow.state]}</span></div>
            {requesting && <div className="permission-state"><span className="microphone-mark"><Mic size={24} aria-hidden="true" /></span><h2>Allow your microphone</h2><p>Choose Allow in your browser’s permission prompt to start recording.</p><button className="text-button" onClick={cancel}>Cancel</button></div>}
            {showLive && <section className="live-transcript" aria-label="Live transcript"><div ref={transcriptScroll} className="transcript-scroll" onScroll={event => { const node = event.currentTarget; nearBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100; }}>
              {!flow.segments.length && !flow.partialTranscript && <div className="transcript-waiting"><span className="listening-mark"><Mic size={20} aria-hidden="true" /></span><h3>{paused ? 'Your recording is paused' : 'Listening to your conversation'}</h3><p>{paused ? 'Resume when you are ready. Your transcript stays here.' : 'Your words will appear here as you speak.'}</p></div>}
              {timeline.map(segment => <article className={`transcript-entry ${segment.source === 'ai' ? 'ai-transcript-entry' : ''}`} key={segment.id}><div className="speaker-avatar">{segment.source === 'ai' ? <Sparkles size={13} aria-hidden="true" /> : segment.speaker.slice(0, 1)}</div><div><div className="transcript-entry-heading"><strong>{segment.speaker}</strong>{segment.at > 0 && <time>{new Date(segment.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>}{segment.source === 'ai' && <span>Clarification</span>}</div><p>{segment.text}</p></div></article>)}
              {flow.partialTranscript && <article className="transcript-entry is-partial"><div className="speaker-avatar">P</div><div><div className="transcript-entry-heading"><strong>Participant</strong><time>{new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time><span className="partial-label">Speaking…</span></div><p aria-live="off">{flow.partialTranscript}<span className="transcript-cursor" aria-hidden="true" /></p></div></article>}
            </div><div className="transcript-live-footer"><span><span className={`status-dot ${recording ? 'is-recording' : ''}`} />{paused ? 'Paused · transcript preserved' : flow.streamStatus === 'reconnecting' ? 'Reconnecting the live stream' : flow.streamStatus === 'connecting' ? 'Connecting live transcription' : recording ? 'Updates as you speak' : busy ? 'Live text preserved while we finalize' : 'Captured transcript'}</span><span>{flow.segments.length} finalized {flow.segments.length === 1 ? 'turn' : 'turns'}</span></div></section>}
            {busy && <div className="processing-state"><span className="loading-ring" aria-hidden="true" /><div><h2>{flow.state === 'uploading' ? 'Sending your audio…' : flow.state === 'stopping' ? 'Finishing live transcript…' : 'Transcribing…'}</h2><p>{flow.state === 'uploading' ? `${flow.progress}% uploaded` : flow.state === 'stopping' ? 'Collecting the final words from the stream.' : 'Checking the complete recording for a polished final transcript.'}</p></div><button className="text-button" onClick={cancel}>Cancel transcription</button></div>}
            {canChoose && (flow.audio ? <div className="audio-ready"><div className="selected-file"><FileAudio size={24} aria-hidden="true" /><div><strong>{flow.audio.name}</strong><span>{(flow.audio.size / 1024 / 1024).toFixed(1)} MB · Ready to transcribe</span></div></div><AudioPreview file={flow.audio} /><div className="action-row"><button className="primary-button" onClick={() => void flow.transcribe(flow.audio!)}>{flow.state === 'error' ? 'Try transcription again' : 'Transcribe audio'}</button><button className="text-button" onClick={() => download(flow.audio!, flow.audio!.name)}><Download size={15} aria-hidden="true" />Save audio</button></div><div className="replace-actions"><button className="text-button" onClick={() => fileInput.current?.click()}>Choose another file</button><button className="text-button" onClick={() => void flow.startRecording()}>Record instead</button></div></div> : <div className="initial-controls"><span className="microphone-mark"><Mic size={27} aria-hidden="true" /></span><h2>Let the conversation flow.</h2><p>Speak naturally. Hush captures your words as you talk<br className="desktop-break" /> and helps clarify the details that matter.</p><div className="initial-actions"><button className="primary-button" disabled={!flow.ready} onClick={() => void flow.startRecording()}><Mic size={17} aria-hidden="true" />Start recording</button><button className="secondary-button" onClick={() => fileInput.current?.click()}><Upload size={17} aria-hidden="true" />Upload audio</button></div><p className="file-hint">MP3, WAV, M4A, WebM, OGG · Up to 12 MB</p><p className="recording-hint">Record up to 15 minutes at a time.</p></div>)}
            {finished && <div className="transcript-result"><div className="transcript-heading"><label htmlFor="transcript">Meeting transcript</label><span>Click to edit · {retention === 'device' ? accountEmail ? 'saved to your account' : 'saved on this device' : 'this session only'}</span></div><textarea ref={editor} id="transcript" maxLength={150000} value={transcript} onChange={event => opened ? saveOpened({ transcript: event.target.value }) : flow.setTranscript(event.target.value)} spellCheck rows={12} /><div className="result-actions"><button className="primary-button" onClick={() => void copyTranscript()} disabled={!transcript.trim()}>{copyFeedback === 'Copied' ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}{copyFeedback === 'Copied' ? 'Copied' : 'Copy transcript'}</button><button className="secondary-button" onClick={() => download(new Blob([transcript], { type: 'text/plain;charset=utf-8' }), 'meeting-transcript.txt')} disabled={!transcript.trim()}><Download size={16} aria-hidden="true" />Download .txt</button><button className="text-button" onClick={newMeeting}>New transcription</button><button className="text-button delete-meeting" onClick={() => setDeleteConfirmation('meeting')}><Trash2 size={14} aria-hidden="true" />Delete meeting</button></div>{deleteConfirmation === 'meeting' && <div className="delete-confirmation" role="alert"><p>Delete this meeting and its notes from this workspace?</p><button className="danger-button" disabled={deleting} onClick={() => void deleteMeeting()}>Confirm delete meeting</button><button className="text-button" onClick={() => setDeleteConfirmation(null)} disabled={deleting}>Keep meeting</button></div>}<p className="copy-feedback" role="status">{copyFeedback}</p><p className="edit-caption">Review names and numbers before sharing.</p></div>}
          </section>
          {active && live.question && <section className="ai-question-card" aria-label="AI clarification"><div className="ai-question-heading"><Sparkles size={16} aria-hidden="true" /><span>{live.status === 'speaking' ? 'AI question' : 'Possible clarification'}</span><button className="question-dismiss" onClick={live.dismissQuestion} aria-label="Dismiss AI question">Dismiss</button></div><p className="ai-question-body">{live.question}</p>{live.questionReason && <p className="question-reason">{live.questionReason}</p>}</section>}
          <div className="meeting-guidance"><ShieldCheck size={15} aria-hidden="true" /><p>{finished ? retention === 'device' ? accountEmail ? 'Transcript and notes save to your private account and this device. Audio is not saved in history.' : 'Transcript and notes stay on this device. Audio is not saved in history.' : 'Transcript and notes stay in this session. Export anything you want to keep.' : 'Questions wait for a pause. Audio stays in this tab and is sent to Gemini for transcription.'}</p></div>
        </div>
        <div className="meeting-control-dock"><div className="capture-status"><div className={`capture-icon ${recording ? 'is-recording' : ''}`}><Mic size={18} aria-hidden="true" /></div><div><strong>{recording ? 'Microphone active' : paused ? 'Recording paused' : finished ? 'Meeting complete' : busy ? 'Finishing your meeting' : 'Ready for your next conversation'}</strong><span>{recording ? live.status === 'speaking' ? 'AI is asking a question…' : aiLabel : paused ? 'Resume to continue capturing' : 'Indonesian, English, or a little of both'}</span></div></div><Waveform level={flow.level} active={recording && !live.suppressCapture} /><div className="capture-actions">{active && <><button className="secondary-button" onClick={paused ? flow.resumeRecording : flow.pauseRecording}>{paused ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}{paused ? 'Resume recording' : 'Pause recording'}</button><button className="primary-button stop-button" onClick={flow.stopRecording}><Square size={13} fill="currentColor" aria-hidden="true" />Stop recording</button><button className="text-button cancel-recording" onClick={cancel}>Cancel recording</button></>}</div></div>
        <input ref={fileInput} className="visually-hidden" type="file" accept={AUDIO_ACCEPT} aria-label="Choose audio file" tabIndex={-1} disabled={!canChoose} onChange={event => { const file = event.target.files?.[0]; if (file) flow.selectAudio(file); event.target.value = ''; }} />
      </> : <section className="workspace-library" aria-label={view === 'settings' ? 'Workspace settings' : 'Saved meetings'}><div className="library-heading"><span className="eyebrow">YOUR WORKSPACE</span><h1>{view === 'meetings' ? 'Meetings' : view === 'notes' ? 'Meeting notes' : view === 'search' ? 'Find a conversation' : 'Settings'}</h1><p>{view === 'settings' ? 'Choose how Hush participates in your meetings.' : accountEmail ? 'Your completed conversations, saved to your account.' : 'Your completed conversations, saved on this device.'}</p></div>{active && <p className="notice-message" role="status">Your recording continues. Return to Workspace for the live transcript and recording controls.</p>}{view === 'settings' ? <WorkspaceSettings enabled={live.enabled} voiceEnabled={live.voiceEnabled} toggleEnabled={live.toggleEnabled} toggleVoice={live.toggleVoice} retention={retention} setRetention={setRetention} meetingCount={meetings.length} locked={locked} confirming={deleteConfirmation === 'history'} onCancelDelete={() => setDeleteConfirmation(null)} onDelete={() => void deleteHistory()} onSignOut={onSignOut} accountEmail={accountEmail} frequency={frequency} setFrequency={updateFrequency} language={language} setLanguage={updateLanguage} summaryStyle={summaryStyle} setSummaryStyle={updateSummaryStyle} /> : <>{view === 'search' && <label className="meeting-search"><Search size={18} aria-hidden="true" /><input aria-label="Search meetings" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search titles, transcripts, or notes…" /></label>}<div className="meeting-list">{(view === 'search' ? matches : meetings).length ? (view === 'search' ? matches : meetings).map(meeting => <button className="saved-meeting-card" key={meeting.id} onClick={() => openMeeting(meeting.id)} disabled={locked}><FileText size={19} aria-hidden="true" /><div><h2>{meeting.title}</h2><span>{dateLabel(meeting.date)} · {clock(meeting.elapsed)}</span><p>{view === 'notes' ? meeting.notes || meeting.context.summary || 'No AI notes for this meeting. Open to review its transcript.' : meeting.context.summary || meeting.transcript.slice(0, 180)}</p></div><ChevronRight size={16} aria-hidden="true" /></button>) : <div className="library-empty"><FileText size={26} aria-hidden="true" /><h2>{view === 'search' && query ? 'No matching meetings' : 'Your conversations belong here.'}</h2><p>{view === 'search' && query ? 'Try another word from the title, transcript, or notes.' : 'Complete a recording or upload audio to save your first meeting.'}</p><button className="primary-button" onClick={newMeeting} disabled={locked}>New Meeting</button></div>}</div></>}</section>}
    {view !== 'meeting' && active && <div className="library-recording-dock" aria-label="Recording controls"><button className="text-button" onClick={() => setView('meeting')}><Mic size={15} aria-hidden="true" />{paused ? 'Paused' : 'Recording'} · {clock(flow.elapsed)}</button><button className="secondary-button" onClick={paused ? flow.resumeRecording : flow.pauseRecording}>{paused ? 'Resume recording' : 'Pause recording'}</button><button className="primary-button" onClick={() => { setView('meeting'); flow.stopRecording(); }}><Square size={13} aria-hidden="true" />Stop recording</button></div>}
    </main>
    <div className={`context-wrapper ${view !== 'meeting' ? 'is-library-context' : ''}`}><WorkspaceContext context={context} editable={finished} onNotesChange={value => opened ? saveOpened({ notes: value }) : live.updateNotes(value)} onAsk={question => live.askAI(question, opened ? opened.transcript : [flow.transcript, flow.partialTranscript].filter(Boolean).join(' '), { notes, context })} manualBusy={live.manualBusy} manualResponse={live.manualResponse} transcriptAvailable={!!(transcript || flow.partialTranscript).trim()} questions={opened?.questions || live.questionHistory.map(item => `${item.question.slice(0, item.disposition === 'dismissed' ? 228 : 240)}${item.disposition === 'dismissed' ? ' (dismissed)' : ''}`)} status={paused ? 'paused' : live.status} notes={notes} notice={live.notice} enabled={live.enabled} active={active && !paused} retry={flow.state === 'success' && !opened ? () => finalize(flow.transcript) : undefined} onApproveActionItem={handleApproveActionItem} onDismissActionItem={handleDismissActionItem} onResolveQuestion={handleResolveQuestion} /><div className="context-controls" aria-label="AI meeting controls"><button className={`ai-voice-toggle ${live.enabled ? 'is-active' : ''}`} aria-pressed={live.enabled} onClick={live.toggleEnabled}>AI Interruption: {live.enabled ? 'ON' : 'OFF'}</button><button className={`ai-voice-toggle ${live.voiceEnabled ? 'is-active' : ''}`} aria-pressed={live.voiceEnabled} onClick={live.toggleVoice}>AI Voice: {live.voiceEnabled ? 'ON' : 'OFF'}</button></div></div>
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

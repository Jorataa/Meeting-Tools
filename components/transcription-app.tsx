'use client';

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { ChevronRight, Clock3, FileText, Mic, ShieldCheck, Sparkles, Square } from 'lucide-react';
import { useLiveInterruption } from '@/lib/use-live-interruption';
import type { MeetingContext } from '@/lib/live/policy';
import { useTranscription } from '@/lib/use-transcription';
import { AUDIO_ACCEPT, validateAudio } from '@/lib/audio/validation';
import { formatMeeting } from '@/lib/export';
import { toggleAction } from '@/lib/workspace-text';
import { useWhisperVoice } from '@/lib/use-whisper-voice';
import { useWorkspacePreferences } from '@/lib/use-workspace-preferences';
import { LiveSession } from './workspace/live-session';
import { CompletedSession } from './workspace/completed-session';
import { MeetingLibrary } from './workspace/meeting-library';
import { RecordingDock } from './workspace/recording-dock';
import { AudioDropzone } from './workspace/audio-dropzone';
import { WhisperCard } from './workspace/whisper-card';
import { useMeetingHistory } from '@/lib/meeting-storage';
import { WorkspaceSidebar, WorkspaceNavigation, type SavedMeeting, type WorkspaceView } from './workspace-sidebar';
import { WorkspaceContext } from './workspace-context';
import { WorkspaceSettings } from './workspace-settings';

function clock(seconds: number) { return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }
function dateLabel(date: number) { return new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
export function TranscriptionApp({ ownerId = 'demo', accountEmail, onSignOut }: { ownerId?: string; accountEmail?: string; onSignOut?: () => void }) {
  const { language, frequency, summaryStyle, updateLanguage, updateFrequency, updateSummaryStyle } = useWorkspacePreferences(ownerId);
  const live = useLiveInterruption();
  const { finalize, setPaused: setAnalysisPaused, start: startLive, updateContext } = live;
  const presetTopics = useRef<string[]>([]);
  const onMeetingStart = useCallback(() => {
    startLive();
    if (presetTopics.current.length) updateContext(current => ({ ...current, topics: presetTopics.current }));
  }, [startLive, updateContext]);
  const [sessionDate, setSessionDate] = useState(() => Date.now());
  const [capturePaused, setCapturePaused] = useState(false);
  const whisper = useWhisperVoice(live.question, live.active && !capturePaused && !live.voiceEnabled);
  const onPaused = useCallback((value: boolean) => { setCapturePaused(value); setAnalysisPaused(value); }, [setAnalysisPaused]);
  const flow = useTranscription({ onMeetingStart, onMeetingStop: live.stop, onTranscript: live.acceptTranscript, onVoice: live.onVoice, onPaused, suppressed: live.suppressCapture || whisper.suppressed, language });
  const fileInput = useRef<HTMLInputElement>(null);
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
  const aiLabel = live.status === 'speaking' || whisper.suppressed ? 'AI is asking a question…' : !live.enabled ? 'Clarifications paused' : live.status === 'waiting' ? 'Waiting for natural pause' : live.status === 'thinking' || live.status === 'transcribing' ? 'Analyzing context in background' : 'Listening attentively';

  useEffect(() => { if (flow.state === 'success' && !opened) finalize(flow.transcript); }, [flow.state, flow.transcript, finalize, opened]);
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
  function cancel() { whisper.cancel(); setCapturePaused(false); flow.cancel(); live.reset(); }
  function newMeeting() {
    if (locked) return;
    setSessionDate(Date.now());
    presetTopics.current = [];
    setDeleteConfirmation(null);
    whisper.cancel();
    setCapturePaused(false);
    flow.reset();
    live.reset();
    setOpened(null);
    meetingId.current = '';
    setTitle('Untitled meeting');
    setView('meeting');
    setPanel('transcript');
    try { sessionStorage.removeItem(`hush.activeMeeting.${encodeURIComponent(ownerId)}`); } catch { /* storage fallback */ }
  }
  function openMeeting(id: string) {
    if (locked) return;
    setDeleteConfirmation(null);
    const item = meetings.find(meeting => meeting.id === id);
    if (!item) return;
    whisper.cancel();
    setCapturePaused(false);
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
    catch { const editor = document.getElementById('transcript') as HTMLTextAreaElement | null; editor?.focus(); editor?.select(); setCopyFeedback('Select and copy the transcript, or download it below.'); }
  }
  const elapsed = opened ? opened.elapsed : flow.elapsed;
  const timeline = useMemo(() => [...flow.segments, ...live.asked.filter(item => item.disposition !== 'dismissed').map((asked, index) => ({ id: `ai-${index}-${asked.gapKey}`, speaker: 'Hush:', text: asked.question, at: asked.at ?? 0, source: 'ai' as const }))].sort((a, b) => a.at - b.at), [flow.segments, live.asked]);

  const exportMeeting = { title, transcript, notes, context, date: opened?.date ?? meetings.find(item => item.id === meetingId.current)?.date ?? sessionDate, elapsed, questions: opened?.questions || live.questionHistory.map(item => item.question) };
  async function copySummary() {
    try { await navigator.clipboard.writeText(formatMeeting(exportMeeting, 'slack')); setCopyFeedback('Meeting summary copied'); }
    catch { setCopyFeedback('Clipboard unavailable. Use Share & export to download Markdown.'); }
  }
  const updateNotes = (value: string) => opened ? saveOpened({ notes: value }) : live.updateNotes(value);
  const onPreset = (name: string, topics: string[]) => { presetTopics.current = topics; updateTitle(name); live.updateContext(current => ({ ...current, topics })); };
  function selectDroppedAudio(file: File) {
    if (locked) return;
    if (finished && !validateAudio(file)) newMeeting();
    setView('meeting'); setPanel('transcript'); flow.selectAudio(file);
  }
  const dismissWhisper = () => { whisper.cancel(); live.dismissQuestion(); };
  const acknowledgeWhisper = () => {
    const question = live.question;
    if (!question) return;
    const entry = `- ${question}`;
    const next = notes.includes(entry) ? notes : `${notes}${notes ? '\n\n' : ''}${notes.includes('## Agenda') ? '' : '## Agenda\n'}${entry}`;
    if (next.length > 16000) { setCopyFeedback('Your notes are full. Make room in notes before pinning this question.'); return; }
    updateNotes(next);
    dismissWhisper();
    setCopyFeedback('Pinned to your meeting agenda');
  };
  const handleShortcut = useEffectEvent((event: KeyboardEvent) => {
      if (event.repeat || event.isComposing || event.defaultPrevented) return;
      const element = event.target instanceof HTMLElement ? event.target : null;
      const typing = !!element?.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]');
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'c' && !typing && transcript.trim()) {
        event.preventDefault();
        void copySummary();
        return;
      }
      const interactive = !!element?.closest('button, a, summary, [role="tab"], [role="menuitem"]');
      if (!typing && ((!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.code === 'Space' && !interactive) || ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'k'))) {
        if (requesting || busy || deleting || finished || !flow.ready) return;
        event.preventDefault(); setView('meeting');
        if (recording) flow.pauseRecording(); else if (paused) flow.resumeRecording(); else void flow.startRecording();
      }
  });
  useEffect(() => {
    const handle = (event: KeyboardEvent) => handleShortcut(event);
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, []);

  return <div className={`workspace-shell ${view !== 'meeting' ? 'library-view' : ''} ${panel === 'context' && view === 'meeting' ? 'context-visible' : ''}`}>
    <AudioDropzone enabled={!locked} onFile={selectDroppedAudio} />
    <WorkspaceSidebar view={view} meetings={meetings} selectedId={opened?.id ?? (finished ? meetingId.current : null)} onView={setView} onNew={newMeeting} onOpen={openMeeting} locked={locked} accountEmail={accountEmail} onSignOut={onSignOut} />
    <main className="workspace-main">
      <header className="workspace-header"><div className="workspace-breadcrumb">Your workspace<ChevronRight size={12} aria-hidden="true" /><span>{view === 'meeting' ? 'Meeting' : view.charAt(0).toUpperCase() + view.slice(1)}</span></div><span className="privacy-label"><ShieldCheck size={13} aria-hidden="true" />{accountEmail ? 'Personal workspace' : 'On this device'}</span></header>
      {view === 'meeting' ? <>
        <div className="meeting-heading"><div><label htmlFor="meeting-title" className="eyebrow">{finished ? 'COMPLETED MEETING' : 'MEETING WORKSPACE'}</label><input id="meeting-title" aria-label="Meeting title" className="meeting-title" value={title} maxLength={120} onChange={event => updateTitle(event.target.value)} /><p>{opened ? dateLabel(opened.date) : 'Stay in the conversation. We’ll keep the details.'}</p></div><span role="status" className={`meeting-badge ${recording ? 'is-live' : ''} ${paused ? 'is-paused' : ''} ${live.status === 'speaking' || whisper.suppressed ? 'is-speaking' : ''}`}><span className="status-dot" />{finished ? 'Saved meeting' : paused ? 'Paused' : live.status === 'speaking' || whisper.suppressed ? 'AI speaking' : recording ? 'LIVE' : 'Ready'}</span></div>
        <div className="meeting-meta"><span><Clock3 size={14} aria-hidden="true" /><time className="recording-time" aria-label={`${Math.floor(elapsed / 60)} minutes ${elapsed % 60} seconds`}>{clock(elapsed)}</time></span><span><Mic size={14} aria-hidden="true" />{finished ? 'Recorded audio' : recording ? 'Microphone on' : paused ? 'Microphone paused' : flow.micPermission === 'denied' ? 'Microphone blocked' : flow.micPermission === 'unavailable' ? 'Microphone unavailable' : flow.micPermission === 'granted' ? 'Microphone ready' : requesting ? 'Permission requested' : 'Microphone permission on start'}</span><span className="language-label">{language === 'auto' ? 'EN / ID · Auto language' : language === 'id' ? 'Bahasa Indonesia' : 'English'}</span></div>
        <div className="workspace-tabs" role="tablist" aria-label="Meeting panels">{(['transcript', 'context'] as const).map(tab => <button key={tab} id={`tab-${tab}`} role="tab" aria-controls={`panel-${tab}`} aria-selected={panel === tab} tabIndex={panel === tab ? 0 : -1} onClick={() => setPanel(tab)} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const next = event.key === 'Home' ? 'transcript' : event.key === 'End' ? 'context' : tab === 'transcript' ? 'context' : 'transcript'; setPanel(next); document.getElementById(`tab-${next}`)?.focus(); } }}>{tab === 'transcript' ? <FileText size={15} aria-hidden="true" /> : <Sparkles size={15} aria-hidden="true" />}{tab === 'transcript' ? 'Transcript' : 'Context & notes'}</button>)}</div>
        <div className="meeting-body" id="panel-transcript" role="tabpanel" aria-labelledby="tab-transcript">
          {[flow.error, flow.notice, flow.liveNotice, storageNotice, restoredNotice, whisper.notice].filter(Boolean).map((notice, index) => <div key={`${index}-${notice}`} className={`${notice === flow.error ? 'error-message' : 'notice-message'} ${notice === restoredNotice ? 'restored-notice' : ''}`} role={notice === flow.error ? 'alert' : 'status'}>{notice}</div>)}
          {finished ? <CompletedSession meeting={exportMeeting} audio={opened ? null : flow.audio} retentionLabel={retention === 'device' ? accountEmail ? 'saved to your account' : 'saved on this device' : 'this session only'} onTranscript={value => opened ? saveOpened({ transcript: value }) : flow.setTranscript(value)} onToggleAction={task => updateNotes(toggleAction(notes, task))} onResolve={handleResolveQuestion} onNew={newMeeting} onDelete={() => setDeleteConfirmation('meeting')} confirming={deleteConfirmation === 'meeting'} deleting={deleting} onConfirmDelete={() => void deleteMeeting()} onKeep={() => setDeleteConfirmation(null)} copyFeedback={copyFeedback} onCopy={() => void copyTranscript()} /> : <LiveSession flow={flow} timeline={timeline} onCancel={cancel} onUpload={() => fileInput.current?.click()} onPreset={onPreset} selectedPreset={title} />}
          {active && live.question && <WhisperCard key={live.question} question={live.question} reason={live.questionReason} speaking={live.status === 'speaking' || whisper.suppressed} voiceMuted={!live.voiceEnabled} voiceBusy={whisper.busy} onAcknowledge={acknowledgeWhisper} onDismiss={dismissWhisper} onSpeak={() => void whisper.speak()} />}
          {!finished && copyFeedback && <p className="copy-feedback" role="status">{copyFeedback}</p>}
          <div className="meeting-guidance"><ShieldCheck size={15} aria-hidden="true" /><p>{finished ? retention === 'device' ? accountEmail ? 'Transcript and notes save to your private account and this device. Audio is not saved in history.' : 'Transcript and notes stay on this device. Audio is not saved in history.' : 'Transcript and notes stay in this session. Export anything you want to keep.' : 'Questions wait for a pause. Audio stays in this tab and is sent to Gemini for transcription.'}</p></div>
        </div>
        <RecordingDock recording={recording} paused={paused} finished={finished} busy={busy} level={flow.level} suppressed={live.suppressCapture || whisper.suppressed} label={aiLabel} onPause={flow.pauseRecording} onResume={flow.resumeRecording} onStop={flow.stopRecording} onCancel={cancel} />
        <input ref={fileInput} className="visually-hidden" type="file" accept={AUDIO_ACCEPT} aria-label="Choose audio file" tabIndex={-1} disabled={!canChoose} onChange={event => { const file = event.target.files?.[0]; if (file) flow.selectAudio(file); event.target.value = ''; }} />
      </> : <section className="workspace-library" aria-label={view === 'settings' ? 'Workspace settings' : 'Saved meetings'}><div className="library-heading"><span className="eyebrow">YOUR WORKSPACE</span><h1>{view === 'meetings' ? 'Meetings' : view === 'notes' ? 'Meeting notes' : view === 'search' ? 'Find a conversation' : 'Settings'}</h1><p>{view === 'settings' ? 'Choose how Hush participates in your meetings.' : accountEmail ? 'Your completed conversations, saved to your account.' : 'Your completed conversations, saved on this device.'}</p></div>{storageNotice && <p className="notice-message" role="status">{storageNotice}</p>}{active && <p className="notice-message" role="status">Your recording continues. Return to Workspace for the live transcript and recording controls.</p>}{view === 'settings' ? <WorkspaceSettings enabled={live.enabled} voiceEnabled={live.voiceEnabled} toggleEnabled={live.toggleEnabled} toggleVoice={live.toggleVoice} retention={retention} setRetention={setRetention} meetingCount={meetings.length} locked={locked} confirming={deleteConfirmation === 'history'} onCancelDelete={() => setDeleteConfirmation(null)} onDelete={() => void deleteHistory()} onSignOut={onSignOut} accountEmail={accountEmail} frequency={frequency} setFrequency={updateFrequency} language={language} setLanguage={updateLanguage} summaryStyle={summaryStyle} setSummaryStyle={updateSummaryStyle} /> : <MeetingLibrary meetings={meetings} view={view} query={query} onQuery={setQuery} onOpen={openMeeting} onNew={newMeeting} locked={locked} />}</section>}
      {view !== 'meeting' && active && <div className="library-recording-dock" aria-label="Recording controls"><button className="text-button" onClick={() => setView('meeting')}><Mic size={15} aria-hidden="true" />{paused ? 'Paused' : 'Recording'} · {clock(flow.elapsed)}</button><button className="secondary-button" onClick={paused ? flow.resumeRecording : flow.pauseRecording}>{paused ? 'Resume recording' : 'Pause recording'}</button><button className="primary-button" onClick={() => { setView('meeting'); flow.stopRecording(); }}><Square size={13} aria-hidden="true" />Stop recording</button></div>}
    <div className="context-wrapper" id="panel-context" role="tabpanel" aria-labelledby="tab-context"><WorkspaceContext context={context} editable={finished} onNotesChange={updateNotes} onAsk={question => live.askAI(question, opened ? opened.transcript : [flow.transcript, flow.partialTranscript].filter(Boolean).join(' '), { notes, context })} manualBusy={live.manualBusy} manualResponse={live.manualResponse} transcriptAvailable={!!(transcript || flow.partialTranscript).trim()} questions={opened?.questions || live.questionHistory.map(item => `${item.question.slice(0, item.disposition === 'dismissed' ? 228 : 240)}${item.disposition === 'dismissed' ? ' (dismissed)' : ''}`)} status={paused ? 'paused' : whisper.suppressed ? 'speaking' : live.status} notes={notes} notice={live.notice} enabled={live.enabled} active={active && !paused} retry={flow.state === 'success' && !opened ? () => finalize(flow.transcript) : undefined} onApproveActionItem={handleApproveActionItem} onDismissActionItem={handleDismissActionItem} onResolveQuestion={handleResolveQuestion} /><div className="context-controls" aria-label="AI meeting controls"><button className={`ai-voice-toggle ${live.enabled ? 'is-active' : ''}`} aria-pressed={live.enabled} onClick={live.toggleEnabled}>AI Interruption: {live.enabled ? 'ON' : 'OFF'}</button><button className={`ai-voice-toggle ${live.voiceEnabled ? 'is-active' : ''}`} aria-pressed={live.voiceEnabled} onClick={live.toggleVoice}>AI Voice: {live.voiceEnabled ? 'ON' : 'OFF'}</button></div></div>
    </main>
    <WorkspaceNavigation mobile view={view} count={meetings.length} onView={setView} />
  </div>;
}

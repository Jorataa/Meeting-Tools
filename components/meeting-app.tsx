'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Check,
  Copy,
  Download,
  FileAudio,
  Mic,
  RefreshCw,
  Sparkles,
  Square,
  Upload,
  Volume2,
  VolumeX,
  Waves,
} from 'lucide-react';
import { useTranscription } from '@/lib/use-transcription';
import { AUDIO_ACCEPT } from '@/lib/audio/validation';
import { download } from '@/lib/export';
import { Voice } from '@/lib/audio/speech';
import type { AIResponse } from '@/app/api/ai/route';

type AIState = 'idle' | 'listening' | 'thinking' | 'speaking';

function clock(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export function MeetingApp() {
  const flow = useTranscription();
  const fileInput = useRef<HTMLInputElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const voiceRef = useRef<Voice | null>(null);

  const [copyFeedback, setCopyFeedback] = useState('');
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [aiState, setAiState] = useState<AIState>('idle');
  const [aiResult, setAiResult] = useState<AIResponse | null>(null);
  const [aiNotice, setAiNotice] = useState('');
  const [lastAnalyzedTranscript, setLastAnalyzedTranscript] = useState('');

  const busy = flow.state === 'uploading' || flow.state === 'transcribing';
  const recording = flow.state === 'recording';
  const requesting = flow.state === 'requesting';
  const finished = flow.state === 'success';
  const canChoose = !busy && !recording && !requesting && !finished;

  const labels = {
    initial: 'Ready when you are',
    requesting: 'Waiting for microphone permission',
    recording: 'Recording',
    paused: 'Recording paused',
    stopping: 'Finishing recording',
    'audio-ready': 'Audio ready',
    uploading: 'Uploading audio',
    transcribing: 'Transcribing',
    success: 'Finished',
    error: 'Needs attention',
  };

  // Lazy-init client Voice instance
  useEffect(() => {
    voiceRef.current = new Voice();
    return () => {
      voiceRef.current?.cancel();
    };
  }, []);

  // Update AI state to listening when recording
  useEffect(() => {
    if (recording) {
      setAiState('listening');
    } else if (aiState === 'listening') {
      setAiState('idle');
    }
  }, [recording, aiState]);

  useEffect(() => {
    if (finished) editor.current?.focus();
  }, [finished]);

  useEffect(() => {
    setCopyFeedback('');
  }, [flow.transcript]);

  useEffect(() => {
    if (!copyFeedback) return;
    const timer = setTimeout(() => setCopyFeedback(''), 2500);
    return () => clearTimeout(timer);
  }, [copyFeedback]);

  // Standalone Test AI Voice handler (STEP D)
  const testAiVoice = useCallback(async () => {
    if (!voiceRef.current) return;
    setAiNotice('');
    setAiState('speaking');
    try {
      await voiceRef.current.speak('Hello. The AI voice system is working.', {
        preferGeminiTTS: true,
        onStart: () => setAiState('speaking'),
        onEnd: () => setAiState('idle'),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Voice playback failed';
      setAiNotice(msg);
      setAiState('idle');
    }
  }, []);

  // Toggle AI Voice ON / OFF (STEP F)
  const toggleVoice = useCallback(() => {
    setVoiceEnabled((prev) => {
      const next = !prev;
      if (!next && voiceRef.current) {
        voiceRef.current.stopSpeaking();
        setAiState('idle');
      }
      return next;
    });
  }, []);

  // Analyze transcript with Gemini (STEP H)
  const analyzeTranscript = useCallback(
    async (textOverride?: string) => {
      const targetText = (textOverride ?? flow.transcript).trim();
      if (!targetText || aiState === 'thinking') return;

      setAiState('thinking');
      setAiNotice('');

      try {
        const response = await fetch('/api/ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: targetText }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || 'Failed to analyze conversation.');
        }

        const data: AIResponse = await response.json();
        setAiResult(data);
        setLastAnalyzedTranscript(targetText);

        // If AI decides to speak and voice is enabled, speak clarification (STEP H & I)
        if (voiceEnabled && data.shouldSpeak && data.spokenText && voiceRef.current) {
          setAiState('speaking');
          await voiceRef.current.speak(data.spokenText, {
            preferGeminiTTS: true,
            onStart: () => setAiState('speaking'),
            onEnd: () => setAiState('idle'),
          });
        } else {
          setAiState('idle');
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Could not reach AI assistant.';
        setAiNotice(msg);
        setAiState('idle');
      }
    },
    [flow.transcript, aiState, voiceEnabled]
  );

  // Automatically trigger AI analysis when transcript first finishes
  useEffect(() => {
    if (finished && flow.transcript.trim() && flow.transcript.trim() !== lastAnalyzedTranscript) {
      void analyzeTranscript(flow.transcript);
    }
  }, [finished, flow.transcript, lastAnalyzedTranscript, analyzeTranscript]);

  const handleReset = useCallback(() => {
    voiceRef.current?.cancel();
    setAiResult(null);
    setAiNotice('');
    setLastAnalyzedTranscript('');
    setAiState('idle');
    flow.reset();
  }, [flow]);

  async function copyTranscript() {
    try {
      await navigator.clipboard.writeText(flow.transcript);
      setCopyFeedback('Copied');
    } catch {
      editor.current?.focus();
      editor.current?.select();
      setCopyFeedback('Select and copy the transcript, or download it below.');
    }
  }

  const effectiveAiState: AIState = recording ? 'listening' : aiState;
  const aiStateLabel =
    effectiveAiState === 'listening'
      ? 'Listening'
      : effectiveAiState === 'thinking'
        ? 'Thinking'
        : effectiveAiState === 'speaking'
          ? 'Speaking'
          : 'Ready';

  return (
    <div className="transcription-app">
      <header className="mvp-header">
        <Link className="mvp-brand" href="/" aria-label="Hush home">
          <Waves size={25} aria-hidden="true" />
          <span>
            hush<span className="brand-period">.</span>
          </span>
        </Link>
        <div className="header-controls">
          <button
            type="button"
            className="test-voice-btn"
            onClick={() => void testAiVoice()}
            disabled={effectiveAiState === 'thinking' || effectiveAiState === 'speaking'}
            title="Test AI voice generation with Gemini TTS"
          >
            <Sparkles size={14} aria-hidden="true" />
            <span>Test AI Voice</span>
          </button>
          <button
            type="button"
            className={`ai-voice-toggle ${voiceEnabled ? 'is-active' : ''}`}
            onClick={toggleVoice}
            aria-pressed={voiceEnabled}
            title={voiceEnabled ? 'Mute AI voice output' : 'Enable AI voice output'}
          >
            {voiceEnabled ? <Volume2 size={15} aria-hidden="true" /> : <VolumeX size={15} aria-hidden="true" />}
            <span>AI Voice {voiceEnabled ? 'ON' : 'OFF'}</span>
          </button>
          <span className="ai-state-badge" role="status" aria-label={`AI status: ${aiStateLabel}`}>
            <span className={`ai-state-dot is-${effectiveAiState}`} aria-hidden="true" />
            <span>{aiStateLabel}</span>
          </span>
        </div>
      </header>

      <main className={`transcription-main ${finished ? 'has-transcript' : ''}`}>
        <div className="intro">
          <span className="eyebrow">CONVERSATIONS, CLEARLY</span>
          <h1>
            {finished ? (
              'Your words, a little clearer.'
            ) : (
              <>
                Turn conversations
                <br className="desktop-break" /> into clear notes.
              </>
            )}
          </h1>
          <p>
            {finished
              ? 'An accurate transcript with AI notes & insights.'
              : 'Record a meeting or upload audio. We’ll transcribe and capture key details.'}
          </p>
        </div>

        <section
          className="transcription-surface"
          aria-label={finished ? 'Meeting transcript' : 'Audio transcription'}
          aria-busy={busy}
        >
          <div className="status-line" role="status" aria-live="polite">
            <span className={`status-dot ${recording ? 'is-recording' : ''} ${flow.state === 'error' ? 'is-error' : ''}`} />
            <span>{labels[flow.state]}</span>
            {recording && (
              <time
                className="recording-time"
                aria-label={`${Math.floor(flow.elapsed / 60)} minutes ${flow.elapsed % 60} seconds`}
              >
                {clock(flow.elapsed)}
              </time>
            )}
          </div>

          {flow.error && (
            <div className="error-message" role="alert">
              {flow.error}
            </div>
          )}
          {flow.notice && (
            <p className="notice-message" role="status">
              {flow.notice}
            </p>
          )}
          {aiNotice && (
            <p className="notice-message" role="status">
              {aiNotice}
            </p>
          )}

          {requesting && (
            <div className="active-state">
              <span className="microphone-mark">
                <Mic size={30} aria-hidden="true" />
              </span>
              <h2>Allow your microphone</h2>
              <p>Choose Allow in your browser’s permission prompt to start recording.</p>
              <button className="text-button" onClick={flow.cancel}>
                Cancel
              </button>
            </div>
          )}

          {recording && (
            <div className="active-state">
              <div className="recording-bars" aria-hidden="true">
                {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                  <i key={i} style={{ animationDelay: `${i * -0.13}s` }} />
                ))}
              </div>
              <h2>Listening to your conversation</h2>
              <p>Keep this tab open. Stop when you’re ready to transcribe.</p>
              <button className="primary-button stop-button" onClick={flow.stopRecording}>
                <Square size={16} fill="currentColor" aria-hidden="true" />
                Stop recording
              </button>
              <button className="text-button" onClick={flow.cancel}>
                Cancel recording
              </button>
            </div>
          )}

          {busy && (
            <div className="active-state">
              <span className="loading-ring" aria-hidden="true" />
              <h2>{flow.state === 'uploading' ? 'Sending your audio…' : 'Transcribing with Gemini…'}</h2>
              <p>
                {flow.state === 'uploading'
                  ? `${flow.progress}% uploaded`
                  : 'Finding the words, keeping the meaning. This may take a minute.'}
              </p>
              <button className="text-button" onClick={flow.cancel}>
                Cancel transcription
              </button>
            </div>
          )}

          {canChoose && (
            <>
              {flow.audio ? (
                <div className="audio-ready">
                  <div className="selected-file">
                    <FileAudio size={22} aria-hidden="true" />
                    <div>
                      <strong>{flow.audio.name}</strong>
                      <span>{(flow.audio.size / 1024 / 1024).toFixed(1)} MB · Ready to transcribe</span>
                    </div>
                  </div>
                  <AudioPreview file={flow.audio} />
                  <div className="action-row">
                    <button className="primary-button" onClick={() => void flow.transcribe(flow.audio!)}>
                      {flow.state === 'error' ? 'Try transcription again' : 'Transcribe audio'}
                    </button>
                    <button className="text-button" onClick={() => download(flow.audio!, flow.audio!.name)}>
                      <Download size={16} aria-hidden="true" />
                      Save audio
                    </button>
                  </div>
                  <div className="replace-actions">
                    <button className="text-button" onClick={() => fileInput.current?.click()}>
                      Choose another file
                    </button>
                    <span aria-hidden="true">·</span>
                    <button className="text-button" onClick={() => void flow.startRecording()}>
                      Record instead
                    </button>
                  </div>
                </div>
              ) : (
                <div className="initial-controls">
                  <span className="microphone-mark">
                    <Mic size={29} strokeWidth={1.6} aria-hidden="true" />
                  </span>
                  <h2>Make room for the conversation.</h2>
                  <p>We’ll transcribe what was said and generate concise meeting notes.</p>
                  <button className="primary-button" onClick={() => void flow.startRecording()}>
                    <Mic size={18} aria-hidden="true" />
                    Start recording
                  </button>
                  <div className="or-divider">
                    <span />
                    or
                    <span />
                  </div>
                  <button className="secondary-button" onClick={() => fileInput.current?.click()}>
                    <Upload size={18} aria-hidden="true" />
                    Upload audio
                  </button>
                  <p className="file-hint">MP3, WAV, M4A, WebM, OGG · Up to 12 MB</p>
                </div>
              )}
            </>
          )}

          {finished && (
            <div className="transcript-result">
              <div className="transcript-heading">
                <label htmlFor="transcript">Meeting transcript</label>
                <span>Click to edit</span>
              </div>
              <textarea
                ref={editor}
                id="transcript"
                value={flow.transcript}
                onChange={(event) => flow.setTranscript(event.target.value)}
                spellCheck
                rows={12}
              />
              <div className="result-actions">
                <button
                  className="primary-button"
                  onClick={() => void copyTranscript()}
                  disabled={!flow.transcript.trim()}
                >
                  {copyFeedback === 'Copied' ? (
                    <Check size={17} aria-hidden="true" />
                  ) : (
                    <Copy size={17} aria-hidden="true" />
                  )}
                  {copyFeedback === 'Copied' ? 'Copied' : 'Copy transcript'}
                </button>
                <button
                  className="secondary-button"
                  onClick={() =>
                    download(
                      new Blob([flow.transcript], { type: 'text/plain;charset=utf-8' }),
                      'meeting-transcript.txt'
                    )
                  }
                  disabled={!flow.transcript.trim()}
                >
                  <Download size={17} aria-hidden="true" />
                  Download .txt
                </button>
                <button className="text-button new-transcription" onClick={handleReset}>
                  New transcription
                </button>
              </div>
              <p className="copy-feedback" role="status" aria-live="polite">
                {copyFeedback}
              </p>

              {/* AI Insights & Clarifications Section (STEP B, H, I) */}
              <div className="ai-insights-panel">
                <div className="ai-insights-header">
                  <h3>
                    <Sparkles size={16} aria-hidden="true" />
                    <span>Gemini Meeting Notes & Clarification</span>
                  </h3>
                  <button
                    type="button"
                    className="ai-action-btn"
                    onClick={() => void analyzeTranscript()}
                    disabled={effectiveAiState === 'thinking'}
                  >
                    <RefreshCw size={13} className={effectiveAiState === 'thinking' ? 'spin' : ''} aria-hidden="true" />
                    <span>{effectiveAiState === 'thinking' ? 'Analyzing…' : 'Re-analyze with AI'}</span>
                  </button>
                </div>

                {aiResult?.notes && (
                  <div className="ai-notes-content">
                    {aiResult.notes}
                  </div>
                )}

                {aiResult?.shouldSpeak && aiResult.spokenText && (
                  <div className="ai-question-card">
                    <span className="ai-question-title">
                      <Volume2 size={13} aria-hidden="true" />
                      Clarification Question
                    </span>
                    <p className="ai-question-body">“{aiResult.spokenText}”</p>
                    {aiResult.reason && <p className="ai-question-reason">Reason: {aiResult.reason}</p>}
                    <div style={{ marginTop: 6 }}>
                      {effectiveAiState === 'speaking' ? (
                        <button
                          type="button"
                          className="ai-action-btn"
                          onClick={() => {
                            voiceRef.current?.stopSpeaking();
                            setAiState('idle');
                          }}
                        >
                          <Square size={13} fill="currentColor" aria-hidden="true" />
                          Stop speaking
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="ai-action-btn"
                          onClick={() => {
                            if (voiceRef.current && aiResult.spokenText) {
                              setAiState('speaking');
                              void voiceRef.current.speak(aiResult.spokenText, {
                                preferGeminiTTS: true,
                                onStart: () => setAiState('speaking'),
                                onEnd: () => setAiState('idle'),
                              });
                            }
                          }}
                        >
                          <Volume2 size={13} aria-hidden="true" />
                          Play question
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <p className="edit-caption">
                Edits stay in this tab. Copy or download your transcript before leaving.
              </p>
            </div>
          )}

          <input
            ref={fileInput}
            className="visually-hidden"
            type="file"
            accept={AUDIO_ACCEPT}
            aria-label="Choose audio file"
            tabIndex={-1}
            disabled={!canChoose}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) flow.selectAudio(file);
              event.target.value = '';
            }}
          />
        </section>

        <p className="below-surface">
          {finished
            ? 'Every detail matters. Give names, decisions, and deadlines a quick review.'
            : 'Indonesian, English, or a little of both. Your words stay your words.'}
        </p>
      </main>

      <footer className="mvp-footer">
        <span>Less to manage. More to hear.</span>
        <span>Audio and notes are processed securely.</span>
      </footer>
    </div>
  );
}

function AudioPreview({ file }: { file: File }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const audioUrl = URL.createObjectURL(file);
    setUrl(audioUrl);
    return () => URL.revokeObjectURL(audioUrl);
  }, [file]);
  return url ? <audio controls preload="metadata" src={url} aria-label="Preview selected audio" /> : null;
}

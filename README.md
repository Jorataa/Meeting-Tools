# Meeting-Tools · Hush

An AI meeting assistant built on the existing Next.js App Router, React, and
server-side Gemini integration. The workspace shows live speech, thoughtful
clarifications, and meeting context together. Upload, edit, copy, audio download,
and transcript export remain available.

## Run

Keep existing `.env.local` credentials. On a new installation, copy `.env.example`
to `.env.local` and configure `GEMINI_API_KEY_1` and `SESSION_SECRET`.
Numbered `_2` through `_5`, legacy `GEMINI_API_KEY`, and comma-separated
`GEMINI_API_KEYS` remain supported. Keys must never use `NEXT_PUBLIC_` names.

```sh
npm install
npm run dev
```

Open http://localhost:3000. Recording requests microphone permission only after
**Start recording**. Production microphone and clipboard access require HTTPS.
Use `npm run build` and `npm start` for production. Node 24 or newer is required
for the server's native WebSocket implementation.

## Actual live transcription

The recorder and streaming recognizer share one microphone stream:

1. MediaRecorder retains the full recording for download, recovery, and final
   transcript reconciliation. Pause disables the microphone track and pauses
   MediaRecorder; Resume reuses that stream. Stop and Cancel release the tracks.
2. The existing AudioWorklet resamples microphone audio to mono 16 kHz PCM.
   Frames arrive about every 128 milliseconds and are sent as raw 16-bit audio
   through authenticated same-origin requests to `/api/live/stream`.
3. The server maintains a WebSocket to Gemini's dedicated
   `gemini-3.5-transcribe-live` model, with `TEXT` response modality and automatic
   language detection. Configure `GEMINI_LIVE_MODEL` to override it. This is a
   streaming recognizer, rather than repeated `generateContent` file requests.
4. Gemini's `interimInputTranscription` events replace the active preview while
   the participant is talking. `inputTranscription` events commit the utterance.
   Server-sent events deliver these updates immediately to the browser. Committed
   utterances remain visible between previews; replayed event IDs are deduplicated.
5. The separate clarification controller observes finalized utterances. Partial
   speech prevents premature questions and invalidates prepared clarifications.
6. After Stop, the captured complete audio uses the original `/api/transcribe`
   route for an accurate editable final transcript. Live text stays readable
   throughout finalization. If a service fails, the audio remains available to
   save or retry in the current tab.

See Google's [Live Transcription protocol](https://ai.google.dev/gemini-api/docs/live-api/live-transcribe).
The existing general `GEMINI_MODEL` is used for file transcription and reasoning;
it is independent of the dedicated streaming model. The configured model remains
first, followed by compatible fallbacks including current Flash-Lite and Flash
models for projects without legacy model access. New setups default to
`gemini-3.5-flash-lite`. If the key does not have
Live Transcription access, the UI reports that explicitly and keeps recording.
It does not pretend that complete-file transcription is real-time recognition.

Microphone permission, connecting, listening, reconnecting, paused, and failure
states are visible. Both transport queues are bounded. SSE reconnects replay
recent events, and upstream reconnects retain visible text. A broken upstream
connection can lose a short interval of audio; the complete local recording is
retained for reconciliation. Pause/Stop signal the end of audio to finalize
pending speech. Automatic language detection preserves Indonesian, English, and
code switching. Speaker labels currently identify the microphone participant;
this MVP does not infer individual speakers or provide diarization.

### Hosting the streaming relay

Deploy to a persistent Node process with streaming responses and WebSocket egress
to `generativelanguage.googleapis.com`. The process owns the upstream connection
and the authenticated session map used by PCM POSTs and SSE GETs. Route affinity
is required if multiple processes are used. Ordinary independently scheduled
serverless functions cannot share this in-memory connection; use a dedicated
persistent relay or shared routing before scaling to that environment. A proxy
must allow long-running SSE responses and disable response buffering.

Session ownership, signed HTTP-only cookies, origin checks, rate limits, bounded
requests, and sanitized provider errors protect the relay. Gemini keys exist
only on the server. This MVP uses per-process rate limits; public deployments
with multiple instances need shared rate limiting.

## AI clarification and context

`/api/interruption` reads committed speech, existing notes, and question history.
It returns validated structured context: summary, topics, decisions, action
items, and unresolved questions. Missing facts remain unresolved instead of
being filled in. Confidence must be at least 0.82 and relevance at least 0.80.
Only consequential gaps such as deadlines, owners, scope, numbers, next steps,
and contradictions qualify.

Questions wait for at least 2.2 seconds of silence and are at least 30 seconds
apart. A question is checked again after voice preparation; resumed speech,
new partial text, Pause, or an OFF toggle cancels preparation. Already asked
questions are deduplicated by stable gap IDs and question similarity. Voice
capture is suppressed before playback to prevent AI echo from triggering new
questions, then returns to listening. Gemini TTS remains primary, with browser
speech synthesis as a fallback. Voice playback failure leaves the question
readable and recording active.

**AI Interruption** and **AI Voice** can be disabled separately. Live speech and
notes continue. Uploaded audio receives meeting notes without live questions.

The responsive charcoal/lime workspace provides transcript controls, context,
local meeting history, search, notes, and settings. Finished transcripts and
context are saved on this browser; audio is kept only in the active tab. Copy,
export, or download audio before leaving. Saved meeting data is not a cloud
backup. The existing Supabase and legacy meeting modules remain in the project.

## Audio uploads

MP3, WAV, M4A, WebM, and OGG files are validated in the browser and server. The
recording is limited to 15 minutes and 12 MB. Uploaded files use multipart audio
and the existing language-preserving Gemini prompt. File signatures and body
limits are checked before provider calls. Silence, malformed output, incomplete
responses, quotas, configuration problems, network failures, and timeouts produce
readable errors and allow retry. MediaRecorder timeslices share headers and are
never treated as standalone audio files.

Hosting platforms may have a smaller upload limit. Configure the host or use
smaller files. Final transcription allows 120 seconds. Live processing and AI
voice increase Gemini usage.

## Verify

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Playwright uses Chromium's actual getUserMedia, MediaRecorder, and AudioWorklet
with a file-backed microphone. Deterministic tests deliver incremental provider
events through a real browser ReadableStream while PCM capture runs. They verify
progressive text before Stop, stable committed text, final replay deduplication,
Pause/Resume, released tracks, permission handling, upload/retry/export, mobile
layout, and the clarification cycle. Unit tests cover the provider protocol,
server authentication, request bounds, interruption gates, and voice lifecycle.

For checks against the actual Gemini backend with configured server keys:

```sh
RUN_LIVE_GEMINI=1 npm run test:e2e
```

These requests consume provider quota. The test microphone is recorded fixture
audio rather than a physical microphone attached to the user's device. A final
check on that device should use Start, continuous speech, Pause, Resume, and
Stop. Fixture details are in `tests/fixtures/README.md`.

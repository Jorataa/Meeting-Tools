import { Mic, Pause, Play, Square } from 'lucide-react';
import { Waveform } from './waveform';

export function RecordingDock({ recording, paused, finished, busy, level, suppressed, label, onPause, onResume, onStop, onCancel }: {
  recording: boolean; paused: boolean; finished: boolean; busy: boolean; level: number; suppressed: boolean; label: string;
  onPause: () => void; onResume: () => void; onStop: () => void; onCancel: () => void;
}) {
  return <div className="meeting-control-dock" aria-label="Recording controls"><div className="capture-status"><div className={`capture-icon ${recording ? 'is-recording' : ''}`}><Mic size={18} aria-hidden="true" /></div><div><strong>{recording ? 'Microphone active' : paused ? 'Recording paused' : finished ? 'Meeting complete' : busy ? 'Finishing your meeting' : 'Ready for your next conversation'}</strong><span role="status">{recording ? label : paused ? 'Resume to continue capturing' : finished ? 'A little clarity to take with you' : 'Indonesian, English, or a little of both'}</span></div></div><Waveform level={level} active={recording && !suppressed} /><div className="capture-actions">{(recording || paused) && <><button className="secondary-button" onClick={paused ? onResume : onPause}>{paused ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}{paused ? 'Resume recording' : 'Pause recording'}</button><button className="primary-button stop-button" onClick={onStop}><Square size={13} fill="currentColor" aria-hidden="true" />Stop recording</button><button className="text-button cancel-recording" onClick={onCancel}>Cancel recording</button></>}</div></div>;
}

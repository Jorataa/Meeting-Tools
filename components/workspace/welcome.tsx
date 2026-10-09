'use client';

import { useEffect, useState } from 'react';
import { ArrowUpRight, AudioLines, Mic, Sparkles, Upload } from 'lucide-react';

const presets = [
  { icon: '⚡', title: '1-on-1', topics: ['Check-in', 'Growth', 'Next steps'] },
  { icon: '🎯', title: 'Team Standup', topics: ['Updates', 'Blockers', 'Priorities'] },
  { icon: '💡', title: 'Product Brainstorm', topics: ['Ideas', 'Opportunities', 'Experiments'] },
  { icon: '📋', title: 'Sprint Planning', topics: ['Scope', 'Owners', 'Milestones'] },
];

export function Welcome({ ready, onStart, onUpload, onPreset, selectedPreset }: {
  ready: boolean; onStart: () => void; onUpload: () => void;
  onPreset: (title: string, topics: string[]) => void; selectedPreset: string;
}) {
  const [greeting, setGreeting] = useState('Hello');
  useEffect(() => {
    const hour = new Date().getHours();
    setGreeting(hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening');
  }, []);
  return <div className="welcome">
    <div className="welcome-intro"><span className="welcome-kicker"><Sparkles size={14} aria-hidden="true" /> A little more presence. A lot more clarity.</span><h1>{greeting}.<br /><span>What are we focusing on today?</span></h1><p>A space for your conversations to become clear next steps.</p></div>
    <div className="welcome-capture"><div className="welcome-orbit" aria-hidden="true"><AudioLines size={34} strokeWidth={1.4} /></div><h2>Let the conversation flow.</h2><p>You bring the ideas. Hush listens, connects the dots,<br className="desktop-break" /> and remembers the details that matter.</p><div className="initial-actions"><button className="primary-button" disabled={!ready} onClick={onStart}><Mic size={17} aria-hidden="true" />Start recording<kbd aria-hidden="true">␣</kbd></button><button className="secondary-button" onClick={onUpload}><Upload size={17} aria-hidden="true" />Upload audio</button></div><span className="file-hint">MP3, M4A, WAV, WebM, OGG · Up to 12 MB · 15-minute recordings</span></div>
    <div className="preset-section"><div className="preset-heading"><span>START WITH A LITTLE CONTEXT</span><span>Make it yours <ArrowUpRight size={12} aria-hidden="true" /></span></div><div className="meeting-presets">{presets.map(preset => <button key={preset.title} aria-pressed={selectedPreset === preset.title} onClick={() => onPreset(preset.title, preset.topics)}><span aria-hidden="true">{preset.icon}</span>{preset.title}</button>)}</div></div>
    <div className="welcome-footer"><span className="status-dot" />Thoughtful questions. Only when there’s a pause.</div>
  </div>;
}

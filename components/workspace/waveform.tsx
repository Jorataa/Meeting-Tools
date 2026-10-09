export function Waveform({ level, active }: { level: number; active: boolean }) {
  const amplitude = active ? Math.min(Math.max(level, 0) * 100, 26) : 0;
  return <div className={`audio-waveform ${active ? 'is-active' : ''}`} role="img" aria-label={active ? 'Microphone audio level' : 'Microphone idle'}>
    {Array.from({ length: 29 }, (_, index) => {
      const distance = Math.abs(index - 14) / 14;
      const envelope = Math.pow(1 - distance, 0.8);
      const ripple = 0.5 + 0.5 * Math.cos((index - 14) * 1.2);
      return <i key={index} style={{ height: `${3 + amplitude * envelope * (0.4 + ripple * 0.6)}px`, opacity: 0.35 + envelope * 0.65 }} />;
    })}
  </div>;
}

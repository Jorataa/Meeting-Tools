/** Presentation helpers only. Meeting documents and wire contracts stay unchanged. */
export type TranscriptTurn = { speaker: string; text: string; timestamp?: string; labeled: boolean };

export function transcriptTurns(transcript: string): TranscriptTurn[] {
  return transcript.split(/\n\s*\n/u).filter(block => block.trim()).map(block => {
    const match = block.match(/^(?:\[(\d{1,3}:\d{2}(?::\d{2})?)\]\s*)?([^:\n]{1,80}):\s+([\s\S]+)$/u);
    return match ? { timestamp: match[1], speaker: match[2], text: match[3], labeled: true }
      : { speaker: 'Participant', text: block, labeled: false };
  });
}

export function renameSpeaker(transcript: string, from: string, to: string): string {
  const name = to.replace(/[\r\n:\[\]]/gu, '').trim().slice(0, 80);
  if (!name || name === from) return transcript;
  const renamed = transcriptTurns(transcript).map(turn => {
    if (turn.speaker !== from) return `${turn.timestamp ? `[${turn.timestamp}] ` : ''}${turn.labeled ? `${turn.speaker}: ` : ''}${turn.text}`;
    return `${turn.timestamp ? `[${turn.timestamp}] ` : ''}${name}: ${turn.text}`;
  }).join('\n\n');
  return renamed.length <= 150000 ? renamed : transcript;
}

export function executiveSummary(summary: string): string {
  return summary.trim().match(/^.*?[.!?](?=\s|$)/su)?.[0] || summary.trim().split('\n')[0] || '';
}

export function actionCompleted(notes: string, task: string): boolean {
  return notes.split('\n').includes(`- [x] ${task.replace(/\s+/gu, ' ').trim()}`);
}

export function toggleAction(notes: string, task: string): string {
  const normalized = task.replace(/\s+/gu, ' ').trim();
  const done = `- [x] ${normalized}`;
  const todo = `- [ ] ${normalized}`;
  const lines = notes.split('\n');
  const index = lines.findIndex(line => line === done || line === todo);
  if (index >= 0) lines[index] = lines[index] === done ? todo : done;
  else lines.push('', ...(notes.includes('## Action checklist') ? [] : ['## Action checklist']), done);
  const next = lines.join('\n');
  return next.length <= 16000 ? next : notes;
}

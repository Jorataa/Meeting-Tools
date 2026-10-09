import {Meeting} from './model';
import type { SavedMeetingDocument } from './meeting-document';
import { actionCompleted, executiveSummary, transcriptTurns } from './workspace-text';
export const sectionLabels={overview:'Meeting summary',key_points:'Key points',decisions:'Decisions',actions:'Action items',open_questions:'Open questions',technical:'Technical details',risks:'Risks',clarifications:'AI clarifications'};
export function markdown(meeting:Meeting){const sections=Object.entries(sectionLabels).map(([section,label])=>{const notes=meeting.notes.filter(n=>n.section===section);return notes.length?`## ${label}\n\n${notes.map(n=>`- ${n.text}${n.owner?` — ${n.owner}`:''}${n.deadline?` · ${n.deadline}`:''}${n.status!=='open'?` (${n.status})`:''}`).join('\n')}`:'';}).filter(Boolean);return `# ${meeting.title}\n\n${new Date(meeting.startedAt).toLocaleString()}\n\n${sections.join('\n\n')}\n\n## Transcript\n\n${meeting.transcript.map(s=>`[${Math.floor((s.at-meeting.startedAt)/60000)}:${String(Math.floor((s.at-meeting.startedAt)/1000)%60).padStart(2,'0')}] ${s.speaker}: ${s.text}`).join('\n\n')}\n\n## AI questions\n\n${meeting.questions.map(q=>`- ${q.text}\n  ${q.skipped?'Skipped':q.answer||'Unanswered'}`).join('\n')}`;}
export function download(blob:Blob,name:string){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

export type MeetingExport = Pick<SavedMeetingDocument, 'title' | 'transcript' | 'notes' | 'context' | 'date' | 'elapsed' | 'questions'>;
export type ShareFormat = 'slack' | 'notion' | 'markdown';

export function formatMeeting(meeting: MeetingExport, format: ShareFormat = 'markdown'): string {
  const { context, notes } = meeting;
  const actions = context.structuredActionItems?.length ? context.structuredActionItems : context.actionItems.map(task => ({ task, owner: null, deadline: null }));
  const actionText = actions.map(item => `${item.task}${item.owner ? ` — ${item.owner}` : ''}${item.deadline ? ` · Due ${item.deadline}` : ''}`);
  const summary = executiveSummary(context.summary);
  if (format === 'slack') return [
    `*${meeting.title}*`, '*Summary*', summary || 'Summary is still being prepared.',
    ...(context.decisions.length ? ['*Key decisions*', ...context.decisions.map(item => `• ${item}`)] : []),
    ...(actions.length ? ['*Actions*', ...actionText.map((item, index) => `${actionCompleted(notes, actions[index].task) ? ':white_check_mark:' : ':white_large_square:'} ${item}`)] : []),
    ...(context.unresolvedQuestions.length ? ['*Open questions*', ...context.unresolvedQuestions.map(item => `• ${item}`)] : []),
  ].join('\n');
  const sections = [
    `# ${meeting.title}`, `${new Date(meeting.date).toISOString().slice(0, 10)} · ${Math.floor(meeting.elapsed / 60)}m ${Math.floor(meeting.elapsed % 60)}s`,
    `## Executive summary\n\n${format === 'notion' ? '> 💡 ' : ''}${summary || 'Summary is still being prepared.'}`,
    ...(context.topics.length ? [`## Topics\n\n${context.topics.join(' · ')}`] : []),
    ...(context.decisions.length ? [`## Key decisions\n\n${context.decisions.map(item => `- ${item}`).join('\n')}`] : []),
    ...(actions.length ? [`## Action items\n\n${actionText.map((item, index) => `- [${actionCompleted(notes, actions[index].task) ? 'x' : ' '}] ${item}`).join('\n')}`] : []),
    ...(context.unresolvedQuestions.length ? [`## Unresolved inquiries\n\n${context.unresolvedQuestions.map(item => `- ${item}`).join('\n')}`] : []),
    ...(context.resolvedQuestions?.length ? [`## Resolved inquiries\n\n${context.resolvedQuestions.map(item => `- ${item}`).join('\n')}`] : []),
    ...(notes.trim() ? [`## Meeting notes\n\n${notes}`] : []),
    `## Transcript\n\n${transcriptTurns(meeting.transcript).map(turn => `${turn.timestamp ? `[${turn.timestamp}] ` : ''}${turn.labeled ? `**${turn.speaker}:** ` : ''}${format === 'notion' ? `\n> ${turn.text.replace(/\n/gu, '\n> ')}` : turn.text}`).join('\n\n')}`,
    ...(meeting.questions?.length ? [`## AI clarifications\n\n${meeting.questions.map(item => `- ${item}`).join('\n')}`] : []),
  ];
  return sections.join('\n\n') + '\n';
}

import { Check, CircleHelp, Clock3, ListTodo, Sparkles, Tag } from 'lucide-react';
import { AskAssistant } from './ask-assistant';
import { MeetingNotesEditor } from './meeting-notes-editor';

export type MeetingContext = {
  summary: string;
  topics: string[];
  decisions: string[];
  actionItems: string[];
  unresolvedQuestions: string[];
  structuredActionItems?: { task: string; owner: string | null; deadline: string | null }[];
  deadlines?: string[];
  people?: string[];
  resolvedQuestions?: string[];
};

export const emptyContext: MeetingContext = { summary: '', topics: [], decisions: [], actionItems: [], unresolvedQuestions: [] };

export function WorkspaceContext({ context, status, notes, notice, enabled, active, retry, editable, onNotesChange, onAsk, manualBusy, manualResponse, transcriptAvailable, questions }: {
  context: MeetingContext; status: string; notes: string; notice: string; enabled: boolean; active: boolean; retry?: () => void;
  editable?: boolean; onNotesChange?: (notes: string) => void; onAsk?: (question: string) => Promise<void> | void;
  manualBusy?: boolean; manualResponse?: string; transcriptAvailable?: boolean; questions?: string[];
}) {
  const state = manualBusy ? 'thinking' : status === 'thinking' || status === 'transcribing' ? 'analyzing' : status === 'speaking' ? 'asking' : active && enabled ? 'listening' : 'idle';
  const label = manualBusy ? 'Thinking' : !enabled ? 'Clarifications paused' : status === 'paused' ? 'Paused' : status === 'speaking' ? 'AI asking' : status === 'thinking' || status === 'transcribing' ? 'Analyzing' : status === 'waiting' ? 'Possible clarification' : active ? 'Listening' : 'Idle';
  const hasContext = !!context.summary || context.topics.length > 0 || context.decisions.length > 0 || context.actionItems.length > 0 || context.unresolvedQuestions.length > 0;
  return <aside className="workspace-context" aria-label="Meeting context">
    <div className="context-heading"><span>MEETING CONTEXT</span><Sparkles size={15} aria-hidden="true" /></div>
    <section className={`context-assistant ai-state-${state}`} aria-label="AI status" data-ai-state={state}>
      <span className="assistant-icon"><Sparkles size={19} aria-hidden="true" /></span>
      <div><h2>Hush assistant</h2><p role="status"><span className={`status-dot ${active ? 'is-recording' : ''}`} />{label}</p></div>
      {(state === 'thinking' || state === 'analyzing') && <span className="thinking-dots" aria-hidden="true"><i /><i /><i /></span>}
    </section>
    {notice && <p className="notice-message context-notice" role="status">{notice}{retry && notice.includes('AI analysis is temporarily unavailable') && <button className="text-button" onClick={retry}>Retry meeting notes</button>}</p>}
    <section className="context-section" aria-label="Meeting summary"><h3><Sparkles size={14} aria-hidden="true" />Summary</h3><p className={context.summary ? 'context-summary' : 'context-placeholder'}>{context.summary || (active ? 'Listening for the details that matter.' : 'Your summary, decisions, and next steps will appear as you talk.')}</p></section>
    {!!context.topics.length && <section className="context-section" aria-label="Detected topics"><h3><Tag size={14} aria-hidden="true" />Topics</h3><div className="topic-list">{context.topics.map((topic, index) => <span key={`${index}-${topic}`}>{topic}</span>)}</div></section>}
    <ContextList title="Decisions" icon={<Check size={14} aria-hidden="true" />} items={context.decisions} />
    {context.structuredActionItems?.length ? <section className="context-section" aria-label="Action items"><h3><ListTodo size={14} aria-hidden="true" />Action items</h3><ul className="structured-actions">{context.structuredActionItems.map((item, index) => <li key={`${index}-${item.task}`}><p>{item.task}</p><span>{item.owner || 'Owner not assigned'}{item.deadline ? ` · ${item.deadline}` : ' · No deadline'}</span></li>)}</ul><p className="context-placeholder">Suggestions only. Review before creating tasks.</p></section> : <ContextList title="Action items" icon={<ListTodo size={14} aria-hidden="true" />} items={context.actionItems} />}
    <ContextList title="Unresolved questions" icon={<CircleHelp size={14} aria-hidden="true" />} items={context.unresolvedQuestions} />
    <ContextList title="Important deadlines" icon={<Clock3 size={14} aria-hidden="true" />} items={context.deadlines || []} />
    {!!context.resolvedQuestions?.length && <details className="context-section context-review"><summary>Resolved questions · {context.resolvedQuestions.length}</summary><ul className="context-items">{context.resolvedQuestions.map((question, index) => <li key={`${index}-${question}`}>{question}</li>)}</ul></details>}
    {!!questions?.length && <details className="context-section context-review"><summary>Clarification history · {questions.length}</summary><ul className="context-items">{questions.map((question, index) => <li key={`${index}-${question}`}>{question}</li>)}</ul></details>}
    {(!!notes || editable) && <MeetingNotesEditor notes={notes} editable={!!editable} onChange={onNotesChange} />}
    {onAsk && <AskAssistant busy={!!manualBusy} response={manualResponse || ''} disabled={!transcriptAvailable} onAsk={onAsk} />}
    {hasContext && <p className="context-footnote">AI can miss details. Review before sharing.</p>}
  </aside>;
}

function ContextList({ title, icon, items }: { title: string; icon: React.ReactNode; items: string[] }) {
  if (!items.length) return null;
  return <section className="context-section" aria-label={title}><h3>{icon}{title}</h3><ul className="context-items">{items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></section>;
}

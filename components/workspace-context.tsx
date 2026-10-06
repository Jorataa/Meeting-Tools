import { Check, CircleHelp, Clock3, ListTodo, Sparkles, Tag } from 'lucide-react';
import { AskAssistant } from './ask-assistant';
import { MeetingNotesEditor } from './meeting-notes-editor';

export type MeetingContext = {
  summary: string;
  topics: string[];
  decisions: string[];
  actionItems: string[];
  unresolvedQuestions: string[];
  structuredActionItems?: { task: string; owner: string | null; deadline: string | null; approved?: boolean }[];
  deadlines?: string[];
  people?: string[];
  resolvedQuestions?: string[];
};

export const emptyContext: MeetingContext = { summary: '', topics: [], decisions: [], actionItems: [], unresolvedQuestions: [] };

export function WorkspaceContext({ context, status, notes, notice, enabled, active, retry, editable, onNotesChange, onAsk, manualBusy, manualResponse, transcriptAvailable, questions, onApproveActionItem, onDismissActionItem, onResolveQuestion }: {
  context: MeetingContext; status: string; notes: string; notice: string; enabled: boolean; active: boolean; retry?: () => void;
  editable?: boolean; onNotesChange?: (notes: string) => void; onAsk?: (question: string) => Promise<void> | void;
  manualBusy?: boolean; manualResponse?: string; transcriptAvailable?: boolean; questions?: string[];
  onApproveActionItem?: (index: number) => void; onDismissActionItem?: (index: number) => void; onResolveQuestion?: (question: string) => void;
}) {
  const state = manualBusy ? 'thinking' : status === 'thinking' || status === 'transcribing' ? 'analyzing' : status === 'speaking' ? 'asking' : active && enabled ? 'listening' : 'idle';
  const label = manualBusy ? 'Thinking…' : !enabled ? 'Clarifications paused' : status === 'paused' ? 'Paused' : status === 'speaking' ? 'AI asking' : status === 'thinking' || status === 'transcribing' ? 'Analyzing transcript' : status === 'waiting' ? 'Possible clarification' : active ? 'Listening' : 'Ready';
  const hasContext = !!context.summary || context.topics.length > 0 || context.decisions.length > 0 || context.actionItems.length > 0 || context.unresolvedQuestions.length > 0;
  return <aside className="workspace-context" aria-label="Meeting context">
    <div className="context-heading"><span>MEETING CONTEXT</span><Sparkles size={15} aria-hidden="true" /></div>
    <section className={`context-assistant ai-state-${state}`} aria-label="AI status" data-ai-state={state}>
      <span className="assistant-icon" aria-hidden="true">
        <Sparkles size={18} />
      </span>
      <div className="assistant-details">
        <h2>Hush assistant</h2>
        <p role="status"><span className={`status-dot ${active ? 'is-recording' : ''}`} />{label}</p>
      </div>
      {state === 'thinking' && <span className="thinking-dots" aria-label="Thinking"><i /><i /><i /></span>}
      {state === 'analyzing' && <span className="analyzing-indicator" aria-label="Analyzing context"><span className="analyzing-bar" /></span>}
    </section>
    {notice && <p className="notice-message context-notice" role="status">{notice}{retry && notice.includes('AI analysis is temporarily unavailable') && <button className="text-button" onClick={retry}>Retry meeting notes</button>}</p>}
    <section className="context-section" aria-label="Meeting summary"><h3><Sparkles size={14} aria-hidden="true" />Summary</h3><p className={context.summary ? 'context-summary' : 'context-placeholder'}>{context.summary || (active ? 'Listening for the details that matter.' : 'Your summary, decisions, and next steps will appear as you talk.')}</p></section>
    {!!context.topics.length && <section className="context-section" aria-label="Detected topics"><h3><Tag size={14} aria-hidden="true" />Topics</h3><div className="topic-list">{context.topics.map((topic, index) => <span key={`${index}-${topic}`}>{topic}</span>)}</div></section>}
    <ContextList title="Decisions" icon={<Check size={14} aria-hidden="true" />} items={context.decisions} />
    {context.structuredActionItems?.length ? <section className="context-section" aria-label="Action items">
      <h3><ListTodo size={14} aria-hidden="true" />Action items</h3>
      <ul className="structured-actions">{context.structuredActionItems.map((item, index) => <li key={`${index}-${item.task}`} className="structured-action-card">
        <div className="action-card-text">
          <p>{item.task}</p>
          <span>{item.owner || 'Owner not assigned'}{item.deadline ? ` · ${item.deadline}` : ' · No deadline'}</span>
        </div>
        {item.approved ? <span className="action-approved-pill"><Check size={11} aria-hidden="true" /> Approved</span> : (onApproveActionItem ? <div className="action-approval-row">
          <button type="button" className="action-approve-button" onClick={() => onApproveActionItem(index)} title="Approve this task"><Check size={11} aria-hidden="true" /> Approve</button>
          {onDismissActionItem && <button type="button" className="action-dismiss-button" onClick={() => onDismissActionItem(index)} title="Dismiss suggestion">Ignore</button>}
        </div> : null)}
      </li>)}</ul>
      <p className="context-placeholder">Require approval before creating tasks.</p>
    </section> : <ContextList title="Action items" icon={<ListTodo size={14} aria-hidden="true" />} items={context.actionItems} />}
    {!!context.unresolvedQuestions.length && <section className="context-section" aria-label="Unresolved questions">
      <h3><CircleHelp size={14} aria-hidden="true" />Unresolved questions</h3>
      <ul className="context-items">{context.unresolvedQuestions.map((item, index) => <li key={`${index}-${item}`} className="unresolved-question-item">
        <span>{item}</span>
        {onResolveQuestion && <button type="button" className="resolve-question-btn" onClick={() => onResolveQuestion(item)} title="Mark as resolved"><Check size={11} aria-hidden="true" /> Resolve</button>}
      </li>)}</ul>
    </section>}
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

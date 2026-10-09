import { Check, CircleHelp, ListTodo, Sparkles } from 'lucide-react';
import type { MeetingContext } from '@/lib/live/policy';
import { actionCompleted, executiveSummary } from '@/lib/workspace-text';

export function ExecutiveBrief({ context, notes, onToggleAction, onResolve }: {
  context: MeetingContext; notes: string; onToggleAction: (task: string) => void; onResolve: (question: string) => void;
}) {
  const actions = context.structuredActionItems?.length ? context.structuredActionItems : context.actionItems.map(task => ({ task, owner: null, deadline: null }));
  return <section className="executive-brief" aria-label="Executive brief">
    <div className="brief-heading"><span className="sparkle-badge"><Sparkles size={16} aria-hidden="true" /></span><h2>Your meeting, understood.</h2><span className="brief-label">EXECUTIVE BRIEF</span></div>
    <p className={`brief-summary ${context.summary ? '' : 'context-placeholder'}`} role="status">{executiveSummary(context.summary) || 'Your transcript is ready. Hush is gathering the takeaways.'}</p>
    <div className="brief-grid">
      <div className="brief-section"><h3><Check size={15} aria-hidden="true" />Key decisions</h3>{context.decisions.length ? <ul className="decision-list">{context.decisions.map((decision, index) => <li key={`${index}-${decision}`}><span className="decision-check"><Check size={12} aria-hidden="true" /></span>{decision}</li>)}</ul> : <p className="context-placeholder">No decisions captured yet.</p>}</div>
      <div className="brief-section"><h3><ListTodo size={15} aria-hidden="true" />Next steps<span>{actions.length}</span></h3>{actions.length ? <ul className="brief-actions">{actions.map((action, index) => <li key={`${index}-${action.task}`}><label className={actionCompleted(notes, action.task) ? 'action-completed' : ''}><input type="checkbox" checked={actionCompleted(notes, action.task)} onChange={() => onToggleAction(action.task)} /><span><strong>{action.task}</strong><small>{action.owner || 'Unassigned'}{action.deadline ? ` · ${action.deadline}` : ' · No deadline'}</small></span></label></li>)}</ul> : <p className="context-placeholder">No action items captured yet.</p>}</div>
    </div>
    {!!context.unresolvedQuestions.length && <div className="brief-open-questions"><h3><CircleHelp size={15} aria-hidden="true" />Still to clarify</h3>{context.unresolvedQuestions.map((question, index) => <div key={`${index}-${question}`}><p>{question}</p><button className="text-button" onClick={() => onResolve(question)}><Check size={13} aria-hidden="true" />Mark as resolved</button></div>)}</div>}
  </section>;
}

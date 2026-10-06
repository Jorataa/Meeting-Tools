import { Check, CircleHelp, ListTodo, Sparkles, Tag } from 'lucide-react';

export type MeetingContext = {
  summary: string;
  topics: string[];
  decisions: string[];
  actionItems: string[];
  unresolvedQuestions: string[];
};

export const emptyContext: MeetingContext = { summary: '', topics: [], decisions: [], actionItems: [], unresolvedQuestions: [] };

export function WorkspaceContext({ context, status, notes, notice, enabled, active, retry }: {
  context: MeetingContext; status: string; notes: string; notice: string; enabled: boolean; active: boolean; retry?: () => void;
}) {
  const label = !enabled ? 'Clarifications paused' : status === 'paused' ? 'Paused' : status === 'speaking' ? 'AI asking' : status === 'thinking' || status === 'transcribing' ? 'Understanding' : status === 'waiting' ? 'Possible clarification' : active ? 'Listening' : 'Ready to listen';
  return <aside className="workspace-context" aria-label="Meeting context">
    <div className="context-heading"><span>MEETING CONTEXT</span><Sparkles size={15} aria-hidden="true" /></div>
    <section className={`context-assistant ${status === 'thinking' ? 'is-thinking' : ''}`} aria-label="AI status">
      <span className="assistant-icon"><Sparkles size={19} aria-hidden="true" /></span>
      <div><h2>Hush assistant</h2><p role="status"><span className={`status-dot ${active ? 'is-recording' : ''}`} />{label}</p></div>
      <p className="assistant-description">Useful questions at natural pauses. More room for your conversation.</p>
    </section>
    {notice && <p className="notice-message context-notice" role="status">{notice}{retry && notice.includes('AI analysis is temporarily unavailable') && <button className="text-button" onClick={retry}>Retry meeting notes</button>}</p>}
    <section className="context-section" aria-label="Meeting summary"><h3><Sparkles size={14} aria-hidden="true" />Summary</h3><p className={context.summary ? 'context-summary' : 'context-placeholder'}>{context.summary || 'A concise recap will take shape as your conversation progresses.'}</p></section>
    <section className="context-section" aria-label="Detected topics"><h3><Tag size={14} aria-hidden="true" />Topics<span>{context.topics.length}</span></h3>{context.topics.length ? <div className="topic-list">{context.topics.map((topic, index) => <span key={`${index}-${topic}`}>{topic}</span>)}</div> : <p className="context-placeholder">Topics appear when there is enough context.</p>}</section>
    <ContextList title="Decisions" icon={<Check size={14} aria-hidden="true" />} items={context.decisions} empty="Agreed decisions will be collected here." />
    <ContextList title="Action items" icon={<ListTodo size={14} aria-hidden="true" />} items={context.actionItems} empty="Next steps and owners, as they are discussed." />
    <ContextList title="Unresolved questions" icon={<CircleHelp size={14} aria-hidden="true" />} items={context.unresolvedQuestions} empty="Open questions will stay visible here." />
    {notes && <section className="context-section meeting-notes" aria-label="Meeting notes"><h3>Meeting notes</h3><p className="ai-notes-content">{notes}</p></section>}
    <p className="context-footnote">AI notes can miss details. Review against your transcript.</p>
  </aside>;
}

function ContextList({ title, icon, items, empty }: { title: string; icon: React.ReactNode; items: string[]; empty: string }) {
  return <section className="context-section" aria-label={title}><h3>{icon}{title}<span>{items.length}</span></h3>{items.length ? <ul className="context-items">{items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul> : <p className="context-placeholder">{empty}</p>}</section>;
}

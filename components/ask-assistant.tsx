import { useState } from 'react';
import { ArrowUp, Sparkles } from 'lucide-react';

export function AskAssistant({ busy, response, disabled, onAsk }: {
  busy: boolean;
  response: string;
  disabled: boolean;
  onAsk: (question: string) => Promise<void> | void;
}) {
  const [question, setQuestion] = useState('');
  return <section className="context-section ask-assistant" aria-label="Ask Hush">
    <h3><Sparkles size={14} aria-hidden="true" />Ask Hush</h3>
    <form onSubmit={event => {
      event.preventDefault();
      const text = question.trim();
      if (!text || busy || disabled) return;
      void onAsk(text);
      setQuestion('');
    }}>
      <label className="visually-hidden" htmlFor="assistant-question">Ask about this meeting</label>
      <input id="assistant-question" value={question} onChange={event => setQuestion(event.target.value)} maxLength={600} disabled={disabled || busy} placeholder="What did we decide?" />
      <button className="assistant-send" type="submit" aria-label="Ask about this meeting" disabled={disabled || busy || !question.trim()}><ArrowUp size={16} aria-hidden="true" /></button>
    </form>
    {busy && <p className="assistant-working" role="status"><span className="thinking-dots" aria-hidden="true"><i /><i /><i /></span>Thinking about your meeting…</p>}
    {response && <p className="assistant-response" role="status">{response}</p>}
    {disabled && <p className="context-placeholder">Start a conversation or open a meeting to ask a question.</p>}
  </section>;
}

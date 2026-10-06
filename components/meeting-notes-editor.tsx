import { useState } from 'react';
import { Download, Pencil } from 'lucide-react';
import { download } from '@/lib/export';

export function MeetingNotesEditor({ notes, editable, onChange }: {
  notes: string;
  editable: boolean;
  onChange?: (notes: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  return <section className="context-section meeting-notes" aria-label="Meeting notes">
    <h3>Meeting notes{editable && <button className="icon-button" onClick={() => setEditing(value => !value)} aria-label={editing ? 'Finish editing meeting notes' : 'Edit meeting notes'}><Pencil size={13} aria-hidden="true" /></button>}</h3>
    {editing && editable ? <><label className="visually-hidden" htmlFor="meeting-notes-editor">Edit meeting notes</label><textarea id="meeting-notes-editor" value={notes} onChange={event => onChange?.(event.target.value)} maxLength={16000} rows={10} spellCheck /><button className="text-button" onClick={() => setEditing(false)}>Done editing</button></> : <p className="ai-notes-content">{notes || 'Add your notes here after the meeting.'}</p>}
    {editable && notes.trim() && <button className="text-button export-notes" onClick={() => download(new Blob([notes], { type: 'text/plain;charset=utf-8' }), 'meeting-notes.txt')}><Download size={13} aria-hidden="true" />Export notes</button>}
  </section>;
}

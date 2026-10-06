import Link from 'next/link';
import { FileText, Headphones, LayoutGrid, Plus, Search, Settings, Waves } from 'lucide-react';
import type { SavedMeetingDocument } from '@/lib/meeting-document';

export type WorkspaceView = 'meeting' | 'meetings' | 'notes' | 'search' | 'settings';
export type SavedMeeting = SavedMeetingDocument;

export function WorkspaceSidebar({ view, meetings, selectedId, onView, onNew, onOpen, locked, accountEmail, onSignOut }: {
  view: WorkspaceView; meetings: SavedMeeting[]; selectedId: string | null; onView: (view: WorkspaceView) => void; onNew: () => void; onOpen: (id: string) => void; locked: boolean;
  accountEmail?: string; onSignOut?: () => void;
}) {
  return <aside className="workspace-sidebar" aria-label="Workspace navigation">
    <Link href="/" className="workspace-brand" aria-label="Hush home"><span className="brand-mark"><Waves size={23} aria-hidden="true" /></span>hush<span className="brand-period">.</span></Link>
    <button className="sidebar-new" onClick={onNew} disabled={locked}><Plus size={16} aria-hidden="true" />New Meeting</button>
    <nav className="workspace-nav" aria-label="Main navigation">
      {[{ id: 'meeting' as const, label: 'Workspace', icon: Headphones }, { id: 'meetings' as const, label: 'Meetings', icon: LayoutGrid }, { id: 'notes' as const, label: 'Notes', icon: FileText }, { id: 'search' as const, label: 'Search', icon: Search }, { id: 'settings' as const, label: 'Settings', icon: Settings }].map(item => <button key={item.id} className={view === item.id ? 'is-selected' : ''} aria-current={view === item.id ? 'page' : undefined} onClick={() => onView(item.id)}><item.icon size={16} aria-hidden="true" />{item.label}{item.id === 'meetings' && <span>{meetings.length}</span>}</button>)}
    </nav>
    <div className="sidebar-recents"><h2>RECENT MEETINGS</h2>{meetings.length ? meetings.slice(0, 5).map(meeting => <button key={meeting.id} disabled={locked} className={selectedId === meeting.id ? 'is-selected' : ''} onClick={() => onOpen(meeting.id)}><span className="recent-meeting-icon"><FileText size={14} aria-hidden="true" /></span><span><strong>{meeting.title}</strong><small>{new Date(meeting.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small></span></button>) : <p>Your completed meetings will appear here.</p>}</div>
    <div className="sidebar-bottom"><span className="sidebar-avatar">{accountEmail?.slice(0, 1).toUpperCase() || 'H'}</span><div><strong>{accountEmail || 'Your workspace'}</strong><span>{accountEmail ? 'Personal workspace' : 'Saved on this device'}</span></div>{onSignOut && <button className="text-button" onClick={onSignOut} disabled={locked}>Sign out</button>}</div>
  </aside>;
}

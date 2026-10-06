'use client';
import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import { readMeetingDocuments, type SavedMeetingDocument } from './meeting-document';

type Retention = 'device' | 'session';
export const meetingStorageKey = (ownerId: string) => ownerId === 'demo' ? 'hush.meetings.v1' : `hush.meetings.v2.${encodeURIComponent(ownerId)}`;
const preferencesKey = (ownerId: string) => `hush.retention.${encodeURIComponent(ownerId)}`;
export function clearAccountCache(ownerId: string) {
  try { localStorage.removeItem(meetingStorageKey(ownerId)); } catch { /* Sign out remains available when storage is blocked. */ }
}
async function cloudRequest(method: string, body?: unknown, signal?: AbortSignal) {
  const response = await fetch('/api/meetings', { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined, signal: signal || AbortSignal.timeout(12000) });
  const data = await response.json();
  if (!response.ok) throw new Error('Account storage unavailable');
  return data;
}

/** Account-scoped device cache and authenticated persistence, independent of audio. */
export function useMeetingHistory(ownerId: string) {
  const [meetings, updateMeetings] = useState<SavedMeetingDocument[]>([]);
  const [historyReady, setHistoryReady] = useState(false);
  const [storageNotice, setStorageNotice] = useState('');
  const [retention, updateRetention] = useState<Retention>('device');
  const retentionRef = useRef<Retention>('device');
  const documents = useRef<SavedMeetingDocument[]>([]);
  const saved = useRef(new Map<string, string>());
  const version = useRef(0);
  const deleting = useRef(new Set<string>());
  const mutation = useRef<Promise<void>>(Promise.resolve());
  const cloud = ownerId !== 'demo';
  useEffect(() => {
    const generation = ++version.current;
    const abort = new AbortController();
    documents.current = []; saved.current.clear(); deleting.current.clear(); setHistoryReady(false);
    let local: SavedMeetingDocument[] = [];
    let keep: Retention = 'device';
    try {
      keep = localStorage.getItem(preferencesKey(ownerId)) === 'session' ? 'session' : 'device';
      if (keep === 'device') local = readMeetingDocuments(JSON.parse(localStorage.getItem(meetingStorageKey(ownerId)) || '[]')).slice(0, 30);
    } catch { setStorageNotice('Meeting history is unavailable. Export your meeting to keep a copy.'); }
    retentionRef.current = keep; updateRetention(keep); documents.current = local; updateMeetings(local);
    const load = async () => {
      if (cloud && keep === 'device') try {
        const data = await cloudRequest('GET', undefined, abort.signal);
        if (version.current !== generation || abort.signal.aborted) return;
        const remote = readMeetingDocuments(data.meetings);
        // An account never imports history from an anonymous/shared-device key.
        remote.forEach(item => saved.current.set(item.id, JSON.stringify(item)));
        const merged = new Map(remote.map(item => [item.id, item]));
        local.forEach(item => { if (!merged.has(item.id)) merged.set(item.id, item); });
        documents.current = [...merged.values()].sort((a, b) => b.date - a.date).slice(0, 30);
        updateMeetings(documents.current); setStorageNotice('Meeting history is saved to your account, with a device copy.');
      } catch { if (!abort.signal.aborted) setStorageNotice('Account history is unavailable. Your device copy is still available. Reload to retry.'); }
      if (version.current === generation && !abort.signal.aborted) setHistoryReady(true);
    };
    void load();
    const versionRef = version;
    return () => { ++versionRef.current; abort.abort(); };
  }, [ownerId, cloud]);
  const setMeetings = useCallback((next: SetStateAction<SavedMeetingDocument[]>) => {
    const items = typeof next === 'function' ? next(documents.current) : next;
    if (JSON.stringify(items) === JSON.stringify(documents.current)) return;
    documents.current = items.slice(0, 30); updateMeetings(documents.current);
  }, []);
  useEffect(() => {
    if (!historyReady) return;
    try {
      if (retention === 'device') localStorage.setItem(meetingStorageKey(ownerId), JSON.stringify(meetings));
      else localStorage.removeItem(meetingStorageKey(ownerId));
    } catch { setStorageNotice('Device storage is full or unavailable. Export your meeting to keep a copy.'); }
    if (!cloud || retention !== 'device') return;
    const generation = version.current;
    const timer = setTimeout(() => {
      mutation.current = mutation.current.then(async () => {
        for (const item of meetings) {
          if (version.current !== generation || retentionRef.current !== 'device') return;
          const serialized = JSON.stringify(item);
          if (saved.current.get(item.id) === serialized || deleting.current.has(item.id)) continue;
          try {
            await cloudRequest('PUT', item);
            if (version.current !== generation) return;
            saved.current.set(item.id, serialized);
          } catch { if (version.current === generation) setStorageNotice('Account save failed. Your device copy is available; make an export before leaving.'); }
        }
      });
    }, 800);
    return () => { clearTimeout(timer); };
  }, [meetings, ownerId, retention, cloud, historyReady]);
  const setRetention = useCallback((keep: Retention) => {
    retentionRef.current = keep; updateRetention(keep);
    try { localStorage.setItem(preferencesKey(ownerId), keep); if (keep === 'session') localStorage.removeItem(meetingStorageKey(ownerId)); }
    catch { setStorageNotice('Privacy preference could not be saved. Export your meeting and clear browser storage before leaving.'); }
    if (cloud && keep === 'session') setStorageNotice('New meetings stay in this tab. Previously saved account meetings remain until you delete them.');
  }, [ownerId, cloud]);
  const removeMeeting = useCallback(async (id: string) => {
    deleting.current.add(id);
    try {
      await mutation.current;
      if (cloud) await cloudRequest('DELETE', { id });
      setMeetings(current => current.filter(item => item.id !== id)); saved.current.delete(id);
      return true;
    } catch { setStorageNotice('The meeting could not be deleted from your account. Please retry.'); return false; }
    finally { deleting.current.delete(id); }
  }, [cloud, setMeetings]);
  const clearHistory = useCallback(async () => {
    const ids = documents.current.map(item => item.id); ids.forEach(id => deleting.current.add(id));
    try {
      await mutation.current;
      if (cloud) await cloudRequest('DELETE', { all: true, confirmation: 'delete-all-meetings' });
      saved.current.clear(); setMeetings([]); clearAccountCache(ownerId);
      return true;
    } catch { setStorageNotice('Account meetings could not be deleted. Please retry.'); return false; }
    finally { ids.forEach(id => deleting.current.delete(id)); }
  }, [cloud, ownerId, setMeetings]);
  return { meetings, setMeetings, historyReady, storageNotice, retention, setRetention, removeMeeting, clearHistory };
}

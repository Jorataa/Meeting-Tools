'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { LoaderCircle, Waves } from 'lucide-react';
import { TranscriptionApp } from './transcription-app';
import { clearAccountCache } from '@/lib/meeting-storage';

type Identity = { mode: 'supabase' | 'demo' | 'unavailable'; user: { id: string; email: string | null } | null };
export function AuthGate() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [signup, setSignup] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        let response = await fetch('/api/auth', { signal: controller.signal, cache: 'no-store' });
        let data: Identity = await response.json();
        if (data.mode === 'supabase' && !data.user) {
          const refresh = await fetch('/api/session', { method: 'POST', signal: controller.signal });
          if (refresh.ok) { response = await fetch('/api/auth', { signal: controller.signal, cache: 'no-store' }); data = await response.json(); }
        }
        if (!controller.signal.aborted) setIdentity(data);
      } catch { if (!controller.signal.aborted) setNotice('We could not connect. Reload to try again.'); }
    })();
    return () => controller.abort();
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setNotice('');
    try {
      const response = await fetch(signup ? '/api/auth/sign-up' : '/api/auth/sign-in', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }), signal: AbortSignal.timeout(15000) });
      const result = await response.json(); setPassword('');
      if (!response.ok) { setNotice(result.error || 'We could not sign you in. Please try again.'); return; }
      if (result.confirmationRequired) { setNotice('Check your email to confirm your account, then sign in here.'); setSignup(false); return; }
      const next = await fetch('/api/auth', { cache: 'no-store' });
      const data: Identity = await next.json(); if (!data.user) throw new Error('Identity unavailable');
      setIdentity(data);
    } catch { setNotice('Sign in is unavailable right now. Please try again.'); }
    finally { setBusy(false); }
  }
  async function signOut() {
    if (!identity?.user || busy) return;
    setBusy(true);
    try {
      const response = await fetch('/api/auth/sign-out', { method: 'POST', signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('Sign out failed');
      clearAccountCache(identity.user.id); setIdentity({ ...identity, user: null }); setPassword(''); setNotice('');
    } catch { setNotice('We could not sign you out. Please retry.'); }
    finally { setBusy(false); }
  }
  if (identity?.mode === 'demo') return <TranscriptionApp ownerId="demo" />;
  if (identity?.user) return <><TranscriptionApp key={identity.user.id} ownerId={identity.user.id} accountEmail={identity.user.email || 'Your account'} onSignOut={() => void signOut()} />{notice && <p className="auth-notice" role="alert">{notice}</p>}</>;
  return <main className="auth-shell"><section className="auth-card" aria-label="Account access"><div className="workspace-brand"><Waves size={25} aria-hidden="true" />hush<span className="brand-period">.</span></div>
    {!identity ? <><h1>Your conversation, in good hands.</h1><p role="status">{notice || 'Connecting to your workspace…'}</p>{!notice && <LoaderCircle className="auth-spinner" size={18} aria-hidden="true" />}</> : identity.mode === 'unavailable' ? <><h1>Your private workspace is being prepared.</h1><p>Account access needs to be configured before this workspace can accept meetings.</p><p className="auth-caption">Please contact the workspace owner.</p></> : <><h1>{signup ? 'Make room for better meetings.' : 'Welcome back.'}</h1><p>{signup ? 'Create your personal meeting workspace.' : 'Sign in to your private meeting workspace.'}</p><form onSubmit={event => void submit(event)}>
      <label htmlFor="account-email">Email</label><input id="account-email" type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} maxLength={254} required />
      <label htmlFor="account-password">Password</label><input id="account-password" type="password" autoComplete={signup ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} minLength={signup ? 12 : 1} maxLength={128} required />
      {notice && <p role="alert">{notice}</p>}<button className="primary-button" type="submit" disabled={busy}>{busy ? 'Connecting…' : signup ? 'Create account' : 'Sign in'}</button>
    </form><button className="text-button" disabled={busy} onClick={() => { setSignup(current => !current); setNotice(''); setPassword(''); }}>{signup ? 'Already have an account? Sign in' : 'Create an account'}</button><p className="auth-caption">Only your account can access your saved meetings.</p></>}
  </section></main>;
}

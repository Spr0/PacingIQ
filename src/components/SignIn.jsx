// ---------------------------------------------------------------------------
// Magic-link sign-in screen, shown whenever there's no Supabase session.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { useAuth } from '../state/AuthContext.jsx';
import { Brandmark } from './icons.jsx';

export default function SignIn() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setBusy(true);
    setError('');
    try {
      await signIn(trimmed);
      setSent(true);
    } catch (err) {
      setError(err.message || 'Could not send the sign-in link. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <span className="brandmark">
          <Brandmark />
        </span>
        <h1>Sierra Rams Coaching Intelligence</h1>
        {sent ? (
          <>
            <p className="muted">
              Check <strong>{email}</strong> for a sign-in link. It's safe to close this tab.
            </p>
            <button className="btn btn--ghost btn--sm" onClick={() => setSent(false)}>
              Use a different email
            </button>
          </>
        ) : (
          <form onSubmit={submit} className="stack">
            <p className="muted">Sign in with your email — no password needed.</p>
            <input
              className="input"
              type="email"
              required
              autoFocus
              placeholder="you@school.org"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {error && <p className="muted small" style={{ color: 'var(--red)' }}>{error}</p>}
            <button className="btn btn--primary" type="submit" disabled={busy || !email.trim()}>
              {busy ? 'Sending link…' : 'Send sign-in link'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

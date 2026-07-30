// ---------------------------------------------------------------------------
// Email + password sign-in, shown whenever there's no Supabase session.
//
// Deliberately no "Forgot password?" link and no self-signup: district email
// filtering blocks Supabase's outbound mail (it's what killed the earlier
// magic-link flow, and why "Invite user" fails in the dashboard), so any
// flow that depends on an email arriving would dead-end. A locked-out user
// gets a new password set for them in the Supabase dashboard instead --
// see the runbook note in supabase/schema.sql.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { useAuth } from '../state/AuthContext.jsx';
import { Brandmark } from './icons.jsx';

export default function SignIn() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || !password || busy) return;
    setBusy(true);
    setError('');
    try {
      await signIn(trimmed, password);
      // On success the onAuthStateChange listener in AuthContext swaps this
      // screen out, so there's nothing to do here.
    } catch (err) {
      setError(err.message || 'Could not sign in. Check your email and password.');
      setPassword('');
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
        <form onSubmit={submit} className="stack">
          <p className="muted">Sign in with your school email and password.</p>
          <input
            className="input"
            type="email"
            required
            autoFocus
            autoComplete="username"
            placeholder="you@susd12.org"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className="input"
            type="password"
            required
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && (
            <p className="muted small" style={{ color: 'var(--red-600)' }}>
              {error}
            </p>
          )}
          <button className="btn btn--primary" type="submit" disabled={busy || !email.trim() || !password}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="muted small" style={{ margin: 0 }}>
            Need access or forgot your password? Contact your instructional coach.
          </p>
        </form>
      </div>
    </div>
  );
}

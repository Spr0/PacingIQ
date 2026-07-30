// ---------------------------------------------------------------------------
// Forced password change, shown after sign-in when profiles.must_change_password
// is set (see supabase/migrations/003_force_password_change.sql).
//
// Accounts are provisioned by hand with a temporary password, so this is what
// makes sure the shared starter password is used exactly once. There is no
// skip: App.jsx renders this instead of the app until the flag clears.
// Deliberately not an email-based reset -- district mail filtering blocks
// Supabase's outbound email, which is what broke magic links and the
// dashboard's "Invite user" button.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { useAuth } from '../state/AuthContext.jsx';
import * as store from '../data/store.js';
import { Brandmark } from './icons.jsx';

const MIN_LENGTH = 10;

// Shown up front and ticked off live, rather than only scolding after a failed
// attempt: the submit button is disabled until every rule passes, and a
// disabled button with no stated reason is just a dead end.
//
// These mirror Supabase's own password policy (Authentication > Sign In /
// Providers > Email). Supabase re-checks server-side, and its message is
// surfaced verbatim below if it disagrees -- so if the project policy is ever
// tightened beyond this list, the user still learns why instead of seeing an
// all-green checklist and an unexplained refusal.
const RULES = [
  { id: 'length', label: `At least ${MIN_LENGTH} characters`, test: (p) => p.length >= MIN_LENGTH },
  { id: 'case', label: 'An uppercase and a lowercase letter', test: (p) => /[a-z]/.test(p) && /[A-Z]/.test(p) },
  { id: 'digit', label: 'At least one number', test: (p) => /\d/.test(p) },
];

function Rule({ met, children }) {
  return (
    <li>
      <span className={`check ${met ? 'check--done' : 'check--todo'}`} aria-hidden="true">
        {met ? '✓' : ''}
      </span>
      <span style={{ color: met ? 'var(--text-strong)' : 'var(--text-muted)' }}>{children}</span>
    </li>
  );
}

export default function SetPassword() {
  const { profile, signOut, refreshProfile } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const checks = RULES.map((r) => ({ ...r, met: r.test(password) }));
  const matches = password.length > 0 && password === confirm;
  const allMet = checks.every((c) => c.met) && matches;
  const ready = allMet && !busy;

  async function submit(e) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError('');
    try {
      await store.updateMyPassword(password);
      // Re-reads the profile, which now has must_change_password = false, so
      // App.jsx swaps this screen out for the app itself.
      await refreshProfile();
    } catch (err) {
      setError(err.message || 'Could not set your password. Try again.');
    } finally {
      // Re-enable rather than leaving a dead "Saving…" button if the password
      // saved but the profile re-read failed. On success this component is
      // already unmounting, so it's a no-op there.
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <span className="brandmark">
          <Brandmark />
        </span>
        <h1>Set your password</h1>
        <form onSubmit={submit} className="stack">
          <p className="muted">
            You're signed in as <strong>{profile?.email}</strong> with a temporary password. Choose
            your own before continuing — nobody else will know it, including your coach.
          </p>
          <input
            className="input"
            type="password"
            required
            autoFocus
            autoComplete="new-password"
            placeholder="New password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby="pw-rules"
          />
          <input
            className="input"
            type="password"
            required
            autoComplete="new-password"
            placeholder="Confirm new password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />

          <ul className="checklist" id="pw-rules" style={{ marginTop: 2 }}>
            {checks.map((c) => (
              <Rule key={c.id} met={c.met}>
                {c.label}
              </Rule>
            ))}
            <Rule met={matches}>Both entries match</Rule>
          </ul>

          {error && (
            <p className="small" style={{ color: 'var(--red-600)', margin: 0 }}>
              {error}
            </p>
          )}
          <button className="btn btn--primary" type="submit" disabled={!ready}>
            {busy ? 'Saving…' : 'Set password and continue'}
          </button>
          <button className="btn btn--ghost btn--sm" type="button" onClick={signOut}>
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}

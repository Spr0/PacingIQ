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

export default function SetPassword() {
  const { profile, signOut, refreshProfile } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Client-side checks are for fast feedback only; Supabase enforces the
  // project's real password policy server-side in updateUser().
  const tooShort = password.length > 0 && password.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && password !== confirm;
  const ready = password.length >= MIN_LENGTH && password === confirm && !busy;

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
            placeholder={`New password (at least ${MIN_LENGTH} characters)`}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
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
          {tooShort && (
            <p className="muted small" style={{ margin: 0 }}>
              Use at least {MIN_LENGTH} characters.
            </p>
          )}
          {mismatch && (
            <p className="small" style={{ color: 'var(--red-600)', margin: 0 }}>
              The two passwords don't match.
            </p>
          )}
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

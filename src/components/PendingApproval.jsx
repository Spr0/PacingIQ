// ---------------------------------------------------------------------------
// Shown once someone signs in but before a coach/admin has assigned them a
// real role. New sign-ins default to 'pending' (see the on_auth_user_created
// trigger in supabase/schema.sql) precisely so this is the default, not
// instant access.
// ---------------------------------------------------------------------------

import { useAuth } from '../state/AuthContext.jsx';
import { Brandmark } from './icons.jsx';

export default function PendingApproval() {
  const { profile, signOut, refreshProfile } = useAuth();

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <span className="brandmark">
          <Brandmark />
        </span>
        <h1>Waiting on access</h1>
        <p className="muted">
          You're signed in as <strong>{profile?.email}</strong>, but nobody's assigned you a role
          yet. Ask your coach to add you in Supabase (Table Editor → profiles), then refresh.
        </p>
        <div className="row" style={{ gap: 8, justifyContent: 'center', marginTop: 8 }}>
          <button className="btn btn--ghost btn--sm" onClick={refreshProfile}>
            Check again
          </button>
          <button className="btn btn--ghost btn--sm" onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

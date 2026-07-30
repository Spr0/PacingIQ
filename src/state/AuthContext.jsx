// ---------------------------------------------------------------------------
// Auth state: the Supabase session and the signed-in user's profile
// (name + role from the `profiles` table). Wraps AppProvider, which only
// ever renders once there's a session and an approved (non-pending) role.
//
// Sign-in is email + password, per person. This replaced a temporary
// anonymous auto-signin (which handed every visitor a 'coach' role) and,
// before that, magic links -- district email filtering blocked link
// delivery, so nothing here depends on an email arriving. Accounts are
// created by hand in the Supabase dashboard; a signed-in user with no
// assigned role is 'pending' and sees PendingApproval, not the app.
// ---------------------------------------------------------------------------

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import * as store from '../data/store.js';

const AuthContext = createContext(null);

// Resolves to `undefined` (treated the same as "no session" by callers) if
// `promise` doesn't settle within `ms`, instead of leaving the caller stuck
// waiting forever.
function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      }
    );
  });
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = not checked yet, null = signed out
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async () => {
    try {
      setProfile(await store.getMyProfile());
    } catch {
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // getSession() can reject, and can also hang instead of settling at
        // all (a known supabase-js issue around its cross-tab auth lock).
        // Either way `loading` never came back down, which left the app on
        // `if (loading) return null` in App.jsx permanently blank until a
        // refresh happened to dodge the race. Racing it against a timeout
        // bounds the hang; the try/finally covers a plain rejection.
        const s = await withTimeout(store.getSession(), 8000);
        if (cancelled) return;
        setSession(s || null);
        if (s) await loadProfile();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    const unsubscribe = store.onAuthStateChange(async (s) => {
      if (cancelled) return;
      setSession(s);
      if (s) await loadProfile();
      else setProfile(null);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [loadProfile]);

  const signIn = useCallback((email, password) => store.signInWithPassword(email, password), []);
  const signOut = useCallback(() => store.signOut(), []);
  const refreshProfile = useCallback(() => loadProfile(), [loadProfile]);

  const value = { session, profile, loading, signIn, signOut, refreshProfile };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

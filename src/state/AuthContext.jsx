// ---------------------------------------------------------------------------
// Auth state: the Supabase session and the signed-in user's profile
// (name + role from the `profiles` table). Wraps AppProvider, which only
// ever renders once there's a session and an approved (non-pending) role.
// ---------------------------------------------------------------------------

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import * as store from '../data/store.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = not checked yet, null = signed out
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async () => {
    try {
      const p = await store.getMyProfile();
      setProfile(p);
    } catch {
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    store.getSession().then(async (s) => {
      if (cancelled) return;
      setSession(s);
      if (s) await loadProfile();
      setLoading(false);
    });

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

  const signIn = useCallback((email) => store.signInWithEmail(email), []);
  const signOut = useCallback(() => store.signOut(), []);

  const value = { session, profile, loading, signIn, signOut, refreshProfile: loadProfile };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

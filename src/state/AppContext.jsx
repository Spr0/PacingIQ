// ---------------------------------------------------------------------------
// App-wide data state: the signed-in user's identity (from AuthContext) and
// the in-memory mirror of the Supabase-backed collections. Every page reads
// collections and rollups from here and mutates through `db`, which writes
// through the store, appends an audit entry, and refreshes.
//
// Only ever rendered once AuthContext has a session and an approved profile
// (see App.jsx), so `profile` here is always present and non-pending.
// ---------------------------------------------------------------------------

import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import * as store from '../data/store.js';
import { useAuth } from './AuthContext.jsx';
import { ROLE_LABELS, initialsOf } from '../lib/permissions.js';
import { buildAllRollups } from '../lib/intelligence.js';

const AppContext = createContext(null);

const EMPTY_COLLECTIONS = {
  teachers: [],
  observations: [],
  pacingEntries: [],
  assessments: [],
  interventions: [],
  actionPlanTemplates: [],
  actionPlans: [],
  goals: [],
  auditLog: [],
};

export function AppProvider({ children }) {
  const { profile } = useAuth();
  const [state, setState] = useState(EMPTY_COLLECTIONS);
  const [loading, setLoading] = useState(true);

  const roleKey = profile.role;
  const user = useMemo(
    () => ({ name: profile.name || profile.email, label: ROLE_LABELS[roleKey] || roleKey, initials: initialsOf(profile.name || profile.email) }),
    [profile, roleKey]
  );

  const refresh = useCallback(async () => {
    const next = await store.loadAll();
    setState(next);
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  // Mutation wrappers. Each writes through the store, logs an audit entry,
  // and refreshes. `db.insert/update/remove` take an optional audit action
  // string. Fire-and-forget from callers is fine -- state updates once the
  // request resolves, same as the rest of React's async data flow.
  const db = useMemo(
    () => ({
      async insert(collection, record, auditAction) {
        const row = await store.insert(collection, record);
        if (auditAction) await store.logAudit(user, auditAction, describe(collection, row));
        await refresh();
        return row;
      },
      async update(collection, id, patch, auditAction) {
        const row = await store.update(collection, id, patch);
        if (auditAction) await store.logAudit(user, auditAction, describe(collection, row));
        await refresh();
        return row;
      },
      async remove(collection, id, auditAction) {
        await store.remove(collection, id);
        if (auditAction) await store.logAudit(user, auditAction, `${collection} ${id}`);
        await refresh();
      },
      async audit(action, detail) {
        await store.logAudit(user, action, detail);
        await refresh();
      },
    }),
    [user, refresh]
  );

  const rollups = useMemo(
    () => buildAllRollups(state.teachers, state),
    [state]
  );

  const rollupFor = useCallback(
    (teacherId) => rollups.find((r) => r.teacher.id === teacherId) || null,
    [rollups]
  );

  if (loading) return null;

  const value = {
    user,
    roleKey,
    ...state,
    rollups,
    rollupFor,
    db,
    refresh,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

function describe(collection, row) {
  if (!row) return collection;
  return `${collection}: ${row.name || row.title || row.concern || row.id}`;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}

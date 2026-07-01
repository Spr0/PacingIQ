// ---------------------------------------------------------------------------
// App-wide state: the current (mock) user role and the in-memory mirror of the
// data store. Every page reads collections and rollups from here and mutates
// through `db`, which writes to the store, appends an audit entry, and
// refreshes React state.
// ---------------------------------------------------------------------------

import { createContext, useContext, useMemo, useState, useCallback } from 'react';
import * as store from '../data/store.js';
import { ROLES } from '../lib/permissions.js';
import { buildAllRollups } from '../lib/intelligence.js';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [roleKey, setRoleKey] = useState('coach');
  const [state, setState] = useState(() => store.loadState());

  const user = ROLES[roleKey];

  const refresh = useCallback(() => {
    setState(store.loadState());
  }, []);

  // Mutation wrappers. Each writes through the store, logs an audit entry, and
  // refreshes. `db.insert/update/remove` take an optional audit action string.
  const db = useMemo(
    () => ({
      insert(collection, record, auditAction) {
        const row = store.insert(collection, record);
        if (auditAction) store.logAudit(user, auditAction, describe(collection, row));
        setState(store.loadState());
        return row;
      },
      update(collection, id, patch, auditAction) {
        const row = store.update(collection, id, patch);
        if (auditAction) store.logAudit(user, auditAction, describe(collection, row));
        setState(store.loadState());
        return row;
      },
      remove(collection, id, auditAction) {
        store.remove(collection, id);
        if (auditAction) store.logAudit(user, auditAction, `${collection} ${id}`);
        setState(store.loadState());
      },
      audit(action, detail) {
        store.logAudit(user, action, detail);
        setState(store.loadState());
      },
    }),
    [user]
  );

  const resetDemo = useCallback(() => {
    store.resetState();
    setState(store.loadState());
  }, []);

  // Mock auth: switching roles stands in for logging in as that persona.
  // Logged so the audit trail's login history claim is actually true.
  const switchRole = useCallback((key) => {
    if (key === roleKey) return;
    const nextUser = ROLES[key];
    store.logAudit(nextUser, 'logged in', `Switched role to ${nextUser.label}`);
    setRoleKey(key);
    setState(store.loadState());
  }, [roleKey]);

  const collections = {
    teachers: state.teachers || [],
    observations: state.observations || [],
    pacingEntries: state.pacingEntries || [],
    assessments: state.assessments || [],
    interventions: state.interventions || [],
    actionPlanTemplates: state.actionPlanTemplates || [],
    actionPlans: state.actionPlans || [],
    auditLog: state.auditLog || [],
  };

  const rollups = useMemo(
    () => buildAllRollups(collections.teachers, collections),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state]
  );

  const rollupFor = useCallback(
    (teacherId) => rollups.find((r) => r.teacher.id === teacherId) || null,
    [rollups]
  );

  const value = {
    user,
    roleKey,
    setRole: switchRole,
    ...collections,
    rollups,
    rollupFor,
    db,
    refresh,
    resetDemo,
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

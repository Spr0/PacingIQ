// ---------------------------------------------------------------------------
// Data access layer for PacingIQ.
//
// This is the ONLY module that touches localStorage. It is intentionally thin
// and collection-oriented so the demo can later be re-platformed onto a real
// backend (Dataverse / MS Copilot / Supabase) by replacing the bodies of these
// functions with API or table calls. Nothing else in the app reads or writes
// storage directly.
// ---------------------------------------------------------------------------

import { SEED } from './seed.js';

const STORAGE_KEY = 'pacingiq_state_v1';

// Collections managed by the store.
const COLLECTIONS = [
  'teachers',
  'observations',
  'pacingEntries',
  'assessments',
  'interventions',
  'actionPlanTemplates',
  'actionPlans',
  'auditLog',
];

function emptyState() {
  return COLLECTIONS.reduce((acc, c) => ({ ...acc, [c]: [] }), {});
}

function read() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function write(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// Load state, seeding demo data on first run.
export function loadState() {
  let state = read();
  if (!state) {
    state = { ...emptyState(), ...SEED };
    write(state);
  }
  // Make sure every known collection exists even if the stored shape is older.
  let changed = false;
  for (const c of COLLECTIONS) {
    if (!Array.isArray(state[c])) {
      state[c] = [];
      changed = true;
    }
  }
  if (changed) write(state);
  return state;
}

export function resetState() {
  const state = { ...emptyState(), ...SEED };
  write(state);
  return state;
}

// Generic collection helpers ------------------------------------------------

export function getAll(collection) {
  const state = loadState();
  return state[collection] || [];
}

export function getById(collection, id) {
  return getAll(collection).find((r) => r.id === id) || null;
}

export function insert(collection, record) {
  const state = loadState();
  const row = { id: record.id || genId(collection), ...record };
  state[collection] = [...(state[collection] || []), row];
  write(state);
  return row;
}

export function update(collection, id, patch) {
  const state = loadState();
  let updated = null;
  state[collection] = (state[collection] || []).map((r) => {
    if (r.id !== id) return r;
    updated = { ...r, ...patch };
    return updated;
  });
  write(state);
  return updated;
}

export function remove(collection, id) {
  const state = loadState();
  state[collection] = (state[collection] || []).filter((r) => r.id !== id);
  write(state);
}

export function genId(prefix = 'rec') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

// Audit log -----------------------------------------------------------------
// Mirrors the spec's audit requirement. In the re-platformed version this would
// be an append-only table; here it is just another collection.

export function logAudit(actor, action, detail = '') {
  return insert('auditLog', {
    timestamp: new Date().toISOString(),
    actor: actor ? `${actor.name} (${actor.label})` : 'system',
    action,
    detail,
  });
}

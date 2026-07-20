// ---------------------------------------------------------------------------
// Data access layer for PacingIQ.
//
// This is the ONLY module that talks to the backend (Supabase/Postgres).
// It keeps the exact same collection-oriented function signatures the app
// always called (insert/update/remove/getAll/getById), so pages and
// components didn't need to change when this moved off localStorage -- see
// supabase/schema.sql for the table definitions and RLS policies this reads
// and writes through.
// ---------------------------------------------------------------------------

import { supabase } from './supabaseClient.js';

// App collection name -> Postgres table name.
const TABLES = {
  teachers: 'teachers',
  observations: 'observations',
  pacingEntries: 'pacing_entries',
  assessments: 'assessments',
  interventions: 'interventions',
  actionPlanTemplates: 'action_plan_templates',
  actionPlans: 'action_plans',
  goals: 'goals',
  auditLog: 'audit_log',
};

const COLLECTIONS = Object.keys(TABLES);

function tableFor(collection) {
  const table = TABLES[collection];
  if (!table) throw new Error(`Unknown collection: ${collection}`);
  return table;
}

// camelCase <-> snake_case, applied generically so every table/column is
// covered without a per-field mapping list.
function toSnakeKey(key) {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}
function toCamelKey(key) {
  return key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}
function rowToCamel(row) {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[toCamelKey(k)] = v;
  return out;
}
function rowsToCamel(rows) {
  return (rows || []).map(rowToCamel);
}
function patchToSnake(patch) {
  const out = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue; // let column defaults / existing values stand
    out[toSnakeKey(k)] = v;
  }
  return out;
}

function check(label, error) {
  if (error) throw new Error(`${label}: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Auth: profile = the signed-in user's row in `profiles` (name + role).
// A user with no profile yet, or role 'pending', has no real access -- see
// AuthContext.jsx, which is what actually gates the app on this.
// ---------------------------------------------------------------------------

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  check('getSession', error);
  return data.session;
}

export function onAuthStateChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
}

export async function signInWithEmail(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin },
  });
  check('signInWithEmail', error);
}

// Temporary no-friction access path: signs in as an anonymous Supabase user
// with no email step at all. Requires "Allow anonymous sign-ins" enabled in
// Supabase (Authentication > Sign In / Providers) and the handle_new_user
// trigger's is_anonymous branch (see supabase/schema.sql) to grant it a
// working role automatically -- otherwise it lands on the same pending
// screen a real sign-in would. To restore real access control later: turn
// the provider back off and stop calling this from AuthContext.
export async function signInAnonymously() {
  const { data, error } = await supabase.auth.signInAnonymously();
  check('signInAnonymously', error);
  return data.session;
}

// Self-heals a stuck-pending anonymous profile instead of waiting on a
// coach to fix it by hand -- covers both a profile created before the
// handle_new_user trigger granted 'coach' automatically, and any other gap
// between them. No-op (and harmless) if the caller isn't anonymous or is
// already past pending; the anon_self_promote RLS policy is what actually
// restricts this to a user's own row.
export async function selfPromoteIfAnonymous() {
  const { data: authData } = await supabase.auth.getUser();
  if (!authData?.user?.is_anonymous) return null;
  const { data, error } = await supabase
    .from('profiles')
    .update({ role: 'coach' })
    .eq('id', authData.user.id)
    .select()
    .maybeSingle();
  check('selfPromoteIfAnonymous', error);
  return rowToCamel(data);
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  check('signOut', error);
}

export async function getMyProfile() {
  // Must filter by id explicitly rather than relying on RLS to narrow this
  // to "just my row": profiles_select_all makes every profile visible once
  // role is approved (coach/principal/ap need to see the roster of who has
  // access), so an unfiltered select("*") returns every row post-approval
  // and .maybeSingle() throws (PGRST116, "Cannot coerce ... to a single
  // object") the moment more than one profile exists.
  const { data: authData, error: authError } = await supabase.auth.getUser();
  check('getMyProfile (getUser)', authError);
  if (!authData?.user) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', authData.user.id)
    .maybeSingle();
  check('getMyProfile', error);
  return rowToCamel(data);
}

// ---------------------------------------------------------------------------
// Generic collection helpers -- same signatures every page already calls.
// ---------------------------------------------------------------------------

export async function getAll(collection) {
  const { data, error } = await supabase.from(tableFor(collection)).select('*');
  check(`getAll(${collection})`, error);
  return rowsToCamel(data);
}

export async function getById(collection, id) {
  const { data, error } = await supabase
    .from(tableFor(collection))
    .select('*')
    .eq('id', id)
    .maybeSingle();
  check(`getById(${collection})`, error);
  return rowToCamel(data);
}

export async function insert(collection, record) {
  // A caller-provided id is passed through as-is (must be a valid uuid --
  // Observations.jsx pre-generates one via crypto.randomUUID() so a file
  // attachment has a stable observationId before the record is saved).
  // Otherwise the column default (gen_random_uuid()) fills it in.
  const { data, error } = await supabase
    .from(tableFor(collection))
    .insert(patchToSnake(record))
    .select()
    .single();
  check(`insert(${collection})`, error);
  return rowToCamel(data);
}

export async function update(collection, id, patch) {
  const { data, error } = await supabase
    .from(tableFor(collection))
    .update(patchToSnake(patch))
    .eq('id', id)
    .select()
    .single();
  check(`update(${collection})`, error);
  return rowToCamel(data);
}

export async function remove(collection, id) {
  const { error } = await supabase.from(tableFor(collection)).delete().eq('id', id);
  check(`remove(${collection})`, error);
}

// Fetches every collection in parallel. Replaces the old synchronous
// "one localStorage blob" read; callers now await this once on load and
// after any mutation that needs a full refresh (most mutations instead
// patch local React state directly from the returned row -- see
// AppContext.jsx).
export async function loadAll() {
  const entries = await Promise.all(COLLECTIONS.map(async (c) => [c, await getAll(c)]));
  return Object.fromEntries(entries);
}

// ---------------------------------------------------------------------------
// Audit log -- append-only from the app's perspective.
// ---------------------------------------------------------------------------

export async function logAudit(actor, action, detail = '') {
  return insert('auditLog', {
    timestamp: new Date().toISOString(),
    actor: actor ? `${actor.name} (${actor.label})` : 'system',
    action,
    detail,
  });
}

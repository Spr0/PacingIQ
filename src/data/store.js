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
  scheduleEntries: 'schedule_entries',
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
    // An empty string from a blank optional form field (a follow-up date, an
    // unfilled numeric score, an unselected template id) is invalid input for
    // any non-text column -- e.g. Postgres rejects "" for a date column
    // outright. Every optional field in the UI already renders '' and null
    // the same way, so normalizing to null here is lossless and lets Postgres
    // store an actual absence instead of erroring.
    out[toSnakeKey(k)] = v === '' ? null : v;
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

// The signed-in user's auth id, used to stamp ownership on records so
// "edit only your own" can be enforced in RLS rather than just in the UI.
export async function getMyUserId() {
  const { data, error } = await supabase.auth.getUser();
  check('getMyUserId', error);
  return data?.user?.id || null;
}

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  check('getSession', error);
  return data.session;
}

export function onAuthStateChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
}

// Email + password is the only sign-in path. Chosen over magic links
// because district email filtering blocked link delivery entirely (and
// Supabase's built-in mailer only reliably reaches project team members),
// so nothing in the login flow depends on an email arriving. Accounts are
// provisioned by hand in the Supabase dashboard (Authentication > Users >
// Add user > Create new user, with Auto Confirm checked) and given a role
// via the migration SQL in supabase/schema.sql -- there is deliberately no
// self-signup and no in-app way to grant yourself a role.
export async function signInWithPassword(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Supabase returns the same "Invalid login credentials" whether the
    // password is wrong or no such account exists -- keep that ambiguity
    // (it stops the form being used to discover who has an account) but
    // phrase it for a person, without the internal function label check()
    // would prefix, and with the one instruction that actually helps here.
    if (/invalid login credentials/i.test(error.message)) {
      throw new Error('That email and password do not match. Contact your instructional coach if you need access.');
    }
    if (/email not confirmed/i.test(error.message)) {
      throw new Error('This account has not been confirmed yet. Ask your instructional coach to confirm it.');
    }
    throw new Error(error.message);
  }
  return data.session;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  check('signOut', error);
}

// Sets a new password for the already-signed-in user and clears the
// must_change_password flag. No email round-trip is involved, which is the
// whole point -- district mail filtering makes Supabase's own reset flow
// unusable here (see SetPassword.jsx).
//
// The flag is cleared through an RPC rather than a direct profiles update:
// an RLS policy permissive enough to let someone patch their own profile row
// would also let them edit their own `role`. See migrations/003.
export async function updateMyPassword(password) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    // Supabase enforces the project's password policy here (length,
    // character classes, and a breached-password check if enabled), so its
    // message is the useful one to show.
    throw new Error(error.message);
  }
  const { error: rpcError } = await supabase.rpc('mark_password_changed');
  check('mark_password_changed', rpcError);
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

// Wholesale-replaces the observation-rotation schedule: clears every
// existing schedule_entries row, then inserts the freshly generated set in
// one request. Used by the randomizer (see src/pages/Schedule.jsx) instead
// of the generic insert() above, which would mean one request per row for a
// roster that can be dozens of teachers.
export async function replaceSchedule(entries) {
  const { error: delError } = await supabase.from('schedule_entries').delete().not('id', 'is', null);
  check('replaceSchedule (clear)', delError);
  if (!entries.length) return [];
  const { data, error } = await supabase
    .from('schedule_entries')
    .insert(entries.map(patchToSnake))
    .select();
  check('replaceSchedule (insert)', error);
  return rowsToCamel(data);
}

// Fetches every collection in parallel. Replaces the old synchronous
// "one localStorage blob" read; callers now await this once on load and
// after any mutation that needs a full refresh (most mutations instead
// patch local React state directly from the returned row -- see
// AppContext.jsx). A single collection failing (e.g. a table a schema
// migration hasn't been applied for yet) falls back to an empty list
// instead of rejecting the whole call -- otherwise one missing table would
// blank every page, not just the one that needed it.
export async function loadAll() {
  const entries = await Promise.all(
    COLLECTIONS.map(async (c) => {
      try {
        return [c, await getAll(c)];
      } catch (err) {
        console.warn(`loadAll: ${c} failed, showing empty until this is fixed`, err);
        return [c, []];
      }
    })
  );
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

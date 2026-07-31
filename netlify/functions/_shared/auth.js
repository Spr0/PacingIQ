// ---------------------------------------------------------------------------
// Supabase session verification for Netlify Functions.
//
// Every function in this directory is on a public URL. RLS protects the
// database, but it never sees a Netlify Function call -- so until this existed,
// `DELETE /.netlify/functions/delete-attachment?key=...` from anywhere on the
// internet destroyed observation evidence, and the three AI endpoints were an
// unmetered proxy onto ANTHROPIC_API_KEY.
//
// The browser sends its Supabase access token as `Authorization: Bearer <jwt>`.
// We verify it by asking Supabase's auth API who it belongs to, rather than by
// checking a signature locally: no JWT secret to hold, and a revoked or
// rotated session stops working immediately.
//
// Role comes from `profiles`, read with the *caller's own* token so RLS
// applies to that read too (profiles_select_own in schema.sql). Nothing here
// ever uses a service-role key -- a leak of one of these functions must not be
// a leak of the whole database.
//
// Config: SUPABASE_URL / SUPABASE_ANON_KEY, falling back to the VITE_-prefixed
// pair the site already sets for the browser build. Those are scoped to all
// contexts including Functions, so no new environment variables are needed --
// one less console step that can report success without saving. The VITE_
// prefix only means "Vite inlines this into the client bundle"; it says nothing
// about secrecy, and the anon key is public by design either way.
//
// Missing config fails closed with a 500, never open.
// ---------------------------------------------------------------------------

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

const REAL_ROLES = ['coach', 'principal', 'ap', 'abss'];

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(obj),
  };
}

// Netlify lowercases incoming header names, but the dev server and direct
// invocations don't always, so check both.
function bearerToken(event) {
  const headers = event.headers || {};
  const raw = headers.authorization || headers.Authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(String(raw).trim());
  return match ? match[1].trim() : null;
}

// Resolves the caller to { token, user, role }, or returns { error } holding a
// ready-to-return Netlify response. Callers must check `error` first.
async function authenticate(event) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return {
      error: json(500, {
        error: 'Server auth is not configured',
        detail: 'SUPABASE_URL and SUPABASE_ANON_KEY must be set in the Netlify site environment.',
      }),
    };
  }

  const token = bearerToken(event);
  if (!token) return { error: json(401, { error: 'Sign in required' }) };

  let user;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { error: json(401, { error: 'Your session is no longer valid. Sign in again.' }) };
    user = await res.json();
  } catch (err) {
    return { error: json(502, { error: 'Could not verify your session', detail: err.message }) };
  }
  if (!user || !user.id) {
    return { error: json(401, { error: 'Your session is no longer valid. Sign in again.' }) };
  }

  let role = 'pending';
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } }
    );
    if (res.ok) {
      const rows = await res.json();
      if (Array.isArray(rows) && rows[0] && rows[0].role) role = rows[0].role;
    }
  } catch {
    // Fall through as 'pending'. A profile lookup that fails must not be a way
    // to skip the role check.
  }

  if (!REAL_ROLES.includes(role)) {
    return { error: json(403, { error: 'Your account is still waiting on access.' }) };
  }

  return { token, user, role };
}

// True when the caller is allowed to see the observation the attachment hangs
// off. Asked of PostgREST with the caller's token, so the answer is whatever
// RLS says -- there is no second copy of the policy to drift out of sync.
// Returns null when no such row exists (a draft observation that was never
// saved), which callers treat differently from "denied".
async function loadObservation(token, observationId) {
  if (!observationId) return null;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/observations?id=eq.${encodeURIComponent(observationId)}&select=id,created_by_id`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

module.exports = { authenticate, loadObservation, json, REAL_ROLES };

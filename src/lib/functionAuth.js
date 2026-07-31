// ---------------------------------------------------------------------------
// Auth header for calls to our Netlify Functions.
//
// The functions verify the caller's Supabase session (see
// netlify/functions/_shared/auth.js), so every fetch to /.netlify/functions/*
// has to carry the access token. getSession() returns the cached session and
// refreshes it first if it has expired, so this is safe to call per request.
//
// Throwing when there's no session is deliberate: a call made without one is
// going to come back 401 anyway, and this way the message the coach sees names
// the real problem instead of "not deployed here".
// ---------------------------------------------------------------------------

import { supabase } from '../data/supabaseClient.js';

export async function authHeaders(extra = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) {
    const err = new Error('Your session has expired. Sign in again to continue.');
    err.reachable = true; // a config/session problem, not an offline function
    throw err;
  }
  return { ...extra, Authorization: `Bearer ${token}` };
}

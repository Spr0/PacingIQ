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

// Shown when the page is running JavaScript from before the last deploy.
export const STALE_BUNDLE_MESSAGE =
  'PacingIQ was updated while this page was open. Reload to continue — anything drafted on screen will be lost.';

// A 401 from a function while the browser still holds a valid session is not an
// auth problem: it means this tab loaded before the deploy that added the check
// the function is now applying, so the request went out without the header the
// new function expects. Reloading is the whole fix.
//
// This happened for real on 2026-07-31: the auth deploy landed while a coach had
// the app open, and every AI action answered "Sign in required" -- which reads
// as "your login is broken" and sent her looking in the wrong place. It cannot
// help the deploy that introduces it (the old bundle has no such check by
// definition), but it makes every deploy after this one explain itself.
//
// Returns an Error to throw, or null when the 401 is a genuine signed-out state.
export async function staleBundleError(res) {
  if (!res || res.status !== 401) return null;
  const { data } = await supabase.auth.getSession();
  if (!data?.session?.access_token) return null; // really signed out
  const err = new Error(STALE_BUNDLE_MESSAGE);
  err.reachable = true;
  err.staleBundle = true;
  return err;
}

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

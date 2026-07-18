// ---------------------------------------------------------------------------
// Supabase client. Reads the project URL and anon (public) key from env vars
// set in .env.local for dev and in Netlify site settings for production.
// The anon key is safe to ship to the browser -- it's meaningless without the
// Row Level Security policies in supabase/schema.sql, which are what actually
// gate access.
// ---------------------------------------------------------------------------

import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Set them in .env.local (dev) or ' +
      'the Netlify site environment variables (production).'
  );
}

export const supabase = createClient(url, anonKey);

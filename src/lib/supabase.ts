// @ts-nocheck
// Supabase client singleton. Reads config from Vite env vars.
// .env.local must contain:
//   VITE_SUPABASE_URL=https://<your-project>.supabase.co
//   VITE_SUPABASE_ANON_KEY=<anon or publishable key>

import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  // Hard fail in dev so misconfigured env vars are obvious.
  throw new Error(
    "Missing Supabase env vars. Create .env.local in the project root with " +
    "VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then restart the dev server."
  );
}

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true, // handles magic-link callback on page load
  },
});

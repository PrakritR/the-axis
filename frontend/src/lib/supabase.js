/**
 * Supabase client — single shared instance for the frontend app.
 *
 * Import this wherever you need Supabase (auth, DB, storage):
 *   import { supabase } from '../lib/supabase'
 *
 * Required environment variables (Vite exposes VITE_* to the browser):
 *   VITE_SUPABASE_URL      — e.g. https://xyzcompany.supabase.co
 *   VITE_SUPABASE_ANON_KEY — the public anon/service key from your Supabase project settings
 */

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    '[supabase] Missing required environment variables.\n' +
    '  VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must both be set.\n' +
    '  Add them to your .env file (or Vercel / hosting environment settings).',
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseReady = Boolean(
  SUPABASE_URL && SUPABASE_URL !== 'your_supabase_project_url' &&
  SUPABASE_ANON_KEY && SUPABASE_ANON_KEY !== 'your_supabase_anon_key'
)

export const supabase = supabaseReady
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null

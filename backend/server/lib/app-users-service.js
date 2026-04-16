/**
 * app_users — Postgres table in the Supabase project (public schema), keyed by auth.users.id.
 *
 * Requires server env:
 *   SUPABASE_URL (or VITE_SUPABASE_URL fallback)
 *   SUPABASE_SERVICE_ROLE_KEY — never expose to the browser; bypasses RLS for trusted writes.
 *
 * @module
 */

import { createClient } from '@supabase/supabase-js'

let _serviceClient = null

function resolveSupabaseUrl() {
  return String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
}

function resolveServiceRoleKey() {
  return String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
}

/** @returns {import('@supabase/supabase-js').SupabaseClient | null} */
export function getSupabaseServiceClient() {
  const url = resolveSupabaseUrl()
  const key = resolveServiceRoleKey()
  if (!url || !key) return null
  if (!_serviceClient) {
    _serviceClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return _serviceClient
}

export function requireServiceClient() {
  const c = getSupabaseServiceClient()
  if (!c) {
    throw new Error(
      'Supabase service client not configured. Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY on the server.',
    )
  }
  return c
}

/**
 * @param {string} authUserId - auth.users.id
 * @returns {Promise<object | null>} app_users row or null
 */
export async function getAppUserByAuthUserId(authUserId) {
  const id = String(authUserId || '').trim()
  if (!id) return null
  const client = requireServiceClient()
  const { data, error } = await client.from('app_users').select('*').eq('auth_user_id', id).maybeSingle()
  if (error) throw new Error(error.message || 'Failed to load app_users')
  return data || null
}

/**
 * Insert or update the profile row for a Supabase Auth user (by auth_user_id).
 * Does not disable is_active unless explicitly passed false.
 *
 * @param {{ authUserId: string, email: string, fullName?: string | null, phone?: string | null, isActive?: boolean }} row
 * @returns {Promise<object>} persisted row
 */
export async function ensureAppUserByAuthId(row) {
  const authUserId = String(row.authUserId || '').trim()
  const email = String(row.email || '').trim().toLowerCase()
  if (!authUserId || !email) {
    throw new Error('ensureAppUserByAuthId: authUserId and email are required.')
  }

  const payload = {
    auth_user_id: authUserId,
    email,
    full_name: row.fullName != null && String(row.fullName).trim() ? String(row.fullName).trim() : null,
    phone: row.phone != null && String(row.phone).trim() ? String(row.phone).trim() : null,
    is_active: row.isActive === false ? false : true,
  }

  const client = requireServiceClient()
  const { data, error } = await client
    .from('app_users')
    .upsert(payload, { onConflict: 'auth_user_id' })
    .select('*')
    .single()

  if (error) throw new Error(error.message || 'Failed to upsert app_users')
  return data
}

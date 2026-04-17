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
 * @param {string} email - matches app_users.email (stored lowercase)
 * @returns {Promise<object | null>}
 */
export async function getAppUserByEmail(email) {
  const em = String(email || '').trim().toLowerCase()
  if (!em) return null
  const client = requireServiceClient()
  const { data, error } = await client.from('app_users').select('*').eq('email', em).maybeSingle()
  if (error) throw new Error(error.message || 'Failed to load app_users')
  return data || null
}

/**
 * @param {string} id - public.app_users.id
 * @returns {Promise<object | null>}
 */
export async function getAppUserById(id) {
  const uid = String(id || '').trim()
  if (!uid) return null
  const client = requireServiceClient()
  const { data, error } = await client.from('app_users').select('*').eq('id', uid).maybeSingle()
  if (error) throw new Error(error.message || 'Failed to load app_users')
  return data || null
}

const MAX_APP_USER_FULL_NAME = 500
const MAX_APP_USER_PHONE = 40

/**
 * Partial update for public.app_users (service role). Used by resident profile PATCH.
 *
 * @param {string} appUserId
 * @param {{ full_name?: string | null, phone?: string | null }} updates
 * @returns {Promise<object>} updated row
 */
export async function updateAppUserContactFields(appUserId, updates) {
  const id = String(appUserId || '').trim()
  if (!id) throw new Error('updateAppUserContactFields: appUserId is required.')

  const patch = {}
  if (updates.full_name !== undefined) {
    if (updates.full_name === null) {
      patch.full_name = null
    } else if (typeof updates.full_name !== 'string') {
      throw new Error('full_name must be a string or null.')
    } else {
      const s = updates.full_name.trim()
      if (s.length > MAX_APP_USER_FULL_NAME) {
        throw new Error(`full_name exceeds max length (${MAX_APP_USER_FULL_NAME}).`)
      }
      patch.full_name = s.length ? s : null
    }
  }
  if (updates.phone !== undefined) {
    if (updates.phone === null) {
      patch.phone = null
    } else if (typeof updates.phone !== 'string') {
      throw new Error('phone must be a string or null.')
    } else {
      const s = updates.phone.trim()
      if (s.length > MAX_APP_USER_PHONE) {
        throw new Error(`phone exceeds max length (${MAX_APP_USER_PHONE}).`)
      }
      patch.phone = s.length ? s : null
    }
  }

  if (Object.keys(patch).length === 0) {
    const existing = await getAppUserById(id)
    if (!existing) throw new Error('App user not found.')
    return existing
  }

  const client = requireServiceClient()
  const { data, error } = await client.from('app_users').update(patch).eq('id', id).select('*').single()
  if (error) throw new Error(error.message || 'Failed to update app_users')
  return data
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

/**
 * Active app users who have the admin role (for public meeting directory).
 *
 * @returns {Promise<{ id: string, email: string, full_name: string | null, admin_notes: string | null }[]>}
 */
export async function listActiveAdminsForMeetingDirectory() {
  const client = requireServiceClient()
  const { data: roleRows, error: re } = await client.from('app_user_roles').select('app_user_id').eq('role', 'admin')
  if (re) throw new Error(re.message || 'Failed to list admin roles')
  const ids = [...new Set((roleRows || []).map((r) => String(r.app_user_id || '').trim()).filter(Boolean))]
  if (!ids.length) return []

  const { data: users, error: ue } = await client
    .from('app_users')
    .select('id, email, full_name, is_active, admin_profiles(notes)')
    .in('id', ids)
    .eq('is_active', true)
    .order('email', { ascending: true })
  if (ue) throw new Error(ue.message || 'Failed to list admin app users')

  return (users || []).map((u) => {
    const profiles = u.admin_profiles
    const ap = Array.isArray(profiles) ? profiles[0] : profiles
    return {
      id: String(u.id),
      email: String(u.email || '').trim().toLowerCase(),
      full_name: u.full_name != null ? String(u.full_name).trim() : null,
      admin_notes: ap?.notes != null ? String(ap.notes) : null,
    }
  })
}

/**
 * Resolve the Supabase Auth user from an HTTP request's Bearer JWT (anon client + getUser).
 * Used by API handlers that trust the JWT but perform authorization in application code.
 *
 * @module
 */

import { createClient } from '@supabase/supabase-js'

export function bearerTokenFromRequest(req) {
  const h = req.headers?.authorization || req.headers?.Authorization
  const raw = Array.isArray(h) ? h[0] : String(h || '')
  const m = raw.match(/^Bearer\s+(.+)$/i)
  return m ? m[1].trim() : ''
}

function resolveSupabaseUrl() {
  return String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
}

function resolveSupabaseAnonKey() {
  return String(process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim()
}

/**
 * @param {{ headers?: Record<string, string | string[] | undefined> }} req
 * @returns {Promise<
 *   | { ok: true; user: import('@supabase/supabase-js').User }
 *   | { ok: false; status: number; error: string }
 * >}
 */
export async function authenticateSupabaseBearerRequest(req) {
  const token = bearerTokenFromRequest(req)
  if (!token) {
    return { ok: false, status: 401, error: 'Missing Authorization Bearer token.' }
  }

  const url = resolveSupabaseUrl()
  const anonKey = resolveSupabaseAnonKey()
  if (!url || !anonKey) {
    return { ok: false, status: 503, error: 'Supabase URL/anon key is not configured on the server.' }
  }

  const sb = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: userData, error: userErr } = await sb.auth.getUser(token)
  if (userErr || !userData?.user) {
    return { ok: false, status: 401, error: userErr?.message || 'Invalid or expired session.' }
  }

  return { ok: true, user: userData.user }
}

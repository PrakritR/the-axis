/**
 * POST /api/sync-app-user
 * Validates the caller's Supabase JWT, ensures public.app_users exists, returns app_user_roles.
 *
 * Headers: Authorization: Bearer <supabase access_token>
 */
import { createClient } from '@supabase/supabase-js'
import { ensureAppUserByAuthId } from '../lib/app-users-service.js'
import { getRolesForAppUserId } from '../lib/app-user-roles-service.js'

function bearerToken(req) {
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const token = bearerToken(req)
  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization Bearer token.' })
  }

  const url = resolveSupabaseUrl()
  const anonKey = resolveSupabaseAnonKey()
  if (!url || !anonKey) {
    return res.status(503).json({ error: 'Supabase URL/anon key is not configured on the server.' })
  }

  const sb = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: userData, error: userErr } = await sb.auth.getUser(token)
  if (userErr || !userData?.user) {
    return res.status(401).json({ error: userErr?.message || 'Invalid or expired session.' })
  }

  const user = userData.user
  const email = String(user.email || '').trim().toLowerCase()
  if (!email) {
    return res.status(400).json({ error: 'Authenticated user has no email.' })
  }

  const meta = user.user_metadata || {}
  const fullName =
    (typeof meta.full_name === 'string' && meta.full_name.trim()) ||
    (typeof meta.name === 'string' && meta.name.trim()) ||
    null

  try {
    const appUser = await ensureAppUserByAuthId({
      authUserId: user.id,
      email,
      fullName,
    })
    const roles = await getRolesForAppUserId(appUser.id)
    return res.status(200).json({
      ok: true,
      authUserId: user.id,
      appUser,
      roles,
    })
  } catch (err) {
    console.error('[sync-app-user]', err)
    return res.status(500).json({ error: err?.message || 'Could not sync app user.' })
  }
}

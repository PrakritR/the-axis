/**
 * POST /api/sync-app-user
 * Validates the caller's Supabase JWT, ensures public.app_users exists, returns app_user_roles.
 *
 * Headers: Authorization: Bearer <supabase access_token>
 */
import { authenticateSupabaseBearerRequest } from '../lib/supabase-bearer-auth.js'
import { ensureAppUserByAuthId } from '../lib/app-users-service.js'
import { getRolesForAppUserId } from '../lib/app-user-roles-service.js'

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

  const auth = await authenticateSupabaseBearerRequest(req)
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error })
  }

  const user = auth.user
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

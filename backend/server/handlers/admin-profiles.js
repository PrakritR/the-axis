/**
 * Internal admin_profiles (Postgres), authenticated by Supabase JWT.
 *
 * - GET  /api/admin-profiles — own profile row or null (403 if not admin)
 * - POST /api/admin-profiles — ensure row exists (optional body: { notes })
 * - PATCH /api/admin-profiles — set notes (body: { notes: string | null })
 *
 * Headers: Authorization: Bearer <supabase access_token>
 * Caller must have synced app_users (e.g. POST /api/sync-app-user) and hold the admin role.
 */
import { authenticateSupabaseBearerRequest } from '../lib/supabase-bearer-auth.js'
import { getAppUserByAuthUserId } from '../lib/app-users-service.js'
import { appUserHasRole } from '../lib/app-user-roles-service.js'
import {
  getAdminProfileByAppUserId,
  ensureAdminProfileExists,
  setAdminProfileNotes,
  MAX_ADMIN_PROFILE_NOTES_LENGTH,
} from '../lib/admin-profiles-service.js'

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

export default async function handler(req, res) {
  cors(res)
  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  const auth = await authenticateSupabaseBearerRequest(req)
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error })
  }

  const appUser = await getAppUserByAuthUserId(auth.user.id)
  if (!appUser?.id) {
    return res.status(409).json({
      error: 'No internal app user yet. Call POST /api/sync-app-user with this session first.',
    })
  }

  const isAdmin = await appUserHasRole(appUser.id, 'admin')
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin role required for admin_profiles.' })
  }

  try {
    if (req.method === 'GET') {
      const profile = await getAdminProfileByAppUserId(appUser.id)
      return res.status(200).json({ ok: true, profile: profile || null })
    }

    if (req.method === 'POST') {
      const body = req.body && typeof req.body === 'object' ? req.body : {}
      let notes
      if ('notes' in body) {
        if (body.notes !== null && typeof body.notes !== 'string') {
          return res.status(400).json({ error: 'notes must be a string or null when provided.' })
        }
        notes = body.notes
      }
      const profile = await ensureAdminProfileExists({ appUserId: appUser.id, notes })
      return res.status(200).json({ ok: true, profile })
    }

    if (req.method === 'PATCH') {
      const body = req.body && typeof req.body === 'object' ? req.body : {}
      if (!('notes' in body)) {
        return res.status(400).json({
          error: `Request body must include "notes" (string or null). Max length ${MAX_ADMIN_PROFILE_NOTES_LENGTH}.`,
        })
      }
      if (body.notes !== null && typeof body.notes !== 'string') {
        return res.status(400).json({ error: 'notes must be a string or null.' })
      }
      const profile = await setAdminProfileNotes({ appUserId: appUser.id, notes: body.notes })
      return res.status(200).json({ ok: true, profile })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    console.error('[admin-profiles]', err)
    const msg = err?.message || 'admin_profiles request failed.'
    if (msg.includes('does not have the admin role')) {
      return res.status(403).json({ error: msg })
    }
    return res.status(500).json({ error: msg })
  }
}

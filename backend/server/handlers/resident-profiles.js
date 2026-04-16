/**
 * resident_profiles (Postgres), authenticated by Supabase JWT.
 *
 * - GET  /api/resident-profiles — own profile or null (403 if not resident/admin)
 * - POST /api/resident-profiles — ensure row (resident only); optional body fields
 * - PATCH /api/resident-profiles — partial update (resident only)
 *
 * Headers: Authorization: Bearer <supabase access_token>
 * Prereq: POST /api/sync-app-user so app_users row exists.
 */
import { authenticateSupabaseBearerRequest } from '../lib/supabase-bearer-auth.js'
import { getAppUserByAuthUserId } from '../lib/app-users-service.js'
import { appUserHasRole } from '../lib/app-user-roles-service.js'
import {
  getResidentProfileByAppUserId,
  ensureResidentProfileExists,
  updateResidentProfile,
  MAX_RESIDENT_PROFILE_PHONE_LENGTH,
  MAX_RESIDENT_PROFILE_EMERGENCY_CONTACT_NAME_LENGTH,
  MAX_RESIDENT_PROFILE_EMERGENCY_CONTACT_PHONE_LENGTH,
  MAX_RESIDENT_PROFILE_NOTES_LENGTH,
} from '../lib/resident-profiles-service.js'

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

function optionalStringOrNull(body, key) {
  if (!(key in body)) return undefined
  const v = body[key]
  if (v === null) return null
  if (typeof v !== 'string') {
    return { error: `${key} must be a string or null when provided.` }
  }
  return v
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

  try {
    if (req.method === 'GET') {
      const [isResident, isAdmin] = await Promise.all([
        appUserHasRole(appUser.id, 'resident'),
        appUserHasRole(appUser.id, 'admin'),
      ])
      if (!isResident && !isAdmin) {
        return res.status(403).json({ error: 'Resident or admin role required to read resident_profiles.' })
      }
      const profile = await getResidentProfileByAppUserId(appUser.id)
      return res.status(200).json({ ok: true, profile: profile || null })
    }

    if (req.method === 'POST') {
      const isResident = await appUserHasRole(appUser.id, 'resident')
      if (!isResident) {
        return res.status(403).json({ error: 'Resident role required to create resident_profiles.' })
      }

      const body = req.body && typeof req.body === 'object' ? req.body : {}
      const fields = {}
      for (const key of ['phone_number', 'emergency_contact_name', 'emergency_contact_phone', 'notes']) {
        const parsed = optionalStringOrNull(body, key)
        if (parsed && typeof parsed === 'object' && 'error' in parsed) {
          return res.status(400).json({ error: parsed.error })
        }
        if (parsed !== undefined) fields[key] = parsed
      }

      const profile = await ensureResidentProfileExists({ appUserId: appUser.id, ...fields })
      return res.status(200).json({ ok: true, profile })
    }

    if (req.method === 'PATCH') {
      const isResident = await appUserHasRole(appUser.id, 'resident')
      if (!isResident) {
        return res.status(403).json({ error: 'Resident role required to update resident_profiles.' })
      }

      const body = req.body && typeof req.body === 'object' ? req.body : {}
      const patch = {}
      for (const key of ['phone_number', 'emergency_contact_name', 'emergency_contact_phone', 'notes']) {
        const parsed = optionalStringOrNull(body, key)
        if (parsed && typeof parsed === 'object' && 'error' in parsed) {
          return res.status(400).json({ error: parsed.error })
        }
        if (parsed !== undefined) patch[key] = parsed
      }

      if (Object.keys(patch).length === 0) {
        return res.status(400).json({
          error: `Provide at least one of: phone_number, emergency_contact_name, emergency_contact_phone, notes. Max lengths: phone ${MAX_RESIDENT_PROFILE_PHONE_LENGTH}, emergency_contact_name ${MAX_RESIDENT_PROFILE_EMERGENCY_CONTACT_NAME_LENGTH}, emergency_contact_phone ${MAX_RESIDENT_PROFILE_EMERGENCY_CONTACT_PHONE_LENGTH}, notes ${MAX_RESIDENT_PROFILE_NOTES_LENGTH}.`,
        })
      }

      const profile = await updateResidentProfile({ appUserId: appUser.id, ...patch })
      return res.status(200).json({ ok: true, profile })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    console.error('[resident-profiles]', err)
    const msg = err?.message || 'resident_profiles request failed.'
    if (msg.includes('does not have the resident role')) {
      return res.status(403).json({ error: msg })
    }
    return res.status(500).json({ error: msg })
  }
}

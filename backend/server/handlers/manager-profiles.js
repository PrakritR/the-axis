/**
 * Internal manager_profiles (Postgres), authenticated by Supabase JWT.
 *
 * - GET  /api/manager-profiles — own profile or null (403 if neither manager nor admin)
 * - POST /api/manager-profiles — ensure row (manager only); optional body fields
 * - PATCH /api/manager-profiles — partial update (manager only)
 *
 * Headers: Authorization: Bearer <supabase access_token>
 * Prereq: POST /api/sync-app-user so app_users exists.
 */
import { authenticateSupabaseBearerRequest } from '../lib/supabase-bearer-auth.js'
import { getAppUserByAuthUserId } from '../lib/app-users-service.js'
import { appUserHasRole } from '../lib/app-user-roles-service.js'
import {
  getManagerProfileByAppUserId,
  ensureManagerProfileExists,
  updateManagerProfile,
  MAX_MANAGER_PROFILE_COMPANY_LENGTH,
  MAX_MANAGER_PROFILE_PHONE_LENGTH,
  MAX_MANAGER_PROFILE_NOTES_LENGTH,
  MANAGER_TIER_VALUES,
} from '../lib/manager-profiles-service.js'

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

async function userIsManagerOrAdmin(appUserId) {
  const [isManager, isAdmin] = await Promise.all([
    appUserHasRole(appUserId, 'manager'),
    appUserHasRole(appUserId, 'admin'),
  ])
  return isManager || isAdmin
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
      const allowed = await userIsManagerOrAdmin(appUser.id)
      if (!allowed) {
        return res.status(403).json({ error: 'Manager or admin role required to read manager_profiles.' })
      }
      const profile = await getManagerProfileByAppUserId(appUser.id)
      return res.status(200).json({ ok: true, profile: profile || null })
    }

    if (req.method === 'POST') {
      const isManager = await appUserHasRole(appUser.id, 'manager')
      if (!isManager) {
        return res.status(403).json({ error: 'Manager role required to create manager_profiles.' })
      }

      const body = req.body && typeof req.body === 'object' ? req.body : {}
      const fields = {}
      for (const key of ['company', 'tier', 'phone_number', 'notes']) {
        const parsed = optionalStringOrNull(body, key)
        if (parsed && typeof parsed === 'object' && 'error' in parsed) {
          return res.status(400).json({ error: parsed.error })
        }
        if (parsed !== undefined) fields[key] = parsed
      }

      const profile = await ensureManagerProfileExists({ appUserId: appUser.id, ...fields })
      return res.status(200).json({ ok: true, profile })
    }

    if (req.method === 'PATCH') {
      const isManager = await appUserHasRole(appUser.id, 'manager')
      if (!isManager) {
        return res.status(403).json({ error: 'Manager role required to update manager_profiles.' })
      }

      const body = req.body && typeof req.body === 'object' ? req.body : {}
      const patch = {}
      for (const key of ['company', 'tier', 'phone_number', 'notes']) {
        const parsed = optionalStringOrNull(body, key)
        if (parsed && typeof parsed === 'object' && 'error' in parsed) {
          return res.status(400).json({ error: parsed.error })
        }
        if (parsed !== undefined) patch[key] = parsed
      }

      if (Object.keys(patch).length === 0) {
        return res.status(400).json({
          error: `Provide at least one of: company, tier, phone_number, notes. tier: ${MANAGER_TIER_VALUES.join(' | ')}. Max lengths: company ${MAX_MANAGER_PROFILE_COMPANY_LENGTH}, phone ${MAX_MANAGER_PROFILE_PHONE_LENGTH}, notes ${MAX_MANAGER_PROFILE_NOTES_LENGTH}.`,
        })
      }

      const profile = await updateManagerProfile({ appUserId: appUser.id, ...patch })
      return res.status(200).json({ ok: true, profile })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    console.error('[manager-profiles]', err)
    const msg = err?.message || 'manager_profiles request failed.'
    if (msg.includes('does not have the manager role')) {
      return res.status(403).json({ error: msg })
    }
    if (msg.includes('normalizeManagerTier')) {
      return res.status(400).json({ error: msg })
    }
    return res.status(500).json({ error: msg })
  }
}

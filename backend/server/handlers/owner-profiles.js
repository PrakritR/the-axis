/**
 * Internal owner_profiles (Postgres), authenticated by Supabase JWT.
 *
 * - GET  /api/owner-profiles — own profile or null (403 if neither owner nor admin)
 * - POST /api/owner-profiles — ensure row (owner only); optional body fields
 * - PATCH /api/owner-profiles — partial update (owner only)
 *
 * Headers: Authorization: Bearer <supabase access_token>
 * Prereq: POST /api/sync-app-user so app_users exists.
 */
import { authenticateSupabaseBearerRequest } from '../lib/supabase-bearer-auth.js'
import { getAppUserByAuthUserId } from '../lib/app-users-service.js'
import { appUserHasRole } from '../lib/app-user-roles-service.js'
import {
  getOwnerProfileByAppUserId,
  ensureOwnerProfileExists,
  updateOwnerProfile,
  MAX_OWNER_PROFILE_PHONE_LENGTH,
  MAX_OWNER_PROFILE_NOTES_LENGTH,
  MAX_OWNER_PROFILE_STRIPE_CONNECT_ACCOUNT_ID_LENGTH,
} from '../lib/owner-profiles-service.js'

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

async function userIsOwnerOrAdmin(appUserId) {
  const [isOwner, isAdmin] = await Promise.all([
    appUserHasRole(appUserId, 'owner'),
    appUserHasRole(appUserId, 'admin'),
  ])
  return isOwner || isAdmin
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

function optionalBoolean(body, key) {
  if (!(key in body)) return undefined
  const v = body[key]
  if (typeof v !== 'boolean') {
    return { error: `${key} must be a boolean when provided.` }
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
      const allowed = await userIsOwnerOrAdmin(appUser.id)
      if (!allowed) {
        return res.status(403).json({ error: 'Owner or admin role required to read owner_profiles.' })
      }
      const profile = await getOwnerProfileByAppUserId(appUser.id)
      return res.status(200).json({ ok: true, profile: profile || null })
    }

    if (req.method === 'POST') {
      const isOwner = await appUserHasRole(appUser.id, 'owner')
      if (!isOwner) {
        return res.status(403).json({ error: 'Owner role required to create owner_profiles.' })
      }

      const body = req.body && typeof req.body === 'object' ? req.body : {}
      const textKeys = ['phone_number', 'notes', 'stripe_connect_account_id']
      const fields = {}
      for (const key of textKeys) {
        const parsed = optionalStringOrNull(body, key)
        if (parsed && typeof parsed === 'object' && 'error' in parsed) {
          return res.status(400).json({ error: parsed.error })
        }
        if (parsed !== undefined) fields[key] = parsed
      }

      const profile = await ensureOwnerProfileExists({ appUserId: appUser.id, ...fields })
      return res.status(200).json({ ok: true, profile })
    }

    if (req.method === 'PATCH') {
      const isOwner = await appUserHasRole(appUser.id, 'owner')
      if (!isOwner) {
        return res.status(403).json({ error: 'Owner role required to update owner_profiles.' })
      }

      const body = req.body && typeof req.body === 'object' ? req.body : {}
      const patch = {}
      for (const key of ['phone_number', 'notes', 'stripe_connect_account_id']) {
        const parsed = optionalStringOrNull(body, key)
        if (parsed && typeof parsed === 'object' && 'error' in parsed) {
          return res.status(400).json({ error: parsed.error })
        }
        if (parsed !== undefined) patch[key] = parsed
      }
      for (const key of [
        'stripe_onboarding_complete',
        'stripe_payouts_enabled',
        'stripe_charges_enabled',
        'stripe_details_submitted',
      ]) {
        const parsed = optionalBoolean(body, key)
        if (parsed && typeof parsed === 'object' && 'error' in parsed) {
          return res.status(400).json({ error: parsed.error })
        }
        if (parsed !== undefined) patch[key] = parsed
      }

      if (Object.keys(patch).length === 0) {
        return res.status(400).json({
          error: `Provide at least one field to update. Text keys: phone_number, notes, stripe_connect_account_id (Stripe id max ${MAX_OWNER_PROFILE_STRIPE_CONNECT_ACCOUNT_ID_LENGTH}, must match acct_…). Booleans: stripe_onboarding_complete, stripe_payouts_enabled, stripe_charges_enabled, stripe_details_submitted. Max lengths: phone ${MAX_OWNER_PROFILE_PHONE_LENGTH}, notes ${MAX_OWNER_PROFILE_NOTES_LENGTH}.`,
        })
      }

      const profile = await updateOwnerProfile({ appUserId: appUser.id, ...patch })
      return res.status(200).json({ ok: true, profile })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    console.error('[owner-profiles]', err)
    const msg = err?.message || 'owner_profiles request failed.'
    if (msg.includes('does not have the owner role')) {
      return res.status(403).json({ error: msg })
    }
    if (
      msg.includes('stripe_connect_account_id') ||
      msg.includes('phone_number') ||
      msg.includes('notes') ||
      msg.includes('must be a boolean')
    ) {
      return res.status(400).json({ error: msg })
    }
    return res.status(500).json({ error: msg })
  }
}

/**
 * manager_profiles — role-specific extension rows for managers (public.manager_profiles).
 *
 * Only users with the `manager` app_user_roles row should have a profile; helpers enforce that on write.
 *
 * @module
 */

import { requireServiceClient } from './app-users-service.js'
import { appUserHasRole } from './app-user-roles-service.js'

/** Canonical tier values stored in DB (matches migration check constraint). */
export const MANAGER_TIER_STANDARD = 'Standard'
export const MANAGER_TIER_PREMIUM = 'Premium'

/** @readonly */
export const MANAGER_TIER_VALUES = [MANAGER_TIER_STANDARD, MANAGER_TIER_PREMIUM]

const TIER_BY_NORMALIZED = {
  standard: MANAGER_TIER_STANDARD,
  premium: MANAGER_TIER_PREMIUM,
}

export const MAX_MANAGER_PROFILE_COMPANY_LENGTH = 500
export const MAX_MANAGER_PROFILE_PHONE_LENGTH = 40
export const MAX_MANAGER_PROFILE_NOTES_LENGTH = 20_000

/**
 * @param {unknown} tier
 * @returns {string | null} canonical tier or null
 */
export function normalizeManagerTier(tier) {
  if (tier === null || tier === undefined) return null
  if (typeof tier !== 'string') {
    throw new Error('normalizeManagerTier: tier must be a string or null.')
  }
  const key = tier.trim().toLowerCase()
  if (!key) return null
  const canon = TIER_BY_NORMALIZED[key]
  if (!canon) {
    throw new Error(`normalizeManagerTier: invalid tier "${tier}". Use ${MANAGER_TIER_VALUES.join(' or ')}.`)
  }
  return canon
}

/**
 * @param {unknown} value
 * @param {number} maxLen
 * @param {string} fieldName
 * @returns {string | null}
 */
function normalizeNullableTextField(value, maxLen, fieldName) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string or null.`)
  }
  const s = value.trim()
  if (s.length > maxLen) {
    throw new Error(`${fieldName} exceeds max length (${maxLen}).`)
  }
  return s.length ? s : null
}

/**
 * @param {string} appUserId - public.app_users.id
 * @returns {Promise<object | null>}
 */
export async function getManagerProfileByAppUserId(appUserId) {
  const id = String(appUserId || '').trim()
  if (!id) return null
  const client = requireServiceClient()
  const { data, error } = await client.from('manager_profiles').select('*').eq('app_user_id', id).maybeSingle()
  if (error) throw new Error(error.message || 'Failed to load manager_profiles')
  return data || null
}

/**
 * Insert a row if missing. Requires `manager` role on the app_user.
 *
 * @param {{
 *   appUserId: string
 *   company?: string | null
 *   tier?: string | null
 *   phone_number?: string | null
 *   notes?: string | null
 * }} args
 * @returns {Promise<object>} existing or new row
 */
export async function ensureManagerProfileExists(args) {
  const appUserId = String(args.appUserId || '').trim()
  if (!appUserId) {
    throw new Error('ensureManagerProfileExists: appUserId is required.')
  }

  const hasManager = await appUserHasRole(appUserId, 'manager')
  if (!hasManager) {
    throw new Error('ensureManagerProfileExists: app_user does not have the manager role.')
  }

  const existing = await getManagerProfileByAppUserId(appUserId)
  if (existing) return existing

  const payload = { app_user_id: appUserId }
  if (args.company !== undefined) {
    payload.company = normalizeNullableTextField(args.company, MAX_MANAGER_PROFILE_COMPANY_LENGTH, 'company')
  }
  if (args.tier !== undefined) {
    payload.tier = args.tier === null ? null : normalizeManagerTier(args.tier)
  }
  if (args.phone_number !== undefined) {
    payload.phone_number = normalizeNullableTextField(
      args.phone_number,
      MAX_MANAGER_PROFILE_PHONE_LENGTH,
      'phone_number',
    )
  }
  if (args.notes !== undefined) {
    payload.notes = normalizeNullableTextField(args.notes, MAX_MANAGER_PROFILE_NOTES_LENGTH, 'notes')
  }

  const client = requireServiceClient()
  const { data, error } = await client.from('manager_profiles').insert(payload).select('*').single()

  if (error?.code === '23505') {
    const again = await getManagerProfileByAppUserId(appUserId)
    if (again) return again
  }

  if (error) throw new Error(error.message || 'Failed to create manager_profiles')
  return data
}

/**
 * Partial update. Requires `manager` role. Creates row if missing (same as ensure with no extra fields).
 *
 * @param {{
 *   appUserId: string
 *   company?: string | null
 *   tier?: string | null
 *   phone_number?: string | null
 *   notes?: string | null
 * }} args — only keys present are updated (undefined = omit)
 * @returns {Promise<object>} updated row
 */
export async function updateManagerProfile(args) {
  const appUserId = String(args.appUserId || '').trim()
  if (!appUserId) {
    throw new Error('updateManagerProfile: appUserId is required.')
  }

  const hasManager = await appUserHasRole(appUserId, 'manager')
  if (!hasManager) {
    throw new Error('updateManagerProfile: app_user does not have the manager role.')
  }

  const updates = {}
  if (args.company !== undefined) {
    updates.company = normalizeNullableTextField(args.company, MAX_MANAGER_PROFILE_COMPANY_LENGTH, 'company')
  }
  if (args.tier !== undefined) {
    updates.tier = args.tier === null ? null : normalizeManagerTier(args.tier)
  }
  if (args.phone_number !== undefined) {
    updates.phone_number = normalizeNullableTextField(
      args.phone_number,
      MAX_MANAGER_PROFILE_PHONE_LENGTH,
      'phone_number',
    )
  }
  if (args.notes !== undefined) {
    updates.notes = normalizeNullableTextField(args.notes, MAX_MANAGER_PROFILE_NOTES_LENGTH, 'notes')
  }

  if (Object.keys(updates).length === 0) {
    throw new Error('updateManagerProfile: at least one field must be provided to update.')
  }

  await ensureManagerProfileExists({ appUserId })

  const client = requireServiceClient()
  const { data, error } = await client
    .from('manager_profiles')
    .update(updates)
    .eq('app_user_id', appUserId)
    .select('*')
    .single()

  if (error) throw new Error(error.message || 'Failed to update manager_profiles')
  return data
}

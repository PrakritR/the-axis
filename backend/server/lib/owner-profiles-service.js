/**
 * owner_profiles — role-specific extension rows for owners (public.owner_profiles).
 *
 * Only users with the `owner` app_user_roles row should have a profile; helpers enforce that on write.
 * Stripe columns are optional until Connect onboarding is implemented.
 *
 * @module
 */

import { requireServiceClient } from './app-users-service.js'
import { appUserHasRole } from './app-user-roles-service.js'

export const MAX_OWNER_PROFILE_PHONE_LENGTH = 40
export const MAX_OWNER_PROFILE_NOTES_LENGTH = 20_000
/** Stripe Connect account IDs are typically `acct_` + alphanumeric; allow headroom. */
export const MAX_OWNER_PROFILE_STRIPE_CONNECT_ACCOUNT_ID_LENGTH = 64

const STRIPE_ACCT_ID_RE = /^acct_[a-zA-Z0-9]+$/

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
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalizeStripeConnectAccountId(value) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') {
    throw new Error('stripe_connect_account_id must be a string or null.')
  }
  const s = value.trim()
  if (!s) return null
  if (s.length > MAX_OWNER_PROFILE_STRIPE_CONNECT_ACCOUNT_ID_LENGTH) {
    throw new Error(
      `stripe_connect_account_id exceeds max length (${MAX_OWNER_PROFILE_STRIPE_CONNECT_ACCOUNT_ID_LENGTH}).`,
    )
  }
  if (!STRIPE_ACCT_ID_RE.test(s)) {
    throw new Error('stripe_connect_account_id must look like a Stripe account id (e.g. acct_…).')
  }
  return s
}

/**
 * @param {unknown} value
 * @param {string} fieldName
 * @returns {boolean}
 */
function requireBoolean(value, fieldName) {
  if (typeof value !== 'boolean') {
    throw new Error(`${fieldName} must be a boolean.`)
  }
  return value
}

/**
 * @param {string} appUserId - public.app_users.id
 * @returns {Promise<object | null>}
 */
export async function getOwnerProfileByAppUserId(appUserId) {
  const id = String(appUserId || '').trim()
  if (!id) return null
  const client = requireServiceClient()
  const { data, error } = await client.from('owner_profiles').select('*').eq('app_user_id', id).maybeSingle()
  if (error) throw new Error(error.message || 'Failed to load owner_profiles')
  return data || null
}

/**
 * Insert a row if missing. Requires `owner` role on the app_user.
 *
 * @param {{
 *   appUserId: string
 *   phone_number?: string | null
 *   notes?: string | null
 *   stripe_connect_account_id?: string | null
 * }} args
 * @returns {Promise<object>} existing or new row
 */
export async function ensureOwnerProfileExists(args) {
  const appUserId = String(args.appUserId || '').trim()
  if (!appUserId) {
    throw new Error('ensureOwnerProfileExists: appUserId is required.')
  }

  const hasOwner = await appUserHasRole(appUserId, 'owner')
  if (!hasOwner) {
    throw new Error('ensureOwnerProfileExists: app_user does not have the owner role.')
  }

  const existing = await getOwnerProfileByAppUserId(appUserId)
  if (existing) return existing

  const payload = { app_user_id: appUserId }
  if (args.phone_number !== undefined) {
    payload.phone_number = normalizeNullableTextField(
      args.phone_number,
      MAX_OWNER_PROFILE_PHONE_LENGTH,
      'phone_number',
    )
  }
  if (args.notes !== undefined) {
    payload.notes = normalizeNullableTextField(args.notes, MAX_OWNER_PROFILE_NOTES_LENGTH, 'notes')
  }
  if (args.stripe_connect_account_id !== undefined) {
    payload.stripe_connect_account_id = normalizeStripeConnectAccountId(args.stripe_connect_account_id)
  }

  const client = requireServiceClient()
  const { data, error } = await client.from('owner_profiles').insert(payload).select('*').single()

  if (error?.code === '23505') {
    const again = await getOwnerProfileByAppUserId(appUserId)
    if (again) return again
  }

  if (error) throw new Error(error.message || 'Failed to create owner_profiles')
  return data
}

/**
 * Partial update. Requires `owner` role. Creates row if missing.
 *
 * @param {{
 *   appUserId: string
 *   phone_number?: string | null
 *   notes?: string | null
 *   stripe_connect_account_id?: string | null
 *   stripe_onboarding_complete?: boolean
 *   stripe_payouts_enabled?: boolean
 *   stripe_charges_enabled?: boolean
 *   stripe_details_submitted?: boolean
 * }} args
 * @returns {Promise<object>}
 */
export async function updateOwnerProfile(args) {
  const appUserId = String(args.appUserId || '').trim()
  if (!appUserId) {
    throw new Error('updateOwnerProfile: appUserId is required.')
  }

  const hasOwner = await appUserHasRole(appUserId, 'owner')
  if (!hasOwner) {
    throw new Error('updateOwnerProfile: app_user does not have the owner role.')
  }

  const updates = {}
  if (args.phone_number !== undefined) {
    updates.phone_number = normalizeNullableTextField(
      args.phone_number,
      MAX_OWNER_PROFILE_PHONE_LENGTH,
      'phone_number',
    )
  }
  if (args.notes !== undefined) {
    updates.notes = normalizeNullableTextField(args.notes, MAX_OWNER_PROFILE_NOTES_LENGTH, 'notes')
  }
  if (args.stripe_connect_account_id !== undefined) {
    updates.stripe_connect_account_id = normalizeStripeConnectAccountId(args.stripe_connect_account_id)
  }
  if (args.stripe_onboarding_complete !== undefined) {
    updates.stripe_onboarding_complete = requireBoolean(args.stripe_onboarding_complete, 'stripe_onboarding_complete')
  }
  if (args.stripe_payouts_enabled !== undefined) {
    updates.stripe_payouts_enabled = requireBoolean(args.stripe_payouts_enabled, 'stripe_payouts_enabled')
  }
  if (args.stripe_charges_enabled !== undefined) {
    updates.stripe_charges_enabled = requireBoolean(args.stripe_charges_enabled, 'stripe_charges_enabled')
  }
  if (args.stripe_details_submitted !== undefined) {
    updates.stripe_details_submitted = requireBoolean(args.stripe_details_submitted, 'stripe_details_submitted')
  }

  if (Object.keys(updates).length === 0) {
    throw new Error('updateOwnerProfile: at least one field must be provided to update.')
  }

  await ensureOwnerProfileExists({ appUserId })

  const client = requireServiceClient()
  const { data, error } = await client
    .from('owner_profiles')
    .update(updates)
    .eq('app_user_id', appUserId)
    .select('*')
    .single()

  if (error) throw new Error(error.message || 'Failed to update owner_profiles')
  return data
}

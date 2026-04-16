/**
 * resident_profiles — role-specific extension rows for residents (public.resident_profiles).
 *
 * Only users with the `resident` app_user_roles row should have a profile; helpers enforce that on write.
 *
 * @module
 */

import { requireServiceClient } from './app-users-service.js'
import { appUserHasRole } from './app-user-roles-service.js'

export const MAX_RESIDENT_PROFILE_PHONE_LENGTH = 40
export const MAX_RESIDENT_PROFILE_EMERGENCY_CONTACT_NAME_LENGTH = 200
export const MAX_RESIDENT_PROFILE_EMERGENCY_CONTACT_PHONE_LENGTH = 40
export const MAX_RESIDENT_PROFILE_NOTES_LENGTH = 20_000

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
 * @param {string} appUserId
 * @returns {Promise<object | null>}
 */
export async function getResidentProfileByAppUserId(appUserId) {
  const id = String(appUserId || '').trim()
  if (!id) return null
  const client = requireServiceClient()
  const { data, error } = await client.from('resident_profiles').select('*').eq('app_user_id', id).maybeSingle()
  if (error) throw new Error(error.message || 'Failed to load resident_profiles')
  return data || null
}

/**
 * Insert a row if missing. Requires `resident` role on the app_user.
 *
 * @param {{
 *   appUserId: string
 *   phone_number?: string | null
 *   emergency_contact_name?: string | null
 *   emergency_contact_phone?: string | null
 *   notes?: string | null
 * }} args
 * @returns {Promise<object>} existing or new row
 */
export async function ensureResidentProfileExists(args) {
  const appUserId = String(args.appUserId || '').trim()
  if (!appUserId) {
    throw new Error('ensureResidentProfileExists: appUserId is required.')
  }

  const hasResident = await appUserHasRole(appUserId, 'resident')
  if (!hasResident) {
    throw new Error('ensureResidentProfileExists: app_user does not have the resident role.')
  }

  const existing = await getResidentProfileByAppUserId(appUserId)
  if (existing) return existing

  const payload = { app_user_id: appUserId }
  if (args.phone_number !== undefined) {
    payload.phone_number = normalizeNullableTextField(
      args.phone_number,
      MAX_RESIDENT_PROFILE_PHONE_LENGTH,
      'phone_number',
    )
  }
  if (args.emergency_contact_name !== undefined) {
    payload.emergency_contact_name = normalizeNullableTextField(
      args.emergency_contact_name,
      MAX_RESIDENT_PROFILE_EMERGENCY_CONTACT_NAME_LENGTH,
      'emergency_contact_name',
    )
  }
  if (args.emergency_contact_phone !== undefined) {
    payload.emergency_contact_phone = normalizeNullableTextField(
      args.emergency_contact_phone,
      MAX_RESIDENT_PROFILE_EMERGENCY_CONTACT_PHONE_LENGTH,
      'emergency_contact_phone',
    )
  }
  if (args.notes !== undefined) {
    payload.notes = normalizeNullableTextField(args.notes, MAX_RESIDENT_PROFILE_NOTES_LENGTH, 'notes')
  }

  const client = requireServiceClient()
  const { data, error } = await client.from('resident_profiles').insert(payload).select('*').single()

  if (error?.code === '23505') {
    const again = await getResidentProfileByAppUserId(appUserId)
    if (again) return again
  }

  if (error) throw new Error(error.message || 'Failed to create resident_profiles')
  return data
}

/**
 * Partial update. Requires `resident` role. Creates row if missing.
 *
 * @param {{
 *   appUserId: string
 *   phone_number?: string | null
 *   emergency_contact_name?: string | null
 *   emergency_contact_phone?: string | null
 *   notes?: string | null
 * }} args — only keys present are updated (undefined = omit)
 * @returns {Promise<object>} updated row
 */
export async function updateResidentProfile(args) {
  const appUserId = String(args.appUserId || '').trim()
  if (!appUserId) {
    throw new Error('updateResidentProfile: appUserId is required.')
  }

  const hasResident = await appUserHasRole(appUserId, 'resident')
  if (!hasResident) {
    throw new Error('updateResidentProfile: app_user does not have the resident role.')
  }

  const updates = {}
  if (args.phone_number !== undefined) {
    updates.phone_number = normalizeNullableTextField(
      args.phone_number,
      MAX_RESIDENT_PROFILE_PHONE_LENGTH,
      'phone_number',
    )
  }
  if (args.emergency_contact_name !== undefined) {
    updates.emergency_contact_name = normalizeNullableTextField(
      args.emergency_contact_name,
      MAX_RESIDENT_PROFILE_EMERGENCY_CONTACT_NAME_LENGTH,
      'emergency_contact_name',
    )
  }
  if (args.emergency_contact_phone !== undefined) {
    updates.emergency_contact_phone = normalizeNullableTextField(
      args.emergency_contact_phone,
      MAX_RESIDENT_PROFILE_EMERGENCY_CONTACT_PHONE_LENGTH,
      'emergency_contact_phone',
    )
  }
  if (args.notes !== undefined) {
    updates.notes = normalizeNullableTextField(args.notes, MAX_RESIDENT_PROFILE_NOTES_LENGTH, 'notes')
  }

  if (Object.keys(updates).length === 0) {
    throw new Error('updateResidentProfile: at least one field must be provided to update.')
  }

  await ensureResidentProfileExists({ appUserId })

  const client = requireServiceClient()
  const { data, error } = await client
    .from('resident_profiles')
    .update(updates)
    .eq('app_user_id', appUserId)
    .select('*')
    .single()

  if (error) throw new Error(error.message || 'Failed to update resident_profiles')
  return data
}

/**
 * admin_profiles — role-specific extension rows for admins (public.admin_profiles).
 *
 * Only users with the `admin` app_user_roles row should have a profile; helpers enforce that on write.
 *
 * @module
 */

import { requireServiceClient } from './app-users-service.js'
import { appUserHasRole } from './app-user-roles-service.js'

/** Server-side cap for notes field size (characters). */
export const MAX_ADMIN_PROFILE_NOTES_LENGTH = 20_000

/**
 * @param {unknown} notes
 * @returns {string | null}
 */
export function normalizeAdminProfileNotes(notes) {
  if (notes === null) return null
  if (notes === undefined) {
    throw new Error('normalizeAdminProfileNotes: notes must be provided (string or null).')
  }
  if (typeof notes !== 'string') {
    throw new Error('normalizeAdminProfileNotes: notes must be a string or null.')
  }
  const s = notes.trim()
  if (s.length > MAX_ADMIN_PROFILE_NOTES_LENGTH) {
    throw new Error(`notes exceeds max length (${MAX_ADMIN_PROFILE_NOTES_LENGTH}).`)
  }
  return s
}

/**
 * @param {string} appUserId - public.app_users.id
 * @returns {Promise<object | null>}
 */
export async function getAdminProfileByAppUserId(appUserId) {
  const id = String(appUserId || '').trim()
  if (!id) return null
  const client = requireServiceClient()
  const { data, error } = await client.from('admin_profiles').select('*').eq('app_user_id', id).maybeSingle()
  if (error) throw new Error(error.message || 'Failed to load admin_profiles')
  return data || null
}

/**
 * Insert a row if missing. Requires `admin` role on the app_user.
 *
 * @param {{ appUserId: string, notes?: string | null }} args
 * @returns {Promise<object>} existing or new row
 */
export async function ensureAdminProfileExists(args) {
  const appUserId = String(args.appUserId || '').trim()
  if (!appUserId) {
    throw new Error('ensureAdminProfileExists: appUserId is required.')
  }

  const hasAdmin = await appUserHasRole(appUserId, 'admin')
  if (!hasAdmin) {
    throw new Error('ensureAdminProfileExists: app_user does not have the admin role.')
  }

  const existing = await getAdminProfileByAppUserId(appUserId)
  if (existing) return existing

  const client = requireServiceClient()
  const payload = { app_user_id: appUserId }
  if (args.notes !== undefined) {
    payload.notes = args.notes === null ? null : normalizeAdminProfileNotes(args.notes)
  }

  const { data, error } = await client.from('admin_profiles').insert(payload).select('*').single()

  if (error?.code === '23505') {
    const again = await getAdminProfileByAppUserId(appUserId)
    if (again) return again
  }

  if (error) throw new Error(error.message || 'Failed to create admin_profiles')
  return data
}

/**
 * Sets `notes` on the admin profile for this app user (creates row if missing).
 *
 * @param {{ appUserId: string, notes: string | null }} args
 * @returns {Promise<object>} updated row
 */
export async function setAdminProfileNotes(args) {
  const appUserId = String(args.appUserId || '').trim()
  if (!appUserId) {
    throw new Error('setAdminProfileNotes: appUserId is required.')
  }

  const normalized = normalizeAdminProfileNotes(args.notes)

  const hasAdmin = await appUserHasRole(appUserId, 'admin')
  if (!hasAdmin) {
    throw new Error('setAdminProfileNotes: app_user does not have the admin role.')
  }

  await ensureAdminProfileExists({ appUserId })

  const client = requireServiceClient()
  const { data, error } = await client
    .from('admin_profiles')
    .update({ notes: normalized })
    .eq('app_user_id', appUserId)
    .select('*')
    .single()

  if (error) throw new Error(error.message || 'Failed to update admin_profiles')
  return data
}

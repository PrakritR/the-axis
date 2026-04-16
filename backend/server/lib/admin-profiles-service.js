/**
 * admin_profiles — role-specific extension rows for admins (public.admin_profiles).
 *
 * Only users with the `admin` app_user_roles row should have a profile; helpers enforce that on write.
 *
 * @module
 */

import { requireServiceClient } from './app-users-service.js'
import { appUserHasRole } from './app-user-roles-service.js'

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
  if (args.notes !== undefined) payload.notes = args.notes

  const { data, error } = await client.from('admin_profiles').insert(payload).select('*').single()

  if (error?.code === '23505') {
    const again = await getAdminProfileByAppUserId(appUserId)
    if (again) return again
  }

  if (error) throw new Error(error.message || 'Failed to create admin_profiles')
  return data
}

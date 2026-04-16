/**
 * app_user_roles — role rows for public.app_users (Supabase Postgres).
 *
 * Uses the same service-role client as `app-users-service.js`.
 *
 * @module
 */

import {
  getAppUserByAuthUserId,
  getAppUserByEmail,
  requireServiceClient,
} from './app-users-service.js'

/** @readonly */
export const APP_USER_ROLE_VALUES = ['admin', 'manager', 'owner', 'resident']

/** @param {string} role */
export function normalizeAppUserRole(role) {
  const r = String(role || '').trim().toLowerCase()
  if (!APP_USER_ROLE_VALUES.includes(r)) {
    throw new Error(`Invalid role "${role}". Must be one of: ${APP_USER_ROLE_VALUES.join(', ')}`)
  }
  return r
}

/**
 * @param {string} appUserId - public.app_users.id
 * @returns {Promise<object[]>} role rows (ordered: primary first, then role name)
 */
export async function getRolesForAppUserId(appUserId) {
  const id = String(appUserId || '').trim()
  if (!id) return []
  const client = requireServiceClient()
  const { data, error } = await client
    .from('app_user_roles')
    .select('*')
    .eq('app_user_id', id)
    .order('is_primary', { ascending: false })
    .order('role', { ascending: true })
  if (error) throw new Error(error.message || 'Failed to load app_user_roles')
  return Array.isArray(data) ? data : []
}

/**
 * Insert or update a role row for (app_user_id, role). Optional primary flag
 * (trigger clears other primaries for that app_user when set true).
 *
 * @param {{ appUserId: string, role: string, isPrimary?: boolean }} args
 * @returns {Promise<object>} persisted row
 */
export async function assignRoleToAppUser(args) {
  const appUserId = String(args.appUserId || '').trim()
  const role = normalizeAppUserRole(args.role)
  const isPrimary = args.isPrimary === true

  if (!appUserId) {
    throw new Error('assignRoleToAppUser: appUserId is required.')
  }

  const client = requireServiceClient()
  const { data, error } = await client
    .from('app_user_roles')
    .upsert(
      { app_user_id: appUserId, role, is_primary: isPrimary },
      { onConflict: 'app_user_id,role' },
    )
    .select('*')
    .single()

  if (error) throw new Error(error.message || 'Failed to assign app_user_roles')
  return data
}

/**
 * @param {string} appUserId
 * @param {string} role
 * @returns {Promise<boolean>}
 */
export async function appUserHasRole(appUserId, role) {
  const r = normalizeAppUserRole(role)
  const id = String(appUserId || '').trim()
  if (!id) return false
  const client = requireServiceClient()
  const { data, error } = await client
    .from('app_user_roles')
    .select('id')
    .eq('app_user_id', id)
    .eq('role', r)
    .maybeSingle()
  if (error) throw new Error(error.message || 'Failed to check app_user_roles')
  return Boolean(data?.id)
}

/**
 * Resolve app_users by Supabase auth id, then upsert the role row (deduped by unique app_user_id + role).
 *
 * @param {{ authUserId: string, role: string, isPrimary?: boolean }} args
 * @returns {Promise<object>} persisted app_user_roles row
 */
export async function assignRoleByAuthUserId(args) {
  const authUserId = String(args.authUserId || '').trim()
  if (!authUserId) throw new Error('assignRoleByAuthUserId: authUserId is required.')
  const user = await getAppUserByAuthUserId(authUserId)
  if (!user?.id) {
    throw new Error(
      'No app_users row for this auth user. Sign in once (auth sync) or run ensureAppUserByAuthId before seeding roles.',
    )
  }
  return assignRoleToAppUser({
    appUserId: user.id,
    role: args.role,
    isPrimary: args.isPrimary,
  })
}

/**
 * Resolve app_users by email, then upsert the role row.
 *
 * @param {{ email: string, role: string, isPrimary?: boolean }} args
 * @returns {Promise<object>} persisted app_user_roles row
 */
export async function assignRoleByEmail(args) {
  const email = String(args.email || '').trim()
  if (!email) throw new Error('assignRoleByEmail: email is required.')
  const user = await getAppUserByEmail(email)
  if (!user?.id) {
    throw new Error(
      `No app_users row for email "${email}". Sign in once with /login or portal auth sync so app_users exists, then re-run.`,
    )
  }
  return assignRoleToAppUser({
    appUserId: user.id,
    role: args.role,
    isPrimary: args.isPrimary,
  })
}

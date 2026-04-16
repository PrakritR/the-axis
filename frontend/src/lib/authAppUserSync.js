/**
 * Auth → internal DB bootstrap: after Supabase sign-in (or session restore),
 * call POST /api/sync-app-user so app_users exists and roles are loaded.
 *
 * Client state: sessionStorage key {@link AXIS_APP_USER_SYNC_KEY} holds
 * { authUserId, appUserId, appUser, roles, syncedAt }.
 */

import { supabase } from './supabase'

export const AXIS_APP_USER_SYNC_KEY = 'axis_app_user_sync'

export function clearAppUserBootstrap() {
  try {
    sessionStorage.removeItem(AXIS_APP_USER_SYNC_KEY)
  } catch {
    /* ignore */
  }
}

/** @returns {{ authUserId: string, appUserId: string, appUser: object, roles: object[], syncedAt: string } | null} */
export function readAppUserBootstrap() {
  try {
    const raw = sessionStorage.getItem(AXIS_APP_USER_SYNC_KEY)
    if (!raw) return null
    const o = JSON.parse(raw)
    if (!o || typeof o !== 'object') return null
    return o
  } catch {
    return null
  }
}

function writeBootstrap(state) {
  sessionStorage.setItem(
    AXIS_APP_USER_SYNC_KEY,
    JSON.stringify({
      ...state,
      syncedAt: new Date().toISOString(),
    }),
  )
}

/**
 * Uses the current Supabase session access token to upsert app_users and fetch app_user_roles.
 * @returns {Promise<{ authUserId: string, appUserId: string, appUser: object, roles: object[] } | null>}
 */
export async function syncAppUserFromSupabaseSession() {
  const { data: sessionData } = await supabase.auth.getSession()
  const session = sessionData?.session
  if (!session?.access_token || !session?.user?.id) {
    clearAppUserBootstrap()
    return null
  }

  const res = await fetch('/api/sync-app-user', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  })

  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json?.ok) {
    if (import.meta.env.DEV) {
      console.warn('[authAppUserSync]', res.status, json?.error || 'sync failed')
    }
    return null
  }

  const appUser = json.appUser
  const appUserId = appUser?.id ? String(appUser.id) : ''
  if (!appUserId) {
    return null
  }

  const state = {
    authUserId: String(json.authUserId || session.user.id),
    appUserId,
    appUser,
    roles: Array.isArray(json.roles) ? json.roles : [],
  }
  writeBootstrap(state)
  return state
}

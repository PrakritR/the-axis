/**
 * Authenticated `/api/applications` client (Supabase JWT).
 *
 * @module
 */

import { supabase } from './supabase'

async function bearerHeaders() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) return null
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

async function fetchApplicationsApi(query = {}, init = {}) {
  const headers = await bearerHeaders()
  if (!headers) throw new Error('Sign in is required.')

  const u = new URL('/api/applications', typeof window !== 'undefined' ? window.location.origin : 'http://localhost')
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue
    const s = String(v).trim()
    if (!s) continue
    u.searchParams.set(k, s)
  }
  const path = `${u.pathname}${u.search}`
  const res = await fetch(path, { ...init, headers: { ...headers, ...(init.headers || {}) } })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `applications request failed (${res.status}).`)
  return json
}

/**
 * @returns {Promise<object[]|null>} legacy-shaped rows, or null when not signed in
 */
export async function tryListManagedApplicationsForSession() {
  const headers = await bearerHeaders()
  if (!headers) return null
  const json = await fetchApplicationsApi({ scope: 'managed' })
  return Array.isArray(json.applications) ? json.applications : []
}

/**
 * @returns {Promise<object[]>}
 */
export async function listManagedApplicationsForSession() {
  const json = await fetchApplicationsApi({ scope: 'managed' })
  return Array.isArray(json.applications) ? json.applications : []
}

/**
 * @returns {Promise<object[]>}
 */
export async function listAdminApplicationsForSession() {
  const json = await fetchApplicationsApi({ scope: 'all' })
  return Array.isArray(json.applications) ? json.applications : []
}

/**
 * @param {string} id application UUID
 * @returns {Promise<object | null>}
 */
export async function getApplicationForSession(id) {
  const aid = String(id || '').trim()
  if (!aid) return null
  const json = await fetchApplicationsApi({ id: aid })
  return json.application && typeof json.application === 'object' ? json.application : null
}

/**
 * @param {string} id
 * @param {'approve'|'reject'|'set-pending'} action
 * @param {Record<string, unknown>} [body]
 */
export async function postApplicationAction(id, action, body = {}) {
  const aid = String(id || '').trim()
  if (!aid) throw new Error('Application id is required.')
  const json = await fetchApplicationsApi({ id: aid, action }, { method: 'POST', body: JSON.stringify(body || {}) })
  return json
}

/**
 * @param {string} email
 * @param {string} [excludeApplicationId]
 */
export async function checkDuplicateApplicationForSession(email, excludeApplicationId = '') {
  const em = String(email || '').trim().toLowerCase()
  if (!em) return false
  const q = { check_duplicate_email: em }
  if (excludeApplicationId) q.exclude_application_id = String(excludeApplicationId).trim()
  const json = await fetchApplicationsApi(q)
  return Boolean(json.duplicate)
}

/**
 * @param {{ propertyName: string, roomNumber: string, leaseStart: string, leaseEnd?: string, excludeApplicationId?: string }} args
 */
export async function checkRoomConflictForSession(args = {}) {
  const json = await fetchApplicationsApi({
    check_room_conflict: '1',
    property_name: args.propertyName,
    room_number: args.roomNumber,
    lease_start: args.leaseStart,
    lease_end: args.leaseEnd || '',
    exclude_application_id: args.excludeApplicationId || '',
  })
  return Boolean(json.roomConflict)
}

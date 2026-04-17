/**
 * Admin portal manager directory — Supabase only (app_users + app_user_roles + manager_profiles + properties).
 */
import { supabase } from './supabase'
import { syncAppUserFromSupabaseSession } from './authAppUserSync.js'

async function bearerHeaders() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) return null
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

/**
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
export async function fetchAdminManagersList() {
  await syncAppUserFromSupabaseSession().catch(() => null)
  const headers = await bearerHeaders()
  if (!headers) throw new Error('Sign in with your Axis admin account to load managers.')
  const res = await fetch('/api/admin-managers-list', { headers })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || `Could not load managers (${res.status}).`)
  return Array.isArray(json.managers) ? json.managers : []
}

/**
 * Map API rows to the account shape used across AdminPortal (Managers tab, leasing labels, inbox compose).
 * @param {Array<Record<string, unknown>>} rows
 */
export function mapAdminManagersApiToPortalAccounts(rows) {
  const list = Array.isArray(rows) ? rows : []
  return list.map((m) => ({
    id: String(m.id || ''),
    _supabase: true,
    name: String(m.name || m.email || '').trim() || 'Manager',
    email: String(m.email || '').trim().toLowerCase(),
    businessName: m.company != null && String(m.company).trim() ? String(m.company).trim() : null,
    verificationStatus: 'verified',
    propertyCount: Number(m.propertyCount) || 0,
    enabled: m.enabled !== false,
    houseSortKey: String(m.houseSortKey || '').trim().toLowerCase(),
    managedHousesLabel: String(m.managedHousesLabel || '—').trim() || '—',
    updatedMs: Number(m.updatedMs) || 0,
    role: String(m.role || 'manager'),
  }))
}

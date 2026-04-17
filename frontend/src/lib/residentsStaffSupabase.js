/**
 * Admin / manager resident directory via GET /api/resident-profiles?list=1 (Supabase JWT).
 *
 * @module
 */

import { supabase } from './supabase'
import { syncAppUserFromSupabaseSession } from './authAppUserSync.js'

async function bearerHeaders() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) return null
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

/**
 * @returns {Promise<object[]>} legacy-shaped resident rows (`display` from API), sorted by name
 */
export async function fetchStaffResidentsLegacyList() {
  await syncAppUserFromSupabaseSession().catch(() => null)
  const headers = await bearerHeaders()
  if (!headers) throw new Error('Sign in with your Axis account to load residents.')
  const res = await fetch('/api/resident-profiles?list=1', { headers })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(json?.error || `Could not load residents (${res.status}).`)
  }
  const rows = Array.isArray(json.residents) ? json.residents : []
  const mapped = rows
    .map((r) => (r && typeof r.display === 'object' ? r.display : null))
    .filter(Boolean)
  mapped.sort((a, b) =>
    String(a.Name || a['Resident Name'] || '').localeCompare(String(b.Name || b['Resident Name'] || ''), undefined, {
      sensitivity: 'base',
    }),
  )
  return mapped
}

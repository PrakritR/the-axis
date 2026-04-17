/**
 * Authenticated `/api/lease-drafts` client (Supabase JWT).
 * Replaces direct `supabase.from('lease_drafts')` reads so RLS + browser tokens stay consistent.
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

async function fetchLeaseDraftsApi(query = {}) {
  const headers = await bearerHeaders()
  if (!headers) throw new Error('Sign in is required to load lease drafts.')
  const u = new URL('/api/lease-drafts', typeof window !== 'undefined' ? window.location.origin : 'http://localhost')
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue
    const s = String(v).trim()
    if (!s) continue
    u.searchParams.set(k, s)
  }
  const path = `${u.pathname}${u.search}`
  const res = await fetch(path, { headers })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `Could not load lease drafts (${res.status}).`)
  return json
}

/**
 * @param {{ status?: string, property?: string, resident?: string }} [filters]
 * @returns {Promise<object[]>} legacy-shaped lease draft rows
 */
export async function listLeaseDraftsForSession(filters = {}) {
  const json = await fetchLeaseDraftsApi(filters)
  return Array.isArray(json.drafts) ? json.drafts : []
}

/**
 * @param {string} id lease draft UUID
 * @returns {Promise<object | null>}
 */
export async function getLeaseDraftByIdForSession(id) {
  const lid = String(id || '').trim()
  if (!lid) return null
  const json = await fetchLeaseDraftsApi({ id: lid })
  return json.draft && typeof json.draft === 'object' ? json.draft : null
}

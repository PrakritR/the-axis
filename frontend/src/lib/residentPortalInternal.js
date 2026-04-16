/**
 * Internal (Postgres + Supabase JWT) data paths for the Resident portal.
 * Legacy Airtable flows stay in `airtable.js`; call these when the user has a Supabase session.
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

/**
 * GET /api/portal?action=resident-context
 * @returns {Promise<object | null>} parsed JSON or null if unauthenticated / error
 */
export async function fetchResidentPortalContext() {
  const headers = await bearerHeaders()
  if (!headers) return null
  const res = await fetch('/api/portal?action=resident-context', { headers })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json.ok) return null
  return json
}

/**
 * Map a Postgres `payments` row into the loose Airtable-shaped object used by
 * `residentPaymentsShared` / Payments UI (Amount, Balance, Status, Type, …).
 *
 * @param {object} row
 */
export function mapInternalPaymentToResidentPaymentRow(row) {
  const r = row && typeof row === 'object' ? row : {}
  const cents = Number(r.amount_cents) || 0
  const amount = cents / 100
  const st = String(r.status || '').trim().toLowerCase()
  let balance = 0
  if (r.balance_cents != null && Number.isFinite(Number(r.balance_cents))) {
    balance = Math.max(0, Number(r.balance_cents) / 100)
  } else if (st === 'pending' || st === 'failed') {
    balance = amount
  }
  const ptype = String(r.payment_type || '').trim().toLowerCase().replace(/_/g, ' ')
  const typeLabel =
    ptype === 'application fee'
      ? 'Application fee'
      : ptype === 'security deposit'
        ? 'Security deposit'
        : ptype === 'rent'
          ? 'Rent'
          : ptype === 'utilities'
            ? 'Utilities'
            : ptype === 'service fee'
              ? 'Service fee'
              : 'Other charge'
  const statusLabel =
    st === 'completed' ? 'Paid' : st === 'refunded' ? 'Refunded' : st === 'failed' ? 'Unpaid' : st === 'cancelled' ? 'Cancelled' : 'Unpaid'

  const desc = [r.description, r.notes].map((x) => String(x || '').trim()).filter(Boolean).join(' — ')
  return {
    id: String(r.id),
    Type: typeLabel,
    Category: String(r.category || '').trim(),
    Kind: String(r.kind || '').trim(),
    Month: r.due_date ? String(r.due_date).slice(0, 7) : '',
    Amount: amount,
    Balance: balance,
    Status: statusLabel,
    'Due Date': r.due_date ? String(r.due_date).slice(0, 10) : '',
    Notes: desc || `INTERNAL_PAYMENT:${r.id}`,
    'Property Name': String(r.property_name_snapshot || '').trim(),
    'Room Number': String(r.room_number_snapshot || '').trim(),
    _sourceInternalPostgres: true,
    _internalPayment: r,
  }
}

/**
 * Load `resident_profiles` for the current Supabase session (JWT).
 * Call {@link syncAppUserFromSupabaseSession} first so `app_users` exists.
 *
 * @returns {Promise<{ ok: boolean, noSession?: boolean, profile: object | null, error?: string }>}
 */
export async function fetchResidentInternalProfile() {
  const headers = await bearerHeaders()
  if (!headers) return { ok: false, noSession: true, profile: null, error: null }
  const res = await fetch('/api/resident-profiles', { headers })
  const json = await res.json().catch(() => ({}))
  if (res.status === 409) {
    return { ok: false, profile: null, error: json.error || 'No internal app user yet. Sync sign-in first.' }
  }
  if (res.status === 403) {
    return { ok: false, profile: null, error: json.error || 'Not allowed to read resident_profiles.' }
  }
  if (!res.ok) {
    return { ok: false, profile: null, error: json.error || `resident_profiles failed (${res.status})` }
  }
  return { ok: true, profile: json.profile ?? null, error: null }
}

/**
 * POST /api/resident-profiles — creates row if missing (resident role required).
 * @returns {Promise<object>} profile row
 */
export async function ensureResidentInternalProfileRow(body = {}) {
  const headers = await bearerHeaders()
  if (!headers) throw new Error('Sign in is required to create an internal resident profile.')
  const res = await fetch('/api/resident-profiles', {
    method: 'POST',
    headers,
    body: JSON.stringify(body && typeof body === 'object' ? body : {}),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json.ok) throw new Error(json.error || `Could not create profile (${res.status})`)
  return json.profile
}

/**
 * PATCH /api/resident-profiles — partial update (allowed keys only server-side).
 * @param {Record<string, unknown>} patch
 * @returns {Promise<object>} profile row
 */
export async function patchResidentInternalProfile(patch) {
  const headers = await bearerHeaders()
  if (!headers) throw new Error('Sign in is required to update your internal profile.')
  const res = await fetch('/api/resident-profiles', {
    method: 'PATCH',
    headers,
    body: JSON.stringify(patch && typeof patch === 'object' ? patch : {}),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json.ok) throw new Error(json.error || `Could not save profile (${res.status})`)
  return json.profile
}

/**
 * Signed download URL for a `lease_files` row (authorized applicant / resident).
 *
 * @param {string} fileId lease_files.id
 * @returns {Promise<string>} signedUrl
 */
export async function getSignedLeaseDownloadUrl(fileId) {
  const headers = await bearerHeaders()
  if (!headers) throw new Error('Sign in is required to download internal lease files.')
  const fid = String(fileId || '').trim()
  if (!fid) throw new Error('fileId is required.')
  const res = await fetch('/api/file-storage', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      op: 'signed_download',
      resource: 'lease_file',
      fileId: fid,
    }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `Download failed (${res.status})`)
  const url = String(json.signedUrl || '').trim()
  if (!url) throw new Error('No download URL returned.')
  return url
}

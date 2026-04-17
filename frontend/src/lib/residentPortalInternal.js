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
  const appUid = String(r.app_user_id || '').trim()
  const paidAt = r.paid_at ? String(r.paid_at) : ''
  const paidDate = paidAt ? paidAt.slice(0, 10) : ''
  const amountPaid = st === 'completed' ? amount : 0
  return {
    id: String(r.id),
    Type: typeLabel,
    Category: String(r.category || '').trim(),
    Kind: String(r.kind || '').trim(),
    Month: r.due_date ? String(r.due_date).slice(0, 7) : '',
    Amount: amount,
    'Amount Paid': amountPaid,
    Balance: balance,
    Status: statusLabel,
    'Due Date': r.due_date ? String(r.due_date).slice(0, 10) : '',
    'Paid Date': paidDate,
    Notes: desc || `INTERNAL_PAYMENT:${r.id}`,
    'Property Name': String(r.property_name_snapshot || '').trim(),
    'Room Number': String(r.room_number_snapshot || '').trim(),
    Resident: appUid ? [appUid] : [],
    _sourceInternalPostgres: true,
    _internalPayment: r,
    created_at: r.created_at,
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
  return {
    ok: true,
    profile: json.profile ?? null,
    app_user: json.app_user ?? null,
    display: json.display ?? null,
    error: null,
  }
}

/**
 * GET /api/resident-profiles — resident bundle including legacy `display` row for portal UI.
 * @returns {Promise<{ ok: boolean, profile: object | null, app_user: object | null, display: object | null, error?: string }>}
 */
export async function fetchResidentSelfFullBundle() {
  return fetchResidentInternalProfile()
}

/**
 * PATCH app_users display fields (full_name, phone) together with optional resident_profiles keys in one request.
 *
 * @param {{ full_name?: string | null, phone?: string | null, phone_number?: string | null, emergency_contact_name?: string | null, emergency_contact_phone?: string | null, notes?: string | null }} patch
 */
export async function patchResidentPortalProfile(patch) {
  const headers = await bearerHeaders()
  if (!headers) throw new Error('Sign in is required to update your profile.')
  const res = await fetch('/api/resident-profiles', {
    method: 'PATCH',
    headers,
    body: JSON.stringify(patch && typeof patch === 'object' ? patch : {}),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json.ok) throw new Error(json.error || `Could not save profile (${res.status})`)
  return { profile: json.profile, app_user: json.app_user }
}

/**
 * Adds `property_name`, `property_legacy_airtable_record_id` onto each application using `property_id`.
 *
 * @param {object} ctx — result of {@link fetchResidentPortalContext}
 * @returns {Promise<object>}
 */
export async function enrichPortalContextWithPropertyNames(ctx) {
  if (!ctx || typeof ctx !== 'object' || !ctx.ok) return ctx
  const apps = ctx.applications
  if (!Array.isArray(apps) || apps.length === 0) return ctx
  const ids = [...new Set(apps.map((a) => String(a?.property_id || '').trim()).filter(Boolean))]
  if (!ids.length) return ctx
  const { data, error } = await supabase.from('properties').select('id,name,legacy_airtable_record_id').in('id', ids)
  if (error || !Array.isArray(data)) return ctx
  const byId = new Map(data.map((p) => [String(p.id), p]))
  return {
    ...ctx,
    applications: apps.map((a) => {
      const pid = String(a?.property_id || '').trim()
      const p = pid ? byId.get(pid) : null
      return {
        ...a,
        property_name: p?.name != null ? String(p.name) : String(a.property_name || ''),
        property_legacy_airtable_record_id:
          p?.legacy_airtable_record_id != null ? String(p.legacy_airtable_record_id) : null,
      }
    }),
  }
}

/**
 * Minimal legacy resident object when GET /api/resident-profiles is not yet allowed (e.g. no resident role).
 *
 * @param {object} ctx — enriched portal context (`ok`, `app_user`, `applications`)
 * @param {{ id?: string, email?: string } | null} [authUser]
 */
export function buildResidentLegacyFromPortalContext(ctx, authUser = null) {
  const apps = Array.isArray(ctx?.applications) ? ctx.applications : []
  const primary =
    apps.find(
      (a) =>
        a?.approved === true ||
        String(a?.status || '').trim().toLowerCase() === 'approved',
    ) || apps[0]
  const u = ctx?.app_user && typeof ctx.app_user === 'object' ? ctx.app_user : {}
  const email = String(u.email || authUser?.email || '').trim().toLowerCase()
  const nameFromUser = String(u.full_name || '').trim()
  const displayName = nameFromUser || (email ? email.split('@')[0] : 'Resident')
  const propName = String(primary?.property_name || '').trim()
  const legacyRec = String(primary?.property_legacy_airtable_record_id || '').trim()
  const unit =
    String(primary?.approved_unit_room || '').trim() ||
    String(primary?.room_choice_2 || '').trim() ||
    ''

  const out = {
    id: String(u.id || authUser?.id || '').trim(),
    _fromSupabaseResidents: true,
    Name: displayName,
    Email: email,
    Phone: String(u.phone || '').trim(),
    Status: 'Active',
    Approved:
      primary &&
      (primary.approved === true || String(primary.status || '').trim().toLowerCase() === 'approved'),
    House: propName,
    'Property Name': propName,
    'Unit Number': unit,
    'Lease Start Date': primary?.lease_start_date || null,
    'Lease End Date': primary?.lease_end_date || null,
    'Application ID': primary?.id ? String(primary.id) : '',
  }

  if (legacyRec && /^rec[a-zA-Z0-9]{14,}$/.test(legacyRec)) {
    out.House = [legacyRec]
    out.Property = [legacyRec]
    out.Properties = [legacyRec]
  }
  return out
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

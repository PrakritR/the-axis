/**
 * Admin portal: property list + mutations backed by POST/PATCH /api/properties (Supabase JWT).
 */
import { supabase } from './supabase'
import { syncAppUserFromSupabaseSession } from './authAppUserSync.js'
import { PROPERTY_EDIT_REQUEST_FIELD } from './managerPropertyFormAirtableMap.js'

async function bearerHeaders() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('Sign in to load properties.')
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

function formatAddress(p) {
  const line2 = p.address_line2 != null && String(p.address_line2).trim() ? String(p.address_line2).trim() : ''
  const cityStateZip = [p.city, p.state, p.zip].filter(Boolean).join(' ')
  return [p.address_line1, line2, cityStateZip].filter(Boolean).join(', ') || '—'
}

function adminStatusFromRow(p) {
  const ls = String(p.listing_status || '').trim().toLowerCase()
  if (ls === 'rejected') return 'rejected'
  if (ls === 'changes_requested') return 'changes_requested'
  if (ls === 'live') return 'approved'
  if (ls === 'unlisted') return 'unlisted'
  return 'pending'
}

/**
 * Maps Supabase property rows to the same shape as {@link loadAdminPortalDataset} properties.
 * @param {object[]} rows
 */
export function mapSupabasePropertiesToAdminPortalRows(rows) {
  return (rows || []).map((raw) => {
    const name = String(raw.name || '').trim() || 'Untitled property'
    const st = adminStatusFromRow(raw)
    const notes = String(raw.notes || '')
    const minRent = 0
    return {
      id: String(raw.id || '').trim(),
      _supabase: raw,
      ownerId: String(raw.managed_by_app_user_id || raw.owned_by_app_user_id || '—'),
      name,
      address: formatAddress(raw),
      description: notes.length > 600 ? `${notes.slice(0, 600)}…` : notes || '—',
      status: st,
      submittedAt: raw.created_at || new Date().toISOString(),
      rentFrom: minRent,
      adminNotesInternal: String(raw.admin_internal_notes || '').trim(),
      adminNotesVisible: '',
      editRequestNotes: String(raw.edit_request_notes || '').trim(),
    }
  })
}

export async function fetchAdminPropertiesSupabaseList() {
  await syncAppUserFromSupabaseSession().catch(() => null)
  const headers = await bearerHeaders()
  const res = await fetch('/api/properties', { headers })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || `Could not load properties (${res.status}).`)
  const rows = Array.isArray(json.properties) ? json.properties : []
  return mapSupabasePropertiesToAdminPortalRows(rows)
}

async function patchProperty(id, body) {
  const headers = await bearerHeaders()
  const res = await fetch(`/api/properties?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || `Update failed (${res.status}).`)
  return json.property
}

export async function adminApprovePropertySupabase(recordId) {
  const id = String(recordId || '').trim()
  return patchProperty(id, {
    listing_status: 'live',
    active: true,
    edit_request_notes: null,
  })
}

export async function adminRejectPropertySupabase(recordId) {
  return patchProperty(String(recordId || '').trim(), {
    listing_status: 'rejected',
    active: false,
  })
}

export async function adminUnrejectPropertySupabase(recordId) {
  return patchProperty(String(recordId || '').trim(), {
    listing_status: 'pending_review',
    active: false,
  })
}

export async function adminUnlistPropertySupabase(recordId) {
  return patchProperty(String(recordId || '').trim(), {
    listing_status: 'unlisted',
    active: false,
  })
}

export async function adminRelistPropertySupabase(recordId) {
  return patchProperty(String(recordId || '').trim(), {
    listing_status: 'live',
    active: true,
  })
}

export async function adminRequestPropertyEditsSupabase(recordId, notes) {
  const text = String(notes || '').trim()
  return patchProperty(String(recordId || '').trim(), {
    listing_status: 'changes_requested',
    active: false,
    edit_request_notes: text || null,
  })
}

export async function adminSetPropertyInternalNotesSupabase(recordId, text) {
  return patchProperty(String(recordId || '').trim(), {
    admin_internal_notes: String(text ?? ''),
  })
}

export async function adminDeletePropertySupabase(recordId) {
  return adminRejectPropertySupabase(recordId)
}

/** Synthetic Airtable-shaped record for {@link PropertyDetailPanel}. */
export function buildAdminPropertyDetailSyntheticAirtable(property) {
  const raw = property?._supabase
  if (!raw || typeof raw !== 'object') return property?._airtable || null
  const addr = formatAddress(raw)
  const st = adminStatusFromRow(raw)
  const approval =
    st === 'pending'
      ? 'Pending'
      : st === 'changes_requested'
        ? 'Changes Requested'
        : st === 'approved'
          ? 'Approved'
          : st === 'unlisted'
            ? 'Unlisted'
            : st === 'rejected'
              ? 'Rejected'
              : 'Pending'
  return {
    id: raw.id,
    Name: raw.name,
    'Property Name': raw.name,
    Address: addr,
    Notes: raw.notes || '',
    'Other Info': raw.notes || '',
    Approved: raw.active === true && st === 'approved',
    Listed: raw.active === true && String(raw.listing_status || '') === 'live',
    'Approval Status': approval,
    Status: approval,
    'Internal Notes': raw.admin_internal_notes || '',
    [PROPERTY_EDIT_REQUEST_FIELD]: raw.edit_request_notes || '',
    'Room Count': '',
    created_at: raw.created_at,
  }
}

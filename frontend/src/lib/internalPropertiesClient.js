/**
 * Manager/admin: create properties and rooms via POST /api/properties and POST /api/rooms (Supabase JWT).
 *
 * @module
 */

import { supabase } from './supabase'
import { syncAppUserFromSupabaseSession, readAppUserBootstrap } from './authAppUserSync.js'
import { parseAxisListingMetaBlock } from './axisListingMeta.js'
import { PROPERTY_EDIT_REQUEST_FIELD } from './managerPropertyFormAirtableMap.js'

async function bearerHeaders() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('Sign in with your portal account to create properties.')
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

/**
 * Expects "Street, City, ST 12345" (last segment ST + ZIP). Throws with a clear message otherwise.
 * @param {string} raw
 */
export function parseWizardAddressForInternalApi(raw) {
  const s = String(raw || '').trim()
  if (!s) throw new Error('Street address is required.')
  const m = s.match(/^(.+),\s*([^,]+),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/)
  if (!m) {
    throw new Error(
      'Use a full mailing address on one line: Street, City, ST 12345 (example: 4709 8th Ave NE, Seattle, WA 98105).',
    )
  }
  return {
    address_line1: m[1].trim().slice(0, 500),
    city: m[2].trim().slice(0, 200),
    state: m[3].trim().toUpperCase().slice(0, 2),
    zip: m[4].trim().slice(0, 20),
  }
}

/** Whole dollars / common rent strings → integer cents (0 if unknown). */
export function rentStringToMonthlyRentCents(rent) {
  const digits = String(rent || '').replace(/[^0-9]/g, '')
  if (!digits) return 0
  const n = Number(digits)
  if (!Number.isFinite(n)) return 0
  return Math.min(99_000_000, Math.max(0, Math.round(n * 100)))
}

/**
 * @param {object} manager — Manager portal record (uses `id` as Airtable row id for Owner ID mapping).
 * @param {object} property — row from POST /api/properties
 */
export function mapInternalPropertyToManagerListRow(property, manager) {
  const p = property && typeof property === 'object' ? property : {}
  const addr = [p.address_line1, p.address_line2, [p.city, p.state, p.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  const name = String(p.name || '').trim() || 'Untitled property'
  const { meta } = parseAxisListingMetaBlock(String(p.notes || ''))
  const m = meta && typeof meta === 'object' ? meta : {}
  const roomDetails = Array.isArray(m.roomsDetail) ? m.roomsDetail : []
  const sharedDetail = Array.isArray(m.sharedSpacesDetail) ? m.sharedSpacesDetail : []
  const kitchensDetail = Array.isArray(m.kitchensDetail) ? m.kitchensDetail : []
  const bathroomsDetail = Array.isArray(m.bathroomsDetail) ? m.bathroomsDetail : []
  const roomCountDisplay = roomDetails.length > 0 ? roomDetails.length : null
  const lsRaw = String(p.listing_status || '').trim().toLowerCase()
  const ls =
    lsRaw ||
    (p.active === true || p.active === 1 ? 'live' : 'pending_review')
  const onPublicSite = ls === 'live' && p.active !== false && p.active !== 0
  const approvalMap = {
    pending_review: 'Pending',
    changes_requested: 'Changes Requested',
    live: 'Approved',
    unlisted: 'Unlisted',
    rejected: 'Rejected',
  }
  const approvalStatus = approvalMap[ls] || (onPublicSite ? 'Approved' : 'Pending')
  const adminApproved = ls !== 'pending_review' && ls !== 'rejected'
  const editNotes = String(p.edit_request_notes || '').trim()
  const internalNotes = String(p.admin_internal_notes || '').trim()
  return {
    id: String(p.id || '').trim(),
    Name: name,
    'Property Name': name,
    Address: addr,
    Approved: adminApproved,
    Listed: onPublicSite,
    'Approval Status': approvalStatus,
    Status: approvalStatus,
    'Owner ID': String(manager?.id || '').trim(),
    ...(internalNotes ? { 'Internal Notes': internalNotes } : {}),
    ...(editNotes ? { [PROPERTY_EDIT_REQUEST_FIELD]: editNotes } : {}),
    ...(roomCountDisplay != null ? { 'Room Count': roomCountDisplay } : {}),
    ...(bathroomsDetail.length ? { 'Bathroom Count': bathroomsDetail.length } : {}),
    ...(kitchensDetail.length ? { 'Kitchen Count': kitchensDetail.length } : {}),
    ...(sharedDetail.length ? { 'Number of Shared Spaces': sharedDetail.length } : {}),
    __axisInternalPostgres: true,
    __internalPostgresProperty: p,
  }
}

/**
 * @returns {Promise<object[]>} Raw `properties` rows from GET /api/properties, or [] when unauthenticated.
 */
export async function fetchInternalPropertiesListForSession() {
  await syncAppUserFromSupabaseSession().catch(() => null)
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) return []
  const res = await fetch('/api/properties', { headers: { Authorization: `Bearer ${token}` } })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) return []
  return Array.isArray(json.properties) ? json.properties : []
}

/**
 * @param {string} propertyId
 * @returns {Promise<object | null>}
 */
export async function fetchInternalPropertyById(propertyId) {
  const id = String(propertyId || '').trim()
  if (!id) return null
  await syncAppUserFromSupabaseSession().catch(() => null)
  const headers = await bearerHeaders().catch(() => null)
  if (!headers) return null
  const res = await fetch(`/api/properties?id=${encodeURIComponent(id)}`, { headers })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) return null
  return json.property || null
}

/**
 * @param {string} propertyId
 * @returns {Promise<object[]>}
 */
export async function fetchInternalRoomsForProperty(propertyId) {
  const pid = String(propertyId || '').trim()
  if (!pid) return []
  await syncAppUserFromSupabaseSession().catch(() => null)
  const headers = await bearerHeaders().catch(() => null)
  if (!headers) return []
  const res = await fetch(`/api/rooms?property_id=${encodeURIComponent(pid)}`, { headers })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) return []
  return Array.isArray(json.rooms) ? json.rooms : []
}

/**
 * PATCH internal property (UUID). Throws on error.
 * @param {string} propertyId
 * @param {Record<string, unknown>} body
 */
export async function patchInternalProperty(propertyId, body) {
  const id = String(propertyId || '').trim()
  if (!id) throw new Error('Property id is required.')
  const headers = await bearerHeaders()
  const res = await fetch(`/api/properties?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body && typeof body === 'object' ? body : {}),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || `Could not update property (${res.status}).`)
  return json.property
}

/**
 * @param {string} roomId
 * @param {Record<string, unknown>} body
 */
export async function patchInternalRoom(roomId, body) {
  const id = String(roomId || '').trim()
  if (!id) throw new Error('Room id is required.')
  const headers = await bearerHeaders()
  const res = await fetch(`/api/rooms?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body && typeof body === 'object' ? body : {}),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || `Could not update room (${res.status}).`)
  return json.room
}

/**
 * Create property + rooms. Caller should have already passed manager portal auth (Supabase session).
 *
 * @param {{
 *   basics: { name: string, address: string, pets?: string }
 *   rooms: Array<{ label?: string, rent?: string, notes?: string, utilities?: string }>
 *   manager: object
 *   notes?: string
 * }} args
 * @returns {Promise<{ property: object, rooms: object[], managerRow: object }>}
 */
export async function createInternalPropertyAndRooms(args) {
  await syncAppUserFromSupabaseSession().catch(() => null)
  const boot = readAppUserBootstrap()
  const appUserId = String(boot?.appUserId || '').trim()
  if (!appUserId) {
    throw new Error('Could not resolve your account. Sign out and back in, then try again.')
  }

  const { basics, rooms, manager, notes = '' } = args
  const name = String(basics?.name || '').trim()
  if (!name) throw new Error('Property name is required.')

  const { address_line1, city, state, zip } = parseWizardAddressForInternalApi(basics.address)

  const headers = await bearerHeaders()
  const body = {
    name,
    address_line1,
    city,
    state,
    zip,
    managed_by_app_user_id: appUserId,
    notes: String(notes || '').trim().slice(0, 20_000) || null,
  }

  const res = await fetch('/api/properties', { method: 'POST', headers, body: JSON.stringify(body) })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || `Could not create property (${res.status}).`)

  const property = json.property
  const propertyId = String(property?.id || '').trim()
  if (!propertyId) throw new Error('Server did not return a property id.')

  const createdRooms = []
  const list = Array.isArray(rooms) ? rooms : []
  for (let i = 0; i < list.length; i++) {
    const row = list[i] || {}
    const roomName = String(row.label || '').trim() || `Room ${i + 1}`
    const monthly_rent_cents = rentStringToMonthlyRentCents(row.rent)
    const descriptionParts = [row.utilities && `Utilities: ${row.utilities}`, row.notes && `Notes: ${row.notes}`].filter(Boolean)
    const description = descriptionParts.join('\n').trim() || null
    const rRes = await fetch('/api/rooms', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        property_id: propertyId,
        name: roomName,
        description,
        monthly_rent_cents,
      }),
    })
    const rJson = await rRes.json().catch(() => ({}))
    if (!rRes.ok) {
      throw new Error(rJson?.error || `Could not create room "${roomName}" (${rRes.status}).`)
    }
    if (rJson?.room) createdRooms.push(rJson.room)
  }

  const managerRow = mapInternalPropertyToManagerListRow(property, manager)
  return { property, rooms: createdRooms, managerRow }
}

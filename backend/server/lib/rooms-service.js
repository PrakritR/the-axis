/**
 * rooms — individual rentable units within a property (public.rooms).
 *
 * Writes are admin/manager-only (enforced in handlers). Reads scoped by RLS.
 *
 * @module
 */

import { requireServiceClient } from './app-users-service.js'

export const MAX_ROOM_NAME_LENGTH = 200
export const MAX_ROOM_DESCRIPTION_LENGTH = 2_000
export const MAX_ROOM_NOTES_LENGTH = 20_000

/**
 * @param {unknown} value
 * @param {number} maxLen
 * @param {string} fieldName
 * @returns {string | null}
 */
function normalizeNullableTextField(value, maxLen, fieldName) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string or null.`)
  }
  const s = value.trim()
  if (s.length > maxLen) {
    throw new Error(`${fieldName} exceeds max length (${maxLen}).`)
  }
  return s.length ? s : null
}

/**
 * @param {unknown} value
 * @param {string} fieldName
 * @returns {string}
 */
function requireNonEmptyString(value, maxLen, fieldName) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${fieldName} is required and must be a non-empty string.`)
  }
  const s = value.trim()
  if (s.length > maxLen) {
    throw new Error(`${fieldName} exceeds max length (${maxLen}).`)
  }
  return s
}

/**
 * Validates a non-negative integer (cents). Returns 0 if undefined/null.
 * @param {unknown} value
 * @param {string} fieldName
 * @returns {number}
 */
function normalizeNonNegativeCents(value, fieldName) {
  if (value === null || value === undefined) return 0
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${fieldName} must be a non-negative integer (cents).`)
  }
  return n
}

/**
 * @param {string} id
 * @returns {Promise<object | null>}
 */
export async function getRoomById(id) {
  const rid = String(id || '').trim()
  if (!rid) return null
  const client = requireServiceClient()
  const { data, error } = await client.from('rooms').select('*').eq('id', rid).maybeSingle()
  if (error) throw new Error(error.message || 'Failed to load room')
  return data || null
}

/**
 * Look up a room by property and name (case-insensitive). Returns the first match or null.
 *
 * @param {{ propertyId: string, name: string }} args
 * @returns {Promise<object | null>}
 */
export async function getRoomByPropertyAndName({ propertyId, name } = {}) {
  const pid = String(propertyId || '').trim()
  const n   = String(name || '').trim()
  if (!pid || !n) return null
  const client = requireServiceClient()
  const { data, error } = await client
    .from('rooms')
    .select('*')
    .eq('property_id', pid)
    .ilike('name', n)
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message || 'Failed to look up room by name')
  return data || null
}

/**
 * @param {{ propertyId: string, activeOnly?: boolean }} args
 * @returns {Promise<object[]>}
 */
export async function listRoomsByProperty({ propertyId, activeOnly = true } = {}) {
  const pid = String(propertyId || '').trim()
  if (!pid) throw new Error('listRoomsByProperty: propertyId is required.')
  const client = requireServiceClient()
  let query = client.from('rooms').select('*').eq('property_id', pid)
  if (activeOnly) query = query.eq('active', true)
  /** Creation order (wizard slot i maps to i-th created room; name order is unstable for "Room 10"). */
  query = query.order('created_at', { ascending: true })
  const { data, error } = await query
  if (error) throw new Error(error.message || 'Failed to list rooms')
  return data || []
}

/**
 * Create a room. Caller must verify admin/manager role before calling.
 *
 * @param {{
 *   property_id: string
 *   name: string
 *   description?: string | null
 *   monthly_rent_cents?: number
 *   utility_fee_cents?: number
 *   occupied_by_app_user_id?: string | null
 *   notes?: string | null
 * }} args
 * @returns {Promise<object>}
 */
export async function createRoom(args) {
  const propertyId = String(args.property_id || '').trim()
  if (!propertyId) throw new Error('createRoom: property_id is required.')

  const payload = {
    property_id: propertyId,
    name: requireNonEmptyString(args.name, MAX_ROOM_NAME_LENGTH, 'name'),
    monthly_rent_cents: normalizeNonNegativeCents(args.monthly_rent_cents, 'monthly_rent_cents'),
    utility_fee_cents: normalizeNonNegativeCents(args.utility_fee_cents, 'utility_fee_cents'),
  }

  if (args.description !== undefined) {
    payload.description = normalizeNullableTextField(args.description, MAX_ROOM_DESCRIPTION_LENGTH, 'description')
  }
  if ('occupied_by_app_user_id' in args) {
    payload.occupied_by_app_user_id = args.occupied_by_app_user_id || null
  }
  if (args.notes !== undefined) {
    payload.notes = normalizeNullableTextField(args.notes, MAX_ROOM_NOTES_LENGTH, 'notes')
  }

  const client = requireServiceClient()
  const { data, error } = await client.from('rooms').insert(payload).select('*').single()
  if (error) throw new Error(error.message || 'Failed to create room')
  return data
}

/**
 * Partial update. Caller must verify admin/manager role before calling.
 *
 * @param {{
 *   id: string
 *   name?: string
 *   description?: string | null
 *   monthly_rent_cents?: number
 *   utility_fee_cents?: number
 *   occupied_by_app_user_id?: string | null
 *   active?: boolean
 *   notes?: string | null
 * }} args
 * @returns {Promise<object>}
 */
export async function updateRoom(args) {
  const id = String(args.id || '').trim()
  if (!id) throw new Error('updateRoom: id is required.')

  const updates = {}
  if (args.name !== undefined) updates.name = requireNonEmptyString(args.name, MAX_ROOM_NAME_LENGTH, 'name')
  if (args.description !== undefined) {
    updates.description = normalizeNullableTextField(args.description, MAX_ROOM_DESCRIPTION_LENGTH, 'description')
  }
  if (args.monthly_rent_cents !== undefined) {
    updates.monthly_rent_cents = normalizeNonNegativeCents(args.monthly_rent_cents, 'monthly_rent_cents')
  }
  if (args.utility_fee_cents !== undefined) {
    updates.utility_fee_cents = normalizeNonNegativeCents(args.utility_fee_cents, 'utility_fee_cents')
  }
  if ('occupied_by_app_user_id' in args) {
    updates.occupied_by_app_user_id = args.occupied_by_app_user_id || null
  }
  if (args.active !== undefined) {
    if (typeof args.active !== 'boolean') throw new Error('active must be a boolean.')
    updates.active = args.active
  }
  if (args.notes !== undefined) {
    updates.notes = normalizeNullableTextField(args.notes, MAX_ROOM_NOTES_LENGTH, 'notes')
  }

  if (Object.keys(updates).length === 0) {
    throw new Error('updateRoom: at least one field must be provided to update.')
  }

  const client = requireServiceClient()
  const { data, error } = await client.from('rooms').update(updates).eq('id', id).select('*').single()
  if (error) throw new Error(error.message || 'Failed to update room')
  return data
}

/**
 * properties — physical rental properties (public.properties).
 *
 * Writes are admin/manager-only (enforced in handlers). Reads scoped by RLS.
 *
 * @module
 */

import { requireServiceClient } from './app-users-service.js'
import { appUserHasRole } from './app-user-roles-service.js'

export const OWNERSHIP_TYPE_PERSONAL = 'Personal'
export const OWNERSHIP_TYPE_THIRD_PARTY = 'Third-Party Managed'
export const OWNERSHIP_TYPE_VALUES = [OWNERSHIP_TYPE_PERSONAL, OWNERSHIP_TYPE_THIRD_PARTY]

export const MAX_PROPERTY_NAME_LENGTH = 500
export const MAX_PROPERTY_ADDRESS_LENGTH = 500
export const MAX_PROPERTY_CITY_LENGTH = 200
export const MAX_PROPERTY_STATE_LENGTH = 100
export const MAX_PROPERTY_ZIP_LENGTH = 20
export const MAX_PROPERTY_NOTES_LENGTH = 20_000
export const MAX_LEGACY_AIRTABLE_RECORD_ID_LENGTH = 32
export const MAX_PROPERTY_ADMIN_NOTES_LENGTH = 20_000

export const LISTING_STATUS_PENDING_REVIEW = 'pending_review'
export const LISTING_STATUS_CHANGES_REQUESTED = 'changes_requested'
export const LISTING_STATUS_LIVE = 'live'
export const LISTING_STATUS_UNLISTED = 'unlisted'
export const LISTING_STATUS_REJECTED = 'rejected'

export const LISTING_STATUS_VALUES = [
  LISTING_STATUS_PENDING_REVIEW,
  LISTING_STATUS_CHANGES_REQUESTED,
  LISTING_STATUS_LIVE,
  LISTING_STATUS_UNLISTED,
  LISTING_STATUS_REJECTED,
]

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
 * @param {unknown} value
 * @returns {string}
 */
/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeListingStatus(value) {
  if (value === null || value === undefined) return LISTING_STATUS_PENDING_REVIEW
  if (typeof value !== 'string') {
    throw new Error('listing_status must be a string.')
  }
  const s = value.trim()
  const match = LISTING_STATUS_VALUES.find((v) => v.toLowerCase() === s.toLowerCase())
  if (!match) {
    throw new Error(`listing_status must be one of: ${LISTING_STATUS_VALUES.join(' | ')}.`)
  }
  return match
}

export function normalizeOwnershipType(value) {
  if (value === null || value === undefined) return OWNERSHIP_TYPE_PERSONAL
  if (typeof value !== 'string') {
    throw new Error('ownership_type must be a string.')
  }
  const s = value.trim()
  const match = OWNERSHIP_TYPE_VALUES.find((v) => v.toLowerCase() === s.toLowerCase())
  if (!match) {
    throw new Error(`ownership_type must be one of: ${OWNERSHIP_TYPE_VALUES.join(' | ')}.`)
  }
  return match
}

/**
 * @param {string} id
 * @returns {Promise<object | null>}
 */
export async function getPropertyById(id) {
  const pid = String(id || '').trim()
  if (!pid) return null
  const client = requireServiceClient()
  const { data, error } = await client.from('properties').select('*').eq('id', pid).maybeSingle()
  if (error) throw new Error(error.message || 'Failed to load property')
  return data || null
}

/**
 * Look up a property by exact name (case-insensitive). Returns the first match or null.
 *
 * @param {string} name
 * @returns {Promise<object | null>}
 */
export async function getPropertyByName(name) {
  const n = String(name || '').trim()
  if (!n) return null
  const client = requireServiceClient()
  const { data, error } = await client
    .from('properties')
    .select('*')
    .ilike('name', n)
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(error.message || 'Failed to look up property by name')
  return data || null
}

/**
 * @param {string} legacyId Airtable record id (rec…)
 * @returns {Promise<object | null>}
 */
export async function getPropertyByLegacyAirtableRecordId(legacyId) {
  const rid = String(legacyId || '').trim()
  if (!rid || !/^rec[a-zA-Z0-9]{14,}$/.test(rid)) return null
  const client = requireServiceClient()
  const { data, error } = await client
    .from('properties')
    .select('*')
    .eq('legacy_airtable_record_id', rid)
    .maybeSingle()
  if (error) throw new Error(error.message || 'Failed to look up property by legacy id')
  return data || null
}

/**
 * @param {{ managedByAppUserId?: string, ownedByAppUserId?: string, activeOnly?: boolean }} filters
 * @returns {Promise<object[]>}
 */
export async function listProperties({
  managedByAppUserId,
  ownedByAppUserId,
  activeOnly = true,
  listingStatus,
} = {}) {
  const client = requireServiceClient()
  let query = client.from('properties').select('*')
  if (activeOnly) query = query.eq('active', true)
  if (listingStatus) query = query.eq('listing_status', listingStatus)
  if (managedByAppUserId) query = query.eq('managed_by_app_user_id', managedByAppUserId)
  if (ownedByAppUserId) query = query.eq('owned_by_app_user_id', ownedByAppUserId)
  query = query.order('name')
  const { data, error } = await query
  if (error) throw new Error(error.message || 'Failed to list properties')
  return data || []
}

/**
 * Properties shown on the public marketing site and tour picker.
 * @returns {Promise<object[]>}
 */
export async function listPublicMarketingProperties() {
  return listProperties({ activeOnly: true, listingStatus: LISTING_STATUS_LIVE })
}

/**
 * Create a property. Caller must verify admin/manager role before calling.
 *
 * @param {{
 *   name: string
 *   address_line1: string
 *   address_line2?: string | null
 *   city: string
 *   state: string
 *   zip: string
 *   ownership_type?: string
 *   owned_by_app_user_id?: string | null
 *   managed_by_app_user_id?: string | null
 *   notes?: string | null
 *   active?: boolean
 *   legacy_airtable_record_id?: string | null
 *   listing_status?: string
 *   admin_internal_notes?: string | null
 *   edit_request_notes?: string | null
 * }} args
 * @returns {Promise<object>}
 */
export async function createProperty(args) {
  const payload = {
    name: requireNonEmptyString(args.name, MAX_PROPERTY_NAME_LENGTH, 'name'),
    address_line1: requireNonEmptyString(args.address_line1, MAX_PROPERTY_ADDRESS_LENGTH, 'address_line1'),
    city: requireNonEmptyString(args.city, MAX_PROPERTY_CITY_LENGTH, 'city'),
    state: requireNonEmptyString(args.state, MAX_PROPERTY_STATE_LENGTH, 'state'),
    zip: requireNonEmptyString(args.zip, MAX_PROPERTY_ZIP_LENGTH, 'zip'),
    ownership_type: normalizeOwnershipType(args.ownership_type),
    listing_status: normalizeListingStatus(args.listing_status ?? LISTING_STATUS_PENDING_REVIEW),
  }

  if (args.address_line2 !== undefined) {
    payload.address_line2 = normalizeNullableTextField(
      args.address_line2,
      MAX_PROPERTY_ADDRESS_LENGTH,
      'address_line2',
    )
  }
  if (args.owned_by_app_user_id !== undefined) {
    payload.owned_by_app_user_id = args.owned_by_app_user_id || null
  }
  if (args.managed_by_app_user_id !== undefined) {
    payload.managed_by_app_user_id = args.managed_by_app_user_id || null
  }
  if (args.notes !== undefined) {
    payload.notes = normalizeNullableTextField(args.notes, MAX_PROPERTY_NOTES_LENGTH, 'notes')
  }
  if (args.legacy_airtable_record_id !== undefined) {
    payload.legacy_airtable_record_id = normalizeNullableTextField(
      args.legacy_airtable_record_id,
      MAX_LEGACY_AIRTABLE_RECORD_ID_LENGTH,
      'legacy_airtable_record_id',
    )
  }

  if (args.admin_internal_notes !== undefined) {
    payload.admin_internal_notes = normalizeNullableTextField(
      args.admin_internal_notes,
      MAX_PROPERTY_ADMIN_NOTES_LENGTH,
      'admin_internal_notes',
    )
  }
  if (args.edit_request_notes !== undefined) {
    payload.edit_request_notes = normalizeNullableTextField(
      args.edit_request_notes,
      MAX_PROPERTY_ADMIN_NOTES_LENGTH,
      'edit_request_notes',
    )
  }

  if (args.active !== undefined) {
    if (typeof args.active !== 'boolean') throw new Error('active must be a boolean.')
    payload.active = args.active
  } else {
    /** Draft by default until explicitly listed / activated (avoids public listing exposure). */
    payload.active = false
  }

  const client = requireServiceClient()
  const { data, error } = await client.from('properties').insert(payload).select('*').single()
  if (error) throw new Error(error.message || 'Failed to create property')
  return data
}

/**
 * Partial update. Caller must verify admin/manager role before calling.
 *
 * @param {{
 *   id: string
 *   name?: string
 *   address_line1?: string
 *   address_line2?: string | null
 *   city?: string
 *   state?: string
 *   zip?: string
 *   ownership_type?: string
 *   owned_by_app_user_id?: string | null
 *   managed_by_app_user_id?: string | null
 *   notes?: string | null
 *   active?: boolean
 *   legacy_airtable_record_id?: string | null
 *   listing_status?: string
 *   admin_internal_notes?: string | null
 *   edit_request_notes?: string | null
 * }} args
 * @returns {Promise<object>}
 */
export async function updateProperty(args) {
  const id = String(args.id || '').trim()
  if (!id) throw new Error('updateProperty: id is required.')

  const updates = {}
  if (args.name !== undefined) updates.name = requireNonEmptyString(args.name, MAX_PROPERTY_NAME_LENGTH, 'name')
  if (args.address_line1 !== undefined) {
    updates.address_line1 = requireNonEmptyString(args.address_line1, MAX_PROPERTY_ADDRESS_LENGTH, 'address_line1')
  }
  if (args.address_line2 !== undefined) {
    updates.address_line2 = normalizeNullableTextField(
      args.address_line2,
      MAX_PROPERTY_ADDRESS_LENGTH,
      'address_line2',
    )
  }
  if (args.city !== undefined) updates.city = requireNonEmptyString(args.city, MAX_PROPERTY_CITY_LENGTH, 'city')
  if (args.state !== undefined) updates.state = requireNonEmptyString(args.state, MAX_PROPERTY_STATE_LENGTH, 'state')
  if (args.zip !== undefined) updates.zip = requireNonEmptyString(args.zip, MAX_PROPERTY_ZIP_LENGTH, 'zip')
  if (args.ownership_type !== undefined) updates.ownership_type = normalizeOwnershipType(args.ownership_type)
  if ('owned_by_app_user_id' in args) updates.owned_by_app_user_id = args.owned_by_app_user_id || null
  if ('managed_by_app_user_id' in args) updates.managed_by_app_user_id = args.managed_by_app_user_id || null
  if (args.notes !== undefined) {
    updates.notes = normalizeNullableTextField(args.notes, MAX_PROPERTY_NOTES_LENGTH, 'notes')
  }
  if (args.active !== undefined) {
    if (typeof args.active !== 'boolean') throw new Error('active must be a boolean.')
    updates.active = args.active
  }
  if (args.legacy_airtable_record_id !== undefined) {
    updates.legacy_airtable_record_id = normalizeNullableTextField(
      args.legacy_airtable_record_id,
      MAX_LEGACY_AIRTABLE_RECORD_ID_LENGTH,
      'legacy_airtable_record_id',
    )
  }
  if (args.listing_status !== undefined) {
    updates.listing_status = normalizeListingStatus(args.listing_status)
  }
  if (args.admin_internal_notes !== undefined) {
    updates.admin_internal_notes = normalizeNullableTextField(
      args.admin_internal_notes,
      MAX_PROPERTY_ADMIN_NOTES_LENGTH,
      'admin_internal_notes',
    )
  }
  if (args.edit_request_notes !== undefined) {
    updates.edit_request_notes = normalizeNullableTextField(
      args.edit_request_notes,
      MAX_PROPERTY_ADMIN_NOTES_LENGTH,
      'edit_request_notes',
    )
  }

  if (Object.keys(updates).length === 0) {
    throw new Error('updateProperty: at least one field must be provided to update.')
  }

  const client = requireServiceClient()
  const { data, error } = await client.from('properties').update(updates).eq('id', id).select('*').single()
  if (error) throw new Error(error.message || 'Failed to update property')
  return data
}

// ─── Authorization helpers ────────────────────────────────────────────────────

/**
 * Verify that an app_user is admin OR manages the given property.
 * Throws a 403-style error if access is denied.
 *
 * @param {string} propertyId
 * @param {string} appUserId
 * @returns {Promise<object>} the property row (caller may reuse it)
 */
export async function requirePropertyManagerAccess(propertyId, appUserId) {
  const property = await getPropertyById(propertyId)
  if (!property) throw Object.assign(new Error('Property not found.'), { statusCode: 404 })

  const isAdmin = await appUserHasRole(appUserId, 'admin')
  if (isAdmin) return property

  const isManager = await appUserHasRole(appUserId, 'manager')
  if (isManager && property.managed_by_app_user_id === appUserId) return property

  throw Object.assign(new Error('You do not manage this property.'), { statusCode: 403 })
}

/**
 * Verify that an app_user is admin OR owns the given property.
 * Throws a 403-style error if access is denied.
 *
 * @param {string} propertyId
 * @param {string} appUserId
 * @returns {Promise<object>} the property row
 */
export async function requirePropertyOwnerAccess(propertyId, appUserId) {
  const property = await getPropertyById(propertyId)
  if (!property) throw Object.assign(new Error('Property not found.'), { statusCode: 404 })

  const isAdmin = await appUserHasRole(appUserId, 'admin')
  if (isAdmin) return property

  const isOwner = await appUserHasRole(appUserId, 'owner')
  if (isOwner && property.owned_by_app_user_id === appUserId) return property

  throw Object.assign(new Error('You do not own this property.'), { statusCode: 403 })
}

/**
 * Verify that an app_user can read the given property (manager, owner, or admin).
 * Throws a 403-style error if access is denied.
 *
 * @param {string} propertyId
 * @param {string} appUserId
 * @returns {Promise<object>} the property row
 */
export async function requirePropertyReadAccess(propertyId, appUserId) {
  const property = await getPropertyById(propertyId)
  if (!property) throw Object.assign(new Error('Property not found.'), { statusCode: 404 })

  const [isAdmin, isManager, isOwner] = await Promise.all([
    appUserHasRole(appUserId, 'admin'),
    appUserHasRole(appUserId, 'manager'),
    appUserHasRole(appUserId, 'owner'),
  ])

  if (isAdmin) return property
  if (isManager && property.managed_by_app_user_id === appUserId) return property
  if (isOwner && property.owned_by_app_user_id === appUserId) return property

  throw Object.assign(new Error('Access denied.'), { statusCode: 403 })
}

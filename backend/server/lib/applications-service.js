/**
 * applications — rental application records (public.applications).
 *
 * Permission model (enforced in handlers, not here):
 *   - Any authenticated app_user may create an application for themselves.
 *   - Applicant may update own drafts (status: draft | submitted).
 *   - Manager/admin may update any application.
 *   - Only manager/admin may approve or reject.
 *
 * Duplicate prevention:
 *   DB enforces unique active slot per (applicant, property, room, lease_start_date) via partial index.
 *   Service layer catches error code 23505 and re-throws with a clear message.
 *
 * @module
 */

import { requireServiceClient } from './app-users-service.js'
import { getPropertyByName, listProperties } from './properties-service.js'
import { getRoomByPropertyAndName } from './rooms-service.js'

/** PostgREST embed — keep aligned with {@link ../../../shared/application-legacy-map.js}. */
export const APPLICATIONS_JOIN_SELECT = `
  *,
  property:properties!applications_property_id_fkey(
    id,
    name,
    managed_by_app_user_id,
    owned_by_app_user_id,
    address_line1,
    address_line2,
    city,
    state,
    zip
  ),
  room:rooms!applications_room_id_fkey(id,name)
`

export const APPLICATION_STATUS_DRAFT       = 'draft'
export const APPLICATION_STATUS_SUBMITTED   = 'submitted'
export const APPLICATION_STATUS_UNDER_REVIEW = 'under_review'
export const APPLICATION_STATUS_APPROVED    = 'approved'
export const APPLICATION_STATUS_REJECTED    = 'rejected'
export const APPLICATION_STATUS_CANCELLED   = 'cancelled'

export const APPLICATION_STATUS_VALUES = [
  APPLICATION_STATUS_DRAFT,
  APPLICATION_STATUS_SUBMITTED,
  APPLICATION_STATUS_UNDER_REVIEW,
  APPLICATION_STATUS_APPROVED,
  APPLICATION_STATUS_REJECTED,
  APPLICATION_STATUS_CANCELLED,
]

/** Statuses that an applicant may move to themselves. */
const APPLICANT_WRITABLE_STATUSES = [APPLICATION_STATUS_DRAFT, APPLICATION_STATUS_SUBMITTED, APPLICATION_STATUS_CANCELLED]

/**
 * @param {unknown} status
 * @returns {string}
 */
export function normalizeApplicationStatus(status) {
  if (status === null || status === undefined) return APPLICATION_STATUS_DRAFT
  const s = String(status).trim().toLowerCase()
  const match = APPLICATION_STATUS_VALUES.find((v) => v === s)
  if (!match) {
    throw new Error(`Invalid application status "${status}". Must be one of: ${APPLICATION_STATUS_VALUES.join(' | ')}.`)
  }
  return match
}

/**
 * @param {unknown} value
 * @param {number} maxLen
 * @param {string} fieldName
 * @returns {string | null}
 */
function normalizeNullableTextField(value, maxLen, fieldName) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new Error(`${fieldName} must be a string or null.`)
  const s = value.trim()
  if (s.length > maxLen) throw new Error(`${fieldName} exceeds max length (${maxLen}).`)
  return s.length ? s : null
}

/**
 * @param {unknown} value
 * @param {string} fieldName
 * @returns {number | null}
 */
function normalizeNullableNonNegativeInt(value, fieldName) {
  if (value === null || value === undefined) return null
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0) throw new Error(`${fieldName} must be a non-negative integer.`)
  return n
}

/**
 * @param {unknown} value
 * @param {string} fieldName
 * @returns {boolean | null}
 */
function normalizeNullableBoolean(value, fieldName) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'boolean') throw new Error(`${fieldName} must be a boolean.`)
  return value
}

/**
 * @param {unknown} value
 * @param {string} fieldName
 * @returns {string | null} ISO date string or null
 */
function normalizeNullableDate(value, fieldName) {
  if (value === null || value === undefined) return null
  const s = String(value).trim()
  if (!s) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`${fieldName} must be a date in YYYY-MM-DD format.`)
  return s
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeNullableEmail(value) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new Error('signer_email must be a string or null.')
  const s = value.trim().toLowerCase()
  if (!s) return null
  if (!s.includes('@')) throw new Error('signer_email does not look like a valid email address.')
  return s
}

/**
 * Build a payload object from raw args, mapping all known application fields.
 * Only keys explicitly present in args are included (undefined = omit).
 */
function buildPayload(args, { requireCore = false } = {}) {
  const p = {}

  if (requireCore) {
    const appUserId = String(args.applicant_app_user_id || '').trim()
    const propertyId = String(args.property_id || '').trim()
    if (!appUserId) throw new Error('applicant_app_user_id is required.')
    if (!propertyId) throw new Error('property_id is required.')
    p.applicant_app_user_id = appUserId
    p.property_id = propertyId
  }

  if (args.room_id !== undefined)           p.room_id = args.room_id || null
  if (args.status  !== undefined)           p.status  = normalizeApplicationStatus(args.status)

  // signer fields
  if (args.signer_full_name !== undefined)           p.signer_full_name           = normalizeNullableTextField(args.signer_full_name, 500, 'signer_full_name')
  if (args.signer_email !== undefined)               p.signer_email               = normalizeNullableEmail(args.signer_email)
  if (args.signer_phone_number !== undefined)        p.signer_phone_number        = normalizeNullableTextField(args.signer_phone_number, 40, 'signer_phone_number')
  if (args.signer_date_of_birth !== undefined)       p.signer_date_of_birth       = normalizeNullableDate(args.signer_date_of_birth, 'signer_date_of_birth')
  if (args.signer_ssn_last4 !== undefined)           p.signer_ssn_last4           = normalizeNullableTextField(args.signer_ssn_last4, 4, 'signer_ssn_last4')
  if (args.signer_drivers_license_number !== undefined) p.signer_drivers_license_number = normalizeNullableTextField(args.signer_drivers_license_number, 100, 'signer_drivers_license_number')

  // lease
  if (args.lease_term !== undefined)       p.lease_term       = normalizeNullableTextField(args.lease_term, 200, 'lease_term')
  if (args.month_to_month !== undefined)   p.month_to_month   = normalizeNullableBoolean(args.month_to_month, 'month_to_month') ?? false
  if (args.lease_start_date !== undefined) p.lease_start_date = normalizeNullableDate(args.lease_start_date, 'lease_start_date')
  if (args.lease_end_date !== undefined)   p.lease_end_date   = normalizeNullableDate(args.lease_end_date, 'lease_end_date')

  // current address
  if (args.current_address !== undefined) p.current_address = normalizeNullableTextField(args.current_address, 500, 'current_address')
  if (args.current_city    !== undefined) p.current_city    = normalizeNullableTextField(args.current_city, 200, 'current_city')
  if (args.current_state   !== undefined) p.current_state   = normalizeNullableTextField(args.current_state, 100, 'current_state')
  if (args.current_zip     !== undefined) p.current_zip     = normalizeNullableTextField(args.current_zip, 20, 'current_zip')

  // employment
  if (args.employer_name          !== undefined) p.employer_name          = normalizeNullableTextField(args.employer_name, 500, 'employer_name')
  if (args.employer_address       !== undefined) p.employer_address       = normalizeNullableTextField(args.employer_address, 500, 'employer_address')
  if (args.supervisor_name        !== undefined) p.supervisor_name        = normalizeNullableTextField(args.supervisor_name, 500, 'supervisor_name')
  if (args.supervisor_phone       !== undefined) p.supervisor_phone       = normalizeNullableTextField(args.supervisor_phone, 40, 'supervisor_phone')
  if (args.job_title              !== undefined) p.job_title              = normalizeNullableTextField(args.job_title, 200, 'job_title')
  if (args.monthly_income_cents   !== undefined) p.monthly_income_cents   = normalizeNullableNonNegativeInt(args.monthly_income_cents, 'monthly_income_cents')
  if (args.annual_income_cents    !== undefined) p.annual_income_cents    = normalizeNullableNonNegativeInt(args.annual_income_cents, 'annual_income_cents')
  if (args.employment_start_date  !== undefined) p.employment_start_date  = normalizeNullableDate(args.employment_start_date, 'employment_start_date')
  if (args.other_income_notes     !== undefined) p.other_income_notes     = normalizeNullableTextField(args.other_income_notes, 5000, 'other_income_notes')

  // references
  if (args.reference_1_name         !== undefined) p.reference_1_name         = normalizeNullableTextField(args.reference_1_name, 500, 'reference_1_name')
  if (args.reference_1_relationship !== undefined) p.reference_1_relationship = normalizeNullableTextField(args.reference_1_relationship, 200, 'reference_1_relationship')
  if (args.reference_1_phone        !== undefined) p.reference_1_phone        = normalizeNullableTextField(args.reference_1_phone, 40, 'reference_1_phone')
  if (args.reference_2_name         !== undefined) p.reference_2_name         = normalizeNullableTextField(args.reference_2_name, 500, 'reference_2_name')
  if (args.reference_2_relationship !== undefined) p.reference_2_relationship = normalizeNullableTextField(args.reference_2_relationship, 200, 'reference_2_relationship')
  if (args.reference_2_phone        !== undefined) p.reference_2_phone        = normalizeNullableTextField(args.reference_2_phone, 40, 'reference_2_phone')

  // occupancy
  if (args.number_of_occupants !== undefined) p.number_of_occupants = normalizeNullableNonNegativeInt(args.number_of_occupants, 'number_of_occupants')
  if (args.pets_notes          !== undefined) p.pets_notes          = normalizeNullableTextField(args.pets_notes, 2000, 'pets_notes')
  if (args.eviction_history    !== undefined) p.eviction_history    = normalizeNullableTextField(args.eviction_history, 5000, 'eviction_history')
  if (args.bankruptcy_history  !== undefined) p.bankruptcy_history  = normalizeNullableTextField(args.bankruptcy_history, 5000, 'bankruptcy_history')
  if (args.criminal_history    !== undefined) p.criminal_history    = normalizeNullableTextField(args.criminal_history, 5000, 'criminal_history')

  // consent / signature
  if (args.has_cosigner                    !== undefined) p.has_cosigner                    = normalizeNullableBoolean(args.has_cosigner, 'has_cosigner') ?? false
  if (args.consent_credit_background_check !== undefined) p.consent_credit_background_check = normalizeNullableBoolean(args.consent_credit_background_check, 'consent_credit_background_check') ?? false
  if (args.signer_signature               !== undefined) p.signer_signature               = normalizeNullableTextField(args.signer_signature, 2000, 'signer_signature')
  if (args.signer_date_signed             !== undefined) p.signer_date_signed             = normalizeNullableDate(args.signer_date_signed, 'signer_date_signed')
  if (args.additional_notes              !== undefined) p.additional_notes               = normalizeNullableTextField(args.additional_notes, 20000, 'additional_notes')

  // group
  if (args.group_apply   !== undefined) p.group_apply   = normalizeNullableBoolean(args.group_apply, 'group_apply') ?? false
  if (args.group_size    !== undefined) p.group_size    = normalizeNullableNonNegativeInt(args.group_size, 'group_size')
  if (args.axis_group_id !== undefined) p.axis_group_id = normalizeNullableTextField(args.axis_group_id, 200, 'axis_group_id')
  if (args.room_choice_2 !== undefined) p.room_choice_2 = normalizeNullableTextField(args.room_choice_2, 200, 'room_choice_2')
  if (args.room_choice_3 !== undefined) p.room_choice_3 = normalizeNullableTextField(args.room_choice_3, 200, 'room_choice_3')

  // payment fields (manager/admin only — not validated here, handlers guard)
  if (args.application_fee_paid        !== undefined) p.application_fee_paid        = normalizeNullableBoolean(args.application_fee_paid, 'application_fee_paid') ?? false
  if (args.application_fee_due_cents   !== undefined) p.application_fee_due_cents   = normalizeNullableNonNegativeInt(args.application_fee_due_cents, 'application_fee_due_cents')
  if (args.stripe_checkout_session_id  !== undefined) p.stripe_checkout_session_id  = normalizeNullableTextField(args.stripe_checkout_session_id, 300, 'stripe_checkout_session_id')
  if (args.stripe_payment_intent_id    !== undefined) p.stripe_payment_intent_id    = normalizeNullableTextField(args.stripe_payment_intent_id, 300, 'stripe_payment_intent_id')

  // lease doc fields (manager/admin only)
  if (args.lease_token      !== undefined) p.lease_token      = normalizeNullableTextField(args.lease_token, 500, 'lease_token')
  if (args.lease_status     !== undefined) p.lease_status     = normalizeNullableTextField(args.lease_status, 100, 'lease_status')
  if (args.lease_signed     !== undefined) p.lease_signed     = normalizeNullableBoolean(args.lease_signed, 'lease_signed') ?? false
  if (args.lease_signed_date !== undefined) p.lease_signed_date = normalizeNullableDate(args.lease_signed_date, 'lease_signed_date')
  if (args.lease_signature  !== undefined) p.lease_signature  = normalizeNullableTextField(args.lease_signature, 2000, 'lease_signature')
  if (args.approved_unit_room !== undefined) p.approved_unit_room = normalizeNullableTextField(args.approved_unit_room, 200, 'approved_unit_room')

  return p
}

// ─── Reads ────────────────────────────────────────────────────────────────────

/**
 * @param {string} id
 * @returns {Promise<object | null>}
 */
export async function getApplicationById(id) {
  const aid = String(id || '').trim()
  if (!aid) return null
  const client = requireServiceClient()
  const { data, error } = await client.from('applications').select(APPLICATIONS_JOIN_SELECT).eq('id', aid).maybeSingle()
  if (error) throw new Error(error.message || 'Failed to load application')
  return data || null
}

/**
 * List applications belonging to a specific app_user.
 *
 * @param {{ appUserId: string, status?: string }} args
 * @returns {Promise<object[]>}
 */
export async function listApplicationsForAppUser({ appUserId, status } = {}) {
  const id = String(appUserId || '').trim()
  if (!id) throw new Error('listApplicationsForAppUser: appUserId is required.')
  const client = requireServiceClient()
  let query = client.from('applications').select(APPLICATIONS_JOIN_SELECT).eq('applicant_app_user_id', id)
  if (status) query = query.eq('status', normalizeApplicationStatus(status))
  query = query.order('created_at', { ascending: false })
  const { data, error } = await query
  if (error) throw new Error(error.message || 'Failed to list applications')
  return data || []
}

/**
 * Applications for every property managed by the given app_user (service client).
 *
 * @param {{ managerAppUserId: string, status?: string, limit?: number }} args
 * @returns {Promise<object[]>}
 */
export async function listApplicationsForManagedProperties({ managerAppUserId, status, limit = 1500 } = {}) {
  const mid = String(managerAppUserId || '').trim()
  if (!mid) throw new Error('listApplicationsForManagedProperties: managerAppUserId is required.')

  const props = await listProperties({ managedByAppUserId: mid, activeOnly: false })
  const pids = [...new Set((props || []).map((p) => String(p?.id || '').trim()).filter(Boolean))]
  if (!pids.length) return []

  const client = requireServiceClient()
  let query = client.from('applications').select(APPLICATIONS_JOIN_SELECT).in('property_id', pids)
  if (status) query = query.eq('status', normalizeApplicationStatus(status))
  query = query.order('created_at', { ascending: false }).limit(Math.min(Math.max(Number(limit) || 1500, 1), 5000))
  const { data, error } = await query
  if (error) throw new Error(error.message || 'Failed to list applications')
  return data || []
}

/**
 * All applications (admin tooling; service client).
 *
 * @param {{ status?: string, limit?: number }} args
 * @returns {Promise<object[]>}
 */
export async function listApplicationsForAdmin({ status, limit = 2500 } = {}) {
  const client = requireServiceClient()
  let query = client.from('applications').select(APPLICATIONS_JOIN_SELECT)
  if (status) query = query.eq('status', normalizeApplicationStatus(status))
  query = query.order('created_at', { ascending: false }).limit(Math.min(Math.max(Number(limit) || 2500, 1), 8000))
  const { data, error } = await query
  if (error) throw new Error(error.message || 'Failed to list applications')
  return data || []
}

/**
 * List applications for a property (manager/owner/admin scope).
 *
 * @param {{ propertyId: string, status?: string }} args
 * @returns {Promise<object[]>}
 */
export async function listApplicationsForProperty({ propertyId, status } = {}) {
  const pid = String(propertyId || '').trim()
  if (!pid) throw new Error('listApplicationsForProperty: propertyId is required.')
  const client = requireServiceClient()
  let query = client.from('applications').select(APPLICATIONS_JOIN_SELECT).eq('property_id', pid)
  if (status) query = query.eq('status', normalizeApplicationStatus(status))
  query = query.order('created_at', { ascending: false })
  const { data, error } = await query
  if (error) throw new Error(error.message || 'Failed to list applications')
  return data || []
}

// ─── Writes ───────────────────────────────────────────────────────────────────

/**
 * Create a new application. Any authenticated app_user may create for themselves.
 *
 * @param {{
 *   applicant_app_user_id: string
 *   property_id: string
 *   [key: string]: unknown
 * }} args
 * @returns {Promise<object>}
 */
export async function createApplication(args) {
  const payload = buildPayload(args, { requireCore: true })
  if (!payload.status) payload.status = APPLICATION_STATUS_DRAFT

  const client = requireServiceClient()
  const { data, error } = await client.from('applications').insert(payload).select(APPLICATIONS_JOIN_SELECT).single()

  if (error?.code === '23505') {
    throw new Error(
      'An active application already exists for this applicant, property, room, and lease start date. ' +
      'Cancel the existing application before creating a new one.',
    )
  }
  if (error) throw new Error(error.message || 'Failed to create application')
  return data
}

/**
 * Partial update. Call after verifying caller has permission.
 *
 * @param {{ id: string, [key: string]: unknown }} args
 * @returns {Promise<object>}
 */
export async function updateApplication(args) {
  const id = String(args.id || '').trim()
  if (!id) throw new Error('updateApplication: id is required.')

  const updates = buildPayload(args)
  if (Object.keys(updates).length === 0) {
    throw new Error('updateApplication: at least one field must be provided to update.')
  }

  const client = requireServiceClient()
  const { data, error } = await client.from('applications').update(updates).eq('id', id).select(APPLICATIONS_JOIN_SELECT).single()

  if (error?.code === '23505') {
    throw new Error(
      'Update would create a duplicate active application for this slot. ' +
      'Cancel the conflicting application first.',
    )
  }
  if (error) throw new Error(error.message || 'Failed to update application')
  return data
}

/**
 * Approve an application. Sets status=approved, approved=true, approved_at=now().
 *
 * @param {{ id: string, approved_unit_room?: string | null }} args
 * @returns {Promise<object>}
 */
export async function approveApplication({ id, approved_unit_room } = {}) {
  const aid = String(id || '').trim()
  if (!aid) throw new Error('approveApplication: id is required.')

  const updates = {
    status: APPLICATION_STATUS_APPROVED,
    approved: true,
    rejected: false,
    approved_at: new Date().toISOString(),
  }
  if (approved_unit_room !== undefined) {
    updates.approved_unit_room = normalizeNullableTextField(approved_unit_room, 200, 'approved_unit_room')
  }

  const client = requireServiceClient()
  const { data, error } = await client.from('applications').update(updates).eq('id', aid).select(APPLICATIONS_JOIN_SELECT).single()
  if (error) throw new Error(error.message || 'Failed to approve application')
  return data
}

/**
 * Reject an application. Sets status=rejected, rejected=true.
 *
 * @param { id: string } args
 * @returns {Promise<object>}
 */
export async function rejectApplication({ id } = {}) {
  const aid = String(id || '').trim()
  if (!aid) throw new Error('rejectApplication: id is required.')

  const updates = {
    status: APPLICATION_STATUS_REJECTED,
    rejected: true,
    approved: false,
    approved_at: null,
  }

  const client = requireServiceClient()
  const { data, error } = await client.from('applications').update(updates).eq('id', aid).select(APPLICATIONS_JOIN_SELECT).single()
  if (error) throw new Error(error.message || 'Failed to reject application')
  return data
}

/**
 * Manager "send back to pending": clears approval flags and returns the row to review.
 *
 * @param {{ id: string }} args
 * @returns {Promise<object>}
 */
export async function resetApplicationToPendingReview({ id } = {}) {
  const aid = String(id || '').trim()
  if (!aid) throw new Error('resetApplicationToPendingReview: id is required.')

  const updates = {
    status: APPLICATION_STATUS_UNDER_REVIEW,
    approved: false,
    rejected: false,
    approved_at: null,
    approved_unit_room: null,
  }

  const client = requireServiceClient()
  const { data, error } = await client.from('applications').update(updates).eq('id', aid).select(APPLICATIONS_JOIN_SELECT).single()
  if (error) throw new Error(error.message || 'Failed to reset application')
  return data
}

// ─── Apply pre-submit checks (Supabase-backed, no Airtable) ───────────────────

function rangesOverlapDates(startA, endA, startB, endB) {
  const aStart = new Date(startA)
  const bStart = new Date(startB)
  if (Number.isNaN(aStart.getTime()) || Number.isNaN(bStart.getTime())) return false
  const aEnd = endA ? new Date(endA) : null
  const bEnd = endB ? new Date(endB) : null
  const aEndTime = aEnd && !Number.isNaN(aEnd.getTime()) ? aEnd.getTime() : Number.POSITIVE_INFINITY
  const bEndTime = bEnd && !Number.isNaN(bEnd.getTime()) ? bEnd.getTime() : Number.POSITIVE_INFINITY
  return aStart.getTime() <= bEndTime && bStart.getTime() <= aEndTime
}

/**
 * True when a non-draft application already exists for this signer email.
 *
 * @param {string} email
 * @param {{ excludeApplicationId?: string }} [opts]
 */
export async function hasSubmittedApplicationForSignerEmail(email, { excludeApplicationId } = {}) {
  const em = String(email || '').trim().toLowerCase()
  if (!em) return false
  const client = requireServiceClient()
  let q = client
    .from('applications')
    .select('id')
    .eq('signer_email', em)
    .not('status', 'eq', APPLICATION_STATUS_DRAFT)
    .not('status', 'eq', APPLICATION_STATUS_CANCELLED)
    .limit(5)
  const ex = String(excludeApplicationId || '').trim()
  if (ex) q = q.neq('id', ex)
  const { data, error } = await q
  if (error) throw new Error(error.message || 'Duplicate check failed')
  return (data || []).length > 0
}

/**
 * True when another application has overlapping lease dates for the same property + room label.
 *
 * @param {{
 *   propertyName: string
 *   roomLabel: string
 *   leaseStart: string
 *   leaseEnd?: string | null
 *   excludeApplicationId?: string
 * }} args
 */
export async function hasRoomLeaseOverlapForProperty({ propertyName, roomLabel, leaseStart, leaseEnd, excludeApplicationId } = {}) {
  const pname = String(propertyName || '').trim()
  const rname = String(roomLabel || '').trim()
  const ls = String(leaseStart || '').trim()
  if (!pname || !rname || !ls) return false

  const prop = await getPropertyByName(pname)
  if (!prop?.id) return false
  const room = await getRoomByPropertyAndName({ propertyId: prop.id, name: rname })
  if (!room?.id) return false

  const client = requireServiceClient()
  let q = client
    .from('applications')
    .select('id, lease_start_date, lease_end_date, status')
    .eq('property_id', prop.id)
    .eq('room_id', room.id)
    .not('status', 'eq', APPLICATION_STATUS_REJECTED)
    .not('status', 'eq', APPLICATION_STATUS_CANCELLED)
    .limit(200)
  const ex = String(excludeApplicationId || '').trim()
  if (ex) q = q.neq('id', ex)
  const { data, error } = await q
  if (error) throw new Error(error.message || 'Room conflict check failed')
  for (const row of data || []) {
    if (
      rangesOverlapDates(ls, leaseEnd || null, row.lease_start_date, row.lease_end_date)
    ) {
      return true
    }
  }
  return false
}

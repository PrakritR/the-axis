/**
 * Map a Supabase `applications` row (+ embedded `property`, `room`) to the flattened
 * Airtable-shaped record the Manager / Apply / Resident UIs expect.
 *
 * @module
 */

import {
  DEFAULT_AXIS_APPLICATION_APPROVED_ROOM,
  DEFAULT_AXIS_APPLICATION_ROOM_CHOICE_2,
  DEFAULT_AXIS_APPLICATION_ROOM_CHOICE_3,
} from './application-airtable-fields.js'

function nonEmptyParts(parts) {
  return parts.map((p) => String(p ?? '').trim()).filter(Boolean)
}

function formatAddress(prop) {
  if (!prop || typeof prop !== 'object') return ''
  const line1 = String(prop.address_line1 || '').trim()
  const line2 = String(prop.address_line2 || '').trim()
  const cityState = nonEmptyParts([prop.city, prop.state]).join(', ')
  const tail = nonEmptyParts([cityState, prop.zip]).join(' ')
  return nonEmptyParts([line1, line2, tail]).join(', ')
}

function moneyFromCents(cents) {
  if (cents == null || cents === '') return ''
  const n = Number(cents)
  if (!Number.isFinite(n)) return ''
  return (n / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

function humanApplicationStatus(status, approved, rejected) {
  const s = String(status || '').trim().toLowerCase()
  if (rejected === true || s === 'rejected') return 'Rejected'
  if (approved === true || s === 'approved') return 'Approved'
  if (s === 'cancelled') return 'Cancelled'
  if (s === 'under_review') return 'Under review'
  if (s === 'submitted') return 'Submitted'
  if (s === 'draft') return 'Draft'
  return status ? String(status) : 'Draft'
}

/**
 * @param {object} row - applications row; optional nested `property`, `room`
 * @returns {Record<string, unknown>}
 */
export function mapApplicationRowToLegacyRecord(row) {
  if (!row || typeof row !== 'object') return {}

  const prop = row.property && typeof row.property === 'object' ? row.property : {}
  const room = row.room && typeof row.room === 'object' ? row.room : {}

  const approved = row.approved === true
  const rejected = row.rejected === true
  const appStatus = humanApplicationStatus(row.status, approved, rejected)

  const room2Key = DEFAULT_AXIS_APPLICATION_ROOM_CHOICE_2
  const room3Key = DEFAULT_AXIS_APPLICATION_ROOM_CHOICE_3
  const approvedRoomKey = DEFAULT_AXIS_APPLICATION_APPROVED_ROOM

  const id = String(row.id || '').trim()
  const shortPublic = id && id.includes('-') ? id.replace(/-/g, '').slice(0, 10).toUpperCase() : id

  const feeDue = moneyFromCents(row.application_fee_due_cents)

  /** @type {Record<string, unknown>} */
  const out = {
    id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    _fromSupabase: true,

    'Property Name': String(prop.name || '').trim(),
    'Property Address': formatAddress(prop),
    'Room Number': String(room.name || '').trim(),

    'Owner ID': String(prop.managed_by_app_user_id || '').trim(),

    'Signer Full Name': row.signer_full_name != null ? String(row.signer_full_name) : '',
    'Signer Email': row.signer_email != null ? String(row.signer_email) : '',
    'Signer Phone Number': row.signer_phone_number != null ? String(row.signer_phone_number) : '',
    'Signer Date of Birth': row.signer_date_of_birth != null ? String(row.signer_date_of_birth) : '',
    'Signer SSN No.': row.signer_ssn_last4 != null ? String(row.signer_ssn_last4) : '',
    'Signer Driving License No.':
      row.signer_drivers_license_number != null ? String(row.signer_drivers_license_number) : '',

    'Lease Term': row.lease_term != null ? String(row.lease_term) : '',
    'Month to Month': row.month_to_month === true,
    'Lease Start Date': row.lease_start_date != null ? String(row.lease_start_date) : '',
    'Lease End Date': row.lease_end_date != null ? String(row.lease_end_date) : '',

    'Signer Current Address': row.current_address != null ? String(row.current_address) : '',
    'Signer City': row.current_city != null ? String(row.current_city) : '',
    'Signer State': row.current_state != null ? String(row.current_state) : '',
    'Signer ZIP': row.current_zip != null ? String(row.current_zip) : '',

    'Signer Employer': row.employer_name != null ? String(row.employer_name) : '',
    'Signer Employer Address': row.employer_address != null ? String(row.employer_address) : '',
    'Signer Supervisor Name': row.supervisor_name != null ? String(row.supervisor_name) : '',
    'Signer Supervisor Phone': row.supervisor_phone != null ? String(row.supervisor_phone) : '',
    'Signer Job Title': row.job_title != null ? String(row.job_title) : '',
    'Signer Monthly Income': moneyFromCents(row.monthly_income_cents),
    'Signer Annual Income': moneyFromCents(row.annual_income_cents),
    'Signer Employment Start Date': row.employment_start_date != null ? String(row.employment_start_date) : '',
    'Signer Other Income': row.other_income_notes != null ? String(row.other_income_notes) : '',

    'Reference 1 Name': row.reference_1_name != null ? String(row.reference_1_name) : '',
    'Reference 1 Relationship': row.reference_1_relationship != null ? String(row.reference_1_relationship) : '',
    'Reference 1 Phone': row.reference_1_phone != null ? String(row.reference_1_phone) : '',
    'Reference 2 Name': row.reference_2_name != null ? String(row.reference_2_name) : '',
    'Reference 2 Relationship': row.reference_2_relationship != null ? String(row.reference_2_relationship) : '',
    'Reference 2 Phone': row.reference_2_phone != null ? String(row.reference_2_phone) : '',

    'Number of Occupants': row.number_of_occupants != null && row.number_of_occupants !== '' ? row.number_of_occupants : '',
    Pets: row.pets_notes != null ? String(row.pets_notes) : '',
    'Eviction History': row.eviction_history != null ? String(row.eviction_history) : '',
    'Signer Bankruptcy History': row.bankruptcy_history != null ? String(row.bankruptcy_history) : '',
    'Signer Criminal History': row.criminal_history != null ? String(row.criminal_history) : '',
    'Has Co-Signer': row.has_cosigner === true,

    'Signer Consent for Credit and Background Check': row.consent_credit_background_check === true,
    'Signer Signature': row.signer_signature != null ? String(row.signer_signature) : '',
    'Signer Date Signed': row.signer_date_signed != null ? String(row.signer_date_signed) : '',
    'Additional Notes': row.additional_notes != null ? String(row.additional_notes) : '',

    'Group Apply': row.group_apply === true,
    'Group Size': row.group_size != null ? row.group_size : '',
    'Axis Group ID': row.axis_group_id != null ? String(row.axis_group_id) : '',
    [room2Key]: row.room_choice_2 != null ? String(row.room_choice_2) : '',
    [room3Key]: row.room_choice_3 != null ? String(row.room_choice_3) : '',

    'Application Status': appStatus,
    'Approval Status': appStatus,
    Approved: approved,
    Rejected: rejected,
    'Approved At': row.approved_at != null ? String(row.approved_at) : '',
    [approvedRoomKey]: row.approved_unit_room != null ? String(row.approved_unit_room) : '',

    'Application Fee Paid': row.application_fee_paid === true,
    'Application Fee': feeDue,
    'Application ID': shortPublic,

    'Lease Token': row.lease_token != null ? String(row.lease_token) : '',
    'Lease Status': row.lease_status != null ? String(row.lease_status) : '',
    'Lease Signed': row.lease_signed === true,
    'Lease Signed Date': row.lease_signed_date != null ? String(row.lease_signed_date) : '',

    // Raw snake_case (some code paths read these)
    status: row.status,
    property_id: row.property_id,
    room_id: row.room_id,
    applicant_app_user_id: row.applicant_app_user_id,
  }

  return out
}

export function isApplicationUuid(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || '').trim())
}

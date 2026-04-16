/**
 * POST /api/portal?action=application-submit-internal
 *
 * Internal (Supabase JWT-authenticated) application submission.
 * Replaces the Airtable-backed application-register-payment + application-submit-signer
 * flow for users with a Supabase session.
 *
 * Accepts the same `fields` shape that Apply.jsx already sends (Airtable-field names)
 * and maps them to the internal DB schema. Property/room are resolved by name from
 * the internal properties/rooms tables; if not found in the internal DB the handler
 * returns a 422 so Apply.jsx can fall back to the legacy Airtable path.
 *
 * Idempotency: if `applicationId` (UUID) is supplied in the body, the handler updates
 * that existing application (must belong to the caller); otherwise it creates a new one.
 *
 * Fee logic:
 *   - promoWaive + promoCode === 'FEEWAIVE' → sets application_fee_paid = true
 *   - applicationFeeCents === 0 → sets application_fee_paid = true
 *   - Otherwise application_fee_paid remains false (Stripe checkout follows)
 *
 * Returns: { ok, applicationId, application, feePaid }
 *   applicationId — UUID of the internal application row (use for create-fee-checkout)
 *
 * Registered in NO_AUTH_ACTIONS because this handler verifies auth itself via JWT.
 */
import { authenticateAndLoadAppUser } from '../lib/request-auth.js'
import {
  createApplication,
  updateApplication,
  getApplicationById,
  APPLICATION_STATUS_SUBMITTED,
} from '../lib/applications-service.js'
import { getPropertyByName } from '../lib/properties-service.js'
import { getRoomByPropertyAndName } from '../lib/rooms-service.js'
import { resolveExpectedApplicationFeeUsd } from '../lib/stripe-application-fee-usd.js'

/**
 * Convert a dollar-string (e.g. "3500" or "3,500.00") to cents.
 * Returns null when value is empty / non-numeric.
 */
function dollarsToCents(value) {
  if (value === null || value === undefined || value === '') return null
  const cleaned = String(value).replace(/[^0-9.]/g, '')
  if (!cleaned) return null
  const n = parseFloat(cleaned)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

/**
 * Trim or null a string; also return null on empty.
 */
function toNullableString(value) {
  if (value === null || value === undefined) return null
  const s = String(value).trim()
  return s || null
}

/**
 * Append landlord/address fields that have no dedicated internal column into
 * a human-readable block prepended to additional_notes.
 */
function buildExtendedNotes(fields, existingNotes) {
  const lines = []

  const landlordFields = [
    ['Current Landlord Name',       fields['Current Landlord Name']],
    ['Current Landlord Phone',      fields['Current Landlord Phone']],
    ['Current Move-In Date',        fields['Current Move-In Date']],
    ['Current Move-Out Date',       fields['Current Move-Out Date']],
    ['Current Reason for Leaving',  fields['Current Reason for Leaving']],
    ['Previous Address',            fields['Previous Address']],
    ['Previous City',               fields['Previous City']],
    ['Previous State',              fields['Previous State']],
    ['Previous ZIP',                fields['Previous ZIP']],
    ['Previous Landlord Name',      fields['Previous Landlord Name']],
    ['Previous Landlord Phone',     fields['Previous Landlord Phone']],
    ['Previous Move-In Date',       fields['Previous Move-In Date']],
    ['Previous Move-Out Date',      fields['Previous Move-Out Date']],
    ['Previous Reason for Leaving', fields['Previous Reason for Leaving']],
  ]

  for (const [label, val] of landlordFields) {
    const s = toNullableString(val)
    if (s) lines.push(`${label}: ${s}`)
  }

  if (!lines.length) return toNullableString(existingNotes)

  const extra = lines.join('\n')
  const base  = toNullableString(existingNotes)
  return base ? `${extra}\n\n${base}` : extra
}

/**
 * Map the Airtable-shaped `fields` object (as sent by Apply.jsx) to internal DB args.
 */
function mapAirtableFieldsToInternal(fields) {
  const f = fields || {}

  // SSN: internal schema stores only last 4 digits
  let ssnLast4 = null
  const ssnRaw = String(f['Signer SSN No.'] || '').replace(/\D/g, '')
  if (ssnRaw.length >= 4) ssnLast4 = ssnRaw.slice(-4)
  else if (ssnRaw.length > 0) ssnLast4 = ssnRaw

  return {
    // signer identity
    signer_full_name:               toNullableString(f['Signer Full Name']),
    signer_email:                   toNullableString(f['Signer Email'])?.toLowerCase() || null,
    signer_phone_number:            toNullableString(f['Signer Phone Number']),
    signer_date_of_birth:           toNullableString(f['Signer Date of Birth']),
    signer_ssn_last4:               ssnLast4,
    signer_drivers_license_number:  toNullableString(f['Signer Driving License No.']),

    // property / lease terms
    lease_term:                     toNullableString(f['Lease Term']),
    month_to_month:                 Boolean(f['Month to Month']),
    lease_start_date:               toNullableString(f['Lease Start Date']),
    lease_end_date:                 toNullableString(f['Lease End Date']),

    // current address (direct columns)
    current_address:                toNullableString(f['Signer Current Address']),
    current_city:                   toNullableString(f['Signer City']),
    current_state:                  toNullableString(f['Signer State']),
    current_zip:                    toNullableString(f['Signer ZIP']),

    // employment
    employer_name:                  toNullableString(f['Signer Employer']),
    employer_address:               toNullableString(f['Signer Employer Address']),
    supervisor_name:                toNullableString(f['Signer Supervisor Name']),
    supervisor_phone:               toNullableString(f['Signer Supervisor Phone']),
    job_title:                      toNullableString(f['Signer Job Title']),
    monthly_income_cents:           dollarsToCents(f['Signer Monthly Income']),
    annual_income_cents:            dollarsToCents(f['Signer Annual Income']),
    employment_start_date:          toNullableString(f['Signer Employment Start Date']),
    other_income_notes:             toNullableString(f['Signer Other Income']),

    // references
    reference_1_name:               toNullableString(f['Reference 1 Name']),
    reference_1_relationship:       toNullableString(f['Reference 1 Relationship']),
    reference_1_phone:              toNullableString(f['Reference 1 Phone']),
    reference_2_name:               toNullableString(f['Reference 2 Name']),
    reference_2_relationship:       toNullableString(f['Reference 2 Relationship']),
    reference_2_phone:              toNullableString(f['Reference 2 Phone']),

    // occupancy
    number_of_occupants:            f['Number of Occupants'] != null ? Number(f['Number of Occupants']) || null : null,
    pets_notes:                     toNullableString(f['Pets']),
    eviction_history:               toNullableString(f['Eviction History']),
    bankruptcy_history:             toNullableString(f['Signer Bankruptcy History']),
    criminal_history:               toNullableString(f['Signer Criminal History']),

    // consent / signature
    has_cosigner:                   Boolean(f['Has Co-Signer']),
    consent_credit_background_check: Boolean(f['Signer Consent for Credit and Background Check']),
    signer_signature:               toNullableString(f['Signer Signature']),
    signer_date_signed:             toNullableString(f['Signer Date Signed']),

    // notes (extended — includes landlord/prev-address fields that have no dedicated column)
    additional_notes:               buildExtendedNotes(f, f['Additional Notes']),
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // ── Auth ──────────────────────────────────────────────────────────────────
  const { ok, appUser } = await authenticateAndLoadAppUser(req, res)
  if (!ok) return

  const applicationId = String(req.body?.applicationId || '').trim() || null
  const fields        = req.body?.fields
  const promoWaive    = Boolean(req.body?.promoWaive)
  const promoCode     = String(req.body?.promoCode || '').trim().toUpperCase()
  const propertyName  = String(req.body?.propertyName || fields?.['Property Name'] || '').trim()
  const roomName      = String(req.body?.roomName     || fields?.['Room Number']   || '').trim()

  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    return res.status(400).json({ error: 'fields object is required.' })
  }

  // ── Resolve property + room from internal DB ──────────────────────────────
  let property = null
  let room     = null

  try {
    if (propertyName) {
      property = await getPropertyByName(propertyName)
    }
  } catch (e) {
    console.error('[application-submit-internal] property lookup error', e?.message)
  }

  if (!property) {
    // Property not in the internal DB yet; caller should fall back to Airtable
    return res.status(422).json({
      error: 'Property not found in the internal database. Please use the standard application flow.',
      fallback: 'airtable',
    })
  }

  try {
    if (roomName && property) {
      room = await getRoomByPropertyAndName({ propertyId: property.id, name: roomName })
    }
  } catch (e) {
    // Non-fatal: room lookup failure just means room_id stays null
    console.warn('[application-submit-internal] room lookup error', e?.message)
  }

  // ── Fee logic ─────────────────────────────────────────────────────────────
  const promoOk = promoWaive && promoCode === 'FEEWAIVE'
  const defaultFeeUsd = resolveExpectedApplicationFeeUsd()
  const feeRequired = defaultFeeUsd > 0
  const feePaid = promoOk || !feeRequired

  // ── Map fields → internal columns ─────────────────────────────────────────
  const mapped = mapAirtableFieldsToInternal(fields)

  try {
    let application

    if (applicationId) {
      // ── Update existing application ────────────────────────────────────────
      const existing = await getApplicationById(applicationId)
      if (!existing) {
        return res.status(404).json({ error: 'Application not found.' })
      }
      if (existing.applicant_app_user_id !== appUser.id) {
        return res.status(403).json({ error: 'Access denied.' })
      }

      const updates = {
        id: applicationId,
        ...mapped,
        status: APPLICATION_STATUS_SUBMITTED,
      }
      if (room?.id)     updates.room_id     = room.id
      if (feePaid)      updates.application_fee_paid = true

      application = await updateApplication(updates)
    } else {
      // ── Create new application ─────────────────────────────────────────────
      const createArgs = {
        applicant_app_user_id: appUser.id,
        property_id:           property.id,
        room_id:               room?.id || null,
        ...mapped,
        status: APPLICATION_STATUS_SUBMITTED,
      }
      if (feePaid) createArgs.application_fee_paid = true

      application = await createApplication(createArgs)
    }

    return res.status(200).json({
      ok: true,
      applicationId: application.id,
      application,
      feePaid,
    })
  } catch (err) {
    console.error('[application-submit-internal]', err)
    return res.status(500).json({ error: err?.message || 'Failed to submit application.' })
  }
}

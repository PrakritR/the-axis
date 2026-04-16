/**
 * After an applicant submits and signs their application, record the fee status
 * as a Payments row (with no Resident link yet — link added on approval).
 *
 * Status is "Paid" when the Stripe fee was collected, or "Waived" when the
 * FEEWAIVE promo code was used.  The Notes field carries the idempotency marker
 * so the approval flow can find and update this row rather than create a
 * duplicate.
 */

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
const CORE_BASE_ID =
  process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const CORE_AIRTABLE_BASE_URL = `https://api.airtable.com/v0/${CORE_BASE_ID}`

const PAYMENTS_TABLE =
  process.env.VITE_AIRTABLE_PAYMENTS_TABLE || process.env.AIRTABLE_PAYMENTS_TABLE || 'Payments'

export const SUBMITTED_APP_FEE_MARKER_PREFIX = 'AXIS_SUBMITTED_APPLICATION_FEE:'

function airtableHeaders() {
  return {
    Authorization: `Bearer ${AIRTABLE_TOKEN}`,
    'Content-Type': 'application/json',
  }
}

function escapeFormulaValue(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

async function feeRowExists(applicationRecordId) {
  const marker = `${SUBMITTED_APP_FEE_MARKER_PREFIX}${applicationRecordId}`
  const enc = encodeURIComponent(PAYMENTS_TABLE)
  const formula = `FIND("${escapeFormulaValue(marker)}", {Notes}) > 0`
  const url = `${CORE_AIRTABLE_BASE_URL}/${enc}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`
  const res = await fetch(url, { headers: airtableHeaders() })
  if (!res.ok) return false
  const data = await res.json()
  return (data.records?.length ?? 0) > 0
}

/**
 * @param {{
 *   applicationRecordId: string,
 *   feeUsd: number,
 *   paid: boolean,
 *   waived: boolean,
 *   promoCode?: string,
 *   signerFullName?: string,
 *   signerEmail?: string,
 *   propertyName?: string,
 *   roomNumber?: string,
 * }} params
 */
export async function createSubmittedApplicationFeePayment({
  applicationRecordId,
  feeUsd,
  paid,
  waived,
  promoCode,
  signerFullName,
  signerEmail,
  propertyName,
  roomNumber,
}) {
  if (!AIRTABLE_TOKEN) return { skipped: true, reason: 'no_token' }
  if (!applicationRecordId?.startsWith('rec')) return { skipped: true, reason: 'no_app_id' }
  if (!Number.isFinite(feeUsd) || feeUsd < 0) return { skipped: true, reason: 'no_fee' }

  try {
    if (await feeRowExists(applicationRecordId)) {
      return { skipped: true, reason: 'already_exists' }
    }

    const marker = `${SUBMITTED_APP_FEE_MARKER_PREFIX}${applicationRecordId}`
    const today = new Date().toISOString().slice(0, 10)
    const statusLabel = waived ? 'Waived' : paid ? 'Paid' : 'Unpaid'
    const promoNote = waived && promoCode ? ` (promo code: ${promoCode})` : ''
    const notes = `Application fee — ${statusLabel}${promoNote} at submission. ${marker}`

    const fields = {
      Amount: feeUsd,
      'Amount Paid': paid || waived ? feeUsd : 0,
      Balance: paid || waived ? 0 : feeUsd,
      Status: statusLabel,
      'Due Date': today,
      'Paid Date': paid || waived ? today : undefined,
      Type: 'Application fee',
      Category: 'Fee',
      Month: 'Application fee',
      Notes: notes,
    }
    if (signerFullName) fields['Resident Name'] = signerFullName
    const em = String(signerEmail || '').trim().toLowerCase()
    if (em) fields['Resident Email'] = em
    if (propertyName) fields['Property Name'] = propertyName
    if (roomNumber) fields['Room Number'] = roomNumber

    const enc = encodeURIComponent(PAYMENTS_TABLE)
    const res = await fetch(`${CORE_AIRTABLE_BASE_URL}/${enc}`, {
      method: 'POST',
      headers: airtableHeaders(),
      body: JSON.stringify({ fields, typecast: true }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(text.slice(0, 400))
    }
    const data = await res.json()
    return { created: true, id: data.id }
  } catch (err) {
    console.warn('[submitted-application-fee-payment]', err?.message || err)
    return { skipped: true, reason: 'error', error: err?.message }
  }
}

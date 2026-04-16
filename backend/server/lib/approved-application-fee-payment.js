/**
 * When a manager approves an application, record a paid "Application fee" line on each
 * linked Resident Profile's Payments tab (idempotent via Notes marker).
 */
import {
  applicationApprovedUnitNumber,
  DEFAULT_AXIS_APPLICATION_APPROVED_ROOM,
} from '../../../shared/application-airtable-fields.js'
import { resolveExpectedApplicationFeeUsd } from './stripe-application-fee-usd.js'
import { SUBMITTED_APP_FEE_MARKER_PREFIX } from './submitted-application-fee-payment.js'

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
const CORE_BASE_ID =
  process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const CORE_AIRTABLE_BASE_URL = `https://api.airtable.com/v0/${CORE_BASE_ID}`

const RESIDENT_PROFILE_TABLE = 'Resident Profile'
const PAYMENTS_TABLE =
  process.env.VITE_AIRTABLE_PAYMENTS_TABLE || process.env.AIRTABLE_PAYMENTS_TABLE || 'Payments'

const APPLICATION_APPROVED_ROOM_FIELD = String(
  process.env.VITE_AIRTABLE_APPLICATION_APPROVED_ROOM_FIELD ||
    process.env.AIRTABLE_APPLICATION_APPROVED_ROOM_FIELD ||
    DEFAULT_AXIS_APPLICATION_APPROVED_ROOM,
).trim() || DEFAULT_AXIS_APPLICATION_APPROVED_ROOM

/** Airtable field name that links a Payments row to a Resident Profile record. */
const PAYMENTS_RESIDENT_LINK_FIELD =
  String(process.env.VITE_AIRTABLE_PAYMENTS_RESIDENT_LINK_FIELD || process.env.AIRTABLE_PAYMENTS_RESIDENT_LINK_FIELD || 'Resident').trim() || 'Resident'

/**
 * Resident Profile `House` field may be a linked-record array of property record IDs.
 * Return the first human-readable (non-record-ID) string value, or the fallback.
 */
function resolveHouseText(houseField, fallback) {
  if (typeof houseField === 'string') {
    const s = houseField.trim()
    if (s && !/^rec[A-Za-z0-9]{14,}$/.test(s)) return s
  } else if (Array.isArray(houseField)) {
    for (const x of houseField) {
      const s = String(x ?? '').trim()
      if (s && !/^rec[A-Za-z0-9]{14,}$/.test(s)) return s
    }
  }
  return typeof fallback === 'string' ? fallback.trim() : ''
}

export const APPROVED_APP_FEE_MARKER_PREFIX = 'AXIS_APPROVED_APPLICATION_FEE:'

function airtableHeaders() {
  return {
    Authorization: `Bearer ${AIRTABLE_TOKEN}`,
    'Content-Type': 'application/json',
  }
}

function escapeFormulaValue(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function resolveApplicationFeeUsdFromApplication(application) {
  if (!application || typeof application !== 'object') return resolveExpectedApplicationFeeUsd()
  const keys = ['Application Fee Due (USD)', 'Application Fee (USD)', 'Application Fee']
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(application, k)) {
      const n = Number(application[k])
      if (Number.isFinite(n) && n >= 0) return Math.min(9999, Math.round(n))
    }
  }
  return resolveExpectedApplicationFeeUsd()
}

async function airtableGet(url) {
  const res = await fetch(url, { headers: airtableHeaders() })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text.slice(0, 400))
  }
  return res.json()
}

async function airtablePost(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: airtableHeaders(),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text.slice(0, 400))
  }
  return res.json()
}

async function fetchResidentRecord(residentRecordId) {
  const enc = encodeURIComponent(RESIDENT_PROFILE_TABLE)
  const data = await airtableGet(`${CORE_AIRTABLE_BASE_URL}/${enc}/${encodeURIComponent(residentRecordId)}`)
  return { id: data.id, ...data.fields }
}

async function feePaymentAlreadyExists(residentRecordId, applicationRecordId) {
  const marker = `${APPROVED_APP_FEE_MARKER_PREFIX}${applicationRecordId}`
  const enc = encodeURIComponent(PAYMENTS_TABLE)
  const rid = escapeFormulaValue(residentRecordId)
  const lf = PAYMENTS_RESIDENT_LINK_FIELD
  const formula = `AND(OR({${lf}} = "${rid}", FIND("${rid}", ARRAYJOIN({${lf}})) > 0), FIND("${escapeFormulaValue(marker)}", {Notes}) > 0)`
  const url = `${CORE_AIRTABLE_BASE_URL}/${enc}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`
  const data = await airtableGet(url)
  return (data.records?.length ?? 0) > 0
}

/**
 * Find the payment row created at submission time (by submitted-application-fee-payment.js)
 * so we can update it with the Resident link rather than creating a duplicate.
 */
async function findSubmittedFeeRow(applicationRecordId) {
  const submittedMarker = `${SUBMITTED_APP_FEE_MARKER_PREFIX}${applicationRecordId}`
  const enc = encodeURIComponent(PAYMENTS_TABLE)
  const formula = `FIND("${escapeFormulaValue(submittedMarker)}", {Notes}) > 0`
  const url = `${CORE_AIRTABLE_BASE_URL}/${enc}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`
  try {
    const data = await airtableGet(url)
    return data.records?.[0] || null
  } catch {
    return null
  }
}

async function airtablePatch(url, body) {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: airtableHeaders(),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text.slice(0, 400))
  }
  return res.json()
}

/**
 * @param {{ application: Record<string, unknown>, residentRecordIds: string[] }} p
 * @returns {Promise<{ createdIds: string[], skipped: string[], error?: string }>}
 */
export async function createApprovedApplicationFeePayments({ application, residentRecordIds }) {
  const createdIds = []
  const skipped = []
  if (!AIRTABLE_TOKEN) {
    return { createdIds, skipped, error: 'Airtable token not configured' }
  }

  const appId = String(application?.id || '').trim()
  if (!appId.startsWith('rec')) {
    return { createdIds, skipped, error: 'missing application id' }
  }

  const feeUsd = resolveApplicationFeeUsdFromApplication(application)
  if (!Number.isFinite(feeUsd) || feeUsd <= 0) {
    return { createdIds, skipped, skippedReason: 'zero_or_missing_fee' }
  }

  const ids = Array.isArray(residentRecordIds) ? [...new Set(residentRecordIds.filter((x) => String(x || '').startsWith('rec')))] : []

  const today = new Date().toISOString().slice(0, 10)
  const approvedMarker = `${APPROVED_APP_FEE_MARKER_PREFIX}${appId}`
  const notes = `Application fee (recorded as paid when application was approved). ${approvedMarker}`

  const encPay = encodeURIComponent(PAYMENTS_TABLE)
  const payUrl = `${CORE_AIRTABLE_BASE_URL}/${encPay}`

  // Try to find the row that was created at submission time and upgrade it with
  // the Resident link, so it shows up in the resident's portal without a duplicate.
  const submittedRow = await findSubmittedFeeRow(appId).catch(() => null)

  for (const rid of ids) {
    try {
      if (await feePaymentAlreadyExists(rid, appId)) {
        skipped.push(rid)
        continue
      }
      const resRow = await fetchResidentRecord(rid)
      const resName = String(resRow.Name || application['Signer Full Name'] || '').trim()
      const resEmail = String(resRow.Email || application['Signer Email'] || '').trim().toLowerCase()
      // Prefer application-derived property name; resident profile `House` may be a
      // linked-record array of property record IDs rather than a human-readable string.
      const prop = String(application['Property Name'] || '').trim() || resolveHouseText(resRow.House, '')
      const unit = String(
        resRow['Unit Number'] || applicationApprovedUnitNumber(application, APPLICATION_APPROVED_ROOM_FIELD) || '',
      ).trim()

      if (submittedRow?.id) {
        // Update the existing submitted-time row: add Resident link + approval marker
        const existingNotes = String(submittedRow.fields?.Notes || '')
        const updatedNotes = existingNotes.includes(approvedMarker)
          ? existingNotes
          : `${existingNotes} ${approvedMarker}`.trim()
        const updated = await airtablePatch(
          `${CORE_AIRTABLE_BASE_URL}/${encodeURIComponent(PAYMENTS_TABLE)}/${submittedRow.id}`,
          {
            fields: {
              [PAYMENTS_RESIDENT_LINK_FIELD]: [rid],
              Status: 'Paid',
              'Amount Paid': feeUsd,
              Balance: 0,
              'Paid Date': today,
              Notes: updatedNotes,
              'Resident Name': resName || undefined,
              'Resident Email': resEmail || undefined,
              'Property Name': prop || undefined,
              'Room Number': unit || undefined,
            },
            typecast: true,
          },
        )
        if (updated?.id) createdIds.push(updated.id)
      } else {
        // No submitted-time row exists — create fresh
        const created = await airtablePost(payUrl, {
          fields: {
            [PAYMENTS_RESIDENT_LINK_FIELD]: [rid],
            Amount: feeUsd,
            'Amount Paid': feeUsd,
            Balance: 0,
            Status: 'Paid',
            'Paid Date': today,
            'Due Date': today,
            Type: 'Application fee',
            Category: 'Fee',
            Month: 'Application fee',
            Notes: notes,
            'Resident Name': resName || undefined,
            'Resident Email': resEmail || undefined,
            'Property Name': prop || undefined,
            'Room Number': unit || undefined,
          },
          typecast: true,
        })
        if (created?.id) createdIds.push(created.id)
      }
    } catch (err) {
      console.warn('[approved-application-fee-payment] skip resident', rid, err?.message || err)
      skipped.push(rid)
    }
  }

  return { createdIds, skipped }
}

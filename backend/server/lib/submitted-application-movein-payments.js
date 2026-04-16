/**
 * When a primary application is submitted, create pending Payments rows for
 * security deposit, first month rent, and first month utilities (no Resident link yet).
 * Idempotent via Notes markers. On manager approval, rows are linked to the resident
 * and tagged with approved markers (see approved-application-movein-payments.js).
 */
import { computeMoveInChargesFromApplication } from '../handlers/generate-lease-from-template.js'

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
const CORE_BASE_ID =
  process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const CORE_AIRTABLE_BASE_URL = `https://api.airtable.com/v0/${CORE_BASE_ID}`

const PAYMENTS_TABLE =
  process.env.VITE_AIRTABLE_PAYMENTS_TABLE || process.env.AIRTABLE_PAYMENTS_TABLE || 'Payments'

export const SUBMITTED_MOVEIN_DEPOSIT_MARKER_PREFIX = 'AXIS_SUBMITTED_MOVEIN_DEPOSIT:'
export const SUBMITTED_MOVEIN_FIRST_RENT_MARKER_PREFIX = 'AXIS_SUBMITTED_MOVEIN_FIRST_RENT:'
export const SUBMITTED_MOVEIN_FIRST_UTIL_MARKER_PREFIX = 'AXIS_SUBMITTED_MOVEIN_FIRST_UTILITIES:'

function airtableHeaders() {
  return {
    Authorization: `Bearer ${AIRTABLE_TOKEN}`,
    'Content-Type': 'application/json',
  }
}

function escapeFormulaValue(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
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

function dueDateFromLeaseStart(leaseStart) {
  const s = String(leaseStart || '').trim().slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  return new Date().toISOString().slice(0, 10)
}

async function submittedMoveInRowExists(markerContains) {
  const enc = encodeURIComponent(PAYMENTS_TABLE)
  const formula = `FIND("${escapeFormulaValue(markerContains)}", {Notes}) > 0`
  const url = `${CORE_AIRTABLE_BASE_URL}/${enc}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`
  const data = await airtableGet(url)
  return (data.records?.length ?? 0) > 0
}

/**
 * @param {{ application: Record<string, unknown> }} p — must include `id` (rec…) and listing/application fields used by lease math
 * @returns {Promise<{ createdIds: string[], skipped: string[], error?: string }>}
 */
export async function createSubmittedApplicationMoveInPayments({ application }) {
  const createdIds = []
  const skipped = []
  if (!AIRTABLE_TOKEN) {
    return { createdIds, skipped, error: 'Airtable token not configured' }
  }

  const appId = String(application?.id || '').trim()
  if (!appId.startsWith('rec')) {
    return { createdIds, skipped, error: 'missing application id' }
  }

  let leaseData
  try {
    leaseData = await computeMoveInChargesFromApplication(application, {})
  } catch (err) {
    return { createdIds, skipped, error: err?.message || String(err) }
  }

  const due = dueDateFromLeaseStart(leaseData.leaseStart)
  const propName = String(leaseData.propertyName || application['Property Name'] || '').trim()
  const roomNum = String(leaseData.roomNumber || application['Room Number'] || '').trim()
  const resName = String(application['Signer Full Name'] || application.Name || '').trim()
  const resEmail = String(application['Signer Email'] || application.Email || '').trim().toLowerCase()

  const deposit = Math.round(Number(leaseData.securityDeposit) * 100) / 100
  const rent = Math.round(Number(leaseData.monthlyRent) * 100) / 100
  const util = Math.round(Number(leaseData.utilityFee) * 100) / 100

  const markerDeposit = `${SUBMITTED_MOVEIN_DEPOSIT_MARKER_PREFIX}${appId}`
  const markerRent = `${SUBMITTED_MOVEIN_FIRST_RENT_MARKER_PREFIX}${appId}`
  const markerUtil = `${SUBMITTED_MOVEIN_FIRST_UTIL_MARKER_PREFIX}${appId}`

  const encPay = encodeURIComponent(PAYMENTS_TABLE)
  const payUrl = `${CORE_AIRTABLE_BASE_URL}/${encPay}`

  const rows = [
    deposit > 0 && {
      key: 'deposit',
      existsMarker: markerDeposit,
      amount: deposit,
      Type: 'Security Deposit',
      Month: 'Security deposit',
      Notes: `Pending security deposit when application was submitted. ${markerDeposit}`,
    },
    rent > 0 && {
      key: 'first_rent',
      existsMarker: markerRent,
      amount: rent,
      Type: 'First month rent',
      Month: 'First month rent',
      Notes: `Pending first month rent when application was submitted. ${markerRent}`,
    },
    util > 0 && {
      key: 'first_util',
      existsMarker: markerUtil,
      amount: util,
      Type: 'Utilities',
      Month: 'First month utilities',
      Notes: `Pending first month utilities when application was submitted. ${markerUtil}`,
    },
  ].filter(Boolean)

  for (const spec of rows) {
    try {
      if (await submittedMoveInRowExists(spec.existsMarker)) {
        skipped.push(spec.key)
        continue
      }
      const created = await airtablePost(payUrl, {
        fields: {
          Amount: spec.amount,
          Balance: spec.amount,
          Status: 'Unpaid',
          'Due Date': due,
          Type: spec.Type,
          Category: 'Rent',
          Month: spec.Month,
          Notes: spec.Notes,
          'Resident Name': resName || undefined,
          'Resident Email': resEmail || undefined,
          'Property Name': propName || undefined,
          'Room Number': roomNum || undefined,
        },
        typecast: true,
      })
      if (created?.id) createdIds.push(created.id)
    } catch (err) {
      console.warn('[submitted-application-movein-payments] skip line', spec.key, err?.message || err)
      skipped.push(spec.key)
    }
  }

  return { createdIds, skipped }
}

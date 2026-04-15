/**
 * When a manager approves an application, create pending Payments rows for security deposit,
 * first month rent, and first month utilities (idempotent via Notes markers).
 */
import { computeMoveInChargesFromApplication } from '../handlers/generate-lease-from-template.js'

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
const CORE_BASE_ID =
  process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const CORE_AIRTABLE_BASE_URL = `https://api.airtable.com/v0/${CORE_BASE_ID}`

const RESIDENT_PROFILE_TABLE = 'Resident Profile'
const PAYMENTS_TABLE =
  process.env.VITE_AIRTABLE_PAYMENTS_TABLE || process.env.AIRTABLE_PAYMENTS_TABLE || 'Payments'

export const APPROVED_MOVEIN_DEPOSIT_MARKER_PREFIX = 'AXIS_APPROVED_MOVEIN_DEPOSIT:'
export const APPROVED_MOVEIN_FIRST_RENT_MARKER_PREFIX = 'AXIS_APPROVED_MOVEIN_FIRST_RENT:'
export const APPROVED_MOVEIN_FIRST_UTIL_MARKER_PREFIX = 'AXIS_APPROVED_MOVEIN_FIRST_UTILITIES:'

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

async function fetchResidentRecord(residentRecordId) {
  const enc = encodeURIComponent(RESIDENT_PROFILE_TABLE)
  const data = await airtableGet(`${CORE_AIRTABLE_BASE_URL}/${enc}/${encodeURIComponent(residentRecordId)}`)
  return { id: data.id, ...data.fields }
}

async function moveInRowExists(residentRecordId, markerContains) {
  const enc = encodeURIComponent(PAYMENTS_TABLE)
  const formula = `AND(FIND("${escapeFormulaValue(residentRecordId)}", ARRAYJOIN({Resident})) > 0, FIND("${escapeFormulaValue(markerContains)}", {Notes}) > 0)`
  const url = `${CORE_AIRTABLE_BASE_URL}/${enc}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`
  const data = await airtableGet(url)
  return (data.records?.length ?? 0) > 0
}

function dueDateFromLeaseStart(leaseStart) {
  const s = String(leaseStart || '').trim().slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  return new Date().toISOString().slice(0, 10)
}

/**
 * @param {{ application: Record<string, unknown>, residentRecordIds: string[] }} p
 * @returns {Promise<{ createdIds: string[], skipped: string[], error?: string }>}
 */
export async function createApprovedApplicationMoveInPayments({ application, residentRecordIds }) {
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

  const deposit = Math.round(Number(leaseData.securityDeposit) * 100) / 100
  const rent = Math.round(Number(leaseData.monthlyRent) * 100) / 100
  const util = Math.round(Number(leaseData.utilityFee) * 100) / 100

  const ids = Array.isArray(residentRecordIds)
    ? [...new Set(residentRecordIds.filter((x) => String(x || '').startsWith('rec')))]
    : []

  const encPay = encodeURIComponent(PAYMENTS_TABLE)
  const payUrl = `${CORE_AIRTABLE_BASE_URL}/${encPay}`

  const markerDeposit = `${APPROVED_MOVEIN_DEPOSIT_MARKER_PREFIX}${appId}`
  const markerRent = `${APPROVED_MOVEIN_FIRST_RENT_MARKER_PREFIX}${appId}`
  const markerUtil = `${APPROVED_MOVEIN_FIRST_UTIL_MARKER_PREFIX}${appId}`

  for (const rid of ids) {
    try {
      const resRow = await fetchResidentRecord(rid)
      const resName = String(resRow.Name || application['Signer Full Name'] || '').trim()
      const prop = String(resRow.House || propName).trim()
      const unit = String(resRow['Unit Number'] || roomNum).trim()

      const rows = [
        deposit > 0 && {
          key: 'deposit',
          existsMarker: markerDeposit,
          amount: deposit,
          Type: 'Security Deposit',
          Month: 'Security deposit',
          Notes: `Pending security deposit when application was approved. ${markerDeposit}`,
        },
        rent > 0 && {
          key: 'first_rent',
          existsMarker: markerRent,
          amount: rent,
          Type: 'First month rent',
          Month: 'First month rent',
          Notes: `Pending first month rent when application was approved. ${markerRent}`,
        },
        util > 0 && {
          key: 'first_util',
          existsMarker: markerUtil,
          amount: util,
          Type: 'Utilities',
          Month: 'First month utilities',
          Notes: `Pending first month utilities when application was approved. ${markerUtil}`,
        },
      ].filter(Boolean)

      for (const spec of rows) {
        if (await moveInRowExists(rid, spec.existsMarker)) {
          skipped.push(`${rid}:${spec.key}`)
          continue
        }
        const created = await airtablePost(payUrl, {
          fields: {
            Resident: [rid],
            Amount: spec.amount,
            Balance: spec.amount,
            Status: 'Unpaid',
            'Due Date': due,
            Type: spec.Type,
            Category: 'Rent',
            Month: spec.Month,
            Notes: spec.Notes,
            'Resident Name': resName || undefined,
            'Property Name': prop || undefined,
            'Room Number': unit || undefined,
          },
          typecast: true,
        })
        if (created?.id) createdIds.push(created.id)
      }
    } catch (err) {
      console.warn('[approved-application-movein-payments] skip resident', rid, err?.message || err)
      skipped.push(rid)
    }
  }

  return { createdIds, skipped }
}

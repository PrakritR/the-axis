/**
 * When a manager approves an application, record a paid "Application fee" line on each
 * linked Resident Profile's Payments tab (idempotent via Notes marker).
 */
import { resolveExpectedApplicationFeeUsd } from './stripe-application-fee-usd.js'

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
const CORE_BASE_ID =
  process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const CORE_AIRTABLE_BASE_URL = `https://api.airtable.com/v0/${CORE_BASE_ID}`

const RESIDENT_PROFILE_TABLE = 'Resident Profile'
const PAYMENTS_TABLE =
  process.env.VITE_AIRTABLE_PAYMENTS_TABLE || process.env.AIRTABLE_PAYMENTS_TABLE || 'Payments'

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
  const formula = `AND(FIND("${escapeFormulaValue(residentRecordId)}", ARRAYJOIN({Resident})) > 0, FIND("${escapeFormulaValue(marker)}", {Notes}) > 0)`
  const url = `${CORE_AIRTABLE_BASE_URL}/${enc}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`
  const data = await airtableGet(url)
  return (data.records?.length ?? 0) > 0
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
  const marker = `${APPROVED_APP_FEE_MARKER_PREFIX}${appId}`
  const notes = `Application fee (recorded as paid when application was approved). ${marker}`

  const encPay = encodeURIComponent(PAYMENTS_TABLE)
  const payUrl = `${CORE_AIRTABLE_BASE_URL}/${encPay}`

  for (const rid of ids) {
    try {
      if (await feePaymentAlreadyExists(rid, appId)) {
        skipped.push(rid)
        continue
      }
      const resRow = await fetchResidentRecord(rid)
      const resName = String(resRow.Name || application['Signer Full Name'] || '').trim()
      const prop = String(resRow.House || application['Property Name'] || '').trim()
      const unit = String(resRow['Unit Number'] || application['Room Number'] || '').trim()

      const created = await airtablePost(payUrl, {
        fields: {
          Resident: [rid],
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
          'Property Name': prop || undefined,
          'Room Number': unit || undefined,
        },
        typecast: true,
      })
      if (created?.id) createdIds.push(created.id)
    } catch (err) {
      console.warn('[approved-application-fee-payment] skip resident', rid, err?.message || err)
      skipped.push(rid)
    }
  }

  return { createdIds, skipped }
}

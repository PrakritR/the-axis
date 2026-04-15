import { resolveManagerTenant, canEnforceTenant } from '../middleware/resolveManagerTenant.js'
import { markMatchingResidentsRejected } from '../lib/application-resident-sync.js'
import { deleteLeaseDraftsForApplicationId } from '../lib/lease-draft-cleanup.js'
import { deleteUnpaidApprovedMoveInPaymentsForApplication } from '../lib/approved-application-movein-payments.js'

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
const CORE_BASE_ID =
  process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const APPS_BASE_ID =
  process.env.VITE_AIRTABLE_APPLICATIONS_BASE_ID ||
  process.env.AIRTABLE_APPLICATIONS_BASE_ID ||
  CORE_BASE_ID
const APPS_AIRTABLE_BASE_URL = `https://api.airtable.com/v0/${APPS_BASE_ID}`
const APPLICATIONS_TABLE =
  process.env.VITE_AIRTABLE_APPLICATIONS_TABLE ||
  process.env.AIRTABLE_APPLICATIONS_TABLE ||
  'Applications'

const APPLICATION_REJECTED_FIELD = String(
  process.env.VITE_AIRTABLE_APPLICATION_REJECTED_FIELD ||
    process.env.AIRTABLE_APPLICATION_REJECTED_FIELD ||
    'Rejected',
).trim() || 'Rejected'

function airtableHeaders() {
  return {
    Authorization: `Bearer ${AIRTABLE_TOKEN}`,
    'Content-Type': 'application/json',
  }
}

function mapRecord(record) {
  return { id: record.id, ...record.fields, created_at: record.createdTime }
}

async function airtableGet(url) {
  const res = await fetch(url, { headers: airtableHeaders() })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text)
  }
  return res.json()
}

async function airtablePatch(url, fields) {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: airtableHeaders(),
    body: JSON.stringify({ fields, typecast: true }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text)
  }
  return res.json()
}

function normalizeRecordId(raw) {
  const value = String(raw || '').trim()
  if (!value) return ''
  return value.startsWith('APP-') ? value.slice(4) : value
}

async function getApplication(recordId) {
  const enc = encodeURIComponent(APPLICATIONS_TABLE)
  const data = await airtableGet(`${APPS_AIRTABLE_BASE_URL}/${enc}/${recordId}`)
  return mapRecord(data)
}

async function setApplicationPending(recordId) {
  const enc = encodeURIComponent(APPLICATIONS_TABLE)
  const fields = {
    Approved: null,
    [APPLICATION_REJECTED_FIELD]: null,
  }
  const data = await airtablePatch(`${APPS_AIRTABLE_BASE_URL}/${enc}/${recordId}`, fields)
  return mapRecord(data)
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!AIRTABLE_TOKEN) {
    return res.status(500).json({ error: 'Data service is not configured on the server.' })
  }

  const recordId = normalizeRecordId(req.body?.applicationRecordId)
  if (!recordId) {
    return res.status(400).json({ error: 'applicationRecordId is required.' })
  }

  let tenant = null
  try {
    tenant = await resolveManagerTenant(req)
  } catch (tenantErr) {
    return res.status(403).json({ error: tenantErr.message })
  }

  try {
    const existing = await getApplication(recordId)
    if (canEnforceTenant(tenant, existing)) {
      return res.status(403).json({ error: 'Access denied: this application belongs to a different manager.' })
    }

    const application = await setApplicationPending(recordId)
    const residentSync = await markMatchingResidentsRejected(application)
    const leaseCleanup = await deleteLeaseDraftsForApplicationId(recordId)
    let moveInCleanup = { deletedIds: [], error: '' }
    try {
      moveInCleanup = await deleteUnpaidApprovedMoveInPaymentsForApplication(recordId)
    } catch (e) {
      moveInCleanup = { deletedIds: [], error: e?.message || String(e) }
    }

    return res.status(200).json({
      application,
      residentRecordsUpdated: residentSync.updatedIds,
      leaseDraftsRemoved: leaseCleanup.deletedIds,
      moveInPaymentsRemoved: moveInCleanup.deletedIds,
      message:
        residentSync.updatedIds.length > 0
          ? `Application moved to pending. Resident profiles updated (${residentSync.updatedIds.length}).`
          : 'Application moved to pending.',
    })
  } catch (err) {
    console.error('[manager-application-set-pending]', err)
    return res.status(500).json({
      error: err.message || 'Could not move application to pending.',
    })
  }
}

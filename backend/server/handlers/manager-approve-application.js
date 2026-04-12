import { createLeaseDraftFromApplication } from './generate-lease-draft.js'

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
/** Prefer explicit apps base; otherwise same base as Lease Drafts / portal (manager list uses CORE base). */
const CORE_BASE_ID =
  process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const APPS_BASE_ID =
  process.env.VITE_AIRTABLE_APPLICATIONS_BASE_ID ||
  process.env.AIRTABLE_APPLICATIONS_BASE_ID ||
  CORE_BASE_ID
const APPS_AIRTABLE_BASE_URL = `https://api.airtable.com/v0/${APPS_BASE_ID}`
const CORE_AIRTABLE_BASE_URL = `https://api.airtable.com/v0/${CORE_BASE_ID}`
const RESIDENT_PROFILE_TABLE = 'Resident Profile'
const APPLICATIONS_TABLE =
  process.env.VITE_AIRTABLE_APPLICATIONS_TABLE ||
  process.env.AIRTABLE_APPLICATIONS_TABLE ||
  'Applications'

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

async function approveApplication(recordId) {
  const now = new Date().toISOString()
  const enc = encodeURIComponent(APPLICATIONS_TABLE)
  const data = await airtablePatch(`${APPS_AIRTABLE_BASE_URL}/${enc}/${recordId}`, {
    Approved: true,
    'Approved At': now,
  })
  return mapRecord(data)
}

function escapeFormulaValue(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

async function listResidentsMatchingApplication(applicationRecordId, signerEmail) {
  const enc = encodeURIComponent(RESIDENT_PROFILE_TABLE)
  const byId = new Map()

  const run = async (formula) => {
    const url = `${CORE_AIRTABLE_BASE_URL}/${enc}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=25`
    const data = await airtableGet(url)
    for (const rec of data.records || []) {
      byId.set(rec.id, mapRecord(rec))
    }
  }

  const email = String(signerEmail || '').trim().toLowerCase()
  if (email) {
    await run(`LOWER({Email}) = "${escapeFormulaValue(email)}"`)
  }

  const appId = String(applicationRecordId || '').trim()
  if (appId.startsWith('rec')) {
    try {
      await run(`FIND("${escapeFormulaValue(appId)}", ARRAYJOIN({Applications})) > 0`)
    } catch (err) {
      console.warn(
        '[manager-approve-application] Applications-linked resident lookup skipped (field may not exist)',
        err?.message || err,
      )
    }
  }

  return [...byId.values()]
}

async function patchResidentRecord(recordId, fields) {
  const enc = encodeURIComponent(RESIDENT_PROFILE_TABLE)
  return airtablePatch(`${CORE_AIRTABLE_BASE_URL}/${enc}/${recordId}`, fields)
}

/**
 * Resident portal checks Approved / Application Approval — keep in sync when an application is approved.
 */
async function markMatchingResidentsApproved(application) {
  const appId = application?.id
  const email = application?.['Signer Email']
  let rows = []
  try {
    rows = await listResidentsMatchingApplication(appId, email)
  } catch (err) {
    console.warn('[manager-approve-application] could not list residents', err)
    return { updatedIds: [], error: String(err?.message || err) }
  }

  const updatedIds = []
  for (const r of rows) {
    try {
      await patchResidentRecord(r.id, {
        Approved: true,
        'Application Approval': 'Approved',
      })
      updatedIds.push(r.id)
    } catch (firstErr) {
      try {
        await patchResidentRecord(r.id, { Approved: true })
        updatedIds.push(r.id)
      } catch (err) {
        console.warn('[manager-approve-application] resident patch failed', r.id, firstErr, err)
      }
    }
  }
  return { updatedIds }
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
  const managerName = String(req.body?.managerName || 'Manager').trim()
  const managerRole = String(req.body?.managerRole || 'Manager').trim()

  if (!recordId) {
    return res.status(400).json({ error: 'applicationRecordId is required.' })
  }

  try {
    const existing = await getApplication(recordId)
    const approvedApplication = existing.Approved === true ? existing : await approveApplication(recordId)
    const residentSync = await markMatchingResidentsApproved(approvedApplication)
    const { draft, created } = await createLeaseDraftFromApplication({
      application: approvedApplication,
      generatedBy: managerName,
      generatedByRole: managerRole,
    })

    return res.status(200).json({
      application: approvedApplication,
      draft,
      createdLeaseDraft: created,
      residentRecordsUpdated: residentSync.updatedIds,
      message: created
        ? 'Application approved and lease draft generated.'
        : 'Application approved. Existing lease draft reused.',
    })
  } catch (err) {
    console.error('[manager-approve-application]', err)
    return res.status(500).json({
      error: err.message || 'Could not approve application.',
    })
  }
}

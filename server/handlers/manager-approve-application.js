import { createLeaseDraftFromApplication } from './generate-lease-draft.js'

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
const APPS_BASE_ID =
  process.env.VITE_AIRTABLE_APPLICATIONS_BASE_ID || process.env.AIRTABLE_APPLICATIONS_BASE_ID || 'appNBX2inqfJMyqYV'
const APPS_AIRTABLE_BASE_URL = `https://api.airtable.com/v0/${APPS_BASE_ID}`

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
  const data = await airtableGet(`${APPS_AIRTABLE_BASE_URL}/Applications/${recordId}`)
  return mapRecord(data)
}

async function approveApplication(recordId) {
  const now = new Date().toISOString()
  const data = await airtablePatch(`${APPS_AIRTABLE_BASE_URL}/Applications/${recordId}`, {
    Approved: true,
    'Approved At': now,
  })
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
    return res.status(500).json({ error: 'Airtable is not configured on the server.' })
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
    const { draft, created } = await createLeaseDraftFromApplication({
      application: approvedApplication,
      generatedBy: managerName,
      generatedByRole: managerRole,
    })

    return res.status(200).json({
      application: approvedApplication,
      draft,
      createdLeaseDraft: created,
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

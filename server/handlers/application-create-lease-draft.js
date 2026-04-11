/**
 * POST /api/portal?action=application-create-lease-draft
 *
 * After a signer submits an application (main data workspace), queues an AI lease draft
 * in Lease Drafts. Idempotent per application record (reuses existing draft if present).
 */
import { createLeaseDraftFromApplication } from './generate-lease-draft.js'

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
const BASE_ID =
  process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const AIRTABLE_BASE_URL = `https://api.airtable.com/v0/${BASE_ID}`
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

  const applicationRecordId = String(req.body?.applicationRecordId || '').trim()
  if (!applicationRecordId.startsWith('rec')) {
    return res.status(400).json({ error: 'applicationRecordId is required.' })
  }

  try {
    const url = `${AIRTABLE_BASE_URL}/${encodeURIComponent(APPLICATIONS_TABLE)}/${applicationRecordId}`
    const appRes = await fetch(url, { headers: airtableHeaders() })
    if (!appRes.ok) {
      const t = await appRes.text()
      return res.status(404).json({ error: `Application not found: ${t.slice(0, 200)}` })
    }
    const data = await appRes.json()
    const application = { id: data.id, ...data.fields }

    const { draft, created } = await createLeaseDraftFromApplication({
      application,
      generatedBy: 'Application',
      generatedByRole: 'Applicant',
    })

    return res.status(200).json({
      ok: true,
      draft,
      createdLeaseDraft: created,
      message: created
        ? 'Lease draft generated from application.'
        : 'Existing lease draft kept for this application.',
    })
  } catch (err) {
    console.error('[application-create-lease-draft]', err)
    return res.status(500).json({
      error: err.message || 'Failed to create lease draft from application.',
    })
  }
}

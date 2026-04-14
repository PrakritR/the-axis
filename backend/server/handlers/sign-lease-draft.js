/**
 * POST /api/sign-lease-draft
 *
 * Records a resident's e-signature on a Published or Ready for Signature lease draft.
 * Sets Status → "Signed", stores the typed name + timestamp.
 * Also back-fills the linked Applications record if present.
 *
 * Body: { leaseDraftId, signatureText, residentRecordId }
 */

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
const CORE_BASE_ID =
  process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const APPS_BASE_ID =
  process.env.VITE_AIRTABLE_APPLICATIONS_BASE_ID ||
  process.env.AIRTABLE_APPLICATIONS_BASE_ID ||
  CORE_BASE_ID
const APPS_TABLE =
  process.env.VITE_AIRTABLE_APPLICATIONS_TABLE ||
  process.env.AIRTABLE_APPLICATIONS_TABLE ||
  'Applications'

function airtableHeaders() {
  return {
    Authorization: `Bearer ${AIRTABLE_TOKEN}`,
    'Content-Type': 'application/json',
  }
}

async function airtableGet(url) {
  const res = await fetch(url, { headers: airtableHeaders() })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

async function airtablePatch(table, recordId, fields, baseId = CORE_BASE_ID) {
  const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}/${recordId}`
  const res = await fetch(url, {
    method: 'PATCH',
    headers: airtableHeaders(),
    body: JSON.stringify({ fields, typecast: true }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!AIRTABLE_TOKEN) return res.status(500).json({ error: 'Data service not configured.' })

  const { leaseDraftId, signatureText, residentRecordId } = req.body || {}

  if (!leaseDraftId) return res.status(400).json({ error: 'leaseDraftId is required.' })
  if (!signatureText || !String(signatureText).trim()) {
    return res.status(400).json({ error: 'signatureText is required.' })
  }

  try {
    // Fetch draft to validate status and get linked application
    const draftData = await airtableGet(
      `https://api.airtable.com/v0/${CORE_BASE_ID}/Lease%20Drafts/${leaseDraftId}`
    )
    const draft = { id: draftData.id, ...draftData.fields }

    const currentStatus = String(draft.Status || '').trim()
    if (currentStatus === 'Signed') {
      return res.status(400).json({ error: 'Lease has already been signed.' })
    }
    const signable = currentStatus === 'Published' || currentStatus === 'Ready for Signature'
    if (!signable) {
      return res.status(400).json({
        error: 'Lease must be sent for signature (Published or Ready for Signature) before it can be signed.',
      })
    }

    const now = new Date().toISOString()
    const sig = String(signatureText).trim()

    // Sign the Lease Draft
    const updated = await airtablePatch('Lease Drafts', leaseDraftId, {
      Status: 'Signed',
      'Signature Text': sig,
      'Signed At': now,
      'Updated At': now,
    })

    // Back-fill the linked Applications record (best-effort)
    const appRecordId = String(draft['Application Record ID'] || '').trim()
    if (appRecordId && appRecordId.startsWith('rec')) {
      try {
        await airtablePatch(APPS_TABLE, appRecordId, {
          'Lease Signed': true,
          'Lease Signed Date': now.slice(0, 10),
          'Lease Signature': sig,
        }, APPS_BASE_ID)
      } catch (err) {
        console.warn('[sign-lease-draft] Could not update Applications record (non-fatal):', err.message)
      }
    }

    return res.status(200).json({
      success: true,
      draft: { id: updated.id, ...updated.fields },
      message: 'Lease signed successfully.',
    })
  } catch (err) {
    console.error('[sign-lease-draft]', err)
    return res.status(500).json({ error: err.message || 'Failed to sign lease.' })
  }
}

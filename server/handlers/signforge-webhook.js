/**
 * POST /api/signforge-webhook
 *
 * Register this URL in SignForge (Dashboard → Webhooks), with query token for auth:
 *   https://<your-domain>/api/signforge-webhook?token=<SIGNFORGE_WEBHOOK_TOKEN>
 *
 * On envelope.completed, marks the matching Lease Draft as Signed in Airtable.
 * HMAC verification (x-webhook-signature) requires raw body; Vercel parses JSON, so we
 * use a shared token in the URL instead. See LEASE_WORKFLOW_SETUP.md.
 */
const AIRTABLE_TOKEN = process.env.VITE_AIRTABLE_TOKEN
const BASE_ID =
  process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const AIRTABLE_BASE_URL = `https://api.airtable.com/v0/${BASE_ID}`

function airtableHeaders() {
  return {
    Authorization: `Bearer ${AIRTABLE_TOKEN}`,
    'Content-Type': 'application/json',
  }
}

function escapeFormulaValue(value) {
  return String(value).replace(/"/g, '\\"')
}

async function findDraftByEnvelopeId(envelopeId) {
  const formula = encodeURIComponent(`{SignForge Envelope ID} = "${escapeFormulaValue(envelopeId)}"`)
  const url = `${AIRTABLE_BASE_URL}/Lease%20Drafts?filterByFormula=${formula}&maxRecords=1`
  const res = await fetch(url, { headers: airtableHeaders() })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Airtable list failed: ${t.slice(0, 300)}`)
  }
  const data = await res.json()
  const rec = data.records?.[0]
  return rec ? { id: rec.id, ...rec.fields } : null
}

async function patchDraftSigned(recordId) {
  const now = new Date().toISOString()
  const res = await fetch(`${AIRTABLE_BASE_URL}/Lease%20Drafts/${recordId}`, {
    method: 'PATCH',
    headers: airtableHeaders(),
    body: JSON.stringify({
      fields: {
        Status: 'Signed',
        'Updated At': now,
      },
      typecast: true,
    }),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Airtable patch failed: ${t.slice(0, 400)}`)
  }
  return res.json()
}

async function logAuditEvent({ leaseDraftId, notes }) {
  try {
    await fetch(`${AIRTABLE_BASE_URL}/Audit%20Log`, {
      method: 'POST',
      headers: airtableHeaders(),
      body: JSON.stringify({
        fields: {
          'Lease Draft ID': leaseDraftId,
          'Action Type': 'SignForge Completed',
          'Performed By': 'SignForge',
          'Performed By Role': 'System',
          Timestamp: new Date().toISOString(),
          Notes: notes,
        },
        typecast: true,
      }),
    })
  } catch (e) {
    console.warn('[signforge-webhook] Audit log failed:', e.message)
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const expected = process.env.SIGNFORGE_WEBHOOK_TOKEN
  const token =
    String(req.query?.token || '').trim() ||
    String(req.headers?.authorization || '')
      .replace(/^Bearer\s+/i, '')
      .trim()

  if (!expected || token !== expected) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  if (!AIRTABLE_TOKEN) {
    return res.status(500).json({ error: 'Airtable not configured' })
  }

  const body = req.body || {}
  const event = String(body.event || '')
  const envelopeId = String(body.envelope_id || body.envelopeId || '').trim()

  if (!envelopeId) {
    return res.status(400).json({ error: 'Missing envelope_id' })
  }

  if (event !== 'envelope.completed') {
    return res.status(200).json({ ok: true, ignored: true, event })
  }

  try {
    const draft = await findDraftByEnvelopeId(envelopeId)
    if (!draft) {
      console.warn('[signforge-webhook] No Lease Draft for envelope', envelopeId)
      return res.status(200).json({ ok: true, message: 'No matching draft' })
    }

    if (draft.Status === 'Signed') {
      return res.status(200).json({ ok: true, message: 'Already signed' })
    }

    await patchDraftSigned(draft.id)
    await logAuditEvent({
      leaseDraftId: draft.id,
      notes: `SignForge webhook ${event} for envelope ${envelopeId}`,
    })

    return res.status(200).json({ ok: true, leaseDraftId: draft.id })
  } catch (err) {
    console.error('[signforge-webhook]', err)
    return res.status(500).json({ error: err.message })
  }
}

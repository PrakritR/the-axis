/**
 * POST /api/portal?action=signforge-send-lease
 *
 * Renders the published lease (Manager Edited / AI draft) to PDF via Puppeteer,
 * then sends it for e-signature with SignForge quick-sign API:
 * https://signforge.io/developers
 */
import { buildLeasePdfHtml } from '../lib/lease-html-document.js'
import { renderHtmlToPdfBuffer } from '../lib/lease-puppeteer-pdf.js'

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
const BASE_ID =
  process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const AIRTABLE_BASE_URL = `https://api.airtable.com/v0/${BASE_ID}`
const SIGNFORGE_API = 'https://signforge.io/api/v1/quick-sign'

function airtableHeaders() {
  return {
    Authorization: `Bearer ${AIRTABLE_TOKEN}`,
    'Content-Type': 'application/json',
  }
}

async function airtableGetLeaseDraft(recordId) {
  const res = await fetch(`${AIRTABLE_BASE_URL}/Lease%20Drafts/${recordId}`, {
    headers: airtableHeaders(),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Lease draft read failed: ${t.slice(0, 400)}`)
  }
  const data = await res.json()
  return { id: data.id, ...data.fields }
}

async function airtablePatchLeaseDraft(recordId, fields) {
  const res = await fetch(`${AIRTABLE_BASE_URL}/Lease%20Drafts/${recordId}`, {
    method: 'PATCH',
    headers: airtableHeaders(),
    body: JSON.stringify({ fields, typecast: true }),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(
      `Airtable update failed. Add optional columns "SignForge Envelope ID" and "SignForge Sent At" (date) to Lease Drafts if missing. ${t.slice(0, 500)}`
    )
  }
  const data = await res.json()
  return { id: data.id, ...data.fields }
}

async function logAuditEvent({ leaseDraftId, actionType, performedBy, performedByRole, notes = '' }) {
  try {
    await fetch(`${AIRTABLE_BASE_URL}/Audit%20Log`, {
      method: 'POST',
      headers: airtableHeaders(),
      body: JSON.stringify({
        fields: {
          'Lease Draft ID': leaseDraftId,
          'Action Type': actionType,
          'Performed By': performedBy,
          'Performed By Role': performedByRole,
          Timestamp: new Date().toISOString(),
          Notes: notes,
        },
        typecast: true,
      }),
    })
  } catch (e) {
    console.warn('[signforge-send-lease] Audit log failed (non-fatal):', e.message)
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

  const apiKey = process.env.SIGNFORGE_API_KEY
  if (!apiKey) {
    return res.status(501).json({
      error:
        'SignForge is not configured. Add SIGNFORGE_API_KEY from https://signforge.io/dashboard/developers to your environment.',
    })
  }

  if (!AIRTABLE_TOKEN) {
    return res.status(500).json({ error: 'Airtable token is not configured.' })
  }

  const { leaseDraftId, performedBy, performedByRole } = req.body || {}
  const id = String(leaseDraftId || '').trim()
  if (!id.startsWith('rec')) {
    return res.status(400).json({ error: 'leaseDraftId (Airtable record id) is required.' })
  }

  try {
    const draft = await airtableGetLeaseDraft(id)
    const status = draft.Status
    if (status !== 'Published' && status !== 'Signed') {
      return res.status(400).json({
        error: `Lease must be Published before SignForge (current status: ${status || 'unknown'}).`,
      })
    }

    const residentEmail = String(draft['Resident Email'] || '').trim()
    const residentName = String(draft['Resident Name'] || '').trim()
    if (!residentEmail) {
      return res.status(400).json({ error: 'Resident Email is required on the lease draft for SignForge.' })
    }

    const bodyText =
      String(draft['Manager Edited Content'] || '').trim() || String(draft['AI Draft Content'] || '').trim()
    if (!bodyText) {
      return res.status(400).json({ error: 'No lease text to render (Manager Edited / AI Draft is empty).' })
    }

    const title = `Lease — ${residentName || 'Resident'} — ${draft.Property || 'Property'}`
    const subtitle = [draft.Property, draft.Unit].filter(Boolean).join(' · ')
    const html = buildLeasePdfHtml({ title: 'RESIDENTIAL LEASE AGREEMENT', subtitle, bodyText })
    const pdfBuffer = await renderHtmlToPdfBuffer(html)
    const pdfBase64 = pdfBuffer.toString('base64')

    const sfRes = await fetch(SIGNFORGE_API, {
      method: 'POST',
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title,
        pdf_base64: pdfBase64,
        signer_email: residentEmail,
        signer_name: residentName || residentEmail.split('@')[0],
      }),
    })

    const sfJson = await sfRes.json().catch(() => ({}))
    if (!sfRes.ok) {
      const msg = sfJson.error || sfJson.message || JSON.stringify(sfJson)
      console.error('[signforge-send-lease] SignForge error:', sfRes.status, msg)
      return res.status(502).json({
        error: `SignForge request failed (${sfRes.status}): ${typeof msg === 'string' ? msg : 'see server logs'}`,
      })
    }

    const envelopeId = sfJson.envelope_id || sfJson.envelopeId
    if (!envelopeId) {
      return res.status(502).json({ error: 'SignForge did not return envelope_id.', raw: sfJson })
    }

    const now = new Date().toISOString()
    const updated = await airtablePatchLeaseDraft(id, {
      'SignForge Envelope ID': String(envelopeId),
      'SignForge Sent At': now.slice(0, 10),
      'Updated At': now,
    })

    await logAuditEvent({
      leaseDraftId: id,
      actionType: 'SignForge Sent',
      performedBy: performedBy || 'Manager',
      performedByRole: performedByRole || 'Manager',
      notes: `SignForge envelope ${envelopeId} — quick-sign email sent to ${residentEmail}`,
    })

    return res.status(200).json({
      ok: true,
      envelopeId: String(envelopeId),
      signforgeStatus: sfJson.status,
      draft: updated,
    })
  } catch (err) {
    console.error('[signforge-send-lease]', err)
    return res.status(500).json({ error: err.message || 'Failed to send lease via SignForge.' })
  }
}

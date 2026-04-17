/**
 * GET /api/portal?action=application-payment-status
 *
 * Returns whether Application Paid is true for a given application.
 *
 * Dual-path:
 *   - Internal (UUID): reads from internal applications table (no Airtable).
 *   - Legacy (rec…):   reads from Airtable (backwards-compatible).
 *
 * Public endpoint (no auth required).
 */
import { airtableAuthHeaders, applicationsTableUrl, getApplicationsAirtableEnv } from '../lib/applications-airtable-env.js'
import { getApplicationById, APPLICATION_STATUS_DRAFT } from '../lib/applications-service.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isPaidCheckbox(value) {
  if (value === true) return true
  if (value === false || value == null) return false
  const s = String(value).trim().toLowerCase()
  return s === 'yes' || s === 'true' || s === '1' || s === 'checked'
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const rawId = String(req.query?.applicationRecordId || req.query?.applicationId || '').trim()
  if (!rawId) {
    return res.status(400).json({ error: 'applicationRecordId (or applicationId for internal records) is required.' })
  }

  try {
    // ── Internal path (UUID) ─────────────────────────────────────────────
    if (UUID_RE.test(rawId)) {
      const application = await getApplicationById(rawId)
      if (!application) {
        return res.status(404).json({ error: 'Application not found.' })
      }
      const paid = application.application_fee_paid === true
      const submitted = String(application.status || '').trim() !== APPLICATION_STATUS_DRAFT
      return res.status(200).json({
        paid,
        submitted,
        applicationId: application.id,
        status: application.status,
        source: 'internal',
      })
    }

    // ── Legacy Airtable path (rec…) ──────────────────────────────────────
    if (!rawId.startsWith('rec')) {
      return res.status(400).json({ error: 'applicationRecordId must be a UUID or a rec-prefixed Airtable record ID.' })
    }

    const env = getApplicationsAirtableEnv()
    if (!env.token) {
      return res.status(500).json({ error: 'Data service is not configured on the server.' })
    }

    const url = `${applicationsTableUrl(env)}/${encodeURIComponent(rawId)}`
    const r = await fetch(url, { headers: airtableAuthHeaders(env.token) })
    if (!r.ok) {
      const t = await r.text()
      return res.status(404).json({ error: `Application not found: ${t.slice(0, 200)}` })
    }
    const data = await r.json()
    const paid = isPaidCheckbox(data.fields?.[env.paidField])
    const sig = String(data.fields?.[env.signatureField] || '').trim()
    return res.status(200).json({
      paid,
      submitted: sig.length > 0,
      applicationRecordId: data.id,
      source: 'airtable',
    })
  } catch (err) {
    console.error('[application-payment-status]', err)
    return res.status(500).json({ error: err?.message || 'Lookup failed.' })
  }
}

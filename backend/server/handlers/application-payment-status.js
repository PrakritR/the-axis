/**
 * GET /api/portal?action=application-payment-status&applicationRecordId=rec…
 *
 * Public. Returns whether Airtable marks Application Paid for this row.
 */
import { airtableAuthHeaders, applicationsTableUrl, getApplicationsAirtableEnv } from '../lib/applications-airtable-env.js'

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

  const env = getApplicationsAirtableEnv()
  if (!env.token) {
    return res.status(500).json({ error: 'Data service is not configured on the server.' })
  }

  const applicationRecordId = String(req.query?.applicationRecordId || '').trim()
  if (!applicationRecordId.startsWith('rec')) {
    return res.status(400).json({ error: 'applicationRecordId is required.' })
  }

  try {
    const url = `${applicationsTableUrl(env)}/${encodeURIComponent(applicationRecordId)}`
    const r = await fetch(url, { headers: airtableAuthHeaders(env.token) })
    if (!r.ok) {
      const t = await r.text()
      return res.status(404).json({ error: `Application not found: ${t.slice(0, 200)}` })
    }
    const data = await r.json()
    const paid = isPaidCheckbox(data.fields?.[env.paidField])
    return res.status(200).json({ paid, applicationRecordId: data.id })
  } catch (err) {
    console.error('[application-payment-status]', err)
    return res.status(500).json({ error: err?.message || 'Lookup failed.' })
  }
}

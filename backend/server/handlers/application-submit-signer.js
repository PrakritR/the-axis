/**
 * POST /api/portal?action=application-submit-signer
 *
 * Public. PATCHes an existing Applications row after verifying:
 *  - Application Paid is true in Airtable (set only by Stripe webhook), OR
 *  - promo waive (FEEWAIVE), OR
 *  - Application Fee Due (USD) on the row is 0 (no Stripe checkout).
 *
 * Client sends the same `fields` shape as the legacy direct-Airtable POST.
 */
import { airtableAuthHeaders, applicationsTableUrl, getApplicationsAirtableEnv } from '../lib/applications-airtable-env.js'
import { resolveExpectedApplicationFeeUsd } from '../lib/stripe-application-fee-usd.js'

function isPaidInAirtable(value) {
  if (value === true) return true
  if (value === false || value == null) return false
  const s = String(value).trim().toLowerCase()
  return s === 'yes' || s === 'true' || s === '1' || s === 'checked'
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const env = getApplicationsAirtableEnv()
  if (!env.token) {
    return res.status(500).json({ error: 'Data service is not configured on the server.' })
  }

  const applicationRecordId = String(req.body?.applicationRecordId || '').trim()
  const fields = req.body?.fields
  const promoWaive = Boolean(req.body?.promoWaive)
  const promoCode = String(req.body?.promoCode || '').trim().toUpperCase()

  if (!applicationRecordId.startsWith('rec')) {
    return res.status(400).json({ error: 'applicationRecordId is required.' })
  }
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    return res.status(400).json({ error: 'fields object is required.' })
  }

  const getUrl = `${applicationsTableUrl(env)}/${encodeURIComponent(applicationRecordId)}`
  const getRes = await fetch(getUrl, { headers: airtableAuthHeaders(env.token) })
  if (!getRes.ok) {
    const t = await getRes.text()
    return res.status(404).json({ error: `Application not found: ${t.slice(0, 200)}` })
  }
  const row = await getRes.json()

  const recordEmail = String(row.fields?.['Signer Email'] || '').trim().toLowerCase()
  const submittedEmail = String(fields['Signer Email'] || '').trim().toLowerCase()
  if (recordEmail && submittedEmail && recordEmail !== submittedEmail) {
    return res.status(403).json({ error: 'Email does not match this application record.' })
  }

  const promoOk = promoWaive && promoCode === 'FEEWAIVE'

  const defaultFeeUsd = resolveExpectedApplicationFeeUsd()
  const recordFeeRaw = env.feeDueField ? row.fields?.[env.feeDueField] : undefined
  const recordFeeNum = recordFeeRaw != null && String(recordFeeRaw).trim() !== '' ? Number(recordFeeRaw) : NaN
  const feeRequired = Number.isFinite(recordFeeNum) ? recordFeeNum > 0 : defaultFeeUsd > 0

  const paid = isPaidInAirtable(row.fields?.[env.paidField])
  if (feeRequired && !paid && !promoOk) {
    return res.status(402).json({
      error:
        'Stripe has not confirmed your application fee yet. Wait a few seconds after payment, then try Submit again. If this persists, contact leasing.',
    })
  }

  const patchFields = { ...fields }
  delete patchFields[env.paidField]
  if (env.sessionField) delete patchFields[env.sessionField]

  const patchRes = await fetch(getUrl, {
    method: 'PATCH',
    headers: airtableAuthHeaders(env.token),
    body: JSON.stringify({ fields: patchFields, typecast: true }),
  })
  const text = await patchRes.text()
  if (!patchRes.ok) {
    console.error('[application-submit-signer]', patchRes.status, text.slice(0, 600))
    return res.status(502).json({ error: 'Could not save application to Airtable.' })
  }

  const saved = JSON.parse(text)
  return res.status(200).json(saved)
}

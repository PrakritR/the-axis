/**
 * POST /api/portal?action=application-stripe-sync
 *
 * Public. Retrieves a Stripe Checkout Session and, if payment succeeded for this
 * application row, marks Application Paid in Airtable. Use when the webhook is
 * delayed or the client needs to reconcile immediately after embedded checkout.
 */
import Stripe from 'stripe'
import { airtableAuthHeaders, applicationsTableUrl, getApplicationsAirtableEnv } from '../lib/applications-airtable-env.js'

function isPaidCheckbox(value) {
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

  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey) {
    return res.status(500).json({ error: 'STRIPE_SECRET_KEY is not configured on the server.' })
  }

  const applicationRecordId = String(req.body?.applicationRecordId || '').trim()
  const sessionId = String(req.body?.sessionId || '').trim()
  if (!applicationRecordId.startsWith('rec')) {
    return res.status(400).json({ error: 'applicationRecordId is required.' })
  }
  if (!sessionId.startsWith('cs_')) {
    return res.status(400).json({ error: 'A valid Stripe Checkout Session id (cs_…) is required.' })
  }

  const env = getApplicationsAirtableEnv()
  if (!env.token) {
    return res.status(500).json({ error: 'Data service is not configured on the server.' })
  }

  let session
  try {
    const stripe = new Stripe(secretKey)
    session = await stripe.checkout.sessions.retrieve(sessionId)
  } catch (err) {
    console.error('[application-stripe-sync] retrieve session', err?.message || err)
    return res.status(502).json({ error: err?.message || 'Could not verify payment with Stripe.' })
  }

  const meta = session.metadata || {}
  if (String(meta.payment_category || '').trim() !== 'application_fee') {
    return res.status(400).json({ error: 'This checkout session is not an application fee payment.' })
  }
  const metaAppId = String(meta.application_record_id || '').trim()
  if (metaAppId !== applicationRecordId) {
    return res.status(400).json({ error: 'Checkout session does not match this application.' })
  }

  if (String(session.currency || '').toLowerCase() !== 'usd') {
    return res.status(400).json({ error: 'Unsupported currency.' })
  }

  const paymentStatus = String(session.payment_status || '')
  if (paymentStatus !== 'paid') {
    return res.status(200).json({
      ok: false,
      paid: false,
      paymentStatus,
      message: 'Stripe has not marked this session as paid yet.',
    })
  }

  const getUrl = `${applicationsTableUrl(env)}/${encodeURIComponent(applicationRecordId)}`
  const getRes = await fetch(getUrl, { headers: airtableAuthHeaders(env.token) })
  if (!getRes.ok) {
    const t = await getRes.text()
    return res.status(404).json({ error: `Application not found: ${t.slice(0, 200)}` })
  }
  const row = await getRes.json()
  if (isPaidCheckbox(row.fields?.[env.paidField])) {
    return res.status(200).json({ ok: true, paid: true, alreadyPaid: true, checkoutSessionId: session.id })
  }

  const fields = { [env.paidField]: true }
  if (env.sessionField) fields[env.sessionField] = session.id

  const patchRes = await fetch(getUrl, {
    method: 'PATCH',
    headers: airtableAuthHeaders(env.token),
    body: JSON.stringify({ fields, typecast: true }),
  })
  if (!patchRes.ok) {
    const t = await patchRes.text()
    console.error('[application-stripe-sync] Airtable PATCH failed', patchRes.status, t.slice(0, 500))
    return res.status(500).json({ error: 'Could not update Application Paid in Airtable.' })
  }

  return res.status(200).json({ ok: true, paid: true, checkoutSessionId: session.id })
}

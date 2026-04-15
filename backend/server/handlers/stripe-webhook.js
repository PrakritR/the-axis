/**
 * Stripe webhook: checkout.session.completed → mark Applications.{Application Paid} = true
 * when metadata.payment_category === application_fee and metadata.application_record_id is set.
 *
 * Called from api/stripe-webhook.js with req.body as raw Buffer for signature verification.
 */
import Stripe from 'stripe'
import { airtableAuthHeaders, applicationsTableUrl, getApplicationsAirtableEnv } from '../lib/applications-airtable-env.js'
import { resolveExpectedApplicationFeeUsd } from '../lib/stripe-application-fee-usd.js'

function resolveExpectedApplicationFeeCents() {
  return Math.round(resolveExpectedApplicationFeeUsd() * 100)
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!webhookSecret || !secretKey) {
    return res.status(500).json({ error: 'STRIPE_WEBHOOK_SECRET and STRIPE_SECRET_KEY must be set on the server.' })
  }

  const sig = req.headers['stripe-signature']
  if (!sig) return res.status(400).json({ error: 'Missing Stripe-Signature header.' })

  const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body || ''), 'utf8')

  let event
  try {
    const stripe = new Stripe(secretKey)
    event = stripe.webhooks.constructEvent(buf, sig, webhookSecret)
  } catch (err) {
    console.error('[stripe-webhook] constructEvent', err?.message || err)
    return res.status(400).json({ error: `Invalid signature: ${err?.message || 'verify failed'}` })
  }

  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ received: true, ignored: event.type })
  }

  const session = event.data.object
  const meta = session.metadata || {}
  if (String(meta.payment_category || '').trim() !== 'application_fee') {
    return res.status(200).json({ received: true, ignored: 'not application_fee' })
  }

  const applicationRecordId = String(meta.application_record_id || '').trim()
  if (!applicationRecordId.startsWith('rec')) {
    console.warn('[stripe-webhook] checkout.session.completed missing application_record_id', session.id)
    return res.status(200).json({ received: true, skipped: 'no application_record_id' })
  }

  if (String(session.currency || '').toLowerCase() !== 'usd') {
    console.warn('[stripe-webhook] non-USD session', session.id, session.currency)
    return res.status(400).json({ error: 'Unsupported currency.' })
  }

  const expectedCents = resolveExpectedApplicationFeeCents()
  const total = session.amount_total
  if (typeof total === 'number' && expectedCents > 0 && total < expectedCents) {
    console.error('[stripe-webhook] amount too low', { total, expectedCents, session: session.id })
    return res.status(400).json({ error: 'Payment amount below expected application fee.' })
  }

  const env = getApplicationsAirtableEnv()
  if (!env.token) {
    return res.status(500).json({ error: 'Airtable is not configured on the server.' })
  }

  const fields = { [env.paidField]: true }
  if (env.sessionField) fields[env.sessionField] = session.id

  const url = `${applicationsTableUrl(env)}/${encodeURIComponent(applicationRecordId)}`
  const patchRes = await fetch(url, {
    method: 'PATCH',
    headers: airtableAuthHeaders(env.token),
    body: JSON.stringify({ fields, typecast: true }),
  })
  if (!patchRes.ok) {
    const t = await patchRes.text()
    console.error('[stripe-webhook] Airtable PATCH failed', patchRes.status, t.slice(0, 500))
    return res.status(500).json({ error: 'Could not update Application Paid in Airtable.' })
  }

  return res.status(200).json({ received: true, applicationRecordId, checkoutSessionId: session.id })
}

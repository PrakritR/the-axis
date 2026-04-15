/**
 * Stripe webhook: checkout.session.completed → mark Applications.{Application Paid} = true
 * when metadata.payment_category === application_fee and metadata.application_record_id is set.
 *
 * Called from api/stripe-webhook.js with req.body as raw Buffer for signature verification.
 */
import Stripe from 'stripe'
import {
  airtableAuthHeaders,
  airtableErrorMessageFromBody,
  applicationsTableUrl,
  getApplicationsAirtableEnv,
} from '../lib/applications-airtable-env.js'
import { resolveExpectedApplicationFeeUsd } from '../lib/stripe-application-fee-usd.js'

function resolveExpectedApplicationFeeCents() {
  return Math.round(resolveExpectedApplicationFeeUsd() * 100)
}

/**
 * Stripe-Signature must be read reliably on Vercel: `req.headers` can be missing or a Web `Headers`
 * instance (bracket access fails). Fall back to Node's `rawHeaders` when needed.
 */
export function readStripeSignatureHeader(req) {
  const want = 'stripe-signature'
  const direct = String(req?.stripeSignature || '').trim()
  if (direct) return direct

  const h = req?.headers
  if (h && typeof h === 'object') {
    try {
      if (typeof h.get === 'function') {
        const v = h.get('stripe-signature') || h.get('Stripe-Signature')
        if (v) return String(v)
      }
      for (const [k, v] of Object.entries(h)) {
        if (String(k).toLowerCase() === want) {
          if (Array.isArray(v)) return v.map(String).join(', ')
          return v != null ? String(v) : ''
        }
      }
    } catch {
      /* ignore odd header objects */
    }
  }
  const rh = req?.rawHeaders
  if (Array.isArray(rh)) {
    for (let i = 0; i < rh.length - 1; i += 2) {
      if (String(rh[i]).toLowerCase() === want) return String(rh[i + 1] ?? '')
    }
  }
  return ''
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!webhookSecret || !secretKey) {
    return res.status(500).json({ error: 'STRIPE_WEBHOOK_SECRET and STRIPE_SECRET_KEY must be set on the server.' })
  }

  const sig = readStripeSignatureHeader(req)
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

  if (String(session.payment_status || '') !== 'paid') {
    console.warn('[stripe-webhook] checkout.session.completed but not paid', session.id, session.payment_status)
    return res.status(200).json({ received: true, skipped: 'session not paid', payment_status: session.payment_status })
  }

  const expectedCents = resolveExpectedApplicationFeeCents()
  const total = session.amount_total
  if (typeof total === 'number' && expectedCents > 0 && total > 0 && total < expectedCents) {
    console.warn('[stripe-webhook] amount below list price (coupon or custom line item?)', {
      total,
      expectedCents,
      session: session.id,
    })
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
    const airtableDetail = airtableErrorMessageFromBody(t)
    return res.status(500).json({
      error: 'Could not update Application Paid in Airtable.',
      airtableStatus: patchRes.status,
      ...(airtableDetail ? { airtableDetail } : {}),
    })
  }

  return res.status(200).json({ received: true, applicationRecordId, checkoutSessionId: session.id })
}

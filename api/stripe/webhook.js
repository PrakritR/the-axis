/**
 * POST /api/stripe/webhook
 *
 * Canonical Stripe webhook endpoint with full signature verification.
 *
 * Raw-body handling:
 *   `bodyParser: false` tells Next.js/Vercel NOT to parse the body as JSON before
 *   this handler runs. The raw bytes are read with `node:stream/consumers`'s `buffer()`
 *   and passed directly to `stripe.webhooks.constructEvent()`, which requires the exact
 *   bytes Stripe signed — any JSON.parse/re-serialise step would break the HMAC.
 *
 * Environment variables required:
 *   STRIPE_SECRET_KEY       — your Stripe secret key (sk_live_… / sk_test_…)
 *   STRIPE_WEBHOOK_SECRET   — endpoint signing secret from Stripe dashboard (whsec_…)
 */

import { buffer } from 'node:stream/consumers'
import Stripe from 'stripe'

// ─── Next.js / Vercel body-parser bypass ───────────────────────────────────
export const config = {
  api: {
    bodyParser: false,
  },
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Read the Stripe-Signature header safely across Node's IncomingMessage,
 * Web API Headers objects, and Vercel's edge runtime variants.
 */
function readStripeSignatureHeader(req) {
  const want = 'stripe-signature'

  // Fastest path: pre-extracted by caller
  if (req?.stripeSignature) return String(req.stripeSignature)

  const h = req?.headers
  if (h && typeof h === 'object') {
    try {
      // Web API Headers (fetch/edge runtime)
      if (typeof h.get === 'function') {
        return h.get('stripe-signature') || h.get('Stripe-Signature') || ''
      }
      // Plain object (Node IncomingMessage)
      for (const [k, v] of Object.entries(h)) {
        if (String(k).toLowerCase() === want) {
          return Array.isArray(v) ? v.map(String).join(', ') : String(v ?? '')
        }
      }
    } catch { /* ignore */ }
  }

  // rawHeaders fallback [key, value, key, value, …]
  const rh = req?.rawHeaders
  if (Array.isArray(rh)) {
    for (let i = 0; i < rh.length - 1; i += 2) {
      if (String(rh[i]).toLowerCase() === want) return String(rh[i + 1] ?? '')
    }
  }

  return ''
}

// ─── Route handler ──────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')

  // ── GET / HEAD: health-check for the Stripe dashboard "test webhook" button
  if (req.method === 'GET' || req.method === 'HEAD') {
    res.setHeader('Allow', 'POST')
    return res.status(200).json({
      message: 'Webhook endpoint ready',
      detail: 'POST only — Stripe events accepted here.',
    })
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  console.log('[stripe-webhook] webhook POST received')

  // ── Config guards
  const secretKey = process.env.STRIPE_SECRET_KEY
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  if (!secretKey || !webhookSecret) {
    console.error('[stripe-webhook] missing env: STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET not set')
    return res.status(500).json({
      error: 'Webhook endpoint is not configured. STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must be set.',
    })
  }

  // ── Read raw body (must happen before any response is sent)
  let rawBody
  try {
    rawBody = await buffer(req)
  } catch (err) {
    console.error('[stripe-webhook] failed to read request body:', err?.message || err)
    return res.status(400).json({ error: 'Could not read request body.' })
  }

  // ── Read Stripe-Signature header
  const sig = readStripeSignatureHeader(req)
  if (!sig) {
    console.warn('[stripe-webhook] signature verification FAILED — missing Stripe-Signature header')
    return res.status(400).json({ error: 'Missing Stripe-Signature header.' })
  }

  // ── Verify signature
  let event
  try {
    const stripe = new Stripe(secretKey, { apiVersion: '2023-10-16' })
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)
    console.log(`[stripe-webhook] signature verification SUCCESS — event.id=${event.id} type=${event.type}`)
  } catch (err) {
    console.warn(`[stripe-webhook] signature verification FAILED — ${err?.message || err}`)
    return res.status(400).json({
      error: `Webhook signature verification failed: ${err?.message || 'invalid signature'}`,
    })
  }

  // ── Log event details
  console.log(`[stripe-webhook] event received — id=${event.id} | type=${event.type} | livemode=${event.livemode}`)

  // ── Dispatch to event handlers
  // Airtable update logic is delegated to the shared handler so it stays in one place.
  try {
    const { default: stripeWebhookHandler } = await import(
      '../../backend/server/handlers/stripe-webhook.js'
    )
    // Pass the already-verified event and pre-read raw body so the handler
    // skips its own constructEvent call (event already verified above).
    req._stripeEvent = event
    req.body = rawBody
    req.stripeSignature = sig
    return await stripeWebhookHandler(req, res)
  } catch (importErr) {
    // If the shared handler cannot be loaded fall back to a plain acknowledgement
    // so Stripe doesn't retry unnecessarily.
    console.error('[stripe-webhook] could not load shared handler:', importErr?.message || importErr)
    return res.status(200).json({ received: true, eventId: event.id, type: event.type })
  }
}

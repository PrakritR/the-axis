/**
 * Stripe webhooks (checkout.session.completed, …).
 * Uses raw body for signature verification — keep this file separate from api/[route].js.
 */
import { buffer } from 'node:stream/consumers'
import stripeWebhook, { readStripeSignatureHeader } from '../backend/server/handlers/stripe-webhook.js'

export const config = {
  api: {
    bodyParser: false,
  },
}

export default async function handler(req, res) {
  try {
    // Read signature before consuming the body so nothing depends on `req` staying intact afterward.
    const stripeSignature = readStripeSignatureHeader(req)
    const buf = await buffer(req)
    const headers = req.headers && typeof req.headers === 'object' ? req.headers : {}
    const rawHeaders = Array.isArray(req.rawHeaders) ? req.rawHeaders : undefined
    return await stripeWebhook(
      {
        method: req.method,
        url: req.url,
        query: req.query,
        body: buf,
        headers,
        rawHeaders,
        stripeSignature,
      },
      res,
    )
  } catch (err) {
    console.error('[api/stripe-webhook]', err)
    if (!res.headersSent) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: err?.message || 'Webhook error' }))
    }
  }
}

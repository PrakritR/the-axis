/**
 * Stripe webhooks (checkout.session.completed, …).
 * Uses raw body for signature verification — keep this file separate from api/[route].js.
 */
import { buffer } from 'node:stream/consumers'
import stripeWebhook from '../backend/server/handlers/stripe-webhook.js'

export const config = {
  api: {
    bodyParser: false,
  },
}

export default async function handler(req, res) {
  try {
    const buf = await buffer(req)
    return await stripeWebhook({ ...req, body: buf }, res)
  } catch (err) {
    console.error('[api/stripe-webhook]', err)
    if (!res.headersSent) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: err?.message || 'Webhook error' }))
    }
  }
}

/**
 * Stripe webhooks — canonical URL: POST /api/stripe/webhook
 *
 * Step 2A: stub endpoint (200 on POST) so production returns no 404. Raw body preserved
 * (`bodyParser: false`) for future `stripe.webhooks.constructEvent` verification.
 *
 * Full checkout logic remains on /api/stripe-webhook until migrated here.
 */
import { buffer } from 'node:stream/consumers'

export const config = {
  api: {
    bodyParser: false,
  },
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')

  if (req.method === 'GET' || req.method === 'HEAD') {
    res.setHeader('Allow', 'POST')
    res.statusCode = 405
    res.end(
      JSON.stringify({
        message: 'Webhook endpoint ready',
        detail: 'POST only',
      }),
    )
    return
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.statusCode = 405
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }

  try {
    await buffer(req)
  } catch {
    /* ignore body read errors for stub */
  }

  res.statusCode = 200
  res.end(
    JSON.stringify({
      received: true,
      message: 'Stripe webhook route live — full verification pending',
    }),
  )
}

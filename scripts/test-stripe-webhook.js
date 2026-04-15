#!/usr/bin/env node
/**
 * POST a saved Stripe event JSON to your deployed webhook (or local) with a real Stripe-Signature.
 *
 * 1. Stripe Dashboard → Developers → Webhooks → select endpoint → send test event, or copy a delivery payload.
 * 2. Save the **raw JSON body** Stripe sent (the `event` object) as `sample-event.json` in this folder.
 * 3. Copy the `Stripe-Signature` header value from a real delivery (or use `stripe listen` output).
 *
 * Usage:
 *   STRIPE_WEBHOOK_URL=https://www.axis-seattle-housing.com/api/stripe-webhook \
 *   STRIPE_SIGNATURE='t=...,v1=...' \
 *   node scripts/test-stripe-webhook.js
 *
 * Or pass file path:
 *   STRIPE_WEBHOOK_URL=... STRIPE_SIGNATURE=... node scripts/test-stripe-webhook.js path/to/body.json
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { request } from 'node:https'
import { request as httpRequest } from 'node:http'

const __dirname = dirname(fileURLToPath(import.meta.url))

const urlStr = process.env.STRIPE_WEBHOOK_URL || ''
const signature = process.env.STRIPE_SIGNATURE || process.env.STRIPE_WEBHOOK_SIGNATURE || ''
const bodyPath = process.argv[2] || join(__dirname, 'stripe-webhook-test-body.json')

if (!urlStr) {
  console.error('Set STRIPE_WEBHOOK_URL to your full webhook URL (https://…/api/stripe-webhook).')
  process.exit(1)
}
if (!signature) {
  console.error('Set STRIPE_SIGNATURE (or STRIPE_WEBHOOK_SIGNATURE) to the Stripe-Signature header value.')
  process.exit(1)
}

let body
try {
  body = readFileSync(bodyPath)
} catch (e) {
  console.error(`Could not read ${bodyPath}:`, e.message)
  console.error('Pass a path to the raw JSON body as the first argument, or add scripts/stripe-webhook-test-body.json.')
  process.exit(1)
}

const u = new URL(urlStr)
const isHttps = u.protocol === 'https:'
const lib = isHttps ? request : httpRequest

const req = lib(
  {
    hostname: u.hostname,
    port: u.port || (isHttps ? 443 : 80),
    path: u.pathname + u.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(body)),
      'Stripe-Signature': signature,
    },
  },
  (res) => {
    const chunks = []
    res.on('data', (c) => chunks.push(c))
    res.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      console.log('Status:', res.statusCode)
      console.log('Body:', text.slice(0, 2000))
      process.exit(res.statusCode && res.statusCode < 500 ? 0 : 1)
    })
  },
)

req.on('error', (err) => {
  console.error('Request failed:', err.message)
  process.exit(1)
})

req.write(body)
req.end()

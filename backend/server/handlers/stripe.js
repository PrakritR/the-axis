/**
 * POST /api/stripe
 *   body.action = 'checkout' → create Stripe checkout session
 *   body.action = 'portal'   → create Stripe billing portal session
 *
 * Payment routing:
 *   - Personal properties (Ownership Type = "Personal" or not set): funds go to the main Axis Stripe account.
 *   - Third-Party Managed properties (Ownership Type = "Third-Party Managed"):
 *       funds are routed to the owner's Stripe Connect Express account via `transfer_data.destination`.
 *       The platform management fee (AXIS_MANAGEMENT_FEE_PERCENT, default 10%) is retained by Axis
 *       via `application_fee_amount`.
 */

import { randomUUID } from 'node:crypto'
import { resolveExpectedApplicationFeeUsd } from '../lib/stripe-application-fee-usd.js'
import { resolveStripeCardServiceFeeUsd, stripeCardServiceFeeLineLabel } from '../lib/stripe-card-service-fee-usd.js'

const STRIPE_API = 'https://api.stripe.com/v1'

/** Internal Postgres application id (Stripe metadata for fee sync / webhooks). */
const INTERNAL_APPLICATION_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
const BASE_ID = process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const PROPERTIES_TABLE = encodeURIComponent(process.env.VITE_AIRTABLE_PROPERTIES_TABLE || 'Properties')
const OWNER_TABLE = encodeURIComponent(process.env.AIRTABLE_OWNER_PROFILE_TABLE || 'Owner Profile')

/** Platform management fee percentage retained by Axis for third-party managed properties (default 10%). */
function getPlatformFeePercent() {
  const raw = Number(process.env.AXIS_MANAGEMENT_FEE_PERCENT)
  return Number.isFinite(raw) && raw >= 0 && raw <= 100 ? raw : 10
}

function airtableHeaders() {
  return { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' }
}

/** Resolve ownership routing info for a property by name. Returns null if not found or personal. */
async function resolvePropertyOwnershipRouting(propertyName) {
  if (!propertyName || !AIRTABLE_TOKEN) return null
  try {
    const escaped = String(propertyName).replace(/"/g, '\\"')
    const formula = encodeURIComponent(`{Property Name} = "${escaped}"`)
    const url = `https://api.airtable.com/v0/${BASE_ID}/${PROPERTIES_TABLE}?filterByFormula=${formula}&maxRecords=1`
    const res = await fetch(url, { headers: airtableHeaders() })
    if (!res.ok) return null
    const data = await res.json()
    const record = data.records?.[0]
    if (!record) return null

    const ownershipType = String(record.fields?.['Ownership Type'] || '').trim()
    if (ownershipType !== 'Third-Party Managed') return null

    // Resolve the linked Owner Profile record
    const ownerLinks = record.fields?.['Property Owner']
    const ownerRecordId = Array.isArray(ownerLinks) ? ownerLinks[0] : String(ownerLinks || '').trim()
    if (!ownerRecordId || !ownerRecordId.startsWith('rec')) return null

    // Fetch owner's Stripe Connect account ID
    const ownerUrl = `https://api.airtable.com/v0/${BASE_ID}/${OWNER_TABLE}/${encodeURIComponent(ownerRecordId)}`
    const ownerRes = await fetch(ownerUrl, { headers: airtableHeaders() })
    if (!ownerRes.ok) return null
    const ownerData = await ownerRes.json()
    const stripeAccountId = String(ownerData.fields?.['Stripe Connect Account ID'] || '').trim()
    if (!stripeAccountId || !stripeAccountId.startsWith('acct_')) return null

    // Only route if onboarding is complete
    const payoutsEnabled = ownerData.fields?.['Stripe Payouts Enabled'] === true
    if (!payoutsEnabled) return null

    return { ownerStripeAccountId: stripeAccountId, ownershipType }
  } catch {
    return null
  }
}

function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https'
  const host = req.headers['x-forwarded-host'] || req.headers.host
  return `${proto}://${host}`
}

function toFormBody(values) {
  const params = new URLSearchParams()
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      params.append(key, String(value))
    }
  })
  return params
}

/** Stripe substitutes `{CHECKOUT_SESSION_ID}` when redirecting after embedded checkout. */
function embeddedCheckoutReturnUrl(baseUrl) {
  const u = String(baseUrl || '')
  if (u.includes('{CHECKOUT_SESSION_ID}')) return u
  return `${u}${u.includes('?') ? '&' : '?'}session_id={CHECKOUT_SESSION_ID}`
}

const APPLICATION_FEE_STRIPE_CATEGORY = 'application_fee'

async function handleCheckout(req, res, secretKey) {
  const {
    residentId,
    residentName,
    residentEmail,
    propertyName,
    unitNumber,
    amount,
    items = [],
    description,
    category = 'rent',
    paymentRecordId,
    applicationRecordId,
    successPath = '/resident?payment=success',
    cancelPath = '/resident?payment=cancelled',
    embedded = false,
  } = req.body || {}

  // Resolve ownership routing for non-application payments
  const ownershipRouting = category !== 'application_fee'
    ? await resolvePropertyOwnershipRouting(propertyName)
    : null

  let amountNumber = Number(amount)
  let normalizedItems = Array.isArray(items)
    ? items
        .map((item) => ({
          name: item?.name || item?.description || description,
          description: item?.description || '',
          amount: Number(item?.amount || 0),
          quantity: Number(item?.quantity || 1),
        }))
        .filter((item) => item.name && Number.isFinite(item.amount) && item.amount > 0 && item.quantity > 0)
    : []

  if (category === APPLICATION_FEE_STRIPE_CATEGORY) {
    amountNumber = resolveExpectedApplicationFeeUsd()
    normalizedItems = []
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      return res.status(400).json({ error: 'Application fee is not charged in this environment; complete the form without card payment.' })
    }
  }

  const hasItems = normalizedItems.length > 0

  if (!residentEmail || (!description && !hasItems) || (!hasItems && (!Number.isFinite(amountNumber) || amountNumber <= 0))) {
    return res.status(400).json({ error: 'Missing required payment fields.' })
  }

  const successBase = `${getBaseUrl(req)}${successPath}`
  const successUrl = embedded ? embeddedCheckoutReturnUrl(successBase) : successBase
  const cancelUrl = `${getBaseUrl(req)}${cancelPath}`

  // Platform fee and Connect routing for third-party managed properties
  const totalBeforeCardFee = hasItems
    ? normalizedItems.reduce((sum, it) => sum + Number(it.amount || 0) * Number(it.quantity || 1), 0)
    : amountNumber
  const platformFeePercent = getPlatformFeePercent()
  const platformFeeUsd = ownershipRouting
    ? Math.round(totalBeforeCardFee * (platformFeePercent / 100) * 100) / 100
    : 0
  const platformFeeCents = Math.round(platformFeeUsd * 100)

  const form = toFormBody({
    mode: 'payment',
    ...(embedded
      ? { ui_mode: 'embedded_page', return_url: successUrl }
      : { success_url: successBase, cancel_url: cancelUrl }),
    customer_email: residentEmail,
    customer_creation: 'always',
    'metadata[resident_id]': residentId,
    'metadata[resident_name]': residentName,
    'metadata[property_name]': propertyName,
    'metadata[unit_number]': unitNumber,
    'metadata[payment_category]': category,
    'metadata[payment_record_id]': paymentRecordId,
    ...(category === APPLICATION_FEE_STRIPE_CATEGORY && applicationRecordId
      ? (() => {
          const rid = String(applicationRecordId).trim()
          const out = { 'metadata[application_record_id]': rid }
          if (INTERNAL_APPLICATION_UUID_RE.test(rid)) {
            out['metadata[application_id]'] = rid
          }
          return out
        })()
      : {}),
    // Third-party managed: route to owner's Stripe Connect account
    ...(ownershipRouting
      ? {
          'payment_intent_data[application_fee_amount]': String(platformFeeCents),
          'payment_intent_data[transfer_data][destination]': ownershipRouting.ownerStripeAccountId,
          'metadata[ownership_type]': 'Third-Party Managed',
          'metadata[platform_fee_usd]': String(platformFeeUsd),
          'metadata[owner_stripe_account]': ownershipRouting.ownerStripeAccountId,
        }
      : {}),
  })

  const lineItems = hasItems
    ? normalizedItems
    : [{ name: description, description: `${propertyName || ''} ${unitNumber || ''}`.trim(), amount: amountNumber, quantity: 1 }]

  const cardServiceFeeUsd = resolveStripeCardServiceFeeUsd(totalBeforeCardFee)
  if (cardServiceFeeUsd > 0) {
    lineItems.push({
      name: stripeCardServiceFeeLineLabel(),
      description: '',
      amount: cardServiceFeeUsd,
      quantity: 1,
    })
  }

  lineItems.forEach((item, index) => {
    form.append(`line_items[${index}][price_data][currency]`, 'usd')
    form.append(`line_items[${index}][price_data][product_data][name]`, item.name)
    if (item.description) form.append(`line_items[${index}][price_data][product_data][description]`, item.description)
    form.append(`line_items[${index}][price_data][unit_amount]`, String(Math.round(item.amount * 100)))
    form.append(`line_items[${index}][quantity]`, String(item.quantity))
  })

  const stripeRes = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': randomUUID(),
    },
    body: form.toString(),
  })

  const text = await stripeRes.text()
  if (!stripeRes.ok) {
    let detail = text
    try {
      const errObj = text ? JSON.parse(text) : null
      if (errObj?.error?.message) detail = errObj.error.message
    } catch {
      /* use raw text */
    }
    return res.status(502).json({ error: `Stripe checkout error ${stripeRes.status}: ${detail || 'Unknown error'}` })
  }

  let session
  try {
    session = JSON.parse(text)
  } catch {
    return res.status(502).json({ error: 'Stripe returned an invalid checkout response.' })
  }
  const amountTotalUsd =
    typeof session.amount_total === 'number' && session.amount_total > 0
      ? Math.round(session.amount_total) / 100
      : undefined

  return res.status(200).json({
    url: session.url,
    id: session.id,
    client_secret: session.client_secret,
    ...(Number.isFinite(amountTotalUsd) ? { amountTotalUsd } : {}),
  })
}

async function handlePortal(req, res, secretKey) {
  const { customerId } = req.body || {}
  if (!customerId) return res.status(400).json({ error: 'Stripe customer ID is required.' })

  const body = new URLSearchParams({
    customer: String(customerId),
    return_url: `${getBaseUrl(req)}/resident`,
  })

  const stripeRes = await fetch(`${STRIPE_API}/billing_portal/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': randomUUID(),
    },
    body: body.toString(),
  })

  const text = await stripeRes.text()
  if (!stripeRes.ok) {
    let detail = text
    try {
      const errObj = text ? JSON.parse(text) : null
      if (errObj?.error?.message) detail = errObj.error.message
    } catch {
      /* use raw text */
    }
    return res.status(502).json({ error: `Stripe portal error ${stripeRes.status}: ${detail || 'Unknown error'}` })
  }

  let session
  try {
    session = JSON.parse(text)
  } catch {
    return res.status(502).json({ error: 'Stripe returned an invalid portal response.' })
  }
  return res.status(200).json({ url: session.url })
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const secretKey = process.env.STRIPE_SECRET_KEY
    if (!secretKey) return res.status(500).json({ error: 'STRIPE_SECRET_KEY is not configured on the server yet.' })

    const { action } = req.body || {}
    if (action === 'portal') return await handlePortal(req, res, secretKey)
    return await handleCheckout(req, res, secretKey)
  } catch (err) {
    console.error('[stripe]', err)
    if (typeof res.headersSent === 'boolean' && res.headersSent) return
    return res.status(500).json({ error: err?.message || 'Payment request failed.' })
  }
}

/**
 * Application fee Stripe checkout service.
 *
 * Creates an internal payment row and a Stripe Checkout Session for an application fee.
 * All amounts are in cents. Idempotent: reuses an existing pending payment row if present.
 *
 * Axis payment key convention: "app_fee_<application_id>"
 *
 * @module
 */

import { randomUUID } from 'node:crypto'
import { resolveExpectedApplicationFeeUsd } from './stripe-application-fee-usd.js'
import { resolveStripeCardServiceFeeUsd, stripeCardServiceFeeLineLabel } from './stripe-card-service-fee-usd.js'
import { upsertPaymentByAxisPaymentKey, updatePayment, PAYMENT_STATUS_COMPLETED } from './payments-service.js'
import { updateApplication } from './applications-service.js'
import { getPropertyById } from './properties-service.js'
import { getRoomById } from './rooms-service.js'
import { buildApplicationFeeMetadata, appendMetadataToForm } from './stripe-metadata.js'

const STRIPE_API = 'https://api.stripe.com/v1'

/**
 * Build the idempotency key for an application's fee payment row.
 * @param {string} applicationId
 * @returns {string}
 */
export function applicationFeeAxisPaymentKey(applicationId) {
  return `app_fee_${applicationId}`
}

/**
 * Ensure a pending internal payments row exists for this application fee.
 * If a pending row already exists it is returned as-is (idempotent).
 * If the fee has already been completed, throws to prevent double-payment.
 *
 * @param {{
 *   application: { id: string, property_id?: string | null, room_id?: string | null, application_fee_due_cents?: number | null }
 *   appUserId: string
 * }} params
 * @returns {Promise<object>} payment row
 */
export async function ensurePendingApplicationFeePayment({ application, appUserId }) {
  const axisPaymentKey = applicationFeeAxisPaymentKey(application.id)

  // Resolve base fee in cents
  const feeUsd = resolveExpectedApplicationFeeUsd()
  const feeCents = Math.round(feeUsd * 100)
  if (feeCents <= 0) {
    throw new Error('Application fee is not charged in this environment.')
  }

  // Fetch snapshots for display
  const [property, room] = await Promise.all([
    application.property_id ? getPropertyById(application.property_id) : null,
    application.room_id ? getRoomById(application.room_id) : null,
  ])

  const payment = await upsertPaymentByAxisPaymentKey({
    axis_payment_key: axisPaymentKey,
    app_user_id: appUserId,
    property_id: application.property_id || null,
    room_id: application.room_id || null,
    application_id: application.id,
    payment_type: 'application_fee',
    amount_cents: feeCents,
    currency: 'usd',
    status: 'pending',
    description: 'Rental application fee',
    property_name_snapshot: property?.name || null,
    room_number_snapshot: room?.name || null,
  })

  if (payment.status === PAYMENT_STATUS_COMPLETED) {
    throw new Error('Application fee for this application has already been paid.')
  }

  return payment
}

/**
 * Create (or resume) a Stripe Checkout Session for an application fee.
 *
 * Steps:
 *  1. Ensure a pending payment row exists (idempotent via axis_payment_key upsert).
 *  2. Build Stripe form with metadata standard.
 *  3. Create Stripe Checkout Session.
 *  4. Store stripe_checkout_session_id on the payment row and application row.
 *  5. Return session info for the client.
 *
 * @param {{
 *   application: object         — full applications row
 *   appUser: { id: string, email?: string }
 *   baseUrl: string             — e.g. "https://app.joinaxis.com"
 *   secretKey: string           — STRIPE_SECRET_KEY
 *   successPath?: string
 *   cancelPath?: string
 * }} params
 * @returns {Promise<{ url: string, sessionId: string, amountTotalUsd?: number }>}
 */
export async function createApplicationFeeCheckoutSession({
  application,
  appUser,
  baseUrl,
  secretKey,
  successPath = '/apply?payment=success',
  cancelPath  = '/apply?payment=cancelled',
}) {
  // ── 1. Ensure internal pending payment row ────────────────────────────
  const payment = await ensurePendingApplicationFeePayment({
    application,
    appUserId: appUser.id,
  })

  // ── 2. Build Stripe form ──────────────────────────────────────────────
  const feeUsd    = resolveExpectedApplicationFeeUsd()
  const feeCents  = Math.round(feeUsd * 100)
  const cardFeeUsd   = resolveStripeCardServiceFeeUsd(feeUsd)
  const cardFeeCents = Math.round(cardFeeUsd * 100)

  // Fetch property/room names for metadata
  const [property, room] = await Promise.all([
    application.property_id ? getPropertyById(application.property_id) : null,
    application.room_id     ? getRoomById(application.room_id)     : null,
  ])

  const metadata = buildApplicationFeeMetadata({
    application,
    appUserId: appUser.id,
    propertyName: property?.name,
    roomNumber: room?.name,
  })

  const successUrl = `${baseUrl}${successPath}`
  const cancelUrl  = `${baseUrl}${cancelPath}`

  const form = new URLSearchParams()
  form.append('mode', 'payment')
  form.append('success_url', successUrl)
  form.append('cancel_url',  cancelUrl)
  if (appUser.email) form.append('customer_email', String(appUser.email))
  form.append('customer_creation', 'always')
  appendMetadataToForm(form, metadata)

  // Line item 1: application fee
  form.append('line_items[0][price_data][currency]', 'usd')
  form.append('line_items[0][price_data][product_data][name]', 'Application Fee')
  form.append('line_items[0][price_data][product_data][description]',
    `Rental application — ${property?.name || 'property'}${room ? ` / ${room.name}` : ''}`)
  form.append('line_items[0][price_data][unit_amount]', String(feeCents))
  form.append('line_items[0][quantity]', '1')

  // Line item 2 (optional): card service fee
  if (cardFeeCents > 0) {
    form.append('line_items[1][price_data][currency]', 'usd')
    form.append('line_items[1][price_data][product_data][name]', stripeCardServiceFeeLineLabel())
    form.append('line_items[1][price_data][unit_amount]', String(cardFeeCents))
    form.append('line_items[1][quantity]', '1')
  }

  // ── 3. Call Stripe ────────────────────────────────────────────────────
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
      const err = JSON.parse(text)
      if (err?.error?.message) detail = err.error.message
    } catch { /* use raw text */ }
    throw new Error(`Stripe checkout error ${stripeRes.status}: ${detail || 'unknown'}`)
  }

  let session
  try {
    session = JSON.parse(text)
  } catch {
    throw new Error('Stripe returned an invalid checkout response.')
  }

  const sessionId = String(session.id || '')

  // ── 4. Persist session ID on payment and application rows ─────────────
  await Promise.all([
    updatePayment({ id: payment.id, stripe_checkout_session_id: sessionId }),
    updateApplication({ id: application.id, stripe_checkout_session_id: sessionId }),
  ])

  // ── 5. Return session info ────────────────────────────────────────────
  const amountTotalUsd =
    typeof session.amount_total === 'number' && session.amount_total > 0
      ? Math.round(session.amount_total) / 100
      : undefined

  return {
    url: session.url,
    sessionId,
    ...(Number.isFinite(amountTotalUsd) ? { amountTotalUsd } : {}),
  }
}

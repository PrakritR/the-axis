/**
 * Stripe webhook handler.
 *
 * All payment records are now internal Supabase/Postgres. Legacy Airtable payment paths
 * have been removed — old "rec…"-prefixed records from Stripe metadata are logged and
 * acknowledged without writing to Airtable.
 *
 * Events handled:
 *   checkout.session.completed    — primary trigger for internal fee-paid sync
 *   payment_intent.succeeded      — secondary: update PI fields on internal payment
 *   payment_intent.payment_failed — mark internal payment failed
 *   charge.refunded               — mark internal payment refunded
 *
 * Idempotency:
 *   Internal records are identified by axis_payment_key > stripe_checkout_session_id
 *   > stripe_payment_intent_id. Repeated deliveries are safe because updatePayment
 *   and markPayment* are idempotent over the same fields.
 */
import Stripe from 'stripe'
import {
  findPaymentByStripeIdentifiers,
  markPaymentCompleted,
  markPaymentFailed,
  markPaymentRefunded,
  updatePayment,
} from '../lib/payments-service.js'
import { updateApplication } from '../lib/applications-service.js'
import { resolveExpectedApplicationFeeUsd } from '../lib/stripe-application-fee-usd.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveExpectedApplicationFeeCents() {
  return Math.round(resolveExpectedApplicationFeeUsd() * 100)
}

/**
 * Read Stripe-Signature header from any request shape (Web API Headers, Node IncomingMessage,
 * or rawHeaders fallback).
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
    } catch { /* ignore odd header objects */ }
  }
  const rh = req?.rawHeaders
  if (Array.isArray(rh)) {
    for (let i = 0; i < rh.length - 1; i += 2) {
      if (String(rh[i]).toLowerCase() === want) return String(rh[i + 1] ?? '')
    }
  }
  return ''
}

// ─── Internal DB helpers ──────────────────────────────────────────────────────

/**
 * Determine whether the metadata signals an internal-DB record (not Airtable).
 * New records have either:
 *   - axis_payment_key set (e.g. "app_fee_<uuid>")
 *   - application_id that is a UUID (not "rec…")
 */
function isInternalRecord(meta) {
  if (meta.axis_payment_key && !meta.axis_payment_key.startsWith('rec')) return true
  if (meta.application_id && !meta.application_id.startsWith('rec')) return true
  return false
}

/**
 * Sync Stripe identifiers onto an internal payment row if they are not yet stored.
 * This is a non-blocking best-effort update.
 */
async function patchPaymentStripeIds(paymentId, { checkoutSessionId, paymentIntentId, chargeId, eventId }) {
  const updates = {}
  if (checkoutSessionId) updates.stripe_checkout_session_id = checkoutSessionId
  if (paymentIntentId)   updates.stripe_payment_intent_id   = paymentIntentId
  if (chargeId)          updates.stripe_charge_id           = chargeId
  if (eventId)           updates.stripe_event_id            = eventId
  if (Object.keys(updates).length === 0) return
  try {
    await updatePayment({ id: paymentId, ...updates })
  } catch (e) {
    console.warn('[stripe-webhook] patchPaymentStripeIds failed (non-fatal)', e?.message)
  }
}

/**
 * Sync an application_fee payment completion into the internal applications table.
 * Sets application_fee_paid = true and persists the Stripe session ID.
 */
async function syncApplicationFeeCompletedToApplication(applicationId, stripeSessionId) {
  if (!applicationId || applicationId.startsWith('rec')) return
  try {
    await updateApplication({
      id: applicationId,
      application_fee_paid: true,
      ...(stripeSessionId ? { stripe_checkout_session_id: stripeSessionId } : {}),
    })
    console.log(`[stripe-webhook] application_fee_paid set on application ${applicationId}`)
  } catch (e) {
    console.error(`[stripe-webhook] failed to sync application_fee_paid for ${applicationId}:`, e?.message)
  }
}

/**
 * Sync a refunded application_fee payment: clear application_fee_paid.
 * Rule: if the fee payment is refunded the application is no longer considered paid.
 */
async function syncApplicationFeeRefundedToApplication(applicationId) {
  if (!applicationId || applicationId.startsWith('rec')) return
  try {
    await updateApplication({ id: applicationId, application_fee_paid: false })
    console.log(`[stripe-webhook] application_fee_paid cleared on application ${applicationId}`)
  } catch (e) {
    console.error(`[stripe-webhook] failed to clear application_fee_paid for ${applicationId}:`, e?.message)
  }
}

// ─── Event handlers ───────────────────────────────────────────────────────────

/**
 * Handle checkout.session.completed — internal Supabase path only.
 * Legacy Airtable "rec"-prefixed records are acknowledged without action.
 */
async function handleCheckoutSessionCompleted(event, res) {
  const session = event.data.object
  const meta = session.metadata || {}

  if (String(session.payment_status || '') !== 'paid') {
    console.warn('[stripe-webhook] checkout.session.completed but not paid', session.id, session.payment_status)
    return res.status(200).json({ received: true, skipped: 'session not paid' })
  }

  const axisPaymentKey    = String(meta.axis_payment_key    || '').trim()
  const applicationId     = String(meta.application_id      || '').trim()
  const checkoutSessionId = String(session.id               || '').trim()
  const paymentIntentId   = typeof session.payment_intent === 'string'
    ? session.payment_intent
    : session.payment_intent?.id || ''
  const chargeId =
    typeof session.payment_intent === 'object' && session.payment_intent?.latest_charge
      ? String(session.payment_intent.latest_charge.id || session.payment_intent.latest_charge || '')
      : ''

  // ── Internal path ──────────────────────────────────────────────────────
  if (isInternalRecord(meta)) {
    const payment = await findPaymentByStripeIdentifiers({
      axisPaymentKey: axisPaymentKey || undefined,
      checkoutSessionId,
      paymentIntentId: paymentIntentId || undefined,
    })

    if (!payment) {
      // No internal record yet — this can happen if the webhook arrives before the
      // checkout session creation handler finishes. Log and return 200 so Stripe
      // does not retry indefinitely; the payment row will be created by the session
      // creation flow and the fee state will be corrected on re-delivery.
      console.warn('[stripe-webhook] internal record not found for session', checkoutSessionId, '— likely a timing race; safe to ignore if session creation is in progress')
      return res.status(200).json({ received: true, skipped: 'internal_record_not_found_yet' })
    }

    // Idempotency: don't double-process already-completed payments
    if (payment.status === 'completed') {
      console.log(`[stripe-webhook] payment ${payment.id} already completed — skipping`)
      return res.status(200).json({ received: true, skipped: 'already_completed' })
    }

    const updated = await markPaymentCompleted({
      id: payment.id,
      stripe_charge_id: chargeId || undefined,
      stripe_event_id: event.id,
    })

    // Attach all Stripe IDs we have
    await patchPaymentStripeIds(payment.id, {
      checkoutSessionId,
      paymentIntentId: paymentIntentId || undefined,
      chargeId: chargeId || undefined,
      eventId: event.id,
    })

    // Sync to application if this is an application fee
    if (updated.payment_type === 'application_fee' && updated.application_id) {
      await syncApplicationFeeCompletedToApplication(updated.application_id, checkoutSessionId)
    }

    const expectedCents = resolveExpectedApplicationFeeCents()
    if (expectedCents > 0 && typeof session.amount_total === 'number' && session.amount_total < expectedCents) {
      console.warn('[stripe-webhook] amount below list price', { total: session.amount_total, expectedCents, session: session.id })
    }

    console.log(`[stripe-webhook] internal payment ${payment.id} marked completed via session ${checkoutSessionId}`)
    return res.status(200).json({
      received: true,
      internalPaymentId: payment.id,
      checkoutSessionId,
    })
  }

  // Legacy Airtable "rec*" IDs — these records have been migrated; acknowledge without action.
  const legacyApplicationRecordId = String(meta.application_record_id || '').trim()
  const legacyPaymentRecordId     = String(meta.payment_record_id     || '').trim()

  if (legacyApplicationRecordId.startsWith('rec') || legacyPaymentRecordId.startsWith('rec')) {
    console.log('[stripe-webhook] legacy Airtable record in metadata — acknowledged without write', {
      legacyApplicationRecordId: legacyApplicationRecordId || undefined,
      legacyPaymentRecordId: legacyPaymentRecordId || undefined,
      sessionId: session.id,
    })
    return res.status(200).json({ received: true, ignored: 'legacy_airtable_record' })
  }

  return res.status(200).json({ received: true, ignored: 'no_actionable_metadata' })
}

/**
 * Handle payment_intent.succeeded:
 * Finds the internal payment by PI id and attaches identifiers if not already present.
 * Does NOT re-trigger the "fee paid" application sync (checkout.session.completed handles that).
 */
async function handlePaymentIntentSucceeded(event, res) {
  const pi   = event.data.object
  const meta = pi.metadata || {}

  if (!isInternalRecord(meta)) {
    return res.status(200).json({ received: true, ignored: 'legacy_or_unknown' })
  }

  const payment = await findPaymentByStripeIdentifiers({
    axisPaymentKey: String(meta.axis_payment_key || '').trim() || undefined,
    paymentIntentId: String(pi.id || '').trim(),
  })

  if (!payment) {
    console.warn('[stripe-webhook] payment_intent.succeeded — internal record not found for pi', pi.id)
    return res.status(200).json({ received: true, skipped: 'internal_record_not_found' })
  }

  if (payment.status === 'completed') {
    return res.status(200).json({ received: true, skipped: 'already_completed' })
  }

  await markPaymentCompleted({ id: payment.id, stripe_event_id: event.id })
  await patchPaymentStripeIds(payment.id, {
    paymentIntentId: pi.id,
    chargeId: typeof pi.latest_charge === 'string' ? pi.latest_charge : pi.latest_charge?.id,
    eventId: event.id,
  })

  // Sync to application if application_fee and not yet synced
  if (payment.payment_type === 'application_fee' && payment.application_id) {
    await syncApplicationFeeCompletedToApplication(payment.application_id)
  }

  console.log(`[stripe-webhook] internal payment ${payment.id} completed via payment_intent.succeeded`)
  return res.status(200).json({ received: true, internalPaymentId: payment.id })
}

/**
 * Handle payment_intent.payment_failed.
 */
async function handlePaymentIntentFailed(event, res) {
  const pi   = event.data.object
  const meta = pi.metadata || {}

  if (!isInternalRecord(meta)) {
    return res.status(200).json({ received: true, ignored: 'legacy_or_unknown' })
  }

  const payment = await findPaymentByStripeIdentifiers({
    axisPaymentKey: String(meta.axis_payment_key || '').trim() || undefined,
    paymentIntentId: String(pi.id || '').trim(),
  })

  if (!payment) {
    console.warn('[stripe-webhook] payment_intent.payment_failed — internal record not found for pi', pi.id)
    return res.status(200).json({ received: true, skipped: 'internal_record_not_found' })
  }

  await markPaymentFailed({ id: payment.id, stripe_event_id: event.id })
  await patchPaymentStripeIds(payment.id, { paymentIntentId: pi.id, eventId: event.id })

  console.log(`[stripe-webhook] internal payment ${payment.id} marked failed`)
  return res.status(200).json({ received: true, internalPaymentId: payment.id })
}

/**
 * Handle charge.refunded.
 * Marks the internal payment refunded and clears application_fee_paid if applicable.
 *
 * Refund rule: a refunded application fee is treated as unpaid.
 * If a new fee payment is needed, the applicant must restart the checkout flow.
 */
async function handleChargeRefunded(event, res) {
  const charge = event.data.object
  const piId   = typeof charge.payment_intent === 'string'
    ? charge.payment_intent
    : charge.payment_intent?.id || ''

  if (!piId) {
    return res.status(200).json({ received: true, ignored: 'no_payment_intent_on_charge' })
  }

  const payment = await findPaymentByStripeIdentifiers({
    paymentIntentId: piId,
    checkoutSessionId: typeof charge.payment_intent === 'object' ? undefined : undefined,
  })

  if (!payment) {
    console.warn('[stripe-webhook] charge.refunded — internal record not found for pi', piId)
    return res.status(200).json({ received: true, skipped: 'internal_record_not_found' })
  }

  await markPaymentRefunded({ id: payment.id, stripe_event_id: event.id })
  await patchPaymentStripeIds(payment.id, {
    chargeId: String(charge.id || ''),
    eventId: event.id,
  })

  if (payment.payment_type === 'application_fee' && payment.application_id) {
    await syncApplicationFeeRefundedToApplication(payment.application_id)
  }

  console.log(`[stripe-webhook] internal payment ${payment.id} marked refunded`)
  return res.status(200).json({ received: true, internalPaymentId: payment.id })
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  const secretKey     = process.env.STRIPE_SECRET_KEY
  if (!webhookSecret || !secretKey) {
    return res.status(500).json({ error: 'STRIPE_WEBHOOK_SECRET and STRIPE_SECRET_KEY must be set on the server.' })
  }

  let event

  // If the upstream route already verified the signature it attaches the parsed event.
  if (req._stripeEvent && typeof req._stripeEvent === 'object' && req._stripeEvent.id) {
    event = req._stripeEvent
    console.log(`[stripe-webhook] using pre-verified event id=${event.id} type=${event.type}`)
  } else {
    const sig = readStripeSignatureHeader(req)
    if (!sig) return res.status(400).json({ error: 'Missing Stripe-Signature header.' })

    const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body || ''), 'utf8')

    try {
      const stripe = new Stripe(secretKey, { apiVersion: '2023-10-16' })
      event = stripe.webhooks.constructEvent(buf, sig, webhookSecret)
      console.log(`[stripe-webhook] signature verification SUCCESS — id=${event.id} type=${event.type}`)
    } catch (err) {
      console.warn(`[stripe-webhook] signature verification FAILED — ${err?.message || err}`)
      return res.status(400).json({ error: `Invalid signature: ${err?.message || 'verify failed'}` })
    }
  }

  console.log(`[stripe-webhook] event received id=${event.id} type=${event.type} livemode=${event.livemode}`)

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        return await handleCheckoutSessionCompleted(event, res)

      case 'payment_intent.succeeded':
        return await handlePaymentIntentSucceeded(event, res)

      case 'payment_intent.payment_failed':
        return await handlePaymentIntentFailed(event, res)

      case 'charge.refunded':
        return await handleChargeRefunded(event, res)

      default:
        return res.status(200).json({ received: true, ignored: event.type })
    }
  } catch (err) {
    console.error(`[stripe-webhook] unhandled error for event ${event.id}:`, err)
    // Return 200 to prevent Stripe from retrying on unexpected errors.
    // The error is logged; manual investigation is required.
    return res.status(200).json({ received: true, error: err?.message || 'Internal processing error' })
  }
}

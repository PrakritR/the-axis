/**
 * POST /api/portal?action=application-stripe-sync
 *
 * Client-side reconciliation: verify a Stripe Checkout Session and mark Application Paid.
 * Use when webhook delivery is delayed or after embedded checkout return.
 *
 * Dual-path:
 *   - Internal (UUID applicationId): syncs to internal applications + payments tables.
 *   - Legacy (rec… applicationRecordId): syncs to Airtable (backwards-compatible).
 *
 * Public endpoint (no auth required — Stripe session ownership is verified by matching
 * metadata.application_id / metadata.application_record_id against the request's ID).
 */
import Stripe from 'stripe'
import {
  airtableAuthHeaders,
  airtableErrorMessageFromBody,
  applicationsTableUrl,
  getApplicationsAirtableEnv,
} from '../lib/applications-airtable-env.js'
import { getApplicationById, updateApplication } from '../lib/applications-service.js'
import {
  findPaymentByStripeIdentifiers,
  markPaymentCompleted,
  updatePayment,
} from '../lib/payments-service.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isPaidCheckbox(value) {
  if (value === true) return true
  if (value === false || value == null) return false
  const s = String(value).trim().toLowerCase()
  return s === 'yes' || s === 'true' || s === '1' || s === 'checked'
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey) {
    return res.status(500).json({ error: 'STRIPE_SECRET_KEY is not configured on the server.' })
  }

  // Accept either applicationRecordId (legacy rec…) or applicationId (internal UUID)
  const legacyRecordId = String(req.body?.applicationRecordId || '').trim()
  const internalId     = String(req.body?.applicationId     || '').trim()
  const sessionId      = String(req.body?.sessionId         || '').trim()

  const effectiveId = internalId || legacyRecordId
  if (!effectiveId) {
    return res.status(400).json({ error: 'applicationId (UUID) or applicationRecordId (rec…) is required.' })
  }
  if (!sessionId.startsWith('cs_')) {
    return res.status(400).json({ error: 'A valid Stripe Checkout Session id (cs_…) is required.' })
  }

  let session
  try {
    const stripe = new Stripe(secretKey)
    session = await stripe.checkout.sessions.retrieve(sessionId)
  } catch (err) {
    console.error('[application-stripe-sync] retrieve session', err?.message || err)
    return res.status(502).json({ error: err?.message || 'Could not verify payment with Stripe.' })
  }

  if (String(session.currency || '').toLowerCase() !== 'usd') {
    return res.status(400).json({ error: 'Unsupported currency.' })
  }

  const paymentStatus = String(session.payment_status || '')
  if (paymentStatus !== 'paid') {
    return res.status(200).json({
      ok: false,
      paid: false,
      paymentStatus,
      message: 'Stripe has not marked this session as paid yet.',
    })
  }

  const meta = session.metadata || {}

  try {
    // ── Internal path (UUID) ───────────────────────────────────────────────
    if (UUID_RE.test(effectiveId)) {
      // Verify session belongs to this application (Checkout may set application_id and/or application_record_id)
      const metaAppId = String(meta.application_id || meta.application_record_id || '').trim()
      if (metaAppId && metaAppId !== effectiveId) {
        return res.status(400).json({ error: 'Checkout session does not match this application.' })
      }

      const application = await getApplicationById(effectiveId)
      if (!application) return res.status(404).json({ error: 'Application not found.' })

      // Idempotent: already paid
      if (application.application_fee_paid) {
        return res.status(200).json({ ok: true, paid: true, alreadyPaid: true, checkoutSessionId: session.id, source: 'internal' })
      }

      // Sync application row
      await updateApplication({
        id: effectiveId,
        application_fee_paid: true,
        stripe_checkout_session_id: session.id,
      })

      // Sync payment row if found
      const payment = await findPaymentByStripeIdentifiers({
        axisPaymentKey: String(meta.axis_payment_key || '').trim() || undefined,
        checkoutSessionId: session.id,
      })

      if (payment && payment.status !== 'completed') {
        const piId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id
        await markPaymentCompleted({ id: payment.id, stripe_event_id: undefined })
        if (piId) await updatePayment({ id: payment.id, stripe_payment_intent_id: piId })
      }

      return res.status(200).json({ ok: true, paid: true, checkoutSessionId: session.id, source: 'internal' })
    }

    // ── Legacy Airtable path (rec…) ────────────────────────────────────────
    if (!effectiveId.startsWith('rec')) {
      return res.status(400).json({ error: 'applicationId must be a UUID or applicationRecordId must start with rec.' })
    }

    if (String(meta.payment_category || '').trim() !== 'application_fee') {
      return res.status(400).json({ error: 'This checkout session is not an application fee payment.' })
    }
    const metaRecId = String(meta.application_record_id || '').trim()
    if (metaRecId && metaRecId !== effectiveId) {
      return res.status(400).json({ error: 'Checkout session does not match this application.' })
    }

    const env = getApplicationsAirtableEnv()
    if (!env.token) return res.status(500).json({ error: 'Data service is not configured on the server.' })

    const getUrl = `${applicationsTableUrl(env)}/${encodeURIComponent(effectiveId)}`
    const getRes = await fetch(getUrl, { headers: airtableAuthHeaders(env.token) })
    if (!getRes.ok) {
      const t = await getRes.text()
      return res.status(404).json({ error: `Application not found: ${t.slice(0, 200)}` })
    }
    const row = await getRes.json()
    if (isPaidCheckbox(row.fields?.[env.paidField])) {
      return res.status(200).json({ ok: true, paid: true, alreadyPaid: true, checkoutSessionId: session.id, source: 'airtable' })
    }

    const fields = { [env.paidField]: true }
    if (env.sessionField) fields[env.sessionField] = session.id

    const patchRes = await fetch(getUrl, {
      method: 'PATCH',
      headers: airtableAuthHeaders(env.token),
      body: JSON.stringify({ fields, typecast: true }),
    })
    if (!patchRes.ok) {
      const t = await patchRes.text()
      console.error('[application-stripe-sync] Airtable PATCH failed', patchRes.status, t.slice(0, 500))
      const detail = airtableErrorMessageFromBody(t)
      return res.status(500).json({ error: 'Could not update Application Paid in Airtable.', airtableStatus: patchRes.status, ...(detail ? { detail } : {}) })
    }

    return res.status(200).json({ ok: true, paid: true, checkoutSessionId: session.id, source: 'airtable' })
  } catch (err) {
    console.error('[application-stripe-sync]', err)
    return res.status(500).json({ error: err?.message || 'Sync failed.' })
  }
}

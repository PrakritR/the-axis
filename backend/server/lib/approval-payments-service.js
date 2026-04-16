/**
 * Approval-triggered internal payment generation.
 *
 * When an application is approved, this service creates pending internal payment rows
 * for the approved resident's upcoming charges. All amounts come from internal DB
 * (room.monthly_rent_cents, room.utility_fee_cents) — not Airtable.
 *
 * axis_payment_key conventions (deterministic, idempotent via upsert):
 *   rent:              approved:<application_id>:rent
 *   security_deposit:  approved:<application_id>:security_deposit
 *   utilities:         approved:<application_id>:utilities
 *   service_fee:       approved:<application_id>:service_fee
 *
 * Duplicate prevention: upsertPaymentByAxisPaymentKey uses DB partial unique index
 * on axis_payment_key. Re-approving an already-approved application will upsert
 * (not duplicate) — amounts are preserved if changed only if the payment is still pending.
 *
 * Security deposit amount rule:
 *   1. Use SECURITY_DEPOSIT_CENTS env var if set.
 *   2. Otherwise default to one month's rent (monthly_rent_cents).
 *   3. If monthly_rent_cents is 0 or unknown, security deposit is skipped.
 *
 * @module
 */

import { getRoomById } from './rooms-service.js'
import { getPropertyById } from './properties-service.js'
import { upsertPaymentByAxisPaymentKey } from './payments-service.js'
import { requireServiceClient } from './app-users-service.js'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveSecurityDepositCents(monthlyRentCents) {
  const raw = process.env.SECURITY_DEPOSIT_CENTS
  if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
    const n = Number(raw)
    if (Number.isInteger(n) && n >= 0) return n
  }
  return monthlyRentCents > 0 ? monthlyRentCents : 0
}

function resolveServiceFeeCents() {
  const raw = process.env.APPROVAL_SERVICE_FEE_CENTS
  if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
    const n = Number(raw)
    if (Number.isInteger(n) && n > 0) return n
  }
  return 0
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Create (or upsert-preserve) pending payment rows for an approved application.
 *
 * Generates:
 *   - rent (if monthly_rent_cents > 0)
 *   - security_deposit (if resolvable)
 *   - utilities (if utility_fee_cents > 0)
 *   - service_fee (if APPROVAL_SERVICE_FEE_CENTS is set)
 *
 * Returns an object describing what was created/skipped.
 *
 * @param {{
 *   application: {
 *     id: string
 *     applicant_app_user_id: string
 *     property_id: string
 *     room_id?: string | null
 *     lease_start_date?: string | null
 *   }
 * }} params
 * @returns {Promise<{
 *   created: string[]
 *   skipped: string[]
 *   payments: object[]
 * }>}
 */
export async function createApprovalGeneratedPayments({ application }) {
  const appId     = String(application.id               || '').trim()
  const userId    = String(application.applicant_app_user_id || '').trim()
  const propId    = String(application.property_id      || '').trim()
  const roomId    = String(application.room_id          || '').trim() || null

  if (!appId)  throw new Error('createApprovalGeneratedPayments: application.id is required.')
  if (!userId) throw new Error('createApprovalGeneratedPayments: applicant_app_user_id is required.')
  if (!propId) throw new Error('createApprovalGeneratedPayments: property_id is required.')

  const [property, room] = await Promise.all([
    getPropertyById(propId),
    roomId ? getRoomById(roomId) : Promise.resolve(null),
  ])

  const propertyNameSnapshot = property?.name || null
  const roomNumberSnapshot   = room?.name     || null

  const monthlyRentCents  = room?.monthly_rent_cents  ?? 0
  const utilityFeeCents   = room?.utility_fee_cents   ?? 0
  const depositCents      = resolveSecurityDepositCents(monthlyRentCents)
  const serviceFeeCents   = resolveServiceFeeCents()

  const created  = []
  const skipped  = []
  const payments = []

  // Shared base for all generated payments
  const base = {
    app_user_id: userId,
    property_id: propId,
    room_id: roomId,
    application_id: appId,
    currency: 'usd',
    status: 'pending',
    property_name_snapshot: propertyNameSnapshot,
    room_number_snapshot: roomNumberSnapshot,
    ...(application.lease_start_date ? { due_date: application.lease_start_date } : {}),
  }

  // ── Rent ────────────────────────────────────────────────────────────────
  if (monthlyRentCents > 0) {
    const p = await upsertPaymentByAxisPaymentKey({
      ...base,
      axis_payment_key: `approved:${appId}:rent`,
      payment_type: 'rent',
      amount_cents: monthlyRentCents,
      description: `First month rent — ${propertyNameSnapshot || 'property'}${roomNumberSnapshot ? ` / ${roomNumberSnapshot}` : ''}`,
    })
    payments.push(p)
    created.push('rent')
  } else {
    skipped.push('rent (monthly_rent_cents is 0 or room not linked)')
  }

  // ── Security deposit ─────────────────────────────────────────────────────
  if (depositCents > 0) {
    const p = await upsertPaymentByAxisPaymentKey({
      ...base,
      axis_payment_key: `approved:${appId}:security_deposit`,
      payment_type: 'security_deposit',
      amount_cents: depositCents,
      description: `Security deposit — ${propertyNameSnapshot || 'property'}${roomNumberSnapshot ? ` / ${roomNumberSnapshot}` : ''}`,
    })
    payments.push(p)
    created.push('security_deposit')
  } else {
    skipped.push('security_deposit (no configured amount and rent is 0)')
  }

  // ── Utilities ────────────────────────────────────────────────────────────
  if (utilityFeeCents > 0) {
    const p = await upsertPaymentByAxisPaymentKey({
      ...base,
      axis_payment_key: `approved:${appId}:utilities`,
      payment_type: 'utilities',
      amount_cents: utilityFeeCents,
      description: `Utilities — ${propertyNameSnapshot || 'property'}${roomNumberSnapshot ? ` / ${roomNumberSnapshot}` : ''}`,
    })
    payments.push(p)
    created.push('utilities')
  } else {
    skipped.push('utilities (utility_fee_cents is 0 or room not linked)')
  }

  // ── Service fee ──────────────────────────────────────────────────────────
  if (serviceFeeCents > 0) {
    const p = await upsertPaymentByAxisPaymentKey({
      ...base,
      axis_payment_key: `approved:${appId}:service_fee`,
      payment_type: 'service_fee',
      amount_cents: serviceFeeCents,
      description: `Service fee — ${propertyNameSnapshot || 'property'}${roomNumberSnapshot ? ` / ${roomNumberSnapshot}` : ''}`,
    })
    payments.push(p)
    created.push('service_fee')
  }

  return { created, skipped, payments }
}

/**
 * List all internal payments linked to a specific application.
 *
 * @param {{ applicationId: string, status?: string }} params
 * @returns {Promise<object[]>}
 */
export async function listPaymentsForApplication({ applicationId, status } = {}) {
  const aid = String(applicationId || '').trim()
  if (!aid) throw new Error('listPaymentsForApplication: applicationId is required.')
  const client = requireServiceClient()
  let query = client.from('payments').select('*').eq('application_id', aid)
  if (status) query = query.eq('status', status)
  query = query.order('created_at', { ascending: false })
  const { data, error } = await query
  if (error) throw new Error(error.message || 'Failed to list payments for application')
  return data || []
}

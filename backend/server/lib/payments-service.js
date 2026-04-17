/**
 * payments — internal payment ledger (public.payments).
 *
 * All monetary values stored as cents (integers).
 * Idempotent upsert via axis_payment_key for webhook-safe operations.
 * Unique partial indices on axis_payment_key, stripe_payment_intent_id,
 * and stripe_checkout_session_id prevent duplicate records.
 *
 * @module
 */

import { requireServiceClient } from './app-users-service.js'
import { listProperties } from './properties-service.js'

// ─── Constants ────────────────────────────────────────────────────────────────

export const PAYMENT_STATUS_PENDING   = 'pending'
export const PAYMENT_STATUS_COMPLETED = 'completed'
export const PAYMENT_STATUS_FAILED    = 'failed'
export const PAYMENT_STATUS_REFUNDED  = 'refunded'
export const PAYMENT_STATUS_CANCELLED = 'cancelled'

export const PAYMENT_STATUS_VALUES = [
  PAYMENT_STATUS_PENDING,
  PAYMENT_STATUS_COMPLETED,
  PAYMENT_STATUS_FAILED,
  PAYMENT_STATUS_REFUNDED,
  PAYMENT_STATUS_CANCELLED,
]

export const PAYMENT_TYPE_APPLICATION_FEE = 'application_fee'
export const PAYMENT_TYPE_RENT            = 'rent'
export const PAYMENT_TYPE_SECURITY_DEPOSIT = 'security_deposit'
export const PAYMENT_TYPE_UTILITIES       = 'utilities'
export const PAYMENT_TYPE_SERVICE_FEE     = 'service_fee'
export const PAYMENT_TYPE_OTHER           = 'other'

export const PAYMENT_TYPE_VALUES = [
  PAYMENT_TYPE_APPLICATION_FEE,
  PAYMENT_TYPE_RENT,
  PAYMENT_TYPE_SECURITY_DEPOSIT,
  PAYMENT_TYPE_UTILITIES,
  PAYMENT_TYPE_SERVICE_FEE,
  PAYMENT_TYPE_OTHER,
]

// ─── Normalizers ──────────────────────────────────────────────────────────────

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizePaymentStatus(value) {
  if (value === null || value === undefined) return PAYMENT_STATUS_PENDING
  const s = String(value).trim().toLowerCase()
  const match = PAYMENT_STATUS_VALUES.find((v) => v === s)
  if (!match) throw new Error(`Invalid payment status "${value}". Must be one of: ${PAYMENT_STATUS_VALUES.join(' | ')}.`)
  return match
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizePaymentType(value) {
  if (!value) throw new Error(`payment_type is required. Must be one of: ${PAYMENT_TYPE_VALUES.join(' | ')}.`)
  const s = String(value).trim().toLowerCase().replace(/ /g, '_')
  const match = PAYMENT_TYPE_VALUES.find((v) => v === s)
  if (!match) throw new Error(`Invalid payment_type "${value}". Must be one of: ${PAYMENT_TYPE_VALUES.join(' | ')}.`)
  return match
}

/**
 * @param {unknown} value
 * @param {number} maxLen
 * @param {string} fieldName
 * @returns {string | null}
 */
function normalizeNullableTextField(value, maxLen, fieldName) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new Error(`${fieldName} must be a string or null.`)
  const s = value.trim()
  if (s.length > maxLen) throw new Error(`${fieldName} exceeds max length (${maxLen}).`)
  return s.length ? s : null
}

/**
 * @param {unknown} value
 * @param {string} fieldName
 * @returns {string | null}
 */
function normalizeNullableDate(value, fieldName) {
  if (value === null || value === undefined) return null
  const s = String(value).trim()
  if (!s) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`${fieldName} must be a date in YYYY-MM-DD format.`)
  return s
}

/**
 * @param {unknown} value
 * @param {string} fieldName
 * @returns {number | null}
 */
function normalizeNullableNonNegativeInt(value, fieldName) {
  if (value === null || value === undefined) return null
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0) throw new Error(`${fieldName} must be a non-negative integer.`)
  return n
}

/**
 * Validate and normalize amount_cents. Must be >= 0.
 * @param {unknown} value
 * @returns {number}
 */
function normalizeAmountCents(value) {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0) throw new Error('amount_cents must be a non-negative integer.')
  return n
}

/**
 * Build a DB payload from raw args. Only keys explicitly present are included.
 */
function buildPayload(args, { requireCore = false } = {}) {
  const p = {}

  if (requireCore) {
    if (args.amount_cents === undefined || args.amount_cents === null) throw new Error('amount_cents is required.')
    if (!args.payment_type) throw new Error('payment_type is required.')
    p.amount_cents = normalizeAmountCents(args.amount_cents)
    p.payment_type = normalizePaymentType(args.payment_type)
  }

  if (args.amount_cents   !== undefined && !requireCore) p.amount_cents   = normalizeAmountCents(args.amount_cents)
  if (args.payment_type   !== undefined && !requireCore) p.payment_type   = normalizePaymentType(args.payment_type)

  if (args.status         !== undefined) p.status         = normalizePaymentStatus(args.status)
  if (args.currency       !== undefined) p.currency        = normalizeNullableTextField(args.currency, 10, 'currency') || 'usd'

  if (args.app_user_id    !== undefined) p.app_user_id    = args.app_user_id    || null
  if (args.property_id    !== undefined) p.property_id    = args.property_id    || null
  if (args.room_id        !== undefined) p.room_id        = args.room_id        || null
  if (args.application_id !== undefined) p.application_id = args.application_id || null

  if (args.category       !== undefined) p.category       = normalizeNullableTextField(args.category, 200, 'category')
  if (args.kind           !== undefined) p.kind           = normalizeNullableTextField(args.kind, 200, 'kind')
  if (args.line_item_type !== undefined) p.line_item_type = normalizeNullableTextField(args.line_item_type, 200, 'line_item_type')

  if (args.due_date  !== undefined) p.due_date  = normalizeNullableDate(args.due_date, 'due_date')
  if (args.paid_at   !== undefined) p.paid_at   = args.paid_at || null

  if (args.description    !== undefined) p.description    = normalizeNullableTextField(args.description, 2000, 'description')
  if (args.notes          !== undefined) p.notes          = normalizeNullableTextField(args.notes, 20000, 'notes')

  if (args.stripe_checkout_session_id !== undefined) p.stripe_checkout_session_id = normalizeNullableTextField(args.stripe_checkout_session_id, 300, 'stripe_checkout_session_id')
  if (args.stripe_payment_intent_id   !== undefined) p.stripe_payment_intent_id   = normalizeNullableTextField(args.stripe_payment_intent_id, 300, 'stripe_payment_intent_id')
  if (args.stripe_charge_id           !== undefined) p.stripe_charge_id           = normalizeNullableTextField(args.stripe_charge_id, 300, 'stripe_charge_id')
  if (args.stripe_event_id            !== undefined) p.stripe_event_id            = normalizeNullableTextField(args.stripe_event_id, 300, 'stripe_event_id')

  if (args.axis_payment_key           !== undefined) p.axis_payment_key           = normalizeNullableTextField(args.axis_payment_key, 500, 'axis_payment_key')

  if (args.property_name_snapshot !== undefined) p.property_name_snapshot = normalizeNullableTextField(args.property_name_snapshot, 500, 'property_name_snapshot')
  if (args.room_number_snapshot   !== undefined) p.room_number_snapshot   = normalizeNullableTextField(args.room_number_snapshot, 200, 'room_number_snapshot')

  if (args.balance_cents !== undefined) p.balance_cents = normalizeNullableNonNegativeInt(args.balance_cents, 'balance_cents')

  return p
}

function deduplicateError(error) {
  if (error?.code !== '23505') return null
  const detail = String(error.constraint || '')
  if (detail.includes('axis_payment_key'))            return 'A payment with this axis_payment_key already exists.'
  if (detail.includes('stripe_payment_intent'))       return 'A payment with this stripe_payment_intent_id already exists.'
  if (detail.includes('stripe_checkout_session'))     return 'A payment with this stripe_checkout_session_id already exists.'
  return 'A duplicate payment record was detected.'
}

// ─── Reads ────────────────────────────────────────────────────────────────────

/**
 * @param {string} id
 * @returns {Promise<object | null>}
 */
export async function getPaymentById(id) {
  const pid = String(id || '').trim()
  if (!pid) return null
  const client = requireServiceClient()
  const { data, error } = await client.from('payments').select('*').eq('id', pid).maybeSingle()
  if (error) throw new Error(error.message || 'Failed to load payment')
  return data || null
}

/**
 * Find a payment by axis_payment_key.
 * @param {string} key
 * @returns {Promise<object | null>}
 */
export async function getPaymentByAxisPaymentKey(key) {
  const k = String(key || '').trim()
  if (!k) return null
  const client = requireServiceClient()
  const { data, error } = await client.from('payments').select('*').eq('axis_payment_key', k).maybeSingle()
  if (error) throw new Error(error.message || 'Failed to query payment by axis_payment_key')
  return data || null
}

/**
 * Find a payment by stripe_checkout_session_id.
 * @param {string} sessionId
 * @returns {Promise<object | null>}
 */
export async function getPaymentByStripeCheckoutSessionId(sessionId) {
  const id = String(sessionId || '').trim()
  if (!id) return null
  const client = requireServiceClient()
  const { data, error } = await client.from('payments').select('*').eq('stripe_checkout_session_id', id).maybeSingle()
  if (error) throw new Error(error.message || 'Failed to query payment by stripe_checkout_session_id')
  return data || null
}

/**
 * Find a payment by stripe_payment_intent_id.
 * @param {string} piId
 * @returns {Promise<object | null>}
 */
export async function getPaymentByStripePaymentIntentId(piId) {
  const id = String(piId || '').trim()
  if (!id) return null
  const client = requireServiceClient()
  const { data, error } = await client.from('payments').select('*').eq('stripe_payment_intent_id', id).maybeSingle()
  if (error) throw new Error(error.message || 'Failed to query payment by stripe_payment_intent_id')
  return data || null
}

/**
 * Try to find an internal payment using Stripe identifiers in priority order:
 * axis_payment_key → stripe_checkout_session_id → stripe_payment_intent_id
 *
 * @param {{ axisPaymentKey?: string, checkoutSessionId?: string, paymentIntentId?: string }} ids
 * @returns {Promise<object | null>}
 */
export async function findPaymentByStripeIdentifiers({ axisPaymentKey, checkoutSessionId, paymentIntentId } = {}) {
  if (axisPaymentKey) {
    const p = await getPaymentByAxisPaymentKey(axisPaymentKey)
    if (p) return p
  }
  if (checkoutSessionId) {
    const p = await getPaymentByStripeCheckoutSessionId(checkoutSessionId)
    if (p) return p
  }
  if (paymentIntentId) {
    const p = await getPaymentByStripePaymentIntentId(paymentIntentId)
    if (p) return p
  }
  return null
}

/**
 * List payments for a specific app_user (their own ledger).
 *
 * @param {{ appUserId: string, status?: string, paymentType?: string, limit?: number }} args
 * @returns {Promise<object[]>}
 */
export async function listPaymentsForAppUser({ appUserId, status, paymentType, limit = 200 } = {}) {
  const id = String(appUserId || '').trim()
  if (!id) throw new Error('listPaymentsForAppUser: appUserId is required.')
  const client = requireServiceClient()
  let query = client.from('payments').select('*').eq('app_user_id', id)
  if (status)      query = query.eq('status', normalizePaymentStatus(status))
  if (paymentType) query = query.eq('payment_type', normalizePaymentType(paymentType))
  query = query.order('created_at', { ascending: false }).limit(limit)
  const { data, error } = await query
  if (error) throw new Error(error.message || 'Failed to list payments')
  return data || []
}

/**
 * List all payments linked to a specific internal application.
 *
 * @param {{ applicationId: string, status?: string }} params
 * @returns {Promise<object[]>}
 */
export async function listPaymentsForApplication({ applicationId, status } = {}) {
  const aid = String(applicationId || '').trim()
  if (!aid) throw new Error('listPaymentsForApplication: applicationId is required.')
  const client = requireServiceClient()
  let query = client.from('payments').select('*').eq('application_id', aid)
  if (status) query = query.eq('status', normalizePaymentStatus(status))
  query = query.order('created_at', { ascending: false })
  const { data, error } = await query
  if (error) throw new Error(error.message || 'Failed to list payments for application')
  return data || []
}

/**
 * List payments scoped to a property (manager/owner/admin view).
 *
 * @param {{ propertyId: string, status?: string, paymentType?: string, limit?: number }} args
 * @returns {Promise<object[]>}
 */
export async function listPaymentsForPropertyScope({ propertyId, status, paymentType, limit = 200 } = {}) {
  const pid = String(propertyId || '').trim()
  if (!pid) throw new Error('listPaymentsForPropertyScope: propertyId is required.')
  const client = requireServiceClient()
  let query = client.from('payments').select('*').eq('property_id', pid)
  if (status)      query = query.eq('status', normalizePaymentStatus(status))
  if (paymentType) query = query.eq('payment_type', normalizePaymentType(paymentType))
  query = query.order('created_at', { ascending: false }).limit(limit)
  const { data, error } = await query
  if (error) throw new Error(error.message || 'Failed to list payments')
  return data || []
}

/**
 * All payments for properties managed by this manager (internal ledger).
 *
 * @param {{ managerAppUserId: string, limit?: number }} args
 * @returns {Promise<object[]>}
 */
export async function listPaymentsForManagedPropertiesScope({ managerAppUserId, limit = 1200 } = {}) {
  const uid = String(managerAppUserId || '').trim()
  if (!uid) throw new Error('listPaymentsForManagedPropertiesScope: managerAppUserId is required.')
  const props = await listProperties({ managedByAppUserId: uid, activeOnly: false })
  const ids = [...new Set((props || []).map((p) => String(p.id || '').trim()).filter(Boolean))]
  if (!ids.length) return []
  const client = requireServiceClient()
  const { data, error } = await client
    .from('payments')
    .select('*')
    .in('property_id', ids)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message || 'Failed to list payments for managed properties')
  return data || []
}

/**
 * Full ledger read for admin dashboards (service role; caller authorization in handler).
 *
 * @param {{ limit?: number }} [args]
 * @returns {Promise<object[]>}
 */
export async function listAllPaymentsForAdmin({ limit = 4000 } = {}) {
  const client = requireServiceClient()
  const { data, error } = await client
    .from('payments')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message || 'Failed to list all payments')
  return data || []
}

// ─── Writes ───────────────────────────────────────────────────────────────────

/**
 * Create a payment record.
 *
 * @param {{ amount_cents: number, payment_type: string, [key: string]: unknown }} args
 * @returns {Promise<object>}
 */
export async function createPayment(args) {
  const payload = buildPayload(args, { requireCore: true })
  if (!payload.status) payload.status = PAYMENT_STATUS_PENDING

  const client = requireServiceClient()
  const { data, error } = await client.from('payments').insert(payload).select('*').single()

  const dupMsg = deduplicateError(error)
  if (dupMsg) throw new Error(dupMsg)
  if (error) throw new Error(error.message || 'Failed to create payment')
  return data
}

/**
 * Partial update. Caller must verify authorization.
 *
 * @param {{ id: string, [key: string]: unknown }} args
 * @returns {Promise<object>}
 */
export async function updatePayment(args) {
  const id = String(args.id || '').trim()
  if (!id) throw new Error('updatePayment: id is required.')

  const updates = buildPayload(args)
  if (Object.keys(updates).length === 0) {
    throw new Error('updatePayment: at least one field must be provided to update.')
  }

  const client = requireServiceClient()
  const { data, error } = await client.from('payments').update(updates).eq('id', id).select('*').single()

  const dupMsg = deduplicateError(error)
  if (dupMsg) throw new Error(dupMsg)
  if (error) throw new Error(error.message || 'Failed to update payment')
  return data
}

/**
 * Mark payment as completed (e.g. after Stripe webhook confirmation).
 *
 * @param {{ id: string, stripe_charge_id?: string, stripe_event_id?: string, paid_at?: string }} args
 * @returns {Promise<object>}
 */
export async function markPaymentCompleted({ id, stripe_charge_id, stripe_event_id, paid_at } = {}) {
  const aid = String(id || '').trim()
  if (!aid) throw new Error('markPaymentCompleted: id is required.')

  const updates = {
    status: PAYMENT_STATUS_COMPLETED,
    paid_at: paid_at || new Date().toISOString(),
  }
  if (stripe_charge_id) updates.stripe_charge_id = String(stripe_charge_id).trim()
  if (stripe_event_id)  updates.stripe_event_id  = String(stripe_event_id).trim()

  const client = requireServiceClient()
  const { data, error } = await client.from('payments').update(updates).eq('id', aid).select('*').single()
  if (error) throw new Error(error.message || 'Failed to mark payment completed')
  return data
}

/**
 * Mark payment as failed.
 *
 * @param {{ id: string, stripe_event_id?: string }} args
 * @returns {Promise<object>}
 */
export async function markPaymentFailed({ id, stripe_event_id } = {}) {
  const aid = String(id || '').trim()
  if (!aid) throw new Error('markPaymentFailed: id is required.')

  const updates = { status: PAYMENT_STATUS_FAILED }
  if (stripe_event_id) updates.stripe_event_id = String(stripe_event_id).trim()

  const client = requireServiceClient()
  const { data, error } = await client.from('payments').update(updates).eq('id', aid).select('*').single()
  if (error) throw new Error(error.message || 'Failed to mark payment failed')
  return data
}

/**
 * Mark payment as refunded.
 *
 * @param {{ id: string, stripe_event_id?: string }} args
 * @returns {Promise<object>}
 */
export async function markPaymentRefunded({ id, stripe_event_id } = {}) {
  const aid = String(id || '').trim()
  if (!aid) throw new Error('markPaymentRefunded: id is required.')

  const updates = { status: PAYMENT_STATUS_REFUNDED }
  if (stripe_event_id) updates.stripe_event_id = String(stripe_event_id).trim()

  const client = requireServiceClient()
  const { data, error } = await client.from('payments').update(updates).eq('id', aid).select('*').single()
  if (error) throw new Error(error.message || 'Failed to mark payment refunded')
  return data
}

/**
 * Idempotent upsert keyed on axis_payment_key. Safe for webhook replay.
 * If no record exists, creates one. If one exists, merges the update fields.
 *
 * @param {{
 *   axis_payment_key: string
 *   amount_cents: number
 *   payment_type: string
 *   [key: string]: unknown
 * }} args
 * @returns {Promise<object>}
 */
export async function upsertPaymentByAxisPaymentKey(args) {
  const key = String(args.axis_payment_key || '').trim()
  if (!key) throw new Error('upsertPaymentByAxisPaymentKey: axis_payment_key is required.')

  const payload = buildPayload(args, { requireCore: true })
  if (!payload.status) payload.status = PAYMENT_STATUS_PENDING

  const client = requireServiceClient()
  const { data, error } = await client
    .from('payments')
    .upsert(payload, { onConflict: 'axis_payment_key', ignoreDuplicates: false })
    .select('*')
    .single()

  if (error) throw new Error(error.message || 'Failed to upsert payment')
  return data
}

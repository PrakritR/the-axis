/**
 * Room cleaning work orders:
 * - **Legacy prepaid:** Payments row first (AXIS_ROOM_CLEANING_PREPAID), then WO with AXIS_ROOM_CLEANING_WO_FOR_PAYMENT:rec…
 * - **Post-pay (resident portal):** Resident submits WO from Create work order → Category Cleaning;
 *   Description includes AXIS_ROOM_CLEANING_BILL_ON_SCHEDULE. When manager sets Scheduled Date,
 *   portal creates a Payments row tagged AXIS_ROOM_CLEANING_PAYMENT_FOR_WO:rec….
 */

import { createPaymentRecord, getPaymentsForResident } from './airtable.js'
import { computedResidentPaymentStatusLabel } from './residentPaymentsShared.js'
import { workOrderScheduledMeta } from './workOrderShared.js'

export const ROOM_CLEANING_PAYMENT_MARKER = 'AXIS_ROOM_CLEANING_PREPAID'
export const ROOM_CLEANING_WO_FOR_PAYMENT = 'AXIS_ROOM_CLEANING_WO_FOR_PAYMENT:'
/** Appended to Description when resident requests cleaning via main work order form (bill after manager schedules). */
export const ROOM_CLEANING_BILL_ON_SCHEDULE_MARKER = 'AXIS_ROOM_CLEANING_BILL_ON_SCHEDULE'
/** Payments.Notes contains this + work order record id when fee was created on schedule. */
export const ROOM_CLEANING_PAYMENT_FOR_WO = 'AXIS_ROOM_CLEANING_PAYMENT_FOR_WO:'
export const ROOM_CLEANING_FEE_USD = 10

/** Suffix appended server-side style on resident submit (Category Cleaning). */
export function residentPostpayCleaningDescriptionSuffix() {
  return `\n\n${ROOM_CLEANING_BILL_ON_SCHEDULE_MARKER}`
}

export function isPrepaidLinkedRoomCleaningWorkOrder(wo) {
  const d = String(wo?.Description || '')
  return d.includes(ROOM_CLEANING_WO_FOR_PAYMENT)
}

/** True when scheduling this WO should create a resident Payment row (post-pay flow). */
export function workOrderShouldCreatePaymentWhenScheduled(wo) {
  if (!wo || typeof wo !== 'object') return false
  if (isPrepaidLinkedRoomCleaningWorkOrder(wo)) return false
  const d = String(wo?.Description || '')
  if (!d.includes(ROOM_CLEANING_BILL_ON_SCHEDULE_MARKER)) return false
  const cat = String(wo?.Category || '').trim().toLowerCase()
  if (!cat) return true
  if (cat === 'cleaning' || cat === 'room cleaning' || cat.includes('cleaning')) return true
  return false
}

function unknownPaymentFieldFromAirtableError(err) {
  const raw = String(err?.message || '')
  try {
    const j = JSON.parse(raw)
    const m = j?.error?.message
    const match = typeof m === 'string' ? m.match(/Unknown field name:\s*"([^"]+)"/i) : null
    return match ? match[1] : null
  } catch {
    const match = raw.match(/Unknown field name:\s*"([^"]+)"/i)
    return match ? match[1] : null
  }
}

async function createPaymentRecordStrippingUnknownFields(fields) {
  let f = { ...fields }
  for (let attempt = 0; attempt < 16; attempt += 1) {
    try {
      return await createPaymentRecord(f)
    } catch (e) {
      const u = unknownPaymentFieldFromAirtableError(e)
      if (u && Object.prototype.hasOwnProperty.call(f, u)) {
        const next = { ...f }
        delete next[u]
        f = next
        continue
      }
      throw e
    }
  }
  throw new Error('Could not create payment row (too many unknown fields).')
}

/**
 * Creates the $10 post-pay room cleaning fee row if the work order is scheduled, eligible, and not already billed.
 * @returns {Promise<{ created: boolean, reason?: string }>}
 */
export async function ensurePostpayRoomCleaningFeePayment({
  workOrder,
  billingResidentId,
  residentProfile,
  paymentsPrefetch,
}) {
  const woId = String(workOrder?.id || '').trim()
  const rid = String(billingResidentId || '').trim()
  if (!woId || !rid) return { created: false, reason: 'missing_ids' }
  if (!workOrderShouldCreatePaymentWhenScheduled(workOrder)) return { created: false, reason: 'not_eligible' }

  const sm = workOrderScheduledMeta(workOrder)
  const dateStr = sm?.date || ''
  if (!dateStr) return { created: false, reason: 'no_schedule_date' }

  const tag = paymentNotesTagForCleaningWorkOrder(woId)
  const payments =
    paymentsPrefetch != null
      ? paymentsPrefetch
      : await getPaymentsForResident({ id: rid }).catch(() => [])
  if ((Array.isArray(payments) ? payments : []).some((p) => String(p.Notes || '').includes(tag))) {
    return { created: false, reason: 'already_exists' }
  }

  const res = residentProfile && typeof residentProfile === 'object' ? residentProfile : {}
  const prop = String(res.House || '').trim()
  const unit = String(res['Unit Number'] || '').trim()
  const name = String(res.Name || res['Resident Name'] || '').trim()

  await createPaymentRecordStrippingUnknownFields({
    Resident: [rid],
    Amount: ROOM_CLEANING_FEE_USD,
    Balance: ROOM_CLEANING_FEE_USD,
    Status: 'Unpaid',
    Type: 'Room cleaning fee',
    Category: 'Fee',
    Month: 'One-time room cleaning',
    Notes: `${tag} Scheduled visit ${dateStr}. ${String(workOrder.Title || 'Room cleaning').trim()}`,
    'Due Date': dateStr,
    'Property Name': prop || undefined,
    'Room Number': unit || undefined,
    'Resident Name': name || undefined,
  })

  return { created: true }
}

export function paymentNotesTagForCleaningWorkOrder(woId) {
  return `${ROOM_CLEANING_PAYMENT_FOR_WO}${String(woId || '').trim()}`
}

export function isRoomCleaningPrepaidPayment(p) {
  if (!p || typeof p !== 'object') return false
  const notes = String(p.Notes || '')
  if (notes.includes(ROOM_CLEANING_PAYMENT_MARKER)) return true
  const blob = `${p.Type || ''} ${p.Month || ''}`.toLowerCase()
  return /room\s*cleaning/.test(blob)
}

/** Unpaid room-cleaning fee row (at most one should be created at a time by the portal). */
export function roomCleaningPrepaidUnpaid(payments) {
  return (
    (Array.isArray(payments) ? payments : []).find(
      (p) => isRoomCleaningPrepaidPayment(p) && computedResidentPaymentStatusLabel(p) !== 'Paid',
    ) ?? null
  )
}

function workOrderClaimsPayment(wo, paymentId) {
  const pid = String(paymentId || '').trim()
  if (!pid) return false
  const tag = `${ROOM_CLEANING_WO_FOR_PAYMENT}${pid}`
  const d = String(wo?.Description || '')
  const m = String(wo?.['Management Notes'] || '')
  return d.includes(tag) || m.includes(tag)
}

/** Paid cleaning fees that do not yet have a linked work order (FIFO: oldest first). */
export function paidRoomCleaningPaymentsWithoutWorkOrder(payments, workOrders) {
  const wos = Array.isArray(workOrders) ? workOrders : []
  const paid = (Array.isArray(payments) ? payments : [])
    .filter((p) => isRoomCleaningPrepaidPayment(p) && computedResidentPaymentStatusLabel(p) === 'Paid')
    .filter((p) => p.id && !wos.some((wo) => workOrderClaimsPayment(wo, p.id)))
    .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0))
  return paid
}

export function nextPaidRoomCleaningWithoutWorkOrder(payments, workOrders) {
  const q = paidRoomCleaningPaymentsWithoutWorkOrder(payments, workOrders)
  return q[0] || null
}

export function roomCleaningWorkOrderDescriptionBody(paymentId, resident) {
  const unit = String(resident?.['Unit Number'] || '').trim()
  const house = String(resident?.House || '').trim()
  const home = [house, unit].filter(Boolean).join(' · ') || 'Resident unit'
  return (
    `One-time room cleaning (prepaid). Resident requested cleaning for: ${home}.\n\n` +
    `Payment record: ${paymentId}\n\n` +
    `${ROOM_CLEANING_WO_FOR_PAYMENT}${paymentId}`
  )
}

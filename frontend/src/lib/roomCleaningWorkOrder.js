/**
 * Room cleaning work orders:
 * - **Legacy prepaid:** Payments row first (AXIS_ROOM_CLEANING_PREPAID), then WO with AXIS_ROOM_CLEANING_WO_FOR_PAYMENT:rec…
 * - **Post-pay (resident portal):** Resident submits WO from Create work order → Category Cleaning;
 *   Description includes AXIS_ROOM_CLEANING_BILL_ON_SCHEDULE. When manager sets Scheduled Date,
 *   portal creates a Payments row tagged AXIS_ROOM_CLEANING_PAYMENT_FOR_WO:rec….
 */

import { computedResidentPaymentStatusLabel } from './residentPaymentsShared.js'

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
  const cat = String(wo?.Category || '').trim().toLowerCase()
  if (cat !== 'cleaning') return false
  if (isPrepaidLinkedRoomCleaningWorkOrder(wo)) return false
  const d = String(wo?.Description || '')
  return d.includes(ROOM_CLEANING_BILL_ON_SCHEDULE_MARKER)
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

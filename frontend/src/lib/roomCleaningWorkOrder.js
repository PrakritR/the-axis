/**
 * One-time room cleaning: resident pays a fixed fee in Payments first; only then a Work Order
 * is created for managers. Markers are stored in Payments.Notes and Work Orders.Description.
 */

import { computedResidentPaymentStatusLabel } from './residentPaymentsShared.js'

export const ROOM_CLEANING_PAYMENT_MARKER = 'AXIS_ROOM_CLEANING_PREPAID'
export const ROOM_CLEANING_WO_FOR_PAYMENT = 'AXIS_ROOM_CLEANING_WO_FOR_PAYMENT:'
export const ROOM_CLEANING_FEE_USD = 10

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

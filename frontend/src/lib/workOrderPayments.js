/**
 * Work order manager-assigned charges → resident Payments (same table as rent/fees).
 * Idempotent per work order via Notes marker.
 */

import { createPaymentRecord, getPaymentsForResident } from './airtable.js'

function paymentPropertyNameFromResident(res) {
  const explicit = String(res?.['Property Name'] || '').trim()
  if (explicit) return explicit
  const h = res?.House
  if (Array.isArray(h)) {
    for (const x of h) {
      const s = String(x ?? '').trim()
      if (s && !/^rec[a-zA-Z0-9]{14,}$/.test(s)) return s
    }
  }
  if (typeof h === 'string' && h.trim() && !/^rec[a-zA-Z0-9]{14,}$/.test(h.trim())) return h.trim()
  return ''
}

export const WORK_ORDER_MANAGER_CHARGE_TAG = 'AXIS_WORK_ORDER_CHARGE_FOR_WO:'
export const MANAGER_MANUAL_PAYMENT_MARKER = 'AXIS_MANAGER_MANUAL_PAYMENT'

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

export function workOrderManagerChargeFieldName() {
  return String(import.meta.env.VITE_AIRTABLE_WORK_ORDER_COST_FIELD || 'Cost').trim() || 'Cost'
}

/** Read a numeric cost from a Work Orders row (tries env field name then common fallbacks). */
export function readWorkOrderCostFromRecord(record) {
  if (!record || typeof record !== 'object') return 0
  const keys = [
    workOrderManagerChargeFieldName(),
    'Cost',
    'Work Order Cost',
    'Charge',
    'Billable Amount',
  ]
  for (const k of keys) {
    const raw = record[k]
    if (raw == null || raw === '') continue
    const n = typeof raw === 'number' ? raw : Number.parseFloat(String(raw).replace(/[^0-9.-]/g, ''))
    if (Number.isFinite(n) && n >= 0) return n
  }
  return 0
}

export function paymentNotesTagForWorkOrderCharge(woId) {
  return `${WORK_ORDER_MANAGER_CHARGE_TAG}${String(woId || '').trim()}`
}

/**
 * Creates one Unpaid Payments row for a manager-set work order cost (at most one per WO id).
 * @returns {Promise<{ created: boolean, reason?: string }>}
 */
export async function ensureWorkOrderManagerChargePayment({
  workOrder,
  costUsd,
  billingResidentId,
  residentProfile,
  paymentsPrefetch,
}) {
  const woId = String(workOrder?.id || '').trim()
  const rid = String(billingResidentId || '').trim()
  const cost = Number(costUsd)
  if (!woId || !/^rec[a-zA-Z0-9]{14,}$/.test(rid) || !(cost > 0) || !Number.isFinite(cost)) {
    return { created: false, reason: 'invalid' }
  }

  const tag = paymentNotesTagForWorkOrderCharge(woId)
  const payments =
    paymentsPrefetch != null ? paymentsPrefetch : await getPaymentsForResident({ id: rid }).catch(() => [])
  if ((Array.isArray(payments) ? payments : []).some((p) => String(p.Notes || '').includes(tag))) {
    return { created: false, reason: 'already_exists' }
  }

  const res = residentProfile && typeof residentProfile === 'object' ? residentProfile : {}
  const prop = paymentPropertyNameFromResident(res)
  const unit = String(res['Unit Number'] || '').trim()
  const name = String(res.Name || res['Resident Name'] || '').trim()
  const due = new Date()
  due.setDate(due.getDate() + 14)
  const dueStr = due.toISOString().slice(0, 10)

  await createPaymentRecordStrippingUnknownFields({
    Resident: [rid],
    Amount: Math.round(cost * 100) / 100,
    Balance: Math.round(cost * 100) / 100,
    Status: 'Unpaid',
    Type: 'Work order charge',
    Category: 'Fee',
    Month: 'One-time',
    Notes: `${tag} ${String(workOrder.Title || workOrder.Description || 'Work order').trim()}`.slice(0, 8000),
    'Due Date': dueStr,
    'Property Name': prop || undefined,
    'Room Number': unit || undefined,
    'Resident Name': name || undefined,
  })

  return { created: true }
}

/**
 * Manager-entered payment line for a resident (not tied to a work order).
 */
export async function createResidentManualPaymentLine({
  billingResidentId,
  amountUsd,
  typeLabel,
  notes,
  dueDateIso,
  residentProfile,
}) {
  const rid = String(billingResidentId || '').trim()
  const amt = Number(amountUsd)
  if (!/^rec[a-zA-Z0-9]{14,}$/.test(rid) || !(amt > 0) || !Number.isFinite(amt)) {
    throw new Error('Select a resident and enter a valid amount greater than zero.')
  }

  const res = residentProfile && typeof residentProfile === 'object' ? residentProfile : {}
  const prop = paymentPropertyNameFromResident(res)
  const unit = String(res['Unit Number'] || '').trim()
  const name = String(res.Name || res['Resident Name'] || '').trim()
  const due = String(dueDateIso || '').trim().slice(0, 10) || new Date().toISOString().slice(0, 10)
  const stamp = new Date().toISOString()
  const type = String(typeLabel || 'Fee').trim() || 'Fee'
  const extra = String(notes || '').trim()

  await createPaymentRecordStrippingUnknownFields({
    Resident: [rid],
    Amount: Math.round(amt * 100) / 100,
    Balance: Math.round(amt * 100) / 100,
    Status: 'Unpaid',
    Type: type.slice(0, 120),
    Category: 'Fee',
    Month: 'Manager manual',
    Notes: [MANAGER_MANUAL_PAYMENT_MARKER, stamp, extra].filter(Boolean).join(' · ').slice(0, 8000),
    'Due Date': due,
    'Property Name': prop || undefined,
    'Room Number': unit || undefined,
    'Resident Name': name || undefined,
  })
}

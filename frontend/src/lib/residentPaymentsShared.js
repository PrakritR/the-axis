/**
 * Shared resident payment classification + Airtable reconciliation + post-Stripe finalize.
 * Keeps Manager and Resident portals aligned on how "rent" vs fees vs move-in lines are read.
 */

import { isFeeWaivePaymentRecord } from '../../../shared/lease-access-requirements.js'
import { buildPaymentResidentLinkFields } from './airtable.js'

/**
 * Resident Profile `House` field may be a linked-record array of property record IDs.
 * Return the first human-readable (non-record-ID) string, or ''.
 */
function resolveHouseText(houseField) {
  if (typeof houseField === 'string') {
    const s = houseField.trim()
    if (s && !/^rec[A-Za-z0-9]{14,}$/.test(s)) return s
  } else if (Array.isArray(houseField)) {
    for (const x of houseField) {
      const s = String(x ?? '').trim()
      if (s && !/^rec[A-Za-z0-9]{14,}$/.test(s)) return s
    }
  }
  return ''
}

function paymentRawBlob(payment) {
  if (!payment || typeof payment !== 'object') return ''
  return [payment.Type, payment.Category, payment.Kind, payment['Line Item Type'], payment.Month, payment.Notes]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

/** Rent-like rows for lists (excludes damage-type fees; includes recurring utilities with rent bucket). */
export function getPaymentKind(payment) {
  if (!payment || typeof payment !== 'object') return 'rent'
  if (isFeeWaivePaymentRecord(payment)) return 'waiver'
  const raw = paymentRawBlob(payment)
  if (
    /(room\s*hold|hold(ing)?\s*fee|unit\s*hold|application\s*hold|reservation\s*(fee|hold))/i.test(raw) &&
    !/return|refund/i.test(raw)
  ) {
    return 'fee'
  }
  // Recurring monthly utilities (flat fee) — same bucket as rent for "Fees & extras" vs main schedule
  if (
    /(utilities\s*fee|utility\s*fee|flat\s*utilities|monthly\s*utilities)/i.test(raw) &&
    !/(first|1st|move-?in|initial|prorate)/i.test(raw) &&
    !/(damage|late fee|late charge|cleaning|lockout|fine)/i.test(raw)
  ) {
    return 'rent'
  }
  if (/(fee|fine|damage|late fee|late charge|cleaning|lockout)/.test(raw)) return 'fee'
  return 'rent'
}

/** Post-pay room cleaning fee created when a cleaning WO is scheduled (internal tag in Notes). */
const POSTPAY_ROOM_CLEANING_PAYMENT_MARKER = 'AXIS_ROOM_CLEANING_PAYMENT_FOR_WO:'

export function isPostpayRoomCleaningPaymentRecord(p) {
  return String(p?.Notes || '').includes(POSTPAY_ROOM_CLEANING_PAYMENT_MARKER)
}

/** Strip internal AXIS_* tags from manager/resident-facing copy. */
export function formatPaymentNotesForDisplay(notes) {
  let s = String(notes || '').trim()
  if (!s) return ''
  s = s.replace(new RegExp(`${POSTPAY_ROOM_CLEANING_PAYMENT_MARKER}\\S*`, 'g'), '').trim()
  s = s.replace(/AXIS_ROOM_CLEANING_[A-Z0-9_]+:?\S*/g, '').trim()
  s = s.replace(/\s+/g, ' ').trim()
  return s || '—'
}

/** Short title for Payments rows (manager table + detail). */
export function managerPaymentLineDisplayTitle(p) {
  if (!p || typeof p !== 'object') return 'Charge'
  if (isPostpayRoomCleaningPaymentRecord(p)) return 'Room cleaning (work order)'
  const rawBlob = paymentRawBlob(p)
  if (/application\s*fee/i.test(rawBlob) && !/refund/i.test(rawBlob)) return 'Application fee'
  const cls = classifyResidentPaymentLine(p)
  if (cls === 'deposit') return 'Security deposit'
  if (cls === 'hold_fee') return 'Room hold fee'
  if (cls === 'first_rent') return 'First month rent'
  if (cls === 'first_utilities') return 'First month utilities'
  if (cls === 'monthly_rent') return String(p.Month || p.Type || 'Monthly rent').trim() || 'Monthly rent'
  if (cls === 'monthly_utilities') return String(p.Month || p.Type || 'Monthly utilities').trim() || 'Monthly utilities'
  if (cls === 'fee') return String(p.Month || p.Type || 'Fee / extra').trim() || 'Fee / extra'
  if (cls === 'fee_waive') return 'Fee waiver'
  const month = String(p.Month || '').trim()
  const typ = String(p.Type || '').trim()
  if (month && typ) return `${typ} — ${month}`.slice(0, 80)
  if (month) return month.slice(0, 80)
  if (typ) return typ.slice(0, 80)
  return 'Rent'
}

function dashboardPaymentDueLineLabel(p) {
  const typ = String(p?.Type || '').trim()
  const month = String(p?.Month || '').trim()
  if (typ && month) return `${typ} — ${month}`.slice(0, 80)
  if (month) return month.slice(0, 80)
  if (typ) return typ.slice(0, 80)
  return 'Payment'
}

/**
 * True when this Airtable payment row would appear on the resident home “due” list (open balance, not WO cleaning).
 * Manager Payments “Pending” filter uses the same rule so both portals match.
 */
export function isPaymentRowDueOnResidentHome(p) {
  if (!p || typeof p !== 'object' || isFeeWaivePaymentRecord(p)) return false
  if (isPostpayRoomCleaningPaymentRecord(p)) return false
  if (computedResidentPaymentStatusLabel(p) === 'Paid') return false
  if (balanceFor(p) <= 0) return false
  return true
}

/**
 * Payment rows with balance due for dashboard / manager “same as resident” summaries.
 * Omits fee waivers and post-pay room-cleaning WO lines (those belong under Fees & extras).
 */
export function listDashboardDuePaymentLines(payments) {
  const list = Array.isArray(payments) ? payments : []
  const rows = []
  for (const p of list) {
    if (!isPaymentRowDueOnResidentHome(p)) continue
    const bal = balanceFor(p)
    const st = computedResidentPaymentStatusLabel(p)
    const due = parsePaymentDueDate(p['Due Date'])
    const dueTs = due && !Number.isNaN(due.getTime()) ? due.getTime() : Number.POSITIVE_INFINITY
    rows.push({
      id: String(p.id || ''),
      label: dashboardPaymentDueLineLabel(p),
      balance: bal,
      status: st,
      dueTs,
    })
  }
  rows.sort((a, b) => a.dueTs - b.dueTs || a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
  return rows
}

/**
 * Finer line classification for move-in vs recurring.
 * Fixes: plain Type "Utilities" was always treated as first-month utilities.
 */
export function classifyResidentPaymentLine(payment) {
  if (!payment || typeof payment !== 'object') return 'rent'
  if (isFeeWaivePaymentRecord(payment)) return 'fee_waive'
  const raw = paymentRawBlob(payment)

  if (/(security deposit|sec\.?\s*deposit|tenant deposit|initial deposit)/i.test(raw) && !/return/i.test(raw)) return 'deposit'
  if (
    /(room\s*hold|hold(ing)?\s*fee|unit\s*hold|application\s*hold|reservation\s*(fee|hold))/i.test(raw) &&
    !/return|refund|security\s*deposit/i.test(raw)
  ) {
    return 'hold_fee'
  }
  if (/(^|\s)(first month|1st month|first months|move-?in rent)/i.test(raw)) return 'first_rent'
  if (/(first month.{0,20}util|1st month.{0,20}util|move-?in.{0,20}util|move-?in.{0,12}utilities)/i.test(raw)) return 'first_utilities'
  if (/(^|\s)(first|1st)\s+month\s+utilities/i.test(raw)) return 'first_utilities'
  if (
    /(utilities\s*fee|utility\s*fee|flat\s*utilities|monthly\s*utilities|move-?in\s*utilities|initial\s*utilities)/i.test(raw) &&
    /(first|1st|move-?in|initial)/i.test(raw)
  ) {
    return 'first_utilities'
  }
  // Recurring utilities (must run before generic "utilities" → first_utilities)
  if (
    /(utilities\s*fee|utility\s*fee|flat\s*utilities|monthly\s*utilities)/i.test(raw) &&
    !/(first|1st|move-?in|initial|prorate)/i.test(raw)
  ) {
    return 'monthly_utilities'
  }
  const typeMonth = [payment.Type, payment.Month, payment.Category].filter(Boolean).join(' ').trim().toLowerCase()
  if (typeMonth === 'utilities' || /^utilities(?:\s*fee)?$/i.test(typeMonth)) {
    if (/(first|1st|move-?in|initial)/i.test(raw)) return 'first_utilities'
    return 'monthly_utilities'
  }
  if (/\b20\d{2}-\d{2}\b/.test(raw) && /(util|utilities)/i.test(raw) && !/(first|1st|move-?in|initial|prorate)/i.test(raw)) {
    return 'monthly_utilities'
  }
  if (/\b20\d{2}-\d{2}\b/.test(raw) && /rent/i.test(raw) && !/(first|1st|move-?in|initial|prorate)/i.test(raw)) {
    return 'monthly_rent'
  }
  if (/\bmonthly\s+rent\b/i.test(raw) && !/(first|1st|prorate)/i.test(raw)) return 'monthly_rent'
  if (/\bmonthly\s+utilities\b/i.test(raw) && !/(first|1st|prorate)/i.test(raw)) return 'monthly_utilities'
  return getPaymentKind(payment) === 'fee' ? 'fee' : 'rent'
}

export function parsePaymentDueDate(value) {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const raw = String(value).trim()
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function ymKeyFromDate(d) {
  if (!d || Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function ymKeyFromPaymentDue(p) {
  const d = parsePaymentDueDate(p?.['Due Date'])
  return d ? ymKeyFromDate(d) : ''
}

/** First calendar month after move-in (lease start) — first recurring rent/utilities cycle. */
export function iterRecurringBillingMonthKeys(leaseStartStr, leaseEndStr, horizonMonths = 12) {
  const leaseStart = parsePaymentDueDate(leaseStartStr)
  if (!leaseStart) return []
  const start = new Date(leaseStart.getFullYear(), leaseStart.getMonth() + 1, 1)
  const cap = new Date()
  cap.setHours(0, 0, 0, 0)
  cap.setMonth(cap.getMonth() + Math.max(1, Math.min(36, Number(horizonMonths) || 12)))

  let leaseEndMonth = null
  const leaseEnd = parsePaymentDueDate(leaseEndStr)
  if (leaseEnd) {
    leaseEndMonth = new Date(leaseEnd.getFullYear(), leaseEnd.getMonth(), 1)
  }

  const out = []
  for (let d = new Date(start); d <= cap; d.setMonth(d.getMonth() + 1)) {
    if (leaseEndMonth && d > leaseEndMonth) break
    const k = ymKeyFromDate(d)
    if (k) out.push(k)
  }
  return out
}

export function rentDueDayFromResident(resident) {
  const n = Number.parseInt(String(resident?.['Rent Due Day'] ?? resident?.['Rent Due'] ?? ''), 10)
  if (Number.isFinite(n) && n >= 1 && n <= 28) return n
  return 1
}

export function dueDateStringForMonth(ymKey, dayOfMonth) {
  const [y, m] = String(ymKey).split('-').map(Number)
  if (!y || !m) return ''
  const dim = new Date(y, m, 0).getDate()
  const d = Math.min(Math.max(1, dayOfMonth || 1), dim)
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function longMonthLabel(ymKey) {
  const [y, m] = String(ymKey).split('-').map(Number)
  if (!y || !m) return String(ymKey || '')
  const d = new Date(y, m - 1, 1)
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

export function findRentPaymentForBillingMonth(sortedPayments, ymKey) {
  for (const p of sortedPayments) {
    if (getPaymentKind(p) !== 'rent') continue
    const cls = classifyResidentPaymentLine(p)
    if (cls === 'first_rent' || cls === 'hold_fee' || cls === 'deposit') continue
    if (cls === 'first_utilities' || cls === 'monthly_utilities') continue
    if (ymKeyFromPaymentDue(p) === ymKey) return p
  }
  return null
}

export function findUtilitiesPaymentForBillingMonth(sortedPayments, ymKey) {
  for (const p of sortedPayments) {
    const cls = classifyResidentPaymentLine(p)
    if (cls === 'first_utilities') continue
    if (cls === 'monthly_utilities') {
      if (ymKeyFromPaymentDue(p) === ymKey) return p
      continue
    }
    const raw = paymentRawBlob(p)
    if (cls === 'fee' && /utilit/i.test(raw) && ymKeyFromPaymentDue(p) === ymKey) return p
  }
  return null
}

function amountDue(p) {
  const direct = Number(p?.Amount ?? p?.['Amount Due'] ?? p?.Total ?? 0)
  return Number.isFinite(direct) ? direct : 0
}

function amountPaid(p) {
  const explicit = Number(p?.['Amount Paid'] ?? p?.['Paid Amount'] ?? p?.Paid ?? p?.['Collected Amount'])
  if (Number.isFinite(explicit) && explicit >= 0) return explicit
  const rawStatus = String(p?.Status || '').trim().toLowerCase()
  return rawStatus === 'paid' ? amountDue(p) : 0
}

function balanceFor(p) {
  const explicit = Number(p?.Balance ?? p?.['Balance Due'] ?? p?.Outstanding)
  if (Number.isFinite(explicit)) return Math.max(0, explicit)
  return Math.max(0, amountDue(p) - amountPaid(p))
}

/** UI / Airtable-facing status label (Title Case). */
export function computedResidentPaymentStatusLabel(p) {
  const bal = balanceFor(p)
  const due = parsePaymentDueDate(p?.['Due Date'])
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (bal <= 0) return 'Paid'
  if (bal < amountDue(p)) return 'Partial'
  if (due) {
    const diffDays = Math.ceil((due.getTime() - today.getTime()) / 86400000)
    if (diffDays < 0) return 'Overdue'
    if (diffDays <= 5) return 'Due Soon'
  }
  return 'Unpaid'
}

function normalizeStatus(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function airtableStatusForLabel(label) {
  const l = String(label || '').trim()
  if (l === 'Paid') return 'Paid'
  if (l === 'Partial') return 'Partial'
  if (l === 'Overdue') return 'Overdue'
  if (l === 'Due Soon') return 'Due Soon'
  return 'Unpaid'
}

function statusesMatch(airtableRaw, computedLabel) {
  const a = normalizeStatus(airtableRaw)
  const c = normalizeStatus(computedLabel)
  if (a === c) return true
  if (a === 'paid' && c === 'paid') return true
  if (a === 'unpaid' && c === 'unpaid') return true
  if (a === 'overdue' && c === 'overdue') return true
  if (a === 'partial' && c === 'partial') return true
  if (a === 'due soon' && c === 'due soon') return true
  return false
}

/**
 * PATCH Airtable rows when stored Status lags balance + due date (manager list + exports).
 * Set VITE_AUTO_SYNC_PAYMENT_STATUS=false to disable.
 */
export async function reconcilePaymentStatusesInAirtable(rows, updatePaymentRecord) {
  const disabled = String(import.meta.env.VITE_AUTO_SYNC_PAYMENT_STATUS || '')
    .trim()
    .toLowerCase()
  if (disabled === 'false' || disabled === '0' || disabled === 'off') return 0

  let patched = 0
  for (const p of rows || []) {
    const id = String(p?.id || '').trim()
    if (!/^rec[a-zA-Z0-9]{14,}$/.test(id)) continue
    const nextLabel = computedResidentPaymentStatusLabel(p)
    const next = airtableStatusForLabel(nextLabel)
    if (statusesMatch(p.Status, nextLabel)) continue

    const fields = { Status: next }
    if (next === 'Paid') {
      fields.Balance = 0
      if (!String(p['Paid Date'] || '').trim()) {
        fields['Paid Date'] = new Date().toISOString().slice(0, 10)
      }
      if (!Number.isFinite(Number(p['Amount Paid'])) || Number(p['Amount Paid']) <= 0) {
        fields['Amount Paid'] = amountDue(p)
      }
    }

    try {
      await updatePaymentRecord(id, fields)
      patched += 1
    } catch {
      /* single-select mismatch etc. — skip */
    }
  }
  return patched
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10)
}

/**
 * After embedded Stripe succeeds, persist to Airtable when there was no existing Payments row (synthetic lines).
 */
export async function finalizeResidentPaymentAfterStripeSuccess(
  { resident, checkoutPayload },
  { updatePaymentRecord, createPaymentRecord },
) {
  const {
    amount,
    amountTotalUsd,
    category = 'rent',
    paymentRecordId,
    syntheticRowId,
    description,
    propertyName,
    unitNumber,
    stripeCheckoutSessionId,
    stripePaymentIntentId,
  } = checkoutPayload || {}

  const amt = Math.round(Number(amount) * 100) / 100
  if (!resident?.id || !Number.isFinite(amt) || amt <= 0) return null

  const paidTotal =
    typeof amountTotalUsd === 'number' && Number.isFinite(amountTotalUsd) && amountTotalUsd > 0
      ? Math.round(amountTotalUsd * 100) / 100
      : amt

  const rid = String(resident.id).trim()
  const resName = String(resident.Name || '').trim()
  const resEmail = String(resident.Email || '').trim().toLowerCase()
  // `resident.House` may be a linked-record array of property record IDs — use a safe resolver.
  const prop = String(propertyName || resolveHouseText(resident.House) || '').trim()
  const unit = String(unitNumber || resident['Unit Number'] || '').trim()

  const stripeRef = String(stripePaymentIntentId || stripeCheckoutSessionId || '').trim()

  if (paymentRecordId && /^rec[a-zA-Z0-9]{14,}$/.test(String(paymentRecordId).trim())) {
    const fields = {
      Status: 'Paid',
      'Paid Date': todayIsoDate(),
      'Amount Paid': paidTotal,
      Balance: 0,
    }
    if (stripeRef) fields['Stripe Payment ID'] = stripeRef
    return updatePaymentRecord(String(paymentRecordId).trim(), fields)
  }

  let type = 'Rent'
  let month = String(description || 'Payment').slice(0, 200)
  let due = todayIsoDate()

  const sid = String(syntheticRowId || '')
  if (category === 'hold_fee') {
    type = 'Room Hold Fee'
    month = 'Room hold fee'
  } else if (category === 'deposit') {
    type = 'Security Deposit'
    month = 'Security deposit'
  } else if (category === 'first_utilities') {
    type = 'Utilities'
    month = 'First month utilities'
  } else if (category === 'monthly_utilities' || sid.startsWith('synth-month-util-')) {
    type = 'Utilities'
    if (sid.startsWith('synth-month-util-')) {
      const ym = sid.slice('synth-month-util-'.length)
      month = `${longMonthLabel(ym)} utilities`
      due = dueDateStringForMonth(ym, rentDueDayFromResident(resident))
    } else {
      month = month || 'Monthly utilities'
    }
  } else if (category === 'monthly_rent' || category === 'rent') {
    if (sid === 'synth-first-month-unpaid' || sid === 'synth-first-month-paid') {
      type = 'First month rent'
      month = 'First month rent'
    } else if (sid.startsWith('synth-month-rent-')) {
      const ym = sid.slice('synth-month-rent-'.length)
      type = 'Monthly rent'
      month = `${longMonthLabel(ym)} rent`
      due = dueDateStringForMonth(ym, rentDueDayFromResident(resident))
    } else if (category === 'monthly_rent') {
      type = 'Monthly rent'
      month = month || 'Monthly rent'
    } else {
      type = 'Rent'
      month = month || 'Rent payment'
    }
  } else if (category === 'fee') {
    type = 'Fee'
    month = month || 'Fee payment'
  }

  const createFields = {
    ...buildPaymentResidentLinkFields(rid),
    'Resident Name': resName || undefined,
    'Resident Email': resEmail || undefined,
    'Property Name': prop || undefined,
    'Room Number': unit || undefined,
    Amount: paidTotal,
    'Amount Paid': paidTotal,
    Balance: 0,
    Status: 'Paid',
    'Paid Date': todayIsoDate(),
    'Due Date': due,
    Type: type,
    Month: month,
    Notes: description ? String(description).slice(0, 4000) : undefined,
  }
  if (stripeRef) createFields['Stripe Payment ID'] = stripeRef
  return createPaymentRecord(createFields)
}

/**
 * Property-level lease signing prerequisites (shared: frontend + Node handlers).
 * Aligns with Properties "Lease Access Requirement" single select.
 */

export const LEASE_ACCESS_REQUIREMENT = {
  SECURITY_DEPOSIT: 'Security Deposit Paid',
  SECURITY_AND_FIRST: 'Security Deposit and First Month Rent Paid',
  NONE: 'No Requirement',
}

/** Default when the field is missing — matches legacy resident portal (deposit + first month). */
export const DEFAULT_LEASE_ACCESS_REQUIREMENT = LEASE_ACCESS_REQUIREMENT.SECURITY_AND_FIRST

export function normalizeLeaseAccessRequirement(raw) {
  const s = String(raw || '').trim()
  if (
    s === LEASE_ACCESS_REQUIREMENT.SECURITY_DEPOSIT ||
    s === LEASE_ACCESS_REQUIREMENT.SECURITY_AND_FIRST ||
    s === LEASE_ACCESS_REQUIREMENT.NONE
  ) {
    return s
  }
  return DEFAULT_LEASE_ACCESS_REQUIREMENT
}

export function isFeeWaivePaymentRecord(p) {
  const t = String(p?.Type || p?.['Payment Type'] || '').trim().toLowerCase()
  return t === 'fee waive'
}

function paymentAmountDue(p) {
  const n = Number(p?.Amount ?? p?.['Amount Due'] ?? p?.Total)
  return Number.isFinite(n) ? n : 0
}

function paymentBalance(p) {
  const explicit = Number(p?.Balance ?? p?.['Balance Due'] ?? p?.Outstanding)
  if (Number.isFinite(explicit)) return Math.max(0, explicit)
  return Math.max(0, paymentAmountDue(p) - paymentAmountPaid(p))
}

function paymentAmountPaid(p) {
  const explicit = Number(p?.['Amount Paid'] ?? p?.['Paid Amount'] ?? p?.Paid ?? p?.['Collected Amount'])
  if (Number.isFinite(explicit) && explicit >= 0) return explicit
  const st = String(p?.Status || '').trim().toLowerCase()
  return st === 'paid' ? paymentAmountDue(p) : 0
}

/** Paid or zero balance counts as satisfied for that line. */
export function paymentLineEffectivelyPaid(p) {
  if (!p || typeof p !== 'object') return false
  if (isFeeWaivePaymentRecord(p)) return false
  if (paymentBalance(p) <= 0) return true
  const st = String(p.Status || '').trim().toLowerCase()
  return st === 'paid' || st === 'complete' || st === 'completed'
}

function paymentTypeBlob(p) {
  return [p?.Type, p?.['Payment Type'], p?.Category, p?.Kind, p?.Month, p?.Notes]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

/** Security deposit satisfied by a paid row (Type or text classification). */
export function paymentsIndicateSecurityDepositPaid(payments) {
  for (const p of payments || []) {
    if (isFeeWaivePaymentRecord(p)) continue
    if (!paymentLineEffectivelyPaid(p)) continue
    const type = String(p?.Type || p?.['Payment Type'] || '').trim().toLowerCase()
    if (type === 'security deposit') return true
    const blob = paymentTypeBlob(p)
    if (/(security deposit|sec\.?\s*deposit|tenant deposit)/i.test(blob) && !/return|refund/i.test(blob)) return true
  }
  return false
}

/** First month rent satisfied by a paid row. */
export function paymentsIndicateFirstMonthRentPaid(payments) {
  for (const p of payments || []) {
    if (isFeeWaivePaymentRecord(p)) continue
    if (!paymentLineEffectivelyPaid(p)) continue
    const type = String(p?.Type || p?.['Payment Type'] || '').trim().toLowerCase()
    if (type === 'first month rent' || type === 'first month') return true
    const blob = paymentTypeBlob(p)
    if (/(^|\s)(first month|1st month|move-?in rent)/i.test(blob)) return true
    if (getPaymentKindLoose(p) === 'rent' && /(first|1st|move-?in)/i.test(blob)) return true
  }
  /** Legacy: any paid rent-like line (aligned with historical resident portal). */
  for (const p of payments || []) {
    if (isFeeWaivePaymentRecord(p)) continue
    if (!paymentLineEffectivelyPaid(p)) continue
    const type = String(p?.Type || p?.['Payment Type'] || '').trim().toLowerCase()
    if (type === 'rent') return true
    const blob = paymentTypeBlob(p)
    if (getPaymentKindLoose(p) === 'rent' && /\brent\b/i.test(blob)) return true
  }
  return false
}

/** Minimal rent vs fee split for first-month fallback (no full residentPaymentsShared in Node). */
function getPaymentKindLoose(p) {
  const raw = paymentTypeBlob(p)
  if (/(fee|fine|damage|late fee|cleaning|lockout)/.test(raw)) return 'fee'
  return 'rent'
}

/**
 * @param {{ requirement: string, securityDepositPaid: boolean, firstMonthRentPaid: boolean, managerSignWithoutPayOverride?: boolean }} p
 * @returns {{ met: boolean, blockReason: string }}
 */
export function evaluateLeaseAccessPrereqs({
  requirement,
  securityDepositPaid,
  firstMonthRentPaid,
  managerSignWithoutPayOverride = false,
}) {
  if (managerSignWithoutPayOverride) {
    return { met: true, blockReason: '' }
  }
  const req = normalizeLeaseAccessRequirement(requirement)
  if (req === LEASE_ACCESS_REQUIREMENT.NONE) {
    return { met: true, blockReason: '' }
  }
  if (req === LEASE_ACCESS_REQUIREMENT.SECURITY_DEPOSIT) {
    if (securityDepositPaid) return { met: true, blockReason: '' }
    return {
      met: false,
      blockReason: 'Pay your security deposit to unlock the lease.',
    }
  }
  if (securityDepositPaid && firstMonthRentPaid) return { met: true, blockReason: '' }
  const parts = []
  if (!securityDepositPaid) parts.push('security deposit')
  if (!firstMonthRentPaid) parts.push('first month rent')
  return {
    met: false,
    blockReason: `Pay ${parts.join(' and ')} to unlock the lease.`,
  }
}

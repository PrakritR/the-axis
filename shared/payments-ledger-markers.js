/**
 * Idempotency markers and prefixes for the Airtable Payments ledger.
 * Used by resident portal materialization, approval flows, and cleanup.
 */

/** Recurring monthly rent row keyed by resident + billing month (YYYY-MM). */
export function recurringRentLedgerMarker(residentRecordId, ymKey) {
  const rid = String(residentRecordId || '').trim()
  const ym = String(ymKey || '').trim()
  return `AXIS_LEDGER_RECUR_RENT:${rid}:${ym}`
}

/** Recurring monthly utilities row keyed by resident + billing month. */
export function recurringUtilitiesLedgerMarker(residentRecordId, ymKey) {
  const rid = String(residentRecordId || '').trim()
  const ym = String(ymKey || '').trim()
  return `AXIS_LEDGER_RECUR_UTIL:${rid}:${ym}`
}

/** Portal-created expected security deposit (when no classified deposit row exists yet). */
export function portalMaterializedDepositMarker(residentRecordId) {
  return `AXIS_PORTAL_MAT_DEPOSIT:${String(residentRecordId || '').trim()}`
}

export function portalMaterializedFirstRentMarker(residentRecordId) {
  return `AXIS_PORTAL_MAT_FIRST_RENT:${String(residentRecordId || '').trim()}`
}

export function portalMaterializedFirstUtilitiesMarker(residentRecordId) {
  return `AXIS_PORTAL_MAT_FIRST_UTIL:${String(residentRecordId || '').trim()}`
}

/** Administrative fee carved from security deposit on approval (idempotent per application). */
export const ADMIN_FEE_FROM_DEPOSIT_MARKER_PREFIX = 'AXIS_ADMIN_FEE_FROM_DEPOSIT:'

export function adminFeeFromDepositMarker(applicationRecordId) {
  return `${ADMIN_FEE_FROM_DEPOSIT_MARKER_PREFIX}${String(applicationRecordId || '').trim()}`
}

export function notesContainLedgerMarker(notes, markerSubstring) {
  return String(notes || '').includes(String(markerSubstring || ''))
}

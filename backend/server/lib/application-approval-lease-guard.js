/**
 * Lease creation guard — must match frontend `deriveApplicationApprovalState`
 * in `applicationApprovalState.js` (keep both in sync).
 *
 * Blocks creating leases when Application / Approval status is still in the
 * pipeline, even if the `Approved` checkbox is incorrectly true in Airtable.
 */

export function applicationRejectedFieldName() {
  return (
    String(
      process.env.VITE_AIRTABLE_APPLICATION_REJECTED_FIELD ||
        process.env.AIRTABLE_APPLICATION_REJECTED_FIELD ||
        'Rejected',
    ).trim() || 'Rejected'
  )
}

/** Exported for manager-approve: only overwrite status when it still looks in-pipeline. */
export function applicationStatusLooksPipelinePending(status) {
  if (!status) return false
  const s = String(status).trim().toLowerCase()
  const blockedExact = new Set([
    'pending',
    'under review',
    'in review',
    'submitted',
    'new',
    'draft',
    'incomplete',
    'awaiting',
    'processing',
  ])
  if (blockedExact.has(s)) return true
  if (s.includes('pending')) return true
  if (s.includes('under review')) return true
  if (s.includes('in review')) return true
  if (s.includes('awaiting')) return true
  return false
}

function normalizeStatusPiece(value) {
  if (value == null || value === '') return ''
  if (typeof value === 'object' && value !== null && 'name' in value) {
    return String(value.name || '').trim().toLowerCase()
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((v) => (typeof v === 'object' && v != null && 'name' in v ? v.name : v))
      .filter((x) => x != null && String(x).trim() !== '')
    return parts.map((p) => String(p).trim().toLowerCase()).join(' ')
  }
  return String(value).trim().toLowerCase()
}

function applicationApprovedCheckbox(raw) {
  const a = raw?.Approved
  if (a === true || a === 1) return true
  const s = String(a ?? '').trim().toLowerCase()
  return s === 'true' || s === '1' || s === 'yes' || s === 'checked'
}

function statusPieceRejected(s) {
  return s === 'rejected' || s === 'reject' || s === 'declined' || s === 'denied'
}

function statusPieceApproved(s) {
  return s === 'approved' || s === 'accept' || s === 'accepted'
}

/** @returns {'pending' | 'approved' | 'rejected'} */
export function deriveApplicationLeaseGateState(app) {
  if (!app || typeof app !== 'object') return 'pending'

  const rejKey = applicationRejectedFieldName()
  if (app[rejKey] === true || app[rejKey] === 1) return 'rejected'

  const pieces = [
    normalizeStatusPiece(app['Approval Status']),
    normalizeStatusPiece(app['Application Status']),
  ].filter(Boolean)

  for (const s of pieces) {
    if (statusPieceRejected(s)) return 'rejected'
  }
  for (const s of pieces) {
    if (statusPieceApproved(s)) return 'approved'
  }
  if (applicationApprovedCheckbox(app)) return 'approved'

  for (const s of pieces) {
    if (applicationStatusLooksPipelinePending(s)) return 'pending'
  }

  const a = app.Approved
  if (a === true || a === 1) return 'approved'
  if (a === false || a === 0) return 'rejected'

  return 'pending'
}

export function isApplicationApprovedForLease(app) {
  return deriveApplicationLeaseGateState(app) === 'approved'
}

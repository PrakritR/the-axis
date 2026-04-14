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

/** @returns {'pending' | 'approved' | 'rejected'} */
export function deriveApplicationLeaseGateState(app) {
  if (!app || typeof app !== 'object') return 'pending'

  const rejKey = applicationRejectedFieldName()
  if (app[rejKey] === true || app[rejKey] === 1) return 'rejected'

  const status = String(app['Approval Status'] || app['Application Status'] || '').trim().toLowerCase()

  if (status === 'approved' || status === 'accept' || status === 'accepted') return 'approved'
  if (status === 'rejected' || status === 'reject' || status === 'declined' || status === 'denied') {
    return 'rejected'
  }

  if (applicationStatusLooksPipelinePending(status)) return 'pending'

  const a = app.Approved
  if (a === true || a === 1) return 'approved'
  if (a === false || a === 0) return 'rejected'

  return 'pending'
}

export function isApplicationApprovedForLease(app) {
  return deriveApplicationLeaseGateState(app) === 'approved'
}

/**
 * Map an Applications table row to pending | approved | rejected.
 * Uses checkbox `Approved` when set, otherwise single-select style fields
 * `Approval Status` / `Application Status`. Empty / unknown → pending.
 */
export function deriveApplicationApprovalState(raw) {
  if (!raw || typeof raw !== 'object') return 'pending'

  const a = raw.Approved
  const status = String(raw['Approval Status'] || raw['Application Status'] || '').trim().toLowerCase()

  if (a === true || a === 1) return 'approved'
  if (a === false || a === 0) return 'rejected'

  const as = String(a ?? '').trim().toLowerCase()
  if (as === 'true' || as === 'yes' || as === '1') return 'approved'
  if (as === 'false' || as === 'no' || as === '0') return 'rejected'

  if (status === 'approved' || status === 'accept' || status === 'accepted') return 'approved'
  if (status === 'rejected' || status === 'reject' || status === 'declined' || status === 'denied') {
    return 'rejected'
  }

  if (
    status === 'pending' ||
    status === 'under review' ||
    status === 'pending review' ||
    status === 'submitted' ||
    status === 'in review' ||
    status === 'changes needed' ||
    status === 'changes_requested' ||
    status === 'changes requested'
  ) {
    return 'pending'
  }

  return 'pending'
}

export function applicationDisplayLabelFromApprovalState(state) {
  if (state === 'approved') return 'Approved'
  if (state === 'rejected') return 'Rejected'
  return 'Under review'
}

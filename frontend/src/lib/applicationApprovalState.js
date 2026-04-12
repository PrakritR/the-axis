/**
 * Map an Applications table row to pending | approved | rejected.
 * Uses text field `Approval Status` as primary. Empty / unknown → pending.
 */
export function deriveApplicationApprovalState(raw) {
  if (!raw || typeof raw !== 'object') return 'pending'

  const status = String(raw['Approval Status'] || raw['Application Status'] || '').trim().toLowerCase()

  if (status === 'approved' || status === 'accept' || status === 'accepted') return 'approved'
  if (status === 'rejected' || status === 'reject' || status === 'declined' || status === 'denied') {
    return 'rejected'
  }

  // Fallback: honour legacy boolean Approved field if text field is absent
  const a = raw.Approved
  if (a === true || a === 1) return 'approved'
  if (a === false || a === 0) return 'rejected'

  return 'pending'
}

export function applicationDisplayLabelFromApprovalState(state) {
  if (state === 'approved') return 'Approved'
  if (state === 'rejected') return 'Rejected'
  return 'Under review'
}

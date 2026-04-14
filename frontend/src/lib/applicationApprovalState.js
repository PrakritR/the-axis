/**
 * Checkbox name used to persist rejection. Checked = appears in Airtable API; unchecked is omitted.
 * (The `Approved` checkbox is also omitted when unchecked, so "rejected" cannot be stored as Approved=false alone.)
 */
export function applicationRejectedFieldName() {
  const s =
    typeof import.meta !== 'undefined' && import.meta.env?.VITE_AIRTABLE_APPLICATION_REJECTED_FIELD != null
      ? String(import.meta.env.VITE_AIRTABLE_APPLICATION_REJECTED_FIELD).trim()
      : ''
  return s || 'Rejected'
}

function statusImpliesPipelineNotComplete(status) {
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

/**
 * Map an Applications table row to pending | approved | rejected.
 * Uses optional `Approval Status` / `Application Status` when set.
 * `Rejected` checkbox (see applicationRejectedFieldName) is the reliable store for rejection.
 * If status is still in the pipeline (pending, submitted, …), stays pending even when `Approved` is true
 * — must match `backend/server/lib/application-approval-lease-guard.js` for lease creation.
 */
export function deriveApplicationApprovalState(raw) {
  if (!raw || typeof raw !== 'object') return 'pending'

  const rejKey = applicationRejectedFieldName()
  const rejectedFlag = raw[rejKey]
  if (rejectedFlag === true || rejectedFlag === 1) return 'rejected'

  const status = String(raw['Approval Status'] || raw['Application Status'] || '').trim().toLowerCase()

  if (status === 'approved' || status === 'accept' || status === 'accepted') return 'approved'
  if (status === 'rejected' || status === 'reject' || status === 'declined' || status === 'denied') {
    return 'rejected'
  }

  if (statusImpliesPipelineNotComplete(status)) return 'pending'

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

/**
 * Lease lists (manager portal): a draft tied to an Applications row should not
 * appear in the manager-review lease queue until that application passes {@link deriveApplicationApprovalState}
 * (same rule as backend lease-creation guards).
 *
 * @param {object} draft - Lease Drafts fields (+ id)
 * @param {Map<string, object>} applicationByRecordId - Applications rows by Airtable record id
 * @returns {boolean} true if the draft may be shown in manager lease UI
 */
export function leaseDraftPassesApplicationApprovalGate(draft, applicationByRecordId) {
  const appId = String(draft?.['Application Record ID'] || '').trim()
  if (!appId) return true
  if (!applicationByRecordId || typeof applicationByRecordId.get !== 'function') return true
  const app = applicationByRecordId.get(appId)
  if (!app) return true
  return deriveApplicationApprovalState(app) === 'approved'
}

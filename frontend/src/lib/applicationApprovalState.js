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

function normalizeStatusPiece(value) {
  return String(value || '').trim().toLowerCase()
}

function statusPieceRejected(s) {
  return s === 'rejected' || s === 'reject' || s === 'declined' || s === 'denied'
}

function statusPieceApproved(s) {
  return s === 'approved' || s === 'accept' || s === 'accepted'
}

/**
 * Map an Applications table row to pending | approved | rejected.
 * Reads **both** `Approval Status` and `Application Status`. If either field clearly says
 * approved while the other still says pending/submitted (common Airtable drift), treat as
 * approved so the resident portal and lease gates match manager intent.
 * `Rejected` checkbox (see applicationRejectedFieldName) is the reliable store for rejection.
 * If a status field is still in the pipeline (pending, submitted, …), that field blocks only
 * after we have checked both for explicit approved/rejected — must stay aligned with
 * `backend/server/lib/application-approval-lease-guard.js`.
 */
export function deriveApplicationApprovalState(raw) {
  if (!raw || typeof raw !== 'object') return 'pending'

  const rejKey = applicationRejectedFieldName()
  const rejectedFlag = raw[rejKey]
  if (rejectedFlag === true || rejectedFlag === 1) return 'rejected'

  const pieces = [
    normalizeStatusPiece(raw['Approval Status']),
    normalizeStatusPiece(raw['Application Status']),
  ].filter(Boolean)

  for (const s of pieces) {
    if (statusPieceRejected(s)) return 'rejected'
  }
  for (const s of pieces) {
    if (statusPieceApproved(s)) return 'approved'
  }
  for (const s of pieces) {
    if (statusImpliesPipelineNotComplete(s)) return 'pending'
  }

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

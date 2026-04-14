/**
 * Which Lease Drafts statuses unlock resident portal viewing vs e-sign.
 * Keeps Resident.jsx and sign-lease-draft in sync when managers use either
 * "Published" (app send flow) or "Ready for Signature" (some bases skip re-labeling).
 */

export function isResidentLeaseBodyViewable(status) {
  const s = String(status || '').trim()
  return s === 'Published' || s === 'Signed' || s === 'Ready for Signature'
}

/** Matches backend POST /api/sign-lease-draft accepted statuses. */
export function isResidentLeaseSignable(status) {
  const s = String(status || '').trim()
  return s === 'Published' || s === 'Ready for Signature'
}

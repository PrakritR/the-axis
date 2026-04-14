/**
 * Which Lease Drafts statuses unlock resident portal viewing vs e-sign.
 * Keeps Resident.jsx and sign-lease-draft in sync when managers use either
 * "Published" (app send flow) or "Ready for Signature" (some bases skip re-labeling).
 *
 * **Lease access before viewing/signing** is gated by Properties `Lease Access Requirement`,
 * payment rows (see shared/lease-access-requirements.js), and optional
 * "Allow sign without move-in pay" on the draft.
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

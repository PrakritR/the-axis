/**
 * Which Lease Drafts statuses unlock resident portal viewing vs e-sign.
 * Keeps Resident.jsx and sign-lease-draft in sync when managers use either
 * "Published" (app send flow) or "Ready for Signature" (some bases skip re-labeling).
 *
 * **Lease access before viewing/signing** is gated by Properties `Lease Access Requirement`,
 * payment rows (see shared/lease-access-requirements.js), and optional
 * "Allow sign without move-in pay" on the draft.
 */

import { leaseDraftAllowsSignWithoutMoveInPay } from './leaseMoveInOverride.js'

/** When manager waives move-in pay, resident may read lease text while draft is still in pipeline. */
const PRE_PUBLISH_VIEW_WHEN_MOVE_IN_WAIVED = new Set([
  'Draft Generated',
  'Under Review',
  'Changes Needed',
  'Approved',
  'Sent Back to Manager',
  'Submitted to Admin',
  'Admin In Review',
  'Changes Made',
  'Manager Approved',
])

/**
 * @param {string} status — Lease Drafts `Status`
 * @param {Record<string, unknown>|null|undefined} [draft] — active lease draft row (for move-in-pay waiver)
 */
export function isResidentLeaseBodyViewable(status, draft) {
  const s = String(status || '').trim()
  if (s === 'Published' || s === 'Signed' || s === 'Ready for Signature') return true
  if (draft && PRE_PUBLISH_VIEW_WHEN_MOVE_IN_WAIVED.has(s) && leaseDraftAllowsSignWithoutMoveInPay(draft)) {
    return true
  }
  return false
}

/** Matches backend POST /api/sign-lease-draft accepted statuses. */
export function isResidentLeaseSignable(status) {
  const st = String(status || '').trim()
  return st === 'Published' || st === 'Ready for Signature'
}

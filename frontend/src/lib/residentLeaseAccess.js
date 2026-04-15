/**
 * Which Lease Drafts statuses unlock resident portal viewing vs e-sign.
 * Keeps Resident.jsx and sign-lease-draft in sync when managers use either
 * "Published" (app send flow) or "Ready for Signature" (some bases skip re-labeling).
 *
 * **Viewing the lease body** requires the manager workflow to have sent the draft to the resident
 * (`Published` / `Ready for Signature`) or `Signed`. It does **not** open early when
 * "Allow sign without move-in pay" is checked — that flag only waives **payment** prerequisites
 * (see `evaluateLeaseAccessPrereqs` + `leaseMoveInOverride`), not publication.
 *
 * @param {string} status — Lease Drafts `Status`
 * @param {Record<string, unknown>|null|undefined} [_draft] — reserved for API stability; not used for visibility.
 */
export function isResidentLeaseBodyViewable(status, _draft) {
  const s = String(status || '').trim()
  return s === 'Published' || s === 'Signed' || s === 'Ready for Signature'
}

/** Matches backend POST /api/sign-lease-draft accepted statuses. */
export function isResidentLeaseSignable(status) {
  const st = String(status || '').trim()
  return st === 'Published' || st === 'Ready for Signature'
}

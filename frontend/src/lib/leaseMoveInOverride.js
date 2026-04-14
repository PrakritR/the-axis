/**
 * Manager/admin can set a checkbox on **Lease Drafts** so residents may open
 * and sign the lease before paying security deposit + first month rent.
 *
 * Default Airtable field: `Allow Sign Without Move-In Pay`
 * Override with `VITE_AIRTABLE_LEASE_SIGN_WITHOUT_PAY_FIELD` if your base uses another name.
 */

export const DEFAULT_LEASE_SIGN_WITHOUT_PAY_FIELD = 'Allow Sign Without Move-In Pay'

export function leaseSignWithoutMoveInPayFieldName() {
  const raw = import.meta.env.VITE_AIRTABLE_LEASE_SIGN_WITHOUT_PAY_FIELD
  const trimmed = String(raw || '').trim()
  return trimmed || DEFAULT_LEASE_SIGN_WITHOUT_PAY_FIELD
}

/** True when the draft record has the override enabled (checkbox or yes-like text). */
export function leaseDraftAllowsSignWithoutMoveInPay(draft) {
  if (!draft || typeof draft !== 'object') return false
  const primary = leaseSignWithoutMoveInPayFieldName()
  const keys = [primary, DEFAULT_LEASE_SIGN_WITHOUT_PAY_FIELD, 'Skip Move-In Pay Gate'].filter(
    (k, i, a) => k && a.indexOf(k) === i,
  )
  for (const key of keys) {
    const v = draft[key]
    // Airtable often omits unchecked checkboxes from `fields`; missing key => undefined.
    if (v === undefined) continue
    if (v === true || v === 1 || v === '1') return true
    const s = String(v).trim().toLowerCase()
    if (['yes', 'true', 'on', 'checked'].includes(s)) return true
  }
  return false
}

/**
 * True when **any** lease draft for the resident has the override. Needed because
 * `pickBestLeaseDraft` may surface a different row (e.g. older Published) than the
 * one the manager toggled while a newer in-progress draft holds the checkbox.
 */
export function anyLeaseDraftAllowsSignWithoutMoveInPay(drafts) {
  if (!Array.isArray(drafts) || drafts.length === 0) return false
  return drafts.some((d) => leaseDraftAllowsSignWithoutMoveInPay(d))
}

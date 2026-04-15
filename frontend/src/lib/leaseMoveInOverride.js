/**
 * Manager/admin can set a checkbox on **Lease Drafts** so residents may **sign** (once the draft
 * is `Published` / `Ready for Signature`) before paying security deposit + first month rent.
 * It does **not** show the lease while the draft is still in manager/admin review.
 *
 * Default Airtable field: `Allow Sign Without Move-In Pay`
 * Override with `VITE_AIRTABLE_LEASE_SIGN_WITHOUT_PAY_FIELD` if your base uses another name.
 */

import {
  DEFAULT_LEASE_SIGN_WITHOUT_PAY_FIELD,
  leaseDraftAllowsSignWithoutMoveInPay as leaseDraftAllowsShared,
  anyLeaseDraftAllowsSignWithoutMoveInPay as anyLeaseShared,
  leaseSignWithoutMoveInPayFieldNamePreferred,
} from '../../../shared/lease-sign-without-move-in-pay.js'

export { DEFAULT_LEASE_SIGN_WITHOUT_PAY_FIELD }

const rawEnv = () => import.meta.env.VITE_AIRTABLE_LEASE_SIGN_WITHOUT_PAY_FIELD

export function leaseSignWithoutMoveInPayFieldName() {
  return leaseSignWithoutMoveInPayFieldNamePreferred(rawEnv())
}

export function leaseDraftAllowsSignWithoutMoveInPay(draft) {
  return leaseDraftAllowsShared(draft, rawEnv())
}

export function anyLeaseDraftAllowsSignWithoutMoveInPay(drafts) {
  return anyLeaseShared(drafts, rawEnv())
}

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

/** Normalize Airtable field labels so hyphen / en-dash / spacing variants match. */
function normFieldKeySlug(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, '-')
    .replace(/[^a-z0-9]+/g, '')
}

function signWithoutOverrideValueTruthy(v) {
  if (v === true || v === 1) return true
  if (v === false || v === 0 || v === null) return false
  if (v === undefined) return false
  if (typeof v === 'number' && Number.isFinite(v)) return v !== 0
  const s = String(v).trim().toLowerCase()
  if (!s) return false
  if (['yes', 'true', 'on', 'checked', 'y', '✓', 'check', 'enabled', '1'].includes(s)) return true
  return false
}

/** Heuristic: field name looks like "allow … sign without … pay / move-in" (avoids matching *…signature* alone). */
function fieldNameLooksLikeSignWithoutMoveInGate(slug) {
  if (!slug || slug.length < 12) return false
  if (!slug.includes('allow')) return false
  if (slug.includes('signwithout') || slug.includes('withoutpay') || slug.includes('withoutmovein')) return true
  if (slug.includes('lease') && slug.includes('without') && (slug.includes('pay') || slug.includes('sign'))) return true
  return false
}

/** True when the draft record has the override enabled (checkbox or yes-like text). */
export function leaseDraftAllowsSignWithoutMoveInPay(draft) {
  if (!draft || typeof draft !== 'object') return false
  const primary = leaseSignWithoutMoveInPayFieldName()
  const explicitKeys = [
    primary,
    DEFAULT_LEASE_SIGN_WITHOUT_PAY_FIELD,
    'Skip Move-In Pay Gate',
    'Allow lease signing without paying',
    'Allow Lease Signing Without Paying',
    'Allow sign without paying',
    'Allow Sign Without Paying',
  ].filter((k, i, a) => Boolean(k) && a.indexOf(k) === i)

  for (const key of explicitKeys) {
    const v = draft[key]
    // Airtable often omits unchecked checkboxes from `fields`; missing key => undefined.
    if (v === undefined) continue
    if (signWithoutOverrideValueTruthy(v)) return true
  }

  const targetSlugs = new Set(explicitKeys.map((k) => normFieldKeySlug(k)))
  for (const [key, v] of Object.entries(draft)) {
    if (key === 'id' || key === 'created_at') continue
    if (!targetSlugs.has(normFieldKeySlug(key))) continue
    if (v === undefined) continue
    if (signWithoutOverrideValueTruthy(v)) return true
  }

  for (const [key, v] of Object.entries(draft)) {
    if (key === 'id' || key === 'created_at') continue
    if (v === undefined) continue
    const slug = normFieldKeySlug(key)
    if (!fieldNameLooksLikeSignWithoutMoveInGate(slug)) continue
    if (signWithoutOverrideValueTruthy(v)) return true
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

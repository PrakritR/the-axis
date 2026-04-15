/**
 * Detect Lease Drafts "allow sign before move-in pay" checkbox (shared: Vite + Node).
 * Default Airtable field: `Allow Sign Without Move-In Pay`
 * Env: VITE_AIRTABLE_LEASE_SIGN_WITHOUT_PAY_FIELD (browser) / same on server builds
 */

export const DEFAULT_LEASE_SIGN_WITHOUT_PAY_FIELD = 'Allow Sign Without Move-In Pay'

export function leaseSignWithoutMoveInPayFieldNamePreferred(rawEnvValue) {
  const trimmed = String(rawEnvValue ?? '').trim()
  return trimmed || DEFAULT_LEASE_SIGN_WITHOUT_PAY_FIELD
}

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
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    if (typeof v.name === 'string' && v.name.trim()) return signWithoutOverrideValueTruthy(v.name)
    if (typeof v.state === 'string' && v.state.trim()) return signWithoutOverrideValueTruthy(v.state)
  }
  if (Array.isArray(v) && v.length === 1) return signWithoutOverrideValueTruthy(v[0])
  const s = String(v).trim().toLowerCase()
  if (!s) return false
  if (['yes', 'true', 'on', 'checked', 'y', '✓', 'check', 'enabled', '1'].includes(s)) return true
  return false
}

function fieldNameLooksLikeSignWithoutMoveInGate(slug) {
  if (!slug || slug.length < 12) return false
  if (!slug.includes('allow')) return false
  if (slug.includes('signwithout') || slug.includes('withoutpay') || slug.includes('withoutmovein')) return true
  if (slug.includes('lease') && slug.includes('without') && (slug.includes('pay') || slug.includes('sign'))) return true
  return false
}

/**
 * @param {Record<string, unknown>|null|undefined} draft
 * @param {string} [rawPreferredEnv] — pass `import.meta.env.VITE_AIRTABLE_LEASE_SIGN_WITHOUT_PAY_FIELD` or `process.env.VITE_AIRTABLE_LEASE_SIGN_WITHOUT_PAY_FIELD`
 */
export function leaseDraftAllowsSignWithoutMoveInPay(draft, rawPreferredEnv) {
  if (!draft || typeof draft !== 'object') return false
  const primary = leaseSignWithoutMoveInPayFieldNamePreferred(rawPreferredEnv)
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

export function anyLeaseDraftAllowsSignWithoutMoveInPay(drafts, rawPreferredEnv) {
  if (!Array.isArray(drafts) || drafts.length === 0) return false
  return drafts.some((d) => leaseDraftAllowsSignWithoutMoveInPay(d, rawPreferredEnv))
}

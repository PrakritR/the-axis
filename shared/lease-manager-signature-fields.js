/**
 * Optional Lease Drafts fields for landlord/manager counter-signature (typed name + optional image).
 * Configure Airtable column names via env if they differ from defaults.
 */

function pickEnv(env, viteKey, nodeKey, fallback) {
  const e = env && typeof env === 'object' ? env : {}
  const v = e[viteKey] ?? e[nodeKey]
  const s = String(v == null ? '' : v).trim()
  return s || fallback
}

/** @param {Record<string, string | undefined>} [env] import.meta.env or process.env */
export function leaseManagerSignatureFieldNames(env) {
  return {
    text: pickEnv(
      env,
      'VITE_AIRTABLE_LEASE_MANAGER_SIGNATURE_TEXT_FIELD',
      'AIRTABLE_LEASE_MANAGER_SIGNATURE_TEXT_FIELD',
      'Manager Signature Text',
    ),
    at: pickEnv(
      env,
      'VITE_AIRTABLE_LEASE_MANAGER_SIGNATURE_AT_FIELD',
      'AIRTABLE_LEASE_MANAGER_SIGNATURE_AT_FIELD',
      'Manager Signed At',
    ),
    image: pickEnv(
      env,
      'VITE_AIRTABLE_LEASE_MANAGER_SIGNATURE_IMAGE_FIELD',
      'AIRTABLE_LEASE_MANAGER_SIGNATURE_IMAGE_FIELD',
      'Manager Signature Image',
    ),
  }
}

/**
 * @param {Record<string, unknown> | null | undefined} draft
 * @param {Record<string, string | undefined>} [env]
 */
export function pickManagerSignatureFromDraft(draft, env) {
  if (!draft || typeof draft !== 'object') return { text: '', at: '', image: '' }
  const n = leaseManagerSignatureFieldNames(env)
  return {
    text: String(draft[n.text] ?? '').trim(),
    at: String(draft[n.at] ?? '').trim(),
    image: String(draft[n.image] ?? '').trim(),
  }
}

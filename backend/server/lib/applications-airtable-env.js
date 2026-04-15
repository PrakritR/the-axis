/**
 * Server-side Applications table env (same sources as other Airtable handlers).
 */

export function getApplicationsAirtableEnv() {
  const token = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
  /** Same resolution as lease-admin-respond / ManagerLeasingTab: Applications may live in a dedicated base. */
  const coreBaseId =
    String(process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T').trim() ||
    'appol57LKtMKaQ75T'
  const baseId =
    String(
      process.env.VITE_AIRTABLE_APPLICATIONS_BASE_ID ||
        process.env.AIRTABLE_APPLICATIONS_BASE_ID ||
        coreBaseId,
    ).trim() || coreBaseId
  const table =
    String(process.env.VITE_AIRTABLE_APPLICATIONS_TABLE || process.env.AIRTABLE_APPLICATIONS_TABLE || 'Applications').trim() ||
    'Applications'
  const paidField = String(process.env.AIRTABLE_APPLICATION_PAID_FIELD || 'Application Paid').trim() || 'Application Paid'
  const sessionField = String(process.env.AIRTABLE_STRIPE_CHECKOUT_SESSION_FIELD || 'Stripe Checkout Session').trim()
  /** Used to detect “already submitted” and to reuse the same draft row across pay + submit. */
  const signatureField =
    String(process.env.AIRTABLE_APPLICATION_SIGNER_SIGNATURE_FIELD || 'Signer Signature').trim() || 'Signer Signature'
  // Only send a fee-due amount when this env is set to your column’s exact name (avoids INVALID_VALUE / unknown field on bases without the column).
  const feeDueField = String(process.env.AIRTABLE_APPLICATION_FEE_DUE_USD_FIELD ?? '').trim()
  return { token, baseId, table, paidField, sessionField, feeDueField, signatureField }
}

export function airtableAuthHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

export function applicationsTableUrl(env) {
  return `https://api.airtable.com/v0/${env.baseId}/${encodeURIComponent(env.table)}`
}

/** Best-effort parse of Airtable REST error JSON for operator-facing messages. */
export function airtableErrorMessageFromBody(text) {
  try {
    const m = JSON.parse(String(text || ''))?.error?.message
    return typeof m === 'string' && m.trim() ? m.trim() : ''
  } catch {
    return ''
  }
}

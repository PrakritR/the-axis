/**
 * Server-side Applications table env (same sources as other Airtable handlers).
 */

export function getApplicationsAirtableEnv() {
  const token = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
  const baseId = process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_APPLICATIONS_BASE_ID || process.env.AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
  const table =
    String(process.env.VITE_AIRTABLE_APPLICATIONS_TABLE || process.env.AIRTABLE_APPLICATIONS_TABLE || 'Applications').trim() ||
    'Applications'
  const paidField = String(process.env.AIRTABLE_APPLICATION_PAID_FIELD || 'Application Paid').trim() || 'Application Paid'
  const sessionField = String(process.env.AIRTABLE_STRIPE_CHECKOUT_SESSION_FIELD || 'Stripe Checkout Session').trim()
  const feeDueField = String(process.env.AIRTABLE_APPLICATION_FEE_DUE_USD_FIELD || 'Application Fee Due (USD)').trim()
  return { token, baseId, table, paidField, sessionField, feeDueField }
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

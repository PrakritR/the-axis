/**
 * POST /api/portal?action=owner-stripe-status
 * Fetches the current Stripe Connect account status for the authenticated owner
 * and syncs the key fields back to the Owner Profile Airtable row.
 *
 * Returns: { accountId, detailsSubmitted, chargesEnabled, payoutsEnabled, onboardingComplete }
 */

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
const BASE_ID = process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const OWNER_TABLE = encodeURIComponent(process.env.AIRTABLE_OWNER_PROFILE_TABLE || 'Owner Profile')
const STRIPE_API = 'https://api.stripe.com/v1'

function airtableHeaders() {
  return { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' }
}

function stripeHeaders(key) {
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' }
}

async function getOwnerRecord(recordId) {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${OWNER_TABLE}/${encodeURIComponent(recordId)}`
  const res = await fetch(url, { headers: airtableHeaders() })
  if (!res.ok) throw new Error('Owner record not found.')
  const data = await res.json()
  return { id: data.id, ...data.fields }
}

async function updateOwner(recordId, fields) {
  await fetch(`https://api.airtable.com/v0/${BASE_ID}/${OWNER_TABLE}/${recordId}`, {
    method: 'PATCH',
    headers: airtableHeaders(),
    body: JSON.stringify({ fields, typecast: true }),
  }).catch(() => {})
}

async function getStripeAccount(secretKey, accountId) {
  const res = await fetch(`${STRIPE_API}/accounts/${encodeURIComponent(accountId)}`, {
    headers: stripeHeaders(secretKey),
  })
  const text = await res.text()
  if (!res.ok) {
    let msg = text
    try { msg = JSON.parse(text)?.error?.message || text } catch { /* raw */ }
    throw new Error(`Stripe account fetch failed: ${msg}`)
  }
  return JSON.parse(text)
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey) return res.status(500).json({ error: 'Stripe is not configured on this server.' })
  if (!AIRTABLE_TOKEN) return res.status(500).json({ error: 'Server configuration error.' })

  const owner = req._ownerTenant
  if (!owner?.id) return res.status(403).json({ error: 'Unauthorized.' })

  try {
    const ownerRecord = await getOwnerRecord(owner.id)
    const accountId = String(ownerRecord['Stripe Connect Account ID'] || '').trim()

    if (!accountId || !accountId.startsWith('acct_')) {
      return res.status(200).json({
        accountId: null,
        detailsSubmitted: false,
        chargesEnabled: false,
        payoutsEnabled: false,
        onboardingComplete: false,
      })
    }

    const account = await getStripeAccount(secretKey, accountId)
    const detailsSubmitted = Boolean(account.details_submitted)
    const chargesEnabled = Boolean(account.charges_enabled)
    const payoutsEnabled = Boolean(account.payouts_enabled)
    const onboardingComplete = detailsSubmitted && chargesEnabled && payoutsEnabled

    // Sync status back to Airtable so it's always fresh
    await updateOwner(owner.id, {
      'Stripe Details Submitted': detailsSubmitted,
      'Stripe Charges Enabled': chargesEnabled,
      'Stripe Payouts Enabled': payoutsEnabled,
      'Stripe Onboarding Complete': onboardingComplete,
    })

    return res.status(200).json({
      accountId,
      detailsSubmitted,
      chargesEnabled,
      payoutsEnabled,
      onboardingComplete,
    })
  } catch (err) {
    console.error('[owner-stripe-status]', err)
    return res.status(500).json({ error: err.message || 'Failed to fetch Stripe status.' })
  }
}

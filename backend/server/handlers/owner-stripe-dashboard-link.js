/**
 * POST /api/portal?action=owner-stripe-dashboard-link
 * Generates a Stripe Express dashboard login link for the authenticated owner.
 * Only works after onboarding is complete (details_submitted = true).
 *
 * Returns: { url: string }
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
      return res.status(400).json({ error: 'No Stripe account connected. Complete onboarding first.' })
    }

    const loginLinkRes = await fetch(`${STRIPE_API}/accounts/${encodeURIComponent(accountId)}/login_links`, {
      method: 'POST',
      headers: stripeHeaders(secretKey),
      body: new URLSearchParams().toString(),
    })
    const text = await loginLinkRes.text()
    if (!loginLinkRes.ok) {
      let msg = text
      try { msg = JSON.parse(text)?.error?.message || text } catch { /* raw */ }
      throw new Error(`Stripe dashboard link failed: ${msg}`)
    }
    const link = JSON.parse(text)
    return res.status(200).json({ url: link.url })
  } catch (err) {
    console.error('[owner-stripe-dashboard-link]', err)
    return res.status(500).json({ error: err.message || 'Failed to generate dashboard link.' })
  }
}

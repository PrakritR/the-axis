/**
 * POST /api/portal?action=owner-stripe-onboarding-link
 * Generates a Stripe Connect account_link for onboarding (or re-onboarding) the owner.
 * Creates the Express account first if it doesn't exist yet.
 *
 * Returns: { url: string }  — redirect owner to this URL
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

function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https'
  const host = req.headers['x-forwarded-host'] || req.headers.host
  return `${proto}://${host}`
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
  })
}

async function createStripeExpressAccount(secretKey, email, name) {
  const body = new URLSearchParams()
  body.append('type', 'express')
  body.append('country', 'US')
  if (email) body.append('email', email)
  if (name) body.append('individual[first_name]', name.split(' ')[0] || name)
  if (name && name.includes(' ')) body.append('individual[last_name]', name.split(' ').slice(1).join(' '))
  body.append('capabilities[transfers][requested]', 'true')
  body.append('capabilities[card_payments][requested]', 'true')
  body.append('metadata[axis_role]', 'property_owner')

  const res = await fetch(`${STRIPE_API}/accounts`, {
    method: 'POST',
    headers: stripeHeaders(secretKey),
    body: body.toString(),
  })
  const text = await res.text()
  if (!res.ok) {
    let msg = text
    try { msg = JSON.parse(text)?.error?.message || text } catch { /* raw */ }
    throw new Error(`Stripe account creation failed: ${msg}`)
  }
  return JSON.parse(text)
}

async function createAccountLink(secretKey, accountId, refreshUrl, returnUrl) {
  const body = new URLSearchParams({
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: 'account_onboarding',
  })
  const res = await fetch(`${STRIPE_API}/account_links`, {
    method: 'POST',
    headers: stripeHeaders(secretKey),
    body: body.toString(),
  })
  const text = await res.text()
  if (!res.ok) {
    let msg = text
    try { msg = JSON.parse(text)?.error?.message || text } catch { /* raw */ }
    throw new Error(`Failed to create Stripe onboarding link: ${msg}`)
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
    let accountId = String(ownerRecord['Stripe Connect Account ID'] || '').trim()

    // Create Express account if not yet created
    if (!accountId || !accountId.startsWith('acct_')) {
      const account = await createStripeExpressAccount(
        secretKey,
        String(ownerRecord.Email || '').trim(),
        String(ownerRecord.Name || '').trim(),
      )
      accountId = account.id
      await updateOwner(owner.id, { 'Stripe Connect Account ID': accountId })
    }

    const baseUrl = getBaseUrl(req)
    const refreshUrl = `${baseUrl}/owner?stripe=refresh`
    const returnUrl = `${baseUrl}/owner?stripe=return`

    const link = await createAccountLink(secretKey, accountId, refreshUrl, returnUrl)

    return res.status(200).json({ url: link.url })
  } catch (err) {
    console.error('[owner-stripe-onboarding-link]', err)
    return res.status(500).json({ error: err.message || 'Failed to generate onboarding link.' })
  }
}

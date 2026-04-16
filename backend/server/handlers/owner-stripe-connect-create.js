/**
 * POST /api/portal?action=owner-stripe-connect-create
 * Creates a Stripe Connect Express account for the authenticated owner
 * and saves the account ID to their Owner Profile row.
 *
 * Idempotent: if Stripe Connect Account ID already exists on the record, returns it without creating a new one.
 *
 * Body (from portal, already validated via resolveOwnerTenant): { ownerRecordId }
 * Returns: { accountId: string }
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
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${OWNER_TABLE}/${recordId}`, {
    method: 'PATCH',
    headers: airtableHeaders(),
    body: JSON.stringify({ fields, typecast: true }),
  })
  if (!res.ok) throw new Error('Failed to update owner record.')
  return res.json()
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey) return res.status(500).json({ error: 'Stripe is not configured on this server.' })
  if (!AIRTABLE_TOKEN) return res.status(500).json({ error: 'Server configuration error.' })

  // Owner identity comes from the authenticated session via resolveOwnerTenant middleware
  const owner = req._ownerTenant
  if (!owner?.id) return res.status(403).json({ error: 'Unauthorized.' })

  try {
    const ownerRecord = await getOwnerRecord(owner.id)

    // Idempotent — already has a connected account
    const existingAccountId = String(ownerRecord['Stripe Connect Account ID'] || '').trim()
    if (existingAccountId && existingAccountId.startsWith('acct_')) {
      return res.status(200).json({ accountId: existingAccountId, alreadyExists: true })
    }

    const stripeAccount = await createStripeExpressAccount(
      secretKey,
      String(ownerRecord.Email || '').trim(),
      String(ownerRecord.Name || '').trim(),
    )

    // Persist the new account ID
    await updateOwner(owner.id, { 'Stripe Connect Account ID': stripeAccount.id })

    return res.status(200).json({ accountId: stripeAccount.id })
  } catch (err) {
    console.error('[owner-stripe-connect-create]', err)
    return res.status(500).json({ error: err.message || 'Failed to create Stripe account.' })
  }
}

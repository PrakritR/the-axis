/**
 * POST /api/portal?action=owner-auth
 * Authenticate a homeowner/property-owner account against the "Owner Profile" Airtable table.
 *
 * Airtable table: process.env.AIRTABLE_OWNER_PROFILE_TABLE  (default: "Owner Profile")
 * Required fields: Email, Password, Name, Active
 * Returns: { owner: { id, ownerId, name, email, phone, stripeConnectAccountId, stripeOnboardingComplete, stripePayoutsEnabled } }
 */

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
const BASE_ID = process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const OWNER_TABLE = encodeURIComponent(
  process.env.AIRTABLE_OWNER_PROFILE_TABLE || 'Owner Profile',
)

function airtableHeaders() {
  return {
    Authorization: `Bearer ${AIRTABLE_TOKEN}`,
    'Content-Type': 'application/json',
  }
}

function mapRecord(record) {
  return { id: record.id, ...record.fields, created_at: record.createdTime }
}

function escapeFormulaValue(v) {
  return String(v || '').replace(/"/g, '\\"')
}

async function getOwnerByEmail(email) {
  const formula = encodeURIComponent(`{Email} = "${escapeFormulaValue(email)}"`)
  const url = `https://api.airtable.com/v0/${BASE_ID}/${OWNER_TABLE}?filterByFormula=${formula}&maxRecords=1`
  const res = await fetch(url, { headers: airtableHeaders() })
  if (!res.ok) throw new Error('Database error. Please try again.')
  const data = await res.json()
  const record = data.records?.[0]
  return record ? mapRecord(record) : null
}

function deriveOwnerId(recordId) {
  const suffix = String(recordId || '').replace(/^rec/i, '').toUpperCase()
  return `OWN-${suffix}`
}

function isActive(owner) {
  const v = owner?.Active
  if (v === true || v === 1) return true
  return ['true', '1', 'yes', 'active'].includes(String(v || '').trim().toLowerCase())
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!AIRTABLE_TOKEN) return res.status(500).json({ error: 'Server configuration error.' })

  const { email, password } = req.body || {}
  const normalizedEmail = String(email || '').trim().toLowerCase()

  if (!normalizedEmail || !password) {
    return res.status(400).json({ error: 'Email and password are required.' })
  }

  try {
    const owner = await getOwnerByEmail(normalizedEmail)

    if (!owner || owner.Password !== password) {
      return res.status(401).json({ error: 'Invalid email or password.' })
    }

    if (!isActive(owner) && owner.Active !== undefined) {
      return res.status(403).json({ error: 'This account is inactive. Contact your administrator.' })
    }

    return res.status(200).json({
      owner: {
        id: owner.id,
        ownerId: deriveOwnerId(owner.id),
        name: String(owner.Name || '').trim(),
        email: String(owner.Email || '').trim().toLowerCase(),
        phone: String(owner.Phone || owner['Phone Number'] || '').trim(),
        notes: String(owner.Notes || '').trim(),
        stripeConnectAccountId: String(owner['Stripe Connect Account ID'] || '').trim(),
        stripeOnboardingComplete: owner['Stripe Onboarding Complete'] === true,
        stripePayoutsEnabled: owner['Stripe Payouts Enabled'] === true,
        stripeChargesEnabled: owner['Stripe Charges Enabled'] === true,
        stripeDetailsSubmitted: owner['Stripe Details Submitted'] === true,
      },
    })
  } catch (err) {
    console.error('[owner-auth]', err)
    return res.status(500).json({ error: 'Authentication failed. Please try again.' })
  }
}

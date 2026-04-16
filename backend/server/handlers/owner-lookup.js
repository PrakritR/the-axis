/**
 * POST /api/portal?action=owner-lookup
 * Check whether an owner account exists for a given email.
 * Returns { exists: bool, hasPassword: bool }
 */

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
const BASE_ID = process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const OWNER_TABLE = encodeURIComponent(process.env.AIRTABLE_OWNER_PROFILE_TABLE || 'Owner Profile')

function airtableHeaders() {
  return { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' }
}

function escapeFormulaValue(v) {
  return String(v || '').replace(/"/g, '\\"')
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { email } = req.body || {}
  const normalizedEmail = String(email || '').trim().toLowerCase()
  if (!normalizedEmail) return res.status(400).json({ error: 'Email is required.' })

  try {
    const formula = encodeURIComponent(`{Email} = "${escapeFormulaValue(normalizedEmail)}"`)
    const url = `https://api.airtable.com/v0/${BASE_ID}/${OWNER_TABLE}?filterByFormula=${formula}&maxRecords=1`
    const atRes = await fetch(url, { headers: airtableHeaders() })
    if (!atRes.ok) throw new Error('Database error.')
    const data = await atRes.json()
    const record = data.records?.[0]
    if (!record) return res.status(200).json({ exists: false, hasPassword: false })
    const hasPassword = Boolean(record.fields?.Password && String(record.fields.Password).trim())
    return res.status(200).json({ exists: true, hasPassword })
  } catch (err) {
    console.error('[owner-lookup]', err)
    return res.status(500).json({ error: 'Lookup failed. Please try again.' })
  }
}

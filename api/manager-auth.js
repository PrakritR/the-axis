// ─── Manager Authentication API ───────────────────────────────────────────────
// POST /api/manager-auth
//
// Validates manager credentials against the Airtable "Managers" table.
// Returns manager info (without the password field) on success.
// Called by the Manager portal login form.
//
// Workflow note: This is the only part of the manager portal that must go
// through a server-side route, because validating passwords client-side would
// expose all manager records via the shared Airtable token. Everything else
// (reading/updating Lease Drafts) uses the same client-side Airtable pattern
// as the resident portal.

const AIRTABLE_TOKEN = process.env.VITE_AIRTABLE_TOKEN
const BASE_ID = process.env.VITE_AIRTABLE_APPLICATIONS_BASE_ID || 'appNBX2inqfJMyqYV'

function airtableHeaders() {
  return {
    Authorization: `Bearer ${AIRTABLE_TOKEN}`,
    'Content-Type': 'application/json',
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!AIRTABLE_TOKEN) {
    return res.status(500).json({ error: 'Server configuration error: Airtable token not set.' })
  }

  const { email, password } = req.body || {}

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' })
  }

  try {
    // Query the Managers table for this email
    const formula = encodeURIComponent(`{Email} = "${email.trim().toLowerCase().replace(/"/g, '\\"')}"`)
    const url = `https://api.airtable.com/v0/${BASE_ID}/Managers?filterByFormula=${formula}&maxRecords=1`

    const atRes = await fetch(url, { headers: airtableHeaders() })

    if (!atRes.ok) {
      // Don't leak Airtable error details — could expose table structure
      console.error('Airtable manager query error:', await atRes.text())
      return res.status(500).json({ error: 'Database error. Please try again.' })
    }

    const data = await atRes.json()
    const record = data.records?.[0]

    // Use identical error message for "not found" and "wrong password" to
    // prevent email enumeration attacks
    if (!record) {
      return res.status(401).json({ error: 'Invalid email or password.' })
    }

    const fields = record.fields

    if (fields.Password !== password) {
      return res.status(401).json({ error: 'Invalid email or password.' })
    }

    if (fields.Active === false || fields.Active === 0) {
      return res.status(403).json({ error: 'This account is inactive. Please contact your administrator.' })
    }

    // ✅ Success — return manager info without the password field
    return res.status(200).json({
      manager: {
        id: record.id,
        name: fields.Name || '',
        email: fields.Email || '',
        role: fields.Role || 'Manager',
      },
    })
  } catch (err) {
    console.error('Manager auth error:', err)
    return res.status(500).json({ error: 'Authentication failed. Please try again.' })
  }
}

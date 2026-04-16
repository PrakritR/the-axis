/**
 * POST /api/portal?action=owner-create-account
 * Create a new Owner Profile row, or set the password on an existing invitation row.
 *
 * Body: { name, email, phone, password }
 * Returns: { owner: { id, ownerId, name, email } }
 *
 * Duplicate prevention: if a row with the same email already exists and has no password,
 * the password is set (manager invited the owner first).  If the row already has a password,
 * an error is returned to prevent takeover.
 */

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
const BASE_ID = process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const OWNER_TABLE = encodeURIComponent(process.env.AIRTABLE_OWNER_PROFILE_TABLE || 'Owner Profile')

function airtableHeaders() {
  return { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' }
}

function mapRecord(r) {
  return { id: r.id, ...r.fields, created_at: r.createdTime }
}

function escapeFormulaValue(v) {
  return String(v || '').replace(/"/g, '\\"')
}

function deriveOwnerId(recordId) {
  return `OWN-${String(recordId || '').replace(/^rec/i, '').toUpperCase()}`
}

async function getOwnerByEmail(email) {
  const formula = encodeURIComponent(`{Email} = "${escapeFormulaValue(email)}"`)
  const url = `https://api.airtable.com/v0/${BASE_ID}/${OWNER_TABLE}?filterByFormula=${formula}&maxRecords=1`
  const res = await fetch(url, { headers: airtableHeaders() })
  if (!res.ok) throw new Error('Database error.')
  const data = await res.json()
  const record = data.records?.[0]
  return record ? mapRecord(record) : null
}

async function createOwner(fields) {
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${OWNER_TABLE}`, {
    method: 'POST',
    headers: airtableHeaders(),
    body: JSON.stringify({ fields, typecast: true }),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Database create error: ${t}`)
  }
  return mapRecord(await res.json())
}

async function updateOwner(recordId, fields) {
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${OWNER_TABLE}/${recordId}`, {
    method: 'PATCH',
    headers: airtableHeaders(),
    body: JSON.stringify({ fields, typecast: true }),
  })
  if (!res.ok) throw new Error('Database update error.')
  return mapRecord(await res.json())
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!AIRTABLE_TOKEN) return res.status(500).json({ error: 'Server configuration error.' })

  const { name, email, phone, password } = req.body || {}
  const normalizedEmail = String(email || '').trim().toLowerCase()
  const normalizedName = String(name || '').trim()
  const pw = String(password || '').trim()

  if (!normalizedEmail || !pw) {
    return res.status(400).json({ error: 'Email and password are required.' })
  }
  if (pw.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' })
  }

  try {
    const existing = await getOwnerByEmail(normalizedEmail)

    if (existing) {
      const existingPw = String(existing.Password || '').trim()
      if (existingPw) {
        return res.status(409).json({ error: 'An account with this email already exists. Please sign in instead.' })
      }
      // Owner row was pre-created by an admin/manager invite — just set the password
      const updated = await updateOwner(existing.id, {
        Password: pw,
        Active: true,
        ...(normalizedName && !existing.Name ? { Name: normalizedName } : {}),
        ...(phone && !existing.Phone ? { Phone: phone } : {}),
      })
      const ownerId = deriveOwnerId(updated.id)
      return res.status(200).json({
        owner: { id: updated.id, ownerId, name: updated.Name || '', email: updated.Email || '' },
      })
    }

    // Brand new account
    const created = await createOwner({
      Name: normalizedName || normalizedEmail.split('@')[0],
      Email: normalizedEmail,
      Phone: String(phone || '').trim() || undefined,
      Password: pw,
      Active: true,
    })
    const ownerId = deriveOwnerId(created.id)
    // Backfill the derived Owner ID field
    await updateOwner(created.id, { 'Owner ID': ownerId }).catch(() => {})

    return res.status(200).json({
      owner: { id: created.id, ownerId, name: created.Name || '', email: created.Email || '' },
    })
  } catch (err) {
    console.error('[owner-create-account]', err)
    return res.status(500).json({ error: err.message || 'Account creation failed. Please try again.' })
  }
}

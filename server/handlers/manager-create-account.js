const AIRTABLE_TOKEN = process.env.VITE_AIRTABLE_TOKEN
const BASE_ID = process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const MANAGER_TABLE_ENC = encodeURIComponent('Manager Profile')

function airtableHeaders() {
  return {
    Authorization: `Bearer ${AIRTABLE_TOKEN}`,
    'Content-Type': 'application/json',
  }
}

function escapeFormulaValue(value) {
  return String(value || '').replace(/"/g, '\\"')
}

function mapRecord(record) {
  return { id: record.id, ...record.fields, created_at: record.createdTime }
}

function extractPhoneFromNotes(notes) {
  const match = String(notes || '').match(/(?:^|\n)Phone:\s*(.+?)(?:\n|$)/i)
  return match ? match[1].trim() : ''
}

function extractMetadataValue(notes, label) {
  const escapedLabel = String(label || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = String(notes || '').match(new RegExp(`(?:^|\\n)${escapedLabel}:\\s*(.+?)(?:\\n|$)`, 'i'))
  return match ? match[1].trim() : ''
}

async function getManagerByManagerId(managerId) {
  const formula = encodeURIComponent(`{Manager ID} = "${escapeFormulaValue(managerId)}"`)
  const url = `https://api.airtable.com/v0/${BASE_ID}/${MANAGER_TABLE_ENC}?filterByFormula=${formula}&maxRecords=1`
  const atRes = await fetch(url, { headers: airtableHeaders() })
  if (!atRes.ok) throw new Error('Database error')
  const data = await atRes.json()
  const record = data.records?.[0]
  return record ? mapRecord(record) : null
}

async function updateManager(recordId, fields) {
  const atRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${MANAGER_TABLE_ENC}/${recordId}`, {
    method: 'PATCH',
    headers: airtableHeaders(),
    body: JSON.stringify({ fields, typecast: true }),
  })
  if (!atRes.ok) throw new Error(await atRes.text())
  return mapRecord(await atRes.json())
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
    return res.status(500).json({ error: 'Server data connection is not configured yet.' })
  }

  const { managerId, name, password } = req.body || {}
  const normalizedManagerId = String(managerId || '').trim().toUpperCase()
  const normalizedName = String(name || '').trim()

  if (!normalizedManagerId || !password) {
    return res.status(400).json({ error: 'Manager ID and password are required.' })
  }

  if (String(password).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' })
  }

  try {
    const manager = await getManagerByManagerId(normalizedManagerId)
    if (!manager) {
      return res.status(404).json({ error: 'No manager subscription record was found for that manager ID yet.' })
    }

    const normalizedEmail = String(manager.Email || '').trim().toLowerCase()
    const normalizedPlanType = String(manager.tier || extractMetadataValue(manager.Notes, 'Plan') || 'free').trim().toLowerCase()
    if (!normalizedEmail) {
      return res.status(400).json({ error: 'This manager record is missing an email address. Please contact support.' })
    }

    if (manager.Password) {
      return res.status(409).json({ error: 'This manager account already exists. Please sign in instead.' })
    }

    const updated = await updateManager(manager.id, {
      'Manager ID': normalizedManagerId,
      Name: normalizedName || manager.Name || normalizedEmail.split('@')[0],
      Password: password,
      Active: true,
    })

    return res.status(200).json({
      manager: {
        id: updated.id,
        managerId: normalizedManagerId,
        name: updated.Name || '',
        email: updated.Email || normalizedEmail,
        phone: String(updated['Phone Number'] || '').trim(),
        planType: updated.tier || extractMetadataValue(updated.Notes, 'Plan') || normalizedPlanType || 'free',
        billingInterval: extractMetadataValue(updated.Notes, 'Billing') || '',
      },
    })
  } catch (err) {
    console.error('Manager create account error:', err)
    return res.status(500).json({ error: 'Could not create the manager account.' })
  }
}

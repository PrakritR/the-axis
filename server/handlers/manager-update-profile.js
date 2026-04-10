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

  const { managerId, name, phone } = req.body || {}
  const normalizedManagerId = String(managerId || '').trim().toUpperCase()

  if (!normalizedManagerId) {
    return res.status(400).json({ error: 'managerId is required.' })
  }

  const normalizedName = String(name || '').trim()
  const normalizedPhone = String(phone || '').trim()

  if (!normalizedName && !normalizedPhone) {
    return res.status(400).json({ error: 'At least one field (name or phone) is required.' })
  }

  try {
    const manager = await getManagerByManagerId(normalizedManagerId)
    if (!manager) {
      return res.status(404).json({ error: 'Manager record not found.' })
    }

    const updates = {}
    if (normalizedName) updates.Name = normalizedName
    if (normalizedPhone) updates.Phone = normalizedPhone

    await updateManager(manager.id, updates)

    return res.status(200).json({
      name: normalizedName || manager.Name || '',
      phone: normalizedPhone || '',
    })
  } catch (err) {
    console.error('Manager update profile error:', err)
    return res.status(500).json({ error: 'Could not update the manager profile.' })
  }
}

const AIRTABLE_TOKEN = process.env.VITE_AIRTABLE_TOKEN
const BASE_ID = process.env.VITE_AIRTABLE_APPLICATIONS_BASE_ID || 'appNBX2inqfJMyqYV'

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

async function getManagerByManagerId(managerId) {
  const formula = encodeURIComponent(`{Manager ID} = "${escapeFormulaValue(managerId)}"`)
  const url = `https://api.airtable.com/v0/${BASE_ID}/Managers?filterByFormula=${formula}&maxRecords=1`
  const atRes = await fetch(url, { headers: airtableHeaders() })
  if (!atRes.ok) throw new Error('Database error')
  const data = await atRes.json()
  const record = data.records?.[0]
  return record ? mapRecord(record) : null
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!AIRTABLE_TOKEN) {
    return res.status(500).json({ error: 'Airtable token is not configured on the server yet.' })
  }

  const managerId = String(req.query?.manager_id || '').trim().toUpperCase()
  if (!managerId) {
    return res.status(400).json({ error: 'manager_id is required.' })
  }

  try {
    const manager = await getManagerByManagerId(managerId)
    if (!manager) {
      return res.status(404).json({ error: 'No manager record was found for that manager ID yet.' })
    }

    return res.status(200).json({
      managerId,
      name: manager.Label || '',
      email: manager.Email || '',
      phone: String(manager.Phone || '').trim() || extractPhoneFromNotes(manager.Notes),
      accountExists: Boolean(manager.Password),
    })
  } catch (err) {
    console.error('Manager lookup error:', err)
    return res.status(500).json({ error: 'Could not load the manager record.' })
  }
}

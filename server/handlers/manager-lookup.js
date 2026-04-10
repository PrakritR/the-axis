const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
const BASE_ID =
  process.env.AIRTABLE_BASE_ID ||
  process.env.VITE_AIRTABLE_BASE_ID ||
  process.env.AIRTABLE_APPLICATIONS_BASE_ID ||
  process.env.VITE_AIRTABLE_APPLICATIONS_BASE_ID ||
  'appol57LKtMKaQ75T'
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!AIRTABLE_TOKEN) {
    return res.status(500).json({ error: 'Server data connection is not configured yet.' })
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
      name: manager.Name || '',
      email: manager.Email || '',
      phone: String(manager['Phone Number'] || '').trim(),
      accountExists: Boolean(manager.Password),
      planType: manager.tier || '',
      billingInterval: '',
      houseAccess: '',
      platformAccess: '',
    })
  } catch (err) {
    console.error('Manager lookup error:', err)
    return res.status(500).json({ error: 'Could not load the manager record.' })
  }
}

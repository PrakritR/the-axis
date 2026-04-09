const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || process.env.VITE_AIRTABLE_APPLICATIONS_BASE_ID || 'appNBX2inqfJMyqYV'
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN

const FALLBACK_PROPERTIES = [
  { id: '4709a', name: '4709A 8th Ave NE', address: '4709A 8th Ave NE, Seattle, WA', rooms: ['Room 1', 'Room 2', 'Room 3', 'Room 4', 'Room 5', 'Room 6', 'Room 7', 'Room 8', 'Room 9', 'Room 10'] },
  { id: '4709b', name: '4709B 8th Ave NE', address: '4709B 8th Ave NE, Seattle, WA', rooms: ['Room 1', 'Room 2', 'Room 3', 'Room 4', 'Room 5', 'Room 6', 'Room 7', 'Room 8', 'Room 9'] },
  { id: '5259', name: '5259 Brooklyn Ave NE', address: '5259 Brooklyn Ave NE, Seattle, WA', rooms: ['Room 1', 'Room 2', 'Room 3', 'Room 4', 'Room 5', 'Room 6', 'Room 7', 'Room 8', 'Room 9'] },
]

function extractNoteValue(notes, label) {
  const escaped = String(label || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = String(notes || '').match(new RegExp(`(?:^|\\n)${escaped}:\\s*(.+?)(?:\\n|$)`, 'i'))
  return match ? match[1].trim() : ''
}

function mapProperty(record) {
  const fields = record.fields || {}
  const rooms = FALLBACK_PROPERTIES.find((item) => item.name === fields.Name || item.name === fields.Property)?.rooms || []
  return {
    id: record.id,
    name: fields.Name || fields.Property || 'Untitled house',
    address: fields.Address || '',
    rooms,
    manager: extractNoteValue(fields.Notes, 'Tour Manager'),
    availability: extractNoteValue(fields.Notes, 'Tour Availability'),
    notes: extractNoteValue(fields.Notes, 'Tour Notes'),
  }
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
    return res.status(200).json({ properties: FALLBACK_PROPERTIES.map((property) => ({ ...property, manager: '', availability: '', notes: '' })) })
  }

  try {
    const resAirtable = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Properties?sort%5B0%5D%5Bfield%5D=Name`, {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
    })
    if (!resAirtable.ok) {
      return res.status(200).json({ properties: FALLBACK_PROPERTIES.map((property) => ({ ...property, manager: '', availability: '', notes: '' })) })
    }
    const data = await resAirtable.json()
    const properties = (data.records || []).map(mapProperty)
    return res.status(200).json({ properties: properties.length ? properties : FALLBACK_PROPERTIES.map((property) => ({ ...property, manager: '', availability: '', notes: '' })) })
  } catch {
    return res.status(200).json({ properties: FALLBACK_PROPERTIES.map((property) => ({ ...property, manager: '', availability: '', notes: '' })) })
  }
}

/**
 * GET  /api/tour  → returns Properties rows that are approved/live (same rules as manager portal scope)
 * POST /api/tour  → saves a tour or meeting booking to Scheduling table
 */

const AIRTABLE_BASE_ID =
  process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
const SCHEDULING_TABLE = 'Scheduling'

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

/** Same rules as Manager.jsx `isPropertyRecordApproved` — only approved/live houses appear in public tour & message pickers. */
function isPropertyRecordApprovedForTour(fields) {
  const p = fields || {}
  const s = String(p.Status || '').trim().toLowerCase()
  if (s === 'pending_review' || s === 'pending review') return false
  if (p.Approved === true || p.Approved === 1 || p.Approved === '1') return true
  const a = String(p['Approval Status'] || '').trim().toLowerCase()
  if (a === 'approved') return true
  return s === 'approved' || s === 'live' || s === 'active'
}

function buildRoomsByPropertyId(roomRecords) {
  const map = new Map()
  for (const r of roomRecords) {
    const roomName = String(r.fields?.Name || r.fields?.['Room Number'] || '').trim()
    if (!roomName) continue
    const links = Array.isArray(r.fields?.Property) ? r.fields.Property : r.fields?.Property ? [r.fields.Property] : []
    for (const pid of links) {
      if (!map.has(pid)) map.set(pid, [])
      map.get(pid).push(roomName)
    }
  }
  return map
}

function mapProperty(record, roomsByPropertyId) {
  const fields = record.fields || {}
  const airtableRooms = (roomsByPropertyId.get(record.id) || []).sort((a, b) => {
    const na = parseInt(String(a).replace(/\D/g, ''), 10) || 0
    const nb = parseInt(String(b).replace(/\D/g, ''), 10) || 0
    return na !== nb ? na - nb : a.localeCompare(b)
  })
  const fallbackRooms = FALLBACK_PROPERTIES.find((p) => p.name === fields.Name || p.name === fields.Property)?.rooms || []
  const rooms = airtableRooms.length ? airtableRooms : fallbackRooms
  const managerEmailRaw =
    (typeof fields['Site Manager Email'] === 'string' && fields['Site Manager Email'].trim()) ||
    extractNoteValue(fields.Notes, 'Site Manager Email') ||
    ''
  const appFeeRaw = fields['Application Fee']
  let applicationFee
  if (typeof appFeeRaw === 'number' && Number.isFinite(appFeeRaw)) {
    applicationFee = Math.max(0, Math.min(9999, Math.round(appFeeRaw)))
  }

  return {
    id: record.id,
    name: fields.Name || fields.Property || 'Untitled house',
    address: fields.Address || '',
    rooms,
    ...(applicationFee !== undefined ? { applicationFee } : {}),
    manager: extractNoteValue(fields.Notes, 'Tour Manager'),
    /** Used to route public “Message Axis” form to the correct Manager portal thread (must be an email). */
    managerEmail: managerEmailRaw.trim(),
    availability: extractNoteValue(fields.Notes, 'Tour Availability'),
    notes: extractNoteValue(fields.Notes, 'Tour Notes'),
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  // ── GET: return properties ────────────────────────────────────────────────
  if (req.method === 'GET') {
    const fallback = {
      properties: FALLBACK_PROPERTIES.map((p) => ({ ...p, manager: '', managerEmail: '', availability: '', notes: '' })),
    }
    if (!AIRTABLE_TOKEN) return res.status(200).json(fallback)
    try {
      const roomsTable = process.env.VITE_AIRTABLE_ROOMS_TABLE || 'Rooms'
      const [propRes, roomsRes] = await Promise.all([
        fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Properties?sort%5B0%5D%5Bfield%5D=Name`, {
          headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
        }),
        fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(roomsTable)}?fields%5B%5D=Name&fields%5B%5D=Property`, {
          headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
        }),
      ])
      if (!propRes.ok) return res.status(200).json(fallback)
      const [propData, roomsData] = await Promise.all([propRes.json(), roomsRes.ok ? roomsRes.json() : Promise.resolve({ records: [] })])
      const roomsByPropertyId = buildRoomsByPropertyId(roomsData.records || [])
      const allRecords = propData.records || []
      const approvedRecords = allRecords.filter((r) => isPropertyRecordApprovedForTour(r.fields || {}))
      const properties = approvedRecords.map((r) => mapProperty(r, roomsByPropertyId))
      if (properties.length) return res.status(200).json({ properties })
      // Table empty → keep legacy fallback for empty bases / local dev
      if (allRecords.length === 0) return res.status(200).json(fallback)
      // Has rows but none approved yet → empty list (front-end must not substitute hardcoded houses)
      return res.status(200).json({ properties: [] })
    } catch {
      return res.status(200).json(fallback)
    }
  }

  // ── POST: schedule a tour ─────────────────────────────────────────────────
  if (req.method === 'POST') {
    const token = process.env.AIRTABLE_TOKEN
    if (!token) return res.status(500).json({ error: 'Data API token is not configured on the server.' })

    const { name, email, phone, type, property, room, tourFormat, manager, managerEmail, tourAvailability, preferredDate, preferredTime, notes } = req.body ?? {}
    if (!name || !email) return res.status(400).json({ error: 'Name and email are required.' })

    const rawType = String(type || '').trim().toLowerCase()
    const normalizedType =
      rawType === 'meeting'
        ? 'Meeting'
        : rawType === 'work order'
          ? 'Work Order'
          : rawType === 'issue' || rawType === 'other'
            ? 'Issue'
            : 'Tour'

    const fields = {
      'Name': String(name).trim(),
      'Email': String(email).trim().toLowerCase(),
      'Type': normalizedType,
      'Status': 'New',
    }
    if (phone)             fields['Phone'] = String(phone).trim()
    if (property)          fields['Property'] = String(property).trim()
    if (room)              fields['Room'] = String(room).trim()
    if (tourFormat)        fields['Tour Format'] = tourFormat
    if (manager)           fields['Tour Manager'] = String(manager).trim()
    if (managerEmail)      fields['Manager Email'] = String(managerEmail).trim().toLowerCase()
    if (tourAvailability)  fields['Tour Availability'] = String(tourAvailability).trim()
    if (preferredDate)     fields['Preferred Date'] = preferredDate
    if (preferredTime)     fields['Preferred Time'] = preferredTime
    if (notes)             fields['Notes'] = String(notes).trim()

    try {
      const r = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(SCHEDULING_TABLE)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields, typecast: true }),
      })
      if (!r.ok) {
        const body = await r.text()
        let msg = `Data service error ${r.status}`
        try { msg += ': ' + JSON.parse(body)?.error?.message } catch { msg += ': ' + body }
        return res.status(502).json({ error: msg })
      }
      const data = await r.json()
      return res.status(200).json({ id: data.id })
    } catch (err) {
      console.error('[tour]', err)
      return res.status(500).json({ error: err?.message || 'Could not save booking request.' })
    }
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

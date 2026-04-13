/**
 * GET  /api/tour  → returns Properties rows that are approved/live (same rules as manager portal scope)
 * POST /api/tour  → saves a tour or meeting booking to Scheduling table
 */

const AIRTABLE_BASE_ID =
  process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
const SCHEDULING_TABLE = 'Scheduling'
const STATUS_BLOCKED_VALUES = new Set(['declined', 'rejected', 'cancelled', 'canceled'])

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

/**
 * Extracts a potentially multi-line block value from a Notes field.
 * Stops at the next "Label: ..." line so multi-line availability is captured fully.
 * e.g. "Tour Availability: Mon: 540-720\nTue: 600-840\nWed: 480-660"
 */
function extractMultilineNoteValue(notes, label) {
  const escaped = String(label || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const startRe = new RegExp(`(?:^|\\n)${escaped}:\\s*`, 'i')
  const s = String(notes || '')
  const startMatch = s.match(startRe)
  if (!startMatch) return ''
  const after = s.slice(startMatch.index + startMatch[0].length)
  // Stop at the next line that looks like another "Key: value" label
  const stopMatch = after.match(/\n[A-Za-z][A-Za-z ]*:/)
  const block = stopMatch ? after.slice(0, stopMatch.index) : after
  return block.trim()
}

function propertyTourAvailabilityFromFields(fields) {
  const f = fields || {}
  const explicit = String(f['Tour Availability'] || f['Calendar Availability'] || '').trim()
  const fromNotes = extractMultilineNoteValue(f.Notes, 'Tour Availability') || ''
  return explicit || fromNotes
}

function normalizeDateKey(value) {
  const match = String(value || '').trim().match(/^(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : ''
}

function displayTime(minutes) {
  const hrs24 = Math.floor(minutes / 60)
  const mins = Math.max(0, minutes % 60)
  let hrs12 = hrs24 % 12
  if (hrs12 === 0) hrs12 = 12
  const ampm = hrs24 >= 12 ? 'PM' : 'AM'
  return `${hrs12}:${String(mins).padStart(2, '0')} ${ampm}`
}

function parseClockToMinutes(value) {
  const m = String(value || '').trim().toUpperCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/)
  if (!m) return null
  let hour = Number(m[1]) % 12
  const minute = Number(m[2] || '0')
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute > 59) return null
  if (m[3] === 'PM') hour += 12
  return hour * 60 + minute
}

function parseTimeRangeToMinutes(value) {
  const parts = String(value || '')
    .split(/\s*[\-–]\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length !== 2) return null
  const start = parseClockToMinutes(parts[0])
  const end = parseClockToMinutes(parts[1])
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  return { start, end }
}

function normalizeRangeLabel(value) {
  const parsed = parseTimeRangeToMinutes(value)
  if (!parsed) return ''
  return `${displayTime(parsed.start)} - ${displayTime(parsed.end)}`
}

function rangesOverlap(a, b) {
  return a.start < b.end && b.start < a.end
}

function dayAbbrForDateKey(dateKey) {
  const d = new Date(`${dateKey}T00:00:00`)
  if (Number.isNaN(d.getTime())) return ''
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()] || ''
}

function parseAvailabilityTokens(rawAvailability) {
  const out = {}
  String(rawAvailability || '')
    .split(/\n|;/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const m = line.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s*[:\-]\s*(.+)$/i)
      if (!m) return
      const day = m[1].slice(0, 1).toUpperCase() + m[1].slice(1, 3).toLowerCase()
      out[day] = m[2]
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
    })
  return out
}

function availabilitySlotsForDate(rawAvailability, dateKey) {
  const day = dayAbbrForDateKey(dateKey)
  if (!day) return []
  const map = parseAvailabilityTokens(rawAvailability)
  const tokens = map[day] || []
  const labels = []
  for (const token of tokens) {
    const pair = String(token).match(/^(\d+)-(\d+)$/)
    if (pair) {
      const start = Number(pair[1])
      const end = Number(pair[2])
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
        labels.push(`${displayTime(start)} - ${displayTime(end)}`)
      }
      continue
    }
    const normalized = normalizeRangeLabel(token)
    if (normalized) labels.push(normalized)
  }
  return labels
}

function statusAllowsConflict(statusValue) {
  const status = String(statusValue || '').trim().toLowerCase()
  return !STATUS_BLOCKED_VALUES.has(status)
}

async function listSchedulingRows(filterByFormula = '') {
  if (!AIRTABLE_TOKEN) return []
  const rows = []
  let offset = null
  do {
    const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(SCHEDULING_TABLE)}`)
    if (filterByFormula) url.searchParams.set('filterByFormula', filterByFormula)
    if (offset) url.searchParams.set('offset', offset)
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } })
    if (!res.ok) break
    const data = await res.json()
    for (const record of data.records || []) rows.push(record)
    offset = data.offset || null
  } while (offset)
  return rows
}

function buildBookedSlotsByPropertyDate(records) {
  const out = {}
  for (const record of records || []) {
    const fields = record?.fields || {}
    if (String(fields.Type || '').trim().toLowerCase() !== 'tour') continue
    if (!statusAllowsConflict(fields.Status)) continue
    const property = String(fields.Property || '').trim()
    const dateKey = normalizeDateKey(fields['Preferred Date'])
    const slot = normalizeRangeLabel(fields['Preferred Time'])
    if (!property || !dateKey || !slot) continue
    const p = property.toLowerCase()
    if (!out[p]) out[p] = {}
    if (!out[p][dateKey]) out[p][dateKey] = []
    if (!out[p][dateKey].includes(slot)) out[p][dateKey].push(slot)
  }
  return out
}

function pickPropertyName(fields = {}) {
  const candidates = [fields['Property Name'], fields.Name]
  for (const candidate of candidates) {
    const text = String(candidate || '').trim()
    if (!text) continue
    if (!/[A-Za-z]/.test(text)) continue
    return text
  }
  return ''
}

function buildRoomsByPropertyId(roomRecords) {
  const map = new Map()
  for (const r of roomRecords) {
    const f = r.fields || {}
    const roomName = String(
      f.Name || f['Room Number'] || f['Room Name'] || f.Title || f.Label || '',
    ).trim()
    if (!roomName) continue
    const links = Array.isArray(f.Property) ? f.Property : f.Property ? [f.Property] : []
    for (const pid of links) {
      if (!map.has(pid)) map.set(pid, [])
      map.get(pid).push(roomName)
    }
  }
  return map
}

const AXIS_LISTING_META_START = '---AXIS_LISTING_META_JSON---'

/**
 * Room labels from manager "Add property" wizard (embedded in Other Info JSON).
 * Without this, apply/tour room dropdowns stay empty when no linked Rooms rows exist.
 */
function roomsFromAxisMetaOtherInfo(otherInfo) {
  const raw = String(otherInfo || '')
  const idx = raw.indexOf(AXIS_LISTING_META_START)
  if (idx === -1) return []
  try {
    const meta = JSON.parse(raw.slice(idx + AXIS_LISTING_META_START.length).trim())
    const details = meta?.roomsDetail
    if (!Array.isArray(details) || details.length === 0) return []
    return details.map((row, i) => {
      const label = String(row?.label || '').trim()
      return label || `Room ${i + 1}`
    })
  } catch {
    return []
  }
}

/**
 * Same rules as frontend `propertyListingVisibleForMarketing` — tours, apply dropdown, and public flows.
 */
function propertyRecordVisibleForPublic(record) {
  const fields = record?.fields || {}
  const approvedRaw = fields.Approved
  const approvedFlag =
    approvedRaw === true ||
    approvedRaw === 1 ||
    approvedRaw === '1' ||
    (typeof approvedRaw === 'string' && approvedRaw.trim().toLowerCase() === 'true')
  if (!approvedFlag) return false

  const approval = String(fields['Approval Status'] || '').trim().toLowerCase()
  const status = String(fields.Status || '').trim().toLowerCase()
  const approvedByStatus =
    approval === 'approved' ||
    approval === 'active' ||
    approval === 'live' ||
    status === 'approved' ||
    status === 'active' ||
    status === 'live'
  if (!approvedFlag && !approvedByStatus) return false
  if (
    approval === 'changes requested' ||
    approval === 'changes_requested' ||
    approval === 'rejected' ||
    approval === 'unlisted' ||
    approval === 'inactive'
  ) {
    return false
  }

  const listedRaw = fields.Listed
  if (
    listedRaw === false ||
    listedRaw === 0 ||
    (typeof listedRaw === 'string' && listedRaw.trim().toLowerCase() === 'false')
  ) {
    return false
  }

  const axis = String(fields['Axis Admin Listing Status'] || fields['Admin Listing Status'] || '')
    .trim()
    .toLowerCase()
  if (axis === 'unlisted' || axis === 'inactive') return false
  if (
    axis === 'changes requested' ||
    axis === 'changes_requested' ||
    axis === 'rejected'
  ) {
    return false
  }

  return true
}

function mapProperty(record, roomsByPropertyId) {
  const fields = record.fields || {}

  // Rooms: axis meta (wizard) → linked Rooms table → Room Count placeholders
  const airtableRooms = (roomsByPropertyId.get(record.id) || []).sort((a, b) => {
    const na = parseInt(String(a).replace(/\D/g, ''), 10) || 0
    const nb = parseInt(String(b).replace(/\D/g, ''), 10) || 0
    return na !== nb ? na - nb : a.localeCompare(b)
  })
  const roomCount = parseInt(String(fields['Room Count'] || ''), 10) || 0
  const countRooms = roomCount > 0 ? Array.from({ length: roomCount }, (_, i) => `Room ${i + 1}`) : []
  const metaRooms = roomsFromAxisMetaOtherInfo(fields['Other Info'])
  const rooms =
    metaRooms.length > 0 ? metaRooms : airtableRooms.length > 0 ? airtableRooms : countRooms

  const managerEmailRaw =
    (typeof fields['Site Manager Email'] === 'string' && fields['Site Manager Email'].trim()) ||
    extractNoteValue(fields.Notes, 'Site Manager Email') ||
    ''
  const appFeeRaw = fields['Application Fee']
  let applicationFee
  if (typeof appFeeRaw === 'number' && Number.isFinite(appFeeRaw)) {
    applicationFee = Math.max(0, Math.min(9999, Math.round(appFeeRaw)))
  }

  // Property name: use explicit property title fields only.
  const name = pickPropertyName(fields)
  if (!name) return null

  // Tour availability: dedicated fields or Notes block (same merge as manager portal calendar).
  const availability = propertyTourAvailabilityFromFields(fields)

  return {
    id: record.id,
    name,
    address: String(fields.Address || '').trim(),
    rooms,
    ...(applicationFee !== undefined ? { applicationFee } : {}),
    manager: extractNoteValue(fields.Notes, 'Tour Manager'),
    /** Used to route public “Message Axis” form to the correct Manager portal thread (must be an email). */
    managerEmail: managerEmailRaw.trim(),
    availability,
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
    const fallback = { properties: [] }
    if (!AIRTABLE_TOKEN) return res.status(200).json(fallback)
    try {
      const roomsTable = process.env.VITE_AIRTABLE_ROOMS_TABLE || 'Rooms'
      const [propRes, roomsRes, schedulingRecords] = await Promise.all([
        fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Properties`, {
          headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
        }),
        fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(roomsTable)}`, {
          headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
        }),
        listSchedulingRows(),
      ])
      if (!propRes.ok) return res.status(200).json(fallback)
      const [propData, roomsData] = await Promise.all([propRes.json(), roomsRes.ok ? roomsRes.json() : Promise.resolve({ records: [] })])
      const roomsByPropertyId = buildRoomsByPropertyId(roomsData.records || [])
      const allRecords = propData.records || []
      const approvedRecords = allRecords.filter(propertyRecordVisibleForPublic)
      const bookedSlotsByPropertyDate = buildBookedSlotsByPropertyDate(schedulingRecords)
      const properties = approvedRecords
        .map((r) => mapProperty(r, roomsByPropertyId))
        .filter(Boolean)
        .map((property) => ({
          ...property,
          bookedSlotsByDate: bookedSlotsByPropertyDate[String(property.name || '').trim().toLowerCase()] || {},
        }))
      if (properties.length) return res.status(200).json({ properties })
      // Empty table or no approved listings yet.
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
        : rawType === 'availability' || rawType === 'meeting availability'
          ? 'Meeting Availability'
        : rawType === 'work order'
          ? 'Work Order'
          : rawType === 'issue' || rawType === 'other'
            ? 'Issue'
            : 'Tour'

    const preferredDateKey = normalizeDateKey(preferredDate)
    const preferredTimeLabel = normalizeRangeLabel(preferredTime)

    if (normalizedType === 'Tour') {
      if (!String(property || '').trim()) {
        return res.status(400).json({ error: 'Property is required for tour booking.' })
      }
      if (!preferredDateKey || !preferredTimeLabel) {
        return res.status(400).json({ error: 'Tour date and time are required.' })
      }

      const propertiesRes = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Properties`, {
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
      })
      if (!propertiesRes.ok) {
        return res.status(502).json({ error: 'Could not verify tour availability.' })
      }
      const propertiesData = await propertiesRes.json()
      const records = Array.isArray(propertiesData.records) ? propertiesData.records : []
      const propertyNameLower = String(property || '').trim().toLowerCase()
      const propertyRecord = records.find((record) => {
        if (!propertyRecordVisibleForPublic(record)) return false
        const mappedName = pickPropertyName(record?.fields || {})
        return String(mappedName || '').trim().toLowerCase() === propertyNameLower
      })
      if (!propertyRecord) {
        return res.status(409).json({ error: 'This property is not available for tours right now.' })
      }
      const propertyAvailability = propertyTourAvailabilityFromFields(propertyRecord.fields)
      const allowed = availabilitySlotsForDate(propertyAvailability, preferredDateKey)
      const allowedSet = new Set(allowed.map((slot) => slot.toLowerCase()))
      if (!allowedSet.has(preferredTimeLabel.toLowerCase())) {
        return res.status(409).json({ error: 'That tour slot is no longer available. Please choose another time.' })
      }
    }

    const fields = {
      'Name': String(name).trim(),
      'Email': String(email).trim().toLowerCase(),
      'Type': normalizedType,
      'Status': normalizedType === 'Meeting Availability' ? 'Available' : 'New',
    }
    if (phone)             fields['Phone'] = String(phone).trim()
    if (property)          fields['Property'] = String(property).trim()
    if (room)              fields['Room'] = String(room).trim()
    if (tourFormat)        fields['Tour Format'] = tourFormat
    if (manager)           fields['Tour Manager'] = String(manager).trim()
    if (managerEmail)      fields['Manager Email'] = String(managerEmail).trim().toLowerCase()
    if (tourAvailability)  fields['Tour Availability'] = String(tourAvailability).trim()
    if (preferredDateKey)  fields['Preferred Date'] = preferredDateKey
    if (preferredTimeLabel) fields['Preferred Time'] = preferredTimeLabel
    if (notes)             fields['Notes'] = String(notes).trim()

    const conflictRange = parseTimeRangeToMinutes(preferredTimeLabel)
    if (preferredDateKey && conflictRange) {
      const propertyName = String(property || '').trim().toLowerCase()
      const managerEmailLower = String(managerEmail || '').trim().toLowerCase()
      const formulaParts = [`{Preferred Date} = "${preferredDateKey}"`]
      if (propertyName) formulaParts.push(`LOWER({Property} & "") = "${propertyName.replace(/"/g, '\\"')}"`)
      const formula = `AND(${formulaParts.join(', ')})`
      const existingRows = await listSchedulingRows(formula)
      for (const record of existingRows) {
        const row = record?.fields || {}
        if (!statusAllowsConflict(row.Status)) continue
        const rowType = String(row.Type || '').trim().toLowerCase()
        const rowManagerEmail = String(row['Manager Email'] || '').trim().toLowerCase()
        const rowProperty = String(row.Property || '').trim().toLowerCase()
        const shouldCheckManager = managerEmailLower && rowManagerEmail && managerEmailLower === rowManagerEmail
        const shouldCheckProperty = propertyName && rowProperty === propertyName
        if (!shouldCheckManager && !shouldCheckProperty && normalizedType !== 'Tour') continue
        const rowRange = parseTimeRangeToMinutes(row['Preferred Time'])
        if (!rowRange) continue
        if (rangesOverlap(conflictRange, rowRange)) {
          if (normalizedType === 'Tour' || rowType === 'tour') {
            return res.status(409).json({ error: 'This tour slot has already been booked. Please choose another time.' })
          }
          if (shouldCheckManager) {
            return res.status(409).json({ error: 'That time conflicts with an existing calendar event.' })
          }
        }
      }
    }

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

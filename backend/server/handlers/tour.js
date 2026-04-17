/**
 * GET  /api/tour  → returns Properties rows that are approved/live (same rules as manager portal scope)
 * POST /api/tour  → saves a tour or meeting booking to the Scheduling Airtable table
 * Same handler is used by POST /api/forms?action=tour (public Contact / property / tour popup).
 */

import { airtableCreateWithUnknownFieldRetry } from '../lib/airtable-write-retry.js'
import { schedulingAirtableTableName } from '../lib/airtable-scheduling-table.js'
import {
  availabilityAirtableBaseId,
  buildManagerAvailabilityConfig,
  buildPropertySlotsByDate,
  mergePropertyAvailabilityRanges,
  rangesToThirtyMinuteSlotLabels,
} from '../../../shared/manager-availability-merge.js'
import { requireServiceClient } from '../lib/app-users-service.js'
import { listPublicMarketingProperties } from '../lib/properties-service.js'
import { listManagerAvailabilityByPropertyId } from '../lib/manager-availability-service.js'
import { mapDbManagerAvailabilityRowsToVirtualMaRecords } from '../lib/manager-availability-virtual-map.js'
import { assertInternalTourSlotAllowed } from '../lib/internal-tour-booking.js'
import { createScheduledEvent, buildInternalTourBookedSlotsByPropertyName } from '../lib/scheduled-events-service.js'

const AIRTABLE_BASE_ID =
  process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
const SCHEDULING_TABLE = schedulingAirtableTableName()
const STATUS_BLOCKED_VALUES = new Set(['declined', 'rejected', 'cancelled', 'canceled'])

const INTERNAL_PROPERTY_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
  const raw = String(value || '').trim()
  if (!raw) return null
  const joined = raw.replace(/\s+to\s+/i, ' - ')
  const parts = joined
    .split(/\s*[\-–—]\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length !== 2) return null
  const parseOne = (token) => {
    const t = String(token || '').trim()
    const hm24 = t.match(/^(\d{1,2}):(\d{2})$/)
    if (hm24) {
      const hh = Number(hm24[1])
      const mm = Number(hm24[2])
      if (Number.isFinite(hh) && Number.isFinite(mm) && hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
        return hh * 60 + mm
      }
    }
    return parseClockToMinutes(t)
  }
  const start = parseOne(parts[0])
  const end = parseOne(parts[1])
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
  const rangePairs = []
  for (const token of tokens) {
    const pair = String(token).match(/^(\d+)-(\d+)$/)
    if (pair) {
      const start = Number(pair[1])
      const end = Number(pair[2])
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
        rangePairs.push({ start, end })
      }
      continue
    }
    const normalized = normalizeRangeLabel(token)
    if (!normalized) continue
    const parsed = parseTimeRangeToMinutes(normalized)
    if (parsed) rangePairs.push(parsed)
  }
  return rangesToThirtyMinuteSlotLabels(rangePairs)
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

/** Paginated load of manager tour availability table (optional). Uses availability base id when set. */
async function listAllManagerAvailabilityRecords() {
  if (!AIRTABLE_TOKEN) return []
  const baseId = availabilityAirtableBaseId(process.env) || AIRTABLE_BASE_ID
  const cfg = buildManagerAvailabilityConfig(process.env)
  const table = encodeURIComponent(cfg.tableName)
  const rows = []
  let offset = null
  try {
    do {
      const url = new URL(`https://api.airtable.com/v0/${baseId}/${table}`)
      if (offset) url.searchParams.set('offset', offset)
      const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } })
      if (!res.ok) return []
      const data = await res.json()
      for (const record of data.records || []) rows.push(record)
      offset = data.offset || null
    } while (offset)
  } catch {
    return []
  }
  return rows
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

/** Merge Airtable Scheduling tour labels with internal `scheduled_events` labels per date. */
function mergeBookedSlotsByDate(airByDate = {}, intByDate = {}) {
  const out = { ...airByDate }
  for (const [dk, labels] of Object.entries(intByDate)) {
    const merged = [...(out[dk] || []), ...(Array.isArray(labels) ? labels : [])]
    const seen = new Set()
    const list = []
    for (const lab of merged) {
      const s = String(lab || '').trim()
      if (!s) continue
      const key = s.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      list.push(s)
    }
    out[dk] = list
  }
  return out
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

function postgresTourAvailabilityText(notesText) {
  const n = String(notesText || '')
  return propertyTourAvailabilityFromFields({
    Notes: n,
    'Other Info': n,
    'Tour Availability': '',
    'Calendar Availability': '',
  })
}

/**
 * Active Postgres properties for public tour picker + slot grids (internal availability only).
 * @param {any[]} schedulingRecords
 */
async function listInternalTourPropertiesForPublicGet(schedulingRecords) {
  try {
    const client = requireServiceClient()
    let props = []
    try {
      props = await listPublicMarketingProperties()
    } catch {
      props = []
    }
    if (!Array.isArray(props) || !props.length) return []
    const ids = props.map((p) => p.id).filter((x) => INTERNAL_PROPERTY_UUID_RE.test(String(x)))
    if (!ids.length) return []

    const { data: roomsData } = await client
      .from('rooms')
      .select('property_id, name')
      .in('property_id', ids)
      .eq('active', true)
    const roomsByPid = new Map()
    for (const row of roomsData || []) {
      const pid = row.property_id
      if (!roomsByPid.has(pid)) roomsByPid.set(pid, [])
      const nm = String(row.name || '').trim()
      if (nm) roomsByPid.get(pid).push(nm)
    }

    const { data: allMa } = await client
      .from('manager_availability')
      .select('*')
      .in('property_id', ids)
      .eq('active', true)
    const maByPid = new Map()
    for (const row of allMa || []) {
      const pid = row.property_id
      if (!maByPid.has(pid)) maByPid.set(pid, [])
      maByPid.get(pid).push(row)
    }

    const mgrIds = [...new Set(props.map((p) => p.managed_by_app_user_id).filter(Boolean))]
    let emailByMgr = new Map()
    if (mgrIds.length) {
      const { data: users } = await client.from('app_users').select('id, email').in('id', mgrIds)
      emailByMgr = new Map((users || []).map((u) => [u.id, String(u.email || '').trim().toLowerCase()]))
    }

    const bookedSlotsByPropertyDate = buildBookedSlotsByPropertyDate(schedulingRecords)
    const maCfg = buildManagerAvailabilityConfig(process.env)

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const end = new Date(today)
    end.setDate(end.getDate() + 56)
    const fd = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`
    const td = `${end.getFullYear()}-${pad2(end.getMonth() + 1)}-${pad2(end.getDate())}`
    let internalBookedMap = {}
    try {
      internalBookedMap = await buildInternalTourBookedSlotsByPropertyName(ids, fd, td)
    } catch {
      internalBookedMap = {}
    }

    return props
      .map((p) => {
        const name = String(p.name || '').trim()
        if (!name) return null
        const pid = String(p.id).trim()
        const mgrEmail = emailByMgr.get(p.managed_by_app_user_id) || ''
        const rawMa = maByPid.get(pid) || []
        const virtualMa = mapDbManagerAvailabilityRowsToVirtualMaRecords(rawMa, {
          propertyName: name,
          propertyRecordId: pid,
          managerEmail: mgrEmail,
          managerRecordId: '',
        })
        const rlist = roomsByPid.get(pid) || []
        const roomsList =
          rlist.length > 0 ? rlist : Array.from({ length: Math.max(1, 6) }, (_, i) => `Room ${i + 1}`)
        const availability = postgresTourAvailabilityText(p.notes)
        const bookedAir = bookedSlotsByPropertyDate[name.toLowerCase()] || {}
        const bookedInt = internalBookedMap[name.toLowerCase()] || {}
        const booked = mergeBookedSlotsByDate(bookedAir, bookedInt)
        const availabilitySlotsByDate = buildPropertySlotsByDate({
          records: virtualMa,
          config: maCfg,
          propertyName: name,
          propertyRecordId: pid,
          managerEmail: mgrEmail,
          managerRecordId: '',
          legacyAvailabilityText: availability,
          bookedSlotsByDate: booked,
          daysAhead: 56,
        })
        return {
          id: pid,
          name,
          address: [p.address_line1, p.address_line2, [p.city, p.state, p.zip].filter(Boolean).join(' ')]
            .filter(Boolean)
            .join(', '),
          rooms: roomsList,
          managerEmail: mgrEmail,
          manager: '',
          availability,
          notes: '',
          bookedSlotsByDate: booked,
          availabilitySlotsByDate,
        }
      })
      .filter(Boolean)
  } catch (e) {
    console.error('[tour] internal properties GET', e)
    return []
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  // ── GET: return properties (Supabase only) ────────────────────────────────
  if (req.method === 'GET') {
    try {
      // Use only Supabase-backed properties for public tour picker
      const internal = await listInternalTourPropertiesForPublicGet([])
      if (internal.length) return res.status(200).json({ properties: internal })
      return res.status(200).json({ properties: [] })
    } catch (e) {
      console.error('[tour] GET error', e)
      return res.status(200).json({ properties: [] })
    }
  }

  // ── POST: schedule a tour (Supabase only) ────────────────────────────────
  if (req.method === 'POST') {
    const {
      name,
      email,
      phone,
      type,
      property,
      propertyId,
      room,
      tourFormat,
      manager,
      managerEmail,
      tourAvailability,
      preferredDate,
      preferredTime,
      notes,
      source: bookingSource,
    } = req.body ?? {}
    const bodyPropertyId = String(propertyId || req.body?.property_id || '').trim()
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

    // Only allow bookings for valid UUID property IDs (Supabase properties)
    if (!INTERNAL_PROPERTY_UUID_RE.test(bodyPropertyId)) {
      return res.status(400).json({ error: 'Property is required and must be a valid property.' })
    }

    const preferredDateKey = normalizeDateKey(preferredDate)
    const preferredTimeLabel = normalizeRangeLabel(preferredTime)
    if (!preferredDateKey || !preferredTimeLabel) {
      return res.status(400).json({ error: 'Tour date and time are required.' })
    }

    // Check slot availability and conflicts using Supabase
    let internalTourCtx = null
    try {
      internalTourCtx = await assertInternalTourSlotAllowed({
        propertyId: bodyPropertyId,
        preferredDateKey,
        preferredTimeLabel,
      })
    } catch (e) {
      const code = /** @type {any} */ (e).statusCode || 500
      return res.status(code).json({ error: e.message || 'Tour booking failed.' })
    }

    try {
      const roomIdRaw = String(req.body?.room_id || req.body?.roomId || '').trim()
      const noteText = notes && String(notes).trim() ? String(notes).trim() : ''
      const created = await createScheduledEvent({
        eventType: 'tour',
        propertyId: bodyPropertyId,
        roomId: INTERNAL_PROPERTY_UUID_RE.test(roomIdRaw) ? roomIdRaw : null,
        managerAppUserId: internalTourCtx.managerAppUserId,
        guestName: String(name).trim(),
        guestEmail: String(email).trim().toLowerCase(),
        guestPhone: phone ? String(phone).trim() : null,
        startAt: internalTourCtx.startIso,
        endAt: internalTourCtx.endIso,
        timezone: internalTourCtx.timezone,
        preferredDate: preferredDateKey,
        preferredTimeLabel: internalTourCtx.normalizedTimeLabel,
        source: String(bookingSource || 'tour_api').trim().slice(0, 80) || 'tour_api',
        notes: noteText || null,
      })
      return res.status(200).json({ id: created.id, scheduling: 'postgres' })
    } catch (err) {
      console.error('[tour] internal booking', err)
      return res.status(502).json({ error: err?.message || 'Could not save booking.' })
    }
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

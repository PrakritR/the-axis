/**
 * GET  /api/meeting  → admin directory + meeting availability + booked slots
 * POST /api/meeting  → books a meeting against admin availability (writes Scheduling row, Type Meeting)
 * Same handler is used by POST /api/forms?action=meeting (public Contact Axis flow).
 */

import { airtableCreateWithUnknownFieldRetry } from '../lib/airtable-write-retry.js'
import { schedulingAirtableTableName } from '../lib/airtable-scheduling-table.js'
import {
  availabilityAirtableBaseId,
  buildAdminMeetingAvailabilityConfig,
  buildGlobalAdminSlotsByDate,
  mergeGlobalAdminAvailabilityRanges,
  rangesToSlotLabels,
} from '../../../shared/manager-availability-merge.js'

const AIRTABLE_BASE_ID =
  process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
const ADMIN_PROFILE_TABLE = process.env.AIRTABLE_ADMIN_PROFILE_TABLE || 'Admin Profile'
const SCHEDULING_TABLE = schedulingAirtableTableName()
const STATUS_BLOCKED_VALUES = new Set(['declined', 'rejected', 'cancelled', 'canceled'])
const AVAILABILITY_TYPE_VALUES = new Set(['availability', 'meeting availability'])

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

function extractMultilineNoteValue(notes, label) {
  const escaped = String(label || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const startRe = new RegExp(`(?:^|\\n)${escaped}:\\s*`, 'i')
  const s = String(notes || '')
  const startMatch = s.match(startRe)
  if (!startMatch) return ''
  const after = s.slice(startMatch.index + startMatch[0].length)
  const stopMatch = after.match(/\n[A-Za-z][A-Za-z ]*:/)
  const block = stopMatch ? after.slice(0, stopMatch.index) : after
  return block.trim()
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

async function fetchAirtableJson(url) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
  })
  if (!response.ok) return null
  return response.json()
}

async function listSchedulingRows(filterByFormula = '') {
  if (!AIRTABLE_TOKEN) return []
  const rows = []
  let offset = null
  do {
    const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(SCHEDULING_TABLE)}`)
    if (filterByFormula) url.searchParams.set('filterByFormula', filterByFormula)
    if (offset) url.searchParams.set('offset', offset)
    const data = await fetchAirtableJson(url.toString())
    if (!data) break
    for (const record of data.records || []) rows.push(record)
    offset = data.offset || null
  } while (offset)
  return rows
}

/** Admin meeting availability rows (separate table when env split is configured). */
async function listAllAdminMeetingAvailabilityRecords() {
  if (!AIRTABLE_TOKEN) return []
  const baseId = availabilityAirtableBaseId(process.env) || AIRTABLE_BASE_ID
  const cfg = buildAdminMeetingAvailabilityConfig(process.env)
  const table = encodeURIComponent(cfg.tableName)
  const rows = []
  let offset = null
  try {
    do {
      const url = new URL(`https://api.airtable.com/v0/${baseId}/${table}`)
      if (offset) url.searchParams.set('offset', offset)
      const data = await fetchAirtableJson(url.toString())
      if (!data) break
      for (const record of data.records || []) rows.push(record)
      offset = data.offset || null
    } while (offset)
  } catch {
    return []
  }
  return rows
}

function buildMeetingBookingsByAdmin(records) {
  const out = {}
  for (const record of records || []) {
    const fields = record?.fields || {}
    if (String(fields.Type || '').trim().toLowerCase() !== 'meeting') continue
    if (!statusAllowsConflict(fields.Status)) continue
    const adminEmail = String(fields['Manager Email'] || '').trim().toLowerCase()
    const dateKey = normalizeDateKey(fields['Preferred Date'])
    const slot = normalizeRangeLabel(fields['Preferred Time'])
    if (!adminEmail || !dateKey || !slot) continue
    if (!out[adminEmail]) out[adminEmail] = {}
    if (!out[adminEmail][dateKey]) out[adminEmail][dateKey] = []
    if (!out[adminEmail][dateKey].includes(slot)) out[adminEmail][dateKey].push(slot)
  }
  return out
}

function buildMeetingAvailabilityByAdminDate(records) {
  const out = {}
  for (const record of records || []) {
    const fields = record?.fields || {}
    const type = String(fields.Type || '').trim().toLowerCase()
    if (!AVAILABILITY_TYPE_VALUES.has(type)) continue
    if (!statusAllowsConflict(fields.Status)) continue
    const adminEmail = String(fields['Manager Email'] || '').trim().toLowerCase()
    const dateKey = normalizeDateKey(fields['Preferred Date'])
    const slot = normalizeRangeLabel(fields['Preferred Time'])
    if (!adminEmail || !dateKey || !slot) continue
    if (!out[adminEmail]) out[adminEmail] = {}
    if (!out[adminEmail][dateKey]) out[adminEmail][dateKey] = []
    if (!out[adminEmail][dateKey].includes(slot)) out[adminEmail][dateKey].push(slot)
  }
  return out
}

function enabledAdminProfile(row) {
  const fields = row?.fields || {}
  const enabled = fields.Enabled
  if (
    enabled === false ||
    enabled === 0 ||
    ['false', 'no', 'inactive', 'disabled'].includes(String(enabled || '').trim().toLowerCase())
  ) {
    return false
  }
  return true
}

function adminMeetingAvailability(fields = {}) {
  const explicit = String(fields['Meeting Availability'] || fields['Calendar Availability'] || '').trim()
  if (explicit) return explicit
  return extractMultilineNoteValue(fields.Notes, 'Meeting Availability')
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (!AIRTABLE_TOKEN) {
    return res.status(503).json({ error: 'Data API token is not configured on the server.' })
  }

  if (req.method === 'GET') {
    try {
      const adminUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(ADMIN_PROFILE_TABLE)}`
      const [adminData, schedulingRows, maRecords] = await Promise.all([
        fetchAirtableJson(adminUrl),
        listSchedulingRows(),
        listAllAdminMeetingAvailabilityRecords(),
      ])
      if (!adminData) return res.status(200).json({ admins: [] })
      const bookings = buildMeetingBookingsByAdmin(schedulingRows)
      const availabilityByAdminDate = buildMeetingAvailabilityByAdminDate(schedulingRows)
      const maCfg = buildAdminMeetingAvailabilityConfig(process.env)
      const admins = (adminData.records || [])
        .filter(enabledAdminProfile)
        .map((row) => {
          const fields = row.fields || {}
          const email = String(fields.Email || '').trim().toLowerCase()
          if (!email.includes('@')) return null
          const schedulingExplicit = availabilityByAdminDate[email] || {}
          const legacyText = adminMeetingAvailability(fields)
          const maByDate = buildGlobalAdminSlotsByDate({
            records: maRecords,
            config: maCfg,
            adminEmail: email,
            legacyWeeklyText: legacyText,
            bookedSlotsByDate: bookings[email] || {},
            daysAhead: 56,
          })
          const mergedSlots = {}
          const keys = new Set([...Object.keys(schedulingExplicit), ...Object.keys(maByDate)])
          for (const dk of keys) {
            const sch = schedulingExplicit[dk]
            if (Array.isArray(sch) && sch.length) mergedSlots[dk] = sch
            else if (maByDate[dk]?.length) mergedSlots[dk] = maByDate[dk]
          }
          const availability = adminMeetingAvailability(fields)
          return {
            id: row.id,
            name: String(fields.Name || email).trim(),
            email,
            availability,
            availableSlotsByDate: mergedSlots,
            /** Raw Scheduling “Meeting Availability” rows only (calendar tab); merged view is `availableSlotsByDate`. */
            schedulingAvailabilityByDate: schedulingExplicit,
            bookedSlotsByDate: bookings[email] || {},
          }
        })
        .filter(Boolean)
      return res.status(200).json({ admins })
    } catch {
      return res.status(200).json({ admins: [] })
    }
  }

  if (req.method === 'POST') {
    const {
      name,
      email,
      phone,
      notes,
      adminEmail,
      adminName,
      preferredDate,
      preferredTime,
    } = req.body || {}

    const requesterName = String(name || '').trim()
    const requesterEmail = String(email || '').trim().toLowerCase()
    const selectedAdminEmail = String(adminEmail || '').trim().toLowerCase()
    const selectedAdminName = String(adminName || '').trim()
    const preferredDateKey = normalizeDateKey(preferredDate)
    const preferredTimeLabel = normalizeRangeLabel(preferredTime)
    const preferredRange = parseTimeRangeToMinutes(preferredTimeLabel)

    if (!requesterName || !requesterEmail || !selectedAdminEmail || !preferredDateKey || !preferredTimeLabel) {
      return res.status(400).json({ error: 'Name, email, admin, date, and time are required.' })
    }
    if (!preferredRange) {
      return res.status(400).json({ error: 'Invalid meeting time range.' })
    }

    const adminFormula = encodeURIComponent(`LOWER({Email} & "") = "${selectedAdminEmail.replace(/"/g, '\\"')}"`)
    const adminUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(ADMIN_PROFILE_TABLE)}?filterByFormula=${adminFormula}&maxRecords=1`
    const adminData = await fetchAirtableJson(adminUrl)
    const adminRecord = adminData?.records?.[0]
    if (!adminRecord || !enabledAdminProfile(adminRecord)) {
      return res.status(409).json({ error: 'Selected admin is not available for meetings.' })
    }

    const sameDayFormula = encodeURIComponent(
      `AND({Preferred Date} = "${preferredDateKey}", LOWER({Manager Email} & "") = "${selectedAdminEmail.replace(/"/g, '\\"')}")`,
    )
    const sameDayRows = await listSchedulingRows(sameDayFormula)
    const availabilityByDate = buildMeetingAvailabilityByAdminDate(sameDayRows)
    const explicitSlots = availabilityByDate[selectedAdminEmail]?.[preferredDateKey] || []
    const meetingBookedLabels = []
    for (const record of sameDayRows) {
      const f = record?.fields || {}
      if (String(f.Type || '').trim().toLowerCase() !== 'meeting') continue
      if (!statusAllowsConflict(f.Status)) continue
      const lab = normalizeRangeLabel(f['Preferred Time'])
      if (lab) meetingBookedLabels.push(lab)
    }
    const maCfg = buildAdminMeetingAvailabilityConfig(process.env)
    const maRows = await listAllAdminMeetingAvailabilityRecords()
    const mergedFree = mergeGlobalAdminAvailabilityRanges({
      records: maRows,
      fieldsConfig: maCfg.fields,
      dateKey: preferredDateKey,
      adminEmail: selectedAdminEmail,
      legacyWeeklyText: adminMeetingAvailability(adminRecord.fields || {}),
      bookedSlotLabels: meetingBookedLabels,
    })
    const maSlots = rangesToSlotLabels(mergedFree)
    const fallbackAvailability = adminMeetingAvailability(adminRecord.fields || {})
    const legacyOnly = availabilitySlotsForDate(fallbackAvailability, preferredDateKey)
    const availableSlots = explicitSlots.length
      ? explicitSlots
      : maSlots.length
        ? maSlots
        : legacyOnly
    const allowedSet = new Set(availableSlots.map((slot) => slot.toLowerCase()))
    if (!allowedSet.has(preferredTimeLabel.toLowerCase())) {
      return res.status(409).json({ error: 'That meeting slot is no longer available.' })
    }

    for (const record of sameDayRows) {
      const fields = record?.fields || {}
      if (String(fields.Type || '').trim().toLowerCase() !== 'meeting') continue
      if (!statusAllowsConflict(fields.Status)) continue
      const rowRange = parseTimeRangeToMinutes(fields['Preferred Time'])
      if (!rowRange) continue
      if (rangesOverlap(preferredRange, rowRange)) {
        return res.status(409).json({ error: 'This meeting time has already been booked. Please choose another slot.' })
      }
    }

    const fields = {
      Name: requesterName,
      Email: requesterEmail,
      Type: 'Meeting',
      Status: 'New',
      'Preferred Date': preferredDateKey,
      'Preferred Time': preferredTimeLabel,
      'Scheduled Date': preferredDateKey,
      'Scheduled Time': preferredTimeLabel,
      'Manager Email': selectedAdminEmail,
      'Tour Manager': selectedAdminName || String(adminRecord.fields?.Name || selectedAdminEmail),
    }
    if (phone) fields.Phone = String(phone).trim()
    const schedulingNotesField =
      String(
        process.env.AIRTABLE_SCHEDULING_NOTES_FIELD ||
          process.env.VITE_AIRTABLE_SCHEDULING_NOTES_FIELD ||
          'Message',
      ).trim() || 'Message'
    if (notes) {
      const nt = String(notes).trim()
      if (nt) fields[schedulingNotesField] = nt
    }

    try {
      const created = await airtableCreateWithUnknownFieldRetry({
        baseId: AIRTABLE_BASE_ID,
        token: AIRTABLE_TOKEN,
        tableName: SCHEDULING_TABLE,
        fields,
      })
      return res.status(200).json({ id: created.id })
    } catch (err) {
      const msg = err?.message || 'Could not save meeting booking.'
      return res.status(502).json({ error: msg })
    }
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

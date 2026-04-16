/**
 * Validates internal (Postgres) tour bookings against manager_availability + legacy notes text.
 * Reuses shared merge helpers (same as public tour GET / POST validation).
 *
 * @module
 */

import {
  buildManagerAvailabilityConfig,
  mergePropertyAvailabilityRanges,
  rangesToThirtyMinuteSlotLabels,
} from '../../../shared/manager-availability-merge.js'
import { requireServiceClient } from './app-users-service.js'
import { listManagerAvailabilityByPropertyId } from './manager-availability-service.js'
import { mapDbManagerAvailabilityRowsToVirtualMaRecords } from './manager-availability-virtual-map.js'
import {
  listBookedTourSlotLabelsForPropertyDate,
  hasOverlappingPropertyBooking,
} from './scheduled-events-service.js'

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

/** Same as tour.js `postgresTourAvailabilityText` — legacy weekly tokens from Notes. */
function postgresTourAvailabilityText(notesText) {
  const n = String(notesText || '')
  return propertyTourAvailabilityFromFields({
    Notes: n,
    'Other Info': n,
    'Tour Availability': '',
    'Calendar Availability': '',
  })
}

function propertyTourAvailabilityFromFields(fields) {
  const f = fields || {}
  const explicit = String(f['Tour Availability'] || f['Calendar Availability'] || '').trim()
  const fromNotes = extractMultilineNoteValue(f.Notes, 'Tour Availability') || ''
  return explicit || fromNotes
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

/** Calendar date + wall-clock minutes → UTC ISO (civil date interpreted in UTC; consistent with slot picker). */
function utcRangeFromDateAndMinutes(dateKey, startMin, endMin) {
  const [y, m, d] = String(dateKey || '')
    .trim()
    .slice(0, 10)
    .split('-')
    .map(Number)
  if (!y || !m || !d) return null
  const dayStart = Date.UTC(y, m - 1, d, 0, 0, 0, 0)
  const startMs = dayStart + Math.max(0, startMin) * 60_000
  const endMs = dayStart + Math.max(0, endMin) * 60_000
  return { startIso: new Date(startMs).toISOString(), endIso: new Date(endMs).toISOString() }
}

/**
 * @param {object} pRow — properties row
 * @param {string} preferredDateKey
 * @param {string} preferredTimeLabel
 * @returns {Promise<void>}
 */
export async function assertInternalTourSlotAllowed({ propertyId, preferredDateKey, preferredTimeLabel }) {
  const pid = String(propertyId || '').trim()
  const dk = String(preferredDateKey || '').trim().slice(0, 10)
  const label = normalizeRangeLabel(preferredTimeLabel)
  if (!/^[0-9a-f-]{36}$/i.test(pid)) throw new Error('Invalid property.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) throw new Error('Invalid date.')
  if (!label) throw new Error('Invalid time.')

  const client = requireServiceClient()
  const { data: pRow, error: pe } = await client.from('properties').select('*').eq('id', pid).maybeSingle()
  if (pe || !pRow || !pRow.active) {
    const err = new Error('This property is not available for tours right now.')
    /** @type {any} */ (err).statusCode = 409
    throw err
  }

  const mgrId = pRow.managed_by_app_user_id
  let mgrEm = ''
  if (mgrId) {
    const { data: u } = await client.from('app_users').select('email').eq('id', mgrId).maybeSingle()
    mgrEm = String(u?.email || '').trim().toLowerCase()
  }
  const propName = String(pRow.name || '').trim()
  const legacyText = postgresTourAvailabilityText(pRow.notes)
  const dbMa = await listManagerAvailabilityByPropertyId(pid)
  const virtualMa = mapDbManagerAvailabilityRowsToVirtualMaRecords(dbMa, {
    propertyName: propName,
    propertyRecordId: pid,
    managerEmail: mgrEm,
    managerRecordId: '',
  })

  const internalBooked = await listBookedTourSlotLabelsForPropertyDate(pid, dk)
  const maCfg = buildManagerAvailabilityConfig(process.env)
  const mergedRanges = mergePropertyAvailabilityRanges({
    records: virtualMa.map((r) => ({ fields: r })),
    fieldsConfig: maCfg.fields,
    dateKey: dk,
    propertyName: propName,
    propertyRecordId: pid,
    managerEmail: mgrEm,
    managerRecordId: '',
    legacyAvailabilityText: legacyText,
    bookedSlotLabels: internalBooked,
  })
  const mergedLabels = rangesToThirtyMinuteSlotLabels(mergedRanges)
  const allowedSet = new Set(mergedLabels.map((s) => String(s || '').trim().toLowerCase()))
  if (!allowedSet.has(label.toLowerCase())) {
    const err = new Error('That tour slot is no longer available. Please choose another time.')
    /** @type {any} */ (err).statusCode = 409
    throw err
  }

  const range = parseTimeRangeToMinutes(label)
  if (!range) {
    const err = new Error('Invalid tour time.')
    /** @type {any} */ (err).statusCode = 400
    throw err
  }
  const times = utcRangeFromDateAndMinutes(dk, range.start, range.end)
  if (!times) {
    const err = new Error('Invalid tour time.')
    /** @type {any} */ (err).statusCode = 400
    throw err
  }
  const overlap = await hasOverlappingPropertyBooking(pid, times.startIso, times.endIso)
  if (overlap) {
    const err = new Error('This tour slot has already been booked. Please choose another time.')
    /** @type {any} */ (err).statusCode = 409
    throw err
  }

  return {
    propertyRow: pRow,
    propertyName: propName,
    managerEmail: mgrEm,
    managerAppUserId: mgrId || null,
    normalizedTimeLabel: label,
    startIso: times.startIso,
    endIso: times.endIso,
    timezone: String((dbMa[0] && dbMa[0].timezone) || 'UTC').trim() || 'UTC',
  }
}

export { parseTimeRangeToMinutes, normalizeRangeLabel, utcRangeFromDateAndMinutes }

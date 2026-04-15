/**
 * Manager / Admin availability — shared merge rules for tours & meetings.
 * Used by backend (tour/meeting handlers) and frontend (Manager calendar, optional tooling).
 *
 * **Split tables (recommended):** set `ADMIN_MEETING_AVAILABILITY_TABLE` (or `VITE_…`) to a table
 * name different from the manager tour table (`MANAGER_AVAILABILITY_TABLE` / defaults). Admin
 * “Contact Axis” meeting slots then read/write only the admin table; property tour slots use only
 * the manager table. When unset, both flows share one table (legacy: global rows use empty Property).
 *
 * Optional **`AIRTABLE_AVAILABILITY_BASE_ID`**: if set, both availability tables are read from this
 * base while `Scheduling` and `Properties` stay on the main base.
 *
 * Precedence for a given calendar date:
 * 1) Date-specific (Is Recurring false) active rows for that exact date
 * 2) Else recurring weekly rows (Is Recurring true) for that weekday with optional Recurrence Start
 * 3) Else legacy weekly text (Mon: 540-720, …) from property/admin profile — **only if there are no
 *    active Manager Availability rows at all** for that property+manager (otherwise legacy is ignored
 *    so one-off MA edits are not masked by the old property template).
 */

export const DEFAULT_MA_FIELD_NAMES = {
  propertyName: 'Property Name',
  propertyRecordId: 'Property Record ID',
  managerEmail: 'Manager Email',
  managerRecordId: 'Manager Record ID',
  date: 'Date',
  weekday: 'Weekday',
  startTime: 'Start Time',
  endTime: 'End Time',
  isRecurring: 'Is Recurring',
  active: 'Active',
  timezone: 'Timezone',
  source: 'Source',
  recurrenceStart: 'Recurrence Start',
}

const DOW_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Airtable base id for Manager + Admin availability tables only (optional). */
export function availabilityAirtableBaseId(env = {}) {
  const pick = (a, b, c) => String(env[a] ?? env[b] ?? env[c] ?? '').trim()
  return (
    pick('AIRTABLE_AVAILABILITY_BASE_ID', 'VITE_AIRTABLE_AVAILABILITY_BASE_ID', '') ||
    pick('VITE_AIRTABLE_BASE_ID', 'AIRTABLE_BASE_ID', '') ||
    ''
  )
}

/** @param {Record<string, string>} env */
export function buildManagerAvailabilityConfig(env = {}) {
  const pick = (a, b, d) => String(env[a] ?? env[b] ?? '').trim() || d
  return {
    tableName: pick(
      'AIRTABLE_MANAGER_AVAILABILITY_TABLE',
      'VITE_AIRTABLE_MANAGER_AVAILABILITY_TABLE',
      pick('MANAGER_AVAILABILITY_TABLE', 'VITE_MANAGER_AVAILABILITY_TABLE', 'Manager Availability'),
    ),
    fields: {
      propertyName: pick('MANAGER_AVAIL_FIELD_PROPERTY_NAME', 'VITE_MANAGER_AVAIL_FIELD_PROPERTY_NAME', DEFAULT_MA_FIELD_NAMES.propertyName),
      propertyRecordId: pick(
        'MANAGER_AVAIL_FIELD_PROPERTY_RECORD_ID',
        'VITE_MANAGER_AVAIL_FIELD_PROPERTY_RECORD_ID',
        DEFAULT_MA_FIELD_NAMES.propertyRecordId,
      ),
      managerEmail: pick('MANAGER_AVAIL_FIELD_MANAGER_EMAIL', 'VITE_MANAGER_AVAIL_FIELD_MANAGER_EMAIL', DEFAULT_MA_FIELD_NAMES.managerEmail),
      managerRecordId: pick(
        'MANAGER_AVAIL_FIELD_MANAGER_RECORD_ID',
        'VITE_MANAGER_AVAIL_FIELD_MANAGER_RECORD_ID',
        DEFAULT_MA_FIELD_NAMES.managerRecordId,
      ),
      date: pick('MANAGER_AVAIL_FIELD_DATE', 'VITE_MANAGER_AVAIL_FIELD_DATE', DEFAULT_MA_FIELD_NAMES.date),
      weekday: pick('MANAGER_AVAIL_FIELD_WEEKDAY', 'VITE_MANAGER_AVAIL_FIELD_WEEKDAY', DEFAULT_MA_FIELD_NAMES.weekday),
      startTime: pick('MANAGER_AVAIL_FIELD_START_TIME', 'VITE_MANAGER_AVAIL_FIELD_START_TIME', DEFAULT_MA_FIELD_NAMES.startTime),
      endTime: pick('MANAGER_AVAIL_FIELD_END_TIME', 'VITE_MANAGER_AVAIL_FIELD_END_TIME', DEFAULT_MA_FIELD_NAMES.endTime),
      isRecurring: pick('MANAGER_AVAIL_FIELD_IS_RECURRING', 'VITE_MANAGER_AVAIL_FIELD_IS_RECURRING', DEFAULT_MA_FIELD_NAMES.isRecurring),
      active: pick('MANAGER_AVAIL_FIELD_ACTIVE', 'VITE_MANAGER_AVAIL_FIELD_ACTIVE', DEFAULT_MA_FIELD_NAMES.active),
      timezone: pick('MANAGER_AVAIL_FIELD_TIMEZONE', 'VITE_MANAGER_AVAIL_FIELD_TIMEZONE', DEFAULT_MA_FIELD_NAMES.timezone),
      source: pick('MANAGER_AVAIL_FIELD_SOURCE', 'VITE_MANAGER_AVAIL_FIELD_SOURCE', DEFAULT_MA_FIELD_NAMES.source),
      recurrenceStart: pick(
        'MANAGER_AVAIL_FIELD_RECURRENCE_START',
        'VITE_MANAGER_AVAIL_FIELD_RECURRENCE_START',
        DEFAULT_MA_FIELD_NAMES.recurrenceStart,
      ),
    },
  }
}

/**
 * Admin-only meeting availability table (global rows: empty Property Name / Property Record ID).
 * Same field schema as manager tour availability. If env table name is empty, uses the manager
 * table name (single-table legacy mode).
 */
export function buildAdminMeetingAvailabilityConfig(env = {}) {
  const mgr = buildManagerAvailabilityConfig(env)
  const pick = (a, b, d) => String(env[a] ?? env[b] ?? '').trim() || d
  const adminTable = pick(
    'AIRTABLE_ADMIN_MEETING_AVAILABILITY_TABLE',
    'VITE_AIRTABLE_ADMIN_MEETING_AVAILABILITY_TABLE',
    '',
  )
  return {
    ...mgr,
    tableName: adminTable || mgr.tableName,
  }
}

/** True when admin meeting rows live in a different Airtable table than manager tour rows. */
export function availabilityTablesAreSplit(env = {}) {
  const a = String(buildManagerAvailabilityConfig(env).tableName || '').trim()
  const b = String(buildAdminMeetingAvailabilityConfig(env).tableName || '').trim()
  return Boolean(a && b && a !== b)
}

/**
 * Normalize Airtable cell values for Manager Availability fields.
 * Linked-record columns return string[]; we use the first id for comparisons and parsing.
 */
export function airtableFieldScalar(value) {
  if (value == null) return ''
  if (Array.isArray(value)) {
    for (const x of value) {
      if (x != null && String(x).trim()) return String(x).trim()
    }
    return ''
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return String(value).trim()
}

export function normalizeDateKey(value) {
  const s = airtableFieldScalar(value)
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : ''
}

function isActiveRecord(fields, activeField) {
  const v = fields[activeField]
  if (v === false || v === 0 || String(v).toLowerCase() === 'false' || String(v).toLowerCase() === 'no') return false
  return true
}

function parseClockToMinutes(value) {
  const m = String(value || '').trim().toUpperCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/)
  if (!m) return null
  let hour = Number(m[1]) % 12
  const minute = Number(m[2] || '0')
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null
  if (m[3] === 'PM') hour += 12
  return hour * 60 + minute
}

/** Accepts "HH:mm", "HH:mm:ss", "H:mm", "9:30 AM" */
export function parseTimeToMinutes(raw) {
  const s = String(raw || '').trim()
  if (!s) return null
  const hm = s.match(/^(\d{1,2}):(\d{2})$/)
  if (hm) {
    const hh = Number(hm[1])
    const mm = Number(hm[2])
    if (Number.isFinite(hh) && Number.isFinite(mm) && hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) return hh * 60 + mm
  }
  const hms = s.match(/^(\d{1,2}):(\d{2}):(\d{2})$/)
  if (hms) {
    const hh = Number(hms[1])
    const mm = Number(hms[2])
    if (Number.isFinite(hh) && Number.isFinite(mm) && hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) return hh * 60 + mm
  }
  return parseClockToMinutes(s)
}

export function displayTimeFromMinutes(minutes) {
  const hrs24 = Math.floor(minutes / 60)
  const mins = Math.max(0, minutes % 60)
  let hrs12 = hrs24 % 12
  if (hrs12 === 0) hrs12 = 12
  const ampm = hrs24 >= 12 ? 'PM' : 'AM'
  return `${hrs12}:${String(mins).padStart(2, '0')} ${ampm}`
}

export function slotLabelFromRange(startMin, endMin) {
  return `${displayTimeFromMinutes(startMin)} - ${displayTimeFromMinutes(endMin)}`
}

function dayAbbrForDateKey(dateKey) {
  const d = new Date(`${dateKey}T12:00:00`)
  if (Number.isNaN(d.getTime())) return ''
  return DOW_ABBR[d.getDay()] || ''
}

/** Normalize weekday field to Mon/Tue/… */
export function normalizeWeekdayAbbr(raw) {
  const s = airtableFieldScalar(raw)
  if (!s) return ''
  const lower = s.toLowerCase()
  const full = DOW_FULL.find((x) => x.toLowerCase() === lower)
  if (full) {
    const idx = DOW_FULL.indexOf(full)
    return DOW_ABBR[idx] || ''
  }
  const ab = DOW_ABBR.find((x) => x.toLowerCase() === lower)
  if (ab) return ab
  const n = Number(s)
  if (Number.isFinite(n) && n >= 0 && n <= 6) return DOW_ABBR[n]
  return ''
}

function normalizeRangeLabelLoose(value) {
  const parts = String(value || '')
    .split(/\s*[\-–—]\s*/)
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length !== 2) return ''
  const a = parseTimeToMinutes(parts[0]) ?? parseClockToMinutes(parts[0].toUpperCase())
  const b = parseTimeToMinutes(parts[1]) ?? parseClockToMinutes(parts[1].toUpperCase())
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return ''
  return slotLabelFromRange(a, b)
}

/**
 * @param {string} rawAvailability legacy "Mon: 540-720, …" text
 * @param {string} dateKey YYYY-MM-DD
 * @returns {{ start: number, end: number }[]}
 */
export function legacyFreeRangesForDate(rawAvailability, dateKey) {
  const day = dayAbbrForDateKey(dateKey)
  if (!day) return []
  const map = {}
  String(rawAvailability || '')
    .split(/\n|;/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const m = line.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s*[:\-]\s*(.+)$/i)
      if (!m) return
      const d = m[1].slice(0, 1).toUpperCase() + m[1].slice(1, 3).toLowerCase()
      map[d] = m[2]
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
    })
  const tokens = map[day] || []
  const ranges = []
  for (const token of tokens) {
    const pair = String(token).match(/^(\d+)-(\d+)$/)
    if (pair) {
      const start = Number(pair[1])
      const end = Number(pair[2])
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
        ranges.push({ start, end })
      }
      continue
    }
    const label = normalizeRangeLabelLoose(token)
    if (!label) continue
    const p2 = label.split(/\s*-\s*/)
    if (p2.length === 2) {
      const s = parseTimeToMinutes(p2[0]) ?? parseClockToMinutes(p2[0].toUpperCase())
      const e = parseTimeToMinutes(p2[1]) ?? parseClockToMinutes(p2[1].toUpperCase())
      if (Number.isFinite(s) && Number.isFinite(e) && e > s) ranges.push({ start: s, end: e })
    }
  }
  return normalizeMergedRanges(ranges)
}

function recordMatchesProperty(fields, f, propertyNameNorm, propertyRecordId) {
  const pname = String(fields[f.propertyName] || '').trim().toLowerCase()
  const prec = airtableFieldScalar(fields[f.propertyRecordId])
  if (propertyRecordId && prec && prec === String(propertyRecordId).trim()) return true
  if (propertyNameNorm && pname && pname === propertyNameNorm) return true
  return false
}

function recordMatchesManager(fields, f, managerEmailNorm, managerRecordId) {
  if (!managerEmailNorm && !managerRecordId) return true
  const em = String(fields[f.managerEmail] || '').trim().toLowerCase()
  const rid = airtableFieldScalar(fields[f.managerRecordId])
  if (managerRecordId && rid && rid === String(managerRecordId).trim()) return true
  if (managerEmailNorm && em && em === managerEmailNorm) return true
  return false
}

/** Global admin rows: no property set (used for Contact Axis software meetings). */
export function recordIsGlobalAdminRow(fields, f) {
  const pname = String(fields[f.propertyName] || '').trim()
  const prec = airtableFieldScalar(fields[f.propertyRecordId])
  return !pname && !prec
}

/**
 * Map Airtable row (fields object) to normalized interval or null.
 * @param {Record<string, unknown>} fields
 */
function minutesFromAvailabilityTimeField(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const n = Math.round(raw)
    if (n >= 0 && n < 24 * 60) return n
  }
  return parseTimeToMinutes(airtableFieldScalar(raw))
}

export function intervalFromMaRecord(fields, f) {
  if (!isActiveRecord(fields, f.active)) return null
  const start = minutesFromAvailabilityTimeField(fields[f.startTime])
  const end = minutesFromAvailabilityTimeField(fields[f.endTime])
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  return { start, end }
}

export function normalizeMergedRanges(ranges) {
  const parsed = (ranges || [])
    .filter((r) => r && Number.isFinite(r.start) && Number.isFinite(r.end) && r.end > r.start)
    .sort((a, b) => a.start - b.start)
  const merged = []
  for (const range of parsed) {
    const prev = merged[merged.length - 1]
    if (prev && range.start <= prev.end) prev.end = Math.max(prev.end, range.end)
    else merged.push({ ...range })
  }
  return merged
}

function subtractBlocked(freeRanges, blockedRanges) {
  let out = [...freeRanges]
  for (const b of blockedRanges || []) {
    const next = []
    for (const f of out) {
      if (b.end <= f.start || b.start >= f.end) {
        next.push(f)
        continue
      }
      if (b.start > f.start) next.push({ start: f.start, end: Math.min(b.start, f.end) })
      if (b.end < f.end) next.push({ start: Math.max(b.end, f.start), end: f.end })
    }
    out = normalizeMergedRanges(next.filter((r) => r.end > r.start))
  }
  return out
}

function parseBookedSlotToRange(label) {
  const n = normalizeRangeLabelLoose(label)
  if (!n) return null
  const p2 = n.split(/\s*-\s*/)
  if (p2.length !== 2) return null
  const s = parseTimeToMinutes(p2[0]) ?? parseClockToMinutes(p2[0].toUpperCase())
  const e = parseTimeToMinutes(p2[1]) ?? parseClockToMinutes(p2[1].toUpperCase())
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return null
  return { start: s, end: e }
}

/**
 * Free minute ranges for one property + date from Manager Availability rows + legacy text.
 */
export function mergePropertyAvailabilityRanges({
  records,
  fieldsConfig,
  dateKey,
  propertyName,
  propertyRecordId,
  managerEmail,
  managerRecordId,
  legacyAvailabilityText,
  bookedSlotLabels = [],
}) {
  const f = fieldsConfig
  const propNorm = String(propertyName || '').trim().toLowerCase()
  const mgrNorm = String(managerEmail || '').trim().toLowerCase()
  const dayAbbr = dayAbbrForDateKey(dateKey)

  const scoped = (records || []).filter((row) => {
    const fields = row.fields || row
    if (!recordMatchesProperty(fields, f, propNorm, propertyRecordId)) return false
    if (mgrNorm || managerRecordId) return recordMatchesManager(fields, f, mgrNorm, managerRecordId)
    return true
  })

  const dateSpecific = []
  const recurring = []
  for (const row of scoped) {
    const fields = row.fields || row
    const interval = intervalFromMaRecord(fields, f)
    if (!interval) continue
    const isRec =
      fields[f.isRecurring] === true ||
      fields[f.isRecurring] === 1 ||
      String(fields[f.isRecurring] || '').toLowerCase() === 'true' ||
      String(fields[f.isRecurring] || '').toLowerCase() === 'yes'
    const dk = normalizeDateKey(fields[f.date])
    if (!isRec && dk === dateKey) {
      dateSpecific.push(interval)
      continue
    }
    if (isRec) {
      const wk = normalizeWeekdayAbbr(fields[f.weekday])
      if (wk && wk === dayAbbr) {
        const rs = normalizeDateKey(fields[f.recurrenceStart])
        if (rs && dateKey < rs) continue
        recurring.push(interval)
      }
    }
  }

  /** If this property/manager has any active MA rows, do not fall back to legacy property weekly text (it repeats every week and masks date-only edits). */
  const scopedUsesManagerAvailability = scoped.some((row) => {
    const fields = row.fields || row
    return isActiveRecord(fields, f.active)
  })

  let base = []
  if (dateSpecific.length) {
    base = normalizeMergedRanges(dateSpecific)
  } else if (recurring.length) {
    base = normalizeMergedRanges(recurring)
  } else if (!scopedUsesManagerAvailability) {
    base = legacyFreeRangesForDate(legacyAvailabilityText || '', dateKey)
  } else {
    base = []
  }

  const blocked = (bookedSlotLabels || []).map(parseBookedSlotToRange).filter(Boolean)
  return subtractBlocked(base, blocked)
}

/**
 * Same as mergePropertyAvailabilityRanges but only rows tied to an admin email with no property (global).
 */
export function mergeGlobalAdminAvailabilityRanges({
  records,
  fieldsConfig,
  dateKey,
  adminEmail,
  legacyWeeklyText,
  bookedSlotLabels = [],
}) {
  const f = fieldsConfig
  const emNorm = String(adminEmail || '').trim().toLowerCase()
  const dayAbbr = dayAbbrForDateKey(dateKey)
  const scoped = (records || []).filter((row) => {
    const fields = row.fields || row
    if (!recordIsGlobalAdminRow(fields, f)) return false
    const rowEm = String(fields[f.managerEmail] || '').trim().toLowerCase()
    return emNorm && rowEm === emNorm
  })

  const dateSpecific = []
  const recurring = []
  for (const row of scoped) {
    const fields = row.fields || row
    const interval = intervalFromMaRecord(fields, f)
    if (!interval) continue
    const isRec =
      fields[f.isRecurring] === true ||
      fields[f.isRecurring] === 1 ||
      String(fields[f.isRecurring] || '').toLowerCase() === 'true' ||
      String(fields[f.isRecurring] || '').toLowerCase() === 'yes'
    const dk = normalizeDateKey(fields[f.date])
    if (!isRec && dk === dateKey) {
      dateSpecific.push(interval)
    } else if (isRec) {
      const wk = normalizeWeekdayAbbr(fields[f.weekday])
      if (wk && wk === dayAbbr) {
        const rs = normalizeDateKey(fields[f.recurrenceStart])
        if (rs && dateKey < rs) continue
        recurring.push(interval)
      }
    }
  }

  const scopedUsesGlobalMa = scoped.some((row) => {
    const fields = row.fields || row
    return isActiveRecord(fields, f.active)
  })

  let base = []
  if (dateSpecific.length) {
    base = normalizeMergedRanges(dateSpecific)
  } else if (recurring.length) {
    base = normalizeMergedRanges(recurring)
  } else if (!scopedUsesGlobalMa) {
    base = legacyFreeRangesForDate(legacyWeeklyText || '', dateKey)
  } else {
    base = []
  }

  const blocked = (bookedSlotLabels || []).map(parseBookedSlotToRange).filter(Boolean)
  return subtractBlocked(base, blocked)
}

export function rangesToSlotLabels(ranges) {
  return normalizeMergedRanges(ranges).map((r) => slotLabelFromRange(r.start, r.end))
}

const SLOT_STEP_MIN = 30

/**
 * Expand free ranges into selectable tour slots (e.g. 1:00–4:00 PM → 1:00–1:30, 1:30–2:00, …).
 * Labels are start–end for the sub-slot so booking + conflict checks stay range-based.
 */
export function rangesToThirtyMinuteSlotLabels(ranges) {
  const merged = normalizeMergedRanges(ranges)
  const out = []
  for (const r of merged) {
    let t = r.start
    while (t + SLOT_STEP_MIN <= r.end) {
      out.push(slotLabelFromRange(t, t + SLOT_STEP_MIN))
      t += SLOT_STEP_MIN
    }
  }
  return out
}

/**
 * Build map dateKey -> slot labels for the next `daysAhead` days.
 */
export function buildPropertySlotsByDate({
  records,
  config,
  propertyName,
  propertyRecordId,
  managerEmail,
  managerRecordId,
  legacyAvailabilityText,
  bookedSlotsByDate,
  daysAhead = 56,
}) {
  const f = config.fields
  const out = {}
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  for (let i = 0; i < daysAhead; i += 1) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const dateKey = `${y}-${m}-${day}`
    const booked = bookedSlotsByDate?.[dateKey] || []
    const ranges = mergePropertyAvailabilityRanges({
      records,
      fieldsConfig: f,
      dateKey,
      propertyName,
      propertyRecordId,
      managerEmail,
      managerRecordId,
      legacyAvailabilityText,
      bookedSlotLabels: booked,
    })
    const labels = rangesToThirtyMinuteSlotLabels(ranges)
    if (labels.length) out[dateKey] = labels
  }
  return out
}

export function buildGlobalAdminSlotsByDate({
  records,
  config,
  adminEmail,
  legacyWeeklyText,
  bookedSlotsByDate,
  daysAhead = 56,
}) {
  const f = config.fields
  const out = {}
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  for (let i = 0; i < daysAhead; i += 1) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const dateKey = `${y}-${m}-${day}`
    const booked = bookedSlotsByDate?.[dateKey] || []
    const ranges = mergeGlobalAdminAvailabilityRanges({
      records,
      fieldsConfig: f,
      dateKey,
      adminEmail,
      legacyWeeklyText,
      bookedSlotLabels: booked,
    })
    const labels = rangesToSlotLabels(ranges)
    if (labels.length) out[dateKey] = labels
  }
  return out
}

/**
 * Map dateKey → merged free minute ranges for one admin (global rows only).
 * Used by the admin portal calendar when availability lives in `Admin Meeting Availability`.
 */
export function buildGlobalAdminFreeRangesMapByDate({
  records,
  config,
  adminEmail,
  daysAhead = 120,
  fromDate,
}) {
  const f = config.fields
  const em = String(adminEmail || '').trim().toLowerCase()
  const normalized = (records || []).map((r) => {
    if (r && r.fields) return r
    return { fields: r || {} }
  })
  const scoped = normalized.filter((row) => {
    const fields = row.fields || {}
    if (!recordIsGlobalAdminRow(fields, f)) return false
    return String(fields[f.managerEmail] || '').trim().toLowerCase() === em
  })
  const out = {}
  const today = fromDate ? new Date(fromDate) : new Date()
  today.setHours(0, 0, 0, 0)
  for (let i = 0; i < daysAhead; i += 1) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const dateKey = `${y}-${m}-${day}`
    const ranges = mergeGlobalAdminAvailabilityRanges({
      records: scoped,
      fieldsConfig: f,
      dateKey,
      adminEmail: em,
      legacyWeeklyText: '',
      bookedSlotLabels: [],
    })
    if (ranges.length) out[dateKey] = ranges
  }
  return out
}

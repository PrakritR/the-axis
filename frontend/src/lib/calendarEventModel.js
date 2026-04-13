export const CALENDAR_EVENT_TYPES = {
  TOUR: 'tour',
  WORK_ORDER: 'work_order',
  MEETING: 'meeting',
  ISSUE: 'issue',
  OTHER: 'other',
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

function parseRangeLabel(value) {
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

export function normalizeEventType(rawType) {
  const type = String(rawType || '').trim().toLowerCase()
  if (type === 'tour') return CALENDAR_EVENT_TYPES.TOUR
  if (type === 'meeting') return CALENDAR_EVENT_TYPES.MEETING
  if (type === 'work order' || type === 'work-order' || type === 'work_order') return CALENDAR_EVENT_TYPES.WORK_ORDER
  if (type === 'issue' || type === 'other') return CALENDAR_EVENT_TYPES.ISSUE
  return CALENDAR_EVENT_TYPES.OTHER
}

export function buildCalendarEvent(input = {}) {
  return {
    eventType: normalizeEventType(input.eventType),
    startTime: String(input.startTime || '').trim(),
    endTime: String(input.endTime || '').trim(),
    propertyId: String(input.propertyId || '').trim() || null,
    managerId: String(input.managerId || '').trim() || null,
    adminId: String(input.adminId || '').trim() || null,
    relatedRecordId: String(input.relatedRecordId || '').trim() || null,
    status: String(input.status || '').trim() || 'New',
    dateKey: String(input.dateKey || '').trim(),
    title: String(input.title || '').trim(),
    source: input.source || null,
  }
}

export function eventFromSchedulingRow(row) {
  const dateKey = String(row?.['Preferred Date'] || '').trim().slice(0, 10)
  const range = parseRangeLabel(row?.['Preferred Time'])
  return buildCalendarEvent({
    eventType: row?.Type,
    startTime: range ? row['Preferred Time'] : '',
    endTime: range ? row['Preferred Time'] : '',
    propertyId: row?.Property,
    managerId: row?.['Manager Email'],
    adminId: normalizeEventType(row?.Type) === CALENDAR_EVENT_TYPES.MEETING ? row?.['Manager Email'] : null,
    relatedRecordId: row?.id,
    status: row?.Status,
    dateKey,
    title: String(row?.Name || row?.Type || 'Event').trim(),
    source: row,
  })
}

export function eventRangesOverlap(aLabel, bLabel) {
  const a = parseRangeLabel(aLabel)
  const b = parseRangeLabel(bLabel)
  if (!a || !b) return false
  return a.start < b.end && b.start < a.end
}

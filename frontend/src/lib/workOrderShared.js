/**
 * Shared work order helpers — manager + resident portals + calendar.
 */

export function parseWorkOrderMetaBlock(value = '') {
  const out = {}
  String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .forEach((line) => {
      const [key, ...rest] = line.split(':')
      if (!key || rest.length === 0) return
      out[key.trim().toLowerCase()] = rest.join(':').trim()
    })
  return out
}

export function mergeWorkOrderMetaBlock(baseText = '', meta = {}) {
  const current = parseWorkOrderMetaBlock(baseText)
  Object.entries(meta).forEach(([key, value]) => {
    if (value == null || String(value).trim() === '') delete current[key]
    else current[key] = String(value).trim()
  })
  const otherLines = String(baseText || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^[a-z ]+:/i.test(line))
  const metaLines = Object.entries(current).map(([key, value]) => `${key}: ${value}`)
  return [...otherLines, ...metaLines].join('\n').trim()
}

export function workOrderPlainNotes(value = '') {
  return String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^[a-z ]+:/i.test(line))
    .join('\n')
}

/** Normalize various date strings to YYYY-MM-DD or ''. */
export function normalizeWorkOrderScheduleDateKey(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const iso = raw.match(/(\d{4}-\d{2}-\d{2})/)
  if (iso) return iso[1]
  const us = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)
  if (us) {
    const month = Number(us[1])
    const day = Number(us[2])
    let year = Number(us[3])
    if (year < 100) year += year >= 70 ? 1900 : 2000
    if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(year)) return ''
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toISOString().slice(0, 10)
}

/**
 * Structured schedule for calendar + UI — reads Airtable columns and
 * `Management Notes` lines like `scheduled date: 2026-04-20`.
 */
export function workOrderScheduledMeta(record) {
  const rec = record || {}
  const meta = parseWorkOrderMetaBlock(rec['Management Notes'] || '')

  const parseClockToMinutes = (value) => {
    const m = String(value || '')
      .trim()
      .toUpperCase()
      .match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/)
    if (!m) return null
    let h = Number(m[1]) % 12
    const min = Number(m[2] || '0')
    if (!Number.isFinite(h) || !Number.isFinite(min) || min < 0 || min > 59) return null
    if (m[3] === 'PM') h += 12
    return h * 60 + min
  }

  const formatClock = (minutes) => {
    const total = Number(minutes)
    if (!Number.isFinite(total)) return ''
    const h24 = Math.floor(total / 60)
    const min = total % 60
    let h12 = h24 % 12
    if (h12 === 0) h12 = 12
    const ap = h24 >= 12 ? 'PM' : 'AM'
    return `${h12}:${String(min).padStart(2, '0')} ${ap}`
  }

  const normalizeRange = (value) => {
    const raw = String(value || '').trim()
    if (!raw) return ''
    const pair = raw.match(/^(\d+)-(\d+)$/)
    if (pair) {
      const start = Number(pair[1])
      const end = Number(pair[2])
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
        return `${formatClock(start)} - ${formatClock(end)}`
      }
    }
    const joined = raw.replace(/\s+to\s+/i, ' - ')
    const parts = joined
      .split(/\s*[-–]\s*/)
      .map((part) => part.trim())
      .filter(Boolean)
    if (parts.length === 2) {
      const start = parseClockToMinutes(parts[0])
      const end = parseClockToMinutes(parts[1])
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
        return `${formatClock(start)} - ${formatClock(end)}`
      }
    }
    const single = parseClockToMinutes(raw)
    if (Number.isFinite(single)) {
      return `${formatClock(single)} - ${formatClock(single + 60)}`
    }
    return ''
  }

  const dateCandidates = [
    rec['Scheduled Date'],
    rec['Schedule Date'],
    rec['Visit Date'],
    rec['Appointment Date'],
    rec['Work Date'],
    rec['Scheduled For'],
    meta['scheduled date'],
    meta.date,
    meta.scheduled,
  ]
  const timeCandidates = [
    rec['Scheduled Time'],
    rec['Schedule Time'],
    rec['Visit Time'],
    rec['Appointment Time'],
    rec['Time Window'],
    rec['Scheduled Window'],
    rec['Scheduled For'],
    meta['scheduled time'],
    meta.window,
    meta.time,
    meta.scheduled,
  ]

  let date = ''
  for (const candidate of dateCandidates) {
    const key = normalizeWorkOrderScheduleDateKey(candidate)
    if (key) {
      date = key
      break
    }
  }

  let preferredTime = ''
  for (const candidate of timeCandidates) {
    const range = normalizeRange(candidate)
    if (range) {
      preferredTime = range
      break
    }
  }

  if (!date) return null
  return { date, preferredTime }
}

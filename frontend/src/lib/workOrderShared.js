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

// ─── Work order photos (Airtable attachments) — manager + resident portals ──

/** Field names tried when uploading a photo on create (keep in sync with `createWorkOrder` in airtable.js). */
export const WORK_ORDER_PHOTO_ATTACHMENT_FIELD_CANDIDATES = [
  'Photo',
  'Photos',
  'Attachments',
  'Images',
  'Image',
  'Pictures',
  'Attachment',
  'Screenshot',
  'Evidence',
  'File',
]

function workOrderPhotoFieldNameOrder() {
  const raw =
    typeof import.meta !== 'undefined'
      ? String(import.meta.env?.VITE_AIRTABLE_WORK_ORDER_PHOTO_FIELDS ?? '').trim()
      : ''
  if (!raw || /^(none|false|0)$/i.test(raw)) return [...WORK_ORDER_PHOTO_ATTACHMENT_FIELD_CANDIDATES]
  const fromEnv = raw.split(',').map((s) => s.trim()).filter(Boolean)
  return [...fromEnv, ...WORK_ORDER_PHOTO_ATTACHMENT_FIELD_CANDIDATES]
}

/** Same order as URL extraction — use for `uploadAttachment` field attempts. */
export function workOrderPhotoAttachmentFieldNamesOrdered() {
  return workOrderPhotoFieldNameOrder()
}

function attachmentRecordToUrl(item) {
  if (typeof item === 'string') {
    const s = item.trim()
    return /^https?:\/\//i.test(s) ? s : ''
  }
  if (!item || typeof item !== 'object') return ''
  if (typeof item.url === 'string') {
    const s = item.url.trim()
    if (/^https?:\/\//i.test(s)) return s
  }
  const thumbs = item.thumbnails
  if (thumbs && typeof thumbs === 'object') {
    for (const k of ['full', 'large', 'small']) {
      const u = thumbs[k]?.url
      if (typeof u === 'string') {
        const t = u.trim()
        if (/^https?:\/\//i.test(t)) return t
      }
    }
  }
  return ''
}

function isAirtableAttachmentLikeObject(item) {
  return Boolean(attachmentRecordToUrl(item))
}

function isLinkedRecordIdArray(value) {
  if (!Array.isArray(value) || value.length === 0) return false
  return value.every((x) => typeof x === 'string' && /^rec[a-zA-Z0-9]{14,}$/.test(x.trim()))
}

function pushAttachmentUrlsFromValue(value, urls, seen) {
  if (value == null) return
  if (Array.isArray(value)) {
    if (isLinkedRecordIdArray(value)) return
    for (const item of value) {
      const url = attachmentRecordToUrl(item)
      if (!url || seen.has(url)) continue
      seen.add(url)
      urls.push(url)
    }
    return
  }
  if (typeof value === 'object' && isAirtableAttachmentLikeObject(value)) {
    const url = attachmentRecordToUrl(value)
    if (url && !seen.has(url)) {
      seen.add(url)
      urls.push(url)
    }
  }
}

/**
 * Public URLs for images attached to a work order row (Airtable attachment fields).
 * Supports multiple field labels, thumbnail-only payloads, optional
 * `VITE_AIRTABLE_WORK_ORDER_PHOTO_FIELDS` (comma-separated exact Airtable names),
 * and falls back to scanning non-reserved keys for attachment-shaped arrays.
 */
export function workOrderPhotoAttachmentUrls(record) {
  if (!record || typeof record !== 'object') return []
  const seen = new Set()
  const urls = []
  const orderedNames = workOrderPhotoFieldNameOrder()
  const usedKeys = new Set()
  for (const key of orderedNames) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue
    usedKeys.add(key)
    pushAttachmentUrlsFromValue(record[key], urls, seen)
  }
  for (const key of Object.keys(record)) {
    if (usedKeys.has(key)) continue
    if (key === 'id' || key === 'created_at') continue
    const value = record[key]
    if (!Array.isArray(value) || value.length === 0) continue
    if (!value.some((item) => isAirtableAttachmentLikeObject(item))) continue
    pushAttachmentUrlsFromValue(value, urls, seen)
  }
  return urls
}

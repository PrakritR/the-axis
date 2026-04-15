/**
 * Normalizes room feature strings and shared-space access labels for public listings.
 */

import { splitRoomAccess } from './managerPropertyFormAirtableMap.js'

const BATHROOMISH =
  /bathroom|restroom|\bbath\b|ensuite|en\s*suite|powder(\s+room)?|half\s*bath|full\s*bath|three-?quarter|wc\b|shower|toilet|sink|\btub\b/i

function trimStr(v) {
  return String(v ?? '').trim()
}

/**
 * Split user-entered feature blobs on commas, semicolons, or middle dots.
 * @param {string} s
 * @returns {string[]}
 */
export function splitFeatureChunks(s) {
  return trimStr(s)
    .split(/\s*[,;·]\s*/)
    .map((x) => x.trim())
    .filter(Boolean)
}

/**
 * @param {...(string|string[]|null|undefined)} sources
 * @returns {string[]} deduped, trimmed feature labels (original casing kept for first occurrence)
 */
export function normalizeListingFeatureTags(...sources) {
  const bucket = []
  for (const src of sources) {
    if (src == null || src === '') continue
    if (Array.isArray(src)) {
      for (const item of src) {
        for (const chunk of splitFeatureChunks(String(item))) bucket.push(chunk)
      }
    } else {
      for (const chunk of splitFeatureChunks(String(src))) bucket.push(chunk)
    }
  }
  const seen = new Set()
  const out = []
  for (const t of bucket) {
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  return out
}

function isBathroomishSegment(seg) {
  return BATHROOMISH.test(trimStr(seg))
}

/**
 * Separates bathroom/access copy from furniture & room features for listing UI.
 * @param {Record<string, unknown>} detail — roomsDetail[i] from axis meta
 * @returns {{ bathroomSetup: string, featureTags: string[] }}
 */
export function partitionRoomListingFields(detail) {
  const d = detail && typeof detail === 'object' ? detail : {}
  let bathroomSetup = trimStr(d.bathroomSetup)
  const fi = trimStr(d.furnitureIncluded)
  const af = trimStr(d.additionalFeatures)
  let notes = trimStr(d.notes)

  const featureSources = []
  if (fi) featureSources.push(fi)
  if (af) featureSources.push(af)

  if (notes) {
    if (!bathroomSetup) {
      const segments = notes.split(/\s*·\s*/).map((s) => s.trim()).filter(Boolean)
      const bathParts = []
      const otherParts = []
      for (const seg of segments) {
        if (isBathroomishSegment(seg)) bathParts.push(seg)
        else otherParts.push(seg)
      }
      if (bathParts.length) bathroomSetup = bathParts.join(' · ')
      if (otherParts.length) featureSources.push(otherParts.join(', '))
      notes = ''
    } else {
      featureSources.push(notes)
      notes = ''
    }
  }

  const featureTags = normalizeListingFeatureTags(...featureSources)
  return {
    bathroomSetup,
    featureTags,
  }
}

/**
 * When every room (1..totalRooms) is in the access list, show "All rooms".
 * @param {string|string[]|unknown} accessRaw
 * @param {number} totalRooms
 * @returns {string} display line without "Access:" prefix
 */
export function formatSharedSpaceAccessDisplay(accessRaw, totalRooms) {
  const arr = Array.isArray(accessRaw) ? splitRoomAccess(accessRaw.join(',')) : splitRoomAccess(accessRaw)
  const n = Math.max(0, Math.floor(Number(totalRooms) || 0))
  if (n > 0 && arr.length >= n) {
    const expected = new Set(Array.from({ length: n }, (_, i) => `Room ${i + 1}`))
    const got = new Set(arr)
    if (expected.size === got.size && [...expected].every((x) => got.has(x))) {
      return 'All rooms'
    }
  }
  if (!arr.length) return ''
  return arr.join(', ')
}

/**
 * @param {number} n
 * @returns {string}
 */
export function formatBathroomCountForDisplay(n) {
  const x = Number(n)
  if (!Number.isFinite(x) || x < 0) return '0'
  if (x === 0) return '0'
  const rounded = Math.round(x * 10) / 10
  if (Number.isInteger(rounded)) return String(rounded)
  return String(rounded)
}

function startOfLocalDay(d) {
  const x = new Date(d)
  if (Number.isNaN(x.getTime())) return null
  x.setHours(0, 0, 0, 0)
  return x
}

function parseMonthDayYearListing(value, fallbackYear) {
  const match = String(value || '')
    .trim()
    .match(/^([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?$/)
  if (!match) return null
  const [, monthName, day, explicitYear] = match
  const year = Number(explicitYear || fallbackYear)
  const parsed = new Date(`${monthName} ${day}, ${year}`)
  if (Number.isNaN(parsed.getTime())) return null
  parsed.setHours(0, 0, 0, 0)
  return parsed
}

/**
 * Parse move-in / availability values from Airtable or wizard (ISO date, ISO datetime, M/D/YYYY).
 * @param {unknown} raw
 * @returns {Date | null} local calendar day at noon (stable parse), then callers may normalize to midnight
 */
export function parseListingMoveInDate(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return null
  const low = s.toLowerCase()
  if (low === 'unavailable') return null

  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s)
    if (Number.isNaN(d.getTime())) return null
    d.setHours(12, 0, 0, 0)
    return d
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)
  if (m) {
    const d = new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]), 12, 0, 0, 0)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

export function formatListingMoveInDateForDisplay(d) {
  if (!d || Number.isNaN(d.getTime())) return ''
  const x = new Date(d)
  x.setHours(12, 0, 0, 0)
  return x.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

/**
 * All "available after/starting &lt;date&gt;" move-in starts in a listing phrase (open-ended windows).
 * Dates are start-of local day so they align with {@link isAvailabilityActive} on the property page.
 * @param {string} text
 * @returns {Date[]}
 */
export function parseAvailabilityAfterStartingPhrases(text) {
  const normalized = String(text || '')
    .replace(/\u2013/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return []

  const seen = new Set()
  const out = []

  const reLong = /(?:after|starting)\s+([A-Za-z]+ \d{1,2}, \d{4})/gi
  let m
  while ((m = reLong.exec(normalized)) !== null) {
    const d = parseMonthDayYearListing(m[1], new Date().getFullYear())
    const day = d ? startOfLocalDay(d) : null
    if (day) {
      const key = day.getTime()
      if (!seen.has(key)) {
        seen.add(key)
        out.push(day)
      }
    }
  }

  const reIso = /(?:after|starting)\s+(\d{4}-\d{2}-\d{2})/gi
  while ((m = reIso.exec(normalized)) !== null) {
    const parsed = parseListingMoveInDate(m[1])
    const day = parsed ? startOfLocalDay(parsed) : null
    if (day) {
      const key = day.getTime()
      if (!seen.has(key)) {
        seen.add(key)
        out.push(day)
      }
    }
  }

  return out.sort((a, b) => a.getTime() - b.getTime())
}

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

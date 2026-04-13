/**
 * Embedded JSON block inside Properties "Other Info" for fields not yet modeled
 * as dedicated Airtable columns (room extras, move-in totals, leasing bundles, etc.).
 * Safe to extend with version bumps.
 *
 * `meta.leasing` uses Properties-style field names — see PROPERTIES_LEASING_META_KEYS
 * and PROPERTIES_LEASING_PACKAGE_KEYS in managerPropertyFormAirtableMap.js.
 *
 * Optional marketing fields (read by mapAirtableRecordToPropertyPage):
 * - `listingVideos`: [{ url | src, label? }] — property-level tour clips (plus any Airtable `Videos` attachments).
 * - `sharedSpacesDetail`: parallel to Shared Space 1..N on the record; each entry may include
 *   `imageUrls?: string[]`, `videos?: [{ url|src, label? }]`.
 * - `listingAvailabilityWindows`: property-level marketing windows from the manager Basics step;
 *   each `{ start: "yyyy-mm-dd", end?: "" | "yyyy-mm-dd" }` — empty `end` means open-ended after `start`.
 */

export const AXIS_LISTING_META_START = '---AXIS_LISTING_META_JSON---'

export const AXIS_LISTING_META_VERSION = 1

/**
 * @param {string} text
 * @returns {{ userText: string, meta: object | null }}
 */
export function parseAxisListingMetaBlock(text) {
  const raw = String(text || '')
  const idx = raw.indexOf(AXIS_LISTING_META_START)
  if (idx === -1) return { userText: raw.trim(), meta: null }
  const userText = raw.slice(0, idx).trim()
  const jsonPart = raw.slice(idx + AXIS_LISTING_META_START.length).trim()
  try {
    const meta = JSON.parse(jsonPart)
    return { userText, meta: meta && typeof meta === 'object' ? meta : null }
  } catch {
    return { userText: raw.trim(), meta: null }
  }
}

export function stripAxisListingMeta(text) {
  return parseAxisListingMetaBlock(text).userText
}

/**
 * @param {string} userOtherInfo
 * @param {Record<string, unknown>} meta
 */
export function mergeAxisListingMetaIntoOtherInfo(userOtherInfo, meta) {
  const base = stripAxisListingMeta(String(userOtherInfo || ''))
  const payload = { v: AXIS_LISTING_META_VERSION, ...meta }
  const json = JSON.stringify(payload)
  return base ? `${base}\n\n${AXIS_LISTING_META_START}\n${json}` : `${AXIS_LISTING_META_START}\n${json}`
}

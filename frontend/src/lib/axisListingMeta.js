/**
 * Small JSON block appended to Properties **Other Info** for data that does not have
 * a first-class Airtable column (or for legacy rows). **Prefer native columns** when present:
 * room rent / availability / furnished / utilities cost go to `Room N *` fields;
 * full-house / promo / lease-length copy go to `Full House Price`, `Promotional Full House Price`,
 * `Lease Length Information` (see `serializeManagerAddPropertyToAirtableFields`).
 *
 * What typically remains here after a save:
 * - `roomsDetail[]` — room **labels**, notes, bathroom/furniture feature text, `unavailable` flag
 *   (numeric rent & ISO availability read from `Room N Rent` / `Room N Availability` when those columns exist).
 * - `leasing["Leasing Packages"]` — bundle rows when floor packages are used (no dedicated table yet).
 * - `financials.moveInCharges` — optional until a column exists.
 * - `listingAvailabilityWindows`, `listingVideos`, `bathroomTotalDecimal`, `sharedSpacesDetail`
 *   (each entry may include `imageUrls[]`; photos may also use `axis-ss{n}-` filenames on Photos like laundry),
 *   `laundryDetail[]` (per laundry slot: extra description for listings; photos use `axis-l{n}-` filenames on Photos),
 *   optional `bathroomsDetail[]` (per bathroom slot notes / `imageUrls`); bathroom photos may also use `axis-b{n}-` on Photos), etc.
 *
 * `meta.leasing` uses Properties-style field names — see PROPERTIES_LEASING_META_KEYS
 * and PROPERTIES_LEASING_PACKAGE_KEYS in managerPropertyFormAirtableMap.js.
 */

export const AXIS_LISTING_META_START = '---AXIS_LISTING_META_JSON---'

export const AXIS_LISTING_META_VERSION = 1

/** Recognize canonical + legacy delimiters (some bases / older saves used two-dash markers). */
const AXIS_LISTING_META_MARKERS = ['---AXIS_LISTING_META_JSON---', '--AXIS_LISTING_META_JSON--']

function findAxisListingMetaMarker(raw) {
  let bestIdx = -1
  let bestLen = 0
  for (const m of AXIS_LISTING_META_MARKERS) {
    const i = raw.indexOf(m)
    if (i !== -1 && (bestIdx === -1 || i < bestIdx)) {
      bestIdx = i
      bestLen = m.length
    }
  }
  return bestIdx === -1 ? null : { idx: bestIdx, len: bestLen }
}

/**
 * @param {string} text
 * @returns {{ userText: string, meta: object | null }}
 */
export function parseAxisListingMetaBlock(text) {
  const raw = String(text || '')
  const found = findAxisListingMetaMarker(raw)
  if (!found) return { userText: raw.trim(), meta: null }
  const userText = raw.slice(0, found.idx).trim()
  const jsonPart = raw.slice(found.idx + found.len).trim()
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

/** Strip any known Axis meta marker + JSON tail (for display-only strings). */
export function stripAnyAxisListingMeta(text) {
  return parseAxisListingMetaBlock(text).userText
}

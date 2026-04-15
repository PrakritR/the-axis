/**
 * Property listing photos: Airtable attachment field resolution, hero vs sectional
 * (`axis-r*`, `axis-l*`, `axis-b*`, `axis-k*`, `axis-ss*`), and per-room URLs.
 */

const FALLBACK_PHOTO_FIELD_KEYS = ['Photos', 'Images', 'Property Photos']

/** Exact Airtable attachment field name for property photos (content upload + reads). */
export function getConfiguredPropertyPhotosFieldName() {
  const raw =
    typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_AIRTABLE_PROPERTY_PHOTOS_FIELD
      ? String(import.meta.env.VITE_AIRTABLE_PROPERTY_PHOTOS_FIELD).trim()
      : ''
  return raw || 'Photos'
}

function attachmentDisplayUrl(att) {
  if (!att) return ''
  if (typeof att === 'string') return String(att).trim()
  const u = att.url || att.thumbnails?.large?.url || att.thumbnails?.full?.url
  return typeof u === 'string' ? u.trim() : ''
}

/**
 * Attachment objects for the property's gallery field (configured name first, then common fallbacks).
 * @param {Record<string, unknown>} rec
 * @returns {unknown[]}
 */
export function photosAttachmentsFromRecord(rec) {
  const r = rec && typeof rec === 'object' ? rec : {}
  const configured = getConfiguredPropertyPhotosFieldName()
  const primary = r[configured]
  if (Array.isArray(primary) && primary.length) return primary
  for (const k of FALLBACK_PHOTO_FIELD_KEYS) {
    if (k === configured) continue
    const v = r[k]
    if (Array.isArray(v) && v.length) return v
  }
  return []
}

/** True when filename is a sectional upload (not general listing / hero). */
export function isAxisSectionalListingPhotoFilename(filename) {
  const base = String(filename || '').split(/[/\\]/).pop() || ''
  return (
    /^axis-r\d+/i.test(base) ||
    /^axis-l\d+/i.test(base) ||
    /^axis-b\d+/i.test(base) ||
    /^axis-k\d+/i.test(base) ||
    /^axis-ss\d+/i.test(base)
  )
}

/**
 * URLs for property hero / marketing carousel: non-sectional attachments first;
 * if every file is sectional, fall back to all URLs so nothing is hidden.
 * @param {unknown[]} atts
 * @returns {string[]}
 */
export function primaryGalleryUrlsFromAttachments(atts) {
  const hero = []
  const all = []
  for (const att of atts || []) {
    const u = attachmentDisplayUrl(att)
    if (!u) continue
    all.push(u)
    const fn = att && typeof att === 'object' ? att.filename || att.name : ''
    if (!isAxisSectionalListingPhotoFilename(fn)) hero.push(u)
  }
  return hero.length ? hero : all
}

/**
 * Room photos: meta `roomsDetail[i].imageUrls` plus `axis-r{n}-*` on the Photos field.
 * @param {number} roomIndexOneBased
 * @param {unknown[]} atts
 * @param {Record<string, unknown>} detail
 */
export function urlsForRoomListing(roomIndexOneBased, atts, detail) {
  const d = detail && typeof detail === 'object' ? detail : {}
  const fromMeta = (Array.isArray(d.imageUrls) ? d.imageUrls : [])
    .map((u) => String(u || '').trim())
    .filter(Boolean)
  const prefixLower = `axis-r${roomIndexOneBased}-`.toLowerCase()
  const fromPhotos = []
  for (const att of atts || []) {
    const fn = String(att?.filename || att?.name || '').toLowerCase()
    if (!fn.startsWith(prefixLower)) continue
    const u = attachmentDisplayUrl(att)
    if (u) fromPhotos.push(u)
  }
  return [...new Set([...fromMeta, ...fromPhotos])]
}

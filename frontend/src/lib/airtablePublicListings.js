import { parseAxisListingMetaBlock } from './axisListingMeta.js'
import {
  PROPERTY_AIR,
  clampInt,
  MAX_ROOM_SLOTS,
  MAX_SHARED_SPACE_SLOTS,
  normalizeLeasingFromMeta,
  roomRentField,
  sharedSpaceAccessField,
  sharedSpaceNameField,
  sharedSpaceTypeField,
} from './managerPropertyFormAirtableMap.js'

/** URL slug for an approved Airtable property (stable, unique). */
export function marketingSlugForAirtablePropertyId(recordId) {
  const id = String(recordId || '').trim()
  if (!/^rec[a-zA-Z0-9]{14,}$/.test(id)) return ''
  return `axis-${id}`
}

function trimStr(v) {
  return String(v ?? '').trim()
}

function parseMonthlyRentAmount(value) {
  const match = String(value || '').match(/\$([\d,]+)/)
  if (!match) return null
  const amount = Number(match[1].replace(/,/g, ''))
  return Number.isFinite(amount) ? amount : null
}

/** Normalize wizard / Airtable rent to a display string like $775/month */
function formatRentForListing(raw) {
  const s = trimStr(raw)
  if (!s) return ''
  if (/\bmonth\b/i.test(s) || /\/mo\b/i.test(s)) return s.replace(/\s+/g, ' ')
  const n = Number(s.replace(/[^\d.]/g, ''))
  if (Number.isFinite(n) && n > 0) return `$${n.toLocaleString('en-US')}/month`
  if (s.startsWith('$')) return s.includes('/') ? s : `${s}/month`
  return s
}

function availabilityDisplayFromDetail(detail) {
  const unavailable =
    detail.unavailable === true || trimStr(detail.availability).toLowerCase() === 'unavailable'
  if (unavailable) return 'Currently unavailable'
  const a = trimStr(detail.availability)
  if (!a) return 'Available now'
  if (/^\d{4}-\d{2}-\d{2}$/.test(a)) {
    const d = new Date(`${a}T12:00:00`)
    if (!Number.isNaN(d.getTime())) {
      return `Available after ${d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
    }
  }
  return a
}

function roomCountsAsAvailable(availableText) {
  const n = String(availableText || '').toLowerCase()
  if (!n) return true
  if (n.includes('unavailable')) return false
  if (n === 'booked') return false
  return true
}

/**
 * Build floor-plan cards from Room Count + roomsDetail meta + optional native Room N Rent columns.
 */
function buildRoomPlansFromAirtableRecord(rec, meta) {
  const roomDetails = Array.isArray(meta?.roomsDetail) ? meta.roomsDetail : []
  const fromCount = clampInt(rec[PROPERTY_AIR.roomCount] ?? 0, 0, MAX_ROOM_SLOTS)
  const roomCount =
    fromCount > 0
      ? fromCount
      : roomDetails.length > 0
        ? clampInt(roomDetails.length, 1, MAX_ROOM_SLOTS)
        : 0

  if (roomCount <= 0) return []

  const flat = []
  for (let i = 0; i < roomCount; i++) {
    const n = i + 1
    const detail = roomDetails[i] && typeof roomDetails[i] === 'object' ? roomDetails[i] : {}
    const label = trimStr(detail.label) || `Room ${n}`
    const rentRaw = detail.rent ?? rec[roomRentField(n)]
    const price = formatRentForListing(rentRaw) || 'Contact for pricing'
    const available = availabilityDisplayFromDetail(detail)
    const detailParts = [detail.notes, detail.furnitureIncluded, detail.additionalFeatures]
      .map(trimStr)
      .filter(Boolean)
    const details = detailParts.join(' · ')

    flat.push({
      name: label,
      price,
      available,
      details: details || undefined,
      videoPlaceholder: true,
      videoPlaceholderText: `${label} tour coming soon.`,
    })
  }

  const byPrice = new Map()
  for (const r of flat) {
    const key = r.price || '—'
    if (!byPrice.has(key)) byPrice.set(key, [])
    byPrice.get(key).push(r)
  }

  const groups = [...byPrice.entries()].sort(
    (a, b) => (parseMonthlyRentAmount(a[0]) ?? 0) - (parseMonthlyRentAmount(b[0]) ?? 0),
  )

  return groups.map(([priceRange, roomList]) => {
    const roomsAvailable = roomList.filter((x) => roomCountsAsAvailable(x.available)).length
    const title = roomList.length === 1 ? roomList[0].name : `${roomList.length} rooms`
    const summary =
      roomList.length > 1
        ? roomList
            .map((x) => x.name)
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
            .join(', ')
        : ''

    return {
      title,
      priceRange,
      summary,
      roomsAvailable: roomsAvailable > 0 ? roomsAvailable : roomList.length,
      rooms: roomList.map(({ videoPlaceholder, videoPlaceholderText, ...rest }) => ({
        ...rest,
        floorTitle: priceRange,
        ...(videoPlaceholder ? { videoPlaceholder, videoPlaceholderText } : {}),
      })),
    }
  })
}

function listingVideosFromRecord(rec, meta) {
  const fromMeta = Array.isArray(meta?.listingVideos) ? meta.listingVideos : []
  const out = []
  for (let i = 0; i < fromMeta.length; i++) {
    const v = fromMeta[i]
    const o = v && typeof v === 'object' ? v : {}
    const src = trimStr(o.url || o.src)
    const label = trimStr(o.label) || `Video ${i + 1}`
    if (src) out.push({ src, label, placeholder: !!o.placeholder, placeholderText: o.placeholderText })
  }

  const vf = rec?.Videos ?? rec?.['Video Tours'] ?? rec?.['Property Videos']
  if (Array.isArray(vf)) {
    for (const item of vf) {
      const url = typeof item === 'string' ? item : item?.url
      if (!url) continue
      const label =
        typeof item === 'object' && item?.filename ? String(item.filename).trim() || 'Property video' : 'Property video'
      out.push({ src: String(url), label })
    }
  }

  return out
}

const DEFAULT_SHARED_SPACES_FALLBACK = [
  { title: 'Living area', description: 'Shared lounge and everyday common space for the household.', images: [], videos: [] },
  { title: 'Kitchen', description: 'Full shared kitchen for cooking, storage, and shared meals.', images: [], videos: [] },
  { title: 'Laundry', description: 'Shared laundry for residents (layout varies by floor).', images: [], videos: [] },
]

function buildSharedSpacesListFromRecord(rec, meta) {
  const sc = clampInt(rec[PROPERTY_AIR.sharedSpaceCount] ?? 0, 0, MAX_SHARED_SPACE_SLOTS)
  const mediaRows = Array.isArray(meta?.sharedSpacesDetail) ? meta.sharedSpacesDetail : []

  if (sc <= 0) return DEFAULT_SHARED_SPACES_FALLBACK

  const out = []
  for (let i = 1; i <= sc; i++) {
    const name = trimStr(rec[sharedSpaceNameField(i)])
    const type = trimStr(rec[sharedSpaceTypeField(i)])
    const accessRaw = rec[sharedSpaceAccessField(i)]
    const accessStr = Array.isArray(accessRaw) ? accessRaw.map(trimStr).filter(Boolean).join(', ') : trimStr(accessRaw)

    if (!name && !type && !accessStr) continue

    const title = name || type || `Shared space ${i}`
    const descParts = []
    if (type && type !== name) descParts.push(type)
    if (accessStr) descParts.push(`Access: ${accessStr}`)
    const description = descParts.join(' · ') || 'Shared area'

    const m = mediaRows[i - 1] && typeof mediaRows[i - 1] === 'object' ? mediaRows[i - 1] : {}
    const imageUrls = (Array.isArray(m.imageUrls) ? m.imageUrls : []).map(trimStr).filter(Boolean)
    const vidRaw = Array.isArray(m.videos) ? m.videos : []
    const videos = vidRaw
      .map((v, j) => {
        const o = v && typeof v === 'object' ? v : {}
        const src = trimStr(o.url || o.src)
        const label = trimStr(o.label || o.title) || `${title} video ${j + 1}`
        if (!src) return null
        return {
          src,
          label,
          placeholder: !!o.placeholder,
          placeholderText: o.placeholderText,
        }
      })
      .filter(Boolean)

    out.push({ title, description, images: imageUrls, videos })
  }

  return out.length ? out : DEFAULT_SHARED_SPACES_FALLBACK
}

export function mapAirtableRecordToHomeProperty(rec) {
  const photos = Array.isArray(rec?.Photos) ? rec.Photos : []
  const urls = photos.map((a) => (typeof a === 'string' ? a : a?.url)).filter(Boolean)
  const name = String(rec['Property Name'] || rec.Name || 'Axis listing').trim()
  const slug = marketingSlugForAirtablePropertyId(rec.id)
  const beds = Number(rec['Room Count']) || 0
  const baths = Number(rec['Bathroom Count']) || 0
  const { userText, meta } = parseAxisListingMetaBlock(String(rec['Other Info'] || ''))
  const summary = userText.slice(0, 240) || 'Axis-managed shared housing in Seattle.'
  const videos = listingVideosFromRecord(rec, meta)
  return {
    slug,
    name,
    address: String(rec.Address || '').trim() || 'Seattle, WA',
    neighborhood: 'Seattle',
    type: 'Shared housing',
    beds: beds || 1,
    baths: baths || 1,
    rent: 'View listing',
    summary,
    images: urls,
    videos,
    location: { lat: 47.65, lng: -122.32 },
    _fromAirtable: true,
    airtableRecordId: rec.id,
  }
}

function formatListingAvailabilitySummary(windows) {
  const arr = Array.isArray(windows) ? windows : []
  const fmt = (iso) => {
    const s = String(iso || '').trim()
    if (!s) return ''
    const d = new Date(`${s}T12:00:00`)
    if (Number.isNaN(d.getTime())) return s
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }
  const parts = []
  for (const w of arr) {
    const st = String(w?.start || '').trim()
    if (!st) continue
    const en = String(w?.end || '').trim()
    if (!en) parts.push(`${fmt(st)} onward`)
    else parts.push(`${fmt(st)} – ${fmt(en)}`)
  }
  if (!parts.length) return ''
  return `Move-in availability: ${parts.join('; ')}`
}

export function mapAirtableRecordToPropertyPage(rec) {
  const base = mapAirtableRecordToHomeProperty(rec)
  const { userText, meta } = parseAxisListingMetaBlock(String(rec['Other Info'] || ''))
  const leasing = normalizeLeasingFromMeta(meta?.leasing)
  const fh = parseFloat(String(leasing.fullHousePrice || '').replace(/[^\d.]/g, ''))
  const pr = parseFloat(String(leasing.promoPrice || '').replace(/[^\d.]/g, ''))
  const rentHint =
    Number.isFinite(fh) && fh > 0 && Number.isFinite(pr) && pr > 0
      ? `$${Math.min(fh, pr).toLocaleString('en-US')}–$${Math.max(fh, pr).toLocaleString('en-US')}/month`
      : Number.isFinite(fh) && fh > 0
        ? `$${fh.toLocaleString('en-US')}/month`
        : base.rent
  const leasingPackages = (leasing.bundles || [])
    .map((b) => {
      const title = String(b.name || '').trim() || 'Package'
      const rooms = Array.isArray(b.rooms) ? b.rooms : []
      const n = String(b.price || '').replace(/\$/g, '').replace(/,/g, '').trim()
      const totalRent = n && !Number.isNaN(Number(n)) ? `$${Number(n).toLocaleString('en-US')}/month` : String(b.price || '').trim()
      return { title, rooms, totalRent, details: '' }
    })
    .filter((b) => b.title || b.totalRent || b.rooms.length)

  const roomPlans = buildRoomPlansFromAirtableRecord(rec, meta)
  const sharedSpacesList = buildSharedSpacesListFromRecord(rec, meta)
  const availabilitySummary = formatListingAvailabilitySummary(meta?.listingAvailabilityWindows)

  return {
    ...base,
    rent: rentHint,
    summary: userText.slice(0, 400) || base.summary,
    roomPlans,
    floorPlans: [],
    highlights: [userText.slice(0, 280), availabilitySummary].filter(Boolean),
    communityAmenities: Array.isArray(rec.Amenities) ? rec.Amenities : [],
    unitAmenities: [],
    policies: String(leasing.leaseLengthInfo || '').trim() || 'Contact Axis for lease options.',
    applicationFee: '$50',
    leasingPackages,
    leaseTerms: [],
    cleaningFee: '',
    utilitiesFee: '',
    securityDeposit: String(rec['Security Deposit'] != null ? rec['Security Deposit'] : '$500'),
    sharedSpacesList,
  }
}

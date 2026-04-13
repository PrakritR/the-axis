import { parseAxisListingMetaBlock } from './axisListingMeta.js'
import {
  PROPERTY_AIR,
  clampInt,
  computeDecimalBathroomTotalFromAirtableRecord,
  kitchenDescriptionField,
  kitchenRoomsSharingField,
  laundryRoomsSharingField,
  laundryTypeField,
  MAX_KITCHEN_SLOTS,
  MAX_LAUNDRY_SLOTS,
  MAX_ROOM_SLOTS,
  MAX_SHARED_SPACE_SLOTS,
  normalizeLeasingFromMeta,
  parseBodyTriplet,
  roomAvailabilityField,
  roomRentField,
  sharedSpaceAccessField,
  sharedSpaceNameField,
  sharedSpaceTypeField,
  splitRoomAccess,
} from './managerPropertyFormAirtableMap.js'
import {
  formatBathroomCountForDisplay,
  formatSharedSpaceAccessDisplay,
  partitionRoomListingFields,
} from './listingRoomDisplay.js'

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

function availabilityDisplayFromDetail(detail, rec, roomIndexOneBased) {
  const detailObj = detail && typeof detail === 'object' ? detail : {}
  const unavailable =
    detailObj.unavailable === true || trimStr(detailObj.availability).toLowerCase() === 'unavailable'
  if (unavailable) return 'Currently unavailable'
  const fromDetail = trimStr(detailObj.availability)
  const fromCol =
    rec && roomIndexOneBased
      ? trimStr(rec[roomAvailabilityField(roomIndexOneBased)])
      : ''
  const a = fromDetail || fromCol
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
    const available = availabilityDisplayFromDetail(detail, rec, n)
    const { bathroomSetup, featureTags } = partitionRoomListingFields(detail)

    flat.push({
      name: label,
      price,
      available,
      bathroomSetup: bathroomSetup || undefined,
      featureTags,
      /** @deprecated listing subtitle — bathroom only; use `bathroomSetup` */
      details: bathroomSetup || undefined,
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
  const roomCount = clampInt(rec[PROPERTY_AIR.roomCount] ?? 0, 0, MAX_ROOM_SLOTS)
  const sc = clampInt(rec[PROPERTY_AIR.sharedSpaceCount] ?? 0, 0, MAX_SHARED_SPACE_SLOTS)
  const mediaRows = Array.isArray(meta?.sharedSpacesDetail) ? meta.sharedSpacesDetail : []

  const out = []
  for (let i = 1; i <= sc; i++) {
    const name = trimStr(rec[sharedSpaceNameField(i)])
    const type = trimStr(rec[sharedSpaceTypeField(i)])
    const accessRaw = rec[sharedSpaceAccessField(i)]
    const accessList = Array.isArray(accessRaw)
      ? accessRaw.map(trimStr).filter(Boolean)
      : trimStr(accessRaw)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)

    if (!name && !type && !accessList.length) continue

    const title = name || type || `Shared space ${i}`
    const m = mediaRows[i - 1] && typeof mediaRows[i - 1] === 'object' ? mediaRows[i - 1] : {}
    const descText = trimStr(m.description || m.notes || '')
    const accessDisplay = formatSharedSpaceAccessDisplay(accessList, roomCount)
    const typeLine = type && type !== name ? type : ''
    const descriptionParts = [descText, typeLine].filter(Boolean)
    const description = descriptionParts.join(' — ') || (typeLine || 'Shared area')
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

    out.push({
      title,
      description,
      accessLabel: accessDisplay,
      images: imageUrls,
      videos,
    })
  }

  const kc = clampInt(rec[PROPERTY_AIR.kitchenCount] ?? 0, 0, MAX_KITCHEN_SLOTS)
  for (let i = 1; i <= kc; i++) {
    const parsed = parseBodyTriplet(rec[kitchenDescriptionField(i)])
    const kind = trimStr(parsed.kind)
    const label = trimStr(parsed.label)
    const descExtra = trimStr(parsed.description)
    const accessList = splitRoomAccess(rec[kitchenRoomsSharingField(i)])
    if (!kind && !label && !descExtra && !accessList.length) continue
    const title = label || kind || (kc > 1 ? `Kitchen ${i}` : 'Kitchen')
    const descParts = [kind, descExtra].filter(Boolean)
    const descText = descParts.join(' — ')
    const accessDisplay = formatSharedSpaceAccessDisplay(accessList, roomCount)
    out.push({
      title,
      description: descText || 'Shared kitchen',
      accessLabel: accessDisplay,
      images: [],
      videos: [],
    })
  }

  const laundryOn = rec[PROPERTY_AIR.laundry] === true || rec[PROPERTY_AIR.laundry] === 1
  if (laundryOn) {
    let laundryPushed = false
    for (let i = 1; i <= MAX_LAUNDRY_SLOTS; i++) {
      const lt = trimStr(rec[laundryTypeField(i)])
      const accessList = splitRoomAccess(rec[laundryRoomsSharingField(i)])
      if (!lt && !accessList.length) continue
      laundryPushed = true
      const accessDisplay = formatSharedSpaceAccessDisplay(accessList, roomCount)
      out.push({
        title: i === 1 ? 'Laundry' : `Laundry ${i}`,
        description: lt || 'Shared laundry',
        accessLabel: accessDisplay,
        images: [],
        videos: [],
      })
    }
    if (!laundryPushed) {
      const gen = splitRoomAccess(rec[PROPERTY_AIR.roomsSharingLaundry])
      if (gen.length) {
        out.push({
          title: 'Laundry',
          description: 'Shared laundry',
          accessLabel: formatSharedSpaceAccessDisplay(gen, roomCount),
          images: [],
          videos: [],
        })
      }
    }
  }

  return out.length ? out : DEFAULT_SHARED_SPACES_FALLBACK
}

function resolveBathroomTotalForListing(rec, meta) {
  const m = parseFloat(meta?.bathroomTotalDecimal)
  if (Number.isFinite(m) && m > 0) return m
  const fromBodies = computeDecimalBathroomTotalFromAirtableRecord(rec)
  if (fromBodies > 0) return fromBodies
  const n = Number(rec[PROPERTY_AIR.bathroomCount] ?? rec['Bathroom Count'])
  if (Number.isFinite(n) && n > 0) return n
  return 0
}

export function mapAirtableRecordToHomeProperty(rec) {
  const photos = Array.isArray(rec?.Photos) ? rec.Photos : []
  const urls = photos.map((a) => (typeof a === 'string' ? a : a?.url)).filter(Boolean)
  const name = String(rec['Property Name'] || rec.Name || 'Axis listing').trim()
  const slug = marketingSlugForAirtablePropertyId(rec.id)
  const beds = Number(rec['Room Count']) || 0
  const { userText, meta } = parseAxisListingMetaBlock(String(rec['Other Info'] || ''))
  const bathsResolved = resolveBathroomTotalForListing(rec, meta)
  const baths =
    bathsResolved > 0 ? bathsResolved : Number(rec['Bathroom Count'] ?? rec[PROPERTY_AIR.bathroomCount]) || 0
  const summary = userText.slice(0, 240) || 'Axis-managed shared housing in Seattle.'
  const videos = listingVideosFromRecord(rec, meta)
  return {
    slug,
    name,
    address: String(rec.Address || '').trim() || 'Seattle, WA',
    neighborhood: 'Seattle',
    type: 'Shared housing',
    beds: beds || 1,
    baths: baths > 0 ? baths : 1,
    rent: 'View listing',
    summary,
    images: urls,
    videos,
    location: { lat: 47.65, lng: -122.32 },
    tags: ['Shared Housing', 'Seattle', 'Shared Living'],
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

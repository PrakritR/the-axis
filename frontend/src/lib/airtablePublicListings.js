import { DEFAULT_APPLICATION_FEE_USD } from '../../../shared/stripe-application-fee-defaults.js'
import { parseAxisListingMetaBlock } from './axisListingMeta.js'
import {
  PROPERTY_AIR,
  bathroomDescriptionField,
  bathroomRoomsSharingField,
  clampInt,
  computeDecimalBathroomTotalFromAirtableRecord,
  kitchenDescriptionField,
  kitchenRoomsSharingField,
  laundryRoomsSharingField,
  laundryTypeField,
  MAX_BATHROOM_SHARING_SLOTS,
  MAX_BATHROOM_SLOTS,
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
  formatListingMoveInDateForDisplay,
  formatSharedSpaceAccessDisplay,
  parseListingMoveInDate,
  partitionRoomListingFields,
} from './listingRoomDisplay.js'
import {
  photosAttachmentsFromRecord,
  primaryGalleryUrlsFromAttachments,
  urlsForRoomListing,
} from './propertyListingPhotos.js'

/** URL slug for an approved Airtable property (stable, unique). */
export function marketingSlugForAirtablePropertyId(recordId) {
  const id = String(recordId || '').trim()
  if (!/^rec[a-zA-Z0-9]{14,}$/.test(id)) return ''
  return `axis-${id}`
}

function trimStr(v) {
  return String(v ?? '').trim()
}

function toFiniteNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function normalizeAddressKey(address) {
  return String(address || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

const ADDRESS_COORD_FALLBACKS = {
  '4709a8thaveneseattlewa98105': { lat: 47.662043, lng: -122.319837 },
  '4709b8thaveneseattlewa98105': { lat: 47.662043, lng: -122.319837 },
  '5259brooklynaveneseattlewa98105': { lat: 47.666673, lng: -122.314335 },
}

function resolvePropertyLocation(rec) {
  const directLat =
    toFiniteNumber(rec?.Latitude) ??
    toFiniteNumber(rec?.latitude) ??
    toFiniteNumber(rec?.Lat) ??
    toFiniteNumber(rec?.lat)
  const directLng =
    toFiniteNumber(rec?.Longitude) ??
    toFiniteNumber(rec?.longitude) ??
    toFiniteNumber(rec?.Lng) ??
    toFiniteNumber(rec?.lng) ??
    toFiniteNumber(rec?.Long) ??
    toFiniteNumber(rec?.long)
  if (directLat != null && directLng != null) {
    return { lat: directLat, lng: directLng }
  }

  const loc = rec?.Location
  if (loc && typeof loc === 'object') {
    const objLat = toFiniteNumber(loc.lat ?? loc.latitude)
    const objLng = toFiniteNumber(loc.lng ?? loc.lon ?? loc.longitude)
    if (objLat != null && objLng != null) {
      return { lat: objLat, lng: objLng }
    }
  }

  const address = String(rec?.Address || '').trim()
  const key = normalizeAddressKey(address)
  if (ADDRESS_COORD_FALLBACKS[key]) {
    return ADDRESS_COORD_FALLBACKS[key]
  }

  return { lat: 47.661, lng: -122.318 }
}

function parseMonthlyRentAmount(value) {
  const match = String(value || '').match(/\$([\d,]+)/)
  if (!match) return null
  const amount = Number(match[1].replace(/,/g, ''))
  return Number.isFinite(amount) ? amount : null
}

/** Dollar amounts from Room N Rent / meta roomsDetail (for card + detail rent line). */
function collectRoomRentAmountsFromRecord(rec, meta) {
  const amounts = []
  const roomDetails = Array.isArray(meta?.roomsDetail) ? meta.roomsDetail : []
  const fromCount = clampInt(rec[PROPERTY_AIR.roomCount] ?? 0, 0, MAX_ROOM_SLOTS)
  const roomCount =
    fromCount > 0
      ? fromCount
      : roomDetails.length > 0
        ? clampInt(roomDetails.length, 1, MAX_ROOM_SLOTS)
        : 0

  for (let i = 0; i < roomCount; i += 1) {
    const n = i + 1
    const detail = roomDetails[i] && typeof roomDetails[i] === 'object' ? roomDetails[i] : {}
    const rentRaw = detail.rent ?? rec[roomRentField(n)]
    const formatted = formatRentForListing(rentRaw)
    let amt = parseMonthlyRentAmount(formatted)
    if (amt == null) amt = parseMonthlyRentAmount(String(rentRaw))
    if (amt == null && rentRaw != null && String(rentRaw).trim() !== '') {
      const plain = Number(String(rentRaw).replace(/[^\d.]/g, ''))
      if (Number.isFinite(plain) && plain > 0) amt = plain
    }
    if (Number.isFinite(amt) && amt > 0) amounts.push(amt)
  }
  return amounts
}

/**
 * Marketing rent string (with /month) from leasing meta, else min–max of room rents.
 */
export function computeListingRentLabel(rec, meta) {
  const leasing = normalizeLeasingFromMeta(meta?.leasing)
  const listedRoomRent = Number(meta?.financials?.monthlyRoomRent)
  if (Number.isFinite(listedRoomRent) && listedRoomRent > 0) {
    return `$${listedRoomRent.toLocaleString('en-US')}/month`
  }
  const fh = parseFloat(String(leasing.fullHousePrice || '').replace(/[^\d.]/g, ''))
  const pr = parseFloat(String(leasing.promoPrice || '').replace(/[^\d.]/g, ''))
  if (Number.isFinite(fh) && fh > 0 && Number.isFinite(pr) && pr > 0) {
    const lo = Math.min(fh, pr)
    const hi = Math.max(fh, pr)
    return lo === hi
      ? `$${lo.toLocaleString('en-US')}/month`
      : `$${lo.toLocaleString('en-US')}–$${hi.toLocaleString('en-US')}/month`
  }
  if (Number.isFinite(fh) && fh > 0) {
    return `$${fh.toLocaleString('en-US')}/month`
  }
  const roomAmounts = collectRoomRentAmountsFromRecord(rec, meta)
  if (!roomAmounts.length) return ''
  const min = Math.min(...roomAmounts)
  const max = Math.max(...roomAmounts)
  if (min === max) return `$${min.toLocaleString('en-US')}/month`
  return `$${min.toLocaleString('en-US')}–$${max.toLocaleString('en-US')}/month`
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
  const parsed = parseListingMoveInDate(a)
  if (parsed) {
    return `Available starting ${formatListingMoveInDateForDisplay(parsed)}`
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

  const photoAtts = photosAttachmentsFromRecord(rec)
  const flat = []
  for (let i = 0; i < roomCount; i++) {
    const n = i + 1
    const detail = roomDetails[i] && typeof roomDetails[i] === 'object' ? roomDetails[i] : {}
    const label = trimStr(detail.label) || `Room ${n}`
    const rentRaw = detail.rent ?? rec[roomRentField(n)]
    const price = formatRentForListing(rentRaw) || 'Contact for pricing'
    const available = availabilityDisplayFromDetail(detail, rec, n)
    const { bathroomSetup, featureTags } = partitionRoomListingFields(detail)
    const images = urlsForRoomListing(n, photoAtts, detail)

    flat.push({
      name: label,
      price,
      available,
      bathroomSetup: bathroomSetup || undefined,
      featureTags,
      /** @deprecated listing subtitle — bathroom only; use `bathroomSetup` */
      details: bathroomSetup || undefined,
      images,
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
      title: `${roomList.length} room${roomList.length !== 1 ? 's' : ''}`,
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

function attachmentUrlsWithFilenamePrefix(photos, prefixLower) {
  const out = []
  const arr = Array.isArray(photos) ? photos : []
  for (const att of arr) {
    const fn = String(att?.filename || att?.name || '').toLowerCase()
    if (!fn.startsWith(prefixLower)) continue
    const url =
      typeof att === 'string'
        ? att
        : att?.url || att?.thumbnails?.large?.url || att?.thumbnails?.full?.url
    if (url) out.push(String(url).trim())
  }
  return out
}

const VIDEO_FILENAME_RE = /\.(mp4|mpe?g|mov|webm|m4v|mkv|avi|ogv)(\?|#|$)/i

function attachmentUrlLooksVideo(url, filename, mimeType) {
  const u = String(url || '').toLowerCase()
  const fn = String(filename || '').toLowerCase()
  const mt = String(mimeType || '').toLowerCase()
  if (mt.startsWith('video/')) return true
  if (VIDEO_FILENAME_RE.test(u) || VIDEO_FILENAME_RE.test(fn)) return true
  return false
}

/**
 * Split sectional uploads (`axis-b1-…`, `axis-k1-…`, etc.) into image URLs vs video URLs for listing UI.
 * @returns {{ images: string[], videos: { src: string, label: string }[] }}
 */
function attachmentMediaPartitioned(photos, prefixLower, videoLabelBase) {
  const images = []
  const videos = []
  const arr = Array.isArray(photos) ? photos : []
  let vidIdx = 0
  for (const att of arr) {
    const fn = String(att?.filename || att?.name || '').toLowerCase()
    if (!fn.startsWith(prefixLower)) continue
    const url =
      typeof att === 'string'
        ? att
        : att?.url || att?.thumbnails?.large?.url || att?.thumbnails?.full?.url
    if (!url) continue
    const u = String(url).trim()
    const mime = typeof att === 'object' ? att?.type : ''
    if (attachmentUrlLooksVideo(u, att?.filename || att?.name, mime)) {
      vidIdx += 1
      videos.push({ src: u, label: `${videoLabelBase} video ${vidIdx}` })
    } else {
      images.push(u)
    }
  }
  return { images, videos }
}

function videoRowsFromMeta(vidRaw, titleBase) {
  const rows = Array.isArray(vidRaw) ? vidRaw : []
  const out = []
  rows.forEach((v, j) => {
    const o = v && typeof v === 'object' ? v : {}
    const src = trimStr(o.url || o.src)
    const label = trimStr(o.label || o.title) || `${titleBase} video ${j + 1}`
    if (!src) return
    out.push({
      src,
      label,
      placeholder: !!o.placeholder,
      placeholderText: o.placeholderText,
    })
  })
  return out
}

function buildSharedSpacesListFromRecord(rec, meta) {
  const roomCount = clampInt(rec[PROPERTY_AIR.roomCount] ?? 0, 0, MAX_ROOM_SLOTS)
  const sc = clampInt(rec[PROPERTY_AIR.sharedSpaceCount] ?? 0, 0, MAX_SHARED_SPACE_SLOTS)
  const mediaRows = Array.isArray(meta?.sharedSpacesDetail) ? meta.sharedSpacesDetail : []
  const photoAtts = photosAttachmentsFromRecord(rec)

  const out = []
  for (let i = 1; i <= sc; i++) {
    const legacyName = trimStr(rec[sharedSpaceNameField(i)])
    const type = trimStr(rec[sharedSpaceTypeField(i)])
    const accessRaw = rec[sharedSpaceAccessField(i)]
    const accessList = Array.isArray(accessRaw)
      ? accessRaw.map(trimStr).filter(Boolean)
      : trimStr(accessRaw)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)

    if (!type && !accessList.length && !legacyName) continue

    const m = mediaRows[i - 1] && typeof mediaRows[i - 1] === 'object' ? mediaRows[i - 1] : {}
    const title = trimStr(m.title) || type || legacyName || `Shared space ${i}`
    const descText = trimStr(m.description || m.notes || m.type || '')
    const accessDisplay = formatSharedSpaceAccessDisplay(accessList, roomCount)
    const typeLine = type && type !== legacyName ? type : ''
    const descriptionParts = [descText, typeLine].filter(Boolean)
    const description = descriptionParts.join(' — ') || (typeLine || 'Shared area')
    const fromMeta = (Array.isArray(m.imageUrls) ? m.imageUrls : []).map(trimStr).filter(Boolean)
    const fromPhotos = attachmentUrlsWithFilenamePrefix(photoAtts, `axis-ss${i}-`.toLowerCase())
    const imageUrls = [...new Set([...fromMeta, ...fromPhotos])]
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

  const kitchenMetaRows = Array.isArray(meta?.kitchensDetail) ? meta.kitchensDetail : []
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
    const km = kitchenMetaRows[i - 1] && typeof kitchenMetaRows[i - 1] === 'object' ? kitchenMetaRows[i - 1] : {}
    const metaNote = trimStr(km.description || km.notes || '')
    const description = [descText, metaNote].filter(Boolean).join(' · ') || 'Shared kitchen'
    const { images: fromPhotos, videos: fromPhotoVideos } = attachmentMediaPartitioned(
      photoAtts,
      `axis-k${i}-`.toLowerCase(),
      title,
    )
    const fromMeta = (Array.isArray(km.imageUrls) ? km.imageUrls : []).map(trimStr).filter(Boolean)
    const images = [...new Set([...fromMeta, ...fromPhotos])]
    const videos = [...fromPhotoVideos, ...videoRowsFromMeta(km.videos, title)]
    out.push({
      title,
      description,
      accessLabel: accessDisplay,
      images,
      videos,
    })
  }

  const laundryOn = rec[PROPERTY_AIR.laundry] === true || rec[PROPERTY_AIR.laundry] === 1
  if (laundryOn) {
    let laundryPushed = false
    const laundryMetaRows = Array.isArray(meta?.laundryDetail) ? meta.laundryDetail : []
    for (let i = 1; i <= MAX_LAUNDRY_SLOTS; i++) {
      const lt = trimStr(rec[laundryTypeField(i)])
      const accessList = splitRoomAccess(rec[laundryRoomsSharingField(i)])
      if (!lt && !accessList.length) continue
      laundryPushed = true
      const accessDisplay = formatSharedSpaceAccessDisplay(accessList, roomCount)
      const lm = laundryMetaRows[i - 1] && typeof laundryMetaRows[i - 1] === 'object' ? laundryMetaRows[i - 1] : {}
      const extra = trimStr(lm.description || lm.notes || '')
      const descParts = [lt, extra].filter(Boolean)
      const description = descParts.join(' — ') || 'Shared laundry'
      const fromPhotos = attachmentUrlsWithFilenamePrefix(photoAtts, `axis-l${i}-`.toLowerCase())
      const fromMeta = (Array.isArray(lm.imageUrls) ? lm.imageUrls : []).map(trimStr).filter(Boolean)
      const images = [...new Set([...fromPhotos, ...fromMeta])]
      out.push({
        title: i === 1 ? 'Laundry' : `Laundry ${i}`,
        description,
        accessLabel: accessDisplay,
        images,
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

/**
 * Bathrooms from manager wizard (`Bathroom N` + `Rooms Sharing Bathroom N`) plus
 * listing photos named `axis-b{n}-*` on the property Photos field.
 */
function buildBathroomsListFromRecord(rec, meta) {
  const roomCount = clampInt(rec[PROPERTY_AIR.roomCount] ?? 0, 0, MAX_ROOM_SLOTS)
  const bc = clampInt(rec[PROPERTY_AIR.bathroomCount] ?? 0, 0, MAX_BATHROOM_SLOTS)
  const bathroomMetaRows = Array.isArray(meta?.bathroomsDetail) ? meta.bathroomsDetail : []
  const photos = photosAttachmentsFromRecord(rec)
  const out = []
  for (let i = 1; i <= bc; i++) {
    const parsed = parseBodyTriplet(rec[bathroomDescriptionField(i)])
    const kind = trimStr(parsed.kind)
    const label = trimStr(parsed.label)
    const descExtra = trimStr(parsed.description)
    const roomsSharing =
      i <= MAX_BATHROOM_SHARING_SLOTS ? rec[bathroomRoomsSharingField(i)] : ''
    const accessList = splitRoomAccess(roomsSharing)
    if (!kind && !label && !descExtra && !accessList.length) continue
    const title = label || kind || (bc > 1 ? `Bathroom ${i}` : 'Bathroom')
    const descParts = [kind, descExtra].filter(Boolean)
    const descText = descParts.join(' — ')
    const accessDisplay = formatSharedSpaceAccessDisplay(accessList, roomCount)
    const bm = bathroomMetaRows[i - 1] && typeof bathroomMetaRows[i - 1] === 'object' ? bathroomMetaRows[i - 1] : {}
    const metaNote = trimStr(bm.description || bm.notes || '')
    const description = [descText, metaNote].filter(Boolean).join(' · ') || 'Bathroom'
    const { images: fromPhotos, videos: fromPhotoVideos } = attachmentMediaPartitioned(
      photos,
      `axis-b${i}-`.toLowerCase(),
      title,
    )
    const fromMeta = (Array.isArray(bm.imageUrls) ? bm.imageUrls : []).map(trimStr).filter(Boolean)
    const images = [...new Set([...fromPhotos, ...fromMeta])]
    const videos = [...fromPhotoVideos, ...videoRowsFromMeta(bm.videos, title)]
    out.push({
      title,
      description,
      accessLabel: accessDisplay,
      images,
      videos,
    })
  }
  return out
}

function formatMoneyLabelFromNumber(n) {
  if (!Number.isFinite(n) || n < 0) return ''
  if (n === 0) return '$0'
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: n % 1 !== 0 ? 2 : 0 })}`
}

function listingPricingBulletsFromFinancials(rec, meta) {
  const fin = meta?.financials && typeof meta.financials === 'object' ? meta.financials : {}
  if (!boolFromMetaFlag(fin.showFeesOnListing)) return []

  const bullets = []
  const mr = Number(fin.monthlyRoomRent)
  if (Number.isFinite(mr) && mr > 0) {
    bullets.push(`Typical room rent from ${formatMoneyLabelFromNumber(mr)}/month (confirm on lease).`)
  }

  const utilCol = String(
    rec['Utilities Fee'] ?? rec['Utilities'] ?? rec['House Utilities'] ?? '',
  ).trim()
  const utilNum = Number(fin.utilityFee ?? fin.utilities)
  if (utilCol) bullets.push(`Utilities: ${utilCol}`)
  else if (Number.isFinite(utilNum) && utilNum > 0) {
    bullets.push(`Utility fee about ${formatMoneyLabelFromNumber(utilNum)}/month (see lease for what is included).`)
  }

  const hold = Number(fin.holdingDeposit)
  if (Number.isFinite(hold) && hold > 0) bullets.push(`Holding deposit: ${formatMoneyLabelFromNumber(hold)}`)

  const mif = Number(fin.moveInFee)
  if (Number.isFinite(mif) && mif > 0) bullets.push(`Move-in fee: ${formatMoneyLabelFromNumber(mif)}`)

  const appFeeNum = Number(rec[PROPERTY_AIR.applicationFee])
  if (Number.isFinite(appFeeNum) && appFeeNum >= 0) {
    bullets.push(
      appFeeNum === 0 ? 'No application fee' : `Application fee: ${formatMoneyLabelFromNumber(appFeeNum)}`,
    )
  }

  const sdRaw = rec[PROPERTY_AIR.securityDeposit] ?? rec['Security Deposit']
  const sdStr = sdRaw != null && String(sdRaw).trim() !== '' ? String(sdRaw).trim() : ''
  if (sdStr) bullets.push(`Security deposit: ${sdStr}`)

  const late = Number(fin.lateRentFee)
  if (Number.isFinite(late) && late > 0) bullets.push(`Late rent fee: ${formatMoneyLabelFromNumber(late)}`)

  if (boolFromMetaFlag(fin.petsAllowed)) {
    const pd = Number(fin.petDeposit)
    const pr = Number(fin.petRent)
    if (Number.isFinite(pd) && pd > 0) bullets.push(`Pet deposit: ${formatMoneyLabelFromNumber(pd)}`)
    if (Number.isFinite(pr) && pr > 0) bullets.push(`Pet rent: ${formatMoneyLabelFromNumber(pr)}/month`)
  }

  if (boolFromMetaFlag(fin.conditionalDepositRequired)) {
    const cd = Number(fin.conditionalDeposit)
    if (Number.isFinite(cd) && cd > 0) {
      const note = String(fin.conditionalDepositNote || '').trim()
      bullets.push(
        note
          ? `Additional deposit (when applicable): ${formatMoneyLabelFromNumber(cd)} — ${note}`
          : `Additional deposit (when applicable): ${formatMoneyLabelFromNumber(cd)}`,
      )
    }
  }

  return bullets.slice(0, 10)
}

function boolFromMetaFlag(v) {
  return v === true || v === 1 || v === '1' || String(v || '').trim().toLowerCase() === 'true'
}

/**
 * Fee / deposit strings for marketing cards and property pages (Airtable + meta).
 * Kept in one place so home listings match full listing pages.
 */
export function financialDisplayFieldsFromAirtableRecord(rec, meta) {
  const appFeeNum = Number(rec[PROPERTY_AIR.applicationFee])
  const applicationFeeDisplay =
    Number.isFinite(appFeeNum) && appFeeNum >= 0
      ? appFeeNum === 0
        ? 'No application fee'
        : `${formatMoneyLabelFromNumber(appFeeNum)} application fee`
      : `${formatMoneyLabelFromNumber(DEFAULT_APPLICATION_FEE_USD)} application fee`

  const moveInNum = Number(meta?.financials?.moveInCharges)
  const moveInChargesDisplay =
    Number.isFinite(moveInNum) && moveInNum > 0
      ? `${formatMoneyLabelFromNumber(moveInNum)} other move-in charges (see lease)`
      : ''

  const adminFeeNum = Number(meta?.financials?.administrationFee)
  const administrationFeeDisplay =
    Number.isFinite(adminFeeNum) && adminFeeNum > 0
      ? `${formatMoneyLabelFromNumber(adminFeeNum)} administrative (non-refundable)`
      : ''

  const moveInFeeNum = Number(meta?.financials?.moveInFee)
  const moveInFeeDisplay =
    Number.isFinite(moveInFeeNum) && moveInFeeNum > 0
      ? `${formatMoneyLabelFromNumber(moveInFeeNum)} move-in fee`
      : ''

  let utilitiesFee = String(
    rec['Utilities Fee'] ?? rec['Utilities'] ?? rec['House Utilities'] ?? meta?.financials?.utilities ?? '',
  ).trim()
  const utilMetaNum = Number(meta?.financials?.utilityFee ?? meta?.financials?.utilities)
  if (!utilitiesFee && Number.isFinite(utilMetaNum) && utilMetaNum > 0) {
    utilitiesFee = `${formatMoneyLabelFromNumber(utilMetaNum)}/month`
  }

  const sdRaw = rec[PROPERTY_AIR.securityDeposit] ?? rec['Security Deposit']
  const securityDeposit =
    sdRaw != null && String(sdRaw).trim() !== '' ? String(sdRaw).trim() : '$500'

  const applicationFee =
    Number.isFinite(appFeeNum) && appFeeNum >= 0
      ? appFeeNum === 0
        ? '$0'
        : formatMoneyLabelFromNumber(appFeeNum)
      : formatMoneyLabelFromNumber(DEFAULT_APPLICATION_FEE_USD)

  const showFeesOnListing = boolFromMetaFlag(meta?.financials?.showFeesOnListing)
  const listingPricingBullets = listingPricingBulletsFromFinancials(rec, meta)
  const pricingNotesForListing = showFeesOnListing
    ? String(meta?.financials?.pricingNotes || '').trim()
    : ''

  return {
    applicationFee,
    applicationFeeDisplay,
    moveInChargesDisplay,
    administrationFeeDisplay,
    moveInFeeDisplay,
    utilitiesFee,
    securityDeposit,
    showFeesOnListing,
    listingPricingBullets,
    pricingNotesForListing,
  }
}

export function mapAirtableRecordToHomeProperty(rec) {
  const photoAtts = photosAttachmentsFromRecord(rec)
  const urls = primaryGalleryUrlsFromAttachments(photoAtts)
  const name = String(rec['Property Name'] || rec.Name || 'Axis listing').trim()
  const slug = marketingSlugForAirtablePropertyId(rec.id)
  const beds = Number(rec['Room Count']) || 0
  const { userText, meta } = parseAxisListingMetaBlock(String(rec['Other Info'] || ''))
  const bathsResolved = resolveBathroomTotalForListing(rec, meta)
  const baths =
    bathsResolved > 0 ? bathsResolved : Number(rec['Bathroom Count'] ?? rec[PROPERTY_AIR.bathroomCount]) || 0
  const summary = userText.slice(0, 240) || 'Axis-managed shared housing in Seattle.'
  const videos = listingVideosFromRecord(rec, meta)
  const rent = computeListingRentLabel(rec, meta)
  const roomPlans = buildRoomPlansFromAirtableRecord(rec, meta)
  const financials = financialDisplayFieldsFromAirtableRecord(rec, meta)
  return {
    slug,
    name,
    address: String(rec.Address || '').trim() || 'Seattle, WA',
    neighborhood: 'Seattle',
    type: 'Shared housing',
    beds: beds || 1,
    baths: baths > 0 ? baths : 1,
    rent,
    summary,
    images: urls,
    videos,
    roomPlans,
    location: resolvePropertyLocation(rec),
    tags: ['Shared Housing', 'Seattle', 'Shared Living'],
    ...financials,
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
  const bathroomsList = buildBathroomsListFromRecord(rec, meta)
  const availabilitySummary = formatListingAvailabilitySummary(meta?.listingAvailabilityWindows)

  return {
    ...base,
    rent: base.rent,
    summary: userText.slice(0, 400) || base.summary,
    roomPlans,
    floorPlans: [],
    highlights: [userText.slice(0, 280), availabilitySummary].filter(Boolean),
    communityAmenities: Array.isArray(rec.Amenities) ? rec.Amenities : [],
    unitAmenities: [],
    policies: String(leasing.leaseLengthInfo || '').trim() || 'Contact Axis for lease options.',
    listingAvailabilitySummary: availabilitySummary,
    leasingPackages,
    leaseTerms: [],
    cleaningFee: '',
    petsPolicy: String(rec[PROPERTY_AIR.pets] ?? rec.Pets ?? '').trim(),
    guestPolicy: String(leasing.guestPolicy || '').trim(),
    additionalLeaseTerms: String(leasing.additionalLeaseTerms || '').trim(),
    houseRules: String(leasing.houseRules || '').trim(),
    sharedSpacesList,
    bathroomsList,
  }
}

import { parseAxisListingMetaBlock } from './axisListingMeta.js'
import { partitionRoomListingFields } from './listingRoomDisplay.js'

function trimStr(value) {
  return String(value || '').trim()
}

function moneyLabelFromCents(cents) {
  const n = Number(cents)
  if (!Number.isFinite(n) || n <= 0) return ''
  return `$${Math.round(n / 100).toLocaleString('en-US')}/month`
}

function availabilityDisplay(detail) {
  const row = detail && typeof detail === 'object' ? detail : {}
  if (row.unavailable === true || trimStr(row.availability).toLowerCase() === 'unavailable') {
    return 'Currently unavailable'
  }
  const explicit = trimStr(row.availability)
  return explicit || 'Available now'
}

function computeBathCount(meta, rooms) {
  const explicit = Number(meta?.bathroomTotalDecimal)
  if (Number.isFinite(explicit) && explicit > 0) return explicit
  const detailCount = Array.isArray(meta?.bathroomsDetail) ? meta.bathroomsDetail.length : 0
  if (detailCount > 0) return detailCount
  return rooms.length > 0 ? 1 : 0
}

function groupRoomPlans(rooms, meta) {
  const roomDetails = Array.isArray(meta?.roomsDetail) ? meta.roomsDetail : []
  const normalizedRooms = (rooms || []).map((room, index) => {
    const detail = roomDetails[index] && typeof roomDetails[index] === 'object' ? roomDetails[index] : {}
    const price = moneyLabelFromCents(room.monthly_rent_cents) || 'Contact for pricing'
    const listingFields = partitionRoomListingFields(detail)
    return {
      name: trimStr(detail.label) || trimStr(room.name) || `Room ${index + 1}`,
      price,
      available: availabilityDisplay(detail),
      bathroomSetup: listingFields.bathroomSetup || undefined,
      featureTags: listingFields.featureTags || [],
      details: listingFields.bathroomSetup || undefined,
      images: (room.images || []).map((row) => trimStr(row.public_url)).filter(Boolean),
    }
  })

  const byPrice = new Map()
  for (const room of normalizedRooms) {
    const key = room.price || 'Contact for pricing'
    if (!byPrice.has(key)) byPrice.set(key, [])
    byPrice.get(key).push(room)
  }

  return [...byPrice.entries()].map(([priceRange, groupedRooms]) => ({
    title: groupedRooms.length === 1 ? groupedRooms[0].name : `${groupedRooms.length} rooms`,
    priceRange,
    summary:
      groupedRooms.length > 1
        ? groupedRooms
            .map((room) => room.name)
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
            .join(', ')
        : '',
    roomsAvailable: groupedRooms.filter((room) => !String(room.available || '').toLowerCase().includes('unavailable')).length,
    rooms: groupedRooms,
  }))
}

function computeRentLabel(rooms) {
  const amounts = (rooms || [])
    .map((room) => Number(room?.monthly_rent_cents))
    .filter((value) => Number.isFinite(value) && value > 0)
    .map((value) => Math.round(value / 100))
  if (!amounts.length) return ''
  const min = Math.min(...amounts)
  const max = Math.max(...amounts)
  if (min === max) return `$${min.toLocaleString('en-US')}/month`
  return `$${min.toLocaleString('en-US')}–$${max.toLocaleString('en-US')}/month`
}

function buildSharedSpaces(meta) {
  const rows = Array.isArray(meta?.sharedSpacesDetail) ? meta.sharedSpacesDetail : []
  return rows
    .map((row, index) => {
      const item = row && typeof row === 'object' ? row : {}
      const images = Array.isArray(item.imageUrls) ? item.imageUrls.map(trimStr).filter(Boolean) : []
      return {
        title: trimStr(item.title) || `Shared space ${index + 1}`,
        description: trimStr(item.description || item.notes) || 'Shared common area',
        accessLabel: trimStr(item.accessLabel),
        images,
        videos: [],
      }
    })
    .filter((row) => row.title || row.description || row.images.length)
}

function buildBathrooms(meta) {
  const rows = Array.isArray(meta?.bathroomsDetail) ? meta.bathroomsDetail : []
  return rows
    .map((row, index) => {
      const item = row && typeof row === 'object' ? row : {}
      const images = Array.isArray(item.imageUrls) ? item.imageUrls.map(trimStr).filter(Boolean) : []
      return {
        title: trimStr(item.title || item.label) || `Bathroom ${index + 1}`,
        description: trimStr(item.description || item.notes) || 'Bathroom',
        accessLabel: trimStr(item.accessLabel),
        images,
        videos: [],
      }
    })
    .filter((row) => row.title || row.description || row.images.length)
}

function buildAddress(property) {
  const cityStateZip = [property.city, property.state, property.zip].map(trimStr).filter(Boolean).join(', ')
  return [property.address_line1, property.address_line2, cityStateZip].map(trimStr).filter(Boolean).join(', ')
}

export function mapInternalListingToHomeProperty(listing) {
  const property = listing?.property && typeof listing.property === 'object' ? listing.property : {}
  const rooms = Array.isArray(listing?.rooms) ? listing.rooms : []
  const { userText, meta } = parseAxisListingMetaBlock(trimStr(property.notes))
  const roomPlans = groupRoomPlans(rooms, meta)
  return {
    slug: trimStr(listing?.slug) || `axis-${trimStr(property.id)}`,
    name: trimStr(property.name) || 'Axis listing',
    address: buildAddress(property) || 'Seattle, WA',
    neighborhood: 'Seattle',
    type: 'Shared housing',
    beds: rooms.length || 1,
    baths: computeBathCount(meta, rooms) || 1,
    rent: computeRentLabel(rooms),
    summary: userText.slice(0, 240) || 'Axis-managed shared housing in Seattle.',
    images: (listing?.property_images || []).map((row) => trimStr(row.public_url)).filter(Boolean),
    videos: [],
    roomPlans,
    location: { lat: 47.661, lng: -122.318 },
    tags: ['Shared Housing', 'Seattle', 'Shared Living'],
    _fromAirtable: false,
    _fromInternalPostgres: true,
    internalPropertyId: trimStr(property.id),
  }
}

export function mapInternalListingToPropertyPage(listing) {
  const base = mapInternalListingToHomeProperty(listing)
  const property = listing?.property && typeof listing.property === 'object' ? listing.property : {}
  const { userText, meta } = parseAxisListingMetaBlock(trimStr(property.notes))
  return {
    ...base,
    summary: userText.slice(0, 400) || base.summary,
    highlights: [userText.slice(0, 280)].filter(Boolean),
    floorPlans: [],
    communityAmenities: [],
    unitAmenities: [],
    policies: 'Contact Axis for lease options.',
    leaseTerms: [],
    leasingPackages: [],
    cleaningFee: '',
    sharedSpacesList: buildSharedSpaces(meta),
    bathroomsList: buildBathrooms(meta),
  }
}

export async function fetchInternalPublicListings() {
  const res = await fetch('/api/public-listings')
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || `Could not load public listings (${res.status}).`)
  return Array.isArray(json?.listings) ? json.listings : []
}

export async function fetchInternalPublicListingById(propertyId) {
  const id = trimStr(propertyId)
  if (!id) return null
  const res = await fetch(`/api/public-listings?property_id=${encodeURIComponent(id)}`)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || `Could not load listing (${res.status}).`)
  return json?.listing || null
}

/** When a legacy URL used `axis-rec…`, resolve via `properties.legacy_airtable_record_id` on the server. */
export async function fetchInternalPublicListingByLegacyAirtableId(recordId) {
  const id = trimStr(recordId)
  if (!id) return null
  const res = await fetch(`/api/public-listings?legacy_airtable_record_id=${encodeURIComponent(id)}`)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || `Could not load listing (${res.status}).`)
  return json?.listing || null
}

/**
 * Airtable field map for Manager Portal "Add Property".
 * Field names match the live Properties table EXACTLY — do not change without
 * updating the Airtable base first.
 */

import { mergeAxisListingMetaIntoOtherInfo } from './axisListingMeta.js'
import { parseAxisListingMetaBlock } from './axisListingMeta.js'

// ─── Slot limits ────────────────────────────────────────────────────────────────
export const MAX_ROOM_SLOTS = 20
export const MAX_BATHROOM_SLOTS = 10
export const MAX_KITCHEN_SLOTS = 3
export const MAX_SHARED_SPACE_SLOTS = 13
export const MAX_LAUNDRY_SLOTS = 5
/** Property-level marketing windows (Basics step) — stored in axis meta `listingAvailabilityWindows`. */
export const MAX_LISTING_AVAILABILITY_WINDOWS = 8
// Rooms Sharing Bathroom only exists for bathrooms 1–5 in Airtable
export const MAX_BATHROOM_SHARING_SLOTS = 5

/**
 * Properties table — keys under axisMeta.leasing in Other Info JSON.
 * Use these exact strings so data matches Airtable field names (and optional native columns).
 */
export const PROPERTIES_LEASING_META_KEYS = {
  fullHousePrice: 'Full House Price',
  promotionalFullHousePrice: 'Promotional Full House Price',
  leaseLengthInformation: 'Lease Length Information',
  /** Array of bundle rows; each row uses PROPERTIES_LEASING_PACKAGE_KEYS. */
  leasingPackages: 'Leasing Packages',
}

/**
 * Properties-oriented keys for each object inside `Leasing Packages` (bundling).
 */
export const PROPERTIES_LEASING_PACKAGE_KEYS = {
  bundleName: 'Bundle Name',
  bundleMonthlyRent: 'Bundle Monthly Rent',
  /** string[] e.g. ["Room 1","Room 2"] — same labels as wizard chips */
  bundleRoomsIncluded: 'Bundle Rooms Included',
}

// ─── Static field names ──────────────────────────────────────────────────────────
export const PROPERTY_AIR = {
  propertyName:       'Property Name',      // primary field (was "Name" — wrong)
  address:            'Address',
  roomCount:          'Room Count',
  propertyType:       'Property Type',      // Single select (was "Housing Type")
  bathroomCount:      'Bathroom Count',
  bathroomAccess:     'Bathroom Access',
  kitchenCount:       'Kitchen Count',
  amenities:          'Amenities',          // Multiple select → send as string[]
  managerProfile:     'Manager Profile',    // Linked record (was "Manager")
  pets:               'Pets',              // Single select
  applicationFee:     'Application Fee',
  laundry:            'Laundry',            // Checkbox
  parking:            'Parking',            // Checkbox
  roomsSharingLaundry:'Rooms Sharing Laundry',
  parkingType:        'Parking Type',
  parkingFee:         'Parking Fee',
  approved:           'Approved',           // Checkbox
  approvalStatus:     'Approval Status',    // Single line text
  otherInfo:          'Other Info',         // Long text
  sharedSpaceCount:   'Number of Shared Spaces',
  /** Optional: add these columns to Properties in Airtable, or remove writes below if missing. */
  securityDeposit:    'Security Deposit',
  /** Checkbox: when cleared (false), property stays approved but hides from public marketing / tour lists. */
  listed:             'Listed',
  /**
   * Long text — admin “request edits” notes shown to the manager. Add this column to Properties in Airtable.
   * Override with VITE_AIRTABLE_PROPERTY_EDIT_REQUEST_FIELD if your base uses a different name.
   */
  adminEditRequest:   'Admin Edit Request',
  /** Leasing / bundling — optional native Properties columns (see VITE_AIRTABLE_WRITE_LEASING_COLUMNS). */
  fullHousePrice: PROPERTIES_LEASING_META_KEYS.fullHousePrice,
  promotionalFullHousePrice: PROPERTIES_LEASING_META_KEYS.promotionalFullHousePrice,
  leaseLengthInformation: PROPERTIES_LEASING_META_KEYS.leaseLengthInformation,
}

/** Airtable long-text field for manager-visible edit-request notes (same as PROPERTY_AIR.adminEditRequest by default). */
export const PROPERTY_EDIT_REQUEST_FIELD =
  String(import.meta.env.VITE_AIRTABLE_PROPERTY_EDIT_REQUEST_FIELD || PROPERTY_AIR.adminEditRequest).trim() ||
  'Admin Edit Request'

// ─── Dynamic room fields (1–20) ──────────────────────────────────────────────────
/** @param {number} n 1-based */
export const roomRentField = (n) =>
  n >= 1 && n <= MAX_ROOM_SLOTS ? `Room ${n} Rent` : null
export const roomAvailabilityField = (n) => `Room ${n} Availability`   // Date
export const roomFurnishedField    = (n) => `Room ${n} Furnished`       // Single select: Yes/No/Partial
export const roomUtilitiesCostField= (n) => `Room ${n} Utilities Cost`
/** Only Room 1 has a "Utilities" long-text field */
export const ROOM_1_UTILITIES_FIELD = 'Room 1 Utilities'

// ─── Dynamic bathroom fields ─────────────────────────────────────────────────────
export const bathroomDescriptionField = (n) => `Bathroom ${n}`             // Long text, 1–10
/** Only bathrooms 1–5 have a "Rooms Sharing" field in Airtable */
export const bathroomRoomsSharingField = (n) => `Rooms Sharing Bathroom ${n}` // 1–5 only

// ─── Dynamic kitchen fields ──────────────────────────────────────────────────────
export const kitchenDescriptionField  = (n) => `Kitchen ${n}`
export const kitchenRoomsSharingField = (n) => `Rooms Sharing Kitchen ${n}`

// ─── Dynamic laundry fields (up to 5 laundry locations) ─────────────────────────
export const laundryTypeField         = (n) => `Laundry ${n} Type`
export const laundryRoomsSharingField = (n) => `Rooms Sharing Laundry ${n}`

// ─── Dynamic shared space fields ─────────────────────────────────────────────────
export const sharedSpaceNameField   = (n) => `Shared Space ${n} Name`
export const sharedSpaceTypeField   = (n) => `Shared Space ${n} Type`
export const sharedSpaceAccessField = (n) => `Access to Shared Space ${n}` // Multiple select

// ─── Amenity options for the form (Multiple select) ──────────────────────────────
export const AMENITY_OPTIONS = [
  'Wi-Fi', 'Parking', 'Laundry', 'Air Conditioning', 'Heating', 'Dishwasher',
  'Gym', 'Pool', 'Backyard', 'Balcony', 'Elevator', 'Storage', 'Bike Storage',
  'EV Charging', 'Furnished Common Areas', 'Cleaning Service', 'Security System',
  'Pet-Friendly', 'Rooftop', 'Game Room', 'Study Room',
]

// ─── Pet options (Single select) ─────────────────────────────────────────────────
export const PET_OPTIONS = ['Allowed', 'Not Allowed', 'Case by Case', 'Cats Only', 'Small Dogs OK']

// ─── Furnished options (Single select) ──────────────────────────────────────────
export const FURNISHED_OPTIONS = ['Yes', 'No', 'Partial']

// ─── Property type options (Single select) ───────────────────────────────────────
export const PROPERTY_TYPE_OPTIONS = ['House', 'Apartment', 'Townhome', 'Studio', 'Condo', 'Other']

// ─── Shared space type options ────────────────────────────────────────────────────
export const SHARED_SPACE_TYPE_OPTIONS = [
  'Living Room', 'Dining Room', 'Lounge', 'Study Area',
  'Kitchen', 'Laundry', 'Backyard', 'Patio', 'Storage', 'Other',
]

/** Manager wizard: bathroom card “Type” dropdown (stored with label + notes in Bathroom N). */
export const BATHROOM_TYPE_OPTIONS = [
  'Full bath', 'Three-quarter bath', 'Half bath', 'Powder room', 'Shared', 'En suite', 'Other',
]

/** Manager wizard: kitchen card “Type” dropdown (stored with label + notes in Kitchen N). */
export const KITCHEN_TYPE_OPTIONS = [
  'Full kitchen', 'Kitchenette', 'Galley', 'Shared kitchen', 'Eat-in kitchen', 'Other',
]

// ─── Helpers ────────────────────────────────────────────────────────────────────
export function clampInt(v, min, max) {
  const n = Math.floor(Number(v))
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

export function emptyRoomRow() {
  return {
    label: '',
    rent: '',
    availability: '',
    unavailable: false,
    furnished: '',
    utilitiesCost: '',
    utilities: '',
    notes: '',
    /** Bathroom / access only — not mixed with furniture (stored in axis meta `roomsDetail`). */
    bathroomSetup: '',
    furnitureIncluded: '',
    additionalFeatures: '',
    media: [],
  }
}

export function emptyBathroomRow() {
  return { label: '', kind: '', description: '', access: [] }
}

export function emptyKitchenRow() {
  return { label: '', kind: '', description: '', access: [] }
}

/** When a room row is removed, renumber `Room N` chip selections on other steps. */
export function adjustRoomAccessLabels(accessArr, removedZeroBased) {
  if (!Array.isArray(accessArr)) return []
  const removedN = removedZeroBased + 1
  const out = []
  for (const r of accessArr) {
    if (typeof r !== 'string') continue
    const m = /^Room (\d+)$/.exec(r.trim())
    if (!m) continue
    const n = parseInt(m[1], 10)
    if (n === removedN) continue
    out.push(n > removedN ? `Room ${n - 1}` : r.trim())
  }
  return [...new Set(out)]
}

export function emptyLaundryRow() {
  return { type: '', access: [] }
}

export function emptySharedSpaceRow() {
  return { name: '', type: '', typeOther: '', description: '', access: [] }
}

export function emptyListingAvailabilityWindow() {
  return { start: '', end: '', openEnded: false }
}

function sharedSpaceRowHasContent(row) {
  if (!row || typeof row !== 'object') return false
  if (String(row.name || '').trim()) return true
  if (String(row.type || '').trim()) return true
  if (String(row.typeOther || '').trim()) return true
  if (String(row.description || '').trim()) return true
  const acc = Array.isArray(row.access) ? row.access.filter(Boolean) : []
  return acc.length > 0
}

function optionalCurrency(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return undefined
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0) return undefined
  return n
}

function toIsoDate(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return undefined
  // already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return undefined
  return d.toISOString().slice(0, 10)
}

function normalizeListingAvailabilityWindowFromMeta(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const start = toIsoDate(r.start) || String(r.start || '').trim()
  const endNorm = toIsoDate(r.end) || String(r.end || '').trim()
  const openEnded = r.openEnded === true || (Boolean(start) && !endNorm)
  return {
    start,
    end: openEnded ? '' : endNorm,
    openEnded,
  }
}

function boolFromRaw(v) {
  return v === true || v === 1 || v === '1' || String(v || '').trim().toLowerCase() === 'true'
}

function normalizeRoomAccessLabel(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  const m = /^room\s*(\d+)$/i.exec(s)
  if (m) return `Room ${m[1]}`
  return s
}

export function splitRoomAccess(raw) {
  if (Array.isArray(raw)) {
    return [...new Set(raw.map(normalizeRoomAccessLabel).filter(Boolean))]
  }
  const s = String(raw || '').trim()
  if (!s) return []
  return [...new Set(s.split(',').map((part) => normalizeRoomAccessLabel(part)).filter(Boolean))]
}

export function parseBodyTriplet(raw) {
  const parts = String(raw || '')
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
  return {
    kind: parts[0] || '',
    label: parts[1] || '',
    description: parts.slice(2).join('\n\n'),
  }
}

/**
 * Sum bath equivalents from manager wizard rows (full ≈ 1, half / powder ≈ 0.5).
 * @param {{ kind?: string, label?: string, description?: string }[]} bathrooms
 */
function bathroomKindToWeight(kindRaw) {
  const k = String(kindRaw || '').trim().toLowerCase()
  if (!k) return 1
  if (/\bpowder\b/.test(k) || /\bhalf\b/.test(k)) return 0.5
  return 1
}

export function computeDecimalBathroomTotal(bathrooms) {
  const rows = Array.isArray(bathrooms) ? bathrooms : []
  let sum = 0
  let any = false
  for (const row of rows) {
    const kind = String(row?.kind || '').trim().toLowerCase()
    const hasBody =
      kind ||
      String(row?.label || '').trim() ||
      String(row?.description || '').trim() ||
      (Array.isArray(row?.access) && row.access.length > 0)
    if (!hasBody) continue
    any = true
    sum += bathroomKindToWeight(kind)
  }
  return any ? sum : 0
}

/**
 * Same as {@link computeDecimalBathroomTotal} using saved Airtable `Bathroom N` bodies.
 * @param {Record<string, unknown>} record
 */
export function computeDecimalBathroomTotalFromAirtableRecord(record) {
  const rec = record && typeof record === 'object' ? record : {}
  const bc = clampInt(rec[PROPERTY_AIR.bathroomCount] ?? 0, 0, MAX_BATHROOM_SLOTS)
  let sum = 0
  let any = false
  for (let i = 1; i <= bc; i++) {
    const parsed = parseBodyTriplet(rec[bathroomDescriptionField(i)])
    const kind = String(parsed.kind || '').trim().toLowerCase()
    const hasBody = kind || String(parsed.label || '').trim() || String(parsed.description || '').trim()
    if (!hasBody) continue
    any = true
    sum += bathroomKindToWeight(kind)
  }
  return any ? sum : 0
}

function stringOrEmpty(v) {
  return String(v ?? '').trim()
}

/**
 * Convert a Properties Airtable record into AddPropertyWizard-compatible initial state.
 */
export function buildPropertyWizardInitialValues(property) {
  const record = property && typeof property === 'object' ? property : {}
  const { userText, meta } = parseAxisListingMetaBlock(String(record[PROPERTY_AIR.otherInfo] || ''))
  const leasingNorm = normalizeLeasingFromMeta(meta?.leasing)
  const roomDetails = Array.isArray(meta?.roomsDetail) ? meta.roomsDetail : []

  const fallbackRoomCount = roomDetails.length > 0 ? roomDetails.length : 1
  const roomCount = clampInt(record[PROPERTY_AIR.roomCount] ?? fallbackRoomCount, 1, MAX_ROOM_SLOTS)
  const rooms = Array.from({ length: roomCount }, (_, idx) => {
    const n = idx + 1
    const detail = roomDetails[idx] && typeof roomDetails[idx] === 'object' ? roomDetails[idx] : {}
    const availabilityRaw =
      detail.availability ??
      record[roomAvailabilityField(n)] ??
      ''
    const unavailable =
      detail.unavailable === true ||
      String(availabilityRaw || '').trim().toLowerCase() === 'unavailable'
    return {
      ...emptyRoomRow(),
      label: stringOrEmpty(detail.label),
      rent: stringOrEmpty(detail.rent || record[roomRentField(n)] || record[`Room ${n} for Rent`]),
      availability: unavailable ? '' : stringOrEmpty(toIsoDate(availabilityRaw) || availabilityRaw),
      unavailable,
      furnished: stringOrEmpty(detail.furnished || record[roomFurnishedField(n)]),
      utilitiesCost: stringOrEmpty(detail.utilitiesCost || record[roomUtilitiesCostField(n)]),
      utilities: stringOrEmpty(detail.utilities || (n === 1 ? record[ROOM_1_UTILITIES_FIELD] : '')),
      notes: stringOrEmpty(detail.notes),
      bathroomSetup: stringOrEmpty(detail.bathroomSetup),
      furnitureIncluded: stringOrEmpty(detail.furnitureIncluded),
      additionalFeatures: stringOrEmpty(detail.additionalFeatures),
      media: [],
    }
  })

  const bathrooms = []
  const bathroomCount = clampInt(record[PROPERTY_AIR.bathroomCount] ?? 0, 0, MAX_BATHROOM_SLOTS)
  for (let i = 1; i <= bathroomCount; i++) {
    const desc = String(record[bathroomDescriptionField(i)] || '')
    const parsed = parseBodyTriplet(desc)
    const roomsSharing = i <= MAX_BATHROOM_SHARING_SLOTS ? record[bathroomRoomsSharingField(i)] : ''
    bathrooms.push({
      ...emptyBathroomRow(),
      label: parsed.label,
      kind: parsed.kind,
      description: parsed.description,
      access: splitRoomAccess(roomsSharing),
    })
  }

  const kitchens = []
  const kitchenCount = clampInt(record[PROPERTY_AIR.kitchenCount] ?? 0, 0, MAX_KITCHEN_SLOTS)
  for (let i = 1; i <= kitchenCount; i++) {
    const desc = String(record[kitchenDescriptionField(i)] || '')
    const parsed = parseBodyTriplet(desc)
    kitchens.push({
      ...emptyKitchenRow(),
      label: parsed.label,
      kind: parsed.kind,
      description: parsed.description,
      access: splitRoomAccess(record[kitchenRoomsSharingField(i)]),
    })
  }

  const sharedSpaces = []
  const sharedCount = clampInt(record[PROPERTY_AIR.sharedSpaceCount] ?? 0, 0, MAX_SHARED_SPACE_SLOTS)
  const sharedMetaRows = Array.isArray(meta?.sharedSpacesDetail) ? meta.sharedSpacesDetail : []
  for (let i = 1; i <= sharedCount; i++) {
    const type = stringOrEmpty(record[sharedSpaceTypeField(i)])
    const metaRow = sharedMetaRows[i - 1] && typeof sharedMetaRows[i - 1] === 'object' ? sharedMetaRows[i - 1] : {}
    sharedSpaces.push({
      ...emptySharedSpaceRow(),
      name: stringOrEmpty(record[sharedSpaceNameField(i)]),
      type: SHARED_SPACE_TYPE_OPTIONS.includes(type) ? type : type ? 'Other' : '',
      typeOther: SHARED_SPACE_TYPE_OPTIONS.includes(type) ? '' : type,
      description: stringOrEmpty(metaRow.description || metaRow.notes),
      access: splitRoomAccess(record[sharedSpaceAccessField(i)]),
    })
  }

  const laundryRows = []
  for (let i = 1; i <= MAX_LAUNDRY_SLOTS; i++) {
    const type = stringOrEmpty(record[laundryTypeField(i)])
    const access = splitRoomAccess(record[laundryRoomsSharingField(i)])
    if (!type && !access.length) continue
    laundryRows.push({ type, access })
  }
  const laundryEnabled = boolFromRaw(record[PROPERTY_AIR.laundry]) || laundryRows.length > 0
  const parkingEnabled = boolFromRaw(record[PROPERTY_AIR.parking])

  const rawAmenities = Array.isArray(record[PROPERTY_AIR.amenities])
    ? record[PROPERTY_AIR.amenities]
    : stringOrEmpty(record[PROPERTY_AIR.amenities]).split(',').map((part) => part.trim()).filter(Boolean)
  const amenities = rawAmenities.filter((item) => AMENITY_OPTIONS.includes(item))
  const amenitiesOther = rawAmenities.filter((item) => !AMENITY_OPTIONS.includes(item)).join(', ')

  const rawPropertyType = stringOrEmpty(record[PROPERTY_AIR.propertyType])
  const propertyTypeOther = stringOrEmpty(meta?.propertyTypeOther)
  const propertyType = PROPERTY_TYPE_OPTIONS.includes(rawPropertyType)
    ? rawPropertyType
    : rawPropertyType || propertyTypeOther
      ? 'Other'
      : ''

  const listingAvailabilityWindows = Array.isArray(meta?.listingAvailabilityWindows)
    ? meta.listingAvailabilityWindows
        .map(normalizeListingAvailabilityWindowFromMeta)
        .filter((w) => String(w.start || '').trim())
    : []

  return {
    basics: {
      name: stringOrEmpty(record[PROPERTY_AIR.propertyName] || record.Name),
      address: stringOrEmpty(record[PROPERTY_AIR.address]),
      propertyType,
      propertyTypeOther: propertyType === 'Other' ? (propertyTypeOther || rawPropertyType) : '',
      amenities,
      amenitiesOther,
      pets: stringOrEmpty(record[PROPERTY_AIR.pets]),
      securityDeposit: String(
        record[PROPERTY_AIR.securityDeposit] ?? meta?.financials?.securityDeposit ?? '',
      ),
      moveInCharges: String(meta?.financials?.moveInCharges ?? ''),
      listingAvailabilityWindows,
    },
    appFee: String(record[PROPERTY_AIR.applicationFee] ?? ''),
    rooms,
    bathrooms,
    kitchens,
    sharedSpaces,
    laundry: {
      enabled: laundryEnabled,
      rows: laundryRows,
      generalAccess: splitRoomAccess(record[PROPERTY_AIR.roomsSharingLaundry]),
    },
    parking: {
      enabled: parkingEnabled,
      type: stringOrEmpty(record[PROPERTY_AIR.parkingType]),
      fee: String(record[PROPERTY_AIR.parkingFee] ?? ''),
    },
    otherInfo: userText,
    leasing: {
      fullHousePrice: stringOrEmpty(
        record[PROPERTY_AIR.fullHousePrice] != null && String(record[PROPERTY_AIR.fullHousePrice]).trim() !== ''
          ? String(record[PROPERTY_AIR.fullHousePrice])
          : leasingNorm.fullHousePrice,
      ),
      promoPrice: stringOrEmpty(
        record[PROPERTY_AIR.promotionalFullHousePrice] != null &&
          String(record[PROPERTY_AIR.promotionalFullHousePrice]).trim() !== ''
          ? String(record[PROPERTY_AIR.promotionalFullHousePrice])
          : leasingNorm.promoPrice,
      ),
      leaseLengthInfo: stringOrEmpty(
        record[PROPERTY_AIR.leaseLengthInformation] != null &&
          String(record[PROPERTY_AIR.leaseLengthInformation]).trim() !== ''
          ? String(record[PROPERTY_AIR.leaseLengthInformation])
          : leasingNorm.leaseLengthInfo,
      ),
      bundles: Array.isArray(leasingNorm.bundles)
        ? leasingNorm.bundles.map((bundle) => ({
            name: String(bundle.name || ''),
            price: String(bundle.price || ''),
            rooms: Array.isArray(bundle.rooms) ? bundle.rooms.filter(Boolean) : [],
          }))
        : [],
    },
  }
}

/**
 * Read `leasing` from parsed axis meta (Other Info JSON).
 * Supports current Properties field names and legacy camelCase keys.
 * @returns {{ fullHousePrice: string, promoPrice: string, leaseLengthInfo: string, bundles: { name: string, price: string, rooms: string[] }[] }}
 */
export function normalizeLeasingFromMeta(leasing) {
  const L = leasing && typeof leasing === 'object' ? leasing : {}
  const MK = PROPERTIES_LEASING_META_KEYS
  const PK = PROPERTIES_LEASING_PACKAGE_KEYS
  const pick = (airKey, legacy) => String(L[airKey] ?? L[legacy] ?? '').trim()
  const rawPackages = L[MK.leasingPackages] ?? L.bundles ?? []
  const arr = Array.isArray(rawPackages) ? rawPackages : []
  const bundles = arr
    .map((row) => {
      const r = row && typeof row === 'object' ? row : {}
      const name = String(r[PK.bundleName] ?? r.name ?? '').trim()
      const price = String(r[PK.bundleMonthlyRent] ?? r.price ?? '').trim()
      const ri = r[PK.bundleRoomsIncluded] ?? r.rooms
      const rooms = Array.isArray(ri) ? ri.filter(Boolean) : []
      return { name, price, rooms }
    })
    .filter((b) => b.name || b.price || b.rooms.length)
  return {
    fullHousePrice: pick(MK.fullHousePrice, 'fullHousePrice'),
    promoPrice: pick(MK.promotionalFullHousePrice, 'promoPrice'),
    leaseLengthInfo: pick(MK.leaseLengthInformation, 'leaseLengthInfo'),
    bundles,
  }
}

/**
 * Build the flat fields object to POST to Airtable Properties table.
 * Only sends fields that have a non-empty value to avoid UNKNOWN_FIELD_NAME errors
 * and to keep the record clean.
 */
export function serializeManagerAddPropertyToAirtableFields(params) {
  const {
    basics,          // { name, address, propertyType, propertyTypeOther?, amenities[], amenitiesOther?, pets, securityDeposit, moveInCharges, listingAvailabilityWindows? }
    roomCount,
    bathroomCount,
    kitchenCount,
    parking,         // { enabled, type, fee }
    laundry,         // { enabled, generalAccess?, roomsSharing?, rows: [{ type, access[], roomsSharing? }] }
    rooms,           // room row shape from emptyRoomRow() (media stripped before call)
    bathrooms,       // [{ label?, kind?, description?, access[] }]
    kitchens,        // [{ label?, kind?, description?, access[] }]
    sharedSpaces = [],// [{ name, type, typeOther?, access[] }]
    applicationFee = '',
    otherInfo = '',
    managerRecordId,
    leasing = null,   // wizard shape; serialized to meta using PROPERTIES_LEASING_* keys
  } = params

  const rc = clampInt(roomCount, 1, MAX_ROOM_SLOTS)
  const bc = clampInt(bathroomCount, 0, MAX_BATHROOM_SLOTS)
  const kc = clampInt(kitchenCount, 0, MAX_KITCHEN_SLOTS)

  /**
   * Native Properties columns (`Room N Rent`, `Room N Availability`, leasing $ fields) —
   * **on by default** so housing data lives in typed fields, not only Other Info JSON.
   * Set `VITE_AIRTABLE_WRITE_ROOM_COLUMNS=false` or `VITE_AIRTABLE_WRITE_LEASING_COLUMNS=false` if your base omits those columns.
   */
  const writeRoomColumnsEnv = String(
    typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_AIRTABLE_WRITE_ROOM_COLUMNS
      ? import.meta.env.VITE_AIRTABLE_WRITE_ROOM_COLUMNS
      : '',
  ).toLowerCase()
  const writeRoomColumns =
    writeRoomColumnsEnv === '0' || writeRoomColumnsEnv === 'false' || writeRoomColumnsEnv === 'no' ? false : true

  const writeLeasingColumnsEnv = String(
    typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_AIRTABLE_WRITE_LEASING_COLUMNS
      ? import.meta.env.VITE_AIRTABLE_WRITE_LEASING_COLUMNS
      : '',
  ).toLowerCase()
  const writeLeasingColumns =
    writeLeasingColumnsEnv === '0' || writeLeasingColumnsEnv === 'false' || writeLeasingColumnsEnv === 'no'
      ? false
      : true

  let sharedTrimmed = (sharedSpaces || []).slice(0, MAX_SHARED_SPACE_SLOTS)
  while (sharedTrimmed.length > 0 && !sharedSpaceRowHasContent(sharedTrimmed[sharedTrimmed.length - 1])) {
    sharedTrimmed = sharedTrimmed.slice(0, -1)
  }
  const sc = sharedTrimmed.length

  const fields = {}

  // ── Core ──────────────────────────────────────────────────────────────────────
  const name = String(basics.name || '').trim()
  if (name) fields[PROPERTY_AIR.propertyName] = name

  const address = String(basics.address || '').trim()
  if (address) fields[PROPERTY_AIR.address] = address

  fields[PROPERTY_AIR.roomCount] = rc
  fields[PROPERTY_AIR.bathroomCount] = bc
  fields[PROPERTY_AIR.kitchenCount] = kc
  fields[PROPERTY_AIR.sharedSpaceCount] = sc

  const ptRaw = String(basics.propertyType || '').trim()
  const ptOther = String(basics.propertyTypeOther || '').trim()
  const pt = ptRaw === 'Other' && ptOther ? ptOther : ptRaw
  if (pt) fields[PROPERTY_AIR.propertyType] = pt

  // Amenities: Multiple select → send as string[] (preset checkboxes + comma/semicolon-separated "Other")
  const amenitiesArr = Array.isArray(basics.amenities)
    ? basics.amenities.filter(Boolean)
    : String(basics.amenities || '').split(',').map((s) => s.trim()).filter(Boolean)
  const otherAmenityParts = String(basics.amenitiesOther || '')
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean)
  for (const p of otherAmenityParts) {
    if (!amenitiesArr.includes(p)) amenitiesArr.push(p)
  }
  if (amenitiesArr.length) fields[PROPERTY_AIR.amenities] = amenitiesArr

  const pets = String(basics.pets || '').trim()
  if (pets) fields[PROPERTY_AIR.pets] = pets

  // Approval state — manager submissions must be reviewed by admin before listing.
  fields[PROPERTY_AIR.approved] = false
  fields[PROPERTY_AIR.approvalStatus] = 'Pending'
  fields[PROPERTY_AIR.listed] = false

  // Manager link + canonical Owner ID for multi-tenant scoping
  if (managerRecordId) {
    fields[PROPERTY_AIR.managerProfile] = [managerRecordId]
    fields['Owner ID'] = managerRecordId
  }

  // Application fee
  const af = optionalCurrency(applicationFee)
  if (af !== undefined) fields[PROPERTY_AIR.applicationFee] = af

  // Security deposit on the property record (defaults to 0 when blank)
  fields[PROPERTY_AIR.securityDeposit] = optionalCurrency(basics.securityDeposit) ?? 0

  // Bathroom Access (general field — e.g. "Shared", "Private")
  const ba = String(basics.bathroomAccess || '').trim()
  if (ba) fields[PROPERTY_AIR.bathroomAccess] = ba

  const roomsDetail = []
  // ── Rooms ─────────────────────────────────────────────────────────────────────
  for (let i = 1; i <= rc; i++) {
    const row = rooms[i - 1] || emptyRoomRow()

    if (writeRoomColumns) {
      const rentFieldName = roomRentField(i)
      if (rentFieldName) {
        const rent = optionalCurrency(row.rent)
        if (rent !== undefined) fields[rentFieldName] = rent
      }

      const avail = toIsoDate(row.availability)
      if (avail) fields[roomAvailabilityField(i)] = avail

      const furn = String(row.furnished || '').trim()
      if (furn) fields[roomFurnishedField(i)] = furn

      const uc = optionalCurrency(row.utilitiesCost)
      if (uc !== undefined) fields[roomUtilitiesCostField(i)] = uc

      if (i === 1) {
        const u1 = String(row.utilities || '').trim()
        if (u1) fields[ROOM_1_UTILITIES_FIELD] = u1
      }
    }

    if (writeRoomColumns) {
      /** Keep labels + rich text in JSON for tours/listings; rent/dates live in `Room N *` columns. */
      roomsDetail.push({
        label: String(row.label || '').trim() || `Room ${i}`,
        notes: String(row.notes || '').trim(),
        bathroomSetup: String(row.bathroomSetup || '').trim(),
        furnitureIncluded: String(row.furnitureIncluded || '').trim(),
        additionalFeatures: String(row.additionalFeatures || '').trim(),
        unavailable: Boolean(row.unavailable),
      })
    } else {
      roomsDetail.push({
        label: String(row.label || '').trim(),
        notes: String(row.notes || '').trim(),
        bathroomSetup: String(row.bathroomSetup || '').trim(),
        furnitureIncluded: String(row.furnitureIncluded || '').trim(),
        additionalFeatures: String(row.additionalFeatures || '').trim(),
        rent: String(row.rent ?? '').trim(),
        availability: row.unavailable ? 'Unavailable' : String(row.availability || '').trim(),
        unavailable: Boolean(row.unavailable),
        furnished: String(row.furnished || '').trim(),
        utilitiesCost: String(row.utilitiesCost ?? '').trim(),
        utilities: String(row.utilities || '').trim(),
      })
    }
  }

  const leasingObj = leasing && typeof leasing === 'object' ? leasing : {}
  const MK = PROPERTIES_LEASING_META_KEYS
  const PK = PROPERTIES_LEASING_PACKAGE_KEYS
  const bundles = Array.isArray(leasingObj.bundles)
    ? leasingObj.bundles
        .map((b) => ({
          name: String(b?.name || '').trim(),
          price: String(b?.price || '').trim(),
          rooms: Array.isArray(b?.rooms) ? b.rooms.filter(Boolean) : [],
        }))
        .filter((b) => b.name || b.price || b.rooms.length)
    : []

  const leasingPackagesForMeta = bundles.map((b) => ({
    [PK.bundleName]: b.name,
    [PK.bundleMonthlyRent]: b.price,
    [PK.bundleRoomsIncluded]: b.rooms,
  }))

  const rawListingWindows = Array.isArray(basics.listingAvailabilityWindows)
    ? basics.listingAvailabilityWindows
    : []
  const listingAvailabilityWindows = rawListingWindows
    .map((w) => {
      const start = toIsoDate(w?.start) || String(w?.start || '').trim()
      if (!start) return null
      const openEnded = Boolean(w?.openEnded)
      const end = openEnded ? '' : toIsoDate(w?.end) || String(w?.end || '').trim()
      if (!openEnded && !end) return null
      return { start, end }
    })
    .filter(Boolean)

  const sharedSpacesDetail = sharedTrimmed.map((row) => {
    const notes = String(row?.description || '').trim()
    return notes ? { notes, description: notes } : {}
  })
  const hasSharedSpacesMeta = sharedSpacesDetail.some((o) => o && (o.notes || o.description))

  const bathroomTotalDecimal = computeDecimalBathroomTotal(bathrooms)

  const moveInVal = optionalCurrency(basics.moveInCharges)
  const financialsMeta =
    moveInVal !== undefined && moveInVal !== 0 ? { moveInCharges: moveInVal } : null

  /** When leasing $ / copy columns exist, do not duplicate those values inside Other Info. */
  const leasingMeta = {}
  if (writeLeasingColumns) {
    if (leasingPackagesForMeta.length > 0) leasingMeta[MK.leasingPackages] = leasingPackagesForMeta
  } else {
    leasingMeta[MK.fullHousePrice] = String(leasingObj.fullHousePrice || '').trim()
    leasingMeta[MK.promotionalFullHousePrice] = String(leasingObj.promoPrice || '').trim()
    leasingMeta[MK.leaseLengthInformation] = String(leasingObj.leaseLengthInfo || '').trim()
    leasingMeta[MK.leasingPackages] = leasingPackagesForMeta
  }

  const axisMeta = {
    ...(ptRaw === 'Other' && ptOther ? { propertyTypeOther: ptOther } : {}),
    roomsDetail,
    ...(hasSharedSpacesMeta ? { sharedSpacesDetail } : {}),
    ...(bathroomTotalDecimal > 0 ? { bathroomTotalDecimal } : {}),
    ...(financialsMeta ? { financials: financialsMeta } : {}),
    ...(Object.keys(leasingMeta).length > 0 ? { leasing: leasingMeta } : {}),
    ...(listingAvailabilityWindows.length > 0 ? { listingAvailabilityWindows } : {}),
  }

  const mergedOtherInfo = mergeAxisListingMetaIntoOtherInfo(otherInfo, axisMeta)
  if (mergedOtherInfo) fields[PROPERTY_AIR.otherInfo] = mergedOtherInfo

  if (writeLeasingColumns) {
    const fhp = optionalCurrency(leasingObj.fullHousePrice)
    if (fhp !== undefined) fields[PROPERTY_AIR.fullHousePrice] = fhp
    const pfp = optionalCurrency(leasingObj.promoPrice)
    if (pfp !== undefined) fields[PROPERTY_AIR.promotionalFullHousePrice] = pfp
    const lli = String(leasingObj.leaseLengthInfo || '').trim()
    if (lli) fields[PROPERTY_AIR.leaseLengthInformation] = lli
  }

  // ── Bathrooms ─────────────────────────────────────────────────────────────────
  for (let i = 1; i <= bc; i++) {
    const row = bathrooms[i - 1] || emptyBathroomRow()
    const kind = String(row.kind || '').trim()
    const label = String(row.label || '').trim()
    const desc = String(row.description || '').trim()
    let body = [kind, label, desc].filter(Boolean).join('\n\n')
    const acc = Array.isArray(row.access) ? row.access.filter(Boolean) : []
    const rs = acc.length ? acc.join(', ') : String(row.roomsSharing || '').trim()
    if (i <= MAX_BATHROOM_SHARING_SLOTS) {
      if (rs) fields[bathroomRoomsSharingField(i)] = rs
    } else if (rs) {
      body = body ? `${body}\n\nRooms sharing: ${rs}` : `Rooms sharing: ${rs}`
    }
    if (body) fields[bathroomDescriptionField(i)] = body
  }

  // ── Kitchens ──────────────────────────────────────────────────────────────────
  for (let i = 1; i <= kc; i++) {
    const row = kitchens[i - 1] || emptyKitchenRow()
    const kind = String(row.kind || '').trim()
    const label = String(row.label || '').trim()
    const desc = String(row.description || '').trim()
    const body = [kind, label, desc].filter(Boolean).join('\n\n')
    const acc = Array.isArray(row.access) ? row.access.filter(Boolean) : []
    const rs = acc.length ? acc.join(', ') : String(row.roomsSharing || '').trim()
    if (rs) fields[kitchenRoomsSharingField(i)] = rs
    if (body) fields[kitchenDescriptionField(i)] = body
  }

  // ── Laundry ───────────────────────────────────────────────────────────────────
  const laundryRows = Array.isArray(laundry?.rows) ? laundry.rows : []
  const laundryEnabled =
    Boolean(laundry?.enabled) ||
    laundryRows.some((row) => String(row?.type || '').trim() || (Array.isArray(row?.access) && row.access.length > 0))

  if (laundryEnabled) {
    fields[PROPERTY_AIR.laundry] = true
    const genAcc = Array.isArray(laundry.generalAccess) ? laundry.generalAccess.filter(Boolean) : []
    const generalSharing =
      genAcc.length > 0
        ? genAcc.join(', ')
        : String(laundry.roomsSharing || '').trim()
    if (generalSharing) fields[PROPERTY_AIR.roomsSharingLaundry] = generalSharing
    laundryRows.slice(0, MAX_LAUNDRY_SLOTS).forEach((row, idx) => {
      const n = idx + 1
      const lt = String(row.type || '').trim()
      if (lt) fields[laundryTypeField(n)] = lt
      const acc = Array.isArray(row.access) ? row.access.filter(Boolean) : []
      const rs = acc.length > 0 ? acc.join(', ') : String(row.roomsSharing || '').trim()
      if (rs) fields[laundryRoomsSharingField(n)] = rs
    })
  }

  // ── Parking ───────────────────────────────────────────────────────────────────
  if (parking?.enabled) {
    fields[PROPERTY_AIR.parking] = true
    const pt = String(parking.type || '').trim()
    if (pt) fields[PROPERTY_AIR.parkingType] = pt
    const pf = optionalCurrency(parking.fee)
    if (pf !== undefined) fields[PROPERTY_AIR.parkingFee] = pf
  }

  // ── Shared spaces ─────────────────────────────────────────────────────────────
  for (let i = 1; i <= sc; i++) {
    const row = sharedTrimmed[i - 1] || emptySharedSpaceRow()
    const sn = String(row.name || '').trim()
    if (sn) fields[sharedSpaceNameField(i)] = sn
    let st = String(row.type || '').trim()
    if (st === 'Other') {
      const custom = String(row.typeOther || '').trim()
      st = custom || 'Other'
    }
    if (st) fields[sharedSpaceTypeField(i)] = st
    const acc = Array.isArray(row.access) ? row.access.filter(Boolean) : []
    if (acc.length) fields[sharedSpaceAccessField(i)] = acc
  }

  return fields
}

/**
 * Airtable field map for Manager Portal "Add Property".
 * Field names match the live Properties table EXACTLY — do not change without
 * updating the Airtable base first.
 */

// ─── Slot limits ────────────────────────────────────────────────────────────────
export const MAX_ROOM_SLOTS = 20
export const MAX_BATHROOM_SLOTS = 10
export const MAX_KITCHEN_SLOTS = 3
export const MAX_SHARED_SPACE_SLOTS = 3
export const MAX_LAUNDRY_SLOTS = 5
// Rooms Sharing Bathroom only exists for bathrooms 1–5 in Airtable
export const MAX_BATHROOM_SHARING_SLOTS = 5

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
}

// ─── Dynamic room fields (1–20) ──────────────────────────────────────────────────
/**
 * @param {number} n 1-based
 * NOTE: Airtable only has "Room N Rent" for rooms 10–20.
 * Rooms 1–9 are missing this field — returns null so the serializer skips them.
 * Add Room 1 Rent … Room 9 Rent to the Airtable Properties table to enable.
 */
export const roomRentField        = (n) => n >= 10 ? `Room ${n} Rent` : null
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
  'Laundry', 'Backyard', 'Patio', 'Storage', 'Hallway', 'Other',
]

// ─── Helpers ────────────────────────────────────────────────────────────────────
export function clampInt(v, min, max) {
  const n = Math.floor(Number(v))
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

export function emptyRoomRow() {
  return { rent: '', availability: '', furnished: '', utilitiesCost: '', utilities: '' }
}

export function emptyBathroomRow() {
  return { description: '', roomsSharing: '' }
}

export function emptyKitchenRow() {
  return { description: '', roomsSharing: '' }
}

export function emptyLaundryRow() {
  return { type: '', roomsSharing: '' }
}

export function emptySharedSpaceRow() {
  return { name: '', type: '', access: [] }
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

/**
 * Build the flat fields object to POST to Airtable Properties table.
 * Only sends fields that have a non-empty value to avoid UNKNOWN_FIELD_NAME errors
 * and to keep the record clean.
 */
export function serializeManagerAddPropertyToAirtableFields(params) {
  const {
    basics,          // { name, address, propertyType, amenities[], amenitiesOther?, pets }
    roomCount,
    bathroomCount,
    kitchenCount,
    sharedSpaceCount = 0,
    parking,         // { enabled, type, fee }
    laundry,         // { enabled, rows: [{ type, roomsSharing }] }
    rooms,           // [{ rent, availability, furnished, utilitiesCost, utilities }]
    bathrooms,       // [{ description, roomsSharing }]
    kitchens,        // [{ description, roomsSharing }]
    sharedSpaces = [],// [{ name, type, access[] }]
    applicationFee = '',
    otherInfo = '',
    managerRecordId,
  } = params

  const rc = clampInt(roomCount, 1, MAX_ROOM_SLOTS)
  const bc = clampInt(bathroomCount, 0, MAX_BATHROOM_SLOTS)
  const kc = clampInt(kitchenCount, 0, MAX_KITCHEN_SLOTS)
  const sc = clampInt(sharedSpaceCount, 0, MAX_SHARED_SPACE_SLOTS)

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

  const pt = String(basics.propertyType || '').trim()
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

  // Approval state
  fields[PROPERTY_AIR.approved] = false
  fields[PROPERTY_AIR.approvalStatus] = 'Pending Review'

  // Manager link
  if (managerRecordId) {
    fields[PROPERTY_AIR.managerProfile] = [managerRecordId]
  }

  // Application fee
  const af = optionalCurrency(applicationFee)
  if (af !== undefined) fields[PROPERTY_AIR.applicationFee] = af

  // Other info
  const oi = String(otherInfo || '').trim()
  if (oi) fields[PROPERTY_AIR.otherInfo] = oi

  // Bathroom Access (general field — e.g. "Shared", "Private")
  const ba = String(basics.bathroomAccess || '').trim()
  if (ba) fields[PROPERTY_AIR.bathroomAccess] = ba

  // ── Rooms ─────────────────────────────────────────────────────────────────────
  for (let i = 1; i <= rc; i++) {
    const row = rooms[i - 1] || emptyRoomRow()

    // roomRentField returns null for rooms 1–9 (field doesn't exist in Airtable yet)
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

    // Only Room 1 has the Utilities (long text) field
    if (i === 1) {
      const u1 = String(row.utilities || '').trim()
      if (u1) fields[ROOM_1_UTILITIES_FIELD] = u1
    }
  }

  // ── Bathrooms ─────────────────────────────────────────────────────────────────
  for (let i = 1; i <= bc; i++) {
    const row = bathrooms[i - 1] || emptyBathroomRow()
    const d = String(row.description || '').trim()
    if (d) fields[bathroomDescriptionField(i)] = d
    // Rooms Sharing Bathroom only exists for 1–5
    if (i <= MAX_BATHROOM_SHARING_SLOTS) {
      const rs = String(row.roomsSharing || '').trim()
      if (rs) fields[bathroomRoomsSharingField(i)] = rs
    }
  }

  // ── Kitchens ──────────────────────────────────────────────────────────────────
  for (let i = 1; i <= kc; i++) {
    const row = kitchens[i - 1] || emptyKitchenRow()
    const d = String(row.description || '').trim()
    if (d) fields[kitchenDescriptionField(i)] = d
    const rs = String(row.roomsSharing || '').trim()
    if (rs) fields[kitchenRoomsSharingField(i)] = rs
  }

  // ── Laundry ───────────────────────────────────────────────────────────────────
  if (laundry?.enabled) {
    fields[PROPERTY_AIR.laundry] = true
    const rows = Array.isArray(laundry.rows) ? laundry.rows : []
    // General "Rooms Sharing Laundry" field
    const generalSharing = String(laundry.roomsSharing || '').trim()
    if (generalSharing) fields[PROPERTY_AIR.roomsSharingLaundry] = generalSharing
    // Per-location laundry fields (up to 5)
    rows.slice(0, MAX_LAUNDRY_SLOTS).forEach((row, idx) => {
      const n = idx + 1
      const lt = String(row.type || '').trim()
      if (lt) fields[laundryTypeField(n)] = lt
      const rs = String(row.roomsSharing || '').trim()
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
    const row = sharedSpaces[i - 1] || emptySharedSpaceRow()
    const sn = String(row.name || '').trim()
    if (sn) fields[sharedSpaceNameField(i)] = sn
    const st = String(row.type || '').trim()
    if (st) fields[sharedSpaceTypeField(i)] = st
    const acc = Array.isArray(row.access) ? row.access.filter(Boolean) : []
    if (acc.length) fields[sharedSpaceAccessField(i)] = acc
  }

  return fields
}

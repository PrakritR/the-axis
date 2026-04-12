/**
 * Central Airtable field names + serializer for Manager Portal "Add property".
 * Properties table: flat Room N / Bathroom N / Kitchen N / Shared Space N columns + counts + amenities.
 */

export const MAX_ROOM_SLOTS = 20
export const MAX_BATHROOM_SLOTS = 10
export const MAX_KITCHEN_SLOTS = 3
export const MAX_SHARED_SPACE_SLOTS = 3

export const PROPERTY_AIR = {
  name: 'Name',
  address: 'Address',
  housingType: 'Housing Type',
  roomCount: 'Room Count',
  bathroomCount: 'Bathroom Count',
  kitchenCount: 'Kitchen Count',
  description: 'Description',
  amenities: 'Amenities',
  pets: 'Pets',
  laundry: 'Laundry',
  laundryType: 'Laundry Type',
  laundryDescription: 'Laundry Description',
  roomsSharingLaundry: 'Rooms Sharing Laundry',
  parking: 'Parking',
  parkingType: 'Parking Type',
  parkingFee: 'Parking Fee',
  bathroomAccess: 'Bathroom Access',
  utilitiesFee: 'Utilities Fee',
  securityDeposit: 'Security Deposit',
  applicationFee: 'Application Fee',
  notes: 'Notes',
  managerEmail: 'Manager Email',
  managerLink: 'Manager',
  approved: 'Approved',
  status: 'Status',
  sharedSpaceCount: 'Number of Shared Spaces',
  otherInfo: 'Other Info',
}

/** @param {number} n 1-based */
export function roomNameField(n) {
  return `Room ${n} Name`
}
export function roomRentField(n) {
  return `Room ${n} Rent`
}
export function roomAvailabilityField(n) {
  return `Room ${n} Availability`
}
export function roomFurnishedField(n) {
  return `Room ${n} Furnished`
}
export function roomUtilitiesDescriptionField(n) {
  return `Room ${n} Utilities Description`
}
export function roomUtilitiesCostField(n) {
  return `Room ${n} Utilities Cost`
}
export function roomNotesField(n) {
  return `Room ${n} Notes`
}

export function bathroomDescriptionField(n) {
  return `Bathroom ${n}`
}
export function bathroomRoomsSharingField(n) {
  return `Rooms Sharing Bathroom ${n}`
}

export function kitchenDescriptionField(n) {
  return `Kitchen ${n}`
}
export function kitchenRoomsSharingField(n) {
  return `Rooms Sharing Kitchen ${n}`
}

/** @param {number} n 1-based */
export function sharedSpaceNameField(n) {
  return `Shared Space ${n} Name`
}
export function sharedSpaceTypeField(n) {
  return `Shared Space ${n} Type`
}
export function sharedSpaceAccessField(n) {
  return `Access to Shared Space ${n}`
}

export function clampInt(v, min, max) {
  const n = Math.floor(Number(v))
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

export function emptyRoomRow(index1) {
  return {
    name: `Room ${index1}`,
    rent: '',
    availability: '',
    furnished: false,
    utilitiesDescription: '',
    utilitiesCost: '',
    notes: '',
  }
}

export function emptyBathroomRow() {
  return { description: '', roomsSharing: '' }
}

export function emptyKitchenRow() {
  return { description: '', roomsSharing: '' }
}

export function emptySharedSpaceRow() {
  return { name: '', type: '', access: [] }
}

function optionalNumber(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return undefined
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0) return undefined
  return n
}

function optionalCurrency(raw) {
  const n = optionalNumber(raw)
  return n
}

/**
 * @param {object} params
 * @param {object} params.basics — name, address, propertyType, description, amenities, pets, bathroomAccess
 * @param {number} params.roomCount
 * @param {number} params.bathroomCount
 * @param {number} params.kitchenCount
 * @param {number} params.sharedSpaceCount
 * @param {object} params.fees — utilitiesFee, securityDeposit, applicationFee (strings)
 * @param {object} params.laundry — enabled, type, description, roomsSharing
 * @param {object} params.parking — enabled, type, fee
 * @param {Array} params.rooms — rows from form
 * @param {Array} params.bathrooms
 * @param {Array} params.kitchens
 * @param {Array} params.sharedSpaces — rows { name, type, access[] }
 * @param {string} params.otherInfo
 * @param {string} params.managerEmail
 * @param {string} [params.managerRecordId]
 * @param {string[]} [params.photoCaptionLines] appended into Notes
 */
export function serializeManagerAddPropertyToAirtableFields(params) {
  const {
    basics,
    roomCount,
    bathroomCount,
    kitchenCount,
    sharedSpaceCount = 0,
    fees,
    laundry,
    parking,
    rooms,
    bathrooms,
    kitchens,
    sharedSpaces = [],
    otherInfo = '',
    managerEmail,
    managerRecordId,
    photoCaptionLines = [],
  } = params

  const rc = clampInt(roomCount, 1, MAX_ROOM_SLOTS)
  const bc = clampInt(bathroomCount, 0, MAX_BATHROOM_SLOTS)
  const kc = clampInt(kitchenCount, 0, MAX_KITCHEN_SLOTS)
  const sc = clampInt(sharedSpaceCount, 0, MAX_SHARED_SPACE_SLOTS)

  const fields = {}

  const name = String(basics.name || '').trim()
  const address = String(basics.address || '').trim()
  fields[PROPERTY_AIR.name] = name
  fields[PROPERTY_AIR.address] = address

  fields[PROPERTY_AIR.approved] = false
  fields[PROPERTY_AIR.status] = 'pending_review'
  fields[PROPERTY_AIR.managerEmail] = String(managerEmail || '').trim()

  if (managerRecordId) {
    fields[PROPERTY_AIR.managerLink] = [managerRecordId]
  }

  const ht = String(basics.propertyType || '').trim()
  if (ht) fields[PROPERTY_AIR.housingType] = ht

  fields[PROPERTY_AIR.roomCount] = rc
  fields[PROPERTY_AIR.bathroomCount] = bc
  fields[PROPERTY_AIR.kitchenCount] = kc
  fields[PROPERTY_AIR.sharedSpaceCount] = sc

  const desc = String(basics.description || '').trim()
  if (desc) fields[PROPERTY_AIR.description] = desc

  const am = String(basics.amenities || '').trim()
  if (am) fields[PROPERTY_AIR.amenities] = am

  const pets = String(basics.pets || '').trim()
  if (pets) fields[PROPERTY_AIR.pets] = pets

  // Blank utilities / security deposit → $0 on the record. Blank application fee → omit field (Apply uses $50 default when live).
  const uf = optionalCurrency(fees.utilitiesFee) ?? 0
  const sd = optionalCurrency(fees.securityDeposit) ?? 0
  fields[PROPERTY_AIR.utilitiesFee] = uf
  fields[PROPERTY_AIR.securityDeposit] = sd

  const af = optionalCurrency(fees.applicationFee)
  if (af !== undefined) fields[PROPERTY_AIR.applicationFee] = af

  if (laundry?.enabled) {
    fields[PROPERTY_AIR.laundry] = true
    const lt = String(laundry.type || '').trim()
    if (lt) fields[PROPERTY_AIR.laundryType] = lt
    const ld = String(laundry.description || '').trim()
    if (ld) fields[PROPERTY_AIR.laundryDescription] = ld
    const lr = String(laundry.roomsSharing || '').trim()
    if (lr) fields[PROPERTY_AIR.roomsSharingLaundry] = lr
  }

  if (parking?.enabled) {
    fields[PROPERTY_AIR.parking] = true
    const pt = String(parking.type || '').trim()
    if (pt) fields[PROPERTY_AIR.parkingType] = pt
    const pf = optionalCurrency(parking.fee)
    if (pf !== undefined) fields[PROPERTY_AIR.parkingFee] = pf
  }

  const ba = String(basics.bathroomAccess || '').trim()
  if (ba) fields[PROPERTY_AIR.bathroomAccess] = ba

  for (let i = 1; i <= rc; i++) {
    const row = rooms[i - 1] || emptyRoomRow(i)
    const rname = String(row.name || '').trim()
    if (rname) fields[roomNameField(i)] = rname

    const rent = optionalCurrency(row.rent)
    if (rent !== undefined) fields[roomRentField(i)] = rent

    const avail = String(row.availability || '').trim()
    if (avail) fields[roomAvailabilityField(i)] = avail

    if (row.furnished === true) fields[roomFurnishedField(i)] = true

    const ud = String(row.utilitiesDescription || '').trim()
    if (ud) fields[roomUtilitiesDescriptionField(i)] = ud

    const uc = optionalCurrency(row.utilitiesCost)
    if (uc !== undefined) fields[roomUtilitiesCostField(i)] = uc

    const rn = String(row.notes || '').trim()
    if (rn) fields[roomNotesField(i)] = rn
  }

  for (let i = 1; i <= bc; i++) {
    const row = bathrooms[i - 1] || emptyBathroomRow()
    const d = String(row.description || '').trim()
    if (d) fields[bathroomDescriptionField(i)] = d
    const rs = String(row.roomsSharing || '').trim()
    if (rs) fields[bathroomRoomsSharingField(i)] = rs
  }

  for (let i = 1; i <= kc; i++) {
    const row = kitchens[i - 1] || emptyKitchenRow()
    const d = String(row.description || '').trim()
    if (d) fields[kitchenDescriptionField(i)] = d
    const rs = String(row.roomsSharing || '').trim()
    if (rs) fields[kitchenRoomsSharingField(i)] = rs
  }

  for (let i = 1; i <= sc; i++) {
    const row = sharedSpaces[i - 1] || emptySharedSpaceRow()
    const sn = String(row.name || '').trim()
    if (sn) fields[sharedSpaceNameField(i)] = sn
    const st = String(row.type || '').trim()
    if (st) fields[sharedSpaceTypeField(i)] = st
    const acc = Array.isArray(row.access) ? row.access.filter(Boolean) : []
    if (acc.length) fields[sharedSpaceAccessField(i)] = acc
  }

  const oi = String(otherInfo || '').trim()
  if (oi) fields[PROPERTY_AIR.otherInfo] = oi

  const noteParts = [`Submitted by: ${String(managerEmail || '').trim()}`]
  if (photoCaptionLines.length) {
    noteParts.push('Photo notes:')
    photoCaptionLines.forEach((line) => noteParts.push(line))
  }
  fields[PROPERTY_AIR.notes] = noteParts.join('\n')

  return fields
}

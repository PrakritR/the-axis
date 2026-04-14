/**
 * axis-properties.js
 * Server-side property data for lease generation.
 * Mirrors the relevant parts of frontend/src/data/properties.js but without
 * any browser / Vite / React dependencies.
 *
 * Used by generate-lease-from-template.js to auto-populate:
 *   - Monthly utility fee
 *   - Security deposit
 *   - Room rent by room number
 *   - Bathroom sharing configuration
 *   - Community amenities
 */

export const AXIS_PROPERTIES = [
  // ── 5259 Brooklyn Ave NE ────────────────────────────────────────────────────
  {
    names: ['5259 Brooklyn Ave NE', '5259 Brooklyn Ave', '5259 Brooklyn'],
    address: '5259 Brooklyn Ave NE, Seattle, WA 98105',
    utilitiesFee: 175,
    securityDeposit: 600,
    cleaningFee: 25,
    /** Omit or 0 — only appears on generated lease when set from Airtable / manager overrides */
    adminFee: 0,
    amenities: [
      'Walkable location',
      'In-unit laundry (washer & dryer)',
      'Bi-monthly professional cleaning (twice per month)',
      'High-speed Wi-Fi',
      'A/C in living room',
      'Public transportation access',
      'Refrigerator, microwave, stove, oven, dishwasher',
      'Package storage',
      'Street parking',
    ],
    rooms: [
      { number: '1', label: 'Room 1', rent: 865, bathroomGroup: 'Rooms 1 & 2', bathroomNote: 'Shares bathroom with Room 2 only (2-person bathroom)' },
      { number: '2', label: 'Room 2', rent: 865, bathroomGroup: 'Rooms 1 & 2', bathroomNote: 'Shares bathroom with Room 1 only (2-person bathroom)' },
      { number: '3', label: 'Room 3', rent: 825, bathroomGroup: 'Rooms 3, 4 & 5', bathroomNote: 'Shares bathroom with Rooms 4 and 5 (3-person bathroom)' },
      { number: '4', label: 'Room 4', rent: 825, bathroomGroup: 'Rooms 3, 4 & 5', bathroomNote: 'Shares bathroom with Rooms 3 and 5 (3-person bathroom)' },
      { number: '5', label: 'Room 5', rent: 825, bathroomGroup: 'Rooms 3, 4 & 5', bathroomNote: 'Shares bathroom with Rooms 3 and 4 (3-person bathroom)' },
      { number: '6', label: 'Room 6', rent: 800, bathroomGroup: 'Rooms 6, 7, 8 & 9', bathroomNote: 'Shares bathroom with Rooms 7, 8, and 9 (4-person bathroom)' },
      { number: '7', label: 'Room 7', rent: 800, bathroomGroup: 'Rooms 6, 7, 8 & 9', bathroomNote: 'Shares bathroom with Rooms 6, 8, and 9 (4-person bathroom)' },
      { number: '8', label: 'Room 8', rent: 800, bathroomGroup: 'Rooms 6, 7, 8 & 9', bathroomNote: 'Shares bathroom with Rooms 6, 7, and 9 (4-person bathroom)' },
      { number: '9', label: 'Room 9', rent: 800, bathroomGroup: 'Rooms 6, 7, 8 & 9', bathroomNote: 'Shares bathroom with Rooms 6, 7, and 8 (4-person bathroom)' },
    ],
  },

  // ── 4709A 8th Ave NE ────────────────────────────────────────────────────────
  {
    names: ['4709A 8th Ave', '4709A 8th Ave NE', '4709 A 8th Ave', '4709 A 8th Ave NE', '4709 A 8th Ave N'],
    address: '4709A 8th Ave NE, Seattle, WA 98105',
    utilitiesFee: 175,
    securityDeposit: 500,
    cleaningFee: 25,
    adminFee: 0,
    amenities: [
      'Walkable location',
      'In-unit laundry (washer & dryer)',
      'Bi-monthly professional cleaning (twice per month)',
      'High-speed Wi-Fi',
      'A/C in living room',
      'Public transportation access',
      'Refrigerator, microwave, stove, oven, dishwasher',
      'Street parking',
    ],
    rooms: [
      { number: '1',  label: 'Room 1',  rent: 775, bathroomNote: 'Shares bathroom with second-floor residents' },
      { number: '2',  label: 'Room 2',  rent: 775, bathroomNote: 'Shares bathroom with second-floor residents' },
      { number: '3',  label: 'Room 3',  rent: 775, bathroomNote: 'Shares bathroom with second-floor residents' },
      { number: '4',  label: 'Room 4',  rent: 775, bathroomNote: 'Shares bathroom with second-floor residents' },
      { number: '5',  label: 'Room 5',  rent: 775, bathroomNote: 'Shares bathroom with third-floor residents' },
      { number: '6',  label: 'Room 6',  rent: 775, bathroomNote: 'Shares bathroom with third-floor residents' },
      { number: '7',  label: 'Room 7',  rent: 775, bathroomNote: 'Shares bathroom with third-floor residents' },
      { number: '8',  label: 'Room 8',  rent: 775, bathroomNote: 'Shares bathroom with third-floor residents' },
      { number: '9',  label: 'Room 9',  rent: 750, bathroomNote: 'First-floor room — shared bathroom access' },
      { number: '10', label: 'Room 10', rent: 875, bathroomNote: 'Private bathroom' },
    ],
  },

  // ── 4709B 8th Ave NE ────────────────────────────────────────────────────────
  {
    names: ['4709B 8th Ave', '4709B 8th Ave NE', '4709 B 8th Ave', '4709 B 8th Ave NE'],
    address: '4709B 8th Ave NE, Seattle, WA 98105',
    utilitiesFee: 175,
    securityDeposit: 500,
    cleaningFee: 25,
    adminFee: 0,
    amenities: [
      'Walkable location',
      'In-unit laundry (washer & dryer)',
      'Bi-monthly professional cleaning (twice per month)',
      'High-speed Wi-Fi',
      'A/C in living room',
      'Public transportation access',
      'Refrigerator, microwave, stove, oven, dishwasher',
      'Street parking',
    ],
    rooms: [
      { number: '1', label: 'Room 1', rent: 775, bathroomNote: 'First-floor room — shares bathroom access with second floor' },
      { number: '2', label: 'Room 2', rent: 800, bathroomNote: 'Shares bathroom with second-floor residents' },
      { number: '3', label: 'Room 3', rent: 800, bathroomNote: 'Shares bathroom with second-floor residents' },
      { number: '4', label: 'Room 4', rent: 800, bathroomNote: 'Shares bathroom with second-floor residents' },
      { number: '5', label: 'Room 5', rent: 800, bathroomNote: 'Shares bathroom with second-floor residents' },
      { number: '6', label: 'Room 6', rent: 800, bathroomNote: 'Shares bathroom with third-floor residents' },
      { number: '7', label: 'Room 7', rent: 800, bathroomNote: 'Shares bathroom with third-floor residents' },
      { number: '8', label: 'Room 8', rent: 800, bathroomNote: 'Shares bathroom with third-floor residents' },
      { number: '9', label: 'Room 9', rent: 800, bathroomNote: 'Shares bathroom with third-floor residents' },
    ],
  },
]

// ── Lookup helpers ────────────────────────────────────────────────────────────

function normalizePropertyName(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function normalizeRoomNumber(s) {
  // "Room 2" → "2", "2" → "2"
  return String(s || '').trim().replace(/^room\s*/i, '').trim()
}

/** Find a property by name (case-insensitive, partial match against aliases). */
export function findProperty(propertyName) {
  const query = normalizePropertyName(propertyName)
  if (!query) return null
  for (const prop of AXIS_PROPERTIES) {
    for (const n of prop.names) {
      if (normalizePropertyName(n) === query) return prop
    }
  }
  // Partial / contains match as fallback
  for (const prop of AXIS_PROPERTIES) {
    for (const n of prop.names) {
      if (normalizePropertyName(n).includes(query) || query.includes(normalizePropertyName(n))) return prop
    }
  }
  return null
}

/** Get the room data object from a property. */
export function findRoom(property, roomNumber) {
  if (!property || !roomNumber) return null
  const n = normalizeRoomNumber(roomNumber)
  return property.rooms.find((r) => r.number === n) ?? null
}

/**
 * Resolve all lease-relevant financial + descriptive data for a given property+room.
 * Overrides win over defaults.
 *
 * @param {string} propertyName
 * @param {string} roomNumber  e.g. "2" or "Room 2"
 * @param {object} overrides   { rent?, utilitiesFee?, deposit?, adminFee? }
 * @returns {{ rent, utilitiesFee, securityDeposit, adminFee, bathroomNote, bathroomGroup, amenities, propertyAddress }}
 */
export function resolveLeaseDetails(propertyName, roomNumber, overrides = {}) {
  const prop = findProperty(propertyName)
  const room = prop ? findRoom(prop, roomNumber) : null

  const rent =
    (overrides.rent != null && overrides.rent !== '' ? parseFloat(overrides.rent) || 0 : null) ??
    room?.rent ??
    0

  const utilitiesFee =
    (overrides.utilitiesFee != null && overrides.utilitiesFee !== '' ? parseFloat(overrides.utilitiesFee) : null) ??
    prop?.utilitiesFee ??
    0

  const securityDeposit =
    (overrides.deposit != null && overrides.deposit !== '' ? parseFloat(overrides.deposit) : null) ??
    prop?.securityDeposit ??
    0

  const adminFee =
    (overrides.adminFee != null && overrides.adminFee !== '' ? parseFloat(overrides.adminFee) : null) ??
    prop?.adminFee ??
    0

  return {
    rent,
    utilitiesFee,
    securityDeposit,
    adminFee,
    bathroomNote: room?.bathroomNote ?? '',
    bathroomGroup: room?.bathroomGroup ?? '',
    amenities: prop?.amenities ?? [],
    propertyAddress: prop?.address ?? '',
  }
}

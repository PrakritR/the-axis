// Only bundle image types. A dynamic `new URL(\`../../Assets/${path}\`, import.meta.url)` makes Vite
// glob the entire Assets tree (including multi‑GB .MOV files), which breaks Vercel deploy limits.
// Each `import.meta.glob` must use a string literal (Vite does not allow a variable pattern).
const assetUrlByKey = {
  ...import.meta.glob('../../Assets/**/*.avif', { eager: true, query: '?url', import: 'default' }),
  ...import.meta.glob('../../Assets/**/*.jpeg', { eager: true, query: '?url', import: 'default' }),
  ...import.meta.glob('../../Assets/**/*.jpg', { eager: true, query: '?url', import: 'default' }),
  ...import.meta.glob('../../Assets/**/*.png', { eager: true, query: '?url', import: 'default' }),
  ...import.meta.glob('../../Assets/**/*.svg', { eager: true, query: '?url', import: 'default' }),
  ...import.meta.glob('../../Assets/**/*.webp', { eager: true, query: '?url', import: 'default' }),
}

function asset(path) {
  const key = `../../Assets/${path}`
  const url = assetUrlByKey[key]
  if (url === undefined) {
    // Warn instead of crash — a missing image should never white-screen the app.
    // Root cause: if Assets/ is excluded from the build environment (e.g. via
    // .vercelignore), import.meta.glob returns {} and every lookup misses.
    if (import.meta.env.DEV) {
      console.warn(`[properties] Asset not found: ${path}`)
    }
    return ''
  }
  return url
}

const assets = (...paths) => paths.map(asset)

const SHARED_TAGS = ['Shared Housing', 'Seattle', 'Shared Living']
const SHARED_COMMUNITY_AMENITIES = [
  'Walkable Location',
  'In-Unit Laundry (Washer & Dryer)',
  'Bi-monthly Cleaning (Twice a Month)',
  'WiFi',
  'A/C in Living Room Only',
  'Public Transportation',
  'Refrigerator',
  'Microwave',
  'Stove',
  'Oven',
  'Dishwasher',
]
const STANDARD_UNIT_AMENITIES = ['Desk', 'Bed', 'Heating', 'AC']
// Tour videos omitted for now (re-add property.videos + room clips later).

const roomPlaceholder = (name, price, available, details) => ({
  name,
  price,
  available,
  ...(details ? { details } : {}),
  videoPlaceholder: true,
  videoPlaceholderText: `${name} tour coming soon.`,
})

const leaseTerms = ({
  summerRent = '$775/month',
  academicRent = '$800/month',
  fullYearRent = academicRent,
  summerNote,
  academicNote,
  fullYearNote,
}) => [
  {
    type: '3-Month',
    badge: 'Short stay',
    startingAt: summerRent,
    moveInLabel: 'Any start date',
    targetTenant: 'Summer interns & short-term residents',
    note: summerNote || 'Any 3-month window — you pick the start and end date that works for you.',
    flexibleMoveIn: true,
  },
  {
    type: '9-Month',
    badge: 'Most common',
    featured: true,
    startingAt: academicRent,
    moveInLabel: 'Any start date',
    targetTenant: 'Longer-stay residents',
    note: academicNote || 'Any 9-month window — choose the dates that fit your schedule.',
    flexibleMoveIn: true,
  },
  {
    type: '12-Month',
    badge: 'Full-year',
    startingAt: fullYearRent,
    moveInLabel: 'Any start date',
    targetTenant: 'Full-year residents',
    note: fullYearNote || 'Full year with any start date — we work around your timeline.',
    flexibleMoveIn: true,
  },
  {
    type: 'Custom / Month-to-Month',
    badge: 'Contact us',
    custom: true,
    moveInLabel: 'Discuss with leasing',
    targetTenant: 'Non-standard timelines',
    note: 'Need a different length or a rolling month-to-month arrangement? Reach out and we can work something out. Month-to-month leases typically carry an additional +$25/month charge.',
  },
]

export const properties = [
  {
    slug: '4709a-8th-ave',
    name: '4709A 8th Ave',
    address: '4709A 8th Ave NE, Seattle, WA',
    neighborhood: 'Seattle',
    type: 'Shared housing',
    beds: 10,
    baths: 3.5,
    rent: '$750-875/month',
    summary:
      'Seattle shared housing with common areas, a practical three-floor layout, in-unit laundry, and a mix of private and shared bathroom access.',
    images: assets(
      '4709a/1.avif',
      '4709a/2.jpeg',
      '4709a/3.avif',
      '4709a/5.avif',
      '4709a/7.avif',
      '4709a/9.avif',
      '4709a/IMG_6732.jpg',
      '4709a/IMG_6737.jpg',
      '4709a/IMG_7341.jpg',
      '4709a/IMG_7797.jpg',
      '4709a/IMG_7799.jpg',
      '4709a/IMG_7883.jpg',
      '4709a/IMG_7932.jpg',
      '4709a/IMG_7943.jpg',
    ),
    videos: [],
    location: { lat: 47.6633083, lng: -122.3196714 },
    tags: SHARED_TAGS,
    floorPlans: [
      {
        title: 'First Floor - Room 10',
        sqft: '250 sqft',
        units: ['Room 10'],
        images: [asset('genMid.8_1.jpg')],
        info: ['Price range: $875/month', 'Private bathroom'],
      },
      {
        title: 'First Floor - Room 9',
        sqft: '230 sqft',
        units: ['Room 9'],
        images: [asset('3_1.jpg')],
        info: ['Price range: $750/month'],
      },
      {
        title: 'Second Floor',
        sqft: '180 sqft (per bedroom)',
        units: ['Room 1', 'Room 2', 'Room 3', 'Room 4'],
        images: [asset('6_1.svg')],
        info: ['Shared facilities: Washer/Dryer on this floor', 'Price range: $775/month'],
      },
      {
        title: 'Third Floor',
        sqft: '180 sqft (per bedroom)',
        units: ['Room 5', 'Room 6', 'Room 7', 'Room 8'],
        images: [asset('0_1.png')],
        info: ['Shared facilities: Common study area', 'Price range: $775/month'],
      },
    ],
    highlights: [
      'Three-story townhouse with a larger shared layout, common living areas, and a full kitchen on the first floor.',
      'In-unit washer and dryer to simplify everyday chores.',
      'Walkable Seattle location with transit, groceries, and daily essentials nearby.',
    ],
    communityAmenities: [...SHARED_COMMUNITY_AMENITIES, 'Street Parking'],
    unitAmenities: STANDARD_UNIT_AMENITIES,
    policies: 'Three lease options available: 3-Month, 9-Month, and 12-Month. All start and end dates are flexible — you choose the window that works for you.',
    applicationFee: '$50',
    cleaningFee: '$25',
    utilitiesFee: '$175',
    leaseTerms: leaseTerms({
      summerRent: '$750/month',
      academicRent: '$775/month',
      summerNote: 'A short summer lease that runs from June 16 through September 14. Dates are fixed.',
      academicNote: 'A fixed 9-month lease option for renters who want a longer stay.',
      fullYearNote: 'The one-year option. Start date is flexible. Non-standard start dates carry a +$25/month surcharge.',
    }),
    leasingPackages: [
      {
        title: 'Second Floor Rental',
        rooms: ['Room 1', 'Room 2', 'Room 3', 'Room 4'],
        totalRent: '$3,100/month',
        details: 'Lease the full second floor together. Utilities are not included.',
      },
      {
        title: 'Third Floor Rental',
        rooms: ['Room 5', 'Room 6', 'Room 7', 'Room 8'],
        totalRent: '$3,100/month',
        details: 'Lease the full third floor together. Utilities are not included.',
      },
    ],
    roomPlans: [
      {
        title: 'First Floor - Room 10',
        priceRange: '$875/month',
        roomsAvailable: 1,
        rooms: [roomPlaceholder('Room 10', '$875/month', 'Available after August 10, 2026', 'Private bathroom')],
      },
      {
        title: 'First Floor - Room 9',
        priceRange: '$750/month',
        roomsAvailable: 1,
        rooms: [roomPlaceholder('Room 9', '$750/month', 'Available after September 1, 2026')],
      },
      {
        title: 'Second Floor',
        priceRange: '$775/month',
        roomsAvailable: 3,
        rooms: [
          roomPlaceholder('Room 1', '$775/month', 'Available after January 1, 2027'),
          roomPlaceholder('Room 2', '$775/month', 'Available after September 5, 2026'),
          roomPlaceholder('Room 3', '$775/month', 'Unavailable'),
          roomPlaceholder('Room 4', '$775/month', 'Available after September 1, 2026'),
        ],
      },
      {
        title: 'Third Floor',
        priceRange: '$775/month',
        roomsAvailable: 1,
        rooms: [
          roomPlaceholder('Room 5', '$775/month', 'Unavailable'),
          roomPlaceholder('Room 6', '$775/month', 'Unavailable'),
          roomPlaceholder('Room 7', '$775/month', 'Unavailable'),
          roomPlaceholder('Room 8', '$775/month', 'Available after August 8, 2026'),
        ],
      },
    ],
  },
  {
    slug: '4709b-8th-ave',
    name: '4709B 8th Ave',
    address: '4709B 8th Ave NE, Seattle, WA',
    neighborhood: 'Seattle',
    type: 'Shared housing',
    beds: 9,
    baths: 2.5,
    rent: '$775-$800/month',
    summary:
      'Seattle shared housing with common areas, a practical multi-floor layout, in-unit laundry, and furnished bedrooms in a walkable area.',
    images: assets(
      '4709b/06e59718-a50b-4fe8-838d-eb1726ef9770.jpeg',
      '4709b/29fae5e4-f522-4572-919e-694873d904fb.jpeg',
      '4709b/36d70827-0362-4990-9fc3-5377838efc87.jpeg',
      '4709b/38caf4ee-2ba3-4c11-85a8-6979d971926c.jpeg',
      '4709b/455ea282-df0d-4e85-8bf8-a10a34717277.jpeg',
      '4709b/4a92e5de-ec2a-4fe6-9636-2b1b9e3c3890.jpeg',
      '4709b/5ed0476a-9ae1-40db-a59a-f5c9dfc42fa4.jpeg',
      '4709b/6fa43671-9a25-4d21-964e-3ff811007ad9.jpeg',
      '4709b/71906a6e-8711-4339-bbc9-b5d8bad5d237.jpeg',
      '4709b/737e14ae-567e-4a43-9235-02ee1b8554e1.jpeg',
      '4709b/ababe505-e0f3-4eb4-8008-d4b90ce13481.jpeg',
      '4709b/afe40fa0-34f8-4149-8cd4-7e872e0b4fe1.jpeg',
      '4709b/b1829fb9-599c-4989-9915-6cff928d8467.jpeg',
      '4709b/bb84854f-d50a-45e0-ad93-5baff932aae9.jpeg',
      '4709b/cb326c22-72d9-45a0-bb9e-18ce06dbbcb9.jpeg',
      '4709b/ee63571d-6e4b-4e1f-b0b6-4ffb9d041596.jpeg',
    ),
    videos: [],
    location: { lat: 47.6633083, lng: -122.3196714 },
    tags: SHARED_TAGS,
    floorPlans: [
      {
        title: 'First Floor',
        sqft: '180 sqft (per bedroom)',
        units: ['Room 1'],
        images: [asset('3_1.jpg')],
        info: ['Shared facilities: Entry-level bedroom access', 'Price range: $775/month'],
      },
      {
        title: 'Second Floor',
        sqft: '180 sqft (per bedroom)',
        units: ['Room 2', 'Room 3', 'Room 4', 'Room 5'],
        images: [asset('6_1.svg')],
        info: ['Shared facilities: Washer/Dryer on this floor', 'Price range: $800/month'],
      },
      {
        title: 'Third Floor',
        sqft: '180 sqft (per bedroom)',
        units: ['Room 6', 'Room 7', 'Room 8', 'Room 9'],
        images: [asset('0_1.png')],
        info: ['Shared facilities: Common study area', 'Price range: $800/month'],
      },
    ],
    highlights: [
      'Spacious multi-floor townhouse with a practical shared setup and comfortable common spaces.',
      'In-unit washer and dryer to simplify everyday chores.',
      'Walkable Seattle location with transit, groceries, and daily essentials nearby.',
    ],
    communityAmenities: [...SHARED_COMMUNITY_AMENITIES, 'Street Parking'],
    unitAmenities: STANDARD_UNIT_AMENITIES,
    policies: 'Three lease options available: 3-Month, 9-Month, and 12-Month. All start and end dates are flexible — you choose the window that works for you.',
    applicationFee: '$50',
    cleaningFee: '$25',
    utilitiesFee: '$175',
    leaseTerms: leaseTerms({
      summerRent: '$800/month',
      academicRent: '$800/month',
      summerNote: 'A short summer lease that runs from June 16 through September 14. Dates are fixed.',
      academicNote: 'A fixed 9-month lease option for renters who want a longer stay.',
      fullYearNote: 'The one-year option. Start date is flexible. Non-standard start dates carry a +$25/month surcharge.',
    }),
    leasingPackages: [
      {
        title: 'Second Floor Rental',
        rooms: ['Room 2', 'Room 3', 'Room 4', 'Room 5'],
        totalRent: '$3,200/month',
        details: 'Lease the full second floor together. Utilities are not included.',
      },
      {
        title: 'Third Floor Rental',
        rooms: ['Room 6', 'Room 7', 'Room 8', 'Room 9'],
        totalRent: '$3,200/month',
        details: 'Lease the full third floor together. Utilities are not included.',
      },
    ],
    roomPlans: [
      {
        title: 'First Floor',
        priceRange: '$775/month',
        roomsAvailable: 1,
        rooms: [roomPlaceholder('Room 1', '$775/month', 'Available now', 'Shares bathroom with the second floor as well')],
      },
      {
        title: 'Second Floor',
        priceRange: '$800/month',
        roomsAvailable: 4,
        rooms: [
          roomPlaceholder('Room 2', '$800/month', 'Available now'),
          roomPlaceholder('Room 3', '$800/month', 'Available now'),
          roomPlaceholder('Room 4', '$800/month', 'Available now'),
          roomPlaceholder('Room 5', '$800/month', 'Available now'),
        ],
      },
      {
        title: 'Third Floor',
        priceRange: '$800/month',
        roomsAvailable: 4,
        rooms: [
          roomPlaceholder('Room 6', '$800/month', 'Available now'),
          roomPlaceholder('Room 7', '$800/month', 'Available now'),
          roomPlaceholder('Room 8', '$800/month', 'Available now'),
          roomPlaceholder('Room 9', '$800/month', 'Available now'),
        ],
      },
    ],
  },
  {
    slug: '5259-brooklyn-ave-ne',
    name: '5259 Brooklyn Ave NE',
    address: '5259 Brooklyn Ave NE, Seattle, WA',
    neighborhood: 'Seattle',
    type: 'Shared housing',
    beds: 9,
    baths: 3,
    rent: '$800-$865/month',
    summary:
      'Seattle shared housing with a practical multi-floor layout, grouped room options, in-unit laundry, and everyday essentials nearby.',
    images: assets(
      'genMid.2486418_32_0.jpg',
      '5269 house pics/IMG_8333.jpg',
      '5269 house pics/IMG_8335.jpg',
      '5269 house pics/IMG_8336.jpg',
      '5269 house pics/IMG_8360.jpg',
      '5269 house pics/IMG_8347.jpg',
      '5269 house pics/IMG_8323.jpg',
      '5269 house pics/IMG_8338.jpg',
      '5269 house pics/IMG_8342.jpg',
      '5269 house pics/IMG_8352.jpg',
      '5269 house pics/IMG_8353.jpg',
      '5269 house pics/IMG_8355.jpg',
      '5269 house pics/IMG_8365.jpg',
      '5269 house pics/IMG_6930.jpg',
      '5269 house pics/IMG_6929.jpg',
      '5269 house pics/IMG_6928.jpg',
      '5269 house pics/IMG_6922.jpg',
    ),
    videos: [],
    location: { lat: 47.6681351, lng: -122.3144917 },
    tags: ['Shared Housing', 'Shared Living', 'Seattle'],
    floorPlans: [
      {
        title: '2-Bedroom Share',
        units: ['Room 1', 'Room 2'],
        images: [asset('5269 house pics/IMG_8333.jpg')],
      },
      {
        title: '3-Bedroom Share',
        units: ['Room 3', 'Room 4', 'Room 5'],
        images: assets('5269 house pics/IMG_8335.jpg', '5269 house pics/IMG_8336.jpg'),
      },
      {
        title: '4-Bedroom Share',
        units: ['Room 6', 'Room 7', 'Room 8', 'Room 9'],
        images: [asset('5269 house pics/IMG_8347.jpg')],
      },
    ],
    highlights: ['Modern kitchen', 'Flexible shared layout', 'In-unit laundry', 'Seattle location'],
    communityAmenities: [...SHARED_COMMUNITY_AMENITIES, 'Package Storage', 'Street Parking'],
    unitAmenities: ['Desk', 'Bed', 'Heating'],
    policies: 'Three lease options available: 3-Month, 9-Month, and 12-Month. All start and end dates are flexible — you choose the window that works for you.',
    leaseTerms: leaseTerms({
      summerRent: '$800/month',
      academicRent: '$800/month',
      summerNote: 'A summer lease that runs from June 16 through September 14. Dates are fixed.',
      academicNote: 'A standard 9-month lease option with fixed dates.',
      fullYearNote: 'The one-year option. Start date is flexible. Non-standard start dates carry a +$25/month surcharge.',
    }),
    applicationFee: '$50',
    cleaningFee: '$25',
    utilitiesFee: '$175',
    securityDeposit: '$600',
    leasingPackages: [
      {
        title: 'Rooms 1 + 2 Rental',
        rooms: ['Room 1', 'Room 2'],
        totalRent: '$1,730/month',
        details: 'Lease Rooms 1 and 2 together as a shared package. Utilities are not included.',
      },
      {
        title: 'Rooms 3-5 Rental',
        rooms: ['Room 3', 'Room 4', 'Room 5'],
        totalRent: '$2,475/month',
        details: 'Lease Rooms 3, 4, and 5 together as a grouped second-floor package. Utilities are not included.',
      },
      {
        title: 'Rooms 6-9 Rental',
        rooms: ['Room 6', 'Room 7', 'Room 8', 'Room 9'],
        totalRent: '$3,200/month',
        details: 'Lease Rooms 6, 7, 8, and 9 together as a third-floor package. Utilities are not included.',
      },
    ],
    roomPlans: [
      {
        title: '2-Bedroom Share (Rooms 1 & 2)',
        priceRange: '$865/month',
        roomsAvailable: 2,
        rooms: [
          roomPlaceholder('Room 1', '$865/month', 'Available after April 10, 2026', 'Shares bathroom with Room 2'),
          roomPlaceholder('Room 2', '$865/month', 'Available after April 10, 2026', 'Shares bathroom with Room 1'),
        ],
      },
      {
        title: '3-Bedroom Share (Rooms 3, 4 & 5)',
        priceRange: '$825/month',
        roomsAvailable: 3,
        rooms: [
          roomPlaceholder('Room 3', '$825/month', 'Available April 10, 2026-May 15, 2026 and after August 14, 2026', 'Shares bathroom with Rooms 4 and 5'),
          roomPlaceholder('Room 4', '$825/month', 'Available April 10, 2026-May 15, 2026 and after August 14, 2026', 'Shares bathroom with Rooms 3 and 5'),
          roomPlaceholder('Room 5', '$825/month', 'Available after April 10, 2026', 'Shares bathroom with Rooms 3 and 4'),
        ],
      },
      {
        title: '4-Bedroom Share (Rooms 6, 7, 8 & 9)',
        priceRange: '$800/month',
        roomsAvailable: 4,
        rooms: [
          roomPlaceholder('Room 6', '$800/month', 'Available after April 10, 2026', 'Shares bathroom with Rooms 7, 8, and 9'),
          roomPlaceholder('Room 7', '$800/month', 'Available after April 10, 2026', 'Shares bathroom with Rooms 6, 8, and 9'),
          roomPlaceholder('Room 8', '$800/month', 'Available after April 10, 2026', 'Shares bathroom with Rooms 6, 7, and 9'),
          roomPlaceholder('Room 9', '$800/month', 'Available after April 10, 2026', 'Shares bathroom with Rooms 6, 7, and 8'),
        ],
      },
    ],
  },
]

import { parseAxisListingMetaBlock } from './axisListingMeta.js'

/** URL slug for an approved Airtable property (stable, unique). */
export function marketingSlugForAirtablePropertyId(recordId) {
  const id = String(recordId || '').trim()
  if (!/^rec[a-zA-Z0-9]{14,}$/.test(id)) return ''
  return `axis-${id}`
}

export function mapAirtableRecordToHomeProperty(rec) {
  const photos = Array.isArray(rec?.Photos) ? rec.Photos : []
  const urls = photos.map((a) => (typeof a === 'string' ? a : a?.url)).filter(Boolean)
  const name = String(rec['Property Name'] || rec.Name || 'Axis listing').trim()
  const slug = marketingSlugForAirtablePropertyId(rec.id)
  const beds = Number(rec['Room Count']) || 0
  const baths = Number(rec['Bathroom Count']) || 0
  const { userText } = parseAxisListingMetaBlock(String(rec['Other Info'] || ''))
  const summary = userText.slice(0, 240) || 'Axis-managed shared housing in Seattle.'
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
    videos: [],
    location: { lat: 47.65, lng: -122.32 },
    _fromAirtable: true,
    airtableRecordId: rec.id,
  }
}

export function mapAirtableRecordToPropertyPage(rec) {
  const base = mapAirtableRecordToHomeProperty(rec)
  const { userText, meta } = parseAxisListingMetaBlock(String(rec['Other Info'] || ''))
  const leasing = meta?.leasing || {}
  const fullHouse = String(leasing.fullHousePrice || '').replace(/[^\d.]/g, '')
  const promo = String(leasing.promoPrice || '').replace(/[^\d.]/g, '')
  const rentHint =
    fullHouse && promo
      ? `$${Number(promo).toLocaleString('en-US')}–$${Number(fullHouse).toLocaleString('en-US')}/month`
      : fullHouse
        ? `$${Number(fullHouse).toLocaleString('en-US')}/month`
        : base.rent
  const leasingPackages = (leasing.bundles || [])
    .map((b) => {
      const title = String(b.name || '').trim() || 'Package'
      const rooms = Array.isArray(b.rooms) ? b.rooms : []
      let n = String(b.price || '').replace(/\$/g, '').replace(/,/g, '').trim()
      const totalRent = n && !Number.isNaN(Number(n)) ? `$${Number(n).toLocaleString('en-US')}/month` : String(b.price || '').trim()
      return { title, rooms, totalRent, details: '' }
    })
    .filter((b) => b.title || b.totalRent || b.rooms.length)

  return {
    ...base,
    rent: rentHint,
    summary: userText.slice(0, 400) || base.summary,
    roomPlans: [],
    floorPlans: [],
    highlights: [userText.slice(0, 280)].filter(Boolean),
    communityAmenities: Array.isArray(rec.Amenities) ? rec.Amenities : [],
    unitAmenities: [],
    policies: String(leasing.leaseLengthInfo || '').trim() || 'Contact Axis for lease options.',
    applicationFee: '$50',
    leasingPackages,
    leaseTerms: [],
    cleaningFee: '',
    utilitiesFee: '',
    securityDeposit: String(rec['Security Deposit'] != null ? rec['Security Deposit'] : '$500'),
    sharedSpacesList: [
      { title: 'Living area', description: 'Shared common space.' },
      { title: 'Kitchen', description: 'Shared kitchen.' },
      { title: 'Laundry', description: 'Shared laundry.' },
    ],
  }
}

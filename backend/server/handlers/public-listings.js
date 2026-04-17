import { requireServiceClient } from '../lib/app-users-service.js'
import {
  getPropertyById,
  getPropertyByLegacyAirtableRecordId,
  listPublicMarketingProperties,
} from '../lib/properties-service.js'
import { listRoomsByProperty } from '../lib/rooms-service.js'
import { createPublicStorageUrl } from '../lib/storage/supabase-storage-service.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function withPublicUrl(row) {
  if (!row?.storage_bucket || !row?.storage_path) return { ...row, public_url: '' }
  try {
    const { publicUrl } = createPublicStorageUrl({ bucket: row.storage_bucket, path: row.storage_path })
    return { ...row, public_url: publicUrl }
  } catch {
    return { ...row, public_url: '' }
  }
}

function normalizePropertyAddress(property) {
  return [property.address_line1, property.address_line2, property.city, property.state, property.zip]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
}

async function fetchListingPayload(property) {
  const client = requireServiceClient()
  const propertyId = String(property?.id || '').trim()
  if (!propertyId) return null

  const [rooms, propertyImagesResult] = await Promise.all([
    listRoomsByProperty({ propertyId, activeOnly: true }),
    client.from('property_images').select('*').eq('property_id', propertyId).order('sort_order', { ascending: true }),
  ])

  if (propertyImagesResult.error) {
    throw new Error(propertyImagesResult.error.message || 'Failed to load property images.')
  }

  const roomPayload = []
  for (const room of rooms || []) {
    const roomId = String(room?.id || '').trim()
    if (!roomId) continue
    const { data, error } = await client
      .from('room_images')
      .select('*')
      .eq('room_id', roomId)
      .order('sort_order', { ascending: true })
    if (error) throw new Error(error.message || 'Failed to load room images.')
    roomPayload.push({
      ...room,
      images: (data || []).map(withPublicUrl),
    })
  }

  return {
    id: propertyId,
    slug: `axis-${propertyId}`,
    property: {
      ...property,
      address_parts: normalizePropertyAddress(property),
    },
    property_images: (propertyImagesResult.data || []).map(withPublicUrl),
    rooms: roomPayload,
  }
}

export default async function handler(req, res) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const propertyId = String(req.query?.property_id || req.query?.propertyId || '').trim()
  const legacyAirtableId = String(req.query?.legacy_airtable_record_id || '').trim()

  try {
    if (propertyId) {
      if (!UUID_RE.test(propertyId)) {
        return res.status(400).json({ error: 'property_id must be a UUID.' })
      }
      const property = await getPropertyById(propertyId)
      if (!property || property.active !== true || String(property.listing_status || '') !== 'live') {
        return res.status(404).json({ error: 'Listing not found.' })
      }
      const listing = await fetchListingPayload(property)
      return res.status(200).json({ ok: true, listing })
    }

    if (legacyAirtableId) {
      const property = await getPropertyByLegacyAirtableRecordId(legacyAirtableId)
      if (!property || property.active !== true || String(property.listing_status || '') !== 'live') {
        return res.status(404).json({ error: 'Listing not found.' })
      }
      const listing = await fetchListingPayload(property)
      return res.status(200).json({ ok: true, listing })
    }

    const properties = await listPublicMarketingProperties()
    const listings = (await Promise.all((properties || []).map(fetchListingPayload))).filter(Boolean)
    return res.status(200).json({ ok: true, listings })
  } catch (err) {
    console.error('[public-listings]', err)
    return res.status(500).json({ error: err?.message || 'Failed to load public listings.' })
  }
}

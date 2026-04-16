/**
 * GET /api/listing-public-media?property_id=<uuid>
 *
 * Public read (no auth): returns Supabase Storage public URLs for an **active** internal property
 * so marketing / property pages can render gallery + room images without Airtable attachments.
 *
 * Only UUID `properties.id` values are accepted. Legacy Airtable listings keep using attachment reads.
 */
import { requireServiceClient } from '../lib/app-users-service.js'
import { getPropertyById } from '../lib/properties-service.js'
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

export default async function handler(req, res) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const propertyId = String(req.query?.property_id || req.query?.propertyId || '').trim()
  if (!UUID_RE.test(propertyId)) {
    return res.status(400).json({ error: 'property_id must be a UUID for internal listing media.' })
  }

  try {
    const prop = await getPropertyById(propertyId)
    if (!prop) return res.status(404).json({ error: 'Property not found.' })
    if (prop.active !== true) {
      return res.status(403).json({ error: 'Listing is not available.' })
    }

    const client = requireServiceClient()
    const { data: propImages, error: pErr } = await client
      .from('property_images')
      .select('*')
      .eq('property_id', propertyId)
      .order('sort_order', { ascending: true })
    if (pErr) throw new Error(pErr.message)

    const rooms = await listRoomsByProperty({ propertyId, activeOnly: true })
    const roomPayload = []
    for (const room of rooms || []) {
      const rid = String(room?.id || '').trim()
      if (!rid) continue
      const { data: rimgs, error: rErr } = await client
        .from('room_images')
        .select('*')
        .eq('room_id', rid)
        .order('sort_order', { ascending: true })
      if (rErr) throw new Error(rErr.message)
      roomPayload.push({
        room_id: rid,
        name: String(room.name || '').trim(),
        images: (rimgs || []).map(withPublicUrl),
      })
    }

    return res.status(200).json({
      ok: true,
      property: {
        id: prop.id,
        name: String(prop.name || '').trim(),
        address_line1: String(prop.address_line1 || '').trim(),
        address_line2: prop.address_line2 != null ? String(prop.address_line2).trim() : '',
        city: String(prop.city || '').trim(),
        state: String(prop.state || '').trim(),
        zip: String(prop.zip || '').trim(),
      },
      property_id: propertyId,
      property_images: (propImages || []).map(withPublicUrl),
      rooms: roomPayload,
    })
  } catch (err) {
    console.error('[listing-public-media]', err)
    return res.status(500).json({ error: err?.message || 'Failed to load listing media.' })
  }
}

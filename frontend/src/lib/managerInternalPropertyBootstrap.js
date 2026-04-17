/**
 * Internal (Postgres UUID) properties: merge with legacy Airtable rows and bootstrap manager UI.
 *
 * @module
 */

import { isInternalAxisRecordId } from './axisRecordIds.js'
import { parseAxisListingMetaBlock } from './axisListingMeta.js'
import {
  PROPERTY_AIR,
  buildPropertyWizardInitialValues,
  roomRentField,
  MAX_ROOM_SLOTS,
  MAX_BATHROOM_SLOTS,
  MAX_KITCHEN_SLOTS,
  MAX_SHARED_SPACE_SLOTS,
  MAX_LAUNDRY_SLOTS,
} from './managerPropertyFormAirtableMap.js'
import {
  mapInternalPropertyToManagerListRow,
  fetchInternalPropertyById,
  fetchInternalRoomsForProperty,
  patchInternalProperty,
  patchInternalRoom,
  parseWizardAddressForInternalApi,
} from './internalPropertiesClient.js'
import { listPropertyImages, listRoomImages } from './internalFileStorage.js'

/**
 * Merge Airtable property rows with Postgres-backed manager properties.
 * Internal UUID rows win on id collision (should not overlap with `rec…` ids).
 *
 * @param {object[]} airtableRows
 * @param {object[]} internalPostgresProperties — raw rows from GET /api/properties
 * @param {object} manager
 * @returns {object[]}
 */
export function mergeManagerPropertyListRows(airtableRows, internalPostgresProperties, manager) {
  const internalRows = (internalPostgresProperties || []).map((p) => mapInternalPropertyToManagerListRow(p, manager))
  const out = []
  const seen = new Set()
  for (const r of internalRows) {
    const id = String(r?.id || '').trim()
    if (!id) continue
    out.push(r)
    seen.add(id)
  }
  for (const r of airtableRows || []) {
    const id = String(r?.id || '').trim()
    if (!id) continue
    if (seen.has(id)) continue
    if (r.__axisInternalPostgres) continue
    if (isInternalAxisRecordId(id)) continue
    out.push(r)
  }
  return out
}

function inferMaxAxisSlotFromPhotos(photosRaw, re) {
  let max = 0
  for (const att of photosRaw || []) {
    const fn = String(att?.filename || att?.name || '').toLowerCase()
    const m = fn.match(re)
    if (m) max = Math.max(max, Number(m[1]) || 0)
  }
  return max
}

/**
 * @param {{ url: string, filename?: string, name?: string }[]} photosRawOverride
 */
export function buildPhotosRawOverrideFromInternalMedia(propertyImages, orderedRooms, photosRawOverride = []) {
  const out = [...(photosRawOverride || [])]
  for (const row of propertyImages || []) {
    const url = String(row?.public_url || '').trim()
    if (!url) continue
    const fn = String(row?.file_name || 'image').trim() || 'image'
    out.push({ url, filename: fn, name: fn })
  }
  let roomIndex = 0
  for (const room of orderedRooms || []) {
    roomIndex += 1
    const imgs = room.__images || []
    for (const row of imgs) {
      const url = String(row?.public_url || '').trim()
      if (!url) continue
      const base = String(row?.file_name || 'room.jpg').trim() || 'room.jpg'
      const synthetic = `axis-r${roomIndex}-${base}`
      out.push({ url, filename: synthetic, name: synthetic })
    }
  }
  return out
}

function formatInternalPropertySingleLineAddress(p) {
  const line2 = p.address_line2 != null && String(p.address_line2).trim() ? String(p.address_line2).trim() : ''
  const cityStateZip = [p.city, p.state, p.zip].filter(Boolean).join(' ')
  return [p.address_line1, line2, cityStateZip].filter(Boolean).join(', ')
}

/**
 * Build an Airtable-shaped record so {@link buildPropertyWizardInitialValues} can hydrate the wizard.
 *
 * @param {{
 *   property: object
 *   orderedRooms: object[]
 *   photosRawOverride: { url: string, filename?: string, name?: string }[]
 * }} args
 */
export function buildSyntheticAirtablePropertyRecordFromInternal({ property, orderedRooms, photosRawOverride }) {
  const p = property && typeof property === 'object' ? property : {}
  const addr = formatInternalPropertySingleLineAddress(p)
  const notes = String(p.notes || '')
  const { meta } = parseAxisListingMetaBlock(notes)
  const m = meta && typeof meta === 'object' ? meta : {}
  const sharedDetail = Array.isArray(m.sharedSpacesDetail) ? m.sharedSpacesDetail : []
  const kitchensDetail = Array.isArray(m.kitchensDetail) ? m.kitchensDetail : []
  const bathroomsDetail = Array.isArray(m.bathroomsDetail) ? m.bathroomsDetail : []

  const bcPhotos = inferMaxAxisSlotFromPhotos(photosRawOverride, /^axis-b(\d+)-/)
  const kcPhotos = inferMaxAxisSlotFromPhotos(photosRawOverride, /^axis-k(\d+)-/)
  const scPhotos = inferMaxAxisSlotFromPhotos(photosRawOverride, /^axis-ss(\d+)-/)
  const lcPhotos = inferMaxAxisSlotFromPhotos(photosRawOverride, /^axis-l(\d+)-/)

  const rc = Math.min(MAX_ROOM_SLOTS, Math.max(1, (orderedRooms || []).length || 1))
  const bc = Math.min(MAX_BATHROOM_SLOTS, Math.max(bathroomsDetail.length, bcPhotos))
  const kc = Math.min(MAX_KITCHEN_SLOTS, Math.max(kitchensDetail.length, kcPhotos))
  const sc = Math.min(MAX_SHARED_SPACE_SLOTS, Math.max(sharedDetail.length, scPhotos))
  const laundryRowCount = Math.min(MAX_LAUNDRY_SLOTS, lcPhotos)

  const rec = {
    id: String(p.id || '').trim(),
    Name: String(p.name || '').trim(),
    [PROPERTY_AIR.propertyName]: String(p.name || '').trim(),
    [PROPERTY_AIR.address]: addr,
    [PROPERTY_AIR.otherInfo]: notes,
    [PROPERTY_AIR.roomCount]: rc,
    [PROPERTY_AIR.bathroomCount]: bc,
    [PROPERTY_AIR.kitchenCount]: kc,
    [PROPERTY_AIR.sharedSpaceCount]: sc,
    __axisInternalPostgres: true,
    __internalPostgresProperty: p,
  }

  if (laundryRowCount > 0) {
    rec[PROPERTY_AIR.laundry] = true
  }

  let i = 1
  for (const room of orderedRooms || []) {
    if (i > MAX_ROOM_SLOTS) break
    const cents = Number(room?.monthly_rent_cents)
    const dollars = Number.isFinite(cents) && cents > 0 ? String(Math.round(cents / 100)) : ''
    rec[roomRentField(i)] = dollars
    i += 1
  }

  return rec
}

/**
 * Load internal property + rooms + signed/public image URLs and return wizard initialValues.
 *
 * @param {string} propertyId
 */
export async function buildInternalPropertyWizardInitialValues(propertyId) {
  const id = String(propertyId || '').trim()
  if (!id) throw new Error('Property id is required.')

  const property = await fetchInternalPropertyById(id)
  if (!property) throw new Error('Property not found or access denied.')

  const rooms = await fetchInternalRoomsForProperty(id)
  const propertyImages = await listPropertyImages(id, true).catch(() => [])
  const roomsWithImages = []
  for (const room of rooms) {
    const rid = String(room?.id || '').trim()
    const rim = rid ? await listRoomImages(rid, true).catch(() => []) : []
    roomsWithImages.push({ ...room, __images: rim })
  }

  const photosRawOverride = buildPhotosRawOverrideFromInternalMedia(propertyImages, roomsWithImages, [])
  const synthetic = buildSyntheticAirtablePropertyRecordFromInternal({
    property,
    orderedRooms: roomsWithImages,
    photosRawOverride,
  })

  return buildPropertyWizardInitialValues(synthetic, { photosRawOverride })
}

/**
 * Persist manager wizard edit for a Postgres property: scalar fields + notes + per-room rents.
 *
 * @param {string} propertyId
 * @param {Record<string, unknown>} fields — output of serializeManagerAddPropertyToAirtableFields
 * @param {object[]} existingRooms — same order as GET /api/rooms (created_at asc)
 */
export async function applyInternalPropertyEditFromSerializedFields(propertyId, fields, existingRooms = []) {
  const id = String(propertyId || '').trim()
  if (!id) throw new Error('Property id is required.')
  const f = fields && typeof fields === 'object' ? fields : {}

  const name = String(f[PROPERTY_AIR.propertyName] || f.Name || '').trim()
  const addrRaw = String(f[PROPERTY_AIR.address] || '').trim()
  const { address_line1, city, state, zip } = parseWizardAddressForInternalApi(addrRaw)
  const notes =
    f[PROPERTY_AIR.otherInfo] != null && typeof f[PROPERTY_AIR.otherInfo] === 'string'
      ? f[PROPERTY_AIR.otherInfo]
      : String(f[PROPERTY_AIR.otherInfo] || '')

  const patchBody = {
    address_line1,
    city,
    state,
    zip,
    notes: notes.slice(0, 20_000),
  }
  if (name) patchBody.name = name
  await patchInternalProperty(id, patchBody)

  const rooms = Array.isArray(existingRooms) ? existingRooms : []
  for (let i = 0; i < rooms.length; i++) {
    const room = rooms[i]
    const rid = String(room?.id || '').trim()
    if (!rid) continue
    const n = i + 1
    if (n > MAX_ROOM_SLOTS) break
    const rentField = roomRentField(n)
    const rentRaw = f[rentField]
    const digits = String(rentRaw ?? '').replace(/[^0-9]/g, '')
    const monthly_rent_cents = digits ? Math.min(99_000_000, Math.max(0, Math.round(Number(digits) * 100))) : 0
    await patchInternalRoom(rid, { monthly_rent_cents })
  }

  return { id, name, Address: addrRaw }
}

/**
 * rooms handler, authenticated by Supabase JWT.
 *
 * - GET  /api/rooms?property_id=<id>  — list rooms for a property
 * - POST /api/rooms                   — create room (admin/manager only), property_id in body
 * - GET  /api/rooms?id=<id>           — single room by id
 * - PATCH /api/rooms?id=<id>          — partial update (admin/manager only)
 *
 * Headers: Authorization: Bearer <supabase access_token>
 */
import { authenticateSupabaseBearerRequest } from '../lib/supabase-bearer-auth.js'
import { getAppUserByAuthUserId } from '../lib/app-users-service.js'
import { appUserHasRole } from '../lib/app-user-roles-service.js'
import { getPropertyById } from '../lib/properties-service.js'
import {
  getRoomById,
  listRoomsByProperty,
  createRoom,
  updateRoom,
  MAX_ROOM_NAME_LENGTH,
  MAX_ROOM_DESCRIPTION_LENGTH,
  MAX_ROOM_NOTES_LENGTH,
} from '../lib/rooms-service.js'

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

function optionalStringOrNull(body, key) {
  if (!(key in body)) return undefined
  const v = body[key]
  if (v === null) return null
  if (typeof v !== 'string') {
    return { error: `${key} must be a string or null when provided.` }
  }
  return v
}

async function requireAdminOrManager(appUserId) {
  const [isAdmin, isManager] = await Promise.all([
    appUserHasRole(appUserId, 'admin'),
    appUserHasRole(appUserId, 'manager'),
  ])
  return { isAdmin, isManager, allowed: isAdmin || isManager }
}

/** Verify that an admin/manager actually manages the given property (or is admin). */
async function canManageProperty(appUserId, property) {
  const isAdmin = await appUserHasRole(appUserId, 'admin')
  if (isAdmin) return true
  return property.managed_by_app_user_id === appUserId
}

export default async function handler(req, res) {
  cors(res)
  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  const auth = await authenticateSupabaseBearerRequest(req)
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error })
  }

  const appUser = await getAppUserByAuthUserId(auth.user.id)
  if (!appUser?.id) {
    return res.status(409).json({
      error: 'No internal app user yet. Call POST /api/sync-app-user with this session first.',
    })
  }

  const roomId = String(req.query?.id || '').trim() || null
  const propertyId = String(req.query?.property_id || '').trim() || null

  try {
    if (req.method === 'GET') {
      const [isAdmin, isManager, isOwner, isResident] = await Promise.all([
        appUserHasRole(appUser.id, 'admin'),
        appUserHasRole(appUser.id, 'manager'),
        appUserHasRole(appUser.id, 'owner'),
        appUserHasRole(appUser.id, 'resident'),
      ])

      if (!isAdmin && !isManager && !isOwner && !isResident) {
        return res.status(403).json({ error: 'A valid role is required to read rooms.' })
      }

      if (roomId) {
        const room = await getRoomById(roomId)
        if (!room) return res.status(404).json({ error: 'Room not found.' })

        if (!isAdmin) {
          const property = await getPropertyById(room.property_id)
          const managedByMe = property?.managed_by_app_user_id === appUser.id
          const ownedByMe = property?.owned_by_app_user_id === appUser.id
          const occupiedByMe = room.occupied_by_app_user_id === appUser.id
          if (!managedByMe && !ownedByMe && !occupiedByMe) {
            return res.status(403).json({ error: 'Access denied.' })
          }
        }

        return res.status(200).json({ ok: true, room })
      }

      if (!propertyId) {
        return res.status(400).json({ error: 'Provide either id or property_id query param.' })
      }

      const property = await getPropertyById(propertyId)
      if (!property) return res.status(404).json({ error: 'Property not found.' })

      if (!isAdmin) {
        const managedByMe = property.managed_by_app_user_id === appUser.id
        const ownedByMe = property.owned_by_app_user_id === appUser.id
        if (!managedByMe && !ownedByMe) {
          return res.status(403).json({ error: 'Access denied.' })
        }
      }

      const rooms = await listRoomsByProperty({ propertyId })
      return res.status(200).json({ ok: true, rooms })
    }

    if (req.method === 'POST') {
      const { allowed } = await requireAdminOrManager(appUser.id)
      if (!allowed) {
        return res.status(403).json({ error: 'Admin or manager role required to create rooms.' })
      }

      const body = req.body && typeof req.body === 'object' ? req.body : {}

      const pid = String(body.property_id || '').trim()
      if (!pid) {
        return res.status(400).json({ error: 'property_id is required.' })
      }

      const property = await getPropertyById(pid)
      if (!property) return res.status(404).json({ error: 'Property not found.' })

      const canManage = await canManageProperty(appUser.id, property)
      if (!canManage) {
        return res.status(403).json({ error: 'You do not manage this property.' })
      }

      if (!body.name || typeof body.name !== 'string') {
        return res.status(400).json({ error: 'name is required.' })
      }

      const args = { property_id: pid, name: body.name }

      for (const key of ['description', 'notes']) {
        const parsed = optionalStringOrNull(body, key)
        if (parsed && typeof parsed === 'object' && 'error' in parsed) {
          return res.status(400).json({ error: parsed.error })
        }
        if (parsed !== undefined) args[key] = parsed
      }

      if (body.monthly_rent_cents !== undefined) args.monthly_rent_cents = body.monthly_rent_cents
      if (body.utility_fee_cents !== undefined) args.utility_fee_cents = body.utility_fee_cents
      if ('occupied_by_app_user_id' in body) args.occupied_by_app_user_id = body.occupied_by_app_user_id || null

      const room = await createRoom(args)
      return res.status(201).json({ ok: true, room })
    }

    if (req.method === 'PATCH') {
      if (!roomId) {
        return res.status(400).json({ error: 'id query param is required for PATCH.' })
      }

      const { allowed } = await requireAdminOrManager(appUser.id)
      if (!allowed) {
        return res.status(403).json({ error: 'Admin or manager role required to update rooms.' })
      }

      const existing = await getRoomById(roomId)
      if (!existing) return res.status(404).json({ error: 'Room not found.' })

      const property = await getPropertyById(existing.property_id)
      const canManage = await canManageProperty(appUser.id, property)
      if (!canManage) {
        return res.status(403).json({ error: 'You do not manage this property.' })
      }

      const body = req.body && typeof req.body === 'object' ? req.body : {}
      const patch = { id: roomId }

      if (body.name !== undefined) {
        if (typeof body.name !== 'string') return res.status(400).json({ error: 'name must be a string.' })
        patch.name = body.name
      }

      for (const key of ['description', 'notes']) {
        const parsed = optionalStringOrNull(body, key)
        if (parsed && typeof parsed === 'object' && 'error' in parsed) {
          return res.status(400).json({ error: parsed.error })
        }
        if (parsed !== undefined) patch[key] = parsed
      }

      if (body.monthly_rent_cents !== undefined) patch.monthly_rent_cents = body.monthly_rent_cents
      if (body.utility_fee_cents !== undefined) patch.utility_fee_cents = body.utility_fee_cents
      if ('occupied_by_app_user_id' in body) patch.occupied_by_app_user_id = body.occupied_by_app_user_id || null
      if ('active' in body) patch.active = body.active

      if (Object.keys(patch).length <= 1) {
        return res.status(400).json({
          error: `Provide at least one of: name, description, monthly_rent_cents, utility_fee_cents, occupied_by_app_user_id, active, notes. Max lengths: name ${MAX_ROOM_NAME_LENGTH}, description ${MAX_ROOM_DESCRIPTION_LENGTH}, notes ${MAX_ROOM_NOTES_LENGTH}.`,
        })
      }

      const room = await updateRoom(patch)
      return res.status(200).json({ ok: true, room })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    console.error('[rooms]', err)
    const msg = err?.message || 'rooms request failed.'
    if (msg.includes('required') || msg.includes('exceeds max') || msg.includes('non-negative integer')) {
      return res.status(400).json({ error: msg })
    }
    return res.status(500).json({ error: msg })
  }
}

/**
 * properties handler, authenticated by Supabase JWT.
 *
 * - GET  /api/properties          — list properties (admin: all; manager: own; owner: own)
 * - POST /api/properties          — create property (admin/manager only)
 * - GET  /api/properties?id=<id>  — single property by id
 * - PATCH /api/properties?id=<id> — partial update (admin/manager only)
 *
 * Headers: Authorization: Bearer <supabase access_token>
 */
import { authenticateSupabaseBearerRequest } from '../lib/supabase-bearer-auth.js'
import { getAppUserByAuthUserId } from '../lib/app-users-service.js'
import { appUserHasRole } from '../lib/app-user-roles-service.js'
import {
  getPropertyById,
  listProperties,
  createProperty,
  updateProperty,
  OWNERSHIP_TYPE_VALUES,
  LISTING_STATUS_VALUES,
  MAX_PROPERTY_NAME_LENGTH,
  MAX_PROPERTY_ADDRESS_LENGTH,
  MAX_PROPERTY_CITY_LENGTH,
  MAX_PROPERTY_STATE_LENGTH,
  MAX_PROPERTY_ZIP_LENGTH,
} from '../lib/properties-service.js'

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

function optionalString(body, key) {
  if (!(key in body)) return undefined
  const v = body[key]
  if (typeof v !== 'string') {
    return { error: `${key} must be a string when provided.` }
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

  const propertyId = String(req.query?.id || '').trim() || null

  try {
    if (req.method === 'GET') {
      const [isAdmin, isManager, isOwner] = await Promise.all([
        appUserHasRole(appUser.id, 'admin'),
        appUserHasRole(appUser.id, 'manager'),
        appUserHasRole(appUser.id, 'owner'),
      ])

      if (!isAdmin && !isManager && !isOwner) {
        return res.status(403).json({ error: 'Admin, manager, or owner role required.' })
      }

      if (propertyId) {
        const property = await getPropertyById(propertyId)
        if (!property) return res.status(404).json({ error: 'Property not found.' })

        // Scope check: non-admins can only see their own
        if (!isAdmin) {
          const ownedByMe = property.owned_by_app_user_id === appUser.id
          const managedByMe = property.managed_by_app_user_id === appUser.id
          if (!ownedByMe && !managedByMe) {
            return res.status(403).json({ error: 'Access denied.' })
          }
        }

        return res.status(200).json({ ok: true, property })
      }

      // List — managers/owners must see inactive/draft rows for portal workflows.
      // Admins may pass ?active_only=true to restrict to active properties only.
      const filters = {}
      if (!isAdmin) {
        if (isManager) filters.managedByAppUserId = appUser.id
        else if (isOwner) filters.ownedByAppUserId = appUser.id
      }
      const activeOnly =
        isAdmin && String(req.query?.active_only || req.query?.activeOnly || '').trim().toLowerCase() === 'true'
      const properties = await listProperties({ ...filters, activeOnly })
      return res.status(200).json({ ok: true, properties })
    }

    if (req.method === 'POST') {
      const { allowed } = await requireAdminOrManager(appUser.id)
      if (!allowed) {
        return res.status(403).json({ error: 'Admin or manager role required to create properties.' })
      }

      const body = req.body && typeof req.body === 'object' ? req.body : {}

      // Required fields
      const requiredErrors = []
      for (const key of ['name', 'address_line1', 'city', 'state', 'zip']) {
        if (!body[key] || typeof body[key] !== 'string') {
          requiredErrors.push(key)
        }
      }
      if (requiredErrors.length) {
        return res.status(400).json({ error: `Required string fields missing: ${requiredErrors.join(', ')}.` })
      }

      const args = {
        name: body.name,
        address_line1: body.address_line1,
        city: body.city,
        state: body.state,
        zip: body.zip,
      }

      for (const key of ['address_line2', 'notes']) {
        const parsed = optionalStringOrNull(body, key)
        if (parsed && typeof parsed === 'object' && 'error' in parsed) {
          return res.status(400).json({ error: parsed.error })
        }
        if (parsed !== undefined) args[key] = parsed
      }

      const ownershipType = optionalString(body, 'ownership_type')
      if (ownershipType && typeof ownershipType === 'object' && 'error' in ownershipType) {
        return res.status(400).json({ error: ownershipType.error })
      }
      if (ownershipType !== undefined) args.ownership_type = ownershipType

      if ('owned_by_app_user_id' in body) args.owned_by_app_user_id = body.owned_by_app_user_id || null
      if ('managed_by_app_user_id' in body) args.managed_by_app_user_id = body.managed_by_app_user_id || null

      if ('active' in body) {
        if (typeof body.active !== 'boolean') {
          return res.status(400).json({ error: 'active must be a boolean when provided.' })
        }
        args.active = body.active
      }

      const legacyParsed = optionalStringOrNull(body, 'legacy_airtable_record_id')
      if (legacyParsed && typeof legacyParsed === 'object' && 'error' in legacyParsed) {
        return res.status(400).json({ error: legacyParsed.error })
      }
      if (legacyParsed !== undefined) args.legacy_airtable_record_id = legacyParsed

      const listingStatus = optionalString(body, 'listing_status')
      if (listingStatus && typeof listingStatus === 'object' && 'error' in listingStatus) {
        return res.status(400).json({ error: listingStatus.error })
      }
      if (listingStatus !== undefined) args.listing_status = listingStatus

      for (const key of ['admin_internal_notes', 'edit_request_notes']) {
        const parsed = optionalStringOrNull(body, key)
        if (parsed && typeof parsed === 'object' && 'error' in parsed) {
          return res.status(400).json({ error: parsed.error })
        }
        if (parsed !== undefined) args[key] = parsed
      }

      const property = await createProperty(args)
      return res.status(201).json({ ok: true, property })
    }

    if (req.method === 'PATCH') {
      if (!propertyId) {
        return res.status(400).json({ error: 'id query param is required for PATCH.' })
      }

      const { allowed } = await requireAdminOrManager(appUser.id)
      if (!allowed) {
        return res.status(403).json({ error: 'Admin or manager role required to update properties.' })
      }

      const existing = await getPropertyById(propertyId)
      if (!existing) return res.status(404).json({ error: 'Property not found.' })

      const body = req.body && typeof req.body === 'object' ? req.body : {}
      const patch = { id: propertyId }

      for (const key of ['name', 'address_line1', 'city', 'state', 'zip']) {
        const parsed = optionalString(body, key)
        if (parsed && typeof parsed === 'object' && 'error' in parsed) {
          return res.status(400).json({ error: parsed.error })
        }
        if (parsed !== undefined) patch[key] = parsed
      }

      for (const key of ['address_line2', 'notes']) {
        const parsed = optionalStringOrNull(body, key)
        if (parsed && typeof parsed === 'object' && 'error' in parsed) {
          return res.status(400).json({ error: parsed.error })
        }
        if (parsed !== undefined) patch[key] = parsed
      }

      const ownershipType = optionalString(body, 'ownership_type')
      if (ownershipType && typeof ownershipType === 'object' && 'error' in ownershipType) {
        return res.status(400).json({ error: ownershipType.error })
      }
      if (ownershipType !== undefined) patch.ownership_type = ownershipType

      if ('owned_by_app_user_id' in body) patch.owned_by_app_user_id = body.owned_by_app_user_id || null
      if ('managed_by_app_user_id' in body) patch.managed_by_app_user_id = body.managed_by_app_user_id || null
      if ('active' in body) patch.active = body.active

      const legacyPatch = optionalStringOrNull(body, 'legacy_airtable_record_id')
      if (legacyPatch && typeof legacyPatch === 'object' && 'error' in legacyPatch) {
        return res.status(400).json({ error: legacyPatch.error })
      }
      if (legacyPatch !== undefined) patch.legacy_airtable_record_id = legacyPatch

      const listingStatusPatch = optionalString(body, 'listing_status')
      if (listingStatusPatch && typeof listingStatusPatch === 'object' && 'error' in listingStatusPatch) {
        return res.status(400).json({ error: listingStatusPatch.error })
      }
      if (listingStatusPatch !== undefined) patch.listing_status = listingStatusPatch

      for (const key of ['admin_internal_notes', 'edit_request_notes']) {
        const parsed = optionalStringOrNull(body, key)
        if (parsed && typeof parsed === 'object' && 'error' in parsed) {
          return res.status(400).json({ error: parsed.error })
        }
        if (parsed !== undefined) patch[key] = parsed
      }

      if (Object.keys(patch).length <= 1) {
        return res.status(400).json({
          error: `Provide at least one of: name, address_line1, address_line2, city, state, zip, ownership_type (${OWNERSHIP_TYPE_VALUES.join(' | ')}), owned_by_app_user_id, managed_by_app_user_id, notes, active, legacy_airtable_record_id, listing_status (${LISTING_STATUS_VALUES.join(' | ')}), admin_internal_notes, edit_request_notes. Max lengths: name ${MAX_PROPERTY_NAME_LENGTH}, address ${MAX_PROPERTY_ADDRESS_LENGTH}, city ${MAX_PROPERTY_CITY_LENGTH}, state ${MAX_PROPERTY_STATE_LENGTH}, zip ${MAX_PROPERTY_ZIP_LENGTH}.`,
        })
      }

      const property = await updateProperty(patch)
      return res.status(200).json({ ok: true, property })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    console.error('[properties]', err)
    const msg = err?.message || 'properties request failed.'
    if (msg.includes('ownership_type')) {
      return res.status(400).json({ error: msg })
    }
    if (msg.includes('required') || msg.includes('exceeds max')) {
      return res.status(400).json({ error: msg })
    }
    return res.status(500).json({ error: msg })
  }
}

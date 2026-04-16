/**
 * GET  /api/manager-availability?property_id=<uuid>  — list active slots (manager/admin for that property)
 * POST /api/manager-availability                    — replace slots for one date or recurring weekday
 *
 * Headers: Authorization: Bearer <supabase access_token>
 */
import { authenticateSupabaseBearerRequest } from '../lib/supabase-bearer-auth.js'
import { getAppUserByAuthUserId } from '../lib/app-users-service.js'
import { appUserHasRole } from '../lib/app-user-roles-service.js'
import { requirePropertyManagerAccess } from '../lib/properties-service.js'
import {
  listManagerAvailabilityByPropertyId,
  replaceManagerAvailabilitySlots,
} from '../lib/manager-availability-service.js'

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

export default async function handler(req, res) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()

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

  const propertyId = String(req.query?.property_id || req.query?.propertyId || '').trim()

  try {
    if (req.method === 'GET') {
      if (!propertyId) {
        return res.status(400).json({ error: 'property_id query param is required.' })
      }
      await requirePropertyManagerAccess(propertyId, appUser.id)
      const rows = await listManagerAvailabilityByPropertyId(propertyId)
      return res.status(200).json({ ok: true, rows })
    }

    if (req.method === 'POST') {
      const [isAdmin, isManager] = await Promise.all([
        appUserHasRole(appUser.id, 'admin'),
        appUserHasRole(appUser.id, 'manager'),
      ])
      if (!isAdmin && !isManager) {
        return res.status(403).json({ error: 'Admin or manager role required.' })
      }

      const body = req.body && typeof req.body === 'object' ? req.body : {}
      const pid = String(body.property_id || body.propertyId || '').trim()
      if (!pid) return res.status(400).json({ error: 'property_id is required.' })

      await requirePropertyManagerAccess(pid, appUser.id)

      const dateKey = String(body.date_key || body.dateKey || '').trim().slice(0, 10)
      const repeatWeekly = Boolean(body.repeat_weekly ?? body.repeatWeekly)
      const weekdayAbbr = String(body.weekday_abbr || body.weekdayAbbr || '').trim()
      const timezone = String(body.timezone || 'UTC').trim()
      const slotsIn = Array.isArray(body.slots) ? body.slots : []

      const slots = slotsIn.map((s) => {
        if (s && typeof s === 'object' && s.slot_start_minutes != null && s.slot_end_minutes != null) {
          return {
            slot_start_minutes: s.slot_start_minutes,
            slot_end_minutes: s.slot_end_minutes,
            time_slot_label: s.time_slot_label || s.slot_label || '',
          }
        }
        return null
      }).filter(Boolean)

      const rows = await replaceManagerAvailabilitySlots({
        propertyId: pid,
        createdByAppUserId: appUser.id,
        dateKey,
        repeatWeekly,
        weekdayAbbr,
        timezone,
        slots,
      })
      return res.status(200).json({ ok: true, rows })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    const code = err?.statusCode
    if (code === 403) return res.status(403).json({ error: err.message || 'Forbidden' })
    if (code === 404) return res.status(404).json({ error: err.message || 'Not found' })
    console.error('[manager-availability]', err)
    return res.status(500).json({ error: err?.message || 'manager-availability failed.' })
  }
}

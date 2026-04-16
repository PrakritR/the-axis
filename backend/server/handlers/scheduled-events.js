/**
 * GET  /api/scheduled-events — list bookings (manager/admin, Bearer auth)
 * POST /api/scheduled-events — public create tour for UUID property (optional duplicate of forms tour)
 * PATCH /api/scheduled-events?id= — cancel (manager/admin host or property manager)
 */
import { authenticateSupabaseBearerRequest } from '../lib/supabase-bearer-auth.js'
import { getAppUserByAuthUserId, requireServiceClient } from '../lib/app-users-service.js'
import { appUserHasRole } from '../lib/app-user-roles-service.js'
import { requirePropertyManagerAccess } from '../lib/properties-service.js'
import { assertInternalTourSlotAllowed, normalizeRangeLabel } from '../lib/internal-tour-booking.js'
import {
  createScheduledEvent,
  listScheduledEventsForPropertiesAndManager,
  listAllScheduledEventsInDateRange,
  updateScheduledEventStatus,
} from '../lib/scheduled-events-service.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

export default async function handler(req, res) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()

  try {
    if (req.method === 'GET') {
      const auth = await authenticateSupabaseBearerRequest(req)
      if (!auth.ok) return res.status(auth.status).json({ error: auth.error })

      const appUser = await getAppUserByAuthUserId(auth.user.id)
      if (!appUser?.id) return res.status(409).json({ error: 'No internal app user for this session.' })

      const from = String(req.query?.from || req.query?.from_date || '').trim().slice(0, 10)
      const to = String(req.query?.to || req.query?.to_date || '').trim().slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        return res.status(400).json({ error: 'from and to query params (YYYY-MM-DD) are required.' })
      }

      const rawIds = String(req.query?.property_ids || req.query?.property_id || '')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => UUID_RE.test(s))

      const isAdmin = await appUserHasRole(appUser.id, 'admin')
      const allowedPropertyIds = []
      for (const pid of rawIds) {
        try {
          if (isAdmin) {
            allowedPropertyIds.push(pid)
            continue
          }
          await requirePropertyManagerAccess(pid, appUser.id)
          allowedPropertyIds.push(pid)
        } catch {
          /* skip */
        }
      }

      let rows
      if (isAdmin && !allowedPropertyIds.length) {
        rows = await listAllScheduledEventsInDateRange(from, to)
      } else {
        rows = await listScheduledEventsForPropertiesAndManager(
          allowedPropertyIds,
          isAdmin ? null : appUser.id,
          from,
          to,
        )
      }
      return res.status(200).json({ ok: true, rows })
    }

    if (req.method === 'POST') {
      const body = req.body && typeof req.body === 'object' ? req.body : {}
      const eventType = String(body.event_type || body.eventType || '').trim().toLowerCase()
      const source = String(body.source || 'scheduled_events_api').trim().slice(0, 80) || 'scheduled_events_api'

      if (eventType === 'tour') {
        const propertyId = String(body.property_id || body.propertyId || '').trim()
        if (!UUID_RE.test(propertyId)) {
          return res.status(400).json({ error: 'property_id (UUID) is required for tour bookings.' })
        }
        const guestName = String(body.guest_name || body.name || '').trim()
        const guestEmail = String(body.guest_email || body.email || '').trim().toLowerCase()
        if (!guestName || !guestEmail) {
          return res.status(400).json({ error: 'guest_name and guest_email are required.' })
        }
        const preferredDate = String(body.preferred_date || body.preferredDate || '').trim().slice(0, 10)
        const preferredTime = String(body.preferred_time || body.preferredTime || '').trim()
        const label = normalizeRangeLabel(preferredTime)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(preferredDate) || !label) {
          return res.status(400).json({ error: 'preferred_date (YYYY-MM-DD) and preferred_time are required.' })
        }
        let ctx
        try {
          ctx = await assertInternalTourSlotAllowed({
            propertyId,
            preferredDateKey: preferredDate,
            preferredTimeLabel: preferredTime,
          })
        } catch (e) {
          const code = /** @type {any} */ (e).statusCode || 500
          return res.status(code).json({ error: e.message || 'Booking failed.' })
        }
        const roomId = String(body.room_id || body.roomId || '').trim()
        const created = await createScheduledEvent({
          eventType: 'tour',
          propertyId,
          roomId: UUID_RE.test(roomId) ? roomId : null,
          managerAppUserId: ctx.managerAppUserId,
          guestName,
          guestEmail,
          guestPhone: body.guest_phone || body.phone || null,
          startAt: ctx.startIso,
          endAt: ctx.endIso,
          timezone: ctx.timezone,
          preferredDate,
          preferredTimeLabel: ctx.normalizedTimeLabel,
          source,
          notes: body.notes || body.message || null,
        })
        return res.status(200).json({ ok: true, id: created.id, scheduling: 'postgres' })
      }

      return res.status(400).json({ error: 'event_type must be tour (meetings use POST /api/forms?action=meeting).' })
    }

    if (req.method === 'PATCH') {
      const auth = await authenticateSupabaseBearerRequest(req)
      if (!auth.ok) return res.status(auth.status).json({ error: auth.error })
      const appUser = await getAppUserByAuthUserId(auth.user.id)
      if (!appUser?.id) return res.status(409).json({ error: 'No internal app user for this session.' })

      const id = String(req.query?.id || req.body?.id || '').trim()
      if (!UUID_RE.test(id)) return res.status(400).json({ error: 'id query param (UUID) is required.' })

      const client = requireServiceClient()
      const { data: ev, error: ge } = await client.from('scheduled_events').select('*').eq('id', id).maybeSingle()
      if (ge || !ev) return res.status(404).json({ error: 'Event not found.' })

      const isAdmin = await appUserHasRole(appUser.id, 'admin')
      let allowed = isAdmin
      if (!allowed && ev.manager_app_user_id && ev.manager_app_user_id === appUser.id) allowed = true
      if (!allowed && ev.property_id) {
        try {
          await requirePropertyManagerAccess(ev.property_id, appUser.id)
          allowed = true
        } catch {
          /* no */
        }
      }
      if (!allowed) return res.status(403).json({ error: 'Forbidden.' })

      const nextStatus = String(req.body?.status || 'cancelled').trim().toLowerCase()
      const updated = await updateScheduledEventStatus(id, nextStatus)
      return res.status(200).json({ ok: true, row: updated })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    const code = err?.statusCode
    if (code === 403) return res.status(403).json({ error: err.message || 'Forbidden' })
    if (code === 404) return res.status(404).json({ error: err.message || 'Not found' })
    console.error('[scheduled-events]', err)
    return res.status(500).json({ error: err?.message || 'scheduled-events failed.' })
  }
}

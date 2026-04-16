/**
 * GET  /api/admin-meeting-availability — list current user's weekly meeting windows
 * POST /api/admin-meeting-availability — replace windows for one weekday (from date_key)
 *
 * Headers: Authorization: Bearer <supabase access_token>
 */
import { authenticateSupabaseBearerRequest } from '../lib/supabase-bearer-auth.js'
import { getAppUserByAuthUserId } from '../lib/app-users-service.js'
import { appUserHasRole } from '../lib/app-user-roles-service.js'
import {
  getAvailabilityForAdmin,
  setAvailabilityForAdminWeekday,
} from '../lib/admin-meeting-availability-service.js'

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

  const isAdmin = await appUserHasRole(appUser.id, 'admin')
  if (!isAdmin) {
    return res.status(403).json({ error: 'Admin role required.' })
  }

  try {
    if (req.method === 'GET') {
      const rows = await getAvailabilityForAdmin(appUser.id)
      return res.status(200).json({ ok: true, rows })
    }

    if (req.method === 'POST') {
      const body = req.body && typeof req.body === 'object' ? req.body : {}
      const dateKey = String(body.date_key || body.dateKey || '').trim().slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
        return res.status(400).json({ error: 'date_key (YYYY-MM-DD) is required.' })
      }
      const d = new Date(`${dateKey}T12:00:00`)
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ error: 'Invalid date_key.' })
      }
      const dayOfWeek = d.getDay()
      const timezone = String(body.timezone || 'UTC').trim().slice(0, 100) || 'UTC'
      const slotsIn = Array.isArray(body.slots) ? body.slots : []
      const slots = slotsIn
        .map((s) => {
          if (!s || typeof s !== 'object') return null
          const start = Math.round(Number(s.start_minute ?? s.startMinute))
          const end = Math.round(Number(s.end_minute ?? s.endMinute))
          if (!Number.isFinite(start) || !Number.isFinite(end)) return null
          return { start_minute: start, end_minute: end }
        })
        .filter(Boolean)

      const rows = await setAvailabilityForAdminWeekday({
        appUserId: appUser.id,
        dayOfWeek,
        timezone,
        slots,
      })
      return res.status(200).json({ ok: true, rows })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    console.error('[admin-meeting-availability]', err)
    return res.status(500).json({ error: err?.message || 'admin-meeting-availability failed.' })
  }
}

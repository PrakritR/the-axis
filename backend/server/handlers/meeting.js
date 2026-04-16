/**
 * GET  /api/meeting  → admin directory + meeting availability + booked slots (Postgres only)
 * POST /api/meeting  → books a meeting (scheduled_events, event_type meeting)
 * Same handler is used by POST /api/forms?action=meeting (public Contact Axis flow).
 */

import { getAppUserByEmail, getAppUserById, listActiveAdminsForMeetingDirectory, getSupabaseServiceClient } from '../lib/app-users-service.js'
import { appUserHasRole } from '../lib/app-user-roles-service.js'
import { createScheduledEvent, hasOverlappingManagerBooking, listBookedMeetingLabelsByManagerDateRange } from '../lib/scheduled-events-service.js'
import {
  utcRangeFromDateAndMinutes,
  parseTimeRangeToMinutes,
  normalizeRangeLabel,
} from '../lib/internal-tour-booking.js'
import {
  buildAdminMeetingAvailabilityConfig,
  buildGlobalAdminSlotsByDate,
} from '../../../shared/manager-availability-merge.js'
import {
  getAvailabilityForAdmin,
  mapAdminMeetingDbRowsToVirtualMaRecords,
  validateMeetingSlotAgainstAvailability,
} from '../lib/admin-meeting-availability-service.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function normalizeDateKey(value) {
  const match = String(value || '').trim().match(/^(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : ''
}

function extractMultilineNoteValue(notes, label) {
  const escaped = String(label || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const startRe = new RegExp(`(?:^|\\n)${escaped}:\\s*`, 'i')
  const s = String(notes || '')
  const startMatch = s.match(startRe)
  if (!startMatch) return ''
  const after = s.slice(startMatch.index + startMatch[0].length)
  const stopMatch = after.match(/\n[A-Za-z][A-Za-z ]*:/)
  const block = stopMatch ? after.slice(0, stopMatch.index) : after
  return block.trim()
}

function adminMeetingLegacyFromNotes(notesText) {
  const n = String(notesText || '')
  if (!n) return ''
  const fromNotes = extractMultilineNoteValue(n, 'Meeting Availability')
  return fromNotes || extractMultilineNoteValue(n, 'Calendar Availability')
}

function dateRangeForMeetingListing(daysAhead) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const end = new Date(today)
  end.setDate(end.getDate() + daysAhead)
  const y = (d) => d.getFullYear()
  const m = (d) => String(d.getMonth() + 1).padStart(2, '0')
  const day = (d) => String(d.getDate()).padStart(2, '0')
  return {
    fromStr: `${y(today)}-${m(today)}-${day(today)}`,
    toStr: `${y(end)}-${m(end)}-${day(end)}`,
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method === 'GET') {
    const client = getSupabaseServiceClient()
    if (!client) {
      return res.status(200).json({ admins: [] })
    }
    try {
      const adminRows = await listActiveAdminsForMeetingDirectory()
      const maCfg = buildAdminMeetingAvailabilityConfig(process.env)
      const { fromStr, toStr } = dateRangeForMeetingListing(56)

      const admins = []
      for (const row of adminRows) {
        const email = String(row.email || '').trim().toLowerCase()
        if (!email.includes('@')) continue
        const availabilityRows = await getAvailabilityForAdmin(row.id)
        const virtualRecords = mapAdminMeetingDbRowsToVirtualMaRecords(availabilityRows, email, process.env).map(
          (r) => ({ id: r.id, fields: r.fields }),
        )
        const rawBooked = await listBookedMeetingLabelsByManagerDateRange(row.id, fromStr, toStr)
        const bookings = {}
        for (const [dk, labels] of Object.entries(rawBooked)) {
          for (const lab of labels || []) {
            const n = normalizeRangeLabel(lab)
            if (!n) continue
            if (!bookings[dk]) bookings[dk] = []
            if (!bookings[dk].includes(n)) bookings[dk].push(n)
          }
        }
        const legacyText = adminMeetingLegacyFromNotes(row.admin_notes)
        const maByDate = buildGlobalAdminSlotsByDate({
          records: virtualRecords,
          config: maCfg,
          adminEmail: email,
          legacyWeeklyText: legacyText,
          bookedSlotsByDate: bookings,
          daysAhead: 56,
        })
        admins.push({
          id: row.id,
          name: String(row.full_name || email).trim(),
          email,
          availability: legacyText,
          availableSlotsByDate: maByDate,
          schedulingAvailabilityByDate: {},
          bookedSlotsByDate: bookings,
        })
      }
      return res.status(200).json({ admins })
    } catch (err) {
      console.error('[meeting] GET', err)
      return res.status(200).json({ admins: [] })
    }
  }

  if (req.method === 'POST') {
    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const {
      name,
      email,
      phone,
      notes,
      adminEmail,
      adminAppUserId,
      preferredDate,
      preferredTime,
    } = body

    const requesterName = String(name || '').trim()
    const requesterEmail = String(email || '').trim().toLowerCase()
    const selectedAdminEmail = String(adminEmail || '').trim().toLowerCase()
    const preferredDateKey = normalizeDateKey(preferredDate)
    const preferredTimeLabel = normalizeRangeLabel(preferredTime)
    const preferredRange = parseTimeRangeToMinutes(preferredTimeLabel)

    if (!requesterName || !requesterEmail || !selectedAdminEmail || !preferredDateKey || !preferredTimeLabel) {
      return res.status(400).json({ error: 'Name, email, admin, date, and time are required.' })
    }
    if (!preferredRange) {
      return res.status(400).json({ error: 'Invalid meeting time range.' })
    }

    let host = null
    const aid = String(adminAppUserId || '').trim()
    if (UUID_RE.test(aid)) {
      host = await getAppUserById(aid)
    }
    if (!host) {
      host = await getAppUserByEmail(selectedAdminEmail)
    }
    if (!host?.id) {
      return res.status(404).json({ error: 'Selected admin was not found in the portal database.' })
    }
    const hostEmail = String(host.email || '').trim().toLowerCase()
    if (selectedAdminEmail && hostEmail && hostEmail !== selectedAdminEmail) {
      return res.status(409).json({ error: 'Admin email does not match the selected admin account.' })
    }

    const isAdmin = await appUserHasRole(host.id, 'admin')
    if (!isAdmin) {
      return res.status(403).json({ error: 'Selected host is not available for meeting booking.' })
    }

    const availabilityRows = await getAvailabilityForAdmin(host.id)
    let legacy = ''
    try {
      const client = getSupabaseServiceClient()
      if (client) {
        const { data: ap } = await client.from('admin_profiles').select('notes').eq('app_user_id', host.id).maybeSingle()
        legacy = adminMeetingLegacyFromNotes(ap?.notes)
      }
    } catch {
      /* ignore */
    }

    const bookedRaw = await listBookedMeetingLabelsByManagerDateRange(host.id, preferredDateKey, preferredDateKey)
    const bookedLabels = (bookedRaw[preferredDateKey] || []).map((x) => normalizeRangeLabel(x)).filter(Boolean)

    const allowed = validateMeetingSlotAgainstAvailability({
      dateKey: preferredDateKey,
      preferredTimeLabel,
      adminEmail: hostEmail || selectedAdminEmail,
      availabilityRows,
      legacyWeeklyText: legacy || '',
      bookedSlotLabels: bookedLabels,
    })
    if (!allowed) {
      return res.status(409).json({ error: 'That meeting slot is no longer available.' })
    }

    const times = utcRangeFromDateAndMinutes(preferredDateKey, preferredRange.start, preferredRange.end)
    if (!times) return res.status(400).json({ error: 'Invalid meeting time.' })
    if (await hasOverlappingManagerBooking(host.id, times.startIso, times.endIso)) {
      return res.status(409).json({ error: 'This meeting time has already been booked. Please choose another slot.' })
    }

    try {
      const created = await createScheduledEvent({
        eventType: 'meeting',
        propertyId: null,
        roomId: null,
        managerAppUserId: host.id,
        guestName: requesterName,
        guestEmail: requesterEmail,
        guestPhone: phone ? String(phone).trim() : null,
        startAt: times.startIso,
        endAt: times.endIso,
        timezone: 'UTC',
        preferredDate: preferredDateKey,
        preferredTimeLabel,
        source: 'meeting_api',
        notes: notes ? String(notes).trim() : null,
      })
      return res.status(200).json({ id: created.id, scheduling: 'postgres' })
    } catch (err) {
      console.error('[meeting] POST', err)
      return res.status(502).json({ error: err?.message || 'Could not save meeting.' })
    }
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

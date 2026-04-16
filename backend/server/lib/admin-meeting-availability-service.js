/**
 * Postgres admin_meeting_availability — weekly windows for Contact Axis meetings.
 *
 * @module
 */

import { requireServiceClient } from './app-users-service.js'
import {
  buildManagerAvailabilityConfig,
  mergeGlobalAdminAvailabilityRanges,
  rangesToSlotLabels,
} from '../../../shared/manager-availability-merge.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const DOW_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function assertUuid(id, label) {
  const s = String(id || '').trim()
  if (!UUID_RE.test(s)) throw new Error(`${label} must be a UUID.`)
  return s
}

/**
 * Map DB rows to Airtable-shaped { fields } records for mergeGlobalAdminAvailabilityRanges.
 *
 * @param {object[]} rows
 * @param {string} adminEmail
 * @param {Record<string, string>} [env=process.env]
 */
export function mapAdminMeetingDbRowsToVirtualMaRecords(rows, adminEmail, env = process.env) {
  const cfg = buildManagerAvailabilityConfig(env || {})
  const f = cfg.fields
  const em = String(adminEmail || '').trim().toLowerCase()
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const dow = Number(r.day_of_week)
    const wk = Number.isFinite(dow) && dow >= 0 && dow <= 6 ? DOW_ABBR[dow] : ''
    const fields = {
      [f.propertyName]: '',
      [f.propertyRecordId]: '',
      [f.managerEmail]: em,
      [f.startTime]: Math.round(Number(r.start_minute)),
      [f.endTime]: Math.round(Number(r.end_minute)),
      [f.isRecurring]: true,
      [f.weekday]: wk,
      [f.active]: true,
      [f.timezone]: String(r.timezone || 'UTC').trim(),
    }
    return { id: String(r.id), fields }
  })
}

/**
 * @param {string} appUserId
 * @returns {Promise<object[]>}
 */
export async function getAvailabilityForAdmin(appUserId) {
  const id = assertUuid(appUserId, 'app_user_id')
  const client = requireServiceClient()
  const { data, error } = await client
    .from('admin_meeting_availability')
    .select('*')
    .eq('app_user_id', id)
    .order('day_of_week', { ascending: true })
    .order('start_minute', { ascending: true })
  if (error) throw new Error(error.message || 'Failed to load admin meeting availability')
  return data || []
}

/**
 * Replace all windows for one weekday (0–6). Used by portal calendar per selected day.
 *
 * @param {{
 *   appUserId: string
 *   dayOfWeek: number
 *   timezone: string
 *   slots: { start_minute: number, end_minute: number }[]
 * }} args
 */
export async function setAvailabilityForAdminWeekday(args) {
  const appUserId = assertUuid(args.appUserId, 'app_user_id')
  const dow = Math.round(Number(args.dayOfWeek))
  if (!Number.isFinite(dow) || dow < 0 || dow > 6) {
    throw new Error('day_of_week must be 0–6 (Sunday–Saturday).')
  }
  const timezone = String(args.timezone || 'UTC').trim().slice(0, 100) || 'UTC'
  const slots = Array.isArray(args.slots) ? args.slots : []
  const client = requireServiceClient()

  const { error: delErr } = await client
    .from('admin_meeting_availability')
    .delete()
    .eq('app_user_id', appUserId)
    .eq('day_of_week', dow)
  if (delErr) throw new Error(delErr.message || 'Failed to clear admin meeting availability')

  if (!slots.length) return []

  const rows = slots.map((s) => {
    const start = Math.round(Number(s.start_minute ?? s.startMinute))
    const end = Math.round(Number(s.end_minute ?? s.endMinute))
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      throw new Error('Each slot needs valid start_minute and end_minute.')
    }
    return {
      app_user_id: appUserId,
      day_of_week: dow,
      start_minute: start,
      end_minute: end,
      timezone,
    }
  })

  const { data, error } = await client.from('admin_meeting_availability').insert(rows).select('*')
  if (error) throw new Error(error.message || 'Failed to insert admin meeting availability')
  return data || []
}

/**
 * Full replace of all availability rows for an admin (optional helper).
 *
 * @param {string} appUserId
 * @param {{ day_of_week: number, start_minute: number, end_minute: number, timezone?: string }[]} slots
 */
export async function setAvailabilityForAdmin(appUserId, slots) {
  const id = assertUuid(appUserId, 'app_user_id')
  const client = requireServiceClient()
  const { error: delErr } = await client.from('admin_meeting_availability').delete().eq('app_user_id', id)
  if (delErr) throw new Error(delErr.message || 'Failed to clear admin meeting availability')
  const list = Array.isArray(slots) ? slots : []
  if (!list.length) return []
  const rows = list.map((s) => {
    const dow = Math.round(Number(s.day_of_week ?? s.dayOfWeek))
    const start = Math.round(Number(s.start_minute ?? s.startMinute))
    const end = Math.round(Number(s.end_minute ?? s.endMinute))
    const timezone = String(s.timezone || 'UTC').trim().slice(0, 100) || 'UTC'
    if (!Number.isFinite(dow) || dow < 0 || dow > 6) throw new Error('day_of_week must be 0–6.')
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      throw new Error('Invalid start_minute / end_minute.')
    }
    return {
      app_user_id: id,
      day_of_week: dow,
      start_minute: start,
      end_minute: end,
      timezone,
    }
  })
  const { data, error } = await client.from('admin_meeting_availability').insert(rows).select('*')
  if (error) throw new Error(error.message || 'Failed to insert admin meeting availability')
  return data || []
}

/**
 * True when the normalized time label is one of the free slots for that calendar date.
 *
 * @param {{
 *   dateKey: string
 *   preferredTimeLabel: string
 *   adminEmail: string
 *   availabilityRows: object[]
 *   legacyWeeklyText?: string
 *   bookedSlotLabels?: string[]
 * }} args
 */
export function validateMeetingSlotAgainstAvailability(args) {
  const dateKey = String(args.dateKey || '').trim().slice(0, 10)
  const preferredTimeLabel = String(args.preferredTimeLabel || '').trim()
  const adminEmail = String(args.adminEmail || '').trim().toLowerCase()
  const legacyWeeklyText = String(args.legacyWeeklyText || '').trim()
  const bookedSlotLabels = Array.isArray(args.bookedSlotLabels) ? args.bookedSlotLabels : []
  const availabilityRows = Array.isArray(args.availabilityRows) ? args.availabilityRows : []

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !preferredTimeLabel || !adminEmail) return false

  const cfg = buildManagerAvailabilityConfig(process.env)
  const virtual = mapAdminMeetingDbRowsToVirtualMaRecords(availabilityRows, adminEmail, process.env)
  const merged = mergeGlobalAdminAvailabilityRanges({
    records: virtual,
    fieldsConfig: cfg.fields,
    dateKey,
    adminEmail,
    legacyWeeklyText,
    bookedSlotLabels,
  })
  const labels = rangesToSlotLabels(merged)
  const want = preferredTimeLabel.toLowerCase()
  return labels.some((lab) => String(lab || '').trim().toLowerCase() === want)
}

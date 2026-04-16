/**
 * Postgres admin_meeting_availability via /api/admin-meeting-availability (Supabase JWT).
 *
 * @module
 */

import { supabase } from './supabase'
import { buildManagerAvailabilityConfig } from '../../../shared/manager-availability-merge.js'

const DOW_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

async function bearerHeaders() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('Sign in is required for meeting availability.')
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

/**
 * @param {object[]} rows — API rows from admin_meeting_availability
 * @param {string} adminEmail
 * @returns {object[]} flat field objects compatible with intervalFromMaRecord / recordIsGlobalAdminRow
 */
export function mapInternalAdminMeetingRowsToMaRecords(rows, adminEmail) {
  const cfg = buildManagerAvailabilityConfig(import.meta.env)
  const f = cfg.fields
  const em = String(adminEmail || '').trim().toLowerCase()
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const dow = Number(r.day_of_week)
    const wk = Number.isFinite(dow) && dow >= 0 && dow <= 6 ? DOW_ABBR[dow] : ''
    return {
      id: String(r.id),
      [f.propertyName]: '',
      [f.propertyRecordId]: '',
      [f.managerEmail]: em,
      [f.startTime]: Math.round(Number(r.start_minute)),
      [f.endTime]: Math.round(Number(r.end_minute)),
      [f.isRecurring]: true,
      [f.weekday]: wk,
      [f.active]: true,
      [f.timezone]: String(r.timezone || 'UTC').trim(),
      created_at: r.created_at,
    }
  })
}

/**
 * @param {string} adminEmail — used for merge filters (must match session user)
 * @returns {Promise<object[]>}
 */
export async function listInternalAdminMeetingAvailabilityAsMaRecords(adminEmail) {
  const headers = await bearerHeaders()
  const res = await fetch('/api/admin-meeting-availability', { headers })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || `admin-meeting-availability list failed (${res.status})`)
  return mapInternalAdminMeetingRowsToMaRecords(json.rows || [], adminEmail)
}

/**
 * @param {{
 *   dateKey: string
 *   timezone: string
 *   slots: { start: number, end: number }[] | { start_minute: number, end_minute: number }[]
 * }} args
 */
export async function syncInternalAdminMeetingAvailabilitySlots(args) {
  const headers = await bearerHeaders()
  const dateKey = String(args.dateKey || '').trim().slice(0, 10)
  const slots = (Array.isArray(args.slots) ? args.slots : []).map((s) => {
    const start = Math.round(Number(s.start_minute ?? s.startMinute ?? s.start))
    const end = Math.round(Number(s.end_minute ?? s.endMinute ?? s.end))
    return { start_minute: start, end_minute: end }
  })
  const res = await fetch('/api/admin-meeting-availability', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      date_key: dateKey,
      timezone: args.timezone || 'UTC',
      slots,
    }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || `admin-meeting-availability sync failed (${res.status})`)
  return mapInternalAdminMeetingRowsToMaRecords(json.rows || [], args.adminEmail || '')
}

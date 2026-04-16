/**
 * Postgres-backed manager tour availability (30-minute slots per property).
 *
 * @module
 */

import { requireServiceClient } from './app-users-service.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * @param {string} propertyId
 * @returns {Promise<object[]>}
 */
export async function listManagerAvailabilityByPropertyId(propertyId) {
  const pid = String(propertyId || '').trim()
  if (!UUID_RE.test(pid)) throw new Error('property_id must be a UUID.')
  const client = requireServiceClient()
  const { data, error } = await client
    .from('manager_availability')
    .select('*')
    .eq('property_id', pid)
    .eq('active', true)
    .order('slot_start_minutes', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message || 'Failed to list manager availability')
  return data || []
}

/**
 * Replace saved slots for one calendar scope (one-off date or recurring weekday), mirroring the
 * Manager portal “delete matching rows then insert” Airtable behavior.
 *
 * @param {{
 *   propertyId: string
 *   createdByAppUserId: string | null
 *   dateKey: string
 *   repeatWeekly: boolean
 *   weekdayAbbr: string
 *   timezone: string
 *   slots: { slot_start_minutes: number, slot_end_minutes: number, time_slot_label: string }[]
 * }} args
 */
export async function replaceManagerAvailabilitySlots(args) {
  const propertyId = String(args.propertyId || '').trim()
  if (!UUID_RE.test(propertyId)) throw new Error('property_id must be a UUID.')
  const dateKey = String(args.dateKey || '').trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new Error('dateKey must be YYYY-MM-DD.')
  const repeatWeekly = Boolean(args.repeatWeekly)
  const weekdayAbbr = String(args.weekdayAbbr || '').trim().slice(0, 8)
  const timezone = String(args.timezone || 'UTC').trim().slice(0, 100) || 'UTC'
  const slots = Array.isArray(args.slots) ? args.slots : []
  const createdBy = args.createdByAppUserId != null ? String(args.createdByAppUserId).trim() || null : null

  const client = requireServiceClient()

  if (repeatWeekly) {
    if (!weekdayAbbr) throw new Error('weekdayAbbr is required when repeat_weekly is true.')
    const { error: delErr } = await client
      .from('manager_availability')
      .delete()
      .eq('property_id', propertyId)
      .eq('is_recurring', true)
      .eq('weekday_abbr', weekdayAbbr)
    if (delErr) throw new Error(delErr.message || 'Failed to clear recurring availability')
  } else {
    const { error: delErr } = await client
      .from('manager_availability')
      .delete()
      .eq('property_id', propertyId)
      .eq('is_recurring', false)
      .eq('slot_date', dateKey)
    if (delErr) throw new Error(delErr.message || 'Failed to clear date availability')
  }

  if (!slots.length) return []

  const recurrenceStart = repeatWeekly ? dateKey : null
  const rows = slots.map((s) => {
    const start = Math.round(Number(s.slot_start_minutes))
    const end = Math.round(Number(s.slot_end_minutes))
    const label = String(s.time_slot_label || '').trim().slice(0, 120)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      throw new Error('Each slot must have valid slot_start_minutes and slot_end_minutes.')
    }
    return {
      property_id: propertyId,
      created_by_app_user_id: createdBy,
      slot_date: repeatWeekly ? null : dateKey,
      weekday_abbr: repeatWeekly ? weekdayAbbr : null,
      is_recurring: repeatWeekly,
      recurrence_start: recurrenceStart,
      slot_start_minutes: start,
      slot_end_minutes: end,
      time_slot_label: label || null,
      status: 'available',
      timezone,
      source: 'manager_portal',
      active: true,
    }
  })

  const { data, error } = await client.from('manager_availability').insert(rows).select('*')
  if (error) throw new Error(error.message || 'Failed to insert manager availability')
  return data || []
}

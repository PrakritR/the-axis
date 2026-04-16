/**
 * Postgres manager_availability via /api/manager-availability (Supabase JWT).
 *
 * @module
 */

import { supabase } from './supabase'
import { buildManagerAvailabilityConfig, airtableFieldScalar } from '../../../shared/manager-availability-merge.js'
import { formatHHmmFromMinutes } from './managerAvailabilityAirtable.js'

async function bearerHeaders() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('Sign in is required for availability.')
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

function propertyDisplayName(propertyRow) {
  const r = propertyRow && typeof propertyRow === 'object' ? propertyRow : {}
  return String(r['Property Name'] || r.Name || r.Property || '').trim()
}

/**
 * Map API rows to the same flat shape as {@link ../lib/managerAvailabilityAirtable.js} `mapRecord`.
 *
 * @param {object[]} apiRows
 * @param {object} propertyRow
 * @param {object} manager
 * @returns {object[]}
 */
export function mapInternalAvailabilityApiRowsToMaRecords(apiRows, propertyRow, manager) {
  const cfg = buildManagerAvailabilityConfig(import.meta.env)
  const f = cfg.fields
  const propertyName = propertyDisplayName(propertyRow)
  const propertyRecordId = String(propertyRow?.id || '').trim()
  const managerEmail = String(manager?.email || '').trim().toLowerCase()
  const managerRecordId = String(manager?.airtableRecordId || manager?.id || '').trim()

  return (Array.isArray(apiRows) ? apiRows : []).map((r) => {
    const fields = {
      [f.propertyName]: propertyName,
      [f.propertyRecordId]: propertyRecordId,
      [f.managerEmail]: managerEmail,
      [f.managerRecordId]: managerRecordId || undefined,
      [f.startTime]: formatHHmmFromMinutes(r.slot_start_minutes),
      [f.endTime]: formatHHmmFromMinutes(r.slot_end_minutes),
      [f.isRecurring]: Boolean(r.is_recurring),
      [f.active]: r.active !== false,
      [f.timezone]: String(r.timezone || 'UTC').trim(),
      [f.source]: String(r.source || 'manager_portal').trim(),
    }
    if (r.slot_date) fields[f.date] = String(r.slot_date).slice(0, 10)
    if (r.weekday_abbr) fields[f.weekday] = String(r.weekday_abbr).trim()
    if (r.recurrence_start) fields[f.recurrenceStart] = String(r.recurrence_start).slice(0, 10)
    const tsField = String(f.timeSlot || '').trim()
    if (tsField && r.time_slot_label) fields[tsField] = String(r.time_slot_label).trim()
    const stField = String(f.status || '').trim()
    if (stField) fields[stField] = String(r.status || 'available').trim()

    return { id: String(r.id), ...fields, created_at: r.created_at }
  })
}

/**
 * @param {string} propertyId
 * @param {object} propertyRow
 * @param {object} manager
 * @returns {Promise<object[]>} Airtable-shaped rows for mergePropertyAvailabilityRanges
 */
export async function listInternalManagerAvailabilityAsMaRecords(propertyId, propertyRow, manager) {
  const pid = String(propertyId || '').trim()
  if (!pid) return []
  const headers = await bearerHeaders()
  const res = await fetch(`/api/manager-availability?property_id=${encodeURIComponent(pid)}`, { headers })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || `manager-availability list failed (${res.status})`)
  return mapInternalAvailabilityApiRowsToMaRecords(json.rows || [], propertyRow, manager)
}

/**
 * @param {{
 *   propertyId: string
 *   dateKey: string
 *   repeatWeekly: boolean
 *   weekdayAbbr: string
 *   timezone: string
 *   slots: { slot_start_minutes: number, slot_end_minutes: number, time_slot_label: string }[]
 * }} args
 */
export async function syncInternalManagerAvailabilitySlots(args) {
  const headers = await bearerHeaders()
  const res = await fetch('/api/manager-availability', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      property_id: args.propertyId,
      date_key: args.dateKey,
      repeat_weekly: args.repeatWeekly,
      weekday_abbr: args.weekdayAbbr,
      timezone: args.timezone,
      slots: args.slots,
    }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || `manager-availability sync failed (${res.status})`)
  return json.rows || []
}

/**
 * @param {object[]} maRecords — mixed Airtable-shaped + internal virtual rows
 * @param {string} propertyId
 * @param {string} propertyNameNorm
 * @param {import('../../shared/manager-availability-merge.js').buildManagerAvailabilityConfig} maCfg
 */
export function filterMaRecordsForProperty(maRecords, propertyId, propertyNameNorm, maCfg) {
  const f = maCfg.fields
  const pid = String(propertyId || '').trim()
  const pname = String(propertyNameNorm || '').trim().toLowerCase()
  return (maRecords || []).filter((row) => {
    const rid = airtableFieldScalar(row[f.propertyRecordId])
    if (pid && rid === pid) return true
    const pn = String(row[f.propertyName] || '').trim().toLowerCase()
    if (pname && pn === pname) return true
    return false
  })
}

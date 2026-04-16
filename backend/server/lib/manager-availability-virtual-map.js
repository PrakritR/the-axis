/**
 * Map Postgres manager_availability rows into the flat field shape expected by
 * shared/manager-availability-merge.js (same keys as Airtable Manager Availability).
 *
 * @module
 */

import { buildManagerAvailabilityConfig } from '../../../shared/manager-availability-merge.js'

function pad2(n) {
  return String(n).padStart(2, '0')
}

/** HH:mm 24h for merge intervalFromMaRecord */
export function formatHHmmFromMinutes(totalMinutes) {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(Number(totalMinutes))))
  const h = Math.floor(m / 60)
  const mm = m % 60
  return `${pad2(h)}:${pad2(mm)}`
}

/**
 * @param {object[]} rows — manager_availability DB rows
 * @param {{ propertyName: string, propertyRecordId: string, managerEmail: string, managerRecordId?: string }} ctx
 * @param {Record<string, string>} [env=process.env]
 * @returns {object[]} rows shaped like Airtable mapRecord: { id, ...fields }
 */
export function mapDbManagerAvailabilityRowsToVirtualMaRecords(rows, ctx, env = process.env) {
  const cfg = buildManagerAvailabilityConfig(env || {})
  const f = cfg.fields
  const propertyName = String(ctx.propertyName || '').trim()
  const propertyRecordId = String(ctx.propertyRecordId || '').trim()
  const managerEmail = String(ctx.managerEmail || '').trim().toLowerCase()
  const managerRecordId = String(ctx.managerRecordId || '').trim()

  return (Array.isArray(rows) ? rows : []).map((r) => {
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

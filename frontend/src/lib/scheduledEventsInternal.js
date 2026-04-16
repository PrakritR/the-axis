/**
 * Load Postgres scheduled_events for Manager / Admin calendar merge.
 *
 * @module
 */

import { supabase } from './supabase'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function pad2(n) {
  return String(n).padStart(2, '0')
}

function dateKeyFromDate(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/**
 * @param {object} ev — scheduled_events row
 * @param {Map<string, string>} nameByPropertyId
 */
export function mapScheduledEventToSchedulingRow(ev, nameByPropertyId) {
  const pid = String(ev.property_id || '').trim()
  const propertyLabel =
    ev.event_type === 'tour' && pid
      ? nameByPropertyId.get(pid) || 'Property'
      : ev.event_type === 'meeting'
        ? 'Meeting'
        : ''
  const typeLabel = ev.event_type === 'tour' ? 'Tour' : 'Meeting'
  return {
    id: ev.id,
    Type: typeLabel,
    Name: String(ev.guest_name || 'Guest').trim(),
    Email: String(ev.guest_email || '').trim(),
    Property: propertyLabel,
    Status: ev.status === 'scheduled' ? 'New' : String(ev.status || '').trim(),
    'Preferred Date': String(ev.preferred_date || '').slice(0, 10),
    'Preferred Time': String(ev.preferred_time_label || '').trim(),
    'Manager Email': '',
    _fromPostgresScheduledEvents: true,
    _postgresEvent: ev,
  }
}

/**
 * @param {object[]} propertyRows — merged manager property rows (UUID id = internal)
 * @param {number} [daysAhead]
 * @returns {Promise<object[]>} Airtable-shaped scheduling rows
 */
export async function fetchInternalScheduledEventsSchedulingRows(propertyRows, daysAhead = 120) {
  const rows = Array.isArray(propertyRows) ? propertyRows : []
  const nameById = new Map()
  const ids = []
  for (const p of rows) {
    const id = String(p?.id || '').trim()
    if (!UUID_RE.test(id)) continue
    ids.push(id)
    nameById.set(
      id,
      String(p['Property Name'] || p.Name || p.Property || p.property_name || '').trim() || 'Property',
    )
  }
  if (!ids.length) return []

  const { data: sess } = await supabase.auth.getSession()
  const token = sess?.session?.access_token
  if (!token) return []

  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + daysAhead)
  const from = dateKeyFromDate(start)
  const to = dateKeyFromDate(end)
  const qs = new URLSearchParams({ from, to, property_ids: ids.join(',') })
  const res = await fetch(`/api/scheduled-events?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !Array.isArray(json.rows)) return []
  return json.rows.map((ev) => mapScheduledEventToSchedulingRow(ev, nameById))
}

/**
 * Admin calendar: all internal bookings in range (requires admin role server-side).
 * @param {number} [daysAhead]
 */
export async function fetchAllInternalScheduledEventsForAdmin(daysAhead = 120) {
  const { data: sess } = await supabase.auth.getSession()
  const token = sess?.session?.access_token
  if (!token) return []

  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + daysAhead)
  const from = dateKeyFromDate(start)
  const to = dateKeyFromDate(end)
  const qs = new URLSearchParams({ from, to })
  const res = await fetch(`/api/scheduled-events?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !Array.isArray(json.rows)) return []
  const nameById = new Map()
  return json.rows.map((ev) => mapScheduledEventToSchedulingRow(ev, nameById))
}

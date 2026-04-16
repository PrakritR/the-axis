/**
 * Postgres scheduled_events — tours, meetings, etc.
 *
 * @module
 */

import { requireServiceClient } from './app-users-service.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function assertUuid(id, label) {
  const s = String(id || '').trim()
  if (!UUID_RE.test(s)) throw new Error(`${label} must be a UUID.`)
  return s
}

/**
 * @param {string} propertyId
 * @param {string} dateKey YYYY-MM-DD
 * @returns {Promise<string[]>} normalized time labels (lowercase) already booked
 */
export async function listBookedTourSlotLabelsForPropertyDate(propertyId, dateKey) {
  const pid = assertUuid(propertyId, 'property_id')
  const dk = String(dateKey || '').trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) return []
  const client = requireServiceClient()
  const { data, error } = await client
    .from('scheduled_events')
    .select('preferred_time_label')
    .eq('property_id', pid)
    .eq('event_type', 'tour')
    .eq('preferred_date', dk)
    .eq('status', 'scheduled')
  if (error) throw new Error(error.message || 'Failed to list scheduled tours')
  const out = []
  for (const row of data || []) {
    const lab = String(row?.preferred_time_label || '').trim().toLowerCase()
    if (lab) out.push(lab)
  }
  return out
}

/**
 * Overlap on absolute timeline (any event_type) for the same property.
 * @param {string} propertyId
 * @param {string} startIso
 * @param {string} endIso
 * @returns {Promise<boolean>}
 */
export async function hasOverlappingPropertyBooking(propertyId, startIso, endIso) {
  const pid = assertUuid(propertyId, 'property_id')
  const client = requireServiceClient()
  const { data, error } = await client
    .from('scheduled_events')
    .select('id')
    .eq('property_id', pid)
    .eq('status', 'scheduled')
    .lt('start_at', endIso)
    .gt('end_at', startIso)
    .limit(1)
  if (error) throw new Error(error.message || 'Overlap check failed')
  return (data || []).length > 0
}

/**
 * Overlap for meetings / manager-scoped bookings (manager is host).
 */
export async function hasOverlappingManagerBooking(managerAppUserId, startIso, endIso) {
  const mid = assertUuid(managerAppUserId, 'manager_app_user_id')
  const client = requireServiceClient()
  const { data, error } = await client
    .from('scheduled_events')
    .select('id')
    .eq('manager_app_user_id', mid)
    .eq('status', 'scheduled')
    .lt('start_at', endIso)
    .gt('end_at', startIso)
    .limit(1)
  if (error) throw new Error(error.message || 'Overlap check failed')
  return (data || []).length > 0
}

/**
 * Booked meeting labels grouped by preferred_date (raw labels as stored).
 *
 * @param {string} managerAppUserId
 * @param {string} fromDate YYYY-MM-DD
 * @param {string} toDate YYYY-MM-DD
 * @returns {Promise<Record<string, string[]>>}
 */
export async function listBookedMeetingLabelsByManagerDateRange(managerAppUserId, fromDate, toDate) {
  const mid = assertUuid(managerAppUserId, 'manager_app_user_id')
  const fd = String(fromDate || '').trim().slice(0, 10)
  const td = String(toDate || '').trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fd) || !/^\d{4}-\d{2}-\d{2}$/.test(td)) return {}
  const client = requireServiceClient()
  const { data, error } = await client
    .from('scheduled_events')
    .select('preferred_date, preferred_time_label')
    .eq('manager_app_user_id', mid)
    .eq('event_type', 'meeting')
    .eq('status', 'scheduled')
    .gte('preferred_date', fd)
    .lte('preferred_date', td)
  if (error) throw new Error(error.message || 'Failed to list booked meetings')
  /** @type {Record<string, string[]>} */
  const out = {}
  for (const row of data || []) {
    const dk = String(row.preferred_date || '').slice(0, 10)
    const raw = String(row.preferred_time_label || '').trim()
    if (!dk || !raw) continue
    if (!out[dk]) out[dk] = []
    if (!out[dk].includes(raw)) out[dk].push(raw)
  }
  return out
}

/**
 * @param {{
 *   eventType: 'tour' | 'meeting'
 *   propertyId?: string | null
 *   roomId?: string | null
 *   managerAppUserId?: string | null
 *   createdByAppUserId?: string | null
 *   guestName: string
 *   guestEmail: string
 *   guestPhone?: string | null
 *   startAt: string
 *   endAt: string
 *   timezone: string
 *   preferredDate?: string | null
 *   preferredTimeLabel?: string | null
 *   source: string
 *   notes?: string | null
 * }} args
 */
export async function createScheduledEvent(args) {
  const client = requireServiceClient()
  const row = {
    event_type: args.eventType,
    property_id: args.propertyId || null,
    room_id: args.roomId || null,
    manager_app_user_id: args.managerAppUserId || null,
    created_by_app_user_id: args.createdByAppUserId || null,
    guest_name: String(args.guestName || '').trim(),
    guest_email: String(args.guestEmail || '').trim().toLowerCase(),
    guest_phone: args.guestPhone ? String(args.guestPhone).trim() : null,
    start_at: args.startAt,
    end_at: args.endAt,
    timezone: String(args.timezone || 'UTC').trim().slice(0, 100) || 'UTC',
    preferred_date: args.preferredDate || null,
    preferred_time_label: args.preferredTimeLabel ? String(args.preferredTimeLabel).trim() : null,
    status: 'scheduled',
    source: String(args.source || 'unknown').trim().slice(0, 80) || 'unknown',
    notes: args.notes ? String(args.notes).trim().slice(0, 8000) : null,
    resident_app_user_id: args.residentAppUserId || null,
    application_id: args.applicationId || null,
    inquiry_id: args.inquiryId ? String(args.inquiryId).trim().slice(0, 200) : null,
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await client.from('scheduled_events').insert(row).select('*').single()
  if (error) throw new Error(error.message || 'Failed to create scheduled event')
  return data
}

/**
 * @param {string} propertyId
 * @param {string} [fromDate] YYYY-MM-DD
 * @param {string} [toDate] YYYY-MM-DD
 */
export async function listScheduledEventsForProperty(propertyId, fromDate = '', toDate = '') {
  const pid = assertUuid(propertyId, 'property_id')
  const client = requireServiceClient()
  let q = client.from('scheduled_events').select('*').eq('property_id', pid).order('start_at', { ascending: true })
  const fd = String(fromDate || '').trim().slice(0, 10)
  const td = String(toDate || '').trim().slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(fd)) q = q.gte('preferred_date', fd)
  if (/^\d{4}-\d{2}-\d{2}$/.test(td)) q = q.lte('preferred_date', td)
  const { data, error } = await q
  if (error) throw new Error(error.message || 'Failed to list events')
  return data || []
}

/**
 * @param {string} managerAppUserId
 * @param {string} [fromDate]
 * @param {string} [toDate]
 */
export async function listScheduledEventsForManager(managerAppUserId, fromDate = '', toDate = '') {
  const mid = assertUuid(managerAppUserId, 'manager_app_user_id')
  const client = requireServiceClient()
  let q = client
    .from('scheduled_events')
    .select('*')
    .eq('manager_app_user_id', mid)
    .order('start_at', { ascending: true })
  const fd = String(fromDate || '').trim().slice(0, 10)
  const td = String(toDate || '').trim().slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(fd)) q = q.gte('preferred_date', fd)
  if (/^\d{4}-\d{2}-\d{2}$/.test(td)) q = q.lte('preferred_date', td)
  const { data, error } = await q
  if (error) throw new Error(error.message || 'Failed to list events')
  return data || []
}

/**
 * Properties in scope (OR manager host).
 * @param {string[]} propertyIds
 * @param {string|null} managerAppUserId
 * @param {string} fromDate
 * @param {string} toDate
 */
/**
 * All scheduled rows in a date window (admin calendar / reporting).
 * @param {string} fromDate
 * @param {string} toDate
 */
export async function listAllScheduledEventsInDateRange(fromDate, toDate) {
  const fd = String(fromDate || '').trim().slice(0, 10)
  const td = String(toDate || '').trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fd) || !/^\d{4}-\d{2}-\d{2}$/.test(td)) return []
  const client = requireServiceClient()
  const { data, error } = await client
    .from('scheduled_events')
    .select('*')
    .gte('preferred_date', fd)
    .lte('preferred_date', td)
    .order('start_at', { ascending: true })
  if (error) throw new Error(error.message || 'Failed to list scheduled events')
  return data || []
}

export async function listScheduledEventsForPropertiesAndManager(propertyIds, managerAppUserId, fromDate, toDate) {
  const client = requireServiceClient()
  const ids = (Array.isArray(propertyIds) ? propertyIds : []).map((x) => String(x || '').trim()).filter((x) => UUID_RE.test(x))
  const mid = managerAppUserId && UUID_RE.test(String(managerAppUserId).trim()) ? String(managerAppUserId).trim() : ''
  const fd = String(fromDate || '').trim().slice(0, 10)
  const td = String(toDate || '').trim().slice(0, 10)
  const parts = []
  if (ids.length) {
    const { data, error } = await client
      .from('scheduled_events')
      .select('*')
      .in('property_id', ids)
      .gte('preferred_date', fd)
      .lte('preferred_date', td)
      .order('start_at', { ascending: true })
    if (error) throw new Error(error.message || 'Failed to list property events')
    parts.push(...(data || []))
  }
  if (mid) {
    const { data, error } = await client
      .from('scheduled_events')
      .select('*')
      .eq('manager_app_user_id', mid)
      .gte('preferred_date', fd)
      .lte('preferred_date', td)
      .order('start_at', { ascending: true })
    if (error) throw new Error(error.message || 'Failed to list manager events')
    parts.push(...(data || []))
  }
  const seen = new Set()
  const out = []
  for (const row of parts) {
    const id = row?.id
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(row)
  }
  out.sort((a, b) => String(a.start_at).localeCompare(String(b.start_at)))
  return out
}

/**
 * @param {string} eventId
 * @param {string} [newStatus]
 */
export async function updateScheduledEventStatus(eventId, newStatus = 'cancelled') {
  const id = assertUuid(eventId, 'event id')
  const st = String(newStatus || '').trim().toLowerCase()
  if (!['scheduled', 'cancelled', 'completed', 'no_show'].includes(st)) {
    throw new Error('Invalid status.')
  }
  const client = requireServiceClient()
  const { data, error } = await client
    .from('scheduled_events')
    .update({ status: st, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw new Error(error.message || 'Failed to update event')
  return data
}

/**
 * Booked tour labels merged into the shape expected by tour GET merge:
 * `{ [propertyNameLower]: { [dateKey]: string[] } }`
 * @param {string[]} propertyIds
 * @param {string} fromDateKey
 * @param {string} toDateKey
 */
export async function buildInternalTourBookedSlotsByPropertyName(propertyIds, fromDateKey, toDateKey) {
  const ids = (Array.isArray(propertyIds) ? propertyIds : []).filter((x) => UUID_RE.test(String(x || '').trim()))
  if (!ids.length) return {}
  const fd = String(fromDateKey || '').trim().slice(0, 10)
  const td = String(toDateKey || '').trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fd) || !/^\d{4}-\d{2}-\d{2}$/.test(td)) return {}
  const client = requireServiceClient()
  const { data: events, error: e1 } = await client
    .from('scheduled_events')
    .select('property_id, preferred_date, preferred_time_label')
    .in('property_id', ids)
    .eq('event_type', 'tour')
    .eq('status', 'scheduled')
    .gte('preferred_date', fd)
    .lte('preferred_date', td)
  if (e1) throw new Error(e1.message || 'Failed to load internal bookings')
  const { data: props, error: e2 } = await client.from('properties').select('id, name').in('id', ids)
  if (e2) throw new Error(e2.message || 'Failed to load properties')
  const nameById = new Map((props || []).map((p) => [String(p.id), String(p.name || '').trim().toLowerCase()]))
  const out = {}
  for (const ev of events || []) {
    const pid = String(ev.property_id || '')
    const pname = nameById.get(pid)
    const dk = String(ev.preferred_date || '').trim().slice(0, 10)
    const lab = String(ev.preferred_time_label || '').trim()
    if (!pname || !dk || !lab) continue
    if (!out[pname]) out[pname] = {}
    if (!out[pname][dk]) out[pname][dk] = []
    const normalized = lab.toLowerCase()
    if (!out[pname][dk].includes(normalized)) out[pname][dk].push(normalized)
  }
  return out
}

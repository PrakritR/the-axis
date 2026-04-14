/**
 * CRUD for the Manager Availability Airtable table (manager portal calendar).
 * Uses the same personal access token as the rest of the manager UI.
 */

import { buildManagerAvailabilityConfig } from '../../../shared/manager-availability-merge.js'

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

function baseUrl() {
  const baseId = import.meta.env.VITE_AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
  return `https://api.airtable.com/v0/${baseId}`
}

function tableName() {
  return buildManagerAvailabilityConfig(import.meta.env).tableName
}

function fieldNames() {
  return buildManagerAvailabilityConfig(import.meta.env).fields
}

function mapRecord(record) {
  return { id: record.id, ...(record.fields || {}), created_at: record.createdTime }
}

async function fetchMaPage(filterFormula, offset) {
  const token = import.meta.env.VITE_AIRTABLE_TOKEN
  const table = encodeURIComponent(tableName())
  const url = new URL(`${baseUrl()}/${table}`)
  if (filterFormula != null && String(filterFormula).trim()) {
    url.searchParams.set('filterByFormula', String(filterFormula).trim())
  }
  if (offset) url.searchParams.set('offset', offset)
  const res = await fetch(url.toString(), { headers: headers(token) })
  const text = await res.text().catch(() => '')
  if (!res.ok) {
    const err = new Error(text.slice(0, 400) || `List failed (${res.status})`)
    err.status = res.status
    err.body = text
    throw err
  }
  return JSON.parse(text)
}

/** All rows (paginated). Optional Airtable formula — omitted if empty. */
export async function listManagerAvailabilityRows(filterFormula = '') {
  const token = import.meta.env.VITE_AIRTABLE_TOKEN
  if (!token) throw new Error('Airtable token not configured.')
  const rows = []
  let offset = null
  do {
    let data
    try {
      data = await fetchMaPage(filterFormula || undefined, offset)
    } catch (e) {
      if (e.status === 404 || /TABLE_NAME_NOT_FOUND|Could not find table|UNKNOWN_TABLE/i.test(String(e.body || e.message))) return []
      throw e
    }
    for (const r of data.records || []) rows.push(mapRecord(r))
    offset = data.offset || null
  } while (offset)
  return rows
}

export async function listManagerAvailabilityForProperty(propertyRecordId, propertyName = '') {
  const pid = String(propertyRecordId || '').trim()
  const pname = String(propertyName || '').trim().toLowerCase()
  if (!pid && !pname) return []
  const f = fieldNames()
  try {
    if (pid) {
      const esc = pid.replace(/"/g, '\\"')
      const formula = `{${f.propertyRecordId}} = "${esc}"`
      const rows = await listManagerAvailabilityRows(formula)
      if (rows.length) return rows
    }
  } catch {
    /* fall through */
  }
  const all = await listManagerAvailabilityRows('')
  return all.filter((row) => {
    const rid = String(row[f.propertyRecordId] || '').trim()
    if (pid && rid === pid) return true
    const pn = String(row[f.propertyName] || '').trim().toLowerCase()
    if (pname && pn === pname) return true
    return false
  })
}

/** @param {Record<string, unknown>} fields */
export async function createManagerAvailabilityRecord(fields) {
  const token = import.meta.env.VITE_AIRTABLE_TOKEN
  if (!token) throw new Error('Airtable token not configured.')
  const table = encodeURIComponent(tableName())
  const clean = Object.fromEntries(Object.entries(fields || {}).filter(([, v]) => v !== undefined && v !== ''))
  const res = await fetch(`${baseUrl()}/${table}`, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ fields: clean, typecast: true }),
  })
  const body = await res.text()
  if (!res.ok) throw new Error(body.slice(0, 400) || `Create failed (${res.status})`)
  return mapRecord(JSON.parse(body))
}

export async function deleteManagerAvailabilityRecord(recordId) {
  const token = import.meta.env.VITE_AIRTABLE_TOKEN
  if (!token) throw new Error('Airtable token not configured.')
  const id = String(recordId || '').trim()
  if (!id) return
  const table = encodeURIComponent(tableName())
  const res = await fetch(`${baseUrl()}/${table}/${id}`, {
    method: 'DELETE',
    headers: headers(token),
  })
  if (!res.ok && res.status !== 404) {
    const t = await res.text().catch(() => '')
    throw new Error(t.slice(0, 240) || `Delete failed (${res.status})`)
  }
}

/** Build Airtable fields object for one availability interval. */
export function buildManagerAvailabilityRecordFields({
  propertyName,
  propertyRecordId,
  managerEmail,
  managerRecordId,
  dateKey,
  weekdayAbbr,
  startHHmm,
  endHHmm,
  isRecurring,
  source = 'manager_portal',
}) {
  const f = fieldNames()
  const fields = {
    [f.propertyName]: String(propertyName || '').trim(),
    [f.propertyRecordId]: String(propertyRecordId || '').trim(),
    [f.managerEmail]: String(managerEmail || '').trim().toLowerCase(),
    [f.managerRecordId]: String(managerRecordId || '').trim(),
    [f.startTime]: String(startHHmm || '').trim(),
    [f.endTime]: String(endHHmm || '').trim(),
    [f.isRecurring]: Boolean(isRecurring),
    [f.active]: true,
    [f.timezone]: 'America/Los_Angeles',
    [f.source]: String(source || 'manager_portal').trim(),
  }
  if (isRecurring) {
    fields[f.weekday] = String(weekdayAbbr || '').trim()
  } else {
    const dk = String(dateKey || '').trim().slice(0, 10)
    if (dk) fields[f.date] = dk
  }
  return fields
}

/** Format minutes since midnight as HH:mm for Airtable text fields. */
export function formatHHmmFromMinutes(minutes) {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes)))
  const h = Math.floor(m / 60)
  const mm = m % 60
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

/**
 * Work orders backed by Supabase `public.work_orders` (+ optional `work_order_files`).
 * Maps rows to the legacy Airtable-shaped flat records the manager/resident UI expects.
 */

import { supabase } from './supabase'
import { readAppUserBootstrap } from './authAppUserSync.js'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isWorkOrderUuid(id) {
  return UUID_RE.test(String(id || '').trim())
}

const WORK_ORDER_RESIDENT_PROFILE_LINK_FIELD = (() => {
  const raw = String(import.meta.env.VITE_AIRTABLE_WORK_ORDER_RESIDENT_LINK_FIELD ?? '').trim()
  return raw || 'Resident Profile'
})()

const WORK_ORDER_PROPERTY_LINK_FIELD = (() => {
  const raw = String(import.meta.env.VITE_AIRTABLE_WORK_ORDER_PROPERTY_LINK_FIELD ?? '').trim()
  return raw || 'House'
})()

const WORK_ORDER_APPLICATION_LINK_FIELD = (() => {
  const raw = String(import.meta.env.VITE_AIRTABLE_WORK_ORDER_APPLICATION_LINK_FIELD ?? '').trim()
  if (raw.toLowerCase() === 'none') return ''
  return raw || 'Application'
})()

const BUCKET = 'work-order-images'

function workOrderManagerChargeFieldNameStatic() {
  return String(import.meta.env.VITE_AIRTABLE_WORK_ORDER_COST_FIELD || 'Cost').trim() || 'Cost'
}

function firstLinkedPropertyRecordId(resident) {
  for (const key of ['House', 'Property', 'Properties']) {
    const v = resident?.[key]
    if (Array.isArray(v) && v.length && String(v[0]).trim().startsWith('rec')) {
      return String(v[0]).trim()
    }
  }
  return ''
}

function propertyDisplayName(resident) {
  const explicit = String(resident?.['Property Name'] || '').trim()
  if (explicit) return explicit
  for (const key of ['Property', 'House', 'Properties']) {
    const v = resident?.[key]
    if (Array.isArray(v)) continue
    const s = String(v || '').trim()
    if (s && !s.startsWith('rec')) return s
  }
  return ''
}

async function resolvePropertyIdForResident(resident) {
  const recId = firstLinkedPropertyRecordId(resident)
  if (recId) {
    const { data, error } = await supabase
      .from('properties')
      .select('id')
      .eq('legacy_airtable_record_id', recId)
      .maybeSingle()
    if (!error && data?.id) return String(data.id)
  }
  const name = propertyDisplayName(resident)
  if (name) {
    const { data, error } = await supabase.from('properties').select('id').ilike('name', name).maybeSingle()
    if (!error && data?.id) return String(data.id)
  }
  throw new Error(
    'Could not match this resident to a Supabase property. Set properties.legacy_airtable_record_id for the house link, or align the property name with properties.name.',
  )
}

function mapAirtablePriorityToUrgency(priority) {
  const p = String(priority || '').trim().toLowerCase()
  if (p === 'urgent' || p === 'emergency') return 'Urgent'
  if (p === 'low') return 'Low'
  return 'Medium'
}

function parseUsd(v) {
  const n = Number.parseFloat(String(v ?? '').trim().replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) && n >= 0 ? n : 0
}

function airtableStatusAndResolvedFromFields(fields) {
  const statusRaw = String(fields.Status ?? '').trim().toLowerCase()
  const resolvedField = fields.Resolved
  const resolvedBool =
    resolvedField === true ||
    resolvedField === 1 ||
    resolvedField === '1' ||
    String(resolvedField).toLowerCase() === 'true'
  if (resolvedBool || statusRaw === 'completed' || statusRaw === 'resolved' || statusRaw === 'closed') {
    return { status: 'resolved', resolved: true }
  }
  if (statusRaw.includes('schedule')) return { status: 'scheduled', resolved: false }
  if (statusRaw.includes('progress') || statusRaw.includes('review')) return { status: 'in_progress', resolved: false }
  if (statusRaw === 'cancelled') return { status: 'cancelled', resolved: false }
  return { status: 'open', resolved: false }
}

function displayStatusFromDb(row) {
  if (row.resolved || row.status === 'resolved' || row.status === 'closed') return 'Completed'
  if (row.status === 'scheduled') return 'Scheduled'
  if (row.status === 'in_progress') return 'In Progress'
  return 'Open'
}

function displayPriorityFromUrgency(u) {
  const x = String(u || '').trim().toLowerCase()
  if (x === 'urgent') return 'Urgent'
  if (x === 'low') return 'Low'
  return 'Medium'
}

async function signedUrlsForWorkOrder(workOrderUuid) {
  const wid = String(workOrderUuid || '').trim()
  if (!isWorkOrderUuid(wid)) return []
  const { data: rows, error } = await supabase.from('work_order_files').select('storage_path').eq('work_order_id', wid)
  if (error || !rows?.length) return []
  const out = []
  for (const r of rows) {
    const path = String(r.storage_path || '').trim()
    if (!path) continue
    const signed = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600)
    if (signed.data?.signedUrl) out.push({ url: signed.data.signedUrl })
  }
  return out
}

/**
 * @param {object} row — work_orders row
 * @param {{ name?: string, legacy_airtable_record_id?: string | null } | null | undefined} property
 * @param {{ email?: string | null } | null | undefined} residentUser
 */
export async function mapWorkOrderRowToLegacyRecord(row, property, residentUser) {
  const propName = property?.name || ''
  const legacyProp = property?.legacy_airtable_record_id || ''
  const legacyRes = row.legacy_airtable_resident_profile_id || ''
  const residentAppUserId = row.resident_app_user_id ? String(row.resident_app_user_id).trim() : ''
  const appEmail = String(residentUser?.email || row.resident_display_email || '').trim()

  const scheduledDate = row.scheduled_visit_date ? String(row.scheduled_visit_date).slice(0, 10) : ''
  const photo = await signedUrlsForWorkOrder(row.id)

  const cost = row.manager_cost_usd != null && Number.isFinite(Number(row.manager_cost_usd)) ? Number(row.manager_cost_usd) : 0
  const costField = workOrderManagerChargeFieldNameStatic()

  const linkResField = WORK_ORDER_RESIDENT_PROFILE_LINK_FIELD
  const linkPropField = WORK_ORDER_PROPERTY_LINK_FIELD
  const linkAppField = WORK_ORDER_APPLICATION_LINK_FIELD

  const rec = {
    id: String(row.id),
    _fromSupabase: true,
    Title: String(row.title || '').trim() || String(row.category || 'Work order').trim(),
    Description: String(row.description || ''),
    Category: String(row.category || ''),
    Status: displayStatusFromDb(row),
    Priority: displayPriorityFromUrgency(row.urgency),
    Urgency: row.urgency,
    Resolved: Boolean(row.resolved),
    'Management Notes': row.management_notes != null ? String(row.management_notes) : '',
    'Resolution Summary': row.resolution_summary != null ? String(row.resolution_summary) : '',
    'Scheduled Date': scheduledDate,
    'Scheduled Visit Date': scheduledDate,
    'Preferred Time Window':
      row.scheduled_visit_window != null && String(row.scheduled_visit_window).trim()
        ? String(row.scheduled_visit_window)
        : row.preferred_time_window != null
          ? String(row.preferred_time_window)
          : '',
    'Preferred Entry Time':
      row.preferred_time_window != null && String(row.preferred_time_window).trim()
        ? String(row.preferred_time_window)
        : row.scheduled_visit_window != null
          ? String(row.scheduled_visit_window)
          : '',
    'Property Name': propName,
    Property: propName,
    House: propName,
    'Resident Email': appEmail,
    Cost: cost,
    manager_cost_usd: cost,
    [costField]: cost,
    'Work Order Cost': cost,
    'Date Submitted': row.created_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    'Last Update': row.last_update_at ? String(row.last_update_at).slice(0, 10) : '',
    Update: row.update_log != null ? String(row.update_log) : '',
    Photo: photo.length ? photo : [],
    Photos: photo.length ? photo : [],
  }

  if (legacyRes) {
    rec[linkResField] = [legacyRes]
  } else if (residentAppUserId && UUID_RE.test(residentAppUserId)) {
    rec[linkResField] = [residentAppUserId]
  }
  if (legacyProp) {
    rec[linkPropField] = [legacyProp]
  }
  const legacyApp = row.legacy_airtable_application_id
  if (legacyApp && linkAppField) {
    rec[linkAppField] = [legacyApp]
  }

  return rec
}

async function fetchPropertiesByIds(ids) {
  const clean = [...new Set(ids.map((x) => String(x || '').trim()).filter(Boolean))]
  if (!clean.length) return new Map()
  const { data, error } = await supabase.from('properties').select('id,name,legacy_airtable_record_id').in('id', clean)
  if (error) throw new Error(error.message || 'Failed to load properties for work orders.')
  return new Map((data || []).map((p) => [p.id, p]))
}

async function fetchAppUsersByIds(ids) {
  const clean = [...new Set(ids.map((x) => String(x || '').trim()).filter(Boolean))]
  if (!clean.length) return new Map()
  const { data, error } = await supabase.from('app_users').select('id,email').in('id', clean)
  if (error) throw new Error(error.message || 'Failed to load users for work orders.')
  return new Map((data || []).map((u) => [u.id, u]))
}

async function expandWorkOrderRows(rows) {
  if (!rows?.length) return []
  const propById = await fetchPropertiesByIds(rows.map((r) => r.property_id))
  const userById = await fetchAppUsersByIds(rows.map((r) => r.resident_app_user_id))
  const out = []
  for (const row of rows) {
    out.push(
      await mapWorkOrderRowToLegacyRecord(
        row,
        propById.get(row.property_id),
        userById.get(row.resident_app_user_id),
      ),
    )
  }
  return out
}

function translateIncomingFieldsToDbPatch(fields) {
  const patch = {}
  const f = fields && typeof fields === 'object' ? fields : {}

  if ('Status' in f || 'Resolved' in f) {
    const { status, resolved } = airtableStatusAndResolvedFromFields(f)
    patch.status = status
    patch.resolved = resolved
  }

  const schedKeys = ['Scheduled Date', 'Scheduled Visit Date']
  for (const k of schedKeys) {
    if (k in f) {
      const v = f[k]
      patch.scheduled_visit_date = v && String(v).trim() ? String(v).trim().slice(0, 10) : null
      break
    }
  }

  const timeKeys = ['Preferred Time Window', 'Preferred Time', 'Preferred Entry Time']
  for (const k of timeKeys) {
    if (k in f) {
      patch.scheduled_visit_window = f[k] != null && String(f[k]).trim() ? String(f[k]).trim() : null
      break
    }
  }

  if ('Management Notes' in f) patch.management_notes = f['Management Notes'] != null ? String(f['Management Notes']) : null
  if ('Resolution Summary' in f) {
    patch.resolution_summary = f['Resolution Summary'] != null ? String(f['Resolution Summary']) : null
  }
  if ('Description' in f) patch.description = f.Description != null ? String(f.Description) : ''
  if ('Title' in f) patch.title = f.Title != null ? String(f.Title) : ''
  if ('Category' in f) patch.category = f.Category != null ? String(f.Category) : 'General Maintenance'
  if ('Priority' in f) patch.urgency = mapAirtablePriorityToUrgency(f.Priority)

  const costKeys = [
    workOrderManagerChargeFieldNameStatic(),
    'Cost',
    'Work Order Cost',
    'Billable Amount',
    'Charge',
  ]
  for (const k of costKeys) {
    if (k in f) {
      const n = parseUsd(f[k])
      patch.manager_cost_usd = n > 0 ? n : null
      break
    }
  }

  if ('Update' in f) patch.update_log = f.Update != null ? String(f.Update) : ''
  if ('Last Update' in f) {
    const v = f['Last Update']
    patch.last_update_at = v ? new Date(v).toISOString() : null
  }

  return patch
}

export async function getAllWorkOrdersSupabase() {
  const { data: rows, error } = await supabase.from('work_orders').select('*').order('created_at', { ascending: false })
  if (error) throw new Error(error.message || 'Could not load work orders.')
  return expandWorkOrderRows(rows || [])
}

export async function getWorkOrderByIdSupabase(recordId) {
  const id = String(recordId || '').trim()
  if (!isWorkOrderUuid(id)) {
    throw new Error('Enter a valid work order id (UUID).')
  }
  const { data: row, error } = await supabase.from('work_orders').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message || 'Work order query failed')
  if (!row) throw new Error('Work order not found.')
  const expanded = await expandWorkOrderRows([row])
  return expanded[0]
}

export async function updateWorkOrderSupabase(recordId, fields) {
  const id = String(recordId || '').trim()
  if (!isWorkOrderUuid(id)) {
    throw new Error('Invalid work order record ID.')
  }
  const patch = translateIncomingFieldsToDbPatch(fields)
  if (Object.keys(patch).length === 0) {
    throw new Error('No fields to update.')
  }
  const { data: row, error } = await supabase.from('work_orders').update(patch).eq('id', id).select('*').single()
  if (error) throw new Error(error.message || 'Could not update work order.')
  const expanded = await expandWorkOrderRows([row])
  return expanded[0]
}

export async function getWorkOrdersForResidentSupabase(resident) {
  const { data: userData } = await supabase.auth.getUser()
  const authEmail = String(userData?.user?.email || '').trim().toLowerCase()
  const resEmail = String(resident?.Email || '').trim().toLowerCase()
  if (authEmail && resEmail && authEmail !== resEmail) {
    return []
  }
  const boot = readAppUserBootstrap()
  const appUserId = String(boot?.appUserId || '').trim()
  if (!appUserId) return []

  const { data: rows, error } = await supabase
    .from('work_orders')
    .select('*')
    .eq('resident_app_user_id', appUserId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message || 'Could not load work orders.')
  return expandWorkOrderRows(rows || [])
}

export async function createWorkOrderSupabase({
  resident,
  title,
  category,
  urgency,
  description,
  preferredEntry,
  preferredTimeWindow = '',
  photoFile = null,
}) {
  const { data: userData } = await supabase.auth.getUser()
  const authEmail = String(userData?.user?.email || '').trim().toLowerCase()
  const resEmail = String(resident?.Email || '').trim().toLowerCase()
  if (!authEmail || !resEmail || authEmail !== resEmail) {
    throw new Error('Sign in with the same email as your resident profile to submit a work order.')
  }

  const boot = readAppUserBootstrap()
  const appUserId = String(boot?.appUserId || '').trim()
  if (!appUserId) {
    throw new Error('Your account session is not ready. Reload the page and sign in again.')
  }

  const propertyId = await resolvePropertyIdForResident(resident)
  const airtablePriority = urgency === 'Emergency' ? 'Urgent' : urgency
  let normalizedDescription = urgency === 'Emergency' ? `Resident marked this request as Emergency.\n\n${description}` : description
  const tag = resEmail ? `portal_submitter_email:${resEmail}\n\n` : ''
  if (tag && !normalizedDescription.toLowerCase().includes('portal_submitter_email:')) {
    normalizedDescription = tag + normalizedDescription
  }

  const timeParts = [preferredEntry, preferredTimeWindow].map((s) => String(s || '').trim()).filter(Boolean)
  const preferredWindow = timeParts.join(' · ')

  const legacyResident = String(resident?.id || '').trim().startsWith('rec') ? String(resident.id).trim() : null

  const appLink = resident?.Application
  const appRec =
    Array.isArray(appLink) && appLink.length
      ? String(appLink[0]).trim()
      : typeof appLink === 'string'
        ? appLink.trim()
        : ''
  const legacyApplication = /^rec[a-zA-Z0-9]{14,}$/.test(appRec) ? appRec : null

  const insertPayload = {
    resident_app_user_id: appUserId,
    property_id: propertyId,
    room_id: null,
    application_id: null,
    category: String(category || 'General Maintenance').trim() || 'General Maintenance',
    urgency: mapAirtablePriorityToUrgency(airtablePriority),
    description: normalizedDescription,
    preferred_time_window: preferredWindow || null,
    status: 'open',
    resolved: false,
    title: String(title || 'Work order').trim() || 'Work order',
    legacy_airtable_resident_profile_id: legacyResident,
    legacy_airtable_application_id: legacyApplication,
    resident_display_email: authEmail,
  }

  const { data: created, error } = await supabase.from('work_orders').insert(insertPayload).select('*').single()
  if (error) throw new Error(error.message || 'Could not create work order.')

  if (photoFile && created?.id) {
    try {
      const uid =
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`
      const safeName = String(photoFile.name || 'photo').replace(/[^\w.-]+/g, '_')
      const path = `${created.id}/${uid}-${safeName}`
      const up = await supabase.storage.from(BUCKET).upload(path, photoFile, {
        contentType: photoFile.type || 'application/octet-stream',
        upsert: false,
      })
      if (up.error) {
        console.warn('[createWorkOrderSupabase] storage upload failed:', up.error.message)
      } else {
        const { error: metaErr } = await supabase.from('work_order_files').insert({
          work_order_id: String(created.id),
          storage_path: path,
          file_name: safeName,
          mime_type: photoFile.type || null,
          file_size_bytes: photoFile.size ?? null,
          uploaded_by_app_user_id: appUserId,
        })
        if (metaErr) console.warn('[createWorkOrderSupabase] work_order_files insert failed:', metaErr.message)
      }
    } catch (e) {
      console.warn('[createWorkOrderSupabase] photo upload error:', e?.message || e)
    }
  }

  const { data: row } = await supabase.from('work_orders').select('*').eq('id', created.id).single()
  const expanded = await expandWorkOrderRows([row])
  return expanded[0]
}

export async function deleteWorkOrderForResidentSupabase(workOrderId, resident) {
  const id = String(workOrderId || '').trim()
  if (!isWorkOrderUuid(id)) throw new Error('Invalid work order ID.')
  const list = await getWorkOrdersForResidentSupabase(resident)
  const owned = list.some((wo) => String(wo.id || '').trim() === id)
  if (!owned) {
    throw new Error('You can only delete your own work orders.')
  }
  const wo = list.find((w) => String(w.id || '').trim() === id)
  if (wo) {
    try {
      const { cleanupPaymentsWhenWorkOrderDeleted } = await import('./roomCleaningWorkOrder.js')
      await cleanupPaymentsWhenWorkOrderDeleted(wo, resident)
    } catch (e) {
      console.warn('[deleteWorkOrderForResidentSupabase] linked payment cleanup failed', e?.message || e)
    }
  }
  const { error } = await supabase.from('work_orders').delete().eq('id', id)
  if (error) throw new Error(error.message || 'Could not delete work order.')
}

export async function appendWorkOrderUpdateFromResidentSupabase(workOrderId, residentEmail, message) {
  const id = String(workOrderId || '').trim()
  if (!isWorkOrderUuid(id)) throw new Error('Invalid work order ID.')
  const { data: row, error } = await supabase.from('work_orders').select('update_log').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message || 'Work order query failed')
  if (!row) throw new Error('Work order not found.')
  const lineEmail = String(residentEmail || 'Resident').trim() || 'Resident'
  const prev = String(row.update_log || '').trim()
  const stamp = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
  const line = `[${stamp}] ${lineEmail}: ${message}`
  const next = prev ? `${prev}\n\n${line}` : line
  const today = new Date().toISOString().slice(0, 10)
  return updateWorkOrderSupabase(id, {
    Update: next,
    'Last Update': today,
  })
}

export async function updateWorkOrderStatusSupabase(recordId, status) {
  return updateWorkOrderSupabase(recordId, { Status: status })
}

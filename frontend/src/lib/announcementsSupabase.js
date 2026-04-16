/**
 * Announcements backed by Supabase `public.announcements`.
 * Maps rows to the legacy Airtable-shaped objects the UI expects.
 */

import { supabase } from './supabase'
import { readAppUserBootstrap } from './authAppUserSync.js'
import { announcementResidentTargetTokens } from './announcementAudienceShared.js'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isAnnouncementUuid(id) {
  return UUID_RE.test(String(id || '').trim())
}

const PRIORITY_ORDER = ['Low', 'Normal', 'High', 'Urgent']

function priorityIntFromField(p) {
  if (typeof p === 'number' && Number.isFinite(p)) {
    const n = Math.round(p)
    return Math.max(0, Math.min(3, n))
  }
  const name = typeof p === 'object' && p != null && 'name' in p ? String(p.name || '').trim() : String(p || '').trim()
  const i = PRIORITY_ORDER.findIndex((x) => x.toLowerCase() === name.toLowerCase())
  if (i >= 0) return i
  if (name.toLowerCase() === 'routine') return 1
  return 1
}

function priorityLabelFromInt(n) {
  const i = Math.max(0, Math.min(3, Number(n) || 0))
  return PRIORITY_ORDER[i] || 'Normal'
}

function audienceStringFromFields(fields) {
  const t = fields.Target ?? fields['Target Scope']
  if (Array.isArray(t)) return t.map((x) => String(x).trim()).filter(Boolean).join(', ')
  return String(t || '').trim() || 'All Properties'
}

function parseOptionalDateToIso(value) {
  const s = String(value || '').trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(`${s}T12:00:00.000Z`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function mapAnnouncementRowToLegacyRecord(row) {
  const published = row.status === 'published'
  const rawAudience = String(row.audience || '')
  const targetTokens = announcementResidentTargetTokens({ audience: rawAudience })
  const priorityName = priorityLabelFromInt(row.priority)
  const starts = row.starts_at ? String(row.starts_at) : ''
  const startDay = starts ? starts.slice(0, 10) : ''

  return {
    id: String(row.id),
    _fromSupabase: true,
    Title: String(row.title || ''),
    Message: String(row.body || ''),
    Body: String(row.body || ''),
    'Short Summary': '',
    audience: rawAudience,
    Target: targetTokens,
    Pinned: Boolean(row.pinned),
    Show: published,
    status: row.status,
    Priority: { name: priorityName },
    'Start Date': startDay,
    'Date Posted': startDay,
    CreatedAt: row.created_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ends_at: row.ends_at,
  }
}

export async function getAnnouncementsSupabase() {
  const { data, error } = await supabase
    .from('announcements')
    .select('*')
    .order('pinned', { ascending: false })
    .order('priority', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message || 'Could not load announcements.')
  const rows = data || []
  return rows.map((row) => {
    const a = mapAnnouncementRowToLegacyRecord(row)
    return {
      ...a,
      Message: a.Message || a.Body || '',
      'Short Summary': a['Short Summary'] || '',
      Target: announcementResidentTargetTokens({ audience: row.audience }),
      CreatedAt: a['Created At'] || a.created_at,
    }
  })
}

export async function getAllAnnouncementsAdminSupabase() {
  const { data, error } = await supabase.from('announcements').select('*').order('created_at', { ascending: false })
  if (error) throw new Error(error.message || 'Could not load announcements.')
  return (data || []).map(mapAnnouncementRowToLegacyRecord)
}

function normalizePatchFromAirtableFields(fields) {
  const patch = {}
  const f = fields && typeof fields === 'object' ? fields : {}

  if ('Title' in f) patch.title = f.Title != null ? String(f.Title) : ''
  if ('Message' in f || 'Body' in f) {
    const body = f.Message != null ? String(f.Message) : f.Body != null ? String(f.Body) : ''
    patch.body = body
  }
  if ('Target' in f || 'Target Scope' in f) {
    patch.audience = audienceStringFromFields(f)
  }
  if ('Priority' in f) patch.priority = priorityIntFromField(f.Priority)
  if ('Pinned' in f) patch.pinned = Boolean(f.Pinned)
  if ('Show' in f) {
    const on = f.Show === true || f.Show === 1 || f.Show === '1'
    patch.status = on ? 'published' : 'draft'
  }
  if ('status' in f) {
    const s = String(f.status || '').trim().toLowerCase()
    if (s === 'draft' || s === 'published' || s === 'archived') patch.status = s
  }
  if ('Start Date' in f) {
    patch.starts_at = parseOptionalDateToIso(f['Start Date'])
  }
  if ('Date Posted' in f && !('Start Date' in f)) {
    patch.starts_at = parseOptionalDateToIso(f['Date Posted'])
  }
  if ('ends_at' in f) patch.ends_at = f.ends_at ? String(f.ends_at) : null

  return patch
}

export async function createAnnouncementSupabase(fields) {
  const boot = readAppUserBootstrap()
  const appUserId = boot?.appUserId ? String(boot.appUserId).trim() : null

  const audience = audienceStringFromFields(fields)
  const show = fields.Show === true || fields.Show === 1 || fields.Show === '1'
  const status = fields.status ? String(fields.status).trim().toLowerCase() : show ? 'published' : 'draft'
  const safeStatus = status === 'published' || status === 'archived' ? status : 'draft'

  const row = {
    title: String(fields.Title || '').trim() || 'Untitled',
    body: String(fields.Message ?? fields.Body ?? '').trim(),
    audience: audience || 'All Properties',
    status: safeStatus,
    priority: priorityIntFromField(fields.Priority),
    pinned: Boolean(fields.Pinned),
    starts_at: parseOptionalDateToIso(fields['Start Date'] || fields['Date Posted']),
    ends_at: fields.ends_at ? String(fields.ends_at) : null,
    created_by_app_user_id: appUserId,
  }

  const { data, error } = await supabase.from('announcements').insert(row).select('*').single()
  if (error) throw new Error(error.message || 'Could not create announcement.')
  return mapAnnouncementRowToLegacyRecord(data)
}

export async function updateAnnouncementSupabase(recordId, fields) {
  const id = String(recordId || '').trim()
  if (!isAnnouncementUuid(id)) throw new Error('Invalid announcement id.')
  const patch = normalizePatchFromAirtableFields(fields)
  if (Object.keys(patch).length === 0) throw new Error('No fields to update.')
  const { data, error } = await supabase.from('announcements').update(patch).eq('id', id).select('*').single()
  if (error) throw new Error(error.message || 'Could not update announcement.')
  return mapAnnouncementRowToLegacyRecord(data)
}

export async function deleteAnnouncementSupabase(recordId) {
  const id = String(recordId || '').trim()
  if (!isAnnouncementUuid(id)) throw new Error('Invalid announcement id.')
  const { error } = await supabase.from('announcements').delete().eq('id', id)
  if (error) throw new Error(error.message || 'Could not delete announcement.')
}

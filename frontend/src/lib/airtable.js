import {
  airtablePermissionDeniedMessage,
  responseBodyIndicatesAirtablePermissionDenied,
} from './airtablePermissionError.js'

/** Single Airtable base for the whole app (portal, applications, tour, lease drafts, payments, etc.). */
const BASE_ID = import.meta.env.VITE_AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const API_KEY = import.meta.env.VITE_AIRTABLE_TOKEN
const BASE_URL = `https://api.airtable.com/v0/${BASE_ID}`

/** Exposed for in-app setup hints (Manager payments panel) — same as `VITE_AIRTABLE_BASE_ID`. */
export const AIRTABLE_PAYMENTS_BASE_ID = BASE_ID

/** Portal inbox (Messages table): add these fields in Airtable + optional form URL — see .env.example */
export const PORTAL_INBOX_CHANNEL_INTERNAL = 'internal_mgmt_admin'
const MESSAGE_THREAD_KEY_FIELD =
  import.meta.env.VITE_AIRTABLE_MESSAGE_THREAD_KEY_FIELD !== undefined
    ? import.meta.env.VITE_AIRTABLE_MESSAGE_THREAD_KEY_FIELD
    : 'Thread Key'
const MESSAGE_CHANNEL_FIELD =
  import.meta.env.VITE_AIRTABLE_MESSAGE_CHANNEL_FIELD !== undefined
    ? import.meta.env.VITE_AIRTABLE_MESSAGE_CHANNEL_FIELD
    : 'Channel'

/** Single-line text on Messages; set VITE_AIRTABLE_MESSAGE_SUBJECT_FIELD=none to omit from API writes. */
const MESSAGE_SUBJECT_FIELD = (() => {
  const raw = import.meta.env.VITE_AIRTABLE_MESSAGE_SUBJECT_FIELD
  if (raw === 'none' || raw === false) return ''
  if (raw === undefined || raw === null) return ''
  const s = String(raw).trim()
  return s || ''
})()

/** When set, Work Orders always link to this Resident Profile row (e.g. placeholder "Unnamed record") instead of the portal user row. */
const WORK_ORDER_RESIDENT_PLACEHOLDER_ID = (() => {
  const id = String(import.meta.env.VITE_AIRTABLE_WORK_ORDER_RESIDENT_RECORD_ID || '').trim()
  return /^rec[a-zA-Z0-9]{14,}$/.test(id) ? id : ''
})()

/** Optional Work Orders single-line text field holding the real submitter email when using WORK_ORDER_RESIDENT_PLACEHOLDER_ID. */
const WORK_ORDER_SUBMITTER_EMAIL_FIELD = String(
  import.meta.env.VITE_AIRTABLE_WORK_ORDER_SUBMITTER_EMAIL_FIELD || '',
).trim()

/**
 * Work Orders table: linked record field → Resident Profile ({@link TABLES.residents}).
 * Must match the linked-field name in Airtable exactly (this base uses "Resident profile", not "Resident").
 */
const WORK_ORDER_RESIDENT_PROFILE_LINK_FIELD = (() => {
  const raw = String(import.meta.env.VITE_AIRTABLE_WORK_ORDER_RESIDENT_LINK_FIELD ?? '').trim()
  return raw || 'Resident profile'
})()

const TABLES = {
  workOrders: 'Work Orders',
  messages: 'Messages',
  residents: 'Resident Profile',
  /** Airtable table name (was "Managers" in older bases). */
  managers: 'Manager Profile',
  announcements: 'Announcements',
  properties: 'Properties',
  rooms: 'Rooms',
  websiteSettings: 'Website Settings',
  payments: 'Payments',
  documents: 'Documents',
  packages: 'Packages',
}

/** Same as Apply.jsx / VITE_AIRTABLE_APPLICATIONS_TABLE — must match server handlers. */
function applicationsTableName() {
  const t = String(import.meta.env.VITE_AIRTABLE_APPLICATIONS_TABLE || 'Applications').trim()
  return t || 'Applications'
}

function applicationsTableUrl() {
  return `${BASE_URL}/${encodeURIComponent(applicationsTableName())}`
}

function headers() {
  return {
    Authorization: `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
  }
}

function tableUrl(table) {
  return `${BASE_URL}/${encodeURIComponent(table)}`
}

function paymentsTableUrl() {
  return `${BASE_URL}/${encodeURIComponent(TABLES.payments)}`
}

function applySearchParams(url, params = {}) {
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    if (key === 'sort' && Array.isArray(value)) {
      value.forEach((spec, i) => {
        if (spec && spec.field) {
          url.searchParams.set(`sort[${i}][field]`, String(spec.field))
          url.searchParams.set(`sort[${i}][direction]`, spec.direction === 'asc' ? 'asc' : 'desc')
        }
      })
      return
    }
    url.searchParams.set(key, String(value))
  })
}

function buildUrl(table, params = {}) {
  const url = new URL(tableUrl(table))
  applySearchParams(url, params)
  return url.toString()
}

function buildPaymentsUrl(params = {}) {
  const url = new URL(paymentsTableUrl())
  applySearchParams(url, params)
  return url.toString()
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...headers(),
      ...(options.headers || {}),
    },
  })

  if (!response.ok) {
    const body = await response.text()
    console.error('[Airtable]', response.status, String(url).split('?')[0], body.slice(0, 500))
    if (responseBodyIndicatesAirtablePermissionDenied(body)) {
      throw new Error(airtablePermissionDeniedMessage(url))
    }
    throw new Error(body)
  }

  return response.json()
}

function mapRecord(record) {
  return {
    id: record.id,
    ...record.fields,
    created_at: record.createdTime,
  }
}

function escapeFormulaValue(value) {
  return String(value).replace(/"/g, '\\"')
}

// ─── Inbox thread state (read / trash) — same base as Messages; see docs §1.6b ─
function inboxThreadStateTableName() {
  const raw = import.meta.env.VITE_AIRTABLE_INBOX_THREAD_STATE_TABLE
  const t = raw !== undefined ? String(raw).trim() : 'Inbox Thread State'
  if (!t || /^(none|false|0)$/i.test(t)) return ''
  return t
}

const INBOX_STATE_THREAD_KEY_FIELD =
  import.meta.env.VITE_AIRTABLE_INBOX_STATE_THREAD_KEY_FIELD !== undefined
    ? String(import.meta.env.VITE_AIRTABLE_INBOX_STATE_THREAD_KEY_FIELD).trim()
    : 'Thread Key'
const INBOX_STATE_PARTICIPANT_FIELD =
  import.meta.env.VITE_AIRTABLE_INBOX_STATE_PARTICIPANT_FIELD !== undefined
    ? String(import.meta.env.VITE_AIRTABLE_INBOX_STATE_PARTICIPANT_FIELD).trim()
    : 'Participant Email'
const INBOX_STATE_LAST_READ_FIELD =
  import.meta.env.VITE_AIRTABLE_INBOX_STATE_LAST_READ_FIELD !== undefined
    ? String(import.meta.env.VITE_AIRTABLE_INBOX_STATE_LAST_READ_FIELD).trim()
    : 'Last Read At'
const INBOX_STATE_TRASHED_FIELD =
  import.meta.env.VITE_AIRTABLE_INBOX_STATE_TRASHED_FIELD !== undefined
    ? String(import.meta.env.VITE_AIRTABLE_INBOX_STATE_TRASHED_FIELD).trim()
    : 'Trashed'

export function inboxThreadStateAirtableEnabled() {
  return Boolean(API_KEY && inboxThreadStateTableName())
}

/**
 * @returns {Promise<Map<string, { id: string, lastReadAt: Date|null, trashed: boolean }>>}
 */
export async function fetchInboxThreadStateMap(participantEmail) {
  const table = inboxThreadStateTableName()
  const em = String(participantEmail || '').trim().toLowerCase()
  if (!table || !em) return new Map()

  const fPart = `{${INBOX_STATE_PARTICIPANT_FIELD}}`
  const formula = `${fPart} = "${escapeFormulaValue(em)}"`
  const allRecords = []
  let offset = null
  do {
    const params = { filterByFormula: formula }
    if (offset) params.offset = offset
    const data = await request(buildUrl(table, params))
    ;(data.records || []).forEach((r) => allRecords.push(mapRecord(r)))
    offset = data.offset || null
  } while (offset)

  const m = new Map()
  for (const r of allRecords) {
    const tk = String(r[INBOX_STATE_THREAD_KEY_FIELD] || '').trim()
    if (!tk) continue
    const lr = r[INBOX_STATE_LAST_READ_FIELD]
    const tr = r[INBOX_STATE_TRASHED_FIELD]
    m.set(tk, {
      id: r.id,
      lastReadAt: lr ? new Date(lr) : null,
      trashed: tr === true || tr === 1 || String(tr).toLowerCase() === 'true',
    })
  }
  return m
}

async function findInboxThreadStateRecord(participantEmail, threadKey) {
  const table = inboxThreadStateTableName()
  const em = String(participantEmail || '').trim().toLowerCase()
  const tk = String(threadKey || '').trim()
  if (!table || !em || !tk) return null
  const fPart = `{${INBOX_STATE_PARTICIPANT_FIELD}}`
  const fTk = `{${INBOX_STATE_THREAD_KEY_FIELD}}`
  const formula = `AND(${fPart} = "${escapeFormulaValue(em)}", ${fTk} = "${escapeFormulaValue(tk)}")`
  const data = await request(
    buildUrl(table, {
      filterByFormula: formula,
      maxRecords: 1,
    }),
  )
  const rec = data.records?.[0]
  return rec ? mapRecord(rec) : null
}

/**
 * Create or update inbox UI state for one thread (read cursor + trash).
 * @param {{ lastReadAt?: string|Date|null, trashed?: boolean }} patch
 */
export async function upsertInboxThreadState(participantEmail, threadKey, patch = {}) {
  const table = inboxThreadStateTableName()
  const em = String(participantEmail || '').trim().toLowerCase()
  const tk = String(threadKey || '').trim()
  if (!table || !em || !tk) {
    throw new Error('Inbox thread state table is not configured or email/thread key is missing.')
  }

  const existing = await findInboxThreadStateRecord(em, tk)
  const fields = {
    [INBOX_STATE_PARTICIPANT_FIELD]: em,
    [INBOX_STATE_THREAD_KEY_FIELD]: tk,
  }
  if (patch.lastReadAt !== undefined) {
    const v = patch.lastReadAt
    fields[INBOX_STATE_LAST_READ_FIELD] =
      v == null ? null : v instanceof Date ? v.toISOString() : String(v)
  }
  if (patch.trashed !== undefined) {
    fields[INBOX_STATE_TRASHED_FIELD] = Boolean(patch.trashed)
  }

  if (existing?.id) {
    const data = await request(`${tableUrl(table)}/${existing.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ fields, typecast: true }),
    })
    return mapRecord(data)
  }

  const data = await request(tableUrl(table), {
    method: 'POST',
    body: JSON.stringify({ fields, typecast: true }),
  })
  return mapRecord(data)
}

export function markInboxThreadRead(participantEmail, threadKey) {
  return upsertInboxThreadState(participantEmail, threadKey, {
    lastReadAt: new Date().toISOString(),
  })
}

export function setInboxThreadTrash(participantEmail, threadKey, trashed) {
  return upsertInboxThreadState(participantEmail, threadKey, { trashed })
}

function titleCaseFromEmail(email) {
  const local = String(email || '').split('@')[0]
  return local
    .replace(/[._-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase()) || 'Resident'
}

export async function getResidentById(recordId) {
  const data = await request(`${tableUrl(TABLES.residents)}/${recordId}`)
  return mapRecord(data)
}

export async function loginResident(email, password) {
  const resident = await getResidentByEmail(email)
  if (!resident) return null
  if (resident.Password !== password) return null
  return resident
}

export async function getResidentByEmail(email) {
  const formula = `{Email} = "${escapeFormulaValue(email)}"`
  const data = await request(buildUrl(TABLES.residents, {
    filterByFormula: formula,
    maxRecords: 1,
  }))

  const resident = data.records?.[0]
  return resident ? mapRecord(resident) : null
}

export async function createResident(fields) {
  const data = await request(tableUrl(TABLES.residents), {
    method: 'POST',
    body: JSON.stringify({ fields, typecast: true }),
  })

  return mapRecord(data)
}

export async function updateResident(recordId, fields) {
  const data = await request(`${tableUrl(TABLES.residents)}/${recordId}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields, typecast: true }),
  })

  return mapRecord(data)
}

export async function syncResidentFromAuth({ user, resident = null, profile = {} }) {
  const email = user?.email
  if (!email) return null

  const fields = {
    Email: email,
    'Supabase User ID': user.id,
    Status: 'Active',
  }

  fields.Name = profile.name || resident?.Name || titleCaseFromEmail(email)

  if (profile.house) fields.House = profile.house
  if (profile.unitNumber) fields['Unit Number'] = profile.unitNumber
  if (profile.phone) fields.Phone = profile.phone

  if (resident) {
    return updateResident(resident.id, fields)
  }

  return createResident(fields)
}

export async function getApplicationById(applicationId) {
  // Accepts APP-recXXX or bare recXXX formats
  const raw = String(applicationId || '').trim()
  const recordId = raw.startsWith('APP-') ? raw.slice(4) : raw
  if (!recordId.startsWith('rec') || recordId.length < 10) return null
  try {
    const data = await request(`${applicationsTableUrl()}/${recordId}`)
    return mapRecord(data)
  } catch {
    return null
  }
}

/** Embedded in Announcements.Target to attribute pending rows; stripped for resident matching. */
export const ANNOUNCEMENT_SUBMITTER_TOKEN_PREFIX = '__axis_submitter__:'

function splitAnnouncementTargetSegments(raw) {
  if (raw == null || raw === '') return []
  if (Array.isArray(raw)) {
    return raw.flatMap((x) => splitAnnouncementTargetSegments(x))
  }
  return String(raw)
    .split(/[\n,;|]+/)
    .map((t) => String(t).trim())
    .filter(Boolean)
}

/** Human-readable audience string (hides internal submitter token). */
export function announcementAudienceDisplayText(record) {
  const pre = ANNOUNCEMENT_SUBMITTER_TOKEN_PREFIX.toLowerCase()
  const parts = splitAnnouncementTargetSegments(record?.Target ?? record?.['Target Scope'] ?? '')
  const vis = parts.filter((s) => !String(s).trim().toLowerCase().startsWith(pre))
  return vis.length ? vis.join(', ') : 'All Properties'
}

/** Tokens used for resident targeting (excludes internal submitter marker). */
export function announcementResidentTargetTokens(recordOrTarget) {
  const raw =
    typeof recordOrTarget === 'string' || Array.isArray(recordOrTarget)
      ? recordOrTarget
      : recordOrTarget?.Target ?? recordOrTarget?.['Target Scope'] ?? ''
  const pre = ANNOUNCEMENT_SUBMITTER_TOKEN_PREFIX.toLowerCase()
  return splitAnnouncementTargetSegments(raw)
    .map((t) => String(t).trim().toLowerCase())
    .filter((t) => t && !t.startsWith(pre))
}

export function parseAnnouncementSubmitterEmail(record) {
  const raw = record?.Target ?? record?.['Target Scope'] ?? ''
  const pre = ANNOUNCEMENT_SUBMITTER_TOKEN_PREFIX
  for (const seg of splitAnnouncementTargetSegments(raw)) {
    const s = String(seg).trim()
    if (s.toLowerCase().startsWith(pre.toLowerCase())) {
      return s.slice(pre.length).trim().toLowerCase()
    }
  }
  return ''
}

export function buildAnnouncementTargetField({ audienceText, submitterEmail, embedSubmitter }) {
  const base = String(audienceText || '').trim() || 'All Properties'
  if (!embedSubmitter) return base
  const em = String(submitterEmail || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9@._+-]+/g, '_')
  if (!em.includes('@')) return base
  const tok = `${ANNOUNCEMENT_SUBMITTER_TOKEN_PREFIX}${em}`
  if (base.toLowerCase().includes(tok.toLowerCase())) return base
  return `${base}, ${tok}`
}

export function isAnnouncementPending(record) {
  if (!record) return false
  const s = record.Show
  return s !== true && s !== 1 && s !== '1'
}

export async function getAnnouncements() {
  const data = await request(buildUrl(TABLES.announcements, {
    filterByFormula: '{Show} = TRUE()',
  }))

  const items = (data.records || []).map((record) => {
    const a = mapRecord(record)
    // Target can be an array (multi-select) or a string — normalise to array of lowercase tokens
    const rawTarget = Array.isArray(a.Target) ? a.Target : String(a.Target || a['Target Scope'] || '').split(/[\n,;]+/)
    const pre = ANNOUNCEMENT_SUBMITTER_TOKEN_PREFIX.toLowerCase()
    const targetTokens = rawTarget
      .map((t) => String(t).trim().toLowerCase())
      .filter((t) => t && !t.startsWith(pre))
    return {
      ...a,
      Message: a.Message || a.Body || '',
      'Short Summary': a['Short Summary'] || '',
      Target: targetTokens,
      CreatedAt: a['Created At'] || a.created_at,
    }
  })

  // Pinned first, then newest first
  items.sort((a, b) => {
    const pinnedDiff = Number(Boolean(b.Pinned)) - Number(Boolean(a.Pinned))
    if (pinnedDiff !== 0) return pinnedDiff
    return new Date(b['Start Date'] || b['Date Posted'] || b.CreatedAt || b.created_at) -
           new Date(a['Start Date'] || a['Date Posted'] || a.CreatedAt || a.created_at)
  })

  return items
}

/** Strips internal portal tag from work order description for display. */
export function stripWorkOrderPortalSubmitterLine(description) {
  return String(description || '').replace(/^portal_submitter_email:[^\n]+\n\n?/i, '')
}

function workOrderPortalSubmitterDescriptionTag(email) {
  const e = String(email || '').trim().toLowerCase()
  if (!e) return ''
  return `portal_submitter_email:${e}\n\n`
}

export async function getWorkOrdersForResident(resident) {
  const woResidentField = WORK_ORDER_RESIDENT_PROFILE_LINK_FIELD
  // Linked field stores Resident Profile record IDs. "Resident Email" is typically a lookup from that link.
  const residentId = escapeFormulaValue(resident.id)
  const emailRaw = String(resident.Email || '').trim().toLowerCase()
  const residentEmail = escapeFormulaValue(emailRaw)
  const portalTag = emailRaw ? escapeFormulaValue(`portal_submitter_email:${emailRaw}`) : ''

  const parts = [`FIND("${residentId}", ARRAYJOIN({${woResidentField}})) > 0`]
  if (residentEmail) {
    parts.push(`FIND("${residentEmail}", LOWER(ARRAYJOIN({Resident Email}))) > 0`)
  }
  if (portalTag) {
    parts.push(`FIND("${portalTag}", LOWER({Description})) > 0`)
  }
  if (WORK_ORDER_SUBMITTER_EMAIL_FIELD && residentEmail) {
    parts.push(
      `FIND("${residentEmail}", LOWER({${WORK_ORDER_SUBMITTER_EMAIL_FIELD}} & "")) > 0`,
    )
  }

  const formula = parts.length === 1 ? parts[0] : `OR(${parts.join(', ')})`

  const data = await request(buildUrl(TABLES.workOrders, {
    filterByFormula: formula,
  }))

  return (data.records || [])
    .map(mapRecord)
    .sort((a, b) => new Date(b['Date Submitted'] || b.created_at) - new Date(a['Date Submitted'] || a.created_at))
}

async function uploadAttachmentToRecord(table, recordId, fieldName, file) {
  const formData = new FormData()
  formData.append('file', file, file.name)
  formData.append('filename', file.name)
  formData.append('contentType', file.type || 'application/octet-stream')

  const response = await fetch(
    `https://content.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}/${recordId}/${encodeURIComponent(fieldName)}/uploadAttachment`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}` },
      body: formData,
    }
  )
  if (!response.ok) {
    const body = await response.text()
    if (responseBodyIndicatesAirtablePermissionDenied(body)) {
      throw new Error(airtablePermissionDeniedMessage(response.url))
    }
    throw new Error(body)
  }
  return response.json()
}

function workOrderApplicationFieldsFromResident(resident) {
  const out = {}
  if (!resident) return out
  const aid = resident['Application ID']
  if (aid != null && String(aid).trim() !== '') {
    const n = Number(aid)
    if (Number.isFinite(n) && String(aid).trim() === String(n)) out['Application ID'] = n
    else out['Application ID'] = String(aid).trim()
  }
  const app = resident.Application
  if (Array.isArray(app) && app.length && String(app[0]).trim().startsWith('rec')) {
    out.Application = [String(app[0]).trim()]
  } else if (typeof app === 'string' && app.trim().startsWith('rec')) {
    out.Application = [app.trim()]
  }
  return out
}

export async function createWorkOrder({
  resident,
  title,
  category,
  urgency,
  description,
  preferredEntry,
  photoFile = null,
}) {
  const usePlaceholderResident = Boolean(WORK_ORDER_RESIDENT_PLACEHOLDER_ID)
  const residentLinkId = usePlaceholderResident ? WORK_ORDER_RESIDENT_PLACEHOLDER_ID : resident.id
  const airtablePriority = urgency === 'Emergency' ? 'Urgent' : urgency
  let normalizedDescription = urgency === 'Emergency'
    ? `Resident marked this request as Emergency.\n\n${description}`
    : description
  if (
    usePlaceholderResident &&
    (!WORK_ORDER_SUBMITTER_EMAIL_FIELD || !String(resident?.Email || '').trim())
  ) {
    const tag = workOrderPortalSubmitterDescriptionTag(resident?.Email)
    if (tag) normalizedDescription = tag + normalizedDescription
  }
  const fields = {
    Title: title,
    Description: normalizedDescription,
    Category: category,
    Priority: airtablePriority,
    Status: 'Submitted',
    'Preferred Entry Time': preferredEntry,
    [WORK_ORDER_RESIDENT_PROFILE_LINK_FIELD]: [residentLinkId],
    ...(usePlaceholderResident ? {} : workOrderApplicationFieldsFromResident(resident)),
  }
  if (usePlaceholderResident && WORK_ORDER_SUBMITTER_EMAIL_FIELD && String(resident?.Email || '').trim()) {
    fields[WORK_ORDER_SUBMITTER_EMAIL_FIELD] = String(resident.Email).trim()
  }

  const data = await request(tableUrl(TABLES.workOrders), {
    method: 'POST',
    body: JSON.stringify({ fields, typecast: true }),
  })
  const record = mapRecord(data)

  if (photoFile) {
    try {
      await uploadAttachmentToRecord(TABLES.workOrders, record.id, 'Photo', photoFile)
    } catch (err) {
      console.warn('Photo upload failed (work order was still created):', err.message)
    }
  }

  return record
}

function messageFieldNameConfigured(name) {
  return typeof name === 'string' && name.trim().length > 0
}

/** Stable thread id for Management ↔ Admin (per partner email). */
export function managementAdminThreadKey(managementEmail) {
  const e = String(managementEmail || 'unknown')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9@._+-]+/g, '_')
  return `internal:mgmt-admin:${e}`
}

/** Stable thread id for on-site managers ↔ Admin (per manager email). */
export function siteManagerThreadKey(managerEmail) {
  const e = String(managerEmail || 'unknown')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9@._+-]+/g, '_')
  return `internal:site-manager:${e}`
}

const RESIDENT_LEASING_PREFIX = 'internal:resident-leasing:'

/** Stable thread id: resident ↔ house team / admin (one thread per resident record). */
export function residentLeasingThreadKey(residentRecordId) {
  const id = String(residentRecordId || '').trim()
  if (!id) return ''
  return `${RESIDENT_LEASING_PREFIX}${id}`
}

export function parseResidentLeasingThreadKey(threadKey) {
  const t = String(threadKey || '').trim()
  if (!t.startsWith(RESIDENT_LEASING_PREFIX)) return ''
  return t.slice(RESIDENT_LEASING_PREFIX.length).trim()
}

const RESIDENT_ADMIN_PREFIX = 'internal:resident-admin:'

/** Resident ↔ Axis admin (separate from house-team leasing thread). */
export function residentAdminThreadKey(residentRecordId) {
  const id = String(residentRecordId || '').trim()
  if (!id) return ''
  return `${RESIDENT_ADMIN_PREFIX}${id}`
}

export function parseResidentAdminThreadKey(threadKey) {
  const t = String(threadKey || '').trim()
  if (!t.startsWith(RESIDENT_ADMIN_PREFIX)) return ''
  return t.slice(RESIDENT_ADMIN_PREFIX.length).trim()
}

/** Public Contact / housing message with no specific property — visible in Admin portal inbox only. */
export const HOUSING_PUBLIC_ADMIN_GENERAL_THREAD = 'internal:admin-public:general'

/**
 * Property selected on the public form but Properties has no site-manager email — Admin triages.
 * @param {string} propertyRecordId — Airtable Properties record id (or stable id from tour API)
 */
export function housingPublicAdminPropertyThread(propertyRecordId) {
  const id = String(propertyRecordId || 'unknown').replace(/[^a-zA-Z0-9]/g, '')
  return `internal:admin-public:property:${id || 'unknown'}`
}

/** Build an Airtable Form URL with prefill_* params (field names must match the form). */
export function buildAirtableFormPrefillUrl(baseUrl, prefill = {}) {
  if (!baseUrl || typeof baseUrl !== 'string') return ''
  try {
    const u = new URL(baseUrl.trim())
    Object.entries(prefill).forEach(([k, v]) => {
      if (v == null || v === '') return
      u.searchParams.set(`prefill_${k}`, String(v))
    })
    return u.toString()
  } catch {
    return ''
  }
}

async function listMessagesByFormulaPaginated(formula) {
  const allRecords = []
  let offset = null
  do {
    const params = { filterByFormula: formula }
    if (offset) params.offset = offset
    const data = await request(buildUrl(TABLES.messages, params))
    ;(data.records || []).forEach((r) => allRecords.push(mapRecord(r)))
    offset = data.offset || null
  } while (offset)
  return allRecords.sort(
    (a, b) =>
      new Date(a.Timestamp || a.created_at || 0) - new Date(b.Timestamp || b.created_at || 0),
  )
}

export async function getMessagesByThreadKey(threadKey) {
  if (!messageFieldNameConfigured(MESSAGE_THREAD_KEY_FIELD)) {
    throw new Error('Configure the Messages thread-key field name in your project environment and add that field on the Messages table.')
  }
  const tk = String(threadKey || '').trim()
  if (!tk) return []
  const f = `{${MESSAGE_THREAD_KEY_FIELD}}`
  const formula = `${f} = "${escapeFormulaValue(tk)}"`
  return listMessagesByFormulaPaginated(formula)
}

/** All internal portal threads (management & site managers) for the Admin inbox. */
export async function getAllPortalInternalThreadMessages() {
  if (!messageFieldNameConfigured(MESSAGE_THREAD_KEY_FIELD)) {
    throw new Error('Add a "Thread Key" text field to Messages (or set the thread-key field name in your project environment).')
  }
  const f = `{${MESSAGE_THREAD_KEY_FIELD}}`
  const formula = `OR(FIND("internal:mgmt-admin", ${f} & "") > 0, FIND("internal:site-manager", ${f} & "") > 0, FIND("internal:admin-public", ${f} & "") > 0, FIND("internal:resident-leasing", ${f} & "") > 0, FIND("internal:resident-admin", ${f} & "") > 0)`
  return listMessagesByFormulaPaginated(formula)
}

export function portalInboxAirtableConfigured() {
  return airtableReady && messageFieldNameConfigured(MESSAGE_THREAD_KEY_FIELD)
}

/** When non-empty, inbox UI shows Subject and sendMessage writes this field name. */
export function getPortalInboxSubjectFieldName() {
  return MESSAGE_SUBJECT_FIELD
}

/** True when this Messages row belongs to Management/Admin or Site Manager threads (not work-order chat). */
export function isInternalPortalThreadMessage(record) {
  if (!record || !messageFieldNameConfigured(MESSAGE_THREAD_KEY_FIELD)) return false
  const tk = String(record[MESSAGE_THREAD_KEY_FIELD] || '')
  return (
    tk.includes('internal:mgmt-admin') ||
    tk.includes('internal:site-manager') ||
    tk.includes('internal:admin-public') ||
    tk.includes('internal:resident-leasing') ||
    tk.includes('internal:resident-admin')
  )
}

export function portalInboxThreadKeyFromRecord(record) {
  if (!messageFieldNameConfigured(MESSAGE_THREAD_KEY_FIELD)) return ''
  return String(record[MESSAGE_THREAD_KEY_FIELD] || '').trim()
}

export async function getMessages(workOrderId) {
  const formula = `FIND("${escapeFormulaValue(workOrderId)}", ARRAYJOIN({Work Order})) > 0`
  const data = await request(buildUrl(TABLES.messages, {
    filterByFormula: formula,
  }))

  return (data.records || [])
    .map(mapRecord)
    .sort((a, b) => new Date(a.Timestamp || a.created_at) - new Date(b.Timestamp || b.created_at))
}

export async function sendMessage({
  workOrderId,
  senderEmail,
  message,
  isAdmin = false,
  threadKey,
  channel,
  subject,
}) {
  const wo = workOrderId ? String(workOrderId).trim() : ''
  const tk = threadKey ? String(threadKey).trim() : ''
  if (!wo && !(tk && messageFieldNameConfigured(MESSAGE_THREAD_KEY_FIELD))) {
    throw new Error('Link a work order or set portal Thread Key fields on Messages for internal threads.')
  }

  const fields = {
    Message: message,
    'Sender Email': senderEmail,
    'Is Admin': isAdmin,
  }
  if (wo) {
    fields['Work Order'] = [wo]
  }
  if (tk && messageFieldNameConfigured(MESSAGE_THREAD_KEY_FIELD)) {
    fields[MESSAGE_THREAD_KEY_FIELD] = tk
  }
  if (channel && messageFieldNameConfigured(MESSAGE_CHANNEL_FIELD)) {
    fields[MESSAGE_CHANNEL_FIELD] = channel
  }
  const subj = String(subject || '').trim()
  if (MESSAGE_SUBJECT_FIELD && subj) {
    fields[MESSAGE_SUBJECT_FIELD] = subj
  }

  const data = await request(tableUrl(TABLES.messages), {
    method: 'POST',
    body: JSON.stringify({
      fields,
      typecast: true,
    }),
  })

  return mapRecord(data)
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------
export async function getPaymentsForResident(resident) {
  const formula = `FIND("${escapeFormulaValue(resident.id)}", ARRAYJOIN({Resident})) > 0`
  const data = await request(
    buildPaymentsUrl({
      filterByFormula: formula,
      sort: [{ field: 'Due Date', direction: 'desc' }],
    }),
  )
  return (data.records || []).map(mapRecord)
}

/** All payment rows (paginated) — manager portal rent overview. */
export async function getAllPaymentsRecords() {
  const allRecords = []
  let offset = null
  do {
    const params = {}
    if (offset) params.offset = offset
    const data = await request(buildPaymentsUrl(params))
    ;(data.records || []).forEach((r) => allRecords.push(mapRecord(r)))
    offset = data.offset || null
  } while (offset)
  return allRecords
}

export async function updatePaymentRecord(recordId, fields) {
  const id = String(recordId || '').trim()
  if (!/^rec[a-zA-Z0-9]{14,}$/.test(id)) {
    throw new Error('Invalid payment record ID.')
  }
  const cleaned = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined))
  if (Object.keys(cleaned).length === 0) throw new Error('No fields to update.')
  const data = await request(`${paymentsTableUrl()}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: cleaned, typecast: true }),
  })
  return mapRecord(data)
}

/** Create a Payments row (e.g. manager-posted fine). `fields` must match your Airtable Payments table. */
export async function createPaymentRecord(fields) {
  const cleaned = Object.fromEntries(Object.entries(fields || {}).filter(([, v]) => v !== undefined))
  if (Object.keys(cleaned).length === 0) throw new Error('No fields to create payment.')
  const data = await request(paymentsTableUrl(), {
    method: 'POST',
    body: JSON.stringify({ fields: cleaned, typecast: true }),
  })
  return mapRecord(data)
}

export async function getPropertyByName(propertyName) {
  if (!propertyName) return null
  try {
    const formula = `{Property Name} = "${escapeFormulaValue(propertyName)}"`
    const data = await request(buildUrl(TABLES.properties, {
      filterByFormula: formula,
      maxRecords: 1,
    }))
    const record = data.records?.[0]
    return record ? mapRecord(record) : null
  } catch {
    // Properties table may use a different primary field name — fall back to static data
    return null
  }
}

/** Approved properties for the public Rent with Axis carousel (requires Airtable token + Approved checkbox). */
export async function fetchApprovedPropertiesForMarketing() {
  if (!API_KEY) return []
  try {
    const data = await request(
      buildUrl(TABLES.properties, {
        filterByFormula: '{Approved} = TRUE()',
        pageSize: 100,
      }),
    )
    return (data.records || []).map(mapRecord)
  } catch {
    return []
  }
}

/** Single Properties row by id (public read when token is present). */
export async function fetchPropertyRecordById(recordId) {
  const id = String(recordId || '').trim()
  if (!API_KEY || !/^rec[a-zA-Z0-9]{14,}$/.test(id)) return null
  try {
    const data = await request(`${BASE_URL}/${encodeURIComponent(TABLES.properties)}/${encodeURIComponent(id)}`)
    return mapRecord(data)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Rooms (optional — admin portal reads linked rows for min rent per property)
// ---------------------------------------------------------------------------

/** Airtable table name (default: "Rooms"). */
export function getAirtableRoomsTableName() {
  const t = String(import.meta.env.VITE_AIRTABLE_ROOMS_TABLE || TABLES.rooms).trim()
  return t || TABLES.rooms
}

/**
 * Create a room record linked to a property.
 * Fields: Name, Property (linked record array), Rent, Status, Notes.
 */
export async function createRoomRecord({ propertyId, name, rent, status, notes }) {
  const fields = {}
  if (name) fields['Name'] = String(name).trim()
  if (propertyId) fields['Property'] = [propertyId]
  if (rent != null && rent !== '') fields['Rent'] = Number(rent)
  if (status) fields['Status'] = String(status).trim()
  if (notes) fields['Notes'] = String(notes).trim()
  const data = await request(`${BASE_URL}/${encodeURIComponent(getAirtableRoomsTableName())}`, {
    method: 'POST',
    body: JSON.stringify({ fields, typecast: true }),
  })
  return mapRecord(data)
}

/**
 * Upload a file as an attachment to a property record's Photos/Images field.
 * Uses Airtable's content upload API.
 */
export async function uploadPropertyImage(propertyId, file) {
  const formData = new FormData()
  formData.append('file', file, file.name)
  formData.append('filename', file.name)
  formData.append('contentType', file.type || 'application/octet-stream')
  const response = await fetch(
    `https://content.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLES.properties)}/${propertyId}/${encodeURIComponent('Photos')}/uploadAttachment`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}` },
      body: formData,
    },
  )
  if (!response.ok) {
    const body = await response.text()
    if (responseBodyIndicatesAirtablePermissionDenied(body)) {
      throw new Error(airtablePermissionDeniedMessage(response.url))
    }
    throw new Error(body)
  }
  return response.json()
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------
export async function getDocumentsForResident(resident) {
  const formula = `AND(FIND("${escapeFormulaValue(resident.id)}", ARRAYJOIN({Resident})) > 0, {Visible to Resident} = 1)`
  const data = await request(buildUrl(TABLES.documents, { filterByFormula: formula }))
  return (data.records || []).map(mapRecord)
}

// ---------------------------------------------------------------------------
// Packages
// ---------------------------------------------------------------------------
export async function getPackagesForResident(resident) {
  const formula = `FIND("${escapeFormulaValue(resident.id)}", ARRAYJOIN({Resident})) > 0`
  const data = await request(buildUrl(TABLES.packages, {
    filterByFormula: formula,
    sort: [{ field: 'Arrival Date', direction: 'desc' }],
  }))
  return (data.records || []).map(mapRecord)
}

export async function markPackagePickedUp(recordId) {
  const data = await request(`${tableUrl(TABLES.packages)}/${recordId}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: { Status: 'Picked Up' }, typecast: true }),
  })
  return mapRecord(data)
}

// ---------------------------------------------------------------------------
// Lease signing
// ---------------------------------------------------------------------------
export async function signLease(applicationRecordId, signatureText) {
  const today = new Date().toISOString().slice(0, 10)
  const data = await request(`${applicationsTableUrl()}/${applicationRecordId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      fields: {
        'Lease Signed': true,
        'Lease Signed Date': today,
        'Lease Signature': signatureText,
      },
      typecast: true,
    }),
  })
  return mapRecord(data)
}

// Returns currently active signed leases — used to overlay dynamic room unavailability
export async function getSignedLeases() {
  const formula = `AND({Lease Signed} = TRUE(), IS_AFTER({Lease End Date}, TODAY()))`
  const url = new URL(applicationsTableUrl())
  url.searchParams.set('filterByFormula', formula)
  url.searchParams.set('fields[]', 'Property Name')
  url.searchParams.set('fields[]', 'Room Number')
  url.searchParams.set('fields[]', 'Lease End Date')
  const data = await request(url.toString())
  return (data.records || []).map((r) => ({
    propertyName: r.fields['Property Name'] || '',
    roomNumber: r.fields['Room Number'] || '',
    leaseEndDate: r.fields['Lease End Date'] || '',
  }))
}

export const airtableReady = Boolean(
  BASE_ID &&
  API_KEY &&
  API_KEY !== 'your_airtable_token' &&
  API_KEY !== 'your_data_api_token'
)

// ---------------------------------------------------------------------------
// Manager auth
// ---------------------------------------------------------------------------
export async function loginManager(email, password) {
  const formula = `AND({Email} = "${escapeFormulaValue(email)}", {Password} = "${escapeFormulaValue(password)}")`
  const data = await request(buildUrl(TABLES.managers, { filterByFormula: formula, maxRecords: 1 }))
  const record = data.records?.[0]
  return record ? mapRecord(record) : null
}

export async function getManagerByEmail(email) {
  const formula = `{Email} = "${escapeFormulaValue(email)}"`
  const data = await request(buildUrl(TABLES.managers, { filterByFormula: formula, maxRecords: 1 }))
  const record = data.records?.[0]
  return record ? mapRecord(record) : null
}

export async function updateManager(recordId, fields) {
  const data = await request(`${tableUrl(TABLES.managers)}/${recordId}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields, typecast: true }),
  })
  return mapRecord(data)
}

// ---------------------------------------------------------------------------
// Manager — all work orders (across all properties)
// ---------------------------------------------------------------------------
export async function getAllWorkOrders() {
  const allRecords = []
  let offset = null
  do {
    const params = {}
    if (offset) params.offset = offset
    const data = await request(buildUrl(TABLES.workOrders, params))
    ;(data.records || []).forEach((r) => allRecords.push(mapRecord(r)))
    offset = data.offset || null
  } while (offset)
  return allRecords
}

export async function getWorkOrderById(recordId) {
  const id = String(recordId || '').trim()
  if (!/^rec[a-zA-Z0-9]{14,}$/.test(id)) {
    throw new Error('Enter a valid record ID (e.g. recXXXXXXXXXXXXXX).')
  }
  const data = await request(`${tableUrl(TABLES.workOrders)}/${id}`)
  return mapRecord(data)
}

/** PATCH any Work Orders fields. Omits undefined entries. */
export async function updateWorkOrder(recordId, fields) {
  const id = String(recordId || '').trim()
  if (!/^rec[a-zA-Z0-9]{14,}$/.test(id)) {
    throw new Error('Invalid work order record ID.')
  }
  const cleaned = Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined),
  )
  if (Object.keys(cleaned).length === 0) {
    throw new Error('No fields to update.')
  }
  const data = await request(`${tableUrl(TABLES.workOrders)}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: cleaned, typecast: true }),
  })
  return mapRecord(data)
}

/** Append to Work Orders "Update" and set "Last Update" (date) when a resident sends a message. */
export async function appendWorkOrderUpdateFromResident(workOrderId, residentEmail, message) {
  const lineEmail = String(residentEmail || 'Resident').trim() || 'Resident'
  const current = await getWorkOrderById(workOrderId)
  const prev = String(current.Update || '').trim()
  const stamp = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
  const line = `[${stamp}] ${lineEmail}: ${message}`
  const next = prev ? `${prev}\n\n${line}` : line
  const today = new Date().toISOString().slice(0, 10)
  return updateWorkOrder(workOrderId, {
    Update: next,
    'Last Update': today,
  })
}

export async function updateWorkOrderStatus(recordId, status) {
  return updateWorkOrder(recordId, { Status: status })
}

// ---------------------------------------------------------------------------
// Manager — all messages (across all work orders)
// ---------------------------------------------------------------------------
export async function getAllMessages() {
  const allRecords = []
  let offset = null
  do {
    const params = { sort: [{ field: 'Timestamp', direction: 'desc' }] }
    if (offset) params.offset = offset
    const data = await request(buildUrl(TABLES.messages, params))
    ;(data.records || []).forEach((r) => allRecords.push(mapRecord(r)))
    offset = data.offset || null
  } while (offset)
  return allRecords
}

export async function sendManagerMessage({ workOrderId, message }) {
  const data = await request(tableUrl(TABLES.messages), {
    method: 'POST',
    body: JSON.stringify({
      fields: {
        Message: message,
        'Work Order': [workOrderId],
        'Is Admin': true,
      },
      typecast: true,
    }),
  })
  return mapRecord(data)
}

// ---------------------------------------------------------------------------
// Manager — all applications
// ---------------------------------------------------------------------------
export async function getAllApplications() {
  const allRecords = []
  let offset = null
  do {
    const url = new URL(applicationsTableUrl())
    if (offset) url.searchParams.set('offset', offset)
    const data = await request(url.toString())
    ;(data.records || []).forEach((r) => allRecords.push(mapRecord(r)))
    offset = data.offset || null
  } while (offset)
  return allRecords.sort((a, b) => {
    const ta = new Date(a.created_at || 0).getTime()
    const tb = new Date(b.created_at || 0).getTime()
    return tb - ta
  })
}

export async function getFullApplicationById(recordId) {
  const app = await request(`${applicationsTableUrl()}/${recordId}`)
  return mapRecord(app)
}

// ---------------------------------------------------------------------------
// Manager — lease management
// ---------------------------------------------------------------------------
export async function saveLease(recordId, { token, leaseJson, status = 'Pending' }) {
  const data = await request(`${applicationsTableUrl()}/${recordId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      fields: {
        'Lease Token': token,
        'Lease JSON': JSON.stringify(leaseJson),
        'Lease Status': status,
      },
      typecast: true,
    }),
  })
  return mapRecord(data)
}

export async function getLeaseByToken(token) {
  const formula = `{Lease Token} = "${escapeFormulaValue(token)}"`
  const url = new URL(applicationsTableUrl())
  url.searchParams.set('filterByFormula', formula)
  url.searchParams.set('maxRecords', '1')
  const data = await request(url.toString())
  const record = data.records?.[0]
  if (!record) return null
  const mapped = mapRecord(record)
  try {
    mapped._leaseData = mapped['Lease JSON'] ? JSON.parse(mapped['Lease JSON']) : null
  } catch {
    mapped._leaseData = null
  }
  return mapped
}

export async function updateLeaseRecord(recordId, fields) {
  const data = await request(`${applicationsTableUrl()}/${recordId}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields, typecast: true }),
  })
  return mapRecord(data)
}

// ---------------------------------------------------------------------------
// Manager — announcements management
// ---------------------------------------------------------------------------
export async function getAllAnnouncementsAdmin() {
  const data = await request(buildUrl(TABLES.announcements, {}))
  const rows = (data.records || []).map(mapRecord)
  return rows.sort((a, b) => {
    const ta = new Date(a.created_at || a['Created At'] || 0).getTime()
    const tb = new Date(b.created_at || b['Created At'] || 0).getTime()
    return tb - ta
  })
}

export async function createAnnouncement(fields) {
  const data = await request(tableUrl(TABLES.announcements), {
    method: 'POST',
    body: JSON.stringify({ fields, typecast: true }),
  })
  return mapRecord(data)
}

/**
 * Create an Announcements row and optionally mirror a short summary into a portal inbox thread.
 * Managers/partners: Show=false (pending admin); embeds submitter in Target.
 * Admins: can publish immediately (Show=true).
 */
export async function submitAnnouncementFromInbox({
  title,
  message,
  shortSummary,
  audienceTargetText,
  pinned = false,
  priority = 'Normal',
  publish = false,
  submitterEmail,
  notifyInbox,
}) {
  const t = String(title || '').trim()
  const m = String(message || '').trim()
  if (!t || !m) throw new Error('Title and message are required.')

  const target = buildAnnouncementTargetField({
    audienceText: audienceTargetText,
    submitterEmail,
    embedSubmitter: !publish,
  })

  const fields = {
    Title: t,
    Message: m,
    Target: target,
    Priority: { name: priority },
    Show: Boolean(publish),
    Pinned: Boolean(pinned),
  }
  const sum = String(shortSummary || '').trim()
  if (sum) fields['Short Summary'] = sum

  const rec = await createAnnouncement(fields)

  if (notifyInbox?.threadKey && notifyInbox?.senderEmail) {
    const preview = m.length > 450 ? `${m.slice(0, 450)}…` : m
    const head = publish
      ? `Announcement published to residents: "${t}"`
      : `Announcement submitted for review: "${t}"`
    const scrubbedTarget = target.replace(
      new RegExp(`${ANNOUNCEMENT_SUBMITTER_TOKEN_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^,\\s]+`, 'i'),
      '(pending)',
    )
    const body = `${head}\nTarget: ${scrubbedTarget.trim()}\n\n${preview}`
    await sendMessage({
      senderEmail: notifyInbox.senderEmail,
      message: body,
      isAdmin: Boolean(notifyInbox.isAdmin),
      threadKey: notifyInbox.threadKey,
      channel: PORTAL_INBOX_CHANNEL_INTERNAL,
    })
  }

  return rec
}

export async function updateAnnouncement(recordId, fields) {
  const data = await request(`${tableUrl(TABLES.announcements)}/${recordId}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields, typecast: true }),
  })
  return mapRecord(data)
}

export async function deleteAnnouncement(recordId) {
  await request(`${tableUrl(TABLES.announcements)}/${recordId}`, { method: 'DELETE' })
}

// ---------------------------------------------------------------------------
// Lease Drafts — resident-facing read
// ---------------------------------------------------------------------------

// Returns the most recent published (or signed) lease draft for dashboard /
// snapshots. The Leasing tab loads all stages via `getLeaseDraftsForResident`
// and only shows full lease text for Published / Signed.
export async function getApprovedLeaseForResident(residentRecordId) {
  if (!residentRecordId) return null
  const escaped = escapeFormulaValue(residentRecordId)
  const formula = `AND(
    {Resident Record ID} = "${escaped}",
    OR({Status} = "Published", {Status} = "Signed")
  )`
  const url = new URL(`${BASE_URL}/Lease%20Drafts`)
  url.searchParams.set('filterByFormula', formula)
  url.searchParams.set('sort[0][field]', 'Published At')
  url.searchParams.set('sort[0][direction]', 'desc')
  url.searchParams.set('maxRecords', '1')
  const data = await request(url.toString())
  const record = data.records?.[0]
  return record ? mapRecord(record) : null
}

/** All lease draft rows for a resident (any status), newest first — for portal stage filter. */
export async function getLeaseDraftsForResident(residentRecordId) {
  if (!residentRecordId) return []
  const escaped = escapeFormulaValue(residentRecordId)
  const formula = `{Resident Record ID} = "${escaped}"`
  const table = 'Lease Drafts'
  const allRecords = []
  let offset = null
  do {
    const params = { filterByFormula: formula }
    if (offset) params.offset = offset
    const data = await request(buildUrl(table, params))
    ;(data.records || []).forEach((r) => allRecords.push(mapRecord(r)))
    offset = data.offset || null
  } while (offset)

  allRecords.sort((a, b) => {
    const pb = new Date(b['Published At'] || 0).getTime()
    const pa = new Date(a['Published At'] || 0).getTime()
    if (pb !== pa) return pb - pa
    return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
  })
  return allRecords
}

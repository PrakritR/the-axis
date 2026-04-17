import {
  airtablePermissionDeniedMessage,
  responseBodyIndicatesAirtablePermissionDenied,
} from './airtablePermissionError.js'
import {
  isLeaseVersionUploaderOrDateUnknownField,
  leaseVersionDocUploaderPayload,
  leaseVersionLegacyUploaderPayload,
  stripLeaseVersionUploaderFieldVariants,
} from '../../../shared/lease-version-airtable-uploader-fields.js'

export { leaseVersionDisplayUploadTime } from '../../../shared/lease-version-airtable-uploader-fields.js'
import { mergeAxisListingMetaIntoOtherInfo, parseAxisListingMetaBlock } from './axisListingMeta.js'
import { supabase } from './supabase'
import {
  appendWorkOrderUpdateFromResidentSupabase,
  createWorkOrderSupabase,
  deleteWorkOrderForResidentSupabase,
  getAllWorkOrdersSupabase,
  getWorkOrderByIdSupabase,
  getWorkOrdersForResidentSupabase,
  updateWorkOrderStatusSupabase,
  updateWorkOrderSupabase,
} from './workOrdersSupabase.js'
import { getConfiguredPropertyPhotosFieldName } from './propertyListingPhotos.js'
import { uploadPropertyImageInternal, publicUrlForPropertyImage } from './internalFileStorage.js'
import { ANNOUNCEMENT_SUBMITTER_TOKEN_PREFIX, buildAnnouncementTargetField } from './announcementAudienceShared.js'
import {
  getAnnouncementsSupabase,
  getAllAnnouncementsAdminSupabase,
  createAnnouncementSupabase,
  updateAnnouncementSupabase,
  deleteAnnouncementSupabase,
} from './announcementsSupabase.js'
import {
  getApprovedLeaseForResidentSupabase,
  getCurrentLeaseVersionSupabase,
  getLeaseCommentsForDraftSupabase,
  getLeaseDraftByIdSupabase,
  getLeaseDraftsForResidentSupabase,
  isLeaseDraftUuid,
  updateLeaseDraftRecordSupabase,
} from './leaseDraftsSupabase.js'
import { uploadLeaseFileInternal, signedDownloadLeaseFile } from './internalFileStorage.js'
import { isInternalUuid, isAirtableRecordId } from './recordIdentity.js'
import { readAppUserBootstrap } from './authAppUserSync.js'
import {
  fetchResidentSelfFullBundle,
  mapInternalPaymentToResidentPaymentRow,
  patchResidentPortalProfile,
} from './residentPortalInternal.js'
import { fetchStaffResidentsLegacyList } from './residentsStaffSupabase.js'
import {
  createPaymentRecordInternal,
  deletePaymentRecordInternal,
  fetchStaffPaymentsRows,
  isSupabasePaymentRecordId,
  listPaymentsMappedForResident,
  patchPaymentRecordInternal,
} from './paymentsInternalApi.js'

export {
  ANNOUNCEMENT_SUBMITTER_TOKEN_PREFIX,
  announcementAudienceDisplayText,
  announcementResidentTargetTokens,
  parseAnnouncementSubmitterEmail,
  buildAnnouncementTargetField,
  isAnnouncementPending,
  announcementMatchesResident,
} from './announcementAudienceShared.js'

export { isInternalAxisRecordId } from './axisRecordIds.js'

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

/**
 * Single-line text on Messages (default field name `Subject`).
 * Set `VITE_AIRTABLE_MESSAGE_SUBJECT_FIELD` to your exact Airtable column name, or `none` to skip writes.
 */
const MESSAGE_SUBJECT_FIELD = (() => {
  const raw = import.meta.env.VITE_AIRTABLE_MESSAGE_SUBJECT_FIELD
  if (raw === 'none' || raw === false) return ''
  if (raw === undefined || raw === null) return 'Subject'
  const s = String(raw).trim()
  return s || 'Subject'
})()

/**
 * Writable date/time on Messages (optional). Leave unset to omit — sorting uses Airtable `createdTime`
 * (`created_at` on mapped records). Set to `Timestamp` only if that column is a real Date field, not
 * formula/Created time (those reject writes with INVALID_VALUE_FOR_COLUMN).
 */
const MESSAGE_TIMESTAMP_FIELD = (() => {
  const raw = import.meta.env.VITE_AIRTABLE_MESSAGE_TIMESTAMP_FIELD
  if (raw === 'none' || raw === false || raw === '0') return ''
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
 * Work Orders → application id (copied from Resident Profile). Must match your base exactly.
 * Set to `none` to never send this field (use if the column does not exist).
 */
const WORK_ORDER_APPLICATION_ID_FIELD = (() => {
  const raw = String(import.meta.env.VITE_AIRTABLE_WORK_ORDER_APPLICATION_ID_FIELD ?? '').trim()
  if (raw.toLowerCase() === 'none') return ''
  return raw || 'Application ID'
})()

/**
 * Work Orders → linked record(s) to Applications table. Must match your base exactly.
 * Set to `none` to never send this field.
 */
const WORK_ORDER_APPLICATION_LINK_FIELD = (() => {
  const raw = String(import.meta.env.VITE_AIRTABLE_WORK_ORDER_APPLICATION_LINK_FIELD ?? '').trim()
  if (raw.toLowerCase() === 'none') return ''
  return raw || 'Application'
})()

/**
 * Work Orders table: linked record field → Resident Profile ({@link TABLES.residents}).
 * Optional env: VITE_AIRTABLE_WORK_ORDER_RESIDENT_LINK_FIELD — must match your base exactly when set.
 * When unset, create/list retries common Airtable spellings (e.g. Resident Profile, Resident profile, Resident).
 */
const WORK_ORDER_RESIDENT_PROFILE_LINK_FIELD = (() => {
  const raw = String(import.meta.env.VITE_AIRTABLE_WORK_ORDER_RESIDENT_LINK_FIELD ?? '').trim()
  /** Default tries most common Airtable labels; createWorkOrder retries alternates on UNKNOWN_FIELD_NAME. */
  return raw || 'Resident Profile'
})()

/** When env is unset, try these linked-record field names (order matters). */
const WORK_ORDER_RESIDENT_LINK_FIELD_FALLBACKS = [
  'Resident Profile',
  'Resident profile',
  'Resident',
  'Tenant',
  'Resident Link',
  'Resident ID',
]

/**
 * Work Orders → linked record(s) to Properties. Optional env; otherwise try House then Property.
 */
const WORK_ORDER_PROPERTY_LINK_FIELD = (() => {
  const raw = String(import.meta.env.VITE_AIRTABLE_WORK_ORDER_PROPERTY_LINK_FIELD ?? '').trim()
  if (raw.toLowerCase() === 'none') return ''
  return raw
})()

const WORK_ORDER_PROPERTY_LINK_FIELD_FALLBACKS = ['House', 'Property']

function airtableUnknownFieldNameFromErrorMessage(message) {
  const raw = String(message || '').trim()
  try {
    const j = JSON.parse(raw)
    const m = j?.error?.message
    if (typeof m !== 'string') return null
    const match = m.match(/Unknown field name:\s*"([^"]+)"/i)
    return match ? match[1] : null
  } catch {
    return null
  }
}

/** When POST/PATCH targets a formula / created time / read-only field (INVALID_VALUE_FOR_COLUMN). */
function airtableComputedOrReadOnlyFieldFromErrorMessage(message) {
  const raw = String(message || '')
  if (!/computed|read-only|read only/i.test(raw)) return null
  const match = raw.match(/Field "([^"]+)" cannot accept a value/i)
  return match ? match[1] : null
}

const TABLES = {
  messages: 'Messages',
  residents: 'Resident Profile',
  /** Airtable table name (was "Managers" in older bases). */
  managers: 'Manager Profile',
  properties: 'Properties',
  rooms: 'Rooms',
  websiteSettings: 'Website Settings',
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
  const id = String(recordId || '').trim()
  if (isInternalUuid(id)) {
    const boot = readAppUserBootstrap()
    if (String(boot?.appUserId || '').trim() !== id) return null
    const bundle = await fetchResidentSelfFullBundle()
    if (!bundle.ok || !bundle.display) return null
    return bundle.display
  }
  const data = await request(`${tableUrl(TABLES.residents)}/${id}`)
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
  const id = String(recordId || '').trim()
  if (isInternalUuid(id)) {
    const boot = readAppUserBootstrap()
    if (String(boot?.appUserId || '').trim() !== id) {
      throw new Error('You can only update your own resident profile.')
    }
    const patch = {}
    if (fields && typeof fields === 'object') {
      if ('Name' in fields) patch.full_name = fields.Name == null ? null : String(fields.Name)
      if ('Phone' in fields) patch.phone = fields.Phone == null ? null : String(fields.Phone)
    }
    if (Object.keys(patch).length === 0) {
      return getResidentById(id)
    }
    await patchResidentPortalProfile(patch)
    const again = await fetchResidentSelfFullBundle()
    if (!again.ok || !again.display) {
      throw new Error(again.error || 'Could not reload profile after save.')
    }
    return again.display
  }
  const data = await request(`${tableUrl(TABLES.residents)}/${id}`, {
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

export async function getAnnouncements() {
  return getAnnouncementsSupabase()
}

/** Strips internal portal tag from work order description for display. */
export function stripWorkOrderPortalSubmitterLine(description) {
  return String(description || '').replace(/^portal_submitter_email:[^\n]+\n\n?/i, '')
}

/** Email embedded when Work Orders link to a placeholder resident row (see WORK_ORDER_RESIDENT_PLACEHOLDER_ID). */
export function workOrderPortalSubmitterEmailFromDescription(workOrder) {
  const d = String(workOrder?.Description || '')
  const m =
    d.match(/^portal_submitter_email:\s*([^\s\n@]+@[^\s\n]+)/im) || d.match(/^portal_submitter_email:\s*(\S+)/im)
  return m ? String(m[1]).trim().toLowerCase() : ''
}

/**
 * Resident record id to attach Payments for a scheduled cleaning fee — prefers real profile
 * (matched by portal submitter email) over placeholder linked-record ids.
 */
export function resolveResidentRecordIdForWorkOrderBilling(workOrder, residentsById) {
  const map = residentsById instanceof Map ? residentsById : new Map()
  const email = workOrderPortalSubmitterEmailFromDescription(workOrder)
  if (email) {
    for (const r of map.values()) {
      const em = String(r?.Email || '').trim().toLowerCase()
      if (em === email) {
        const id = String(r?.id || '').trim()
        if (id) return id
      }
    }
  }
  const placeholder = WORK_ORDER_RESIDENT_PLACEHOLDER_ID
  const ids = workOrderLinkedResidentRecordIds(workOrder)
  for (const rid of ids) {
    if (placeholder && rid === placeholder) continue
    if (rid && map.has(rid)) return rid
  }
  for (const rid of ids) {
    if (placeholder && rid === placeholder) continue
    if (rid) return rid
  }
  return ''
}

function workOrderPortalSubmitterDescriptionTag(email) {
  const e = String(email || '').trim().toLowerCase()
  if (!e) return ''
  return `portal_submitter_email:${e}\n\n`
}

function workOrderResidentLinkFieldCandidates() {
  const envLinkField = String(import.meta.env.VITE_AIRTABLE_WORK_ORDER_RESIDENT_LINK_FIELD ?? '').trim()
  return envLinkField
    ? [envLinkField]
    : [...new Set([WORK_ORDER_RESIDENT_PROFILE_LINK_FIELD, ...WORK_ORDER_RESIDENT_LINK_FIELD_FALLBACKS])]
}

function workOrderPropertyLinkFieldCandidates() {
  return WORK_ORDER_PROPERTY_LINK_FIELD
    ? [WORK_ORDER_PROPERTY_LINK_FIELD]
    : WORK_ORDER_PROPERTY_LINK_FIELD_FALLBACKS
}

/**
 * Flattened or raw Work Orders record — returns linked Resident Profile record IDs.
 * Used by manager portal to match WOs that only link to a resident (no House/Property on the WO).
 */
export function workOrderLinkedResidentRecordIds(recordOrRaw) {
  const rec =
    recordOrRaw &&
    typeof recordOrRaw === 'object' &&
    recordOrRaw.fields &&
    typeof recordOrRaw.fields === 'object'
      ? recordOrRaw.fields
      : recordOrRaw || {}
  const ids = []
  for (const fieldName of workOrderResidentLinkFieldCandidates()) {
    const val = rec[fieldName]
    if (Array.isArray(val)) {
      for (const x of val) {
        const s = String(x).trim()
        if (isAirtableRecordId(s) || isInternalUuid(s)) ids.push(s)
      }
    } else if (typeof val === 'string') {
      const s = val.trim()
      if (isAirtableRecordId(s) || isInternalUuid(s)) ids.push(s)
    }
  }
  return [...new Set(ids)]
}

/** Linked Properties / House record IDs on a Work Orders row (same candidates as createWorkOrder). */
export function workOrderLinkedPropertyRecordIds(recordOrRaw) {
  const rec =
    recordOrRaw &&
    typeof recordOrRaw === 'object' &&
    recordOrRaw.fields &&
    typeof recordOrRaw.fields === 'object'
      ? recordOrRaw.fields
      : recordOrRaw || {}
  const ids = []
  for (const fieldName of workOrderPropertyLinkFieldCandidates()) {
    const val = rec[fieldName]
    if (Array.isArray(val)) {
      for (const x of val) {
        const s = String(x).trim()
        if (/^rec[a-zA-Z0-9]{14,}$/.test(s)) ids.push(s)
      }
    } else if (typeof val === 'string' && /^rec[a-zA-Z0-9]{14,}$/.test(val.trim())) {
      ids.push(val.trim())
    }
  }
  return [...new Set(ids)]
}

/** Linked Applications record IDs on a Work Orders row (env: VITE_AIRTABLE_WORK_ORDER_APPLICATION_LINK_FIELD, default "Application"). */
export function workOrderLinkedApplicationRecordIds(recordOrRaw) {
  const rec =
    recordOrRaw &&
    typeof recordOrRaw === 'object' &&
    recordOrRaw.fields &&
    typeof recordOrRaw.fields === 'object'
      ? recordOrRaw.fields
      : recordOrRaw || {}
  const raw = String(import.meta.env.VITE_AIRTABLE_WORK_ORDER_APPLICATION_LINK_FIELD ?? '').trim()
  if (raw.toLowerCase() === 'none') return []
  const fieldName = raw || 'Application'
  const val = rec[fieldName]
  const ids = []
  if (Array.isArray(val)) {
    for (const x of val) {
      const s = String(x).trim()
      if (/^rec[a-zA-Z0-9]{14,}$/.test(s)) ids.push(s)
    }
  } else if (typeof val === 'string' && /^rec[a-zA-Z0-9]{14,}$/.test(val.trim())) {
    ids.push(val.trim())
  }
  return [...new Set(ids)]
}

export async function getWorkOrdersForResident(resident) {
  return getWorkOrdersForResidentSupabase(resident)
}

/** Delete a Work Orders row only if it belongs to the signed-in resident. */
export async function deleteWorkOrderForResident(workOrderId, resident) {
  return deleteWorkOrderForResidentSupabase(workOrderId, resident)
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

function extractAttachmentUrl(uploadResponse, fieldName) {
  const fields = uploadResponse?.fields || uploadResponse?.record?.fields || {}
  const attachments = fields?.[fieldName]
  if (!Array.isArray(attachments)) return ''
  const first = attachments.find((item) => typeof item?.url === 'string' && item.url.trim())
  return first?.url?.trim() || ''
}

function isUnknownAttachmentFieldError(message) {
  return /unknown field name|field .* does not exist|cannot find field/i.test(String(message || ''))
}

const LEASE_VERSION_ATTACHMENT_FIELDS = ['PDF File', 'PDF', 'Attachment', 'File']

async function writeLeaseVersionCreateOrPatch({ recordId, coreFields, uploaderMeta }) {
  const { name, role, isoTime, recordId: uploaderRecordId } = uploaderMeta
  const path = recordId
    ? `${BASE_URL}/${encodeURIComponent('Lease Versions')}/${recordId}`
    : `${BASE_URL}/${encodeURIComponent('Lease Versions')}`
  const method = recordId ? 'PATCH' : 'POST'
  const run = async (fields) =>
    mapRecord(
      await request(path, {
        method,
        body: JSON.stringify({ fields, typecast: true }),
      }),
    )
  const firstFields = {
    ...coreFields,
    ...leaseVersionLegacyUploaderPayload({ name, role, isoTime }),
  }
  try {
    return await run(firstFields)
  } catch (err) {
    const unknown = airtableUnknownFieldNameFromErrorMessage(err.message)
    if (!unknown || !isLeaseVersionUploaderOrDateUnknownField(unknown)) throw err
    const nextFields = {
      ...stripLeaseVersionUploaderFieldVariants(firstFields),
      ...leaseVersionDocUploaderPayload({ name, isoTime, uploaderRecordId }),
    }
    return await run(nextFields)
  }
}

async function patchLeaseVersionFinalizeFields({ recordId, corePatch, uploaderMeta }) {
  const isoTime = new Date().toISOString()
  const path = `${BASE_URL}/${encodeURIComponent('Lease Versions')}/${recordId}`
  const firstFields = { ...corePatch, 'Upload Date': isoTime }
  const run = async (fields) =>
    mapRecord(
      await request(path, {
        method: 'PATCH',
        body: JSON.stringify({ fields, typecast: true }),
      }),
    )
  try {
    return await run(firstFields)
  } catch (err) {
    const unknown = airtableUnknownFieldNameFromErrorMessage(err.message)
    if (!unknown || !isLeaseVersionUploaderOrDateUnknownField(unknown)) throw err
    const { name, role, recordId: uploaderRecordId } = uploaderMeta
    const nextFields = {
      ...stripLeaseVersionUploaderFieldVariants(firstFields),
      ...leaseVersionDocUploaderPayload({ name, isoTime, uploaderRecordId }),
    }
    return await run(nextFields)
  }
}

export async function createWorkOrder(args) {
  return createWorkOrderSupabase(args)
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

/** Appended to base portal thread keys so each **new compose** is a distinct conversation (replies reuse the full key). */
const PORTAL_INBOX_UNIQUE_THREAD_SEG = ':t:'

export function portalInboxNewThreadSegment() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${PORTAL_INBOX_UNIQUE_THREAD_SEG}${crypto.randomUUID()}`
  }
  return `${PORTAL_INBOX_UNIQUE_THREAD_SEG}${Date.now()}-${Math.random().toString(36).slice(2, 12)}`
}

/** New manager ↔ Axis (site-manager lane) conversation — do not reuse {@link siteManagerThreadKey} for new compose. */
export function siteManagerConversationThreadKey(managerEmail) {
  const base = siteManagerThreadKey(managerEmail)
  if (!base) return ''
  return `${base}${portalInboxNewThreadSegment()}`
}

/** New admin ↔ manager (management lane) conversation. */
export function managementAdminConversationThreadKey(managementEmail) {
  const base = managementAdminThreadKey(managementEmail)
  if (!base) return ''
  return `${base}${portalInboxNewThreadSegment()}`
}

/**
 * True when a Messages row belongs to this manager's Axis site-manager inbox lane
 * (legacy single key {@link siteManagerThreadKey} or a per-compose `…:t:…` thread).
 */
export function messageMatchesSiteManagerAxisLane(record, managerEmail) {
  const axis = siteManagerThreadKey(managerEmail)
  if (!axis) return false
  const tk = String(portalInboxThreadKeyFromRecord(record) || '').trim()
  if (!tk) return false
  return tk === axis || tk.startsWith(`${axis}${PORTAL_INBOX_UNIQUE_THREAD_SEG}`)
}

/**
 * Stable grouping id for inbox lists. Rows without a Thread Key never merge with each other or with keyed threads.
 */
export function portalInboxThreadIdentityForGrouping(record) {
  const tk = String(portalInboxThreadKeyFromRecord(record) || '').trim()
  if (tk) return tk
  const id = String(record?.id || '').trim()
  return id ? `orphan:message:${id}` : 'orphan:message:unknown'
}

const RESIDENT_LEASING_PREFIX = 'internal:resident-leasing:'
/** Appended segment so a new Messages thread can start after the resident trashes the prior one (`:s:` + unix ms). */
const RESIDENT_THREAD_SEGMENT = ':s:'

/** Stable base thread id: resident ↔ house team (one base key per resident; optional `:s:`… segments for new threads). */
export function residentLeasingThreadKey(residentRecordId) {
  const id = String(residentRecordId || '').trim()
  if (!id) return ''
  return `${RESIDENT_LEASING_PREFIX}${id}`
}

/** Next thread key after trash / fresh conversation — same resident, new Messages rows. */
export function nextResidentLeasingThreadKey(residentRecordId) {
  const base = residentLeasingThreadKey(residentRecordId)
  if (!base) return ''
  return `${base}${RESIDENT_THREAD_SEGMENT}${Date.now()}`
}

export function parseResidentLeasingThreadKey(threadKey) {
  const t = String(threadKey || '').trim()
  if (!t.startsWith(RESIDENT_LEASING_PREFIX)) return ''
  const rest = t.slice(RESIDENT_LEASING_PREFIX.length).trim()
  if (!rest) return ''
  const seg = `${RESIDENT_THREAD_SEGMENT}`
  const idx = rest.lastIndexOf(seg)
  if (idx <= 0) return rest
  const after = rest.slice(idx + seg.length)
  if (/^\d+$/.test(after)) return rest.slice(0, idx)
  return rest
}

const RESIDENT_ADMIN_PREFIX = 'internal:resident-admin:'

/** Resident ↔ Axis admin (separate from house-team leasing thread). */
export function residentAdminThreadKey(residentRecordId) {
  const id = String(residentRecordId || '').trim()
  if (!id) return ''
  return `${RESIDENT_ADMIN_PREFIX}${id}`
}

export function nextResidentAdminThreadKey(residentRecordId) {
  const base = residentAdminThreadKey(residentRecordId)
  if (!base) return ''
  return `${base}${RESIDENT_THREAD_SEGMENT}${Date.now()}`
}

export function parseResidentAdminThreadKey(threadKey) {
  const t = String(threadKey || '').trim()
  if (!t.startsWith(RESIDENT_ADMIN_PREFIX)) return ''
  const rest = t.slice(RESIDENT_ADMIN_PREFIX.length).trim()
  if (!rest) return ''
  const seg = `${RESIDENT_THREAD_SEGMENT}`
  const idx = rest.lastIndexOf(seg)
  if (idx <= 0) return rest
  const after = rest.slice(idx + seg.length)
  if (/^\d+$/.test(after)) return rest.slice(0, idx)
  return rest
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

/** New public property inquiry to Admin (each submit = new thread). */
export function housingPublicAdminPropertyConversationThread(propertyRecordId) {
  const base = housingPublicAdminPropertyThread(propertyRecordId)
  if (!base) return ''
  return `${base}${portalInboxNewThreadSegment()}`
}

/** New general public inquiry to Admin (no property selected). */
export function housingPublicAdminGeneralConversationThread() {
  return `${HOUSING_PUBLIC_ADMIN_GENERAL_THREAD}${portalInboxNewThreadSegment()}`
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

/** All Messages rows whose thread key starts with `prefix` (base thread + `:s:`… segments). */
export async function getMessagesByThreadKeyPrefix(prefix) {
  if (!messageFieldNameConfigured(MESSAGE_THREAD_KEY_FIELD)) {
    throw new Error('Configure the Messages thread-key field name in your project environment and add that field on the Messages table.')
  }
  const p = String(prefix || '').trim()
  if (!p) return []
  const esc = escapeFormulaValue(p)
  const len = esc.length
  const f = `{${MESSAGE_THREAD_KEY_FIELD}}`
  const formula = `LEFT(${f} & "", ${len}) = "${esc}"`
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
    'Sender Email': String(senderEmail || '').trim(),
    'Is Admin': isAdmin,
  }
  if (MESSAGE_TIMESTAMP_FIELD) {
    fields[MESSAGE_TIMESTAMP_FIELD] = new Date().toISOString()
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

  let payload = { ...fields }
  let lastErr = null
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const data = await request(tableUrl(TABLES.messages), {
        method: 'POST',
        body: JSON.stringify({
          fields: payload,
          typecast: true,
        }),
      })
      return mapRecord(data)
    } catch (err) {
      lastErr = err
      const unknown = airtableUnknownFieldNameFromErrorMessage(err?.message)
      if (unknown && Object.prototype.hasOwnProperty.call(payload, unknown)) {
        const next = { ...payload }
        delete next[unknown]
        payload = next
        console.warn(`[sendMessage] Messages has no field "${unknown}" — omitting and retrying.`)
        continue
      }
      const nonWritable = airtableComputedOrReadOnlyFieldFromErrorMessage(err?.message)
      if (nonWritable && Object.prototype.hasOwnProperty.call(payload, nonWritable)) {
        const next = { ...payload }
        delete next[nonWritable]
        payload = next
        console.warn(
          `[sendMessage] Field "${nonWritable}" is computed/read-only — omitting and retrying (use record created time for ordering, or set VITE_AIRTABLE_MESSAGE_TIMESTAMP_FIELD to a writable date field).`,
        )
        continue
      }
      throw err
    }
  }

  throw lastErr || new Error('Could not create message.')
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

/**
 * Linked-record field on the **Payments** table that points at the resident profile row.
 * Defaults to `Resident`. Set `VITE_AIRTABLE_PAYMENTS_RESIDENT_LINK_FIELD` if your base uses e.g. `Resident Profile`
 * so portal filters and creates stay aligned.
 */
export function paymentsResidentLinkFieldName() {
  const raw = import.meta.env.VITE_AIRTABLE_PAYMENTS_RESIDENT_LINK_FIELD
  const t = raw !== undefined ? String(raw).trim() : ''
  return t || 'Resident'
}

function paymentsResidentFieldFormulaRef() {
  const name = paymentsResidentLinkFieldName().replace(/[}]/g, '')
  return `{${name}}`
}

/**
 * Fields object for PATCH/POST on Payments: sets the configured resident link field to `[residentRecordId]`.
 */
export function buildPaymentResidentLinkFields(residentRecordId) {
  const rid = String(residentRecordId || '').trim()
  if (!rid) return {}
  const f = paymentsResidentLinkFieldName()
  return { [f]: [rid] }
}

/**
 * Linked-record field on **Payments** pointing at Properties (optional).
 * Defaults to `Property`. Set `VITE_AIRTABLE_PAYMENTS_PROPERTY_LINK_FIELD` if your base differs.
 */
export function paymentsPropertyLinkFieldName() {
  const raw = import.meta.env.VITE_AIRTABLE_PAYMENTS_PROPERTY_LINK_FIELD
  const t = raw !== undefined ? String(raw).trim() : ''
  return t || 'Property'
}

/** Include when creating/updating Payments rows so manager filters by property link stay accurate. */
export function buildPaymentPropertyLinkFields(propertyRecordId) {
  const pid = String(propertyRecordId || '').trim()
  if (!/^rec[a-zA-Z0-9]{14,}$/.test(pid)) return {}
  const f = paymentsPropertyLinkFieldName()
  return { [f]: [pid] }
}

/** Map Airtable Payments rows so `record.Resident` is always the linked profile id array when the base uses another link column name. */
export function normalizePaymentsMappedRecord(mapped) {
  if (!mapped || typeof mapped !== 'object') return mapped
  const f = paymentsResidentLinkFieldName()
  if (f === 'Resident') return mapped
  const fromLink = mapped[f]
  if (!Array.isArray(fromLink) || fromLink.length === 0) return mapped
  const first = String(fromLink[0] ?? '').trim()
  if (!/^rec[a-zA-Z0-9]{14,}$/.test(first)) return mapped
  return { ...mapped, Resident: fromLink }
}

async function resolveResidentAppUserIdForPayments(resident, rid) {
  const r = String(rid || '').trim()
  if (isInternalUuid(r)) return r
  const direct = String(resident?.['Supabase User ID'] || resident?.supabaseUserId || '').trim()
  if (isInternalUuid(direct)) return direct
  if (isAirtableRecordId(r)) {
    try {
      const full = await getResidentById(r)
      const su = String(full?.['Supabase User ID'] || '').trim()
      if (isInternalUuid(su)) return su
    } catch {
      /* ignore */
    }
  }
  return ''
}

export async function getPaymentsForResident(resident) {
  const rid = String(resident?.id || '').trim()
  if (!rid) return []

  /** Work-order / manager paths often pass `{ id }` only — load profile so email clause + filters work. */
  let res = resident && typeof resident === 'object' ? { ...resident, id: rid } : { id: rid }
  if (!String(res.Email || '').trim() && isAirtableRecordId(rid)) {
    try {
      const full = await getResidentById(rid)
      if (full && typeof full === 'object') res = { ...full, ...res, id: full.id || rid }
    } catch {
      /* keep id-only */
    }
  }

  const appUserId = await resolveResidentAppUserIdForPayments(res, rid)
  if (!appUserId) return []
  return listPaymentsMappedForResident({ preferredAppUserId: appUserId }).catch(() => [])
}

/** All payment rows — manager / admin portal (Supabase ledger, scoped server-side). */
export async function getAllPaymentsRecords() {
  const rows = await fetchStaffPaymentsRows().catch(() => [])
  return rows.map(mapInternalPaymentToResidentPaymentRow)
}

export async function updatePaymentRecord(recordId, fields) {
  const id = String(recordId || '').trim()
  if (!isSupabasePaymentRecordId(id)) {
    throw new Error(
      'Unsupported payment record id. Payments now live in Supabase — refresh the page and use rows from the internal ledger.',
    )
  }
  const cleaned = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined))
  if (Object.keys(cleaned).length === 0) throw new Error('No fields to update.')
  return patchPaymentRecordInternal(id, cleaned)
}

/** Notes marker for room-hold fee rows created from the resident portal (one row per resident; idempotent). */
export const AXIS_ROOM_HOLD_WITHOUT_LEASE_MARKER_PREFIX = 'AXIS_ROOM_HOLD_WITHOUT_LEASE:'

export function buildResidentPortalRoomHoldNotes(residentRecordId) {
  const rid = String(residentRecordId || '').trim()
  const marker = `${AXIS_ROOM_HOLD_WITHOUT_LEASE_MARKER_PREFIX}${rid}`
  return `Room hold without signing lease (resident portal). ${marker}`
}

/**
 * Payments rows for “hold without lease” from the portal: marker in Notes, or legacy Type + Notes match.
 */
export async function listResidentPortalRoomHoldPaymentRecords(residentRecordId) {
  const rid = String(residentRecordId || '').trim()
  if (!rid) return []
  const rows = await getPaymentsForResident({ id: rid }).catch(() => [])
  const list = Array.isArray(rows) ? rows : []
  const legacySub = 'room hold without signing lease (resident portal)'.toLowerCase()
  const prefix = AXIS_ROOM_HOLD_WITHOUT_LEASE_MARKER_PREFIX.toLowerCase()
  return list.filter((p) => {
    const notes = String(p.Notes || '').toLowerCase()
    if (notes.includes(prefix)) return true
    return String(p.Type || '').toLowerCase() === 'room hold fee' && notes.includes(legacySub)
  })
}

export async function deletePaymentRecord(recordId) {
  const id = String(recordId || '').trim()
  if (!isSupabasePaymentRecordId(id)) {
    throw new Error('Unsupported payment record id. Only internal payment rows can be cancelled.')
  }
  await deletePaymentRecordInternal(id)
  return { id, deleted: true }
}

/** Create a payment ledger row (manager / system). Fields use the legacy Airtable-shaped keys. */
export async function createPaymentRecord(fields) {
  const cleaned = Object.fromEntries(Object.entries(fields || {}).filter(([, v]) => v !== undefined))
  if (Object.keys(cleaned).length === 0) throw new Error('No fields to create payment.')
  return createPaymentRecordInternal(cleaned)
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

/**
 * True when a property should appear on the public site (carousel, axis-rec slug pages).
 * Requires Approved; excludes unlisted (Listed = false or admin listing status unlisted/inactive).
 */
export function propertyListingVisibleForMarketing(rec) {
  if (!rec || typeof rec !== 'object') return false
  if (!(rec.Approved === true || rec.Approved === 1)) return false
  const approval = String(rec['Approval Status'] || '').trim().toLowerCase()
  if (
    approval === 'changes requested' ||
    approval === 'changes_requested' ||
    approval === 'rejected' ||
    approval === 'unlisted' ||
    approval === 'inactive'
  ) {
    return false
  }
  const listed = rec.Listed
  if (listed === false || listed === 0) return false
  const axis = String(rec['Axis Admin Listing Status'] || rec['Admin Listing Status'] || '')
    .trim()
    .toLowerCase()
  if (axis === 'unlisted' || axis === 'inactive') return false
  if (
    axis === 'changes requested' ||
    axis === 'changes_requested' ||
    axis === 'rejected'
  ) {
    return false
  }
  return true
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
    return (data.records || [])
      .map(mapRecord)
      .filter(propertyListingVisibleForMarketing)
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

/** When `File.type` is empty or generic, infer a MIME type from the filename (AVIF, HEIC, etc.). */
function inferPropertyPhotoContentType(file) {
  const explicit = String(file?.type || '').trim()
  if (explicit && explicit !== 'application/octet-stream') return explicit
  const name = String(file?.name || '').toLowerCase()
  const dot = name.lastIndexOf('.')
  const ext = dot >= 0 ? name.slice(dot) : ''
  const byExt = {
    '.avif': 'image/avif',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
    '.webp': 'image/webp',
    '.jxl': 'image/jxl',
    '.jp2': 'image/jp2',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.tif': 'image/tiff',
    '.tiff': 'image/tiff',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.m4v': 'video/x-m4v',
    '.avi': 'video/x-msvideo',
  }
  return byExt[ext] || explicit || 'application/octet-stream'
}

/**
 * Upload a property-scoped image.
 * - **Legacy** `rec…` property ids: Airtable attachment upload on the configured Photos field.
 * - **Internal** UUID `properties.id`: Supabase Storage + `property_images` via `/api/file-storage`
 *   (manager/owner/admin session). Optional `options` map to metadata (`is_cover`, `sort_order`, etc.).
 *
 * @param {string} propertyId
 * @param {File} file
 * @param {{
 *   isGallery?: boolean
 *   isCover?: boolean
 *   sortOrder?: number
 *   altText?: string | null
 *   bathroomId?: string
 *   sharedSpaceId?: string
 * }} [options]
 */
export async function uploadPropertyImage(propertyId, file, options = {}) {
  const id = String(propertyId || '').trim()
  if (isInternalAxisRecordId(id)) {
    const row = await uploadPropertyImageInternal({
      propertyId: id,
      file,
      isGallery: options.isGallery !== false,
      isCover: Boolean(options.isCover),
      sortOrder: Number.isFinite(Number(options.sortOrder)) ? Number(options.sortOrder) : 0,
      altText: options.altText != null ? options.altText : null,
      bathroomId: options.bathroomId,
      sharedSpaceId: options.sharedSpaceId,
    })
    const url = row?.id ? await publicUrlForPropertyImage(row.id) : ''
    const photosField = getConfiguredPropertyPhotosFieldName()
    return {
      __fromInternalFileStorage: true,
      id: row?.id,
      fields: {
        [photosField]: [{ url, filename: row?.file_name || file.name }],
        Photos: [{ url, filename: row?.file_name || file.name }],
      },
    }
  }
  const formData = new FormData()
  formData.append('file', file, file.name)
  formData.append('filename', file.name)
  formData.append('contentType', inferPropertyPhotoContentType(file))
  const photosField = getConfiguredPropertyPhotosFieldName()
  const response = await fetch(
    `https://content.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLES.properties)}/${propertyId}/${encodeURIComponent(photosField)}/uploadAttachment`,
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

/** URL of the last property photo attachment after a content upload (shape varies by Airtable API version). */
export function pickLastPropertyPhotoUrlFromUploadResponse(resp) {
  const field = getConfiguredPropertyPhotosFieldName()
  try {
    const photos = resp?.fields?.[field] ?? resp?.[field] ?? resp?.fields?.Photos ?? resp?.Photos
    if (!Array.isArray(photos) || !photos.length) return ''
    const last = photos[photos.length - 1]
    if (typeof last === 'string') return last.trim()
    return String(last?.url || '').trim()
  } catch {
    return ''
  }
}

/**
 * Merge uploaded image URLs into `sharedSpacesDetail[slotIndex].imageUrls` inside Other Info meta.
 * Call after {@link uploadPropertyImage} for each shared-space file (`axis-ss{n}-…` filenames on Photos).
 */
export async function patchPropertySharedSpaceDetailImageUrls(propertyId, urlsBySlotIndex) {
  const id = String(propertyId || '').trim()
  if (!urlsBySlotIndex || typeof urlsBySlotIndex !== 'object') return null
  const entries = Object.entries(urlsBySlotIndex).filter(([, v]) => Array.isArray(v) && v.some((u) => String(u || '').trim()))
  if (!entries.length) return null

  if (isInternalAxisRecordId(id)) {
    const { data: sess } = await supabase.auth.getSession()
    const token = sess?.session?.access_token
    if (!token) throw new Error('Sign in with your portal account to update shared-space photos.')

    const authH = { Authorization: `Bearer ${token}` }
    const getRes = await fetch(`/api/properties?id=${encodeURIComponent(id)}`, { headers: authH })
    const getJson = await getRes.json().catch(() => ({}))
    if (!getRes.ok) throw new Error(getJson?.error || `Could not load property (${getRes.status}).`)

    const rawOther = String(getJson.property?.notes ?? '')
    const { userText, meta } = parseAxisListingMetaBlock(rawOther)
    const m = meta && typeof meta === 'object' ? { ...meta } : {}
    const detail = Array.isArray(m.sharedSpacesDetail) ? [...m.sharedSpacesDetail] : []
    for (const [slotKey, urls] of entries) {
      const idx = Number(slotKey)
      if (!Number.isFinite(idx) || idx < 0) continue
      const add = urls.map((u) => String(u || '').trim()).filter(Boolean)
      if (!add.length) continue
      const cur = detail[idx] && typeof detail[idx] === 'object' ? { ...detail[idx] } : { title: `Shared space ${idx + 1}` }
      const prev = Array.isArray(cur.imageUrls) ? cur.imageUrls.map((u) => String(u || '').trim()).filter(Boolean) : []
      cur.imageUrls = [...new Set([...prev, ...add])]
      detail[idx] = cur
    }
    m.sharedSpacesDetail = detail
    const nextNotes = mergeAxisListingMetaIntoOtherInfo(userText, m)
    const patchRes = await fetch(`/api/properties?id=${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { ...authH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: nextNotes }),
    })
    const patchJson = await patchRes.json().catch(() => ({}))
    if (!patchRes.ok) throw new Error(patchJson?.error || `Could not update property notes (${patchRes.status}).`)
    return patchJson.property || null
  }

  if (!/^rec[a-zA-Z0-9]{14,}$/.test(id)) throw new Error('Invalid property id.')

  const data = await request(`${BASE_URL}/${encodeURIComponent(TABLES.properties)}/${encodeURIComponent(id)}`)
  const rec = mapRecord(data)
  const rawOther = String(rec['Other Info'] ?? '')
  const { userText, meta } = parseAxisListingMetaBlock(rawOther)
  const m = meta && typeof meta === 'object' ? { ...meta } : {}
  const detail = Array.isArray(m.sharedSpacesDetail) ? [...m.sharedSpacesDetail] : []
  for (const [slotKey, urls] of entries) {
    const idx = Number(slotKey)
    if (!Number.isFinite(idx) || idx < 0) continue
    const add = urls.map((u) => String(u || '').trim()).filter(Boolean)
    if (!add.length) continue
    const cur = detail[idx] && typeof detail[idx] === 'object' ? { ...detail[idx] } : { title: `Shared space ${idx + 1}` }
    const prev = Array.isArray(cur.imageUrls) ? cur.imageUrls.map((u) => String(u || '').trim()).filter(Boolean) : []
    cur.imageUrls = [...new Set([...prev, ...add])]
    detail[idx] = cur
  }
  m.sharedSpacesDetail = detail
  const nextOther = mergeAxisListingMetaIntoOtherInfo(userText, m)
  const updated = await request(`${BASE_URL}/${encodeURIComponent(TABLES.properties)}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: { 'Other Info': nextOther }, typecast: true }),
  })
  return mapRecord(updated)
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
  return getAllWorkOrdersSupabase()
}

/** All internal residents (Supabase). Used to scope manager work orders by resident → property. */
export async function listAllResidentsRecords() {
  return fetchStaffResidentsLegacyList()
}

export async function getWorkOrderById(recordId) {
  return getWorkOrderByIdSupabase(recordId)
}

/** PATCH any Work Orders fields. Omits undefined entries. */
export async function updateWorkOrder(recordId, fields) {
  const cleaned = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined))
  return updateWorkOrderSupabase(recordId, cleaned)
}

/** Append to Work Orders "Update" and set "Last Update" (date) when a resident sends a message. */
export async function appendWorkOrderUpdateFromResident(workOrderId, residentEmail, message) {
  return appendWorkOrderUpdateFromResidentSupabase(workOrderId, residentEmail, message)
}

export async function updateWorkOrderStatus(recordId, status) {
  return updateWorkOrderStatusSupabase(recordId, status)
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

/** Applications table may live on {@link VITE_AIRTABLE_APPLICATIONS_BASE_ID} when set. */
function applicationsV0BaseUrl() {
  const alt = String(import.meta.env.VITE_AIRTABLE_APPLICATIONS_BASE_ID || '').trim()
  return `https://api.airtable.com/v0/${alt || BASE_ID}`
}

/**
 * All application rows for a manager (Owner ID), including pending — for lease-draft gating.
 * @param {string} ownerId Manager Profile Airtable record id
 */
export async function getApplicationsForOwner(ownerId) {
  const id = String(ownerId || '').trim()
  if (!id.startsWith('rec') || !API_KEY) return []
  const root = `${applicationsV0BaseUrl()}/${encodeURIComponent(applicationsTableName())}`
  const allRecords = []
  let offset = null
  do {
    const url = new URL(root)
    url.searchParams.set('filterByFormula', `{Owner ID} = "${escapeFormulaValue(id)}"`)
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
  return getAllAnnouncementsAdminSupabase()
}

export async function createAnnouncement(fields) {
  return createAnnouncementSupabase(fields)
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
      subject: head,
    })
  }

  return rec
}

export async function updateAnnouncement(recordId, fields) {
  return updateAnnouncementSupabase(recordId, fields)
}

export async function deleteAnnouncement(recordId) {
  await deleteAnnouncementSupabase(recordId)
}

// ---------------------------------------------------------------------------
// Lease Drafts — resident-facing read (Supabase `/api/lease-drafts` only)
// ---------------------------------------------------------------------------

// Returns the most recent published (or signed) lease draft for dashboard /
// snapshots. `residentRecordId` / `residentEmail` are ignored — visibility is enforced server-side from the JWT.
export async function getApprovedLeaseForResident(residentRecordId, residentEmail = '') {
  void residentRecordId
  void residentEmail
  const { data: sess } = await supabase.auth.getSession()
  if (!sess?.session?.access_token) return null
  try {
    return await getApprovedLeaseForResidentSupabase()
  } catch (err) {
    console.warn('[getApprovedLeaseForResident]', err?.message || err)
    return null
  }
}

/**
 * All lease draft rows for the signed-in applicant (any status), newest first.
 * @param {string} residentRecordId legacy param (ignored; use Supabase session)
 * @param {string} [residentEmail] legacy param (ignored)
 */
export async function getLeaseDraftsForResident(residentRecordId, residentEmail = '') {
  void residentRecordId
  void residentEmail
  const { data: sess } = await supabase.auth.getSession()
  if (!sess?.session?.access_token) return []
  try {
    return await getLeaseDraftsForResidentSupabase()
  } catch (err) {
    console.warn('[getLeaseDraftsForResident]', err?.message || err)
    return []
  }
}

export async function getLeaseDraftById(leaseDraftId) {
  const id = String(leaseDraftId || '').trim()
  if (isLeaseDraftUuid(id)) {
    const row = await getLeaseDraftByIdSupabase(id)
    if (!row) throw new Error('Lease draft not found.')
    return row
  }
  throw new Error('Lease drafts are stored in Supabase only — expected a UUID lease draft id.')
}

export async function updateLeaseDraftRecord(leaseDraftId, fields) {
  const id = String(leaseDraftId || '').trim()
  if (isLeaseDraftUuid(id)) {
    return updateLeaseDraftRecordSupabase(id, fields)
  }
  if (!/^rec[a-zA-Z0-9]{14,}$/.test(id)) throw new Error('Invalid lease draft ID.')
  const cleaned = Object.fromEntries(Object.entries(fields || {}).filter(([, value]) => value !== undefined))
  if (Object.keys(cleaned).length === 0) throw new Error('No lease draft fields to update.')
  const data = await request(`${BASE_URL}/${encodeURIComponent('Lease Drafts')}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: cleaned, typecast: true }),
  })
  return mapRecord(data)
}

/**
 * Prefer PATCH via POST /api/portal?action=lease-draft-patch (server Airtable token on Vercel).
 * Falls back to {@link updateLeaseDraftRecord} when the route is missing or fails and a browser token exists.
 *
 * @param {string} leaseDraftId
 * @param {Record<string, unknown>} fields — whitelisted keys on the server (e.g. Allow Sign Without Move-In Pay)
 * @param {{ managerRecordId?: string }} [options] — manager Airtable id for tenant enforcement; omit for internal admin
 */
export async function patchLeaseDraftRecordPreferServer(leaseDraftId, fields, options = {}) {
  const id = String(leaseDraftId || '').trim()
  if (!isLeaseDraftUuid(id) && !/^rec[a-zA-Z0-9]{14,}$/.test(id)) throw new Error('Invalid lease draft ID.')
  const cleaned = Object.fromEntries(Object.entries(fields || {}).filter(([, value]) => value !== undefined))
  if (Object.keys(cleaned).length === 0) throw new Error('No lease draft fields to update.')
  const managerRecordId = String(options.managerRecordId || '').trim()
  const runDirect = () => updateLeaseDraftRecord(id, cleaned)

  try {
    const res = await fetch(`/api/portal?action=lease-draft-patch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leaseDraftId: id, fields: cleaned, managerRecordId }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok && data.record?.id) {
      return { id: data.record.id, ...data.record }
    }
    if (res.status === 403) {
      throw new Error(data.error || 'Access denied.')
    }
    if (!(res.status === 404 || res.status === 405 || res.status >= 500)) {
      throw new Error(data.error || `Request failed (${res.status})`)
    }
  } catch (e) {
    if (!(e instanceof TypeError)) throw e
  }

  if (!API_KEY) {
    throw new Error(
      'Could not update lease draft. Configure VITE_AIRTABLE_TOKEN in the build or use hosting that provides /api/portal.',
    )
  }
  return runDirect()
}

export async function getLeaseCommentsForDraft(leaseDraftId) {
  const id = String(leaseDraftId || '').trim()
  if (isLeaseDraftUuid(id)) {
    try {
      const draft = await getLeaseDraftByIdSupabase(id)
      return getLeaseCommentsForDraftSupabase(draft)
    } catch {
      return []
    }
  }
  if (!/^rec[a-zA-Z0-9]{14,}$/.test(id)) return []
  const formula = `{Lease Draft ID} = "${escapeFormulaValue(id)}"`
  const data = await request(buildUrl('Lease Comments', {
    filterByFormula: formula,
    sort: [{ field: 'Timestamp', direction: 'asc' }],
  }))
  return (data.records || []).map(mapRecord)
}

export async function addLeaseCommentRecord({
  leaseDraftId,
  authorName,
  authorRole,
  authorRecordId = '',
  message,
}) {
  const draftId = String(leaseDraftId || '').trim()
  const text = String(message || '').trim()
  if (!text) throw new Error('Comment is required.')
  if (isLeaseDraftUuid(draftId)) {
    const res = await fetch(`/api/portal?action=lease-add-comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leaseDraftId: draftId,
        authorName,
        authorRole,
        authorRecordId,
        message: text,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Could not add comment.')
    return {
      id: data.id || `lc-${Date.now()}`,
      'Author Name': String(authorName || 'Unknown').trim() || 'Unknown',
      'Author Role': String(authorRole || 'Resident').trim() || 'Resident',
      'Author Record ID': String(authorRecordId || '').trim(),
      Message: text,
      Timestamp: new Date().toISOString(),
    }
  }
  if (!/^rec[a-zA-Z0-9]{14,}$/.test(draftId)) throw new Error('Invalid lease draft ID.')
  const data = await request(`${BASE_URL}/${encodeURIComponent('Lease Comments')}`, {
    method: 'POST',
    body: JSON.stringify({
      fields: {
        'Lease Draft ID': draftId,
        'Author Name': String(authorName || 'Unknown').trim() || 'Unknown',
        'Author Role': String(authorRole || 'Resident').trim() || 'Resident',
        'Author Record ID': String(authorRecordId || '').trim(),
        'Message': text,
        'Timestamp': new Date().toISOString(),
      },
      typecast: true,
    }),
  })
  return mapRecord(data)
}

/** Count unread Lease Notifications for a manager profile record (paginates past 100 rows). */
export async function countUnreadLeaseNotificationsForManager(managerRecordId) {
  const id = String(managerRecordId || '').trim()
  if (!/^rec[a-zA-Z0-9]{14,}$/.test(id)) return 0
  const formula = `AND({Recipient Record ID}="${escapeFormulaValue(id)}", NOT({Is Read}))`
  let total = 0
  let offset = null
  do {
    const url = new URL(buildUrl('Lease Notifications', { filterByFormula: formula }))
    if (offset) url.searchParams.set('offset', offset)
    const data = await request(url.toString())
    total += (data.records || []).length
    offset = data.offset || null
  } while (offset)
  return total
}

export async function createLeaseNotification({ recipientRecordId, recipientRole, leaseDraftId, message, actionType = 'comment-added' }) {
  const recipientId = String(recipientRecordId || '').trim()
  const draftId = String(leaseDraftId || '').trim()
  const text = String(message || '').trim()
  if (!recipientId || !draftId || !text) return null
  const data = await request(`${BASE_URL}/${encodeURIComponent('Lease Notifications')}`, {
    method: 'POST',
    body: JSON.stringify({
      fields: {
        'Recipient Record ID': recipientId,
        'Recipient Role': String(recipientRole || '').trim() || 'manager',
        'Lease Draft ID': draftId,
        'Message': text,
        'Action Type': actionType,
        'Is Read': false,
        'Created At': new Date().toISOString(),
      },
      typecast: true,
    }),
  })
  return mapRecord(data)
}

export async function getCurrentLeaseVersion(leaseDraftId) {
  const id = String(leaseDraftId || '').trim()
  if (isLeaseDraftUuid(id)) {
    try {
      const draft = await getLeaseDraftByIdSupabase(id)
      const v = getCurrentLeaseVersionSupabase(draft)
      if (!v) return null
      const raw = String(draft?.current_pdf_url || '').trim()
      if (raw.startsWith('leasefile:')) {
        const fileId = raw.slice('leasefile:'.length).trim()
        if (fileId) {
          try {
            const signed = await signedDownloadLeaseFile(fileId, 60 * 60 * 12)
            if (signed) return { ...v, 'PDF URL': signed }
          } catch {
            /* fall through to stored URL */
          }
        }
      }
      return v
    } catch {
      return null
    }
  }
  if (!/^rec[a-zA-Z0-9]{14,}$/.test(id)) return null
  const formula = `{Lease Draft ID} = "${escapeFormulaValue(id)}"`
  const data = await request(buildUrl('Lease Versions', {
    filterByFormula: formula,
    sort: [{ field: 'Version Number', direction: 'desc' }],
  }))
  const rows = (data.records || []).map(mapRecord)
  return rows.find((row) => Boolean(row['Is Current'])) || rows[0] || null
}

export async function upsertCurrentLeaseVersion({
  leaseDraftId,
  pdfUrl,
  fileName,
  notes = '',
  uploaderName,
  uploaderRole,
  uploaderRecordId = '',
}) {
  const draftId = String(leaseDraftId || '').trim()
  const nextPdfUrl = String(pdfUrl || '').trim()
  if (!nextPdfUrl) throw new Error('PDF URL is required.')

  if (isLeaseDraftUuid(draftId)) {
    const draft = await getLeaseDraftByIdSupabase(draftId)
    if (!draft) throw new Error('Lease draft not found.')
    const versionNumber = Number(draft['Current Version'] || 1) || 1
    void notes
    void uploaderName
    void uploaderRole
    void uploaderRecordId
    await updateLeaseDraftRecordSupabase(draftId, {
      current_pdf_url: nextPdfUrl,
      current_pdf_file_name: String(fileName || '').trim() || `lease-v${versionNumber}.pdf`,
      'Current Version': versionNumber,
    })
    return getCurrentLeaseVersion(draftId)
  }

  if (!/^rec[a-zA-Z0-9]{14,}$/.test(draftId)) throw new Error('Invalid lease draft ID.')

  const draft = await getLeaseDraftById(draftId)
  const current = await getCurrentLeaseVersion(draftId)
  const versionNumber = Number(current?.['Version Number'] || draft?.['Current Version'] || 1) || 1
  const isoTime = new Date().toISOString()
  const coreFields = {
    'Lease Draft ID': draftId,
    'Version Number': versionNumber,
    'PDF URL': nextPdfUrl,
    'File Name': String(fileName || '').trim() || `lease-v${versionNumber}.pdf`,
    'Notes': String(notes || '').trim(),
    'Is Current': true,
  }

  const saved = await writeLeaseVersionCreateOrPatch({
    recordId: current?.id || null,
    coreFields,
    uploaderMeta: {
      name: uploaderName,
      role: uploaderRole,
      isoTime,
      recordId: uploaderRecordId,
    },
  })

  await updateLeaseDraftRecord(draftId, {
    'Current Version': versionNumber,
    'Updated At': new Date().toISOString(),
  }).catch(() => null)

  return saved
}

export async function uploadLeaseVersionPdfFile({
  leaseDraftId,
  file,
  notes = '',
  uploaderName,
  uploaderRole,
  uploaderRecordId = '',
}) {
  const draftId = String(leaseDraftId || '').trim()
  const nextFile = file
  const nextFileName = String(nextFile?.name || '').trim()
  if (!isLeaseDraftUuid(draftId) && !/^rec[a-zA-Z0-9]{14,}$/.test(draftId)) throw new Error('Invalid lease draft ID.')
  if (!nextFile || typeof nextFile !== 'object' || !nextFileName) throw new Error('PDF file is required.')
  if (!/\.pdf$/i.test(nextFileName) && String(nextFile?.type || '').trim() !== 'application/pdf') {
    throw new Error('Select a PDF file.')
  }

  if (isLeaseDraftUuid(draftId)) {
    const draft = await getLeaseDraftByIdSupabase(draftId)
    if (!draft) throw new Error('Lease draft not found.')
    const appId = String(draft['Application Record ID'] || '').trim()
    if (!INTERNAL_AXIS_UUID_RE.test(appId)) {
      throw new Error('This lease draft is missing a linked application id for file storage.')
    }
    void notes
    void uploaderName
    void uploaderRole
    void uploaderRecordId
    const row = await uploadLeaseFileInternal({
      applicationId: appId,
      file: nextFile,
      leaseId: draftId,
      fileKind: 'lease-draft-pdf',
      variant: 'lease-draft-version',
    })
    const fileId = String(row?.id || '').trim()
    if (!fileId) throw new Error('Upload did not return a file id.')
    const versionNumber = Number(draft['Current Version'] || 1) || 1
    await updateLeaseDraftRecordSupabase(draftId, {
      current_pdf_url: `leasefile:${fileId}`,
      current_pdf_file_name: nextFileName || `lease-v${versionNumber}.pdf`,
      'Current Version': versionNumber,
    })
    return getCurrentLeaseVersion(draftId)
  }

  const draft = await getLeaseDraftById(draftId)
  const current = await getCurrentLeaseVersion(draftId)
  const versionNumber = Number(current?.['Version Number'] || draft?.['Current Version'] || 1) || 1
  const existingPdfUrl = String(current?.['PDF URL'] || '').trim()
  const isoTime = new Date().toISOString()
  const coreFields = {
    'Lease Draft ID': draftId,
    'Version Number': versionNumber,
    'File Name': nextFileName || `lease-v${versionNumber}.pdf`,
    'Notes': String(notes || '').trim(),
    'Is Current': true,
  }
  if (existingPdfUrl) coreFields['PDF URL'] = existingPdfUrl

  const uploaderMeta = {
    name: uploaderName,
    role: uploaderRole,
    isoTime,
    recordId: uploaderRecordId,
  }

  const saved = await writeLeaseVersionCreateOrPatch({
    recordId: current?.id || null,
    coreFields,
    uploaderMeta,
  })

  let uploadedUrl = ''
  let lastFieldError = null
  for (const fieldName of LEASE_VERSION_ATTACHMENT_FIELDS) {
    try {
      const uploadResponse = await uploadAttachmentToRecord('Lease Versions', saved.id, fieldName, nextFile)
      uploadedUrl = extractAttachmentUrl(uploadResponse, fieldName)
      if (!uploadedUrl) {
        const refreshed = await request(`${BASE_URL}/${encodeURIComponent('Lease Versions')}/${saved.id}`)
        uploadedUrl = extractAttachmentUrl(refreshed, fieldName)
      }
      if (uploadedUrl) break
      lastFieldError = new Error(`Uploaded PDF but could not read URL from ${fieldName}.`)
    } catch (err) {
      lastFieldError = err
      if (isUnknownAttachmentFieldError(err?.message)) continue
      throw err
    }
  }

  if (!uploadedUrl) {
    throw lastFieldError || new Error('Could not upload PDF file. Add a PDF attachment field to Lease Versions.')
  }

  const finalized = await patchLeaseVersionFinalizeFields({
    recordId: saved.id,
    corePatch: {
      'PDF URL': uploadedUrl,
      'File Name': nextFileName || saved['File Name'] || `lease-v${versionNumber}.pdf`,
      'Notes': String(notes || '').trim(),
      'Is Current': true,
    },
    uploaderMeta,
  })

  await updateLeaseDraftRecord(draftId, {
    'Current Version': versionNumber,
    'Updated At': new Date().toISOString(),
  }).catch(() => null)

  return finalized
}

export async function submitResidentLeaseChangeRequest({
  draft,
  resident,
  message,
  pdfUrl = '',
  fileName = '',
}) {
  const draftId = String(draft?.id || '').trim()
  const text = String(message || '').trim()
  if (!isLeaseDraftUuid(draftId) && !/^rec[a-zA-Z0-9]{14,}$/.test(draftId)) throw new Error('Invalid lease draft ID.')
  if (!text) throw new Error('Please describe the lease change you need.')

  if (isLeaseDraftUuid(draftId)) {
    const email = String(resident?.Email || '').trim().toLowerCase()
    if (!email) throw new Error('Missing resident email — cannot submit change request.')
    if (String(pdfUrl || '').trim()) {
      throw new Error(
        'Attaching a PDF with this request is not supported for internal lease drafts yet. Use the lease PDF upload in the portal, or describe the change in text.',
      )
    }
    const res = await fetch('/api/portal?action=lease-resident-add-comment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leaseDraftId: draftId,
        residentRecordId: String(resident?.id || '').trim(),
        residentEmail: email,
        authorName: resident?.Name || resident?.Email || 'Resident',
        message: text,
        alsoSetStatus: 'Changes Needed',
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Could not submit change request.')
    await createLeaseNotification({
      recipientRecordId: draft?.['Owner ID'] || '',
      recipientRole: 'manager',
      leaseDraftId: draftId,
      message: `${resident?.Name || 'Resident'} requested lease changes: ${text.length > 220 ? `${text.slice(0, 220)}…` : text}`,
      actionType: 'resident-requested-changes',
    }).catch(() => null)
    return getLeaseDraftById(draftId)
  }

  await addLeaseCommentRecord({
    leaseDraftId: draftId,
    authorName: resident?.Name || resident?.Email || 'Resident',
    authorRole: 'Resident',
    authorRecordId: resident?.id || '',
    message: text,
  })

  if (String(pdfUrl || '').trim()) {
    await upsertCurrentLeaseVersion({
      leaseDraftId: draftId,
      pdfUrl,
      fileName,
      notes: text,
      uploaderName: resident?.Name || resident?.Email || 'Resident',
      uploaderRole: 'Resident',
      uploaderRecordId: resident?.id || '',
    })
  }

  await updateLeaseDraftRecord(draftId, {
    Status: 'Changes Needed',
    'Updated At': new Date().toISOString(),
  })

  const preview = text.length > 220 ? `${text.slice(0, 220)}…` : text
  await createLeaseNotification({
    recipientRecordId: draft?.['Owner ID'] || '',
    recipientRole: 'manager',
    leaseDraftId: draftId,
    message: `${resident?.Name || 'Resident'} requested lease changes: ${preview}`,
    actionType: 'resident-requested-changes',
  }).catch(() => null)

  return getLeaseDraftById(draftId)
}

/**
 * Resident reports an issue or asks for a change — adds a lease thread comment,
 * notifies the house manager, and does **not** change lease workflow status
 * (signing can continue unless the manager updates the draft separately).
 */
export async function submitResidentLeaseIssueReport({ draft, resident, message }) {
  const draftId = String(draft?.id || '').trim()
  const text = String(message || '').trim()
  if (!isLeaseDraftUuid(draftId) && !/^rec[a-zA-Z0-9]{14,}$/.test(draftId)) throw new Error('Invalid lease draft ID.')
  if (!text) throw new Error('Please describe the issue or change you need.')

  if (isLeaseDraftUuid(draftId)) {
    const email = String(resident?.Email || '').trim().toLowerCase()
    if (!email) throw new Error('Missing resident email — cannot send message.')
    const res = await fetch('/api/portal?action=lease-resident-add-comment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leaseDraftId: draftId,
        residentRecordId: String(resident?.id || '').trim(),
        residentEmail: email,
        authorName: resident?.Name || resident?.Email || 'Resident',
        message: `**Request to manager:**\n\n${text}`,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Could not send message.')
    await createLeaseNotification({
      recipientRecordId: draft?.['Owner ID'] || '',
      recipientRole: 'manager',
      leaseDraftId: draftId,
      message: `${resident?.Name || 'Resident'} flagged a lease question: ${text.length > 220 ? `${text.slice(0, 220)}…` : text}`,
      actionType: 'resident-lease-issue',
    }).catch(() => null)
    return getLeaseDraftById(draftId)
  }

  await addLeaseCommentRecord({
    leaseDraftId: draftId,
    authorName: resident?.Name || resident?.Email || 'Resident',
    authorRole: 'Resident',
    authorRecordId: resident?.id || '',
    message: `**Request to manager:**\n\n${text}`,
  })

  const preview = text.length > 220 ? `${text.slice(0, 220)}…` : text
  await createLeaseNotification({
    recipientRecordId: draft?.['Owner ID'] || '',
    recipientRole: 'manager',
    leaseDraftId: draftId,
    message: `${resident?.Name || 'Resident'} flagged a lease question: ${preview}`,
    actionType: 'resident-lease-issue',
  }).catch(() => null)

  await updateLeaseDraftRecord(draftId, {
    'Updated At': new Date().toISOString(),
  }).catch(() => null)

  return getLeaseDraftById(draftId)
}

// ---------------------------------------------------------------------------
// Lease Drafts — manager / resident actions
// ---------------------------------------------------------------------------

/**
 * Publish a lease draft (manager sends to resident).
 * Sets Status → "Published" and records Sent At timestamp.
 */
export async function publishLeaseDraft(leaseDraftId) {
  const res = await fetch('/api/send-lease-to-resident', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leaseDraftId }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Could not send lease.')
  return data.draft
}

/**
 * Generate a lease draft from the resident's application using the
 * structured template (no AI). Returns the created or existing draft.
 */
export async function generateLeaseFromApplication(
  applicationRecordId,
  overrides = {},
  managerRecordId = '',
  { forceRegenerate = false } = {},
) {
  const res = await fetch('/api/generate-lease-from-template', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ applicationRecordId, overrides, managerRecordId, forceRegenerate }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Could not generate lease.')
  return { draft: data.draft, created: data.created }
}

// ---------------------------------------------------------------------------
// Blocked Tour Dates — manager block system
// Table name: "Blocked Tour Dates"
// Required fields: Property Name (text), Property ID (text), Date (text YYYY-MM-DD),
//   Manager ID (text), Manager Name (text), Reason (text), Created At (text)
// ---------------------------------------------------------------------------

/**
 * Fetch all blocked tour dates for a specific property (by Airtable property record ID).
 * Returns an array of records with at minimum: id, 'Date', 'Property Name', 'Property ID'.
 */
export async function fetchBlockedTourDates(propertyId) {
  const id = String(propertyId || '').trim()
  if (!id) return []
  const formula = `{Property ID} = "${escapeFormulaValue(id)}"`
  const data = await request(buildUrl('Blocked Tour Dates', {
    filterByFormula: formula,
    sort: [{ field: 'Date', direction: 'asc' }],
  }))
  return (data.records || []).map(mapRecord)
}

/**
 * Fetch blocked tour dates by property name (for public-facing pages that only know the property name).
 */
export async function fetchBlockedTourDatesByName(propertyName) {
  const name = String(propertyName || '').trim()
  if (!name) return []
  const formula = `{Property Name} = "${escapeFormulaValue(name)}"`
  const data = await request(buildUrl('Blocked Tour Dates', {
    filterByFormula: formula,
    sort: [{ field: 'Date', direction: 'asc' }],
  }))
  return (data.records || []).map(mapRecord)
}

/**
 * Create a new blocked tour date for a property.
 */
export async function createBlockedTourDate({ propertyId, propertyName, date, managerId, managerName, reason = '' }) {
  const fields = {
    'Property ID': String(propertyId || '').trim(),
    'Property Name': String(propertyName || '').trim(),
    'Date': String(date || '').trim(),
    'Manager ID': String(managerId || '').trim(),
    'Manager Name': String(managerName || '').trim(),
    'Reason': String(reason || '').trim(),
    'Created At': new Date().toISOString(),
  }
  const data = await request(`${BASE_URL}/${encodeURIComponent('Blocked Tour Dates')}`, {
    method: 'POST',
    body: JSON.stringify({ fields, typecast: true }),
  })
  return mapRecord(data)
}

/**
 * Delete a blocked tour date by its Airtable record ID.
 */
export async function deleteBlockedTourDate(recordId) {
  const id = String(recordId || '').trim()
  if (!/^rec[a-zA-Z0-9]{14,}$/.test(id)) throw new Error('Invalid record ID.')
  const res = await fetch(`${BASE_URL}/${encodeURIComponent('Blocked Tour Dates')}/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    let msg = `Delete failed: ${res.status}`
    try { msg = JSON.parse(body)?.error?.message || msg } catch { /* ignore */ }
    throw new Error(msg)
  }
  return res.json()
}

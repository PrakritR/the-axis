/**
 * Admin portal ↔ Airtable (browser, same base as manager: VITE_AIRTABLE_*).
 */
import {
  airtablePermissionDeniedMessage,
  responseBodyIndicatesAirtablePermissionDenied,
} from './airtablePermissionError.js'
import { getAirtableRoomsTableName } from './airtable.js'
import {
  deriveApplicationApprovalState,
  applicationDisplayLabelFromApprovalState,
  applicationRejectedFieldName,
} from './applicationApprovalState.js'

const BASE_ID = import.meta.env.VITE_AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const API_KEY = import.meta.env.VITE_AIRTABLE_TOKEN
const BASE_URL = `https://api.airtable.com/v0/${BASE_ID}`

const APPLICATIONS_TABLE =
  String(import.meta.env.VITE_AIRTABLE_APPLICATIONS_TABLE || 'Applications').trim() || 'Applications'

const TABLES = {
  properties: 'Properties',
  managers: 'Manager Profile',
  applications: APPLICATIONS_TABLE,
}

const ADMIN_PROFILE_TABLE_NAME =
  String(import.meta.env.VITE_AIRTABLE_ADMIN_PROFILE_TABLE || 'Admin Profile').trim() || 'Admin Profile'

const RESIDENT_PROFILE_TABLE = 'Resident Profile'

const RESIDENT_PROFILE_LIST_FIELDS = [
  'Name',
  'Email',
  'House',
  'Unit Number',
  'Application Approval',
  'Approved',
]

function headers() {
  return {
    Authorization: `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
  }
}

function mapRecord(record) {
  return {
    id: record.id,
    ...record.fields,
    created_at: record.createdTime,
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...headers(), ...(options.headers || {}) },
  })
  const body = await response.text()
  if (!response.ok) {
    if (responseBodyIndicatesAirtablePermissionDenied(body)) {
      throw new Error(airtablePermissionDeniedMessage(url))
    }
    try {
      const j = JSON.parse(body)
      if (j?.error?.message) throw new Error(j.error.message)
    } catch (e) {
      if (e instanceof Error && e.message && !e.message.startsWith('{')) throw e
    }
    throw new Error(body.slice(0, 400))
  }
  return body ? JSON.parse(body) : {}
}

export function isAdminPortalAirtableConfigured() {
  return Boolean(String(API_KEY || '').trim())
}

async function listAllRecords(tableName) {
  const enc = encodeURIComponent(tableName)
  const out = []
  let offset = null
  do {
    const url = new URL(`${BASE_URL}/${enc}`)
    if (offset) url.searchParams.set('offset', offset)
    const data = await requestJson(url.toString())
    for (const r of data.records || []) {
      out.push(mapRecord(r))
    }
    offset = data.offset || null
  } while (offset)
  return out
}

/** Paginated list with explicit fields (avoids returning sensitive columns e.g. Password). */
async function listTableRecordsWithFields(tableName, fieldNames) {
  const enc = encodeURIComponent(tableName)
  const out = []
  let offset = null
  do {
    const url = new URL(`${BASE_URL}/${enc}`)
    for (const f of fieldNames) {
      url.searchParams.append('fields[]', f)
    }
    if (offset) url.searchParams.set('offset', offset)
    const data = await requestJson(url.toString())
    for (const r of data.records || []) {
      out.push(mapRecord(r))
    }
    offset = data.offset || null
  } while (offset)
  return out
}

async function fetchResidentProfileRecords() {
  return listTableRecordsWithFields(RESIDENT_PROFILE_TABLE, RESIDENT_PROFILE_LIST_FIELDS)
}

function residentHouseMatchesScope(houseField, allowedNamesLower) {
  if (!allowedNamesLower?.size) return false
  if (houseField == null) return false
  if (Array.isArray(houseField)) {
    if (houseField.length && String(houseField[0]).trim().startsWith('rec')) return false
    const text = houseField
      .map((x) => String(x || '').trim())
      .filter(Boolean)
      .join(' · ')
      .trim()
      .toLowerCase()
    return Boolean(text && allowedNamesLower.has(text))
  }
  const text = String(houseField).trim().toLowerCase()
  return Boolean(text && allowedNamesLower.has(text))
}

function propertyRecordName(p) {
  return String(p?.['Property Name'] || p?.Name || p?.Property || '').trim()
}

function isPropertyRecordApproved(p) {
  if (p.Approved === true || p.Approved === 1) return true
  const a = String(p['Approval Status'] || '').trim().toLowerCase()
  if (a === 'approved') return true
  const s = String(p.Status || '').trim().toLowerCase()
  return s === 'approved' || s === 'live' || s === 'active'
}

/**
 * UI status for admin property lists / approvals queue.
 */
function propertyAdminStatus(raw) {
  const override = String(raw['Axis Admin Listing Status'] || raw['Admin Listing Status'] || '')
    .trim()
    .toLowerCase()
  const allowed = new Set(['pending', 'changes_requested', 'rejected', 'live', 'inactive'])
  if (override && allowed.has(override)) return override

  const a = String(raw['Approval Status'] || '').trim().toLowerCase()
  const s = String(raw.Status || '').trim().toLowerCase()
  if (a === 'rejected' || s === 'rejected') return 'rejected'
  if (
    a === 'changes requested' ||
    a === 'changes_requested' ||
    s === 'changes_requested' ||
    s === 'changes requested'
  ) {
    return 'changes_requested'
  }
  if (isPropertyRecordApproved(raw)) return 'live'
  return 'pending'
}

export function applicationDisplayStatus(raw) {
  return applicationDisplayLabelFromApprovalState(deriveApplicationApprovalState(raw))
}

function roomRentFieldName() {
  return String(import.meta.env.VITE_AIRTABLE_ROOM_RENT_FIELD || 'Monthly Rent')
}

function buildMinRentByPropertyId(roomRows) {
  const field = roomRentFieldName()
  const map = new Map()
  for (const r of roomRows) {
    const rent = Number(r[field])
    if (!Number.isFinite(rent) || rent < 0) continue
    const links = Array.isArray(r.Property) ? r.Property : r.Property ? [r.Property] : []
    for (const pid of links) {
      const prev = map.get(pid)
      if (prev == null || rent < prev) map.set(pid, rent)
    }
  }
  return map
}

function buildEmailToManagerId(managerRows) {
  const m = new Map()
  for (const row of managerRows) {
    const em = String(row.Email || '').trim().toLowerCase()
    if (em) m.set(em, row.id)
  }
  return m
}

function ownerIdForProperty(prop, emailToManagerId) {
  const em = String(prop['Manager Email'] || prop['Site Manager Email'] || '')
    .trim()
    .toLowerCase()
  if (em && emailToManagerId.has(em)) return emailToManagerId.get(em)
  if (em) return em
  return '—'
}

function ownerIdForApplication(app, propertyRows, emailToManagerId) {
  const pn = String(app['Property Name'] || '').trim().toLowerCase()
  if (!pn) return '—'
  const prop =
    propertyRows.find((p) => propertyRecordName(p).trim().toLowerCase() === pn) || null
  if (prop) return ownerIdForProperty(prop, emailToManagerId)
  return '—'
}

/**
 * @returns {Promise<{ properties: object[], accounts: object[], applications: object[] }>}
 */
export async function loadAdminPortalDataset() {
  if (!isAdminPortalAirtableConfigured()) {
    return { properties: [], accounts: [], applications: [] }
  }

  const [propertyRows, managerRows, applicationRows] = await Promise.all([
    listAllRecords(TABLES.properties),
    listAllRecords(TABLES.managers),
    listAllRecords(TABLES.applications),
  ])

  let roomRows = []
  try {
    roomRows = await listAllRecords(getAirtableRoomsTableName())
  } catch {
    roomRows = []
  }

  const emailToManagerId = buildEmailToManagerId(managerRows)
  const minRent = buildMinRentByPropertyId(roomRows)

  const properties = propertyRows.map((raw) => {
    const name = propertyRecordName(raw) || 'Untitled property'
    const st = propertyAdminStatus(raw)
    const notes = String(raw.Notes || '')
    return {
      id: raw.id,
      _airtable: raw,
      ownerId: ownerIdForProperty(raw, emailToManagerId),
      name,
      address: String(raw.Address || '').trim() || '—',
      description: notes.length > 600 ? `${notes.slice(0, 600)}…` : notes || '—',
      status: st,
      submittedAt: raw.created_at || new Date().toISOString(),
      rentFrom: minRent.get(raw.id) ?? 0,
      adminNotesInternal: String(raw['Internal Notes'] || raw['Admin Notes'] || '').trim(),
      adminNotesVisible: String(raw['Axis Partner Notes'] || raw['Partner Notes'] || '').trim(),
    }
  })

  const accounts = managerRows.map((raw) => {
    const email = String(raw.Email || '').trim().toLowerCase()
    const linkedProps = propertyRows.filter(
      (p) => String(p['Manager Email'] || '').trim().toLowerCase() === email,
    )
    const propertyCount = linkedProps.length
    const houseNames = linkedProps.map((p) => propertyRecordName(p)).filter(Boolean)
    const houseNamesSorted = [...houseNames].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' }),
    )
    const houseSortKey = (houseNamesSorted[0] || '').toLowerCase()
    const managedHousesLabel = houseNamesSorted.length ? houseNamesSorted.join(', ') : '—'
    const active =
      raw.Active === true ||
      raw.Active === 1 ||
      ['true', '1', 'yes', 'active'].includes(String(raw.Active || '').trim().toLowerCase())
    const tier = String(raw.tier ?? raw.Tier ?? '').trim().toLowerCase()
    const verified = active || tier === 'free'
    return {
      id: raw.id,
      _airtable: raw,
      name: String(raw.Name || raw['Full Name'] || email || 'Manager').trim(),
      email: email || '—',
      businessName: String(raw['Business Name'] || raw.Company || raw.Name || '').trim() || null,
      verificationStatus: verified ? 'verified' : 'pending',
      propertyCount,
      enabled: active,
      houseSortKey,
      managedHousesLabel,
    }
  })

  const applications = applicationRows.map((raw) => {
    const approvalState = deriveApplicationApprovalState(raw)
    return {
      id: raw.id,
      _airtable: raw,
      applicantName: String(raw['Signer Full Name'] || raw['Applicant Name'] || '—').trim(),
      propertyName: String(raw['Property Name'] || '—').trim(),
      ownerId: ownerIdForApplication(raw, propertyRows, emailToManagerId),
      approvalState,
      status: applicationDisplayLabelFromApprovalState(approvalState),
      approvalPending: approvalState === 'pending',
    }
  })

  return { properties, accounts, applications }
}

export async function adminPatchProperty(recordId, fields) {
  const enc = encodeURIComponent(TABLES.properties)
  const data = await requestJson(`${BASE_URL}/${enc}/${recordId}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields, typecast: true }),
  })
  return mapRecord(data)
}

export async function adminApproveProperty(recordId) {
  return adminPatchProperty(recordId, {
    Approved: true,
    'Approval Status': 'Approved',
  })
}

export async function adminRejectProperty(recordId) {
  return adminPatchProperty(recordId, {
    Approved: false,
    'Approval Status': 'Rejected',
  })
}

export async function adminRequestPropertyEdits(recordId) {
  return adminPatchProperty(recordId, {
    'Approval Status': 'Changes Requested',
  })
}

export async function adminDeleteProperty(recordId) {
  const enc = encodeURIComponent(TABLES.properties)
  const res = await fetch(`${BASE_URL}/${enc}/${recordId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    if (responseBodyIndicatesAirtablePermissionDenied(body)) throw new Error(airtablePermissionDeniedMessage)
    throw new Error(`Airtable DELETE failed: ${res.status}`)
  }
  return await res.json()
}

export async function adminSetManagerActive(recordId, active) {
  const enc = encodeURIComponent(TABLES.managers)
  const data = await requestJson(`${BASE_URL}/${enc}/${recordId}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: { Active: Boolean(active) }, typecast: true }),
  })
  return mapRecord(data)
}

export async function adminPatchApplication(recordId, fields) {
  const enc = encodeURIComponent(TABLES.applications)
  const data = await requestJson(`${BASE_URL}/${enc}/${recordId}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields, typecast: true }),
  })
  return mapRecord(data)
}

/** Reject — sets `Rejected` checkbox (Airtable omits unchecked `Approved`, so rejection must use a checked field). */
export async function adminRejectApplication(recordId) {
  const rf = applicationRejectedFieldName()
  return adminPatchApplication(recordId, {
    Approved: null,
    [rf]: true,
  })
}

/** Remove approval — clears both markers so the row returns to pending. */
export async function adminUnapproveApplication(recordId) {
  const rf = applicationRejectedFieldName()
  return adminPatchApplication(recordId, {
    Approved: null,
    [rf]: null,
  })
}

/** Load all resident profiles for CEO/admin portal handoff. */
export async function loadResidentsForAdmin() {
  if (!isAdminPortalAirtableConfigured()) return []
  const out = await fetchResidentProfileRecords()
  return out.sort((a, b) =>
    String(a.Name || '').localeCompare(String(b.Name || ''), undefined, { sensitivity: 'base' }),
  )
}

/**
 * Resident Profile rows whose House matches the manager’s property names (from portal scope).
 * @param {string[]} allowedPropertyNames — display names from Properties / manager session
 */
export async function loadResidentsForManagerPortalInbox(allowedPropertyNames) {
  if (!isAdminPortalAirtableConfigured()) return []
  const allowed = new Set(
    (allowedPropertyNames || []).map((n) => String(n).trim().toLowerCase()).filter(Boolean),
  )
  if (!allowed.size) return []
  const rows = await fetchResidentProfileRecords()
  const filtered = rows.filter((r) => residentHouseMatchesScope(r.House, allowed))
  return filtered.sort((a, b) =>
    String(a.Name || '').localeCompare(String(b.Name || ''), undefined, { sensitivity: 'base' }),
  )
}

/**
 * Admin Profile contacts for manager → admin inbox (email + display label; excludes disabled rows when Enabled is set).
 * Does not request Password field from Airtable.
 */
export async function loadAdminProfilesForInbox() {
  if (!isAdminPortalAirtableConfigured()) return []
  try {
    const rows = await listTableRecordsWithFields(ADMIN_PROFILE_TABLE_NAME, [
      'Email',
      'Name',
      'Role',
      'Enabled',
    ])
    const out = []
    for (const r of rows) {
      const email = String(r.Email || '').trim().toLowerCase()
      if (!email.includes('@')) continue
      const en = r.Enabled
      if (
        en === false ||
        en === 0 ||
        ['false', 'no', 'inactive', 'disabled'].includes(String(en).trim().toLowerCase())
      ) {
        continue
      }
      const name = String(r.Name || '').trim()
      const role = String(r.Role || '').trim()
      const label = [name || email, role].filter(Boolean).join(' · ') || email
      out.push({ id: r.id, email, label })
    }
    out.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
    return out
  } catch {
    return []
  }
}


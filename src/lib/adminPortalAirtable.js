/**
 * Admin portal ↔ Airtable (browser, same base as manager: VITE_AIRTABLE_*).
 */
import {
  airtablePermissionDeniedMessage,
  responseBodyIndicatesAirtablePermissionDenied,
} from './airtablePermissionError.js'
import { getAirtableRoomsTableName } from './airtable.js'

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

function propertyRecordName(p) {
  return String(p?.Name || p?.Property || '').trim()
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

export function applicationDisplayStatus(app) {
  if (app.Approved === true) return 'Approved'
  if (app.Approved === false) return 'Rejected'
  return 'Under review'
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

  const applications = applicationRows.map((raw) => ({
    id: raw.id,
    _airtable: raw,
    applicantName: String(raw['Signer Full Name'] || raw['Applicant Name'] || '—').trim(),
    propertyName: String(raw['Property Name'] || '—').trim(),
    ownerId: ownerIdForApplication(raw, propertyRows, emailToManagerId),
    status: applicationDisplayStatus(raw),
    approvalPending: raw.Approved !== true && raw.Approved !== false,
  }))

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

/** Reject rental application (same field semantics as manager portal). */
export async function adminRejectApplication(recordId) {
  return adminPatchApplication(recordId, { Approved: false })
}

/** Load all resident profiles for CEO/admin portal handoff. */
export async function loadResidentsForAdmin() {
  if (!isAdminPortalAirtableConfigured()) return []
  const enc = encodeURIComponent('Resident Profile')
  const out = []
  let offset = null
  do {
    const url = new URL(`${BASE_URL}/${enc}`)
    url.searchParams.set('fields[]', 'Name')
    url.searchParams.set('fields[]', 'Email')
    url.searchParams.set('fields[]', 'House')
    url.searchParams.set('fields[]', 'Unit Number')
    url.searchParams.set('fields[]', 'Application Approval')
    url.searchParams.set('fields[]', 'Approved')
    if (offset) url.searchParams.set('offset', offset)
    const data = await requestJson(url.toString())
    for (const r of data.records || []) {
      out.push(mapRecord(r))
    }
    offset = data.offset || null
  } while (offset)
  return out.sort((a, b) =>
    String(a.Name || '').localeCompare(String(b.Name || ''), undefined, { sensitivity: 'base' }),
  )
}


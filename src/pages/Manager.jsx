// ─── Axis Manager Portal ──────────────────────────────────────────────────────
// Route: /manager
//
// This is the internal manager-only interface for reviewing, editing, and
// approving AI-generated lease drafts before they are visible to residents.
//
// Workflow enforced by this page:
//   Draft Generated → Under Review → (Changes Needed ↔ Under Review) → Approved → Published
//
// Residents see only "Published" or "Signed" leases in their portal.
// Every action (open, edit, approve, reject, publish) is written to Audit Log.
//
// Components:
//   Unauthenticated /manager → redirects to /portal?portal=manager (shared portal hub)
//   GenerateDraftModal — form to create a new AI lease draft
//   ManagerDashboard   — filterable table of all lease drafts
//   LeaseEditor        — full-screen editor with sidebar, tabs, action buttons
//   Manager (default)  — root component managing session + view routing

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import toast from 'react-hot-toast'
import { HOUSING_CONTACT_MESSAGE } from '../lib/housingSite'
import { readJsonResponse } from '../lib/readJsonResponse'
import AddHousingWizard from '../components/AddHousingWizard'
import GmailStyleInboxLayout, { InboxThreadRow } from '../components/GmailStyleInboxLayout'
import PortalInboxAnnouncementSection from '../components/PortalInboxAnnouncementSection'
import {
  getWorkOrderById,
  updateWorkOrder,
  getAllWorkOrders,
  getAllMessages,
  getMessages,
  sendMessage,
  isInternalPortalThreadMessage,
  getAllPaymentsRecords,
  updatePaymentRecord,
  AIRTABLE_PAYMENTS_BASE_ID,
  portalInboxAirtableConfigured,
  getMessagesByThreadKey,
  siteManagerThreadKey,
  PORTAL_INBOX_CHANNEL_INTERNAL,
  fetchInboxThreadStateMap,
  inboxThreadStateAirtableEnabled,
  markInboxThreadRead,
  setInboxThreadTrash,
} from '../lib/airtable'
import {
  consolidateManagerDashboardWarnings,
  errorFromAirtableApiBody,
  isAirtablePermissionErrorMessage,
} from '../lib/airtablePermissionError'
import {
  PortalAuthCard,
  PortalAuthPage,
  PortalField,
  PortalNotice,
  PortalPasswordInput,
  PortalPrimaryButton,
  PortalSegmentedControl,
  portalAuthInputCls,
} from '../components/PortalAuthUI'
import PortalShell from '../components/PortalShell'

// ─── Session ──────────────────────────────────────────────────────────────────
export const MANAGER_SESSION_KEY = 'axis_manager'
const MANAGER_ONBOARDING_KEY = 'axis_manager_onboarding'

// ─── Records API config — split by Airtable base to match the rest of the app ─
const AIRTABLE_TOKEN = import.meta.env.VITE_AIRTABLE_TOKEN
const CORE_BASE_ID = import.meta.env.VITE_AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const CORE_AIRTABLE_BASE_URL = `https://api.airtable.com/v0/${CORE_BASE_ID}`

// ─── Lease status configuration ───────────────────────────────────────────────
// Each status has a color set used by StatusBadge and the stats row
const STATUS_CONFIG = {
  'Draft Generated': { bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200',   dot: 'bg-blue-400'   },
  'Under Review':    { bg: 'bg-amber-50',  text: 'text-amber-700',  border: 'border-amber-200',  dot: 'bg-amber-400'  },
  'Changes Needed':  { bg: 'bg-red-50',    text: 'text-red-700',    border: 'border-red-200',    dot: 'bg-red-500'    },
  'Approved':        { bg: 'bg-green-50',  text: 'text-green-700',  border: 'border-green-200',  dot: 'bg-green-500'  },
  'Published':       { bg: 'bg-axis/5',    text: 'text-axis',       border: 'border-axis/20',    dot: 'bg-axis'       },
  'Signed':          { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', dot: 'bg-purple-500' },
}

const ALL_STATUSES = Object.keys(STATUS_CONFIG)

const LEASE_TERMS = [
  '3-Month', '9-Month', '12-Month', 'Month-to-Month',
  'Summer (Jun–Sep)', 'Academic Year (Sep–Jun)', 'Full Year', 'Custom',
]

// ─── Records API helpers ──────────────────────────────────────────────────────
function atHeaders() {
  return { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' }
}

function mapRecord(record) {
  return { id: record.id, ...record.fields, created_at: record.createdTime }
}

/** Short message for inline banners (avoids huge JSON in the UI). */
function formatDataLoadError(err) {
  if (err == null) return 'Unavailable'
  const raw = err?.message != null ? String(err.message) : String(err)
  try {
    const j = JSON.parse(raw)
    const inner = j?.error?.message || j?.message
    if (typeof inner === 'string' && inner.trim()) return inner.trim()
  } catch {
    /* not JSON */
  }
  return raw.length > 220 ? `${raw.slice(0, 217)}…` : raw
}

function classNames(...values) {
  return values.filter(Boolean).join(' ')
}

const TOUR_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const TOUR_SLOTS = ['9:00 AM', '10:30 AM', '12:00 PM', '1:30 PM', '3:00 PM', '4:30 PM', '6:00 PM']

function propertyRecordName(p) {
  return String(p?.Name || p?.Property || '').trim()
}

/** House visible in manager portal lists once Axis marks it approved / live. */
function isPropertyRecordApproved(p) {
  if (p.Approved === true || p.Approved === 1) return true
  const a = String(p['Approval Status'] || '').trim().toLowerCase()
  if (a === 'approved') return true
  const s = String(p.Status || '').trim().toLowerCase()
  return s === 'approved' || s === 'live' || s === 'active'
}

function managerLinkArray(val) {
  if (Array.isArray(val)) return val.map(String)
  if (typeof val === 'string' && val.startsWith('rec')) return [val]
  return []
}

/** Property must be assigned to this manager (email, linked Manager record, or Manager ID). */
function propertyAssignedToManager(p, manager) {
  const email = String(manager?.email || '').trim().toLowerCase()
  const mid = String(manager?.managerId || '').trim()
  const recId = String(manager?.id || '').trim()
  const emails = [
    String(p['Manager Email'] || '').trim().toLowerCase(),
    String(p['Site Manager Email'] || '').trim().toLowerCase(),
  ].filter(Boolean)
  if (email && emails.length && emails.includes(email)) return true
  for (const k of ['Manager', 'Site Manager', 'Property Manager']) {
    const links = managerLinkArray(p[k])
    if (recId && links.includes(recId)) return true
  }
  const pid = String(p['Manager ID'] || '').trim()
  if (mid && pid && pid === mid) return true
  return false
}

function computeManagerScope(propertyRecords, manager) {
  const list = Array.isArray(propertyRecords) ? propertyRecords : []
  const approvedNames = new Set()
  const pendingAssigned = []
  if (manager?.__axisDeveloper === true) {
    for (const p of list) {
      if (isPropertyRecordApproved(p)) {
        const n = propertyRecordName(p)
        if (n) approvedNames.add(n)
      }
    }
    return { approvedNames, pendingAssigned: [] }
  }
  for (const p of list) {
    if (!propertyAssignedToManager(p, manager)) continue
    if (isPropertyRecordApproved(p)) {
      const n = propertyRecordName(p)
      if (n) approvedNames.add(n)
    } else {
      pendingAssigned.push(p)
    }
  }
  return { approvedNames, pendingAssigned }
}

function applicationInScope(app, approvedNamesLowerSet) {
  const pn = String(app['Property Name'] || '').trim().toLowerCase()
  if (!pn || !approvedNamesLowerSet?.size) return false
  return approvedNamesLowerSet.has(pn)
}

function leaseDraftInScope(draft, approvedNames) {
  const p = String(draft?.Property || '').trim().toLowerCase()
  if (!p || !approvedNames?.size) return false
  for (const n of approvedNames) {
    const ns = String(n).trim().toLowerCase()
    if (p === ns || p.startsWith(`${ns} `)) return true
  }
  return false
}

function paymentPropertyLabel(p) {
  return String(p['Property Name'] || p.Property || p['House'] || '').trim()
}

function paymentInScope(p, approvedNamesLowerSet) {
  const label = paymentPropertyLabel(p).trim().toLowerCase()
  if (!label || !approvedNamesLowerSet?.size) return false
  return approvedNamesLowerSet.has(label) || [...approvedNamesLowerSet].some((ns) => label.includes(ns))
}

function isRentPaymentRecord(p) {
  const raw = [p.Type, p.Category, p.Kind, p['Line Item Type'], p.Month, p.Notes].filter(Boolean).join(' ').toLowerCase()
  if (/(fee|fine|damage|late fee|late charge|cleaning|lockout)/.test(raw)) return false
  return true
}

function isPaymentOverdueRecord(p) {
  if (String(p.Status || '').trim().toLowerCase() === 'paid') return false
  if (String(p.Status || '').trim().toLowerCase() === 'overdue') return true
  const due = p['Due Date'] ? new Date(p['Due Date']) : null
  if (!due || Number.isNaN(due.getTime())) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return due < today
}

function paymentMonthKeyFromRecord(p) {
  const raw = p['Due Date'] || p.created_at
  const d = raw ? new Date(raw) : null
  if (!d || Number.isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function ymFromDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function currentYm() {
  return ymFromDate(new Date())
}

function formatYmLong(ym) {
  const [y, m] = String(ym || '').split('-').map(Number)
  if (!y || !m) return String(ym || '')
  const d = new Date(y, m - 1, 1)
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

function paymentRoomSortKey(p) {
  const r = String(p['Room Number'] ?? p.Room ?? p.Unit ?? p['Unit / Room'] ?? '').trim()
  const n = Number.parseInt(r, 10)
  if (Number.isFinite(n) && String(n) === r) return n
  return r.toLowerCase()
}

function formatPaymentRoomTitle(p) {
  const r = String(p['Room Number'] ?? p.Room ?? p.Unit ?? p['Unit / Room'] ?? '').trim()
  if (!r) return 'Room'
  if (/^room\s/i.test(r)) return r
  if (/^\d+$/.test(r)) return `Room ${r}`
  return r
}

function comparePaymentByRoom(a, b) {
  const ka = paymentRoomSortKey(a)
  const kb = paymentRoomSortKey(b)
  if (typeof ka === 'number' && typeof kb === 'number') return ka - kb
  return String(ka).localeCompare(String(kb), undefined, { numeric: true })
}

function rentStatusPresentation(p) {
  const st = String(p.Status || '').trim().toLowerCase()
  if (st === 'paid') return { phrase: 'Rent paid', tone: 'emerald' }
  if (isPaymentOverdueRecord(p)) return { phrase: 'Rent overdue', tone: 'red' }
  return { phrase: 'Rent pending', tone: 'amber' }
}

function workOrderPropertyLabel(w) {
  return String(w.Property || w['Property Name'] || w['House'] || '').trim()
}

function workOrderInScope(w, approvedNamesLowerSet) {
  if (!approvedNamesLowerSet?.size) return false
  const prop = workOrderPropertyLabel(w).toLowerCase()
  if (!prop) return false
  return [...approvedNamesLowerSet].some((ns) => prop === ns || prop.includes(ns))
}

function workOrderIsResolvedRecord(w) {
  if (w.Resolved === true || w.Resolved === 1 || w.Resolved === '1') return true
  const st = String(w.Status || '').trim().toLowerCase()
  return st === 'resolved' || st === 'closed' || st === 'completed'
}

function updateTourAvailabilityLines(currentAvailability, day, slot) {
  const lines = String(currentAvailability || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
  const lineIndex = lines.findIndex((line) => line.toLowerCase().startsWith(day.toLowerCase()))
  const existingSlots = lineIndex >= 0
    ? lines[lineIndex].split(':').slice(1).join(':').split(',').map((item) => item.trim()).filter(Boolean)
    : []
  const nextSlots = existingSlots.includes(slot)
    ? existingSlots.filter((item) => item !== slot)
    : [...existingSlots, slot]
  const nextLines = [...lines]
  const nextValue = `${day}: ${nextSlots.join(', ')}`
  if (lineIndex >= 0) nextLines[lineIndex] = nextValue
  else nextLines.push(nextValue)
  return nextLines.filter(Boolean).join('\n')
}

const TOUR_GRID_START_HOUR = 6
const TOUR_GRID_END_HOUR = 22
const TOUR_GRID_STEP_MIN = 30
const TOUR_GRID_START_MIN = TOUR_GRID_START_HOUR * 60
const TOUR_GRID_END_MIN = TOUR_GRID_END_HOUR * 60
const TOUR_GRID_HALF_COUNT = Math.round((TOUR_GRID_END_MIN - TOUR_GRID_START_MIN) / TOUR_GRID_STEP_MIN)

const CAL_DOW_TO_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Same shape as Contact.jsx parseTourCalendar — maps text to day → slot labels. */
function parseManagerTourCalendarText(raw) {
  const result = {}
  String(raw || '')
    .split(/[;\n]/)
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((line) => {
      const m = line.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s*[:\-]\s*(.+)$/i)
      if (!m) return
      const day = m[1].slice(0, 1).toUpperCase() + m[1].slice(1, 3).toLowerCase()
      result[day] = m[2].split(',').map((s) => s.trim()).filter(Boolean)
    })
  return result
}

function slotLabelToMinutes(label) {
  const s = String(label).trim().toUpperCase().replace(/\./g, '').replace(/\s+/g, ' ')
  const m = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/)
  if (!m) return null
  let h = parseInt(m[1], 10)
  const min = parseInt(m[2], 10)
  const ap = m[3]
  if (ap === 'PM' && h !== 12) h += 12
  if (ap === 'AM' && h === 12) h = 0
  return h * 60 + min
}

function slotRangeMinutes(slotLabel) {
  const start = slotLabelToMinutes(slotLabel)
  if (start == null) return null
  return { start, end: start + 90 }
}

function halfHourIndicesOverlappingRange(startMin, endMin) {
  const out = []
  for (let t = TOUR_GRID_START_MIN; t < TOUR_GRID_END_MIN; t += TOUR_GRID_STEP_MIN) {
    if (t < endMin && t + TOUR_GRID_STEP_MIN > startMin) {
      out.push((t - TOUR_GRID_START_MIN) / TOUR_GRID_STEP_MIN)
    }
  }
  return out
}

function weeklyFreeArraysFromTourText(text) {
  const cal = parseManagerTourCalendarText(text)
  const o = {}
  for (const d of TOUR_DAYS) {
    const set = new Set()
    for (const slot of cal[d] || []) {
      const range = slotRangeMinutes(slot)
      if (!range) continue
      for (const idx of halfHourIndicesOverlappingRange(range.start, range.end)) {
        set.add(idx)
      }
    }
    o[d] = [...set].sort((a, b) => a - b)
  }
  return o
}

function encodeTourAvailabilityFromWeeklyFree(weeklyArrays) {
  const lines = []
  for (const day of TOUR_DAYS) {
    const set = new Set(weeklyArrays[day] || [])
    const picked = []
    for (const slot of TOUR_SLOTS) {
      const range = slotRangeMinutes(slot)
      if (!range) continue
      const idxs = halfHourIndicesOverlappingRange(range.start, range.end)
      if (idxs.some((i) => set.has(i))) picked.push(slot)
    }
    if (picked.length) lines.push(`${day}: ${picked.join(', ')}`)
  }
  return lines.join('\n')
}

function formatHalfHourIndexLabel(idx) {
  const minTotal = TOUR_GRID_START_MIN + idx * TOUR_GRID_STEP_MIN
  const h = Math.floor(minTotal / 60)
  const m = minTotal % 60
  const d = new Date(2000, 0, 1, h, m)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function freeTourSlotCountForWeekday(weeklyArrays, dayAbbr) {
  const set = new Set(weeklyArrays[dayAbbr] || [])
  let n = 0
  for (const slot of TOUR_SLOTS) {
    const range = slotRangeMinutes(slot)
    if (!range) continue
    const idxs = halfHourIndicesOverlappingRange(range.start, range.end)
    if (idxs.some((i) => set.has(i))) n += 1
  }
  return n
}

function cloneWeeklyArrays(src) {
  const o = {}
  for (const d of TOUR_DAYS) o[d] = [...(src[d] || [])]
  return o
}

function emptyWeeklyFreeArrays() {
  const o = {}
  for (const d of TOUR_DAYS) o[d] = []
  return o
}

function schedulingRowsToCalendarEvents(rows) {
  const out = []
  for (const r of rows || []) {
    const d = parseCalendarDay(r['Preferred Date'])
    if (!d) continue
    const appr = String(r['Manager Approval'] || '').trim() || 'Pending'
    const name = r.Name || 'Guest'
    const prop = String(r.Property || '').trim()
    const time = String(r['Preferred Time'] || '').trim()
    out.push({
      date: d,
      label: `Tour · ${name}${prop ? ` · ${prop}` : ''}${time ? ` · ${time}` : ''}`,
      type: 'tour_req',
      schedulingId: r.id,
      approval: appr,
      tourRow: r,
    })
  }
  return out
}

function tourApprovalNeedsAction(row) {
  const a = String(row['Manager Approval'] || '').trim().toLowerCase()
  if (a === 'approved' || a === 'declined') return false
  return true
}

async function atRequest(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { ...atHeaders(), ...(options.headers || {}) } })
  if (!res.ok) {
    const body = await res.text()
    const permErr = errorFromAirtableApiBody(res.url || url, body)
    if (permErr) throw permErr
    try {
      const parsed = JSON.parse(body)
      if (parsed?.error?.message) {
        throw new Error(parsed.error.message)
      }
    } catch {
      // fall back to the raw response body below when it is not JSON
    }
    throw new Error(body)
  }
  return res.json()
}

// ─── Data layer ───────────────────────────────────────────────────────────────

async function fetchLeaseDrafts({ status, property, resident } = {}) {
  const url = new URL(`${CORE_AIRTABLE_BASE_URL}/Lease%20Drafts`)
  const parts = []
  if (status)   parts.push(`{Status} = "${status}"`)
  if (property) parts.push(`FIND("${property.replace(/"/g, '\\"')}", {Property}) > 0`)
  if (resident) parts.push(`FIND("${resident.replace(/"/g, '\\"').toLowerCase()}", LOWER({Resident Name})) > 0`)

  if (parts.length > 0) {
    url.searchParams.set('filterByFormula', parts.length === 1 ? parts[0] : `AND(${parts.join(',')})`)
  }
  url.searchParams.set('sort[0][field]', 'Updated At')
  url.searchParams.set('sort[0][direction]', 'desc')

  const data = await atRequest(url.toString())
  return (data.records || []).map(mapRecord)
}

// ─── Applications data layer ──────────────────────────────────────────────────
async function fetchApplications({ property } = {}) {
  const url = new URL(`${CORE_AIRTABLE_BASE_URL}/Applications`)
  if (property) {
    url.searchParams.set('filterByFormula', `FIND("${property.replace(/"/g, '\\"')}", {Property Name}) > 0`)
  }
  const data = await atRequest(url.toString())
  const rows = (data.records || []).map(mapRecord)
  return rows.sort((a, b) => {
    const ta = new Date(a.created_at || 0).getTime()
    const tb = new Date(b.created_at || 0).getTime()
    return tb - ta
  })
}

async function patchApplication(recordId, fields) {
  const data = await atRequest(`${CORE_AIRTABLE_BASE_URL}/Applications/${recordId}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields, typecast: true }),
  })
  return mapRecord(data)
}

async function fetchLeaseDraft(recordId) {
  const data = await atRequest(`${CORE_AIRTABLE_BASE_URL}/Lease%20Drafts/${recordId}`)
  return mapRecord(data)
}

async function patchLeaseDraft(recordId, fields) {
  const data = await atRequest(`${CORE_AIRTABLE_BASE_URL}/Lease%20Drafts/${recordId}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields, typecast: true }),
  })
  return mapRecord(data)
}

async function fetchPropertiesAdmin() {
  const data = await atRequest(`${CORE_AIRTABLE_BASE_URL}/Properties`)
  return (data.records || []).map(mapRecord)
}

async function createPropertyAdmin(fields) {
  const data = await atRequest(`${CORE_AIRTABLE_BASE_URL}/Properties`, {
    method: 'POST',
    body: JSON.stringify({ fields, typecast: true }),
  })
  return mapRecord(data)
}

async function updatePropertyAdmin(recordId, fields) {
  const data = await atRequest(`${CORE_AIRTABLE_BASE_URL}/Properties/${recordId}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields, typecast: true }),
  })
  return mapRecord(data)
}

async function fetchManagerRecordById(recordId) {
  const id = String(recordId || '').trim()
  if (!id) throw new Error('Missing manager record id.')
  const data = await atRequest(`${CORE_AIRTABLE_BASE_URL}/Manager%20Profile/${id}`)
  return mapRecord(data)
}

async function patchManagerRecord(recordId, fields) {
  const data = await atRequest(`${CORE_AIRTABLE_BASE_URL}/Manager%20Profile/${recordId}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields, typecast: true }),
  })
  return mapRecord(data)
}

async function fetchSchedulingForManagerScope({ managerEmail, propertyNames }) {
  const url = new URL(`${CORE_AIRTABLE_BASE_URL}/Scheduling`)
  url.searchParams.set('sort[0][field]', 'Preferred Date')
  url.searchParams.set('sort[0][direction]', 'desc')
  url.searchParams.set('maxRecords', '100')
  const data = await atRequest(url.toString())
  const rows = (data.records || []).map(mapRecord)
  const em = String(managerEmail || '').trim().toLowerCase()
  const props = (propertyNames || []).map((p) => String(p).trim().toLowerCase()).filter(Boolean)
  return rows.filter((r) => {
    const typ = String(r.Type || '').trim().toLowerCase()
    if (typ !== 'tour') return false
    const rme = String(r['Manager Email'] || '').trim().toLowerCase()
    if (em && rme === em) return true
    const prop = String(r.Property || '').trim().toLowerCase()
    if (!prop || !props.length) return false
    return props.some((pn) => prop === pn || prop.includes(pn) || pn.includes(prop))
  })
}

async function patchSchedulingRecord(recordId, fields) {
  const id = String(recordId || '').trim()
  if (!id) throw new Error('Missing scheduling record id.')
  const data = await atRequest(`${CORE_AIRTABLE_BASE_URL}/Scheduling/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields, typecast: true }),
  })
  return mapRecord(data)
}

async function fetchAuditLog(leaseDraftId) {
  const formula = encodeURIComponent(`{Lease Draft ID} = "${leaseDraftId}"`)
  const url = `${CORE_AIRTABLE_BASE_URL}/Audit%20Log?filterByFormula=${formula}&sort[0][field]=Timestamp&sort[0][direction]=asc`
  const data = await atRequest(url)
  return (data.records || []).map(mapRecord)
}

// Log an action to the Audit Log table — failures are non-fatal
async function logAudit({ leaseDraftId, actionType, performedBy, performedByRole, notes = '' }) {
  try {
    await atRequest(`${CORE_AIRTABLE_BASE_URL}/Audit%20Log`, {
      method: 'POST',
      body: JSON.stringify({
        fields: {
          'Lease Draft ID': leaseDraftId,
          'Action Type': actionType,
          'Performed By': performedBy,
          'Performed By Role': performedByRole,
          'Timestamp': new Date().toISOString(),
          'Notes': notes,
        },
        typecast: true,
      }),
    })
  } catch (err) {
    console.warn('[Audit Log] Write failed (non-fatal):', err.message)
  }
}

// ─── Shared utilities ─────────────────────────────────────────────────────────
function fmtDate(val) {
  if (!val) return '—'
  try { return new Date(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return String(val) }
}

function fmtDateTime(val) {
  if (!val) return '—'
  try { return new Date(val).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) }
  catch { return String(val) }
}

// ─── StatusBadge ─────────────────────────────────────────────────────────────
function StatusBadge({ status, size = 'sm' }) {
  const cfg = STATUS_CONFIG[status] || {
    bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200', dot: 'bg-slate-400',
  }
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border font-semibold ${cfg.bg} ${cfg.border} ${cfg.text} ${size === 'lg' ? 'px-3 py-1.5 text-sm' : 'px-2.5 py-1 text-[11px]'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {status}
    </span>
  )
}

export function ManagerAuthForm({ onLogin, footer = null, variant = 'default' }) {
  const queryString = typeof window !== 'undefined' ? window.location.search : ''
  const initialSearch = new URLSearchParams(queryString)
  const initialView = initialSearch.get('view') === 'create' || initialSearch.get('setup') === 'success' ? 'setup' : 'signin'
  const [activeView, setActiveView] = useState(initialView)
  const [signInForm, setSignInForm] = useState({ email: '', password: '' })
  const [activationForm, setActivationForm] = useState({ managerId: '', name: '', email: '', phone: '', password: '', planType: '', billingInterval: '' })
  const [subscriptionReady, setSubscriptionReady] = useState(false)
  const [accountExists, setAccountExists] = useState(false)
  const [notice, setNotice] = useState('')
  const [loginError, setLoginError] = useState('')
  const [subscriptionError, setSubscriptionError] = useState('')
  const [activationError, setActivationError] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const [activationLoading, setActivationLoading] = useState(false)
  const [setupLoading, setSetupLoading] = useState(false)
  const [profileLoading, setProfileLoading] = useState(false)

  function persistOnboarding(nextData) {
    try {
      sessionStorage.setItem(MANAGER_ONBOARDING_KEY, JSON.stringify(nextData))
    } catch {
      // ignore session storage issues
    }
  }

  function clearOnboarding() {
    try {
      sessionStorage.removeItem(MANAGER_ONBOARDING_KEY)
    } catch {
      // ignore session storage issues
    }
  }

  function applyOnboardingState(data) {
    const normalizedEmail = String(data.email || '').trim().toLowerCase()
    const normalizedName = String(data.name || '').trim()
    const normalizedPhone = String(data.phone || '').trim()
    const normalizedManagerId = String(data.managerId || '').trim().toUpperCase()
    const normalizedPlanType = String(data.planType || '').trim().toLowerCase()
    const normalizedBillingInterval = String(data.billingInterval || '').trim().toLowerCase()
    const nextAccountExists = Boolean(data.accountExists)
    const nextSubscriptionReady = Boolean(normalizedManagerId)

    setSubscriptionReady(nextSubscriptionReady)
    setAccountExists(nextAccountExists)
    setActiveView(nextAccountExists ? 'signin' : 'setup')
    setSignInForm((current) => ({ ...current, email: normalizedEmail || current.email }))
    setActivationForm((current) => ({
      ...current,
      managerId: normalizedManagerId || current.managerId,
      name: normalizedName || current.name,
      email: normalizedEmail || current.email,
      phone: normalizedPhone || current.phone,
      planType: normalizedPlanType || current.planType,
      billingInterval: normalizedBillingInterval || current.billingInterval,
    }))

    persistOnboarding({
      name: normalizedName,
      email: normalizedEmail,
      phone: normalizedPhone,
      managerId: normalizedManagerId,
      planType: normalizedPlanType,
      billingInterval: normalizedBillingInterval,
      subscriptionReady: nextSubscriptionReady,
      accountExists: nextAccountExists,
    })
  }

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(MANAGER_ONBOARDING_KEY)
      if (!saved) return
      const parsed = JSON.parse(saved)
      applyOnboardingState(parsed)
    } catch {
      clearOnboarding()
    }
  }, [])

  useEffect(() => {
    const searchParams = new URLSearchParams(queryString)
    const sessionId = searchParams.get('session_id') || ''
    const setupState = searchParams.get('setup') || ''
    const requestedView = searchParams.get('view') || ''

    if (requestedView === 'create' && setupState !== 'success') {
      setActiveView('setup')
    }

    if (requestedView === 'signin' && setupState !== 'success') {
      setActiveView('signin')
    }

    if (setupState === 'cancelled') {
      setActiveView('setup')
      setNotice('Manager subscription checkout was cancelled. You can restart it below whenever you are ready.')
    }

    if (!sessionId || setupState !== 'success') return

    let cancelled = false

    async function completeSetup() {
      setSetupLoading(true)
      setSubscriptionError('')
      setActivationError('')
      try {
        const res = await fetch(`/api/portal?action=manager-subscription-complete&session_id=${encodeURIComponent(sessionId)}`)
        const data = await readJsonResponse(res)
        if (!res.ok) throw new Error(data.error || 'Could not verify the subscription.')
        if (cancelled) return

        applyOnboardingState(data)
        setNotice(data.message || 'Subscription verified.')

        const nextUrl = new URL(window.location.href)
        nextUrl.searchParams.delete('session_id')
        nextUrl.searchParams.delete('setup')
        window.history.replaceState({}, '', nextUrl.pathname + nextUrl.search)
      } catch (err) {
        if (!cancelled) setSubscriptionError(err.message || 'Could not verify the subscription.')
      } finally {
        if (!cancelled) setSetupLoading(false)
      }
    }

    completeSetup()
    return () => { cancelled = true }
  }, [queryString])

  useEffect(() => {
    if (activeView !== 'setup') return undefined

    const managerId = activationForm.managerId.trim().toUpperCase()
    if (!managerId) return undefined

    let cancelled = false
    const timer = setTimeout(async () => {
      setProfileLoading(true)
      setActivationError('')

      try {
        const res = await fetch(`/api/portal?action=manager-lookup&manager_id=${encodeURIComponent(managerId)}`)
        const data = await readJsonResponse(res)

        if (!res.ok) {
          if (res.status === 404) return
          throw new Error(data.error || 'Could not load the manager record.')
        }
        if (cancelled) return

        applyOnboardingState(data)
      } catch (err) {
        if (!cancelled) {
          setActivationError(err.message || 'Could not load the manager record.')
        }
      } finally {
        if (!cancelled) setProfileLoading(false)
      }
    }, 250)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [activeView, activationForm.managerId])

  async function handleSubmit(event) {
    event.preventDefault()
    setLoginError('')
    setLoginLoading(true)
    try {
      const res = await fetch('/api/portal?action=manager-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: signInForm.email.trim().toLowerCase(),
          password: signInForm.password,
        }),
      })
      const data = await readJsonResponse(res)
      if (!res.ok) throw new Error(data.error || 'Login failed')
      clearOnboarding()
      sessionStorage.setItem(MANAGER_SESSION_KEY, JSON.stringify(data.manager))
      onLogin(data.manager)
    } catch (err) {
      setLoginError(err.message || 'Login failed')
    } finally {
      setLoginLoading(false)
    }
  }

  async function handleCreateAccount(event) {
    event.preventDefault()
    setActivationError('')
    setActivationLoading(true)
    try {
      const res = await fetch('/api/portal?action=manager-create-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          managerId: activationForm.managerId.trim().toUpperCase(),
          password: activationForm.password,
        }),
      })
      const data = await readJsonResponse(res)
      if (!res.ok) throw new Error(data.error || 'Could not create manager account')
      clearOnboarding()
      sessionStorage.setItem(MANAGER_SESSION_KEY, JSON.stringify(data.manager))
      onLogin(data.manager)
    } catch (err) {
      setActivationError(err.message || 'Could not create manager account')
    } finally {
      setActivationLoading(false)
    }
  }

  const portalEntry = variant === 'portal-entry'

  return (
    <>
      {!portalEntry ? (
        <PortalSegmentedControl
          tabs={[['signin', 'Sign in'], ['setup', 'Create account']]}
          active={activeView}
          onChange={setActiveView}
        />
      ) : null}

      {activeView === 'signin' ? (
        <form onSubmit={handleSubmit} className={portalEntry ? 'mt-0 space-y-4' : 'mt-6 space-y-4'}>
          <PortalField label="Email">
            <input
              type="email"
              value={signInForm.email}
              onChange={(event) => setSignInForm((current) => ({ ...current, email: event.target.value }))}
              required
              autoComplete="email"
              placeholder="you@example.com"
              className={portalAuthInputCls}
            />
          </PortalField>

          <PortalField label="Password">
            <PortalPasswordInput
              value={signInForm.password}
              onChange={(event) => setSignInForm((current) => ({ ...current, password: event.target.value }))}
              autoComplete="current-password"
            />
          </PortalField>

          {loginError ? (
            <PortalNotice tone="error">{loginError}</PortalNotice>
          ) : null}

          <PortalPrimaryButton
            type="submit"
            disabled={loginLoading}
          >
            {loginLoading ? 'Signing in…' : 'Sign in'}
          </PortalPrimaryButton>
          {portalEntry ? (
            <div className="flex flex-col gap-3 pt-1 text-center text-sm text-slate-500">
              <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
                <Link
                  to="/contact?section=software&tab=message"
                  className="font-semibold text-[#2563eb] hover:text-slate-900"
                >
                  Forgot password
                </Link>
                <Link
                  to={HOUSING_CONTACT_MESSAGE}
                  className="font-semibold text-[#2563eb] hover:text-slate-900"
                >
                  Message Axis
                </Link>
              </div>
              <button
                type="button"
                onClick={() => {
                  setActiveView('setup')
                  setLoginError('')
                }}
                className="font-semibold text-slate-600 hover:text-slate-900"
              >
                Create account
              </button>
            </div>
          ) : null}
        </form>
      ) : (
        <form
          className={portalEntry ? 'mt-0 space-y-4' : 'mt-6 space-y-4'}
          onSubmit={handleCreateAccount}
        >
          {portalEntry ? (
            <div className="mb-4 text-center">
              <button
                type="button"
                onClick={() => {
                  setActiveView('signin')
                  setActivationError('')
                  setNotice('')
                }}
                className="text-sm font-semibold text-[#2563eb] hover:text-slate-900"
              >
                ← Back to sign in
              </button>
            </div>
          ) : null}
          <PortalNotice>
            Use the Manager ID from{' '}
            <Link to="/owners/pricing" className="font-semibold text-[#2563eb] underline underline-offset-2 hover:brightness-110">
              Partner With Axis pricing
            </Link>
            . Your account details load automatically once we find the record.
          </PortalNotice>

          <PortalField label="Manager ID" required>
            <input
              type="text"
              value={activationForm.managerId}
              onChange={(event) => {
                setNotice('')
                setActivationError('')
                setAccountExists(false)
                setSubscriptionReady(false)
                setActivationForm((current) => ({
                  ...current,
                  managerId: event.target.value.toUpperCase(),
                  name: '',
                  email: '',
                  phone: '',
                  planType: '',
                  billingInterval: '',
                }))
              }}
              placeholder="MGR-XXXXXXXXXXXXXX"
              className={`${portalAuthInputCls} font-semibold uppercase tracking-[0.04em]`}
            />
          </PortalField>

          <PortalField label="Full name">
            <input
              type="text"
              readOnly
              value={activationForm.name}
              placeholder="Loads from your manager record"
              className={`${portalAuthInputCls} bg-slate-50`}
            />
          </PortalField>

          <PortalField label="Email">
            <input
              type="email"
              readOnly
              value={activationForm.email}
              placeholder="Loads from your manager record"
              className={`${portalAuthInputCls} bg-slate-50`}
            />
          </PortalField>

          <PortalField label="Phone number">
            <input
              type="text"
              readOnly
              value={activationForm.phone}
              placeholder="Loads from your manager record"
              className={`${portalAuthInputCls} bg-slate-50`}
            />
          </PortalField>

          <PortalField label="Selected tier">
            <input
              type="text"
              readOnly
              value={
                activationForm.planType
                  ? `${activationForm.planType.charAt(0).toUpperCase()}${activationForm.planType.slice(1)}${activationForm.billingInterval && activationForm.billingInterval !== 'free' ? ` · ${activationForm.billingInterval}` : ''}`
                  : ''
              }
              placeholder="Loads from your manager record"
              className={`${portalAuthInputCls} bg-slate-50`}
            />
          </PortalField>

          <PortalField label="Create password" required>
            <PortalPasswordInput
              value={activationForm.password}
              onChange={(event) => setActivationForm((current) => ({ ...current, password: event.target.value }))}
              autoComplete="new-password"
              placeholder="Minimum 6 characters"
            />
          </PortalField>

          {notice ? <PortalNotice tone="success">{notice}</PortalNotice> : null}

          {setupLoading ? (
            <PortalNotice>Verifying manager setup…</PortalNotice>
          ) : null}

          {profileLoading ? (
            <PortalNotice>Loading manager details…</PortalNotice>
          ) : null}

          {activationError ? (
            <PortalNotice tone="error">{activationError}</PortalNotice>
          ) : null}

          <PortalPrimaryButton
            type="submit"
            disabled={activationLoading || !activationForm.managerId.trim() || !activationForm.password.trim()}
          >
            {activationLoading ? 'Creating account…' : 'Create account'}
          </PortalPrimaryButton>

          {subscriptionError ? <PortalNotice tone="error">{subscriptionError}</PortalNotice> : null}
        </form>
      )}

      {footer ? <div className="mt-8 text-center text-sm text-slate-400">{footer}</div> : null}
    </>
  )
}

function HouseManagementPanel({ manager, onPropertiesChange }) {
  const [properties, setProperties] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editingPropertyId, setEditingPropertyId] = useState(null)
  const [tourForm, setTourForm] = useState({
    manager: '',
    availability: '',
    notes: '',
    securityDeposit: '',
  })

  const loadProperties = useCallback(async () => {
    setLoading(true)
    try {
      const records = await fetchPropertiesAdmin()
      setProperties(records)
      onPropertiesChange?.(records)
    } catch (err) {
      toast.error('Could not load houses: ' + err.message)
    } finally {
      setLoading(false)
    }
  }, [onPropertiesChange])

  useEffect(() => {
    loadProperties()
  }, [loadProperties])

  function extractNoteValue(notes, label) {
    const escaped = String(label || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = String(notes || '').match(new RegExp(`(?:^|\\n)${escaped}:\\s*(.+?)(?:\\n|$)`, 'i'))
    return match ? match[1].trim() : ''
  }

  function buildTourNotes(existingNotes, metadata) {
    const labels = ['Tour Manager', 'Tour Availability', 'Tour Notes']
    let stripped = String(existingNotes || '').trim()
    labels.forEach((label) => {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      stripped = stripped.replace(new RegExp(`(?:^|\\n)${escaped}:\\s*.+?(?=\\n|$)`, 'gi'), '')
    })
    stripped = stripped.replace(/^\n+|\n+$/g, '').trim()

    const parts = []
    if (metadata.manager) parts.push(`Tour Manager: ${metadata.manager}`)
    if (metadata.availability) parts.push(`Tour Availability: ${metadata.availability}`)
    if (metadata.notes) parts.push(`Tour Notes: ${metadata.notes}`)
    if (stripped) parts.push(stripped)
    return parts.join('\n')
  }

  function updateTourSlot(day, slot) {
    setTourForm((current) => ({
      ...current,
      availability: updateTourAvailabilityLines(current.availability, day, slot),
    }))
  }

  const approvedAssigned = useMemo(
    () => properties.filter((p) => propertyAssignedToManager(p, manager) && isPropertyRecordApproved(p)),
    [properties, manager],
  )
  const pendingAssigned = useMemo(
    () => properties.filter((p) => propertyAssignedToManager(p, manager) && !isPropertyRecordApproved(p)),
    [properties, manager],
  )

  async function handleSaveTourHours(property) {
    setSaving(true)
    try {
      const notes = buildTourNotes(property.Notes, tourForm)
      const updated = await updatePropertyAdmin(property.id, {
        Notes: notes,
        ...(tourForm.securityDeposit ? { 'Security Deposit': Number(tourForm.securityDeposit) } : {}),
      })
      setProperties((current) => {
        const next = current.map((item) => (item.id === property.id ? updated : item))
        onPropertiesChange?.(next)
        return next
      })
      toast.success('Tour hours saved')
      setEditingPropertyId(null)
    } catch (err) {
      toast.error('Could not save tour hours: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
      <div className="rounded-[24px] border border-slate-200 bg-white p-6">
        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#2563eb]">House Management</div>
        <h3 className="mt-2 text-xl font-black text-slate-900">Add a house</h3>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Add internal property records for leasing and resident operations. Enter building details, then go room by room (furnished status,
          rent, bath type, and more). Rows are written to Airtable <strong>Properties</strong> and <strong>Rooms</strong>. Public marketing
          listings still use the website property dataset.
        </p>

        <div className="mt-5">
          <AddHousingWizard
            createProperty={createPropertyAdmin}
            onSuccess={(created) => {
              setProperties((current) => {
                const next = [created, ...current]
                onPropertiesChange?.(next)
                return next
              })
            }}
          />
        </div>
      </div>

      <div className="rounded-[24px] border border-slate-200 bg-white p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Current Houses</div>
            <h3 className="mt-2 text-xl font-black text-slate-900">Operations property list</h3>
          </div>
          <button
            type="button"
            onClick={loadProperties}
            className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="mt-5 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-5 text-sm text-slate-500">Loading houses…</div>
        ) : approvedAssigned.length === 0 && pendingAssigned.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-5 text-sm text-slate-500">
            No houses on your account yet. Add a property below—it will show here once it&apos;s linked.
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            {pendingAssigned.length ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                <span className="font-semibold">{pendingAssigned.length} house{pendingAssigned.length === 1 ? '' : 's'} awaiting approval</span>
                <span className="text-amber-900/90"> — not shown below until approved.</span>
              </div>
            ) : null}
            {approvedAssigned.map((property) => (
              <div key={property.id} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4">
                <div className="text-sm font-semibold text-slate-900">{property.Name || property.Property || 'Untitled house'}</div>
                <div className="mt-1 text-sm text-slate-500">{property.Address || 'Address not set'}</div>
                <div className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                  Utilities fee {property['Utilities Fee'] ? `$${property['Utilities Fee']}` : 'not set'}
                </div>
                <div className="mt-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                  Security deposit {property['Security Deposit'] ? `$${property['Security Deposit']}` : 'not set'}
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  {extractNoteValue(property.Notes, 'Tour Manager') || 'No manager assigned'} · {extractNoteValue(property.Notes, 'Tour Availability') || 'No tour hours set'}
                </div>
                {editingPropertyId === property.id ? (
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">Tour manager</label>
                      <input
                        type="text"
                        value={tourForm.manager}
                        onChange={(e) => setTourForm((current) => ({ ...current, manager: e.target.value }))}
                        placeholder="Manager name"
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="mb-1 block text-xs font-semibold text-slate-600">Tour calendar</label>
                      <div className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-3">
                        <div className="grid gap-2 sm:grid-cols-2">
                          {TOUR_DAYS.map((day) => (
                            <div key={day} className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                              <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">{day}</div>
                              <div className="flex flex-wrap gap-2">
                                {TOUR_SLOTS.map((slot) => {
                                  const active = String(tourForm.availability || '').includes(`${day}:`) && String(tourForm.availability || '').includes(slot)
                                  return (
                                    <button
                                      key={`${day}-${slot}`}
                                      type="button"
                                      onClick={() => updateTourSlot(day, slot)}
                                      className={`rounded-full border px-2.5 py-1.5 text-[11px] font-semibold transition ${active ? 'border-[#2563eb] bg-[#2563eb] text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-[#2563eb] hover:text-[#2563eb]'}`}
                                    >
                                      {slot}
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                        <textarea
                          rows={4}
                          value={tourForm.availability}
                          onChange={(e) => setTourForm((current) => ({ ...current, availability: e.target.value }))}
                          placeholder="Mon: 9:00 AM, 1:30 PM\nTue: 10:30 AM, 3:00 PM"
                          className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-600">Security deposit</label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={tourForm.securityDeposit}
                        onChange={(e) => setTourForm((current) => ({ ...current, securityDeposit: e.target.value }))}
                        placeholder="500"
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="mb-1 block text-xs font-semibold text-slate-600">Notes</label>
                      <input
                        type="text"
                        value={tourForm.notes}
                        onChange={(e) => setTourForm((current) => ({ ...current, notes: e.target.value }))}
                        placeholder="Optional scheduling notes"
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900"
                      />
                    </div>
                    <div className="sm:col-span-2 flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingPropertyId(null)
                          setTourForm({ manager: '', availability: '', notes: '', securityDeposit: '' })
                        }}
                        className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSaveTourHours(property)}
                        className="rounded-2xl bg-[#2563eb] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                        disabled={saving}
                      >
                        Save tour hours
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingPropertyId(property.id)
                      setTourForm({
                        manager: extractNoteValue(property.Notes, 'Tour Manager'),
                        availability: extractNoteValue(property.Notes, 'Tour Availability'),
                        notes: extractNoteValue(property.Notes, 'Tour Notes'),
                        securityDeposit: String(property['Security Deposit'] || ''),
                      })
                    }}
                    className="mt-3 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700"
                  >
                    Edit tour hours
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── ManagerProfilePanel ──────────────────────────────────────────────────────
// Profile view: editable personal info + managed property addresses list
function ManagerProfilePanel({ manager, onManagerUpdate, approvedPropertyCount = 0 }) {
  const [form, setForm] = useState({ name: manager.name || '', phone: manager.phone || '' })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [properties, setProperties] = useState([])
  const [propsLoading, setPropsLoading] = useState(true)

  const approvedForProfile = useMemo(() => {
    if (manager.__axisDeveloper) {
      return properties.filter((p) => isPropertyRecordApproved(p))
    }
    return properties.filter((p) => propertyAssignedToManager(p, manager) && isPropertyRecordApproved(p))
  }, [properties, manager])

  useEffect(() => {
    fetchPropertiesAdmin()
      .then(setProperties)
      .catch(() => setProperties([]))
      .finally(() => setPropsLoading(false))
  }, [])

  async function handleSaveProfile(event) {
    event.preventDefault()
    if (manager.__axisDeveloper) {
      toast.info('Profile save is disabled in developer preview mode.')
      return
    }
    setSaving(true)
    setSaveError('')
    try {
      const res = await fetch('/api/portal?action=manager-update-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          managerId: manager.managerId,
          name: form.name.trim(),
          phone: form.phone.trim(),
        }),
      })
      const data = await readJsonResponse(res)
      if (!res.ok) throw new Error(data.error || 'Could not save profile.')
      toast.success('Profile saved')
      onManagerUpdate({ ...manager, name: form.name.trim(), phone: form.phone.trim() })
    } catch (err) {
      setSaveError(err.message || 'Could not save profile.')
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm transition focus:border-[#2563eb] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20'
  const readonlyCls = `${inputCls} cursor-default bg-slate-100 text-slate-500`

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Personal info */}
      <section className="rounded-[28px] border border-slate-200 bg-white p-6">
        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#2563eb]">Account</div>
        <h2 className="mt-2 text-2xl font-black text-slate-900">Manager profile</h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">
          Update your display name and phone number. Email and Manager ID are tied to your subscription — contact Axis to change these.
        </p>
        <form onSubmit={handleSaveProfile} className="mt-6 grid gap-5 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-slate-700">Full name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Your name"
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-slate-700">Email</label>
            <div className={readonlyCls}>{manager.email || '—'}</div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-slate-700">Phone</label>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              placeholder="+1 (206) 555-0100"
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-slate-700">Manager ID</label>
            <div className={`${readonlyCls} font-mono`}>{manager.managerId || '—'}</div>
          </div>
          {saveError ? (
            <div className="sm:col-span-2">
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{saveError}</div>
            </div>
          ) : null}
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={saving || (!form.name.trim() && !form.phone.trim())}
              className="rounded-2xl bg-[#2563eb] px-6 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save profile'}
            </button>
          </div>
        </form>
      </section>

      {/* Plan & subscription summary */}
      <section className="rounded-[28px] border border-slate-200 bg-white p-6">
        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Subscription</div>
        <h2 className="mt-2 text-xl font-black text-slate-900">Plan</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {[
            { label: 'Role', value: manager.role || 'Manager' },
            { label: 'Manager ID', value: manager.managerId || '—' },
            { label: 'Houses', value: propsLoading ? '…' : `${approvedPropertyCount} assigned` },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4">
              <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">{label}</div>
              <div className="mt-1 truncate text-base font-semibold text-slate-900">{value}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Managed property addresses */}
      <section className="rounded-[28px] border border-slate-200 bg-white p-6">
        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#2563eb]">Properties</div>
        <h2 className="mt-2 text-xl font-black text-slate-900">Properties on your account</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Add or edit houses under <strong>Properties</strong> in the dashboard.
        </p>

        {propsLoading ? (
          <div className="mt-5 text-sm text-slate-500">Loading properties…</div>
        ) : approvedForProfile.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-slate-100 bg-slate-50 p-6 text-center text-sm text-slate-500">
            No properties yet. Add a house under Properties or contact Axis to link your manager email.
          </div>
        ) : (
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {approvedForProfile.map((p) => (
              <div key={p.id} className="flex gap-4 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
                <div className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[#2563eb]/10">
                  <svg className="h-5 w-5 text-[#2563eb]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-black text-slate-900">{p.Name || p.Property || 'Untitled property'}</div>
                  <div className="mt-0.5 text-sm text-slate-600">{p.Address || <span className="italic text-slate-400">No address set</span>}</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {p['Utilities Fee'] ? (
                      <span className="rounded-full bg-blue-100 px-2.5 py-1 text-[11px] font-semibold text-blue-700">
                        Utilities ${p['Utilities Fee']}/mo
                      </span>
                    ) : null}
                    {p['Security Deposit'] ? (
                      <span className="rounded-full bg-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                        Deposit ${p['Security Deposit']}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

// ─── GenerateDraftModal ───────────────────────────────────────────────────────
// Collects lease data and calls /api/portal?action=generate-lease-draft
function GenerateDraftModal({ manager, propertyOptions, onClose, onGenerated }) {
  const [form, setForm] = useState({
    residentName: '',
    residentEmail: '',
    residentRecordId: '',
    applicationRecordId: '',
    property: '',
    unit: '',
    leaseTerm: '',
    leaseStartDate: '',
    leaseEndDate: '',
    rentAmount: '',
    depositAmount: '',
    utilitiesFee: '150',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const set = key => e => setForm(f => ({ ...f, [key]: e.target.value }))

  async function handleGenerate(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/portal?action=generate-lease-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, generatedBy: manager.name, generatedByRole: manager.role }),
      })
      const data = await readJsonResponse(res)
      if (!res.ok) throw new Error(data.error || 'Generation failed')
      toast.success('Lease draft generated — ready for review')
      onGenerated(data.draft)
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const inputCls = 'w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm transition focus:border-[#2563eb] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20'
  const labelCls = 'mb-1.5 block text-sm font-semibold text-slate-700'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-2xl rounded-[28px] bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-200 px-8 py-5">
          <div>
            <h2 className="text-xl font-black text-slate-900">Generate lease draft</h2>
            <p className="mt-0.5 text-sm text-slate-500">Choose the resident and property details, then generate the first lease draft for review.</p>
          </div>
          <button onClick={onClose} className="mt-0.5 rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleGenerate}>
          <div className="max-h-[62vh] space-y-6 overflow-y-auto px-8 py-6">
            {/* Resident */}
            <div>
              <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Resident</div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>Full Name *</label>
                  <input type="text" value={form.residentName} onChange={set('residentName')} required placeholder="Jane Smith" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Email</label>
                  <input type="email" value={form.residentEmail} onChange={set('residentEmail')} placeholder="jane@example.com" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Resident Record ID</label>
                  <input type="text" value={form.residentRecordId} onChange={set('residentRecordId')} placeholder="recXXXXXXXXXXXXXX" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Application Record ID</label>
                  <input type="text" value={form.applicationRecordId} onChange={set('applicationRecordId')} placeholder="APP-recXXX or recXXX" className={inputCls} />
                </div>
              </div>
            </div>

            {/* Property */}
            <div>
              <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Property</div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>Property *</label>
                  <select
                    value={form.property}
                    onChange={set('property')}
                    required={propertyOptions.length > 0}
                    disabled={propertyOptions.length === 0}
                    className={inputCls}
                  >
                    <option value="">
                      {propertyOptions.length ? 'Select property…' : 'Add a property under Properties first'}
                    </option>
                    {propertyOptions.map((property) => (
                      <option key={property} value={property}>{property}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Unit / Room</label>
                  <input type="text" value={form.unit} onChange={set('unit')} placeholder="e.g. Room 4" className={inputCls} />
                </div>
              </div>
            </div>

            {/* Lease terms */}
            <div>
              <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Lease Terms</div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>Lease Type</label>
                  <select value={form.leaseTerm} onChange={set('leaseTerm')} className={inputCls}>
                    <option value="">Select type…</option>
                    {LEASE_TERMS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Start Date *</label>
                  <input type="date" value={form.leaseStartDate} onChange={set('leaseStartDate')} required className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>End Date</label>
                  <input type="date" value={form.leaseEndDate} onChange={set('leaseEndDate')} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Monthly Rent ($)</label>
                  <input type="number" value={form.rentAmount} onChange={set('rentAmount')} min="0" step="1" placeholder="750" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Security Deposit ($)</label>
                  <input type="number" value={form.depositAmount} onChange={set('depositAmount')} min="0" step="1" placeholder="600" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Utilities Fee ($/mo)</label>
                  <input type="number" value={form.utilitiesFee} onChange={set('utilitiesFee')} min="0" step="1" placeholder="150" className={inputCls} />
                </div>
              </div>
            </div>
          </div>

          {error && (
            <div className="mx-8 mb-1 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          )}

          <div className="flex items-center justify-end gap-3 border-t border-slate-200 px-8 py-5">
            <button type="button" onClick={onClose} className="rounded-2xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-2xl bg-[#2563eb] px-6 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Generating with Claude…
                </>
              ) : (
                <>
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Generate draft
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Work orders (manager) ───────────────────────────────────────────────────
const WORK_ORDER_STATUSES = ['Submitted', 'In Progress', 'Resolved']
const WORK_ORDER_PRIORITIES = ['Routine', 'Low', 'Normal', 'High', 'Urgent', 'Emergency', 'Critical']

function normalizeWorkOrderRecordId(raw) {
  const s = String(raw || '').trim()
  const m = s.match(/rec[a-zA-Z0-9]{14,}/)
  return m ? m[0] : s.trim()
}

function workOrderLastUpdateToInput(value) {
  if (value == null || value === '') return ''
  const str = String(value)
  const isoDay = str.match(/^(\d{4}-\d{2}-\d{2})/)
  if (isoDay) return isoDay[1]
  const d = new Date(str)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}

function workOrderLinkedId(woField) {
  if (Array.isArray(woField) && woField.length) return String(woField[0]).trim()
  if (typeof woField === 'string' && woField.startsWith('rec')) return woField.trim()
  return ''
}

function parseCalendarDay(val) {
  if (!val) return null
  const m = String(val).match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}

function buildCalendarEvents(drafts, workOrders, applications) {
  const events = []
  for (const d of drafts || []) {
    const name = d['Resident Name'] || 'Resident'
    const s = parseCalendarDay(d['Lease Start Date'])
    if (s) events.push({ date: s, label: `Lease start · ${name}`, type: 'lease' })
    const e = parseCalendarDay(d['Lease End Date'])
    if (e) events.push({ date: e, label: `Lease end · ${name}`, type: 'lease' })
    const pub = parseCalendarDay(d['Published At'])
    if (pub) events.push({ date: pub, label: `Published · ${name}`, type: 'publish' })
    const ap = parseCalendarDay(d['Approved At'])
    if (ap && ap !== pub) events.push({ date: ap, label: `Approved · ${name}`, type: 'approve' })
  }
  for (const w of workOrders || []) {
    const title = (w.Title || 'Request').slice(0, 48)
    const sub = parseCalendarDay(w['Date Submitted'] || w.created_at)
    if (sub) events.push({ date: sub, label: `Work order · ${title}`, type: 'wo' })
    const lu = parseCalendarDay(w['Last Update'])
    if (lu && lu !== sub) events.push({ date: lu, label: `WO update · ${title}`, type: 'wo' })
  }
  for (const a of applications || []) {
    const nm = a['Signer Full Name'] || 'Applicant'
    const c = parseCalendarDay(a.Created || a.created_at)
    if (c) events.push({ date: c, label: `Application · ${nm}`, type: 'app' })
  }
  return events
}

function calendarDateKey(y, monthIndex, day) {
  return `${y}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const LEASE_STATUSES_NEEDING_ACTION = new Set(['Draft Generated', 'Under Review', 'Changes Needed', 'Approved'])

function ManagerDashboardHomePanel({
  manager,
  approvedHouseCount,
  stats,
  statsLoading,
  dataWarnings,
  onNavigate,
  onGenerateDraft,
  onOpenBilling,
}) {
  const displayDataWarnings = useMemo(
    () => consolidateManagerDashboardWarnings(dataWarnings || []),
    [dataWarnings],
  )
  const s = stats || {}
  const pendingApps = statsLoading ? null : s.pendingApps ?? 0
  const leasePending = statsLoading ? null : s.leasePending ?? 0
  const rentOverdue = statsLoading ? null : s.rentOverdue ?? 0
  const openWo = statsLoading ? null : s.openWo ?? 0

  const tasks = [
    {
      key: 'apps',
      label: 'Applications pending review',
      count: pendingApps,
      tab: 'applications',
      show: (pendingApps ?? 0) > 0,
    },
    {
      key: 'leases',
      label: 'Leases needing your action',
      sub: 'Draft, review, changes, or approved — not yet with the resident',
      count: leasePending,
      tab: 'leases',
      show: (leasePending ?? 0) > 0,
    },
    {
      key: 'rent',
      label: 'Rent overdue',
      count: rentOverdue,
      tab: 'payments',
      show: (rentOverdue ?? 0) > 0,
    },
    {
      key: 'wo',
      label: 'Open work orders',
      count: openWo,
      tab: 'workorders',
      show: (openWo ?? 0) > 0,
    },
  ]

  const visibleTasks = tasks.filter((t) => t.show)

  return (
    <div className="space-y-8">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#2563eb]">Home</div>
        <h2 className="mt-2 text-2xl font-black text-slate-900">Dashboard</h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-500">
          Tasks for your portfolio ({approvedHouseCount || 0} {approvedHouseCount === 1 ? 'house' : 'houses'}). Use the sidebar for full lists.
        </p>
      </div>

      {displayDataWarnings?.length ? (
        <div
          role="status"
          className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
        >
          <div className="font-semibold text-amber-900">Some dashboard data could not load</div>
          <ul className="mt-2 list-inside list-disc space-y-1 text-amber-900/90">
            {displayDataWarnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-black text-slate-900">Priority tasks</h3>
        <p className="mt-1 text-sm text-slate-500">Anything listed here needs attention soon.</p>
        {statsLoading ? (
          <p className="mt-6 text-sm text-slate-500">Loading…</p>
        ) : (approvedHouseCount ?? 0) === 0 ? (
          <p className="mt-6 text-sm text-slate-600">
            You don&apos;t have any houses in your portfolio yet. Add a house under Properties—applications, leases, and rent will show here once properties are linked to your account.
          </p>
        ) : visibleTasks.length === 0 ? (
          <p className="mt-6 text-sm text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-2xl px-4 py-3">
            Nothing urgent right now — you&apos;re caught up on applications, lease queue, overdue rent, and work orders for your houses.
          </p>
        ) : (
          <ul className="mt-5 divide-y divide-slate-100">
            {visibleTasks.map((t) => (
              <li key={t.key}>
                <button
                  type="button"
                  onClick={() => onNavigate(t.tab)}
                  className="flex w-full items-center justify-between gap-4 py-4 text-left transition hover:bg-slate-50/80"
                >
                  <div>
                    <div className="font-semibold text-slate-900">{t.label}</div>
                    {t.sub ? <div className="mt-0.5 text-xs text-slate-500">{t.sub}</div> : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="rounded-full bg-[#2563eb]/10 px-3 py-1 text-sm font-black text-[#2563eb]">{t.count}</span>
                    <span className="text-sm font-semibold text-[#2563eb]">Open →</span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onGenerateDraft}
          className="rounded-2xl bg-[#2563eb] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-110"
        >
          Generate lease draft
        </button>
        <button
          type="button"
          onClick={onOpenBilling}
          className="rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
        >
          Manager billing
        </button>
        <button
          type="button"
          onClick={() => onNavigate('properties')}
          className="rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
        >
          Properties
        </button>
      </div>
    </div>
  )
}

function ManagerCalendarPanel({ manager, scopedPropertyNames = [] }) {
  const [cursor, setCursor] = useState(() => new Date())
  const [loading, setLoading] = useState(true)
  const [events, setEvents] = useState([])
  const [calendarIssues, setCalendarIssues] = useState([])
  const [schedulingRows, setSchedulingRows] = useState([])
  const [weeklyFree, setWeeklyFree] = useState(() => emptyWeeklyFreeArrays())
  const [savedEncoded, setSavedEncoded] = useState('')
  const [availLoading, setAvailLoading] = useState(true)
  const [availSaving, setAvailSaving] = useState(false)
  const [selectedDay, setSelectedDay] = useState(null)
  const [brushMode, setBrushMode] = useState('free')
  const paintingRef = useRef(false)
  const brushModeRef = useRef('free')

  const propsKey = useMemo(
    () => [...scopedPropertyNames].map((s) => String(s).trim()).filter(Boolean).sort().join('|'),
    [scopedPropertyNames],
  )

  const reloadScheduling = useCallback(async () => {
    if (!AIRTABLE_TOKEN) {
      setSchedulingRows([])
      return
    }
    const email = String(manager?.email || '').trim()
    const props = (scopedPropertyNames || []).map((s) => String(s).trim()).filter(Boolean)
    if (!email && !props.length) {
      setSchedulingRows([])
      return
    }
    try {
      const rows = await fetchSchedulingForManagerScope({
        managerEmail: email,
        propertyNames: props,
      })
      setSchedulingRows(rows)
    } catch {
      setSchedulingRows([])
    }
  }, [manager?.email, propsKey])

  useEffect(() => {
    brushModeRef.current = brushMode
  }, [brushMode])

  const y = cursor.getFullYear()
  const m = cursor.getMonth()
  const monthLabel = cursor.toLocaleString('en-US', { month: 'long', year: 'numeric' })
  const daysInMonth = new Date(y, m + 1, 0).getDate()

  useEffect(() => {
    if (selectedDay != null && selectedDay > daysInMonth) setSelectedDay(null)
  }, [y, m, daysInMonth, selectedDay])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setCalendarIssues([])
    Promise.allSettled([fetchLeaseDrafts({}), getAllWorkOrders(), fetchApplications({})])
      .then((results) => {
        if (cancelled) return
        const issues = []
        const d = results[0].status === 'fulfilled' ? results[0].value : null
        const w = results[1].status === 'fulfilled' ? results[1].value : null
        const a = results[2].status === 'fulfilled' ? results[2].value : null
        if (results[0].status === 'rejected') issues.push(`Leases: ${formatDataLoadError(results[0].reason)}`)
        if (results[1].status === 'rejected') issues.push(`Work orders: ${formatDataLoadError(results[1].reason)}`)
        if (results[2].status === 'rejected') issues.push(`Applications: ${formatDataLoadError(results[2].reason)}`)
        setCalendarIssues(issues)
        setEvents(buildCalendarEvents(d || [], w || [], a || []))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    reloadScheduling()
  }, [reloadScheduling])

  useEffect(() => {
    if (!manager?.id || manager.__axisDeveloper) {
      setWeeklyFree(emptyWeeklyFreeArrays())
      setSavedEncoded('')
      setAvailLoading(false)
      return
    }
    let cancelled = false
    setAvailLoading(true)
    fetchManagerRecordById(manager.id)
      .then((rec) => {
        if (cancelled) return
        const text = String(rec['Tour Availability'] || '')
        const w = weeklyFreeArraysFromTourText(text)
        setWeeklyFree(w)
        setSavedEncoded(encodeTourAvailabilityFromWeeklyFree(w))
      })
      .catch(() => {
        if (cancelled) return
        const w = emptyWeeklyFreeArrays()
        setWeeklyFree(w)
        setSavedEncoded('')
      })
      .finally(() => {
        if (!cancelled) setAvailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [manager?.id, manager.__axisDeveloper])

  useEffect(() => {
    function endPaint() {
      paintingRef.current = false
    }
    window.addEventListener('mouseup', endPaint)
    window.addEventListener('blur', endPaint)
    return () => {
      window.removeEventListener('mouseup', endPaint)
      window.removeEventListener('blur', endPaint)
    }
  }, [])

  const schedulingEvents = useMemo(() => schedulingRowsToCalendarEvents(schedulingRows), [schedulingRows])
  const displayEvents = useMemo(() => [...events, ...schedulingEvents], [events, schedulingEvents])

  const encodedDraft = useMemo(() => encodeTourAvailabilityFromWeeklyFree(weeklyFree), [weeklyFree])
  const availabilityDirty = encodedDraft !== savedEncoded

  const pendingTourCount = useMemo(() => schedulingRows.filter(tourApprovalNeedsAction).length, [schedulingRows])

  const firstDow = new Date(y, m, 1).getDay()
  const cells = []
  for (let i = 0; i < firstDow; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const eventsForDay = (day) => {
    if (!day) return []
    const key = calendarDateKey(y, m, day)
    return displayEvents.filter((e) => e.date === key)
  }

  const freeSlotCountForDay = (day) => {
    if (!day) return 0
    const abbr = CAL_DOW_TO_ABBR[new Date(y, m, day).getDay()]
    return freeTourSlotCountForWeekday(weeklyFree, abbr)
  }

  const selectedKey = selectedDay != null ? calendarDateKey(y, m, selectedDay) : null
  const selectedWeekdayAbbr =
    selectedDay != null ? CAL_DOW_TO_ABBR[new Date(y, m, selectedDay).getDay()] : null

  const toursThisDay = useMemo(() => {
    if (!selectedKey) return []
    return schedulingRows.filter((r) => parseCalendarDay(r['Preferred Date']) === selectedKey)
  }, [schedulingRows, selectedKey])

  function eventToneCls(ev) {
    if (ev.type === 'tour_req') {
      const a = String(ev.approval || '').toLowerCase()
      if (a === 'approved') return 'bg-emerald-100 text-emerald-900'
      if (a === 'declined') return 'bg-red-100 text-red-800'
      return 'bg-sky-100 text-sky-900'
    }
    if (ev.type === 'lease') return 'bg-blue-100 text-blue-800'
    if (ev.type === 'publish' || ev.type === 'approve') return 'bg-axis/15 text-axis'
    if (ev.type === 'wo') return 'bg-amber-100 text-amber-900'
    if (ev.type === 'app') return 'bg-emerald-100 text-emerald-900'
    return 'bg-slate-100 text-slate-700'
  }

  function applyPaintToCell(dayAbbr, halfIdx) {
    const mode = brushModeRef.current
    setWeeklyFree((prev) => {
      const next = cloneWeeklyArrays(prev)
      const arr = next[dayAbbr]
      const i = arr.indexOf(halfIdx)
      if (mode === 'free') {
        if (i < 0) arr.push(halfIdx)
      } else if (i >= 0) {
        arr.splice(i, 1)
      }
      arr.sort((a, b) => a - b)
      return next
    })
  }

  function onGridCellDown(dayAbbr, halfIdx, e) {
    e.preventDefault()
    paintingRef.current = true
    applyPaintToCell(dayAbbr, halfIdx)
  }

  function onGridCellEnter(dayAbbr, halfIdx) {
    if (!paintingRef.current) return
    applyPaintToCell(dayAbbr, halfIdx)
  }

  function clearSelectedWeekday() {
    if (!selectedWeekdayAbbr) return
    setWeeklyFree((prev) => {
      const next = cloneWeeklyArrays(prev)
      next[selectedWeekdayAbbr] = []
      return next
    })
    toast.success(`Cleared ${selectedWeekdayAbbr} weekly hours`)
  }

  async function handleSaveWeeklyAvailability() {
    if (!manager?.id || manager.__axisDeveloper) {
      toast.info('Saving is disabled in developer preview mode.')
      return
    }
    setAvailSaving(true)
    try {
      const enc = encodeTourAvailabilityFromWeeklyFree(weeklyFree)
      await patchManagerRecord(manager.id, { 'Tour Availability': enc })
      setSavedEncoded(enc)
      toast.success('Weekly availability saved to your manager profile')
    } catch (err) {
      toast.error(err.message || 'Could not save availability')
    } finally {
      setAvailSaving(false)
    }
  }

  async function respondTourRequest(row, approve) {
    try {
      await patchSchedulingRecord(row.id, {
        'Manager Approval': approve ? 'Approved' : 'Declined',
      })
      toast.success(approve ? 'Tour approved' : 'Tour declined')
      await reloadScheduling()
    } catch (err) {
      toast.error(err.message || 'Could not update this request. Add a single-line field "Manager Approval" to Scheduling in Airtable if missing.')
    }
  }

  const today = new Date()
  const isToday = (day) =>
    day != null && today.getFullYear() === y && today.getMonth() === m && today.getDate() === day

  const selectedDateLabel =
    selectedDay != null
      ? new Date(y, m, selectedDay).toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        })
      : ''

  const freeStandardOnSelected =
    selectedWeekdayAbbr != null ? freeTourSlotCountForWeekday(weeklyFree, selectedWeekdayAbbr) : 0

  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-slate-900">Calendar</h2>
          <p className="mt-1 text-sm text-slate-500">
            Leases, work orders, applications, tour requests, and your weekly tour availability (saved to{' '}
            <code className="rounded bg-slate-100 px-1 text-[11px]">Tour Availability</code> on your manager profile — same format as
            public tour slots).
          </p>
          {pendingTourCount > 0 ? (
            <p className="mt-2 text-sm font-semibold text-sky-800">
              {pendingTourCount} tour request{pendingTourCount === 1 ? '' : 's'} need a yes/no response — open the day to approve or decline.
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCursor(new Date(y, m - 1, 1))}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            ←
          </button>
          <span className="min-w-[10rem] text-center text-sm font-bold text-slate-800">{monthLabel}</span>
          <button
            type="button"
            onClick={() => setCursor(new Date(y, m + 1, 1))}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            →
          </button>
        </div>
      </div>

      {manager.__axisDeveloper ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          Developer preview: weekly availability is not saved to Airtable from this session.
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-slate-600">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-800">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          Standard tour window open
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 font-semibold text-sky-900">
          <span className="h-2 w-2 rounded-full bg-sky-500" />
          Tour request
        </span>
      </div>

      {calendarIssues.length ? (
        <div
          role="status"
          className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-950"
        >
          <span className="font-semibold text-amber-900">Partial calendar: </span>
          <span className="text-amber-900/90">{calendarIssues.join(' · ')}</span>
        </div>
      ) : null}

      {loading ? (
        <div className="mt-8 py-16 text-center text-sm text-slate-500">Loading calendar…</div>
      ) : (
        <div className="mt-6 flex flex-col gap-8 lg:flex-row lg:items-start">
          <div className="min-w-0 flex-1 overflow-x-auto">
            <div className="grid min-w-[640px] grid-cols-7 gap-1 text-center text-[11px] font-bold uppercase tracking-wide text-slate-400">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                <div key={d} className="py-2">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid min-w-[640px] grid-cols-7 gap-1">
              {cells.map((day, idx) => {
                if (day == null) {
                  return <div key={`pad-${idx}`} className="min-h-[96px] rounded-xl bg-slate-50/50" />
                }
                const dayEvents = eventsForDay(day)
                const freeN = freeSlotCountForDay(day)
                const sel = selectedDay === day
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => setSelectedDay(day)}
                    className={classNames(
                      'flex min-h-[96px] flex-col rounded-xl border p-1.5 text-left transition',
                      sel
                        ? 'border-[#2563eb] bg-[#2563eb]/5 ring-2 ring-[#2563eb]/25'
                        : 'border-slate-100 bg-slate-50/80 hover:border-slate-200 hover:bg-white',
                      isToday(day) && !sel ? 'ring-1 ring-slate-300' : '',
                    )}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <span className="text-xs font-bold text-slate-800">{day}</span>
                      <span
                        className={classNames(
                          'shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold',
                          freeN === 0 ? 'bg-slate-200 text-slate-700' : 'bg-emerald-100 text-emerald-800',
                        )}
                      >
                        {freeN} open
                      </span>
                    </div>
                    <div className="mt-1 flex max-h-[56px] flex-col gap-0.5 overflow-y-auto">
                      {dayEvents.slice(0, 3).map((ev, i) => (
                        <span
                          key={`${ev.date}-${ev.schedulingId || i}-${ev.label}`}
                          className={`truncate rounded px-1 py-0.5 text-[10px] font-semibold leading-tight ${eventToneCls(ev)}`}
                          title={ev.label}
                        >
                          {ev.label}
                        </span>
                      ))}
                      {dayEvents.length > 3 ? (
                        <span className="text-[10px] text-slate-400">+{dayEvents.length - 3} more</span>
                      ) : null}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="w-full shrink-0 rounded-2xl border border-slate-200 bg-slate-50/50 p-5 lg:w-[min(100%,440px)]">
            {!selectedDay ? (
              <div className="text-sm text-slate-600">
                <p className="font-semibold text-slate-900">Day detail</p>
                <p className="mt-2 text-slate-500">
                  Select a date. You will edit <strong>that weekday every week</strong> (like When2meet): click and drag on half-hour cells to mark
                  when you are free or busy. Tour requests for that date appear below with approve / decline.
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-200 pb-3">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-[#2563eb]">Selected day</p>
                    <p className="mt-0.5 text-base font-black text-slate-900">{selectedDateLabel}</p>
                    <p className="mt-1 text-sm text-slate-600">
                      Editing weekly template for <span className="font-semibold text-slate-900">{selectedWeekdayAbbr}</span> —{' '}
                      <span className="font-semibold text-emerald-700">{freeStandardOnSelected}</span> of {TOUR_SLOTS.length} standard tour
                      windows covered.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedDay(null)}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    Close
                  </button>
                </div>

                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Paint availability</p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {TOUR_GRID_START_HOUR}:00–{TOUR_GRID_END_HOUR}:00 · hold and drag across cells (green = free for that half hour).
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setBrushMode('free')}
                      className={classNames(
                        'rounded-full border px-3 py-1.5 text-xs font-semibold transition',
                        brushMode === 'free'
                          ? 'border-emerald-500 bg-emerald-500 text-white'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-emerald-300',
                      )}
                    >
                      Mark free
                    </button>
                    <button
                      type="button"
                      onClick={() => setBrushMode('busy')}
                      className={classNames(
                        'rounded-full border px-3 py-1.5 text-xs font-semibold transition',
                        brushMode === 'busy'
                          ? 'border-slate-700 bg-slate-700 text-white'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400',
                      )}
                    >
                      Mark busy
                    </button>
                  </div>
                  {availLoading ? (
                    <p className="mt-3 text-sm text-slate-500">Loading your saved availability…</p>
                  ) : (
                    <div
                      className="mt-3 max-h-[280px] select-none overflow-y-auto rounded-xl border border-slate-200 bg-white"
                      onMouseLeave={() => {
                        paintingRef.current = false
                      }}
                    >
                      <div className="grid" style={{ gridTemplateColumns: '4.5rem 1fr' }}>
                        {Array.from({ length: TOUR_GRID_HALF_COUNT }, (_, halfIdx) => {
                          const active = (weeklyFree[selectedWeekdayAbbr] || []).includes(halfIdx)
                          const showLabel = halfIdx % 2 === 0
                          return (
                            <React.Fragment key={halfIdx}>
                              <div className="border-b border-r border-slate-100 px-1 py-0.5 text-[10px] text-slate-400">
                                {showLabel ? formatHalfHourIndexLabel(halfIdx) : ''}
                              </div>
                              <button
                                type="button"
                                className={classNames(
                                  'h-5 border-b border-slate-100 transition-colors',
                                  active ? 'bg-emerald-400/90 hover:bg-emerald-500' : 'bg-slate-50 hover:bg-slate-200/80',
                                )}
                                onMouseDown={(e) => onGridCellDown(selectedWeekdayAbbr, halfIdx, e)}
                                onMouseEnter={() => onGridCellEnter(selectedWeekdayAbbr, halfIdx)}
                                aria-label={`${formatHalfHourIndexLabel(halfIdx)} ${active ? 'free' : 'busy'}`}
                              />
                            </React.Fragment>
                          )
                        })}
                      </div>
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleSaveWeeklyAvailability}
                      disabled={availSaving || !availabilityDirty || manager.__axisDeveloper}
                      className="rounded-xl bg-[#2563eb] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      {availSaving ? 'Saving…' : 'Save weekly availability'}
                    </button>
                    <button
                      type="button"
                      onClick={clearSelectedWeekday}
                      className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-xs font-semibold text-red-800 hover:bg-red-100"
                    >
                      Clear {selectedWeekdayAbbr}
                    </button>
                  </div>
                </div>

                <div className="mt-6 border-t border-slate-200 pt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Standard tour slots (this weekday)</p>
                  <ul className="mt-2 max-h-[160px] space-y-1 overflow-y-auto">
                    {TOUR_SLOTS.map((slot) => {
                      const range = slotRangeMinutes(slot)
                      const idxs = range ? halfHourIndicesOverlappingRange(range.start, range.end) : []
                      const set = new Set(weeklyFree[selectedWeekdayAbbr] || [])
                      const open = idxs.some((i) => set.has(i))
                      return (
                        <li
                          key={slot}
                          className={classNames(
                            'flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-xs font-semibold',
                            open ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-slate-200 bg-white text-slate-500',
                          )}
                        >
                          <span>{slot}</span>
                          <span>{open ? 'Open' : 'Closed'}</span>
                        </li>
                      )
                    })}
                  </ul>
                </div>

                <div className="mt-6 border-t border-slate-200 pt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tour requests this date</p>
                  {toursThisDay.length === 0 ? (
                    <p className="mt-2 text-sm text-slate-500">No scheduled tour requests on this day.</p>
                  ) : (
                    <ul className="mt-2 space-y-3">
                      {toursThisDay.map((row) => {
                        const needs = tourApprovalNeedsAction(row)
                        const appr = String(row['Manager Approval'] || '').trim() || 'Pending'
                        return (
                          <li key={row.id} className="rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-sm">
                            <div className="font-bold text-slate-900">{row.Name || 'Guest'}</div>
                            <div className="mt-1 text-xs text-slate-600">
                              {row.Property ? `${row.Property} · ` : ''}
                              {row['Preferred Time'] || 'Time TBD'}
                              {row['Tour Format'] ? ` · ${row['Tour Format']}` : ''}
                            </div>
                            {row.Email ? <div className="mt-0.5 text-xs text-slate-500">{row.Email}</div> : null}
                            <div className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                              Manager approval: {appr}
                            </div>
                            {needs ? (
                              <div className="mt-2 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => respondTourRequest(row, true)}
                                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                                >
                                  Yes
                                </button>
                                <button
                                  type="button"
                                  onClick={() => respondTourRequest(row, false)}
                                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                                >
                                  No
                                </button>
                              </div>
                            ) : null}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const MANAGER_INBOX_AXIS = 'inbox:axis'

function managerInboxWoThreadId(woId) {
  return `wo:${woId}`
}

function managerInboxParseWoThreadId(s) {
  if (!s || !String(s).startsWith('wo:')) return null
  return String(s).slice(3)
}

const MANAGER_INBOX_THREAD_STATE_LS = 'axis_manager_inbox_thread_state_v1'

function loadLocalInboxStateMap(email) {
  const em = String(email || '').trim().toLowerCase()
  if (!em) return new Map()
  try {
    const root = JSON.parse(localStorage.getItem(MANAGER_INBOX_THREAD_STATE_LS) || '{}')
    const bucket = root[em] || {}
    const m = new Map()
    for (const [tk, v] of Object.entries(bucket)) {
      m.set(tk, {
        id: `local:${tk}`,
        lastReadAt: v.lastReadAt ? new Date(v.lastReadAt) : null,
        trashed: Boolean(v.trashed),
      })
    }
    return m
  } catch {
    return new Map()
  }
}

function saveLocalInboxStatePatch(email, threadKey, patch) {
  const em = String(email || '').trim().toLowerCase()
  const tk = String(threadKey || '').trim()
  if (!em || !tk) return
  try {
    const root = JSON.parse(localStorage.getItem(MANAGER_INBOX_THREAD_STATE_LS) || '{}')
    if (!root[em]) root[em] = {}
    const cur = root[em][tk] || {}
    const next = { ...cur }
    if (patch.lastReadAt !== undefined) {
      next.lastReadAt = patch.lastReadAt ? new Date(patch.lastReadAt).toISOString() : null
    }
    if (patch.trashed !== undefined) next.trashed = patch.trashed
    root[em][tk] = next
    localStorage.setItem(MANAGER_INBOX_THREAD_STATE_LS, JSON.stringify(root))
  } catch {
    /* ignore */
  }
}

/** @param {number} lastMsgTs */
function managerInboxSectionForRow(lastMsgTs, state) {
  if (state?.trashed) return 'trash'
  if (lastMsgTs <= 0) {
    return state?.lastReadAt ? 'opened' : 'unopened'
  }
  if (!state?.lastReadAt) return 'unopened'
  return lastMsgTs > state.lastReadAt.getTime() ? 'unopened' : 'opened'
}

function managerInboxStateKeyForSelection(selectedThreadId, axisThreadKey) {
  if (selectedThreadId === MANAGER_INBOX_AXIS) return axisThreadKey || ''
  if (!selectedThreadId || !String(selectedThreadId).startsWith('wo:')) return ''
  return String(selectedThreadId)
}

function InboxTabPanel({ manager, allowedPropertyNames }) {
  const [allMsgs, setAllMsgs] = useState([])
  const [scopedWos, setScopedWos] = useState([])
  const [axisMsgs, setAxisMsgs] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedThreadId, setSelectedThreadId] = useState(null)
  const [thread, setThread] = useState([])
  const [threadLoading, setThreadLoading] = useState(false)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [inboxStateMap, setInboxStateMap] = useState(() => new Map())
  const [inboxStateBackend, setInboxStateBackend] = useState('pending')

  const inboxScopeLower = useMemo(
    () => new Set((allowedPropertyNames || []).map((n) => String(n).trim().toLowerCase()).filter(Boolean)),
    [allowedPropertyNames],
  )

  const managerEmail = String(manager?.email || '').trim()
  const axisThreadKey = useMemo(() => {
    if (!portalInboxAirtableConfigured() || !managerEmail) return ''
    return siteManagerThreadKey(managerEmail)
  }, [managerEmail])

  const refreshInboxThreadState = useCallback(async () => {
    if (!managerEmail) {
      setInboxStateMap(new Map())
      setInboxStateBackend('none')
      return
    }
    if (inboxThreadStateAirtableEnabled()) {
      try {
        setInboxStateMap(await fetchInboxThreadStateMap(managerEmail))
        setInboxStateBackend('airtable')
        return
      } catch {
        /* fall back to browser storage */
      }
    }
    setInboxStateMap(loadLocalInboxStateMap(managerEmail))
    setInboxStateBackend('local')
  }, [managerEmail])

  const loadAll = useCallback(async () => {
    const hasScope = inboxScopeLower.size > 0
    const hasAxis = Boolean(axisThreadKey)
    if (!hasScope && !hasAxis) {
      setAllMsgs([])
      setScopedWos([])
      setAxisMsgs([])
      setLoading(false)
      try {
        await refreshInboxThreadState()
      } catch {
        /* non-fatal */
      }
      return
    }
    setLoading(true)
    try {
      const tasks = [getAllMessages(), getAllWorkOrders()]
      if (hasAxis) tasks.push(getMessagesByThreadKey(axisThreadKey))
      const results = await Promise.all(tasks)
      const msgs = results[0]
      const wos = results[1]
      const axis = hasAxis ? results[2] : []
      setAllMsgs(msgs)
      setAxisMsgs(axis)
      setScopedWos(hasScope ? wos.filter((w) => workOrderInScope(w, inboxScopeLower)) : [])
    } catch (err) {
      if (!isAirtablePermissionErrorMessage(err?.message)) {
        toast.error('Inbox failed to load: ' + formatDataLoadError(err))
      }
    } finally {
      setLoading(false)
      try {
        await refreshInboxThreadState()
      } catch {
        /* non-fatal */
      }
    }
  }, [inboxScopeLower, axisThreadKey, refreshInboxThreadState])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  const threadRows = useMemo(() => {
    const rows = []
    const msgTime = (m) => new Date(m?.Timestamp || m?.created_at || 0).getTime()

    for (const w of scopedWos) {
      const woMsgs = allMsgs.filter((m) => {
        if (isInternalPortalThreadMessage(m)) return false
        const id = workOrderLinkedId(m['Work Order'])
        return id === w.id
      })
      const last = woMsgs.reduce(
        (best, m) => (msgTime(m) > msgTime(best) ? m : best),
        woMsgs[0] || null,
      )
      const submitted = new Date(w['Date Submitted'] || w.created_at || 0).getTime()
      const lastMsgTs = last ? msgTime(last) : 0
      const ts = Math.max(submitted, lastMsgTs)
      rows.push({
        id: managerInboxWoThreadId(w.id),
        stateKey: managerInboxWoThreadId(w.id),
        title: w.Title || 'Work order',
        subtitle: workOrderPropertyLabel(w) || undefined,
        preview: last?.Message ? String(last.Message) : '',
        time: last ? fmtDateTime(last.Timestamp || last.created_at) : fmtDate(w['Date Submitted'] || w.created_at),
        ts,
        lastMsgTs,
      })
    }

    if (axisThreadKey) {
      const sortedAxis = [...axisMsgs].sort((a, b) => msgTime(a) - msgTime(b))
      const last = sortedAxis[sortedAxis.length - 1]
      const lastMsgTs = last ? msgTime(last) : 0
      rows.push({
        id: MANAGER_INBOX_AXIS,
        stateKey: axisThreadKey,
        title: 'Axis team',
        subtitle: 'Internal · not tied to a work order',
        preview: last?.Message ? String(last.Message) : '',
        time: last ? fmtDateTime(last.Timestamp || last.created_at) : '',
        ts: lastMsgTs,
        lastMsgTs,
      })
    }

    rows.sort((a, b) => b.ts - a.ts)
    return rows
  }, [scopedWos, allMsgs, axisMsgs, axisThreadKey])

  const threadRowsWithMeta = useMemo(() => {
    return threadRows.map((row) => {
      const st = inboxStateMap.get(row.stateKey)
      const section = managerInboxSectionForRow(row.lastMsgTs, st)
      const unread = section === 'unopened'
      return { ...row, section, unread }
    })
  }, [threadRows, inboxStateMap])

  const inboxSections = useMemo(() => {
    const unopened = []
    const opened = []
    const trash = []
    for (const row of threadRowsWithMeta) {
      if (row.section === 'trash') trash.push(row)
      else if (row.section === 'unopened') unopened.push(row)
      else opened.push(row)
    }
    return { unopened, opened, trash }
  }, [threadRowsWithMeta])

  const touchThreadRead = useCallback(
    async (stateKey) => {
      if (!managerEmail || !stateKey) return
      const iso = new Date().toISOString()
      const tryAirtable =
        (inboxStateBackend === 'airtable' || inboxStateBackend === 'pending') && inboxThreadStateAirtableEnabled()
      if (tryAirtable) {
        try {
          await markInboxThreadRead(managerEmail, stateKey)
          setInboxStateBackend('airtable')
          setInboxStateMap(await fetchInboxThreadStateMap(managerEmail))
          return
        } catch {
          saveLocalInboxStatePatch(managerEmail, stateKey, { lastReadAt: iso })
          setInboxStateBackend('local')
          setInboxStateMap(loadLocalInboxStateMap(managerEmail))
          return
        }
      }
      saveLocalInboxStatePatch(managerEmail, stateKey, { lastReadAt: iso })
      setInboxStateMap(loadLocalInboxStateMap(managerEmail))
      if (inboxStateBackend === 'pending') setInboxStateBackend('local')
    },
    [managerEmail, inboxStateBackend],
  )

  const moveThreadTrash = useCallback(
    async (stateKey, trashed) => {
      if (!managerEmail || !stateKey) return
      const tryAirtable =
        (inboxStateBackend === 'airtable' || inboxStateBackend === 'pending') && inboxThreadStateAirtableEnabled()
      if (tryAirtable) {
        try {
          await setInboxThreadTrash(managerEmail, stateKey, trashed)
          setInboxStateBackend('airtable')
          setInboxStateMap(await fetchInboxThreadStateMap(managerEmail))
          toast.success(trashed ? 'Moved to trash' : 'Restored to inbox')
          return
        } catch {
          saveLocalInboxStatePatch(managerEmail, stateKey, { trashed })
          setInboxStateBackend('local')
          setInboxStateMap(loadLocalInboxStateMap(managerEmail))
          toast.success(trashed ? 'Moved to trash' : 'Restored to inbox')
          return
        }
      }
      saveLocalInboxStatePatch(managerEmail, stateKey, { trashed })
      setInboxStateMap(loadLocalInboxStateMap(managerEmail))
      toast.success(trashed ? 'Moved to trash' : 'Restored to inbox')
    },
    [managerEmail, inboxStateBackend],
  )

  const selectedStateKey = managerInboxStateKeyForSelection(selectedThreadId, axisThreadKey)
  const selectedMeta = selectedStateKey ? inboxStateMap.get(selectedStateKey) : null
  const selectedInTrash = Boolean(selectedMeta?.trashed)

  const touchThreadReadRef = useRef(touchThreadRead)
  touchThreadReadRef.current = touchThreadRead
  const lastTouchedThreadRef = useRef('')

  useEffect(() => {
    if (!selectedStateKey) {
      lastTouchedThreadRef.current = ''
      return
    }
    if (lastTouchedThreadRef.current === selectedStateKey) return
    lastTouchedThreadRef.current = selectedStateKey
    void touchThreadReadRef.current(selectedStateKey)
  }, [selectedStateKey])

  useEffect(() => {
    if (!selectedThreadId) {
      setThread([])
      return
    }
    let cancelled = false
    async function run() {
      setThreadLoading(true)
      try {
        if (selectedThreadId === MANAGER_INBOX_AXIS) {
          const next = await getMessagesByThreadKey(axisThreadKey)
          if (!cancelled) {
            setThread(
              [...next].sort(
                (a, b) =>
                  new Date(a.Timestamp || a.created_at || 0) - new Date(b.Timestamp || b.created_at || 0),
              ),
            )
          }
          return
        }
        const woId = managerInboxParseWoThreadId(selectedThreadId)
        if (!woId) {
          if (!cancelled) setThread([])
          return
        }
        const next = await getMessages(woId)
        if (!cancelled) setThread(next)
      } catch (err) {
        if (!cancelled) {
          setThread([])
          toast.error(formatDataLoadError(err))
        }
      } finally {
        if (!cancelled) setThreadLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [selectedThreadId, axisThreadKey])

  async function handleSendReply(e) {
    e.preventDefault()
    if (!selectedThreadId || !reply.trim() || !managerEmail) return
    setSending(true)
    try {
      if (selectedThreadId === MANAGER_INBOX_AXIS) {
        await sendMessage({
          senderEmail: managerEmail,
          message: reply.trim(),
          isAdmin: false,
          threadKey: axisThreadKey,
          channel: PORTAL_INBOX_CHANNEL_INTERNAL,
        })
      } else {
        const woId = managerInboxParseWoThreadId(selectedThreadId)
        if (!woId) return
        await sendMessage({
          workOrderId: woId,
          senderEmail: managerEmail,
          message: reply.trim(),
          isAdmin: true,
        })
      }
      setReply('')
      await loadAll()
      if (selectedThreadId === MANAGER_INBOX_AXIS) {
        const next = await getMessagesByThreadKey(axisThreadKey)
        setThread(
          [...next].sort(
            (a, b) =>
              new Date(a.Timestamp || a.created_at || 0) - new Date(b.Timestamp || b.created_at || 0),
          ),
        )
      } else {
        const woId = managerInboxParseWoThreadId(selectedThreadId)
        if (woId) setThread(await getMessages(woId))
      }
      const sk = managerInboxStateKeyForSelection(selectedThreadId, axisThreadKey)
      if (sk) await touchThreadRead(sk)
      toast.success('Sent')
    } catch (err) {
      toast.error(err.message || 'Send failed')
    } finally {
      setSending(false)
    }
  }

  if (!inboxScopeLower.size && !axisThreadKey) {
    return null
  }

  const readingTitle =
    selectedThreadId === MANAGER_INBOX_AXIS
      ? 'Axis team'
      : (() => {
          const woId = managerInboxParseWoThreadId(selectedThreadId || '')
          const w = scopedWos.find((x) => x.id === woId)
          return w?.Title || 'Work order'
        })()

  return (
    <div className="mb-6 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-slate-900">Inbox</h2>
          <p className="mt-1 text-sm text-slate-500">
            Message residents on work orders, chat with Axis, or send anything else — same as email: unopened, opened, and trash on the left; compose below the conversation.
          </p>
        </div>
        <button
          type="button"
          onClick={() => loadAll()}
          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          Refresh
        </button>
      </div>

      <GmailStyleInboxLayout
        left={
          <>
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-white px-4 py-3">
              <span className="text-sm font-black text-slate-900">Conversations</span>
              <span className="text-xs text-slate-400">{threadRows.length}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {loading ? (
                <div className="py-12 text-center text-sm text-slate-500">Loading…</div>
              ) : threadRows.length === 0 ? (
                <div className="px-4 py-12 text-center text-sm text-slate-500">No conversations yet.</div>
              ) : (
                <>
                  {[
                    { key: 'unopened', label: 'Unopened', rows: inboxSections.unopened },
                    { key: 'opened', label: 'Opened', rows: inboxSections.opened },
                    { key: 'trash', label: 'Trash', rows: inboxSections.trash },
                  ].map(({ key, label, rows: secRows }) => (
                    <div key={key} className="border-b border-slate-100 last:border-b-0">
                      <div className="sticky top-0 z-[1] bg-slate-100/95 px-4 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                        {label}{' '}
                        <span className="font-semibold tabular-nums text-slate-400">({secRows.length})</span>
                      </div>
                      {secRows.length === 0 ? (
                        <div className="px-4 py-3 text-xs text-slate-400">None</div>
                      ) : (
                        <ul className="divide-y divide-slate-100">
                          {secRows.map((row) => (
                            <li key={row.id}>
                              <InboxThreadRow
                                title={row.title}
                                subtitle={row.subtitle}
                                preview={row.preview}
                                time={row.time}
                                selected={selectedThreadId === row.id}
                                unread={row.unread}
                                onClick={() => setSelectedThreadId(row.id)}
                              />
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </>
              )}
            </div>
          </>
        }
        right={
          <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
            <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-3 lg:px-5">
              {selectedThreadId ? (
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-base font-black text-slate-900">{readingTitle}</h3>
                    <p className="mt-0.5 break-all text-xs text-slate-500">
                      {selectedThreadId === MANAGER_INBOX_AXIS
                        ? axisThreadKey
                        : managerInboxParseWoThreadId(selectedThreadId)}
                    </p>
                  </div>
                  {selectedStateKey ? (
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {selectedInTrash ? (
                        <button
                          type="button"
                          onClick={() => moveThreadTrash(selectedStateKey, false)}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Restore
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => moveThreadTrash(selectedStateKey, true)}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-red-50 hover:text-red-800"
                        >
                          Trash
                        </button>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-slate-500">Select a conversation</p>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-5">
              {!selectedThreadId ? (
                <div className="flex h-full min-h-[200px] flex-col items-center justify-center text-center text-sm text-slate-400">
                  Choose a thread on the left to read messages.
                </div>
              ) : threadLoading ? (
                <div className="py-16 text-center text-sm text-slate-500">Loading thread…</div>
              ) : thread.length === 0 ? (
                <div className="flex min-h-[14rem] flex-col items-center justify-center px-4 text-center">
                  <p className="text-sm font-medium text-slate-600">This conversation is empty.</p>
                  <p className="mt-2 max-w-xs text-xs leading-relaxed text-slate-400">
                    Nothing to show here yet — use the message box below when you are ready to send.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {thread.map((m) => {
                    const admin = m['Is Admin'] === true || m['Is Admin'] === 1
                    const isAxis = selectedThreadId === MANAGER_INBOX_AXIS
                    const you = isAxis ? !admin : admin
                    return (
                      <div
                        key={m.id}
                        className={classNames(
                          'max-w-[min(100%,40rem)] rounded-2xl border px-4 py-3 text-sm shadow-sm',
                          you
                            ? 'ml-auto border-blue-200 bg-blue-50/90 text-slate-900'
                            : 'mr-auto border-slate-200 bg-white text-slate-900',
                        )}
                      >
                        <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                          {isAxis
                            ? admin
                              ? 'Axis Admin'
                              : 'You'
                            : admin
                              ? 'You (management)'
                              : m['Sender Email'] || 'Resident'}{' '}
                          · {fmtDateTime(m.Timestamp || m.created_at)}
                        </div>
                        <p className="mt-1.5 whitespace-pre-wrap leading-relaxed">{m.Message}</p>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            {selectedThreadId ? (
              <form
                onSubmit={handleSendReply}
                className="shrink-0 border-t border-slate-200 bg-white p-4 lg:p-5"
              >
                <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  Message
                </label>
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  rows={3}
                  placeholder={
                    selectedThreadId === MANAGER_INBOX_AXIS
                      ? 'Write anything to Axis (questions, updates, requests)…'
                      : 'Write your message to the resident…'
                  }
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/20"
                />
                <div className="mt-3 flex justify-end">
                  <button
                    type="submit"
                    disabled={sending || !reply.trim()}
                    className="rounded-2xl bg-[#2563eb] px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {sending ? 'Sending…' : 'Send'}
                  </button>
                </div>
              </form>
            ) : null}
            {selectedThreadId === MANAGER_INBOX_AXIS && axisThreadKey ? (
              <PortalInboxAnnouncementSection
                variant="site_manager"
                userEmail={managerEmail}
                notifyThreadKey={axisThreadKey}
                onInboxRefresh={loadAll}
                propertySuggestions={allowedPropertyNames || []}
                listId="manager-inbox-announcement-props"
              />
            ) : null}
          </div>
        }
      />
    </div>
  )
}

function WorkOrdersTabPanel({ manager, allowedPropertyNames }) {
  const scopeLower = useMemo(
    () => new Set((allowedPropertyNames || []).map((n) => String(n).trim().toLowerCase()).filter(Boolean)),
    [allowedPropertyNames],
  )

  const [list, setList] = useState([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [quickFilter, setQuickFilter] = useState('open')
  const [search, setSearch] = useState('')
  const [record, setRecord] = useState(null)
  const [openingId, setOpeningId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')

  const [status, setStatus] = useState('Submitted')
  const [priority, setPriority] = useState('Routine')
  const [managementNotes, setManagementNotes] = useState('')
  const [updateText, setUpdateText] = useState('')
  const [resolutionSummary, setResolutionSummary] = useState('')
  const [resolved, setResolved] = useState(false)
  const [lastUpdate, setLastUpdate] = useState('')

  const [messages, setMessages] = useState([])
  const [reply, setReply] = useState('')
  const [msgBusy, setMsgBusy] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const fieldCls =
    'w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/20'

  const statusOptions = useMemo(() => {
    const s = record?.Status
    if (s && !WORK_ORDER_STATUSES.includes(s)) return [s, ...WORK_ORDER_STATUSES]
    return WORK_ORDER_STATUSES
  }, [record?.Status])

  const priorityOptions = useMemo(() => {
    const p = record?.Priority
    if (p && !WORK_ORDER_PRIORITIES.includes(p)) return [p, ...WORK_ORDER_PRIORITIES]
    return WORK_ORDER_PRIORITIES
  }, [record?.Priority])

  function applyRecordToForm(r) {
    setStatus(r.Status || 'Submitted')
    setPriority(r.Priority || 'Routine')
    setManagementNotes(String(r['Management Notes'] ?? ''))
    setUpdateText(String(r.Update ?? ''))
    setResolutionSummary(String(r['Resolution Summary'] ?? ''))
    setResolved(workOrderIsResolvedRecord(r))
    setLastUpdate(workOrderLastUpdateToInput(r['Last Update']))
  }

  const loadList = useCallback(async () => {
    if (!scopeLower.size) {
      setList([])
      setListLoading(false)
      return
    }
    setListLoading(true)
    setListError('')
    try {
      const all = await getAllWorkOrders()
      setList(all.filter((w) => workOrderInScope(w, scopeLower)))
    } catch (err) {
      setList([])
      const msg = formatDataLoadError(err)
      setListError(msg)
      if (!isAirtablePermissionErrorMessage(err?.message)) {
        toast.error('Work orders failed to load: ' + msg)
      }
    } finally {
      setListLoading(false)
    }
  }, [scopeLower])

  useEffect(() => {
    loadList()
  }, [loadList])

  const filteredList = useMemo(() => {
    let rows = list
    if (quickFilter === 'open') rows = rows.filter((w) => !workOrderIsResolvedRecord(w))
    if (quickFilter === 'resolved') rows = rows.filter((w) => workOrderIsResolvedRecord(w))
    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter((w) => {
        const prop = workOrderPropertyLabel(w).toLowerCase()
        const t = `${w.Title || ''} ${w.Description || ''} ${w.id} ${prop}`.toLowerCase()
        return t.includes(q)
      })
    }
    return [...rows].sort(
      (a, b) =>
        new Date(b['Date Submitted'] || b.created_at || 0) -
        new Date(a['Date Submitted'] || a.created_at || 0),
    )
  }, [list, quickFilter, search])

  const openCount = useMemo(() => list.filter((w) => !workOrderIsResolvedRecord(w)).length, [list])

  async function openWorkOrder(id) {
    const rid = normalizeWorkOrderRecordId(id)
    if (!rid) return
    setOpeningId(rid)
    setLoadError('')
    setLoading(true)
    setRecord(null)
    setMessages([])
    try {
      const wo = await getWorkOrderById(rid)
      if (!workOrderInScope(wo, scopeLower)) {
        setLoadError('This work order is not linked to a house in your portfolio.')
        return
      }
      setRecord(wo)
      applyRecordToForm(wo)
      setMessages(await getMessages(rid))
    } catch (err) {
      setLoadError(err.message || 'Could not load work order.')
    } finally {
      setLoading(false)
      setOpeningId(null)
    }
  }

  async function handleSave(event) {
    event.preventDefault()
    if (!record?.id) return
    setSaving(true)
    try {
      const fields = {
        Status: status,
        Priority: priority,
        'Management Notes': managementNotes || '',
        Update: updateText || '',
        'Resolution Summary': resolutionSummary || '',
        Resolved: resolved,
      }
      if (lastUpdate.trim()) fields['Last Update'] = lastUpdate.trim()
      const next = await updateWorkOrder(record.id, fields)
      setRecord(next)
      applyRecordToForm(next)
      await loadList()
      toast.success('Work order saved')
    } catch (err) {
      toast.error(err.message || 'Could not save work order')
    } finally {
      setSaving(false)
    }
  }

  async function handleMarkFixed() {
    if (!record?.id) return
    setSaving(true)
    const today = new Date().toISOString().slice(0, 10)
    try {
      const fields = {
        Resolved: true,
        Status: 'Resolved',
        'Last Update': lastUpdate.trim() || today,
      }
      if (resolutionSummary.trim()) fields['Resolution Summary'] = resolutionSummary.trim()
      const next = await updateWorkOrder(record.id, fields)
      setRecord(next)
      applyRecordToForm(next)
      setStatus('Resolved')
      setResolved(true)
      await loadList()
      toast.success('Marked as fixed')
    } catch (err) {
      toast.error(err.message || 'Could not update')
    } finally {
      setSaving(false)
    }
  }

  async function handleSendThreadReply(e) {
    e.preventDefault()
    if (!record?.id || !reply.trim()) return
    const email = String(manager?.email || 'manager@axis').trim()
    setMsgBusy(true)
    try {
      await sendMessage({
        workOrderId: record.id,
        senderEmail: email,
        message: reply.trim(),
        isAdmin: true,
      })
      setReply('')
      setMessages(await getMessages(record.id))
      await loadList()
      toast.success('Reply sent')
    } catch (err) {
      toast.error(err.message || 'Could not send')
    } finally {
      setMsgBusy(false)
    }
  }

  async function handleAiSuggest() {
    if (!record?.id) return
    setAiBusy(true)
    try {
      const res = await fetch('/api/portal?action=work-order-ai-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: record.Title,
          description: record.Description,
          property: workOrderPropertyLabel(record),
          status,
          priority,
          managerName: manager?.name || manager?.email || 'Manager',
          messages: messages.map((m) => ({
            text: m.Message,
            isAdmin: m['Is Admin'] === true || m['Is Admin'] === 1,
          })),
        }),
      })
      const data = await readJsonResponse(res)
      if (!res.ok) throw new Error(data.error || 'AI suggestion failed')
      const suggestion = String(data.suggestion || '').trim()
      if (!suggestion) throw new Error('Empty suggestion')
      setReply((prev) => (prev.trim() ? `${prev.trim()}\n\n${suggestion}` : suggestion))
      toast.success('Draft added — edit before sending')
    } catch (err) {
      toast.error(err.message || 'AI failed')
    } finally {
      setAiBusy(false)
    }
  }

  if (!scopeLower.size) {
    return null
  }

  return (
    <div className="mb-10 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-slate-900">Work orders</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Requests for your houses only. Use the thread to message residents, or mark fixed when the job is done. AI can draft a reply (optional) — always review before sending.
          </p>
        </div>
        <button
          type="button"
          onClick={() => loadList()}
          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          Refresh
        </button>
      </div>

      {listError ? (
        <div
          role="alert"
          className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-950"
        >
          <div className="font-semibold text-amber-900">Could not load work orders</div>
          <p className="mt-2 text-amber-900/90">{listError}</p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {[
          ['open', 'Open', openCount],
          ['all', 'All', list.length],
          ['resolved', 'Resolved', list.length - openCount],
        ].map(([k, lab, count]) => (
          <button
            key={k}
            type="button"
            onClick={() => setQuickFilter(k)}
            className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
              quickFilter === k ? 'bg-[#2563eb] text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {lab}
            <span className="ml-1.5 tabular-nums opacity-80">({count})</span>
          </button>
        ))}
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by title, house, or description…"
        className={fieldCls}
      />

      <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
        {listLoading ? (
          <div className="px-6 py-14 text-center text-sm text-slate-500">Loading work orders…</div>
        ) : filteredList.length === 0 ? (
          <div className="px-6 py-14 text-center text-sm text-slate-500">
            {list.length === 0 ? 'No work orders for your houses yet.' : 'Nothing matches this filter.'}
          </div>
        ) : (
          <ul className="max-h-[min(52vh,420px)] divide-y divide-slate-100 overflow-y-auto">
            {filteredList.map((w) => {
              const house = workOrderPropertyLabel(w)
              const done = workOrderIsResolvedRecord(w)
              return (
                <li key={w.id}>
                  <button
                    type="button"
                    onClick={() => openWorkOrder(w.id)}
                    className={classNames(
                      'flex w-full flex-col gap-1 px-5 py-4 text-left transition',
                      (record?.id === w.id || openingId === w.id)
                        ? 'bg-[#2563eb]/6 ring-1 ring-inset ring-[#2563eb]/25'
                        : 'hover:bg-slate-50/80',
                    )}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <span className="font-bold text-slate-900">{w.Title || 'Untitled request'}</span>
                      <span
                        className={classNames(
                          'shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide',
                          done ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900',
                        )}
                      >
                        {done ? 'Fixed' : 'Open'}
                      </span>
                    </div>
                    <div className="text-xs font-medium text-slate-500">
                      {house || 'House not set'} · {fmtDate(w['Date Submitted'] || w.created_at)}
                      {w.Status ? <span> · {w.Status}</span> : null}
                    </div>
                    {w.Description ? (
                      <p className="line-clamp-2 text-sm text-slate-600">{w.Description}</p>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {loadError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{loadError}</div>
      ) : null}

      {record || openingId ? (
        <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
          {loading || !record ? (
            <div className="px-6 py-16 text-center text-sm text-slate-500">Loading work order…</div>
          ) : (
            <div className="space-y-6 p-6 sm:p-8">
              <div className="flex flex-col gap-4 border-b border-slate-100 pb-6 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Selected request</div>
                  <h3 className="mt-1 text-xl font-black text-slate-900">{record.Title || 'Work order'}</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    {workOrderPropertyLabel(record) || 'House not set'} · Submitted{' '}
                    {fmtDate(record['Date Submitted'] || record.created_at)}
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-slate-400">{record.id}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={saving || workOrderIsResolvedRecord(record)}
                    onClick={handleMarkFixed}
                    className="rounded-2xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {saving ? 'Saving…' : 'Mark as fixed'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAdvanced((v) => !v)}
                    className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    {showAdvanced ? 'Hide' : 'Show'} Airtable fields
                  </button>
                </div>
              </div>

              {record.Description ? (
                <div className="rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-3">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Resident description</div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{record.Description}</p>
                </div>
              ) : null}

              <div>
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-black text-slate-900">Conversation</h4>
                  <span className="text-xs text-slate-400">Same thread as the resident portal</span>
                </div>
                <div className="max-h-[min(45vh,380px)] space-y-3 overflow-y-auto rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-4">
                  {messages.length === 0 ? (
                    <p className="py-6 text-center text-sm text-slate-500">No messages yet — say hello below.</p>
                  ) : (
                    messages.map((m) => {
                      const admin = m['Is Admin'] === true || m['Is Admin'] === 1
                      return (
                        <div
                          key={m.id}
                          className={classNames(
                            'max-w-[min(100%,42rem)] rounded-2xl border px-4 py-3 text-sm shadow-sm',
                            admin
                              ? 'ml-auto border-violet-200 bg-violet-50/90 text-violet-950'
                              : 'mr-auto border-slate-200 bg-white text-slate-900',
                          )}
                        >
                          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
                            {admin ? 'You (management)' : m['Sender Email'] || 'Resident'} ·{' '}
                            {fmtDateTime(m.Timestamp || m.created_at)}
                          </div>
                          <p className="mt-1.5 whitespace-pre-wrap leading-relaxed">{m.Message}</p>
                        </div>
                      )
                    })
                  )}
                </div>

                <div className="mt-4 space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={aiBusy}
                      onClick={handleAiSuggest}
                      className="rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-xs font-semibold text-indigo-900 hover:bg-indigo-100 disabled:opacity-50"
                    >
                      {aiBusy ? 'Drafting…' : 'AI draft reply'}
                    </button>
                    <span className="self-center text-xs text-slate-400">Uses Claude on the server · needs ANTHROPIC_API_KEY</span>
                  </div>
                  <form onSubmit={handleSendThreadReply} className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <textarea
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      rows={4}
                      placeholder="Write a reply to the resident…"
                      className="min-w-0 flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/20"
                    />
                    <button
                      type="submit"
                      disabled={msgBusy || !reply.trim()}
                      className="rounded-2xl bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] px-6 py-3 text-sm font-semibold text-white shadow-[0_6px_18px_rgba(37,99,235,0.22)] disabled:opacity-50"
                    >
                      {msgBusy ? 'Sending…' : 'Send reply'}
                    </button>
                  </form>
                </div>
              </div>

              {showAdvanced ? (
                <form onSubmit={handleSave} className="space-y-4 border-t border-slate-100 pt-6">
                  <h4 className="text-sm font-black text-slate-900">Airtable fields</h4>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-slate-600">Status</label>
                      <select value={status} onChange={(e) => setStatus(e.target.value)} className={fieldCls}>
                        {statusOptions.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-slate-600">Priority</label>
                      <select value={priority} onChange={(e) => setPriority(e.target.value)} className={fieldCls}>
                        {priorityOptions.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-slate-600">Management notes</label>
                    <textarea
                      rows={2}
                      value={managementNotes}
                      onChange={(e) => setManagementNotes(e.target.value)}
                      className={fieldCls}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-slate-600">Internal update log</label>
                    <textarea rows={3} value={updateText} onChange={(e) => setUpdateText(e.target.value)} className={fieldCls} />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-semibold text-slate-600">Resolution summary</label>
                    <textarea
                      rows={2}
                      value={resolutionSummary}
                      onChange={(e) => setResolutionSummary(e.target.value)}
                      className={fieldCls}
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3">
                      <input
                        type="checkbox"
                        checked={resolved}
                        onChange={(e) => setResolved(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-[#2563eb]"
                      />
                      <span className="text-sm font-semibold text-slate-800">Resolved</span>
                    </label>
                    <div>
                      <label className="mb-1.5 block text-xs font-semibold text-slate-600">Last update (date)</label>
                      <input type="date" value={lastUpdate} onChange={(e) => setLastUpdate(e.target.value)} className={fieldCls} />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-2xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {saving ? 'Saving…' : 'Save to Airtable'}
                  </button>
                </form>
              ) : null}
            </div>
          )}
        </div>
      ) : (
        !listLoading &&
        filteredList.length > 0 && (
          <p className="text-center text-sm text-slate-400">Select a work order above to view the thread and reply.</p>
        )
      )}
    </div>
  )
}

// ─── ManagerPaymentsPanel ─────────────────────────────────────────────────────
function ManagerPaymentsPanel({ allowedPropertyNames }) {
  const scopeLower = useMemo(
    () => new Set((allowedPropertyNames || []).map((n) => String(n).trim().toLowerCase()).filter(Boolean)),
    [allowedPropertyNames],
  )
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [busy, setBusy] = useState({})
  const [paymentsLoadError, setPaymentsLoadError] = useState('')
  const [selectedYm, setSelectedYm] = useState(() => currentYm())

  const load = useCallback(async () => {
    setLoading(true)
    setPaymentsLoadError('')
    try {
      const all = await getAllPaymentsRecords()
      const scoped = scopeLower.size
        ? all.filter((p) => paymentInScope(p, scopeLower) && isRentPaymentRecord(p))
        : []
      scoped.sort(
        (a, b) =>
          new Date(b['Due Date'] || b.created_at || 0) - new Date(a['Due Date'] || a.created_at || 0),
      )
      setRows(scoped)
    } catch (err) {
      const msg = formatDataLoadError(err)
      setPaymentsLoadError(msg)
      setRows([])
      const isPerm = isAirtablePermissionErrorMessage(err?.message)
      if (!isPerm) {
        toast.error('Could not load payments: ' + msg)
      }
    } finally {
      setLoading(false)
    }
  }, [scopeLower])

  useEffect(() => {
    load()
  }, [load])

  const monthOptions = useMemo(() => {
    const keys = new Set()
    const d = new Date()
    for (let i = 0; i < 24; i += 1) {
      const t = new Date(d.getFullYear(), d.getMonth() - i, 1)
      keys.add(ymFromDate(t))
    }
    rows.forEach((p) => {
      const k = paymentMonthKeyFromRecord(p)
      if (k) keys.add(k)
    })
    if (selectedYm) keys.add(selectedYm)
    return [...keys].sort((a, b) => b.localeCompare(a))
  }, [rows, selectedYm])

  const rowsForSelectedMonth = useMemo(
    () => rows.filter((p) => paymentMonthKeyFromRecord(p) === selectedYm),
    [rows, selectedYm],
  )

  const monthOverdueCount = useMemo(
    () => rowsForSelectedMonth.filter((p) => isPaymentOverdueRecord(p)).length,
    [rowsForSelectedMonth],
  )
  const monthPaidCount = useMemo(
    () => rowsForSelectedMonth.filter((p) => String(p.Status || '').trim().toLowerCase() === 'paid').length,
    [rowsForSelectedMonth],
  )
  const monthPendingCount = useMemo(
    () =>
      rowsForSelectedMonth.filter((p) => {
        if (String(p.Status || '').trim().toLowerCase() === 'paid') return false
        return !isPaymentOverdueRecord(p)
      }).length,
    [rowsForSelectedMonth],
  )

  const filteredForList = useMemo(() => {
    let list = rowsForSelectedMonth
    if (filter === 'overdue') list = list.filter((p) => isPaymentOverdueRecord(p))
    if (filter === 'paid') list = list.filter((p) => String(p.Status || '').trim().toLowerCase() === 'paid')
    if (filter === 'unpaid') list = list.filter((p) => String(p.Status || '').trim().toLowerCase() !== 'paid')
    return list
  }, [rowsForSelectedMonth, filter])

  const groupedByHouse = useMemo(() => {
    const map = new Map()
    for (const p of filteredForList) {
      const house = paymentPropertyLabel(p) || 'House'
      if (!map.has(house)) map.set(house, [])
      map.get(house).push(p)
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      .map(([house, items]) => ({
        house,
        items: [...items].sort(comparePaymentByRoom),
      }))
  }, [filteredForList])

  async function markPaid(id) {
    setBusy((b) => ({ ...b, [id]: true }))
    try {
      await updatePaymentRecord(id, { Status: 'Paid' })
      await load()
      toast.success('Marked as paid')
    } catch (err) {
      toast.error(err.message || 'Update failed')
    } finally {
      setBusy((b) => {
        const n = { ...b }
        delete n[id]
        return n
      })
    }
  }

  return (
    <div className="mb-10 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-slate-900">Rent &amp; payments</h2>
          <p className="mt-1 text-sm text-slate-500">
            By house and room. Totals below are for the month you select. Mark paid when you&apos;ve recorded payment in Airtable.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-500">
            <span className="sr-only">Month</span>
            <select
              value={selectedYm}
              onChange={(e) => setSelectedYm(e.target.value)}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-800 shadow-sm transition focus:border-[#2563eb] focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20"
            >
              {monthOptions.map((ym) => (
                <option key={ym} value={ym}>
                  {formatYmLong(ym)}
                </option>
              ))}
            </select>
          </label>
          {[
            ['all', 'All'],
            ['unpaid', 'Unpaid'],
            ['overdue', 'Overdue'],
            ['paid', 'Paid'],
          ].map(([k, lab]) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              className={`rounded-full px-4 py-2 text-xs font-semibold transition ${filter === k ? 'bg-[#2563eb] text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              {lab}
            </button>
          ))}
          <button
            type="button"
            onClick={() => load()}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            Refresh
          </button>
        </div>
      </div>

      {paymentsLoadError ? (
        <div
          role="alert"
          className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-950"
        >
          <div className="font-semibold text-amber-900">Payments could not load</div>
          <p className="mt-2 text-amber-900/90">{paymentsLoadError}</p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-amber-900/85">
            <li>
              In{' '}
              <a
                href="https://airtable.com/create/tokens"
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-[#2563eb] underline underline-offset-2"
              >
                Airtable → Developer hub → Personal access tokens
              </a>
              , open your token and add the base that contains the <strong>Payments</strong> table.
            </li>
            <li>
              Enable scopes <strong className="font-mono text-xs">data.records:read</strong> and{' '}
              <strong className="font-mono text-xs">data.records:write</strong> for that base.
            </li>
            <li>
              Payments are read from your Airtable base <code className="rounded bg-white/80 px-1.5 py-0.5 text-xs">{AIRTABLE_PAYMENTS_BASE_ID}</code>
              <span> (<code className="text-xs">VITE_AIRTABLE_BASE_ID</code>)</span>
              .
            </li>
          </ul>
        </div>
      ) : null}

      <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-blue-50/40 px-4 py-4 sm:px-5">
        <div className="text-center text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
          {formatYmLong(selectedYm)}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-red-200/80 bg-white/90 p-4 shadow-sm">
            <div className="text-[11px] font-bold uppercase tracking-wide text-red-700/90">Overdue rent</div>
            <div className="mt-1 text-2xl font-black text-red-950">{monthOverdueCount}</div>
            <div className="mt-0.5 text-xs text-red-800/70">Past due, not paid</div>
          </div>
          <div className="rounded-2xl border border-emerald-200/80 bg-white/90 p-4 shadow-sm">
            <div className="text-[11px] font-bold uppercase tracking-wide text-emerald-800">Paid rent</div>
            <div className="mt-1 text-2xl font-black text-emerald-950">{monthPaidCount}</div>
            <div className="mt-0.5 text-xs text-emerald-900/70">Marked paid this month</div>
          </div>
          <div className="rounded-2xl border border-amber-200/80 bg-white/90 p-4 shadow-sm">
            <div className="text-[11px] font-bold uppercase tracking-wide text-amber-800">Pending rent</div>
            <div className="mt-1 text-2xl font-black text-amber-950">{monthPendingCount}</div>
            <div className="mt-0.5 text-xs text-amber-900/70">Not yet due or awaiting payment</div>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white">
        {loading ? (
          <div className="px-6 py-14 text-center text-sm text-slate-500">Loading payments…</div>
        ) : rows.length === 0 ? (
          <div className="px-6 py-14 text-center text-sm text-slate-500">No rent charges to show.</div>
        ) : rowsForSelectedMonth.length === 0 ? (
          <div className="px-6 py-14 text-center text-sm text-slate-500">
            No rent charges for {formatYmLong(selectedYm)}. Try another month above.
          </div>
        ) : filteredForList.length === 0 ? (
          <div className="px-6 py-14 text-center text-sm text-slate-500">No rows match this filter for {formatYmLong(selectedYm)}.</div>
        ) : (
          <div>
            {groupedByHouse.map(({ house, items }) => (
              <div key={house} className="border-b border-slate-200 last:border-b-0">
                <div className="sticky top-0 z-[1] border-b border-slate-100 bg-slate-50 px-4 py-2.5 sm:px-6">
                  <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">House</div>
                  <div className="text-sm font-black text-slate-900">{house}</div>
                </div>
                <ul className="divide-y divide-slate-100">
                  {items.map((p) => {
                    const { phrase, tone } = rentStatusPresentation(p)
                    const stLower = String(p.Status || '').trim().toLowerCase()
                    const borderL =
                      tone === 'emerald' ? 'border-l-emerald-500' : tone === 'red' ? 'border-l-red-500' : 'border-l-amber-500'
                    const rowBg =
                      tone === 'emerald'
                        ? 'bg-emerald-50/25'
                        : tone === 'red'
                          ? 'bg-red-50/30'
                          : 'bg-amber-50/20'
                    const resident = p['Resident Name'] || p['Resident']
                    return (
                      <li key={p.id} className={classNames('flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6', rowBg)}>
                        <div className={classNames('min-w-0 flex-1 border-l-4 pl-3 sm:pl-4', borderL)}>
                          <div className="text-base font-black text-slate-900">{formatPaymentRoomTitle(p)}</div>
                          {stLower !== 'paid' ? (
                            <p className="mt-1 text-sm font-semibold leading-snug text-slate-800">{phrase}</p>
                          ) : null}
                          <p className="mt-1 text-xs text-slate-500">
                            {resident ? <span>{resident} · </span> : null}
                            {p.Amount != null ? <span className="font-semibold text-slate-700">${Number(p.Amount).toFixed(0)}</span> : <span>—</span>}
                            <span> · Due {fmtDate(p['Due Date'])}</span>
                            {p.Month ? <span> · {p.Month}</span> : null}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:items-end">
                          {stLower === 'paid' ? (
                            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-center sm:text-right">
                              <div className="text-xs font-bold uppercase tracking-wide text-emerald-800">System</div>
                              <div className="text-sm font-semibold text-emerald-900">Rent paid</div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              disabled={busy[p.id]}
                              onClick={() => markPaid(p.id)}
                              className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-50"
                            >
                              {busy[p.id] ? 'Updating…' : 'Mark paid'}
                            </button>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

const APPLICATION_SORT_OPTIONS = [
  { id: 'submitted', label: 'Submitted' },
  { id: 'property', label: 'House' },
  { id: 'room', label: 'Room' },
  { id: 'name', label: 'Applicant' },
  { id: 'status', label: 'Status' },
]

function applicationStatusSortRank(app) {
  if (app.Approved !== true && app.Approved !== false) return 0
  if (app.Approved === true) return 1
  return 2
}

function compareApplicationRoomNumbers(a, b) {
  const sa = String(a ?? '').trim()
  const sb = String(b ?? '').trim()
  const na = Number.parseInt(sa, 10)
  const nb = Number.parseInt(sb, 10)
  if (Number.isFinite(na) && Number.isFinite(nb) && String(na) === sa && String(nb) === sb) return na - nb
  return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: 'base' })
}

function sortApplicationsList(rows, sortKey, sortDir) {
  const mul = sortDir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    let cmp = 0
    switch (sortKey) {
      case 'submitted':
        cmp = new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()
        break
      case 'property':
        cmp = String(a['Property Name'] || '').localeCompare(String(b['Property Name'] || ''), undefined, {
          sensitivity: 'base',
        })
        break
      case 'room':
        cmp = compareApplicationRoomNumbers(a['Room Number'], b['Room Number'])
        break
      case 'name':
        cmp = String(a['Signer Full Name'] || '').localeCompare(String(b['Signer Full Name'] || ''), undefined, {
          sensitivity: 'base',
        })
        break
      case 'status':
        cmp = applicationStatusSortRank(a) - applicationStatusSortRank(b)
        break
      default:
        cmp = 0
    }
    if (cmp !== 0) return cmp * mul
    return (
      String(a['Signer Full Name'] || '').localeCompare(String(b['Signer Full Name'] || ''), undefined, {
        sensitivity: 'base',
      }) * mul
    )
  })
}

// ─── ApplicationsPanel ────────────────────────────────────────────────────────
function ApplicationsPanel({ allowedPropertyNames, manager }) {
  const [scopedRows, setScopedRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [propertyFilter, setPropertyFilter] = useState('')
  const [sortKey, setSortKey] = useState('submitted')
  const [sortDir, setSortDir] = useState('desc')
  const [approving, setApproving] = useState({}) // recordId -> 'approving' | 'rejecting'

  const [loadError, setLoadError] = useState('')

  const scopeSet = useMemo(() => new Set((allowedPropertyNames || []).map((n) => String(n).trim().toLowerCase()).filter(Boolean)), [allowedPropertyNames])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const rows = await fetchApplications({})
      const scoped = scopeSet.size ? rows.filter((a) => applicationInScope(a, scopeSet)) : []
      setScopedRows(scoped)
    } catch (err) {
      setLoadError(formatDataLoadError(err))
    } finally {
      setLoading(false)
    }
  }, [scopeSet])

  useEffect(() => { load() }, [load])

  const filteredRows = useMemo(() => {
    if (!propertyFilter.trim()) return scopedRows
    return scopedRows.filter((a) => String(a['Property Name'] || '').trim() === propertyFilter.trim())
  }, [scopedRows, propertyFilter])

  const applications = useMemo(
    () => sortApplicationsList(filteredRows, sortKey, sortDir),
    [filteredRows, sortKey, sortDir],
  )

  const showSortDeck = filteredRows.length >= 5

  function selectSortOption(id) {
    if (sortKey === id) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(id)
    if (id === 'submitted') setSortDir('desc')
    else setSortDir('asc')
  }

  async function handleDecision(recordId, approved) {
    setApproving(a => ({ ...a, [recordId]: approved ? 'approving' : 'rejecting' }))
    try {
      if (approved) {
        const res = await fetch('/api/portal?action=manager-approve-application', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            applicationRecordId: recordId,
            managerName: manager?.name || manager?.email || 'Axis Manager',
            managerRole: manager?.role || 'Manager',
          }),
        })
        const data = await readJsonResponse(res)
        if (!res.ok) throw new Error(data.error || 'Could not approve application')
        setScopedRows(prev => prev.map((a) => (
          a.id === recordId ? { ...a, Approved: true, 'Approved At': data.application?.['Approved At'] || a['Approved At'] } : a
        )))
        toast.success(data.message || 'Application approved and lease draft generated.')
      } else {
        const updated = await patchApplication(recordId, { Approved: approved })
        setScopedRows(prev => prev.map(a => a.id === recordId ? { ...a, Approved: updated.Approved } : a))
        toast.success('Application rejected.')
      }
    } catch (err) {
      toast.error('Could not update application: ' + err.message)
    } finally {
      setApproving(a => { const n = { ...a }; delete n[recordId]; return n })
    }
  }

  const statusLabel = (app) => {
    if (app.Approved === true) return { label: 'Approved', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' }
    if (app.Approved === false) return { label: 'Rejected', cls: 'border-red-200 bg-red-50 text-red-700' }
    return { label: 'Pending review', cls: 'border-amber-200 bg-amber-50 text-amber-700' }
  }

  const filterOptions = allowedPropertyNames || []

  return (
    <div className="mb-10">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h2 className="mr-auto text-xl font-black text-slate-900">Applications</h2>
        <select
          value={propertyFilter}
          onChange={e => setPropertyFilter(e.target.value)}
          className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm transition focus:border-[#2563eb] focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20"
        >
          <option value="">All your properties</option>
          {filterOptions.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <button
          onClick={load}
          className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
        >
          Refresh
        </button>
      </div>

      {loadError ? (
        <div
          role="alert"
          className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-950"
        >
          <div className="font-semibold text-red-900">Could not load applications</div>
          <p className="mt-1 text-red-900/90">{loadError}</p>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white">
        {loading ? (
          <div className="px-6 py-16 text-center text-sm text-slate-500">Loading applications…</div>
        ) : loadError ? (
          <div className="px-6 py-16 text-center">
            <div className="mb-3 text-4xl" aria-hidden>⚠️</div>
            <div className="text-sm font-semibold text-slate-700">Could not load the list</div>
            <p className="mt-1 text-sm text-slate-500">Check the message above and try Refresh.</p>
          </div>
        ) : scopedRows.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <div className="mb-3 text-4xl" aria-hidden>📋</div>
            <div className="text-sm font-semibold text-slate-700">No applications yet</div>
            <p className="mt-1 text-sm text-slate-500">Applications submitted via the Apply page will appear here.</p>
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <div className="mb-3 text-4xl" aria-hidden>🏠</div>
            <div className="text-sm font-semibold text-slate-700">No applications for this property</div>
            <p className="mt-1 text-sm text-slate-500">Choose &quot;All your properties&quot; or another house to see more.</p>
          </div>
        ) : (
          <>
            <div
              className={classNames(
                'border-b border-slate-100 px-4 py-3 sm:px-6',
                showSortDeck
                  ? 'bg-gradient-to-r from-slate-50 via-white to-blue-50/50'
                  : 'bg-slate-50/60',
              )}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                  <span
                    className={classNames(
                      'shrink-0 font-bold uppercase tracking-[0.14em] text-slate-400',
                      showSortDeck ? 'text-[11px]' : 'text-[10px]',
                    )}
                  >
                    Sort
                  </span>
                  <div
                    className="flex flex-wrap gap-1.5"
                    role="toolbar"
                    aria-label="Sort applications"
                  >
                    {APPLICATION_SORT_OPTIONS.map((opt) => {
                      const active = sortKey === opt.id
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => selectSortOption(opt.id)}
                          className={classNames(
                            'inline-flex items-center gap-1 rounded-full border font-semibold transition',
                            showSortDeck ? 'px-3.5 py-2 text-xs' : 'px-2.5 py-1.5 text-[11px]',
                            active
                              ? 'border-[#2563eb] bg-[#2563eb] text-white shadow-[0_2px_10px_rgba(37,99,235,0.22)]'
                              : 'border-slate-200/90 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50',
                          )}
                          aria-pressed={active}
                          title={active ? `Click to reverse order (${sortDir === 'asc' ? 'ascending' : 'descending'})` : `Sort by ${opt.label}`}
                        >
                          <span>{opt.label}</span>
                          {active ? (
                            <span className="tabular-nums opacity-90" aria-hidden>
                              {sortDir === 'asc' ? '↑' : '↓'}
                            </span>
                          ) : null}
                        </button>
                      )
                    })}
                  </div>
                </div>
                {showSortDeck ? (
                  <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="rounded-full bg-white/90 px-3 py-1.5 font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200/80">
                      {filteredRows.length} application{filteredRows.length !== 1 ? 's' : ''}
                    </span>
                    <span className="hidden text-slate-400 sm:inline">Click again to flip ↑↓</span>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="divide-y divide-slate-100">
              {applications.map((app) => {
                const { label, cls } = statusLabel(app)
                const busy = approving[app.id]
                return (
                  <div key={app.id} className="flex flex-col gap-3 px-6 py-5 sm:flex-row sm:items-center sm:gap-5">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-900 truncate">{app['Signer Full Name'] || '—'}</span>
                        <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${cls}`}>{label}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-slate-500">
                        <span>{app['Signer Email'] || '—'}</span>
                        {app['Property Name'] && <span>{app['Property Name']}</span>}
                        {app['Room Number'] && <span>Room {app['Room Number']}</span>}
                        {app['Lease Term'] && <span>{app['Lease Term']}</span>}
                      </div>
                      {app['Application ID'] && (
                        <div className="mt-1 font-mono text-xs text-slate-400">APP-{String(app['Application ID'])}</div>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        onClick={() => handleDecision(app.id, true)}
                        disabled={!!busy || app.Approved === true}
                        className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-40"
                      >
                        {busy === 'approving' ? 'Approving…' : 'Approve'}
                      </button>
                      <button
                        onClick={() => handleDecision(app.id, false)}
                        disabled={!!busy || app.Approved === false}
                        className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-40"
                      >
                        {busy === 'rejecting' ? 'Rejecting…' : 'Reject'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── ManagerDashboard ─────────────────────────────────────────────────────────
const MANAGER_DASH_TABS = [
  ['dashboard', 'Dashboard'],
  ['leases', 'Leases'],
  ['applications', 'Applications'],
  ['properties', 'Properties'],
  ['payments', 'Payments'],
  ['workorders', 'Work orders'],
  ['inbox', 'Inbox'],
  ['calendar', 'Calendar'],
  ['profile', 'Profile'],
]

const MANAGER_NAV_ITEMS = MANAGER_DASH_TABS.map(([id, label]) => ({ id, label }))

function ManagerDashboard({ manager: managerProp, onOpenDraft, onSignOut, onManagerUpdate }) {
  const [manager, setManager] = useState(managerProp)
  const [dashView, setDashView] = useState('dashboard')
  const [drafts, setDrafts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showGenerateModal, setShowGenerateModal] = useState(false)
  const [filters, setFilters] = useState({ status: '', property: '', resident: '' })
  const [propertyRecords, setPropertyRecords] = useState([])
  const [billingLoading, setBillingLoading] = useState(false)
  const [overviewStats, setOverviewStats] = useState(null)
  const [overviewStatsLoading, setOverviewStatsLoading] = useState(false)
  const [overviewDataWarnings, setOverviewDataWarnings] = useState([])
  const [leasesLoadError, setLeasesLoadError] = useState('')

  const managerScope = useMemo(() => computeManagerScope(propertyRecords, manager), [propertyRecords, manager])
  const scopedPropertyOptions = useMemo(
    () => Array.from(managerScope.approvedNames).sort(),
    [managerScope.approvedNames],
  )
  const approvedNamesLower = useMemo(
    () => new Set([...managerScope.approvedNames].map((n) => String(n).trim().toLowerCase()).filter(Boolean)),
    [managerScope.approvedNames],
  )

  function handleManagerUpdate(updated) {
    setManager(updated)
    onManagerUpdate?.(updated)
  }

  // Debounce the resident name search so we don't hammer the records API on every keystroke
  const [residentInput, setResidentInput] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setFilters(f => ({ ...f, resident: residentInput })), 400)
    return () => clearTimeout(t)
  }, [residentInput])

  const loadDrafts = useCallback(async () => {
    setLoading(true)
    setLeasesLoadError('')
    try {
      const rows = await fetchLeaseDrafts(filters)
      const names = managerScope.approvedNames
      const scoped =
        names.size > 0 ? rows.filter((d) => leaseDraftInScope(d, names)) : []
      setDrafts(scoped)
    } catch (err) {
      setLeasesLoadError(formatDataLoadError(err))
    } finally {
      setLoading(false)
    }
  }, [filters, managerScope.approvedNames])

  useEffect(() => {
    if (dashView !== 'leases') return
    loadDrafts()
  }, [loadDrafts, dashView])

  useEffect(() => {
    if (dashView !== 'dashboard') return
    let cancelled = false
    setOverviewStatsLoading(true)
    setOverviewDataWarnings([])
    const names = managerScope.approvedNames

    Promise.allSettled([
      fetchApplications({}),
      fetchLeaseDrafts({}),
      getAllWorkOrders(),
      getAllPaymentsRecords(),
    ])
      .then((results) => {
        if (cancelled) return
        const warnings = []
        const appsRaw = results[0].status === 'fulfilled' ? results[0].value : null
        const drRaw = results[1].status === 'fulfilled' ? results[1].value : null
        const woRaw = results[2].status === 'fulfilled' ? results[2].value : null
        const payRaw = results[3].status === 'fulfilled' ? results[3].value : null
        if (results[0].status === 'rejected') warnings.push(`Applications: ${formatDataLoadError(results[0].reason)}`)
        if (results[1].status === 'rejected') warnings.push(`Lease drafts: ${formatDataLoadError(results[1].reason)}`)
        if (results[2].status === 'rejected') warnings.push(`Work orders: ${formatDataLoadError(results[2].reason)}`)
        if (results[3].status === 'rejected') warnings.push(`Payments: ${formatDataLoadError(results[3].reason)}`)
        setOverviewDataWarnings(warnings)

        if (!appsRaw && !drRaw && !woRaw && !payRaw) {
          setOverviewStats(null)
          return
        }

        const apps = approvedNamesLower.size
          ? (appsRaw || []).filter((a) => applicationInScope(a, approvedNamesLower))
          : []
        const dr = names.size ? (drRaw || []).filter((d) => leaseDraftInScope(d, names)) : []
        const wo = approvedNamesLower.size
          ? (woRaw || []).filter((w) => workOrderInScope(w, approvedNamesLower))
          : []
        const rentRows =
          approvedNamesLower.size && payRaw
            ? payRaw.filter((p) => paymentInScope(p, approvedNamesLower) && isRentPaymentRecord(p))
            : []

        const pendingApps = apps.filter((a) => a.Approved !== true && a.Approved !== false).length
        const leasePending = dr.filter((d) => LEASE_STATUSES_NEEDING_ACTION.has(String(d.Status || '').trim())).length
        const rentOverdue = rentRows.filter((p) => isPaymentOverdueRecord(p)).length
        const openWo = wo.filter((w) => w.Resolved !== true && w.Resolved !== 1 && w.Status !== 'Resolved').length

        setOverviewStats({
          pendingApps,
          leasePending,
          rentOverdue,
          openWo,
        })
      })
      .finally(() => {
        if (!cancelled) setOverviewStatsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [dashView, managerScope.approvedNames, approvedNamesLower])

  const handlePropertiesChange = useCallback((records) => {
    const nextRecords = Array.isArray(records) ? records : []
    setPropertyRecords(nextRecords)
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchPropertiesAdmin()
      .then((records) => {
        if (!cancelled) handlePropertiesChange(records)
      })
      .catch(() => {
        if (!cancelled) handlePropertiesChange([])
      })
    return () => { cancelled = true }
  }, [handlePropertiesChange])

  // Per-status counts shown in the stat cards above the table
  const statusCounts = useMemo(() => {
    const c = {}
    ALL_STATUSES.forEach(s => { c[s] = 0 })
    drafts.forEach(d => { if (c[d.Status] !== undefined) c[d.Status]++ })
    return c
  }, [drafts])

  function handleGenerated(newDraft) {
    setDrafts(prev => [{ id: newDraft.id, ...newDraft }, ...prev])
  }

  const canReview = status => ['Draft Generated', 'Under Review', 'Changes Needed'].includes(status)

  async function handleBillingPortal() {
    if (manager.__axisDeveloper) {
      toast.error('Billing is not available in developer preview.')
      return
    }
    setBillingLoading(true)
    try {
      const res = await fetch('/api/portal?action=manager-billing-portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: manager.email }),
      })
      const data = await readJsonResponse(res)
      if (!res.ok) throw new Error(data.error || 'Could not open billing portal.')
      window.location.href = data.url
    } catch (err) {
      toast.error(err.message || 'Could not open billing portal.')
      setBillingLoading(false)
    }
  }

  const managerUserMeta = [manager.role, manager.managerId].filter(Boolean).join(' · ') || undefined

  return (
    <>
      <PortalShell
        brandTitle="Axis"
        brandSubtitle="Manager portal"
        desktopNav="sidebar"
        sidebarPosition="right"
        navItems={MANAGER_NAV_ITEMS}
        activeId={dashView}
        onNavigate={setDashView}
        userLabel={manager.name}
        userMeta={managerUserMeta}
        onSignOut={onSignOut}
        sidebarFooterExtra={
          <button
            type="button"
            onClick={handleBillingPortal}
            disabled={billingLoading}
            className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {billingLoading ? 'Opening…' : 'Billing'}
          </button>
        }
      >
        <div className="mx-auto w-full max-w-[1600px]">
        {dashView === 'profile' ? (
          <ManagerProfilePanel
            manager={manager}
            onManagerUpdate={handleManagerUpdate}
            approvedPropertyCount={managerScope.approvedNames.size}
          />
        ) : dashView === 'applications' ? (
          <ApplicationsPanel allowedPropertyNames={scopedPropertyOptions} manager={manager} />
        ) : dashView === 'properties' ? (
          <div id="house-management" className="scroll-mt-24">
            <HouseManagementPanel manager={manager} onPropertiesChange={handlePropertiesChange} />
          </div>
        ) : dashView === 'payments' ? (
          <ManagerPaymentsPanel allowedPropertyNames={scopedPropertyOptions} />
        ) : dashView === 'workorders' ? (
          <WorkOrdersTabPanel manager={manager} allowedPropertyNames={scopedPropertyOptions} />
        ) : dashView === 'inbox' ? (
          <InboxTabPanel manager={manager} allowedPropertyNames={scopedPropertyOptions} />
        ) : dashView === 'calendar' ? (
          <ManagerCalendarPanel manager={manager} scopedPropertyNames={scopedPropertyOptions} />
        ) : dashView === 'dashboard' ? (
          <ManagerDashboardHomePanel
            manager={manager}
            approvedHouseCount={managerScope.approvedNames.size}
            stats={overviewStats}
            statsLoading={overviewStatsLoading}
            dataWarnings={overviewDataWarnings}
            onNavigate={setDashView}
            onGenerateDraft={() => setShowGenerateModal(true)}
            onOpenBilling={handleBillingPortal}
          />
        ) : (
        <>
        {leasesLoadError ? (
          <div
            role="alert"
            className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-950"
          >
            <div className="font-semibold text-red-900">Could not load lease drafts</div>
            <p className="mt-1 text-red-900/90">{leasesLoadError}</p>
          </div>
        ) : null}
        {/* Status stat cards — clicking one filters the table */}
        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {ALL_STATUSES.map(status => {
            const cfg = STATUS_CONFIG[status]
            const active = filters.status === status
            return (
              <button
                key={status}
                onClick={() => setFilters(f => ({ ...f, status: f.status === status ? '' : status }))}
                className={`rounded-2xl border p-4 text-left transition ${active ? `${cfg.bg} ${cfg.border}` : 'border-slate-200 bg-white hover:border-slate-300'}`}
              >
                <div className={`text-2xl font-black ${active ? cfg.text : 'text-slate-900'}`}>
                  {statusCounts[status]}
                </div>
                <div className="mt-0.5 text-[11px] font-semibold leading-tight text-slate-500">{status}</div>
              </button>
            )
          })}
        </div>

        {/* Toolbar */}
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <h2 className="mr-auto text-xl font-black text-slate-900">Leases &amp; signing</h2>

          {/* Resident search */}
          <div className="relative">
            <svg className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search resident…"
              value={residentInput}
              onChange={e => setResidentInput(e.target.value)}
              className="rounded-2xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm transition focus:border-[#2563eb] focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20"
            />
          </div>

          {/* Status filter */}
          <select
            value={filters.status}
            onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm transition focus:border-[#2563eb] focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20"
          >
            <option value="">All statuses</option>
            {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          {/* Property filter */}
          <select
            value={filters.property}
            onChange={e => setFilters(f => ({ ...f, property: e.target.value }))}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm transition focus:border-[#2563eb] focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20"
          >
            <option value="">All your properties</option>
            {scopedPropertyOptions.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>

          {/* Generate new draft */}
          <button
            onClick={() => setShowGenerateModal(true)}
            className="inline-flex items-center gap-2 rounded-2xl bg-[#2563eb] px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Generate draft
          </button>
        </div>

        {/* Drafts table */}
        <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white">
          {loading ? (
            <div className="px-6 py-16 text-center text-sm text-slate-500">Loading lease queue…</div>
          ) : drafts.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <div className="mb-3 text-4xl">📄</div>
              <div className="text-sm font-semibold text-slate-700">No drafts found</div>
              <p className="mt-1 text-sm text-slate-500">
                {Object.values(filters).some(Boolean)
                  ? 'Try clearing your filters.'
                  : 'Click "Generate draft" to create the first AI lease draft.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Resident</th>
                    <th className="hidden px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400 sm:table-cell">Property</th>
                    <th className="hidden px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400 md:table-cell">Dates</th>
                    <th className="px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Status</th>
                    <th className="hidden px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400 lg:table-cell">Updated</th>
                    <th className="px-5 py-3.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {drafts.map(draft => (
                    <tr key={draft.id} className="transition-colors hover:bg-slate-50">
                      <td className="px-5 py-4">
                        <div className="font-semibold text-slate-900">{draft['Resident Name'] || '—'}</div>
                        <div className="text-xs text-slate-500">{draft['Resident Email'] || ''}</div>
                      </td>
                      <td className="hidden px-5 py-4 sm:table-cell">
                        <div className="text-sm font-medium text-slate-900">{draft['Property'] || '—'}</div>
                        {draft['Unit'] && <div className="text-xs text-slate-500">{draft['Unit']}</div>}
                      </td>
                      <td className="hidden px-5 py-4 text-sm text-slate-600 md:table-cell">
                        <div>{fmtDate(draft['Lease Start Date'])}</div>
                        {draft['Lease End Date'] && (
                          <div className="text-slate-400">→ {fmtDate(draft['Lease End Date'])}</div>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        <StatusBadge status={draft['Status']} />
                      </td>
                      <td className="hidden px-5 py-4 text-sm text-slate-500 lg:table-cell">
                        {fmtDate(draft['Updated At'] || draft.created_at)}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <button
                          onClick={() => onOpenDraft(draft.id)}
                          className="rounded-xl border border-slate-200 px-4 py-1.5 text-sm font-semibold text-slate-700 transition hover:border-[#2563eb] hover:text-[#2563eb]"
                        >
                          {canReview(draft['Status']) ? 'Review →' : 'View →'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Attribution footer */}
        <p className="mt-6 text-center text-xs text-slate-400">
          Axis Manager Portal · Leases, applications, properties, payments, work orders, inbox · {new Date().getFullYear()}
        </p>
      </>
      )}
        </div>
      </PortalShell>

      {showGenerateModal && (
        <GenerateDraftModal
          manager={manager}
          propertyOptions={scopedPropertyOptions}
          onClose={() => setShowGenerateModal(false)}
          onGenerated={handleGenerated}
        />
      )}
    </>
  )
}

// ─── Sidebar detail row helper ────────────────────────────────────────────────
function DetailRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-2 text-sm">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className="text-right font-semibold text-slate-900 break-all">{value || '—'}</span>
    </div>
  )
}

// ─── LeaseEditor ──────────────────────────────────────────────────────────────
// Full-screen editor for reviewing, editing, and approving a single lease draft.
// Three tabs: Edit/View | Original AI Draft | Audit Log
function LeaseEditor({ draftId, manager, onBack }) {
  const [draft, setDraft] = useState(null)
  const [auditLog, setAuditLog] = useState([])
  const [editorContent, setEditorContent] = useState('')
  const [managerNotes, setManagerNotes] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [actionLoading, setActionLoading] = useState('') // 'reject' | 'approve' | 'publish' | 'signforge' | 'signforge-status'
  const [activeTab, setActiveTab] = useState('editor')

  const refreshAudit = useCallback(async () => {
    try { setAuditLog(await fetchAuditLog(draftId)) } catch { /* non-fatal */ }
  }, [draftId])

  const loadDraft = useCallback(async () => {
    setLoading(true)
    try {
      const [d, log] = await Promise.all([fetchLeaseDraft(draftId), fetchAuditLog(draftId)])
      setDraft(d)
      setAuditLog(log)
      // Use manager's edited version if one exists, otherwise fall back to the AI draft
      setEditorContent(d['Manager Edited Content'] || d['AI Draft Content'] || '')
      setManagerNotes(d['Manager Notes'] || '')

      // Auto-transition from "Draft Generated" to "Under Review" when first opened
      if (d['Status'] === 'Draft Generated') {
        const updated = await patchLeaseDraft(draftId, {
          'Status': 'Under Review',
          'Updated At': new Date().toISOString(),
        })
        setDraft(updated)
        await logAudit({
          leaseDraftId: draftId,
          actionType: 'Opened for Review',
          performedBy: manager.name,
          performedByRole: manager.role,
          notes: `Opened for review by ${manager.name}`,
        })
        await refreshAudit()
      }
    } catch (err) {
      toast.error('Could not load draft: ' + err.message)
    } finally {
      setLoading(false)
    }
  }, [draftId, manager, refreshAudit])

  useEffect(() => { loadDraft() }, [loadDraft])

  // ── Save edits ────────────────────────────────────────────────────────────
  async function handleSave() {
    setSaving(true)
    try {
      const updated = await patchLeaseDraft(draftId, {
        'Manager Edited Content': editorContent,
        'Manager Notes': managerNotes,
        'Updated At': new Date().toISOString(),
      })
      setDraft(updated)
      await logAudit({
        leaseDraftId: draftId,
        actionType: 'Edited',
        performedBy: manager.name,
        performedByRole: manager.role,
        notes: 'Manager saved edits to lease content',
      })
      await refreshAudit()
      toast.success('Edits saved')
    } catch (err) {
      toast.error('Save failed: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Mark as "Changes Needed" ──────────────────────────────────────────────
  async function handleReject() {
    setActionLoading('reject')
    try {
      const updated = await patchLeaseDraft(draftId, {
        'Status': 'Changes Needed',
        'Manager Notes': managerNotes,
        'Updated At': new Date().toISOString(),
      })
      setDraft(updated)
      await logAudit({
        leaseDraftId: draftId,
        actionType: 'Rejected',
        performedBy: manager.name,
        performedByRole: manager.role,
        notes: managerNotes ? `Marked "Changes Needed": ${managerNotes}` : 'Marked "Changes Needed"',
      })
      await refreshAudit()
      toast.success('Marked as "Changes Needed"')
    } catch (err) {
      toast.error('Action failed: ' + err.message)
    } finally {
      setActionLoading('')
    }
  }

  // ── Approve ───────────────────────────────────────────────────────────────
  async function handleApprove() {
    setActionLoading('approve')
    try {
      const now = new Date().toISOString()
      const updated = await patchLeaseDraft(draftId, {
        'Manager Edited Content': editorContent,
        'Manager Notes': managerNotes,
        'Status': 'Approved',
        'Approved By': manager.name,
        'Approved At': now,
        'Updated At': now,
      })
      setDraft(updated)
      await logAudit({
        leaseDraftId: draftId,
        actionType: 'Approved',
        performedBy: manager.name,
        performedByRole: manager.role,
        notes: `Approved by ${manager.name}`,
      })
      await refreshAudit()
      toast.success('Lease approved — ready to publish')
    } catch (err) {
      toast.error('Approval failed: ' + err.message)
    } finally {
      setActionLoading('')
    }
  }

  // ── Publish to resident portal ────────────────────────────────────────────
  // This is the step that makes the lease visible in the resident portal.
  // The resident will see Manager Edited Content (or AI Draft Content as fallback).
  async function handlePublish() {
    setActionLoading('publish')
    try {
      const now = new Date().toISOString()
      const updated = await patchLeaseDraft(draftId, {
        'Status': 'Published',
        'Published At': now,
        'Updated At': now,
      })
      setDraft(updated)
      await logAudit({
        leaseDraftId: draftId,
        actionType: 'Published',
        performedBy: manager.name,
        performedByRole: manager.role,
        notes: `Published to resident portal by ${manager.name}`,
      })
      await refreshAudit()
      toast.success('Lease published to resident portal!')
    } catch (err) {
      toast.error('Publish failed: ' + err.message)
    } finally {
      setActionLoading('')
    }
  }

  async function handleSignforgeSend() {
    setActionLoading('signforge')
    try {
      const res = await fetch('/api/portal?action=signforge-send-lease', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leaseDraftId: draftId,
          performedBy: manager.name,
          performedByRole: manager.role,
        }),
      })
      const data = await readJsonResponse(res)
      if (!res.ok) throw new Error(data.error || 'SignForge send failed')
      if (data.draft) setDraft(data.draft)
      await refreshAudit()
      toast.success('Lease sent via SignForge — the resident receives a signing link by email.')
    } catch (err) {
      toast.error(err.message || 'SignForge send failed')
    } finally {
      setActionLoading('')
    }
  }

  async function handleSignforgeRefreshStatus() {
    const envId = draft?.['SignForge Envelope ID']
    if (!envId) return
    setActionLoading('signforge-status')
    try {
      const res = await fetch('/api/portal?action=signforge-envelope-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ envelopeId: String(envId).trim() }),
      })
      const data = await readJsonResponse(res)
      if (!res.ok) throw new Error(data.error || 'Could not load SignForge status')
      const env = data.envelope?.data ?? data.envelope ?? data
      const st = env?.status ?? env?.state ?? 'unknown'
      toast.success(`SignForge status: ${st}`)
      const refreshed = await fetchLeaseDraft(draftId)
      setDraft(refreshed)
      setEditorContent(refreshed['Manager Edited Content'] || refreshed['AI Draft Content'] || '')
      await refreshAudit()
    } catch (err) {
      toast.error(err.message || 'SignForge status check failed')
    } finally {
      setActionLoading('')
    }
  }

  // Derive which actions are available for the current status
  const status = draft?.['Status']
  const canEdit    = draft && !['Published', 'Signed'].includes(status)
  const canApprove = draft && ['Under Review', 'Changes Needed'].includes(status)
  const canPublish = draft && status === 'Approved'
  const canReject  = draft && ['Under Review', 'Draft Generated', 'Changes Needed'].includes(status)
  const signforgeEnvelopeId = draft?.['SignForge Envelope ID']
  const canSignforgeSend =
    draft &&
    status === 'Published' &&
    !signforgeEnvelopeId &&
    String(draft['Resident Email'] || '').trim()
  const canSignforgeRefresh =
    draft && signforgeEnvelopeId && status !== 'Signed'

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="text-sm text-slate-500">Loading draft…</div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      {/* Editor header */}
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          {/* Back button */}
          <button
            onClick={onBack}
            className="flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            <span className="hidden sm:inline">Queue</span>
          </button>

          {/* Title */}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-base font-black text-slate-900">
                {draft?.['Resident Name'] || '—'}
                {draft?.['Property'] ? ` — ${draft['Property']}` : ''}
                {draft?.['Unit'] ? `, ${draft['Unit']}` : ''}
              </h1>
              {status && <StatusBadge status={status} size="lg" />}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex shrink-0 items-center gap-2">
            {canEdit && (
              <button
                onClick={handleSave}
                disabled={saving || !!actionLoading}
                className="hidden rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 sm:block"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            )}
            {canReject && (
              <button
                onClick={handleReject}
                disabled={!!actionLoading}
                className="hidden rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-50 sm:block"
              >
                {actionLoading === 'reject' ? 'Updating…' : 'Changes needed'}
              </button>
            )}
            {canApprove && (
              <button
                onClick={handleApprove}
                disabled={!!actionLoading}
                className="rounded-xl bg-green-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-700 disabled:opacity-50"
              >
                {actionLoading === 'approve' ? 'Approving…' : 'Approve'}
              </button>
            )}
            {canPublish && (
              <button
                onClick={handlePublish}
                disabled={!!actionLoading}
                className="rounded-xl bg-[#2563eb] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
              >
                {actionLoading === 'publish' ? 'Publishing…' : 'Publish to portal'}
              </button>
            )}
            {canSignforgeSend && (
              <button
                type="button"
                onClick={handleSignforgeSend}
                disabled={!!actionLoading}
                className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-800 transition hover:bg-violet-100 disabled:opacity-50"
              >
                {actionLoading === 'signforge' ? 'Sending…' : 'Send for e-sign (SignForge)'}
              </button>
            )}
            {canSignforgeRefresh && (
              <button
                type="button"
                onClick={handleSignforgeRefreshStatus}
                disabled={!!actionLoading}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                {actionLoading === 'signforge-status' ? 'Checking…' : 'Refresh SignForge status'}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-5 px-4 py-5 sm:px-6">
        {/* Main panel — editor + tabs */}
        <div className="min-w-0 flex-1">
          {/* Tabs */}
          <div className="mb-4 flex gap-1 rounded-2xl border border-slate-200 bg-white p-1.5 w-fit">
            {[
              { key: 'editor',   label: canEdit ? 'Edit Lease' : 'View Lease' },
              { key: 'original', label: 'Original AI Draft' },
              { key: 'audit',    label: `Audit Log (${auditLog.length})` },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                  activeTab === tab.key
                    ? 'bg-axis text-white'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* ── Editor tab ── */}
          {activeTab === 'editor' && (
            <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white">
              {canEdit ? (
                <>
                  <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-5 py-2.5">
                    <span className="text-xs font-semibold text-slate-500">Editing lease document — changes are saved manually</span>
                    <button
                      onClick={handleSave}
                      disabled={saving || !!actionLoading}
                      className="rounded-xl bg-axis px-4 py-1.5 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
                    >
                      {saving ? 'Saving…' : 'Save edits'}
                    </button>
                  </div>
                  <textarea
                    value={editorContent}
                    onChange={e => setEditorContent(e.target.value)}
                    spellCheck={false}
                    className="h-[calc(100vh-310px)] min-h-[480px] w-full resize-none p-6 font-mono text-sm leading-7 text-slate-800 focus:outline-none"
                    placeholder="Lease content will appear here after generation…"
                  />
                </>
              ) : (
                <>
                  <div className="border-b border-slate-100 bg-slate-50 px-5 py-2.5">
                    <span className="text-xs font-semibold text-slate-500">
                      Read-only — this lease has been {status?.toLowerCase()}
                    </span>
                  </div>
                  <div className="h-[calc(100vh-310px)] min-h-[480px] overflow-y-auto p-6">
                    <pre className="whitespace-pre-wrap font-mono text-sm leading-7 text-slate-800">{editorContent}</pre>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Original AI Draft tab (read-only reference) ── */}
          {activeTab === 'original' && (
            <div className="overflow-hidden rounded-[24px] border border-amber-200 bg-white">
              <div className="border-b border-amber-200 bg-amber-50 px-5 py-2.5">
                <span className="text-xs font-semibold text-amber-700">
                  Read-only · original AI-generated draft · not shown to residents
                </span>
              </div>
              <div className="h-[calc(100vh-310px)] min-h-[480px] overflow-y-auto p-6">
                <pre className="whitespace-pre-wrap font-mono text-sm leading-7 text-slate-800">
                  {draft?.['AI Draft Content'] || 'No AI draft content stored.'}
                </pre>
              </div>
            </div>
          )}

          {/* ── Audit Log tab ── */}
          {activeTab === 'audit' && (
            <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-6 py-4">
                <h3 className="font-black text-slate-900">Audit Trail</h3>
                <p className="mt-0.5 text-sm text-slate-500">
                  Complete history of every action taken on this lease draft.
                </p>
              </div>
              {auditLog.length === 0 ? (
                <div className="px-6 py-10 text-center text-sm text-slate-500">No audit entries recorded yet.</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {auditLog.map(entry => (
                    <div key={entry.id} className="flex items-start gap-4 px-6 py-4">
                      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-black text-slate-600">
                        {(entry['Performed By'] || 'S').charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900">{entry['Action Type']}</span>
                          <span className="text-xs text-slate-500">
                            by {entry['Performed By']} ({entry['Performed By Role']})
                          </span>
                        </div>
                        {entry['Notes'] && (
                          <p className="mt-1 text-sm text-slate-600">{entry['Notes']}</p>
                        )}
                        <div className="mt-1 text-xs text-slate-400">{fmtDateTime(entry['Timestamp'])}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="hidden w-72 shrink-0 space-y-4 lg:block">
          {/* Lease details card */}
          <div className="rounded-[24px] border border-slate-200 bg-white p-5">
            <div className="mb-4 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Lease Details</div>
            <div className="space-y-3">
              <DetailRow label="Resident" value={draft?.['Resident Name']} />
              <DetailRow label="Email" value={draft?.['Resident Email']} />
              <DetailRow label="Property" value={draft?.['Property']} />
              <DetailRow label="Unit" value={draft?.['Unit']} />
              <DetailRow label="Term" value={draft?.['Lease Term']} />
              <DetailRow label="Move-in" value={fmtDate(draft?.['Lease Start Date'])} />
              <DetailRow label="Move-out" value={fmtDate(draft?.['Lease End Date']) || 'Month-to-month'} />
              {draft?.['Rent Amount'] ? (
                <DetailRow label="Rent" value={`$${Number(draft['Rent Amount']).toLocaleString()}/mo`} />
              ) : null}
              {draft?.['Deposit Amount'] ? (
                <DetailRow label="Deposit" value={`$${Number(draft['Deposit Amount']).toLocaleString()}`} />
              ) : null}
              {draft?.['Utilities Fee'] ? (
                <DetailRow label="Utilities" value={`$${draft['Utilities Fee']}/mo`} />
              ) : null}
              {signforgeEnvelopeId ? (
                <DetailRow label="SignForge envelope" value={String(signforgeEnvelopeId)} />
              ) : null}
              {draft?.['SignForge Sent At'] ? (
                <DetailRow label="SignForge sent" value={fmtDate(draft['SignForge Sent At'])} />
              ) : null}
            </div>
          </div>

          {/* Approval info — shown once approved */}
          {(draft?.['Approved By'] || draft?.['Approved At'] || draft?.['Published At']) && (
            <div className="rounded-[24px] border border-green-200 bg-green-50 p-5">
              <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-green-600">Approval Record</div>
              <div className="space-y-2">
                {draft?.['Approved By']  && <DetailRow label="Approved by" value={draft['Approved By']} />}
                {draft?.['Approved At']  && <DetailRow label="Approved"    value={fmtDateTime(draft['Approved At'])} />}
                {draft?.['Published At'] && <DetailRow label="Published"   value={fmtDateTime(draft['Published At'])} />}
              </div>
            </div>
          )}

          {/* Internal notes */}
          <div className="rounded-[24px] border border-slate-200 bg-white p-5">
            <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Internal Notes</div>
            <p className="mb-3 text-xs text-slate-500">Visible to managers only — not shown to residents.</p>
            <textarea
              value={managerNotes}
              onChange={e => setManagerNotes(e.target.value)}
              disabled={!canEdit}
              rows={4}
              placeholder="Revision notes, review comments, instructions…"
              className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 placeholder:text-slate-400 transition focus:border-[#2563eb] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20 disabled:opacity-60"
            />
            {canEdit && (
              <button
                onClick={handleSave}
                disabled={saving || !!actionLoading}
                className="mt-3 w-full rounded-2xl border border-slate-200 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save notes'}
              </button>
            )}
          </div>

          {/* Context-aware hints */}
          {canApprove && (
            <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
              <div className="text-sm font-semibold text-slate-700">Ready to approve?</div>
              <p className="mt-1.5 text-sm text-slate-500">
                Save your edits, then click <strong>Approve</strong>. After approval you can publish to the resident portal.
              </p>
            </div>
          )}
          {canPublish && (
            <div className="rounded-[24px] border border-axis/20 bg-axis/5 p-5">
              <div className="text-sm font-semibold text-axis">Approved — ready to publish</div>
              <p className="mt-1.5 text-sm text-axis/80">
                Click <strong>Publish to portal</strong> above to make this lease visible to the resident.
              </p>
            </div>
          )}
          {status === 'Published' && (
            <div className="rounded-[24px] border border-violet-200 bg-violet-50/80 p-5">
              <div className="text-sm font-semibold text-violet-900">E-sign (Puppeteer + SignForge)</div>
              <p className="mt-1.5 text-sm text-violet-800/90">
                The server renders this lease to PDF with{' '}
                <a className="underline font-medium" href="https://pptr.dev/api/puppeteer.puppeteernode" target="_blank" rel="noreferrer">
                  Puppeteer
                </a>{' '}
                and sends it through{' '}
                <a className="underline font-medium" href="https://signforge.io/dashboard" target="_blank" rel="noreferrer">
                  SignForge
                </a>{' '}
                (<code className="rounded bg-violet-100 px-1 text-[11px]">SIGNFORGE_API_KEY</code>). Use <strong>Send for e-sign</strong> in the header.
              </p>
            </div>
          )}
          {['Published', 'Signed'].includes(status) && (
            <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
              <div className="text-sm font-semibold text-slate-700">Read-only</div>
              <p className="mt-1.5 text-sm text-slate-500">
                This lease has been {status?.toLowerCase()} and can no longer be edited.
              </p>
            </div>
          )}

          {/* Mobile action buttons (shown in sidebar on smaller screens) */}
          <div className="block space-y-2 lg:hidden">
            {canEdit && (
              <button onClick={handleSave} disabled={saving || !!actionLoading} className="w-full rounded-2xl border border-slate-300 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">
                {saving ? 'Saving…' : 'Save edits'}
              </button>
            )}
            {canReject && (
              <button onClick={handleReject} disabled={!!actionLoading} className="w-full rounded-2xl border border-red-200 bg-red-50 py-3 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-50">
                {actionLoading === 'reject' ? 'Updating…' : 'Changes needed'}
              </button>
            )}
            {canApprove && (
              <button onClick={handleApprove} disabled={!!actionLoading} className="w-full rounded-2xl bg-green-600 py-3 text-sm font-semibold text-white transition hover:bg-green-700 disabled:opacity-50">
                {actionLoading === 'approve' ? 'Approving…' : 'Approve lease'}
              </button>
            )}
            {canPublish && (
              <button onClick={handlePublish} disabled={!!actionLoading} className="w-full rounded-2xl bg-[#2563eb] py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50">
                {actionLoading === 'publish' ? 'Publishing…' : 'Publish to resident portal'}
              </button>
            )}
            {canSignforgeSend && (
              <button
                type="button"
                onClick={handleSignforgeSend}
                disabled={!!actionLoading}
                className="w-full rounded-2xl border border-violet-200 bg-violet-50 py-3 text-sm font-semibold text-violet-800 transition hover:bg-violet-100 disabled:opacity-50"
              >
                {actionLoading === 'signforge' ? 'Sending…' : 'Send for e-sign (SignForge)'}
              </button>
            )}
            {canSignforgeRefresh && (
              <button
                type="button"
                onClick={handleSignforgeRefreshStatus}
                disabled={!!actionLoading}
                className="w-full rounded-2xl border border-slate-200 bg-white py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                {actionLoading === 'signforge-status' ? 'Checking…' : 'Refresh SignForge status'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Manager (default export) ─────────────────────────────────────────────────
// Root component. Manages session, view state, and top-level routing between
// the login screen, dashboard, and editor.
/** Merge current query with portal=manager for post-checkout / deep links. */
function portalManagerSearchFromLocation(search) {
  const raw = String(search || '').replace(/^\?/, '')
  const p = new URLSearchParams(raw)
  p.set('portal', 'manager')
  return p.toString()
}

export default function Manager() {
  const location = useLocation()
  const [manager, setManager] = useState(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [view, setView] = useState('dashboard') // 'dashboard' | 'editor'
  const [openDraftId, setOpenDraftId] = useState(null)

  // Restore session from sessionStorage on first render
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(MANAGER_SESSION_KEY)
      if (saved) {
        setManager(JSON.parse(saved))
      }
    } catch {
      sessionStorage.removeItem(MANAGER_SESSION_KEY)
    } finally {
      setAuthChecked(true)
    }
  }, [])

  function handleLogin(managerData) {
    setManager(managerData)
    setAuthChecked(true)
    setView('dashboard')
  }

  function handleSignOut() {
    sessionStorage.removeItem(MANAGER_SESSION_KEY)
    setManager(null)
    setAuthChecked(true)
    setView('dashboard')
    setOpenDraftId(null)
  }

  function handleManagerUpdate(updated) {
    setManager(updated)
    try {
      sessionStorage.setItem(MANAGER_SESSION_KEY, JSON.stringify(updated))
    } catch {
      // ignore
    }
  }

  function handleOpenDraft(draftId) {
    setOpenDraftId(draftId)
    setView('editor')
  }

  function handleBackToDashboard() {
    setView('dashboard')
    setOpenDraftId(null)
  }

  if (!authChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#f7fbff_0%,#eef5ff_48%,#f9fcff_100%)] px-6 text-sm font-medium text-slate-400">
        Loading manager portal...
      </div>
    )
  }

  if (!manager) {
    return <Navigate to={`/portal?${portalManagerSearchFromLocation(location.search)}`} replace />
  }

  if (view === 'editor' && openDraftId) {
    return (
      <LeaseEditor
        draftId={openDraftId}
        manager={manager}
        onBack={handleBackToDashboard}
      />
    )
  }

  return (
    <ManagerDashboard
      manager={manager}
      onOpenDraft={handleOpenDraft}
      onSignOut={handleSignOut}
      onManagerUpdate={handleManagerUpdate}
    />
  )
}

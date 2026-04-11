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
import ManagerInboxPage from '../components/manager-inbox/ManagerInboxPage'
import {
  getWorkOrderById,
  updateWorkOrder,
  getAllWorkOrders,
  getAllPaymentsRecords,
  updatePaymentRecord,
  AIRTABLE_PAYMENTS_BASE_ID,
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

function isManagerInternalPreview(manager) {
  return manager?.__axisDeveloper === true || manager?.__axisInternalStaff === true
}

/** SWE internal preview: full manager scope but cannot approve/decline tour requests (manager-side). */
function managerCannotApproveTours(manager) {
  const r = String(manager?.axisStaffRole || '')
    .trim()
    .toLowerCase()
  return manager?.__axisInternalStaff === true && r === 'swe'
}

function computeManagerScope(propertyRecords, manager) {
  const list = Array.isArray(propertyRecords) ? propertyRecords : []
  const approvedNames = new Set()
  const pendingAssigned = []
  if (isManagerInternalPreview(manager)) {
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

function normalizePortalScopeLabel(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(avenue|ave|street|st|road|rd|boulevard|blvd|place|pl|drive|dr)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function workOrderInScope(w, approvedNamesLowerSet) {
  if (!approvedNamesLowerSet?.size) return false
  const raw = workOrderPropertyLabel(w)
  const prop = raw.toLowerCase()
  const normalizedProp = normalizePortalScopeLabel(raw)
  if (!prop && !normalizedProp) return false
  return [...approvedNamesLowerSet].some((ns) => {
    const normalizedScope = normalizePortalScopeLabel(ns)
    return (
      prop === ns ||
      prop.includes(ns) ||
      ns.includes(prop) ||
      (normalizedProp && normalizedScope && (
        normalizedProp === normalizedScope ||
        normalizedProp.includes(normalizedScope) ||
        normalizedScope.includes(normalizedProp)
      ))
    )
  })
}

function parseCurrencyAmount(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function money(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(parseCurrencyAmount(value))
}

function paymentAmountDue(record) {
  return parseCurrencyAmount(record?.Amount ?? record?.['Amount Due'] ?? record?.Total)
}

function paymentAmountPaid(record) {
  const explicit = parseCurrencyAmount(record?.['Amount Paid'] ?? record?.['Paid Amount'] ?? record?.Paid ?? record?.['Collected Amount'])
  if (explicit > 0) return explicit
  return String(record?.Status || '').trim().toLowerCase() === 'paid' ? paymentAmountDue(record) : 0
}

function paymentBalanceDue(record) {
  const explicit = Number(record?.Balance ?? record?.['Balance Due'] ?? record?.Outstanding)
  if (Number.isFinite(explicit)) return Math.max(0, explicit)
  return Math.max(0, paymentAmountDue(record) - paymentAmountPaid(record))
}

function paymentComputedStatus(record) {
  const balance = paymentBalanceDue(record)
  const total = paymentAmountDue(record)
  const due = record?.['Due Date'] ? new Date(record['Due Date']) : null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (balance <= 0) return 'paid'
  if (balance < total) return 'partial'
  if (due && !Number.isNaN(due.getTime())) {
    const diffDays = Math.ceil((due.getTime() - today.getTime()) / 86400000)
    if (diffDays < 0) return 'overdue'
    if (diffDays <= 5) return 'due_soon'
  }
  return 'unpaid'
}

function paymentStatusLabel(status) {
  switch (status) {
    case 'paid': return 'Paid'
    case 'partial': return 'Partial'
    case 'due_soon': return 'Due Soon'
    case 'overdue': return 'Overdue'
    default: return 'Unpaid'
  }
}

function paymentStatusTone(status) {
  switch (status) {
    case 'paid': return 'emerald'
    case 'partial': return 'axis'
    case 'due_soon': return 'amber'
    case 'overdue': return 'red'
    default: return 'slate'
  }
}

function paymentResidentLabel(record) {
  return String(record?.['Resident Name'] || record?.Resident || record?.Name || '').trim() || 'Resident not set'
}

function paymentRoomLabel(record) {
  return formatPaymentRoomTitle(record)
}

function managerWorkOrderStatusLabel(record) {
  if (!record) return 'Submitted'
  const resolved = workOrderIsResolvedRecord(record)
  const raw = String(record.Status || '').trim().toLowerCase()
  if (resolved) return raw === 'closed' ? 'Closed' : 'Completed'
  if (raw.includes('schedule')) return 'Scheduled'
  if (raw.includes('progress')) return 'In Progress'
  if (raw.includes('review')) return 'In Review'
  return 'Submitted'
}

function managerWorkOrderStatusTone(record) {
  const label = managerWorkOrderStatusLabel(record)
  if (label === 'Completed' || label === 'Closed') return 'emerald'
  if (label === 'Scheduled') return 'axis'
  if (label === 'In Progress' || label === 'In Review') return 'amber'
  return 'slate'
}

function parseWorkOrderMetaBlock(value = '') {
  const out = {}
  String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .forEach((line) => {
      const [key, ...rest] = line.split(':')
      if (!key || rest.length === 0) return
      out[key.trim().toLowerCase()] = rest.join(':').trim()
    })
  return out
}

function mergeWorkOrderMetaBlock(baseText = '', meta = {}) {
  const current = parseWorkOrderMetaBlock(baseText)
  Object.entries(meta).forEach(([key, value]) => {
    if (value == null || String(value).trim() === '') delete current[key]
    else current[key] = String(value).trim()
  })
  const otherLines = String(baseText || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^[a-z ]+:/i.test(line))
  const metaLines = Object.entries(current).map(([key, value]) => `${key}: ${value}`)
  return [...otherLines, ...metaLines].join('\n').trim()
}

function workOrderPlainNotes(value = '') {
  return String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^[a-z ]+:/i.test(line))
    .join('\n')
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

function dateFromCalendarKey(key) {
  const [yy, mm, dd] = String(key || '').split('-').map(Number)
  if (!yy || !mm || !dd) return new Date()
  return new Date(yy, mm - 1, dd)
}

function weekdayAbbrFromDateKey(key) {
  return CAL_DOW_TO_ABBR[dateFromCalendarKey(key).getDay()]
}

function inputValueFromMinutes(minutes) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function minutesFromInputValue(value) {
  const m = String(value || '').match(/^(\d{2}):(\d{2})$/)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

function displayTimeFromMinutes(minutes) {
  return new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function formatTimeRangeLabel(range) {
  return `${displayTimeFromMinutes(range.start)} – ${displayTimeFromMinutes(range.end)}`
}

function normalizeTimeRanges(ranges) {
  const parsed = (ranges || [])
    .map((range) => {
      const start = typeof range.start === 'number' ? range.start : minutesFromInputValue(range.start)
      const end = typeof range.end === 'number' ? range.end : minutesFromInputValue(range.end)
      if (!Number.isFinite(start) || !Number.isFinite(end)) return null
      const clampedStart = Math.max(TOUR_GRID_START_MIN, Math.min(TOUR_GRID_END_MIN - TOUR_GRID_STEP_MIN, start))
      const clampedEnd = Math.max(TOUR_GRID_START_MIN + TOUR_GRID_STEP_MIN, Math.min(TOUR_GRID_END_MIN, end))
      if (clampedEnd <= clampedStart) return null
      return { start: clampedStart, end: clampedEnd }
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start)

  const merged = []
  for (const range of parsed) {
    const prev = merged[merged.length - 1]
    if (prev && range.start <= prev.end) prev.end = Math.max(prev.end, range.end)
    else merged.push({ ...range })
  }
  return merged
}

function timeRangesFromWeeklyFree(weeklyArrays, dayAbbr) {
  const arr = [...(weeklyArrays?.[dayAbbr] || [])].sort((a, b) => a - b)
  if (!arr.length) return []
  const ranges = []
  let startIdx = arr[0]
  let prevIdx = arr[0]
  for (let i = 1; i < arr.length; i += 1) {
    const idx = arr[i]
    if (idx === prevIdx + 1) {
      prevIdx = idx
      continue
    }
    ranges.push({
      start: TOUR_GRID_START_MIN + startIdx * TOUR_GRID_STEP_MIN,
      end: TOUR_GRID_START_MIN + (prevIdx + 1) * TOUR_GRID_STEP_MIN,
    })
    startIdx = idx
    prevIdx = idx
  }
  ranges.push({
    start: TOUR_GRID_START_MIN + startIdx * TOUR_GRID_STEP_MIN,
    end: TOUR_GRID_START_MIN + (prevIdx + 1) * TOUR_GRID_STEP_MIN,
  })
  return ranges
}

function weeklyFreeWithDayRanges(weeklyArrays, dayAbbr, ranges) {
  const next = cloneWeeklyArrays(weeklyArrays)
  const idxSet = new Set()
  for (const range of normalizeTimeRanges(ranges)) {
    for (const idx of halfHourIndicesOverlappingRange(range.start, range.end)) {
      idxSet.add(idx)
    }
  }
  next[dayAbbr] = [...idxSet].sort((a, b) => a - b)
  return next
}

function addDefaultTimeRange(ranges) {
  const normalized = normalizeTimeRanges(ranges)
  const last = normalized[normalized.length - 1]
  const start = last ? Math.min(last.end + TOUR_GRID_STEP_MIN, 18 * 60) : 10 * 60
  const end = Math.min(start + 120, TOUR_GRID_END_MIN)
  return [...normalized, { start, end }]
}

function bookingBadgeTone(row) {
  const type = String(row.Type || '').trim().toLowerCase()
  const approval = String(row['Manager Approval'] || '').trim().toLowerCase()
  if (type === 'meeting') return 'bg-violet-50 text-violet-800 border-violet-200'
  if (approval === 'approved') return 'bg-emerald-50 text-emerald-800 border-emerald-200'
  if (approval === 'declined') return 'bg-red-50 text-red-700 border-red-200'
  return 'bg-sky-50 text-sky-800 border-sky-200'
}

function bookingLabel(row) {
  return String(row.Type || '').trim().toLowerCase() === 'meeting' ? 'Meeting' : 'Booked tour'
}

function TimeRangeRow({ range, onChange, onRemove, disabled = false, disableRemove = false }) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3">
      <input
        type="time"
        step="1800"
        value={inputValueFromMinutes(range.start)}
        disabled={disabled}
        onChange={(e) => onChange({ ...range, start: minutesFromInputValue(e.target.value) ?? range.start })}
        className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-800 outline-none transition focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/20"
      />
      <span className="text-sm font-semibold text-slate-400">to</span>
      <input
        type="time"
        step="1800"
        value={inputValueFromMinutes(range.end)}
        disabled={disabled}
        onChange={(e) => onChange({ ...range, end: minutesFromInputValue(e.target.value) ?? range.end })}
        className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-800 outline-none transition focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/20"
      />
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled || disableRemove}
        className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-50 disabled:opacity-40"
      >
        Remove
      </button>
    </div>
  )
}

function TimeRangeList({ ranges, onChangeRange, onRemoveRange, disabled = false }) {
  if (!ranges.length) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
        No hours set for this day.
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {ranges.map((range, idx) => (
        <TimeRangeRow
          key={`${range.start}-${range.end}-${idx}`}
          range={range}
          disabled={disabled}
          disableRemove={ranges.length === 1}
          onChange={(next) => onChangeRange(idx, next)}
          onRemove={() => onRemoveRange(idx)}
        />
      ))}
    </div>
  )
}

function CalendarToolbar({ view, label, onViewChange, onPrev, onNext, onToday }) {
  const tabCls = (id) =>
    classNames(
      'rounded-xl px-3 py-2 text-sm font-semibold transition',
      view === id ? 'bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] text-white shadow-[0_6px_18px_rgba(37,99,235,0.25)]' : 'text-slate-600 hover:bg-slate-100',
    )

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex rounded-2xl border border-slate-200 bg-slate-50 p-1">
        <button type="button" className={tabCls('day')} onClick={() => onViewChange('day')}>Day</button>
        <button type="button" className={tabCls('week')} onClick={() => onViewChange('week')}>Week</button>
        <button type="button" className={tabCls('month')} onClick={() => onViewChange('month')}>Month</button>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onToday} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-[#2563eb] hover:bg-slate-50">
          Today
        </button>
        <div className="flex items-center gap-1 rounded-2xl border border-slate-200 bg-white p-1">
          <button type="button" onClick={onPrev} className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">←</button>
          <div className="min-w-[10rem] px-3 text-center text-sm font-bold text-slate-900">{label}</div>
          <button type="button" onClick={onNext} className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">→</button>
        </div>
      </div>
    </div>
  )
}

function AvailabilityCalendar({ view, anchorDate, selectedDateKey, onSelectDate, weeklyFree, bookedByDate }) {
  const y = anchorDate.getFullYear()
  const m = anchorDate.getMonth()
  const daysInMonth = new Date(y, m + 1, 0).getDate()
  const firstDow = new Date(y, m, 1).getDay()
  const todayKey = dateKeyFromDate(new Date())
  const weekStart = startOfWeekSunday(anchorDate)
  const weekDays = Array.from({ length: 7 }, (_, i) => addDaysDate(weekStart, i))

  const dayRanges = (key) => timeRangesFromWeeklyFree(weeklyFree, weekdayAbbrFromDateKey(key))
  const bookings = (key) => bookedByDate.get(key) || []

  const renderDayCard = (dateKey, dayLabel, dateLabel) => {
    const ranges = dayRanges(dateKey)
    const dayBookings = bookings(dateKey)
    const selected = selectedDateKey === dateKey
    return (
      <button
        key={dateKey}
        type="button"
        onClick={() => onSelectDate(dateKey)}
        className={classNames(
          'min-h-[154px] rounded-[24px] border p-4 text-left transition',
          selected ? 'border-[#2563eb] bg-[#2563eb]/5 ring-2 ring-[#2563eb]/20' : 'border-slate-200 bg-slate-50/70 hover:bg-white',
          dateKey === todayKey ? 'ring-1 ring-slate-300' : '',
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{dayLabel}</div>
            <div className="mt-1 text-lg font-black text-slate-900">{dateLabel}</div>
          </div>
          <span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-slate-500 ring-1 ring-slate-200">
            {ranges.length ? `${ranges.length} range${ranges.length === 1 ? '' : 's'}` : 'Off'}
          </span>
        </div>
        <div className="mt-3 space-y-1">
          {ranges.slice(0, 2).map((range) => (
            <div key={`${range.start}-${range.end}`} className="rounded-xl bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-800">
              {formatTimeRangeLabel(range)}
            </div>
          ))}
          {ranges.length > 2 ? <div className="text-xs text-slate-400">+{ranges.length - 2} more</div> : null}
        </div>
        <div className="mt-4 space-y-1">
          {dayBookings.slice(0, 2).map((row) => (
            <div key={row.id} className={`rounded-xl border px-2.5 py-1.5 text-xs font-semibold ${bookingBadgeTone(row)}`}>
              {bookingLabel(row)}{row['Preferred Time'] ? ` · ${row['Preferred Time']}` : ''}
            </div>
          ))}
          {!dayBookings.length ? <div className="text-xs text-slate-400">No bookings</div> : null}
        </div>
      </button>
    )
  }

  if (view === 'day') {
    const dateKey = dateKeyFromDate(anchorDate)
    const ranges = dayRanges(dateKey)
    const dayBookings = bookings(dateKey)
    return (
      <div className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
          {anchorDate.toLocaleDateString('en-US', { weekday: 'long' })}
        </div>
        <div className="mt-1 text-2xl font-black text-slate-900">
          {anchorDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
            <div className="text-sm font-bold text-slate-900">Available tour slots</div>
            <div className="mt-3 space-y-2">
              {ranges.length ? ranges.map((range) => (
                <div key={`${range.start}-${range.end}`} className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
                  {formatTimeRangeLabel(range)}
                </div>
              )) : <div className="text-sm text-slate-500">Not available</div>}
            </div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
            <div className="text-sm font-bold text-slate-900">Booked tours</div>
            <div className="mt-3 space-y-2">
              {dayBookings.length ? dayBookings.map((row) => (
                <div key={row.id} className={`rounded-xl border px-3 py-2 text-sm ${bookingBadgeTone(row)}`}>
                  <div className="font-semibold">{bookingLabel(row)}</div>
                  <div className="mt-1 text-xs opacity-80">
                    {row.Name || 'Guest'}{row['Preferred Time'] ? ` · ${row['Preferred Time']}` : ''}{row.Property ? ` · ${row.Property}` : ''}
                  </div>
                </div>
              )) : <div className="text-sm text-slate-500">No booked tours</div>}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (view === 'week') {
    return (
      <div className="grid gap-3 lg:grid-cols-7">
        {weekDays.map((day) => renderDayCard(
          dateKeyFromDate(day),
          day.toLocaleDateString('en-US', { weekday: 'short' }),
          String(day.getDate()),
        ))}
      </div>
    )
  }

  const cells = []
  for (let i = 0; i < firstDow; i += 1) cells.push(null)
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(day)

  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid grid-cols-7 gap-2 px-1 pb-3 text-center text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
          <div key={day}>{day}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-2">
        {cells.map((day, idx) => {
          if (day == null) return <div key={`pad-${idx}`} className="min-h-[132px] rounded-2xl bg-transparent" />
          const key = calendarDateKey(y, m, day)
          return renderDayCard(key, new Date(y, m, day).toLocaleDateString('en-US', { weekday: 'short' }), String(day))
        })}
      </div>
    </div>
  )
}

function AvailabilityEditorPanel({
  selectedDateKey,
  ranges,
  isAvailable,
  setIsAvailable,
  onAddRange,
  onChangeRange,
  onRemoveRange,
  onOpenMeet,
  onSave,
  onApplyWeekday,
  onClearDay,
  availSaving,
  manager,
}) {
  const selectedDate = dateFromCalendarKey(selectedDateKey)
  const weekday = weekdayAbbrFromDateKey(selectedDateKey)

  return (
    <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm lg:sticky lg:top-6">
      <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#2563eb]">Tour availability</div>
      <h2 className="mt-2 text-2xl font-black text-slate-900">
        {selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
      </h2>
      <p className="mt-2 text-sm text-slate-500">
        Edit tour hours for this day. Saving updates your recurring {weekday} schedule.
      </p>

      {isManagerInternalPreview(manager) ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {manager.__axisDeveloper
            ? 'Developer preview: availability edits are disabled.'
            : 'Internal preview: availability edits are disabled (no linked manager profile).'}
        </div>
      ) : null}

      <div className="mt-6 flex rounded-2xl border border-slate-200 bg-slate-50 p-1">
        <button
          type="button"
          onClick={() => setIsAvailable(true)}
          className={classNames(
            'flex-1 rounded-xl px-4 py-3 text-sm font-semibold transition',
            isAvailable ? 'bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] text-white shadow-[0_8px_18px_rgba(37,99,235,0.25)]' : 'text-slate-500 hover:bg-white',
          )}
        >
          Available
        </button>
        <button
          type="button"
          onClick={() => setIsAvailable(false)}
          className={classNames(
            'flex-1 rounded-xl px-4 py-3 text-sm font-semibold transition',
            !isAvailable ? 'bg-slate-900 text-white shadow-[0_8px_18px_rgba(15,23,42,0.16)]' : 'text-slate-500 hover:bg-white',
          )}
        >
          Not available
        </button>
      </div>

      <div className="mt-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="text-sm font-bold text-slate-900">Time ranges</div>
          <button
            type="button"
            disabled={!isAvailable}
            onClick={onAddRange}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-[#2563eb] hover:bg-slate-50 disabled:opacity-40"
          >
            + Add time range
          </button>
        </div>
        {isAvailable ? (
          <TimeRangeList ranges={ranges} onChangeRange={onChangeRange} onRemoveRange={onRemoveRange} />
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
            This day is marked unavailable.
          </div>
        )}
      </div>

      <div className="mt-6 flex flex-wrap gap-2 text-sm">
        <button
          type="button"
          onClick={onApplyWeekday}
          disabled={availSaving || isManagerInternalPreview(manager)}
          className="rounded-xl border border-slate-200 px-3 py-2 font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
        >
          Apply to every {weekday}
        </button>
        <button
          type="button"
          onClick={onClearDay}
          disabled={availSaving || isManagerInternalPreview(manager)}
          className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 font-semibold text-red-700 hover:bg-red-100 disabled:opacity-40"
        >
          Clear day
        </button>
      </div>

      <div className="mt-6 grid gap-3">
        <button
          type="button"
          onClick={onOpenMeet}
          disabled={isManagerInternalPreview(manager)}
          className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
        >
          Let us meet
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={availSaving || isManagerInternalPreview(manager)}
          className="rounded-2xl bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] px-4 py-3 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(37,99,235,0.22)] disabled:opacity-50"
        >
          {availSaving ? 'Saving…' : 'Save availability'}
        </button>
      </div>
    </div>
  )
}

function LetUsMeetModal({ open, initialDateKey, manager, onClose, onCreated }) {
  const [date, setDate] = useState(initialDateKey)
  const [startTime, setStartTime] = useState('10:00')
  const [endTime, setEndTime] = useState('11:00')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setDate(initialDateKey)
    setStartTime('10:00')
    setEndTime('11:00')
    setNotes('')
    setSaving(false)
    setError('')
  }, [open, initialDateKey])

  if (!open) return null

  async function handleSave() {
    setError('')
    const startMinutes = minutesFromInputValue(startTime)
    const endMinutes = minutesFromInputValue(endTime)
    if (!date || startMinutes == null || endMinutes == null || endMinutes <= startMinutes) {
      setError('Choose a valid date and time range.')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/forms?action=tour', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: manager?.name || 'Axis manager',
          email: manager?.email || 'manager@axis.invalid',
          type: 'Meeting',
          manager: manager?.name || '',
          managerEmail: manager?.email || '',
          preferredDate: date,
          preferredTime: `${displayTimeFromMinutes(startMinutes)} - ${displayTimeFromMinutes(endMinutes)}`,
          notes: String(notes || '').trim(),
        }),
      })
      const data = await readJsonResponse(res)
      if (!res.ok) throw new Error(data.error || 'Could not save meeting.')
      toast.success('Meeting saved')
      onCreated?.()
      onClose()
    } catch (err) {
      setError(err.message || 'Could not save meeting.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal onClose={onClose}>
      <div className="pr-8">
        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#2563eb]">Let us meet</div>
        <h3 className="mt-2 text-2xl font-black text-slate-900">Quick meeting slot</h3>
        <p className="mt-2 text-sm text-slate-500">Create a one-off meeting slot without changing your weekly schedule.</p>
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-slate-700">Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={portalAuthInputCls} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700">Start time</label>
            <input type="time" step="1800" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={portalAuthInputCls} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700">End time</label>
            <input type="time" step="1800" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={portalAuthInputCls} />
          </div>
        </div>
      </div>
      <div className="mt-4">
        <label className="mb-1.5 block text-xs font-semibold text-slate-700">Notes</label>
        <textarea
          rows={4}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional details"
          className={`${portalAuthInputCls} min-h-[120px] resize-y`}
        />
      </div>
      {error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div> : null}
      <div className="mt-6 flex justify-end gap-3">
        <button type="button" onClick={onClose} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">
          Cancel
        </button>
        <PortalPrimaryButton type="button" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </PortalPrimaryButton>
      </div>
    </Modal>
  )
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
            No houses linked yet. Contact Axis.
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
    if (isManagerInternalPreview(manager)) {
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
    if (isManagerInternalPreview(manager)) {
      toast.info('Profile save is disabled in preview mode.')
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
            No properties yet. Contact Axis to link your manager email to properties.
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

function dateKeyFromDate(d) {
  return calendarDateKey(d.getFullYear(), d.getMonth(), d.getDate())
}

function startOfWeekSunday(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setDate(x.getDate() - x.getDay())
  return x
}

function addDaysDate(d, delta) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setDate(x.getDate() + delta)
  return x
}

function formatWeekRangeLabel(weekStart) {
  const end = addDaysDate(weekStart, 6)
  const sameMonth = weekStart.getMonth() === end.getMonth()
  const a = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const b = end.toLocaleDateString('en-US', {
    month: sameMonth ? undefined : 'short',
    day: 'numeric',
    year: 'numeric',
  })
  return `${a} – ${b}`
}

function toggleStandardTourSlotInWeekly(weeklyFree, dayAbbr, slot) {
  const range = slotRangeMinutes(slot)
  if (!range) return weeklyFree
  const idxs = halfHourIndicesOverlappingRange(range.start, range.end)
  const next = cloneWeeklyArrays(weeklyFree)
  const arr = next[dayAbbr]
  const allOn = idxs.length > 0 && idxs.every((i) => arr.includes(i))
  if (allOn) {
    const rm = new Set(idxs)
    next[dayAbbr] = arr.filter((i) => !rm.has(i))
  } else {
    const set = new Set(arr)
    idxs.forEach((i) => set.add(i))
    next[dayAbbr] = [...set].sort((a, b) => a - b)
  }
  return next
}

const LEASE_STATUSES_NEEDING_ACTION = new Set(['Draft Generated', 'Under Review', 'Changes Needed', 'Approved'])

function ManagerDashboardHomePanel({
  approvedHouseCount,
  stats,
  statsLoading,
  dataWarnings,
  onNavigate,
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
            You don&apos;t have any houses in your portfolio yet. Once properties are linked to your account, applications, leases, and rent will show here.
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
    </div>
  )
}

function ManagerCalendarPanel({ manager, scopedPropertyNames = [] }) {
  const [anchorDate, setAnchorDate] = useState(() => new Date())
  const [calView, setCalView] = useState(() => /** @type {'month' | 'week' | 'day'} */ ('month'))
  const [editWeekday, setEditWeekday] = useState(() => 'Mon')
  const [detailDateKey, setDetailDateKey] = useState(() => dateKeyFromDate(new Date()))
  const [loading, setLoading] = useState(true)
  const [events, setEvents] = useState([])
  const [calendarIssues, setCalendarIssues] = useState([])
  const [schedulingRows, setSchedulingRows] = useState([])
  const [weeklyFree, setWeeklyFree] = useState(() => emptyWeeklyFreeArrays())
  const [savedEncoded, setSavedEncoded] = useState('')
  const [availLoading, setAvailLoading] = useState(true)
  const [availSaving, setAvailSaving] = useState(false)
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

  useEffect(() => {
    if (calView !== 'day') return
    const k = dateKeyFromDate(anchorDate)
    setDetailDateKey(k)
    setEditWeekday(CAL_DOW_TO_ABBR[anchorDate.getDay()])
  }, [calView, anchorDate])

  const y = anchorDate.getFullYear()
  const m = anchorDate.getMonth()
  const monthLabel = anchorDate.toLocaleString('en-US', { month: 'long', year: 'numeric' })
  const daysInMonth = new Date(y, m + 1, 0).getDate()
  const weekStart = useMemo(() => startOfWeekSunday(anchorDate), [anchorDate])
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDaysDate(weekStart, i)),
    [weekStart],
  )

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
    if (!manager?.id || isManagerInternalPreview(manager)) {
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
  }, [manager?.id, manager?.__axisDeveloper, manager?.__axisInternalStaff])

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

  const eventsForMonthCell = (day) => {
    if (!day) return []
    const key = calendarDateKey(y, m, day)
    return displayEvents.filter((e) => e.date === key)
  }

  const freeSlotCountForMonthCell = (day) => {
    if (!day) return 0
    const abbr = CAL_DOW_TO_ABBR[new Date(y, m, day).getDay()]
    return freeTourSlotCountForWeekday(weeklyFree, abbr)
  }

  const eventsForKey = (key) => displayEvents.filter((e) => e.date === key)

  const freeSlotCountForDateKey = (key) => {
    const [yy, mm, dd] = String(key || '').split('-').map(Number)
    if (!yy || !mm || !dd) return 0
    const abbr = CAL_DOW_TO_ABBR[new Date(yy, mm - 1, dd).getDay()]
    return freeTourSlotCountForWeekday(weeklyFree, abbr)
  }

  const toursForDetailDate = useMemo(() => {
    if (!detailDateKey) return []
    return schedulingRows.filter((r) => parseCalendarDay(r['Preferred Date']) === detailDateKey)
  }, [schedulingRows, detailDateKey])

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

  function clearEditWeekdaySlots() {
    if (!editWeekday) return
    setWeeklyFree((prev) => {
      const next = cloneWeeklyArrays(prev)
      next[editWeekday] = []
      return next
    })
    toast.success(`Cleared ${editWeekday} — click Save to update public tour times`)
  }

  async function handleSaveWeeklyAvailability() {
    if (!manager?.id || isManagerInternalPreview(manager)) {
      toast.info('Saving is disabled in preview mode.')
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
    if (managerCannotApproveTours(manager)) {
      toast.error('Tour approvals are disabled for your account.')
      return
    }
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
  const todayKey = dateKeyFromDate(today)
  const isTodayMonthCell = (day) =>
    day != null && today.getFullYear() === y && today.getMonth() === m && today.getDate() === day

  const detailDateLabel = detailDateKey
    ? (() => {
        const [yy, mm, dd] = detailDateKey.split('-').map(Number)
        return new Date(yy, mm - 1, dd).toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        })
      })()
    : ''

  const freeStandardOnEditDay = freeTourSlotCountForWeekday(weeklyFree, editWeekday)

  const navLabel =
    calView === 'month'
      ? monthLabel
      : calView === 'week'
        ? formatWeekRangeLabel(weekStart)
        : anchorDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

  function goPrev() {
    if (calView === 'month') setAnchorDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))
    else if (calView === 'week') setAnchorDate((d) => addDaysDate(d, -7))
    else setAnchorDate((d) => addDaysDate(d, -1))
  }

  function goNext() {
    if (calView === 'month') setAnchorDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))
    else if (calView === 'week') setAnchorDate((d) => addDaysDate(d, 7))
    else setAnchorDate((d) => addDaysDate(d, 1))
  }

  function goToday() {
    const n = new Date()
    setAnchorDate(n)
    setDetailDateKey(dateKeyFromDate(n))
    setEditWeekday(CAL_DOW_TO_ABBR[n.getDay()])
  }

  function selectCalendarDateKey(key, syncWeekday = true) {
    setDetailDateKey(key)
    const [yy, mm, dd] = key.split('-').map(Number)
    if (yy && mm && dd) {
      setAnchorDate(new Date(yy, mm - 1, dd))
      if (syncWeekday) setEditWeekday(CAL_DOW_TO_ABBR[new Date(yy, mm - 1, dd).getDay()])
    }
  }

  const viewToggleCls = (id) =>
    classNames(
      'rounded-lg px-3 py-1.5 text-xs font-semibold transition',
      calView === id ? 'bg-[#2563eb] text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100',
    )

  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-xl">
          <h2 className="text-xl font-black text-slate-900">Calendar &amp; tour hours</h2>
          {pendingTourCount > 0 ? (
            <p className="mt-2 text-sm font-semibold text-sky-800">
              {pendingTourCount} tour request{pendingTourCount === 1 ? '' : 's'} awaiting yes/no — pick that day below.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-0.5">
            <button type="button" className={viewToggleCls('month')} onClick={() => setCalView('month')}>
              Month
            </button>
            <button type="button" className={viewToggleCls('week')} onClick={() => setCalView('week')}>
              Week
            </button>
            <button type="button" className={viewToggleCls('day')} onClick={() => setCalView('day')}>
              Day
            </button>
          </div>
          <button
            type="button"
            onClick={goToday}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-[#2563eb] hover:bg-slate-50"
          >
            Today
          </button>
          <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-0.5">
            <button type="button" onClick={goPrev} className="rounded-lg px-2.5 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
              ←
            </button>
            <span className="min-w-[8rem] max-w-[14rem] truncate px-1 text-center text-xs font-bold text-slate-800 sm:min-w-[11rem]">
              {navLabel}
            </span>
            <button type="button" onClick={goNext} className="rounded-lg px-2.5 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
              →
            </button>
          </div>
        </div>
      </div>

      {isManagerInternalPreview(manager) ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          {manager.__axisDeveloper
            ? 'Developer preview: tour hours are not saved to Airtable from this session.'
            : 'Internal preview: tour hours are not saved to Airtable from this session.'}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-slate-600">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-800">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          Tour slot open (weekly)
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 font-semibold text-sky-900">
          <span className="h-2 w-2 rounded-full bg-sky-500" />
          Guest tour request
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

      {/* —— Tour availability (always first — no need to pick a calendar day) —— */}
      <div className="mt-8 rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50/80 to-white p-5">
        <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#2563eb]">Your weekly tour hours</div>
        <p className="mt-1 text-sm text-slate-600">
          Saved to <code className="rounded bg-white px-1 text-[11px] ring-1 ring-slate-200">Tour Availability</code> on your manager profile.
          Green blocks = you&apos;re free; guests only book inside those windows.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          <span className="font-semibold text-slate-700">{editWeekday}:</span> {freeStandardOnEditDay} of {TOUR_SLOTS.length} preset tour windows
          covered — or paint any half-hour below.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {TOUR_DAYS.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setEditWeekday(d)}
              className={classNames(
                'rounded-xl border px-3 py-2 text-xs font-bold transition',
                editWeekday === d
                  ? 'border-[#2563eb] bg-[#2563eb] text-white shadow-sm'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300',
              )}
            >
              {d}
            </button>
          ))}
        </div>

        <p className="mt-4 text-xs font-semibold text-slate-700">Quick toggles (preset tour times)</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {TOUR_SLOTS.map((slot) => {
            const range = slotRangeMinutes(slot)
            const idxs = range ? halfHourIndicesOverlappingRange(range.start, range.end) : []
            const set = new Set(weeklyFree[editWeekday] || [])
            const on = idxs.some((i) => set.has(i))
            return (
              <button
                key={slot}
                type="button"
                onClick={() => setWeeklyFree((prev) => toggleStandardTourSlotInWeekly(prev, editWeekday, slot))}
                className={classNames(
                  'rounded-full border px-3 py-1.5 text-xs font-semibold transition',
                  on ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-300',
                )}
              >
                {slot}
              </button>
            )
          })}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
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
            Paint free
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
            Paint busy
          </button>
        </div>

        {availLoading ? (
          <p className="mt-3 text-sm text-slate-500">Loading saved hours…</p>
        ) : (
          <div
            className="mt-3 max-h-[220px] select-none overflow-y-auto rounded-xl border border-slate-200 bg-white"
            onMouseLeave={() => {
              paintingRef.current = false
            }}
          >
            <div className="grid" style={{ gridTemplateColumns: '4.5rem 1fr' }}>
              {Array.from({ length: TOUR_GRID_HALF_COUNT }, (_, halfIdx) => {
                const active = (weeklyFree[editWeekday] || []).includes(halfIdx)
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
                      onMouseDown={(e) => onGridCellDown(editWeekday, halfIdx, e)}
                      onMouseEnter={() => onGridCellEnter(editWeekday, halfIdx)}
                      aria-label={`${formatHalfHourIndexLabel(halfIdx)} ${active ? 'free' : 'busy'}`}
                    />
                  </React.Fragment>
                )
              })}
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleSaveWeeklyAvailability}
            disabled={availSaving || !availabilityDirty || isManagerInternalPreview(manager)}
            className="rounded-xl bg-[#2563eb] px-4 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
          >
            {availSaving ? 'Saving…' : 'Save tour hours'}
          </button>
          <button
            type="button"
            onClick={clearEditWeekdaySlots}
            className="rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-800 hover:bg-red-100"
          >
            Clear {editWeekday}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="mt-8 py-16 text-center text-sm text-slate-500">Loading schedule…</div>
      ) : (
        <div className="mt-8 space-y-8">
          {calView === 'month' ? (
            <div className="min-w-0 overflow-x-auto">
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
                    return <div key={`pad-${idx}`} className="min-h-[88px] rounded-xl bg-slate-50/50" />
                  }
                  const key = calendarDateKey(y, m, day)
                  const dayEvents = eventsForMonthCell(day)
                  const freeN = freeSlotCountForMonthCell(day)
                  const sel = detailDateKey === key
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => selectCalendarDateKey(key)}
                      className={classNames(
                        'flex min-h-[88px] flex-col rounded-xl border p-1.5 text-left transition',
                        sel
                          ? 'border-[#2563eb] bg-[#2563eb]/5 ring-2 ring-[#2563eb]/25'
                          : 'border-slate-100 bg-slate-50/80 hover:border-slate-200 hover:bg-white',
                        isTodayMonthCell(day) && !sel ? 'ring-1 ring-slate-300' : '',
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
                          {freeN} slots
                        </span>
                      </div>
                      <div className="mt-1 flex max-h-[52px] flex-col gap-0.5 overflow-y-auto">
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
          ) : null}

          {calView === 'week' ? (
            <div className="grid gap-2 sm:grid-cols-7">
              {weekDays.map((d) => {
                const key = dateKeyFromDate(d)
                const evs = eventsForKey(key)
                const freeN = freeSlotCountForDateKey(key)
                const sel = detailDateKey === key
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => selectCalendarDateKey(key)}
                    className={classNames(
                      'min-h-[140px] rounded-2xl border p-3 text-left transition',
                      sel ? 'border-[#2563eb] bg-[#2563eb]/5 ring-2 ring-[#2563eb]/20' : 'border-slate-200 bg-slate-50/60 hover:bg-white',
                      key === todayKey ? 'ring-1 ring-slate-300' : '',
                    )}
                  >
                    <div className="text-[10px] font-bold uppercase text-slate-400">
                      {d.toLocaleDateString('en-US', { weekday: 'short' })}
                    </div>
                    <div className="text-lg font-black text-slate-900">{d.getDate()}</div>
                    <div className="mt-1 text-[10px] font-semibold text-emerald-800">{freeN} tour slots</div>
                    <ul className="mt-2 max-h-[72px] space-y-0.5 overflow-y-auto text-left">
                      {evs.slice(0, 4).map((ev, i) => (
                        <li
                          key={`${ev.date}-${i}-${ev.label}`}
                          className={`truncate rounded px-1 py-0.5 text-[9px] font-semibold ${eventToneCls(ev)}`}
                        >
                          {ev.label}
                        </li>
                      ))}
                    </ul>
                  </button>
                )
              })}
            </div>
          ) : null}

          {calView === 'day' ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-black text-slate-900">
                  {anchorDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                </p>
                <span className="text-xs font-semibold text-emerald-800">
                  {freeSlotCountForDateKey(dateKeyFromDate(anchorDate))} tour windows this weekday
                </span>
              </div>
              <ul className="mt-4 space-y-2">
                {eventsForKey(dateKeyFromDate(anchorDate)).length === 0 ? (
                  <li className="text-sm text-slate-500">Nothing scheduled on this day.</li>
                ) : (
                  eventsForKey(dateKeyFromDate(anchorDate)).map((ev, i) => (
                    <li
                      key={`${ev.date}-${i}-${ev.label}`}
                      className={`rounded-xl border border-slate-100 px-3 py-2 text-sm font-semibold ${eventToneCls(ev)}`}
                    >
                      {ev.label}
                    </li>
                  ))
                )}
              </ul>
            </div>
          ) : null}

          {/* Selected date: tour requests + full event list */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-[#2563eb]">Selected date</p>
                <p className="text-lg font-black text-slate-900">{detailDateLabel}</p>
              </div>
              <button
                type="button"
                onClick={() => selectCalendarDateKey(todayKey)}
                className="rounded-lg border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Jump to today
              </button>
            </div>

            <div className="mt-4 border-t border-slate-100 pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tour requests</p>
              {toursForDetailDate.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">No tour requests on this date.</p>
              ) : (
                <ul className="mt-2 space-y-3">
                  {toursForDetailDate.map((row) => {
                    const needs = tourApprovalNeedsAction(row)
                    const appr = String(row['Manager Approval'] || '').trim() || 'Pending'
                    return (
                      <li key={row.id} className="rounded-xl border border-slate-200 bg-slate-50/50 p-3 text-sm">
                        <div className="font-bold text-slate-900">{row.Name || 'Guest'}</div>
                        <div className="mt-1 text-xs text-slate-600">
                          {row.Property ? `${row.Property} · ` : ''}
                          {row['Preferred Time'] || 'Time TBD'}
                          {row['Tour Format'] ? ` · ${row['Tour Format']}` : ''}
                        </div>
                        {row.Email ? <div className="mt-0.5 text-xs text-slate-500">{row.Email}</div> : null}
                        <div className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Status: {appr}</div>
                        {needs ? (
                          managerCannotApproveTours(manager) ? (
                            <p className="mt-2 text-xs font-medium text-amber-800">
                              Approve and decline are not available for SWE preview accounts.
                            </p>
                          ) : (
                            <div className="mt-2 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => respondTourRequest(row, true)}
                                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                onClick={() => respondTourRequest(row, false)}
                                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                              >
                                Decline
                              </button>
                            </div>
                          )
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            <div className="mt-6 border-t border-slate-100 pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">All items this day</p>
              <ul className="mt-2 space-y-1.5">
                {eventsForKey(detailDateKey).length === 0 ? (
                  <li className="text-sm text-slate-500">No other calendar items.</li>
                ) : (
                  eventsForKey(detailDateKey).map((ev, i) => (
                    <li
                      key={`${detailDateKey}-${i}-${ev.label}`}
                      className={`rounded-lg px-3 py-2 text-sm font-medium ${eventToneCls(ev)}`}
                    >
                      {ev.label}
                    </li>
                  ))
                )}
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


function WorkOrdersTabPanel({ allowedPropertyNames }) {
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
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('Submitted')
  const [priority, setPriority] = useState('Normal')
  const [assignedTo, setAssignedTo] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')
  const [managementNotes, setManagementNotes] = useState('')
  const [residentUpdate, setResidentUpdate] = useState('')
  const [resolutionSummary, setResolutionSummary] = useState('')

  const fieldCls =
    'w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/20'

  const priorityOptions = useMemo(() => {
    const p = record?.Priority
    if (p && !WORK_ORDER_PRIORITIES.includes(p)) return [p, ...WORK_ORDER_PRIORITIES]
    return WORK_ORDER_PRIORITIES
  }, [record?.Priority])

  function applyRecordToForm(nextRecord) {
    const meta = parseWorkOrderMetaBlock(nextRecord?.['Management Notes'])
    setStatus(managerWorkOrderStatusLabel(nextRecord))
    setPriority(nextRecord?.Priority || 'Normal')
    setAssignedTo(meta['assigned to'] || '')
    setScheduledAt(meta.scheduled || '')
    setManagementNotes(workOrderPlainNotes(nextRecord?.['Management Notes']))
    setResidentUpdate(String(nextRecord?.Update ?? ''))
    setResolutionSummary(String(nextRecord?.['Resolution Summary'] ?? ''))
  }

  const loadList = useCallback(async () => {
    if (!scopeLower.size) {
      setList([])
      setListLoading(false)
      setListError('')
      return
    }
    setListLoading(true)
    setListError('')
    try {
      const all = await getAllWorkOrders()
      setList(all.filter((row) => workOrderInScope(row, scopeLower)))
    } catch (err) {
      setList([])
      const msg = formatDataLoadError(err)
      setListError(msg)
      if (!isAirtablePermissionErrorMessage(err?.message)) toast.error('Work orders failed to load: ' + msg)
    } finally {
      setListLoading(false)
    }
  }, [scopeLower])

  useEffect(() => {
    loadList()
  }, [loadList])

  const filteredList = useMemo(() => {
    let rows = list
    if (quickFilter === 'open') rows = rows.filter((row) => !['Completed', 'Closed'].includes(managerWorkOrderStatusLabel(row)))
    if (quickFilter === 'urgent') rows = rows.filter((row) => ['urgent', 'emergency', 'critical'].includes(String(row.Priority || '').trim().toLowerCase()))
    if (quickFilter === 'scheduled') rows = rows.filter((row) => managerWorkOrderStatusLabel(row) === 'Scheduled')
    if (quickFilter === 'completed') rows = rows.filter((row) => ['Completed', 'Closed'].includes(managerWorkOrderStatusLabel(row)))
    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter((row) => {
        const haystack = `${workOrderPropertyLabel(row)} ${row['Room Number'] || ''} ${paymentResidentLabel(row)} ${row.Title || ''} ${row.Description || ''}`.toLowerCase()
        return haystack.includes(q)
      })
    }
    return [...rows].sort((a, b) => new Date(b['Date Submitted'] || b.created_at || 0) - new Date(a['Date Submitted'] || a.created_at || 0))
  }, [list, quickFilter, search])

  const openCount = useMemo(() => list.filter((row) => !['Completed', 'Closed'].includes(managerWorkOrderStatusLabel(row))).length, [list])
  const urgentCount = useMemo(() => list.filter((row) => ['urgent', 'emergency', 'critical'].includes(String(row.Priority || '').trim().toLowerCase())).length, [list])
  const scheduledCount = useMemo(() => list.filter((row) => managerWorkOrderStatusLabel(row) === 'Scheduled').length, [list])
  const completedCount = useMemo(() => list.filter((row) => ['Completed', 'Closed'].includes(managerWorkOrderStatusLabel(row))).length, [list])

  useEffect(() => {
    if (filteredList.length === 0) {
      setRecord(null)
      return
    }
    setRecord((current) => {
      if (current) {
        const match = filteredList.find((row) => row.id === current.id)
        if (match) return match
      }
      return filteredList[0]
    })
  }, [filteredList])

  useEffect(() => {
    if (!record?.id) return
    let cancelled = false
    setLoadError('')
    getWorkOrderById(record.id)
      .then((nextRecord) => {
        if (cancelled) return
        setRecord(nextRecord)
        applyRecordToForm(nextRecord)
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message || 'Could not load work order.')
      })
    return () => {
      cancelled = true
    }
  }, [record?.id])

  async function handleSave(event) {
    event.preventDefault()
    if (!record?.id) return
    setSaving(true)
    try {
      const resolved = status === 'Completed' || status === 'Closed'
      const fields = {
        Status: resolved ? 'Resolved' : status,
        Priority: priority,
        'Management Notes': mergeWorkOrderMetaBlock(managementNotes, {
          'assigned to': assignedTo,
          scheduled: scheduledAt,
        }),
        Update: residentUpdate || '',
        'Resolution Summary': resolutionSummary || '',
        Resolved: resolved,
        'Last Update': new Date().toISOString().slice(0, 10),
      }
      const nextRecord = await updateWorkOrder(record.id, fields)
      setRecord(nextRecord)
      applyRecordToForm(nextRecord)
      await loadList()
      toast.success('Work order saved')
    } catch (err) {
      toast.error(err.message || 'Could not save work order')
    } finally {
      setSaving(false)
    }
  }

  function handleMarkCompleted() {
    setStatus('Completed')
  }

  return (
    <div className="mb-10 space-y-5">
      <div>
        <h2 className="text-xl font-black text-slate-900">Work orders</h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Track open maintenance requests, update residents, and keep scheduling simple.
        </p>
      </div>

      {listError ? (
        <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-950">
          <div className="font-semibold text-amber-900">Could not load work orders</div>
          <p className="mt-2 text-amber-900/90">{listError}</p>
        </div>
      ) : null}

      {!scopeLower.size ? (
        <PortalOpsEmptyState
          icon="🏠"
          title="No linked houses yet"
          description="Work orders will appear here after a property is linked to this manager account."
        />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <PortalOpsMetric label="Open" value={openCount} hint="Needs review or action." tone="amber" />
        <PortalOpsMetric label="Urgent" value={urgentCount} hint="High-priority requests." tone="red" />
        <PortalOpsMetric label="Scheduled" value={scheduledCount} hint="A visit time is set." tone="axis" />
        <PortalOpsMetric label="Completed" value={completedCount} hint="Finished requests." tone="emerald" />
      </div>

      <PortalOpsFilterPills
        value={quickFilter}
        onChange={setQuickFilter}
        items={[
          { id: 'all', label: 'All', count: list.length },
          { id: 'open', label: 'Open', count: openCount },
          { id: 'urgent', label: 'Urgent', count: urgentCount },
          { id: 'scheduled', label: 'Scheduled', count: scheduledCount },
          { id: 'completed', label: 'Completed', count: completedCount },
        ]}
      />

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by property, resident, or issue…"
        className={fieldCls}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
        <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
          {listLoading ? (
            <div className="px-6 py-14 text-center text-sm text-slate-500">Loading work orders…</div>
          ) : filteredList.length === 0 ? (
            <div className="px-6 py-14 text-center text-sm text-slate-500">
              {list.length === 0 ? 'No work orders for your houses yet.' : 'Nothing matches this filter.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Property</th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Room</th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Resident</th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Title</th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Priority</th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Submitted</th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredList.map((row) => (
                    <tr
                      key={row.id}
                      onClick={() => setRecord(row)}
                      className={classNames('cursor-pointer transition hover:bg-slate-50', record?.id === row.id ? 'bg-axis/5' : '')}
                    >
                      <td className="px-4 py-4 text-sm font-semibold text-slate-900">{workOrderPropertyLabel(row) || 'House not set'}</td>
                      <td className="px-4 py-4 text-sm text-slate-600">{row['Room Number'] || row.Room || '—'}</td>
                      <td className="px-4 py-4 text-sm text-slate-600">{paymentResidentLabel(row)}</td>
                      <td className="px-4 py-4">
                        <div className="text-sm font-semibold text-slate-900">{row.Title || 'Untitled request'}</div>
                        <div className="mt-1 text-xs text-slate-400">{row.Category || 'General Maintenance'}</div>
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-600">{row.Priority || 'Normal'}</td>
                      <td className="px-4 py-4 text-sm text-slate-600">{fmtDate(row['Date Submitted'] || row.created_at)}</td>
                      <td className="px-4 py-4">
                        <PortalOpsStatusBadge tone={managerWorkOrderStatusTone(row)}>
                          {managerWorkOrderStatusLabel(row)}
                        </PortalOpsStatusBadge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {record ? (
          <PortalOpsCard
            title={record.Title || 'Work order'}
            description={`${workOrderPropertyLabel(record) || 'House not set'} · ${paymentResidentLabel(record)}`}
            action={
              <button
                type="button"
                onClick={handleMarkCompleted}
                className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100"
              >
                Mark Completed
              </button>
            }
          >
            {loadError ? (
              <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{loadError}</div>
            ) : null}

            <div className="mb-5 flex flex-wrap items-center gap-2">
              <PortalOpsStatusBadge tone={managerWorkOrderStatusTone(record)}>
                {managerWorkOrderStatusLabel(record)}
              </PortalOpsStatusBadge>
              <PortalOpsStatusBadge tone={['urgent', 'emergency', 'critical'].includes(String(record.Priority || '').trim().toLowerCase()) ? 'red' : 'slate'}>
                {record.Priority || 'Normal'}
              </PortalOpsStatusBadge>
            </div>

            <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-5 py-4">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Issue details</div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-700">{record.Description || 'No description provided.'}</p>
            </div>

            <form onSubmit={handleSave} className="mt-5 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Status</label>
                  <select value={status} onChange={(e) => setStatus(e.target.value)} className={fieldCls}>
                    {['Submitted', 'In Review', 'Scheduled', 'In Progress', 'Completed', 'Closed'].map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Priority</label>
                  <select value={priority} onChange={(e) => setPriority(e.target.value)} className={fieldCls}>
                    {priorityOptions.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Assign vendor / person</label>
                  <input value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className={fieldCls} placeholder="Axis maintenance team" />
                </div>
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Scheduled date / time</label>
                  <input value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className={fieldCls} placeholder="Apr 18, 10:00 AM" />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Internal note</label>
                <textarea rows={3} value={managementNotes} onChange={(e) => setManagementNotes(e.target.value)} className={fieldCls} placeholder="Notes only managers should see." />
              </div>

              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Resident-facing update</label>
                <textarea rows={3} value={residentUpdate} onChange={(e) => setResidentUpdate(e.target.value)} className={fieldCls} placeholder="We scheduled a visit for Friday morning." />
              </div>

              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Completion note</label>
                <textarea rows={3} value={resolutionSummary} onChange={(e) => setResolutionSummary(e.target.value)} className={fieldCls} placeholder="What was fixed and anything the resident should know." />
              </div>

              <button
                type="submit"
                disabled={saving}
                className="rounded-full bg-axis px-5 py-3 text-sm font-semibold text-white transition hover:brightness-105 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save Updates'}
              </button>
            </form>
          </PortalOpsCard>
        ) : (
          !listLoading && (
            <PortalOpsEmptyState
              icon="🧰"
              title="Select a work order"
              description="Choose a request from the table to update status, scheduling, and resident notes."
            />
          )
        )}
      </div>
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
  const [selectedId, setSelectedId] = useState('')

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

  const paymentRows = useMemo(
    () => rowsForSelectedMonth.map((row) => ({ ...row, __computedStatus: paymentComputedStatus(row) })),
    [rowsForSelectedMonth],
  )

  const totalExpected = useMemo(
    () => paymentRows.reduce((sum, row) => sum + paymentAmountDue(row), 0),
    [paymentRows],
  )
  const totalCollected = useMemo(
    () => paymentRows.reduce((sum, row) => sum + paymentAmountPaid(row), 0),
    [paymentRows],
  )
  const totalOutstanding = useMemo(
    () => paymentRows.reduce((sum, row) => sum + paymentBalanceDue(row), 0),
    [paymentRows],
  )
  const overdueResidents = useMemo(
    () => new Set(paymentRows.filter((row) => row.__computedStatus === 'overdue').map((row) => paymentResidentLabel(row))).size,
    [paymentRows],
  )

  const filteredForList = useMemo(() => {
    let list = paymentRows
    if (filter !== 'all') list = list.filter((row) => row.__computedStatus === filter)
    return [...list].sort((a, b) => {
      const propertyCmp = String(paymentPropertyLabel(a)).localeCompare(String(paymentPropertyLabel(b)), undefined, { sensitivity: 'base' })
      if (propertyCmp !== 0) return propertyCmp
      return comparePaymentByRoom(a, b)
    })
  }, [filter, paymentRows])

  useEffect(() => {
    if (filteredForList.length === 0) {
      setSelectedId('')
      return
    }
    setSelectedId((current) => (current && filteredForList.some((row) => row.id === current) ? current : filteredForList[0].id))
  }, [filteredForList])

  const selectedRow = useMemo(
    () => filteredForList.find((row) => row.id === selectedId) || paymentRows.find((row) => row.id === selectedId) || null,
    [filteredForList, paymentRows, selectedId],
  )

  const residentDetailRows = useMemo(() => {
    if (!selectedRow) return []
    const residentName = paymentResidentLabel(selectedRow)
    return rows
      .filter((row) => paymentResidentLabel(row) === residentName)
      .sort((a, b) => new Date(b['Due Date'] || b.created_at || 0) - new Date(a['Due Date'] || a.created_at || 0))
  }, [rows, selectedRow])

  const extraChargeRows = useMemo(
    () => residentDetailRows.filter((row) => getPaymentKind(row) === 'fee'),
    [residentDetailRows],
  )

  async function markPaid(id) {
    setBusy((b) => ({ ...b, [id]: true }))
    try {
      await updatePaymentRecord(id, {
        Status: 'Paid',
        'Paid Date': new Date().toISOString().slice(0, 10),
        'Amount Paid': paymentAmountDue(rows.find((row) => row.id === id) || {}),
        Balance: 0,
      })
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
            Track rent status by house, room, and resident. Keep the month view simple and easy to scan.
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
        </div>
      </div>

      <PortalOpsFilterPills
        value={filter}
        onChange={setFilter}
        items={[
          { id: 'all', label: 'All', count: paymentRows.length },
          { id: 'paid', label: 'Paid', count: paymentRows.filter((row) => row.__computedStatus === 'paid').length },
          { id: 'due_soon', label: 'Due Soon', count: paymentRows.filter((row) => row.__computedStatus === 'due_soon').length },
          { id: 'overdue', label: 'Overdue', count: paymentRows.filter((row) => row.__computedStatus === 'overdue').length },
          { id: 'partial', label: 'Partial', count: paymentRows.filter((row) => row.__computedStatus === 'partial').length },
        ]}
      />

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

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <PortalOpsMetric label="Expected this month" value={money(totalExpected)} hint={formatYmLong(selectedYm)} tone="axis" />
        <PortalOpsMetric label="Collected" value={money(totalCollected)} hint="Recorded as paid." tone="emerald" />
        <PortalOpsMetric label="Outstanding" value={money(totalOutstanding)} hint="Still not fully paid." tone="amber" />
        <PortalOpsMetric label="Overdue residents" value={overdueResidents} hint="Residents with past-due rent." tone="red" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
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
            <div className="overflow-x-auto">
              <table className="min-w-full text-left">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Property</th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Room</th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Resident</th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Monthly Rent</th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Amount Paid</th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Balance Due</th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Due Date</th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredForList.map((row) => {
                    const computed = row.__computedStatus
                    return (
                      <tr
                        key={row.id}
                        onClick={() => setSelectedId(row.id)}
                        className={classNames('cursor-pointer transition hover:bg-slate-50', selectedId === row.id ? 'bg-axis/5' : '')}
                      >
                        <td className="px-4 py-4 text-sm font-semibold text-slate-900">{paymentPropertyLabel(row) || 'House not set'}</td>
                        <td className="px-4 py-4 text-sm text-slate-600">{paymentRoomLabel(row)}</td>
                        <td className="px-4 py-4 text-sm text-slate-600">{paymentResidentLabel(row)}</td>
                        <td className="px-4 py-4 text-sm text-slate-600">{money(paymentAmountDue(row))}</td>
                        <td className="px-4 py-4 text-sm text-slate-600">{money(paymentAmountPaid(row))}</td>
                        <td className="px-4 py-4 text-sm text-slate-600">{money(paymentBalanceDue(row))}</td>
                        <td className="px-4 py-4 text-sm text-slate-600">{fmtDate(row['Due Date'])}</td>
                        <td className="px-4 py-4">
                          <PortalOpsStatusBadge tone={paymentStatusTone(computed)}>
                            {paymentStatusLabel(computed)}
                          </PortalOpsStatusBadge>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {selectedRow ? (
          <PortalOpsCard
            title={paymentResidentLabel(selectedRow)}
            description={`${paymentPropertyLabel(selectedRow) || 'House not set'} · ${paymentRoomLabel(selectedRow)}`}
            action={
              paymentComputedStatus(selectedRow) !== 'paid' ? (
                <button
                  type="button"
                  disabled={busy[selectedRow.id]}
                  onClick={() => markPaid(selectedRow.id)}
                  className="rounded-full bg-axis px-4 py-2 text-sm font-semibold text-white transition hover:brightness-105 disabled:opacity-50"
                >
                  {busy[selectedRow.id] ? 'Updating…' : 'Mark Paid'}
                </button>
              ) : null
            }
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <PortalOpsMetric label="Rent amount" value={money(paymentAmountDue(selectedRow))} hint={selectedRow.Month || 'Current billing period'} />
              <PortalOpsMetric label="Remaining balance" value={money(paymentBalanceDue(selectedRow))} hint={`Due ${fmtDate(selectedRow['Due Date'])}`} tone={paymentStatusTone(paymentComputedStatus(selectedRow))} />
            </div>

            <div className="mt-5">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Payment history</div>
              <div className="mt-3 space-y-3">
                {residentDetailRows.filter((row) => getPaymentKind(row) === 'rent').slice(0, 6).map((row) => {
                  const computed = paymentComputedStatus(row)
                  return (
                    <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-slate-200 px-4 py-4">
                      <div>
                        <div className="text-sm font-bold text-slate-900">{row.Month || 'Rent payment'}</div>
                        <div className="mt-1 text-sm text-slate-500">Due {fmtDate(row['Due Date'])}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-sm font-bold text-slate-900">{money(paymentBalanceDue(row))}</div>
                        <PortalOpsStatusBadge tone={paymentStatusTone(computed)}>
                          {paymentStatusLabel(computed)}
                        </PortalOpsStatusBadge>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="mt-5">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Fines & extra charges</div>
              {extraChargeRows.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">No extra charges for this resident.</p>
              ) : (
                <div className="mt-3 space-y-3">
                  {extraChargeRows.map((row) => (
                    <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-slate-200 px-4 py-4">
                      <div>
                        <div className="text-sm font-bold text-slate-900">{row.Month || row.Type || 'Extra charge'}</div>
                        <div className="mt-1 text-sm text-slate-500">{row.Notes || 'Additional charge'}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-sm font-bold text-slate-900">{money(paymentBalanceDue(row) || paymentAmountDue(row))}</div>
                        <PortalOpsStatusBadge tone={paymentStatusTone(paymentComputedStatus(row))}>
                          {paymentStatusLabel(paymentComputedStatus(row))}
                        </PortalOpsStatusBadge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </PortalOpsCard>
        ) : (
          !loading && (
            <PortalOpsEmptyState
              icon="💳"
              title="Select a resident payment"
              description="Choose a row to review balance, history, and extra charges."
            />
          )
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
    if (isManagerInternalPreview(manager)) {
      toast.error('Billing is not available in preview mode.')
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
          <ManagerInboxPage manager={manager} allowedPropertyNames={scopedPropertyOptions} />
        ) : dashView === 'calendar' ? (
          <ManagerCalendarPanel manager={manager} scopedPropertyNames={scopedPropertyOptions} />
        ) : dashView === 'dashboard' ? (
          <ManagerDashboardHomePanel
            approvedHouseCount={managerScope.approvedNames.size}
            stats={overviewStats}
            statsLoading={overviewStatsLoading}
            dataWarnings={overviewDataWarnings}
            onNavigate={setDashView}
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

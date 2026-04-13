// ─── Axis Manager Portal ──────────────────────────────────────────────────────
// Route: /manager
//
// This is the internal manager-only interface for reviewing, editing, and
// approving AI-generated lease drafts before they are visible to residents.
//
// Workflow enforced by this page:
//   Draft Generated → Under Review → (Changes Needed ↔ Under Review) → Published (+ SignForge) → Signed
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
import { eventFromSchedulingRow } from '../lib/calendarEventModel'
import ManagerInboxPage from '../components/manager-inbox/ManagerInboxPage'
import {
  getWorkOrderById,
  updateWorkOrder,
  getAllWorkOrders,
  getAllPaymentsRecords,
  updatePaymentRecord,
  createPaymentRecord,
  getResidentById,
  AIRTABLE_PAYMENTS_BASE_ID,
  createRoomRecord,
  uploadPropertyImage,
  propertyListingVisibleForMarketing,
  getAllPortalInternalThreadMessages,
  fetchInboxThreadStateMap,
  portalInboxAirtableConfigured,
  portalInboxThreadKeyFromRecord,
} from '../lib/airtable'
import {
  serializeManagerAddPropertyToAirtableFields,
  emptyRoomRow,
  emptyBathroomRow,
  emptyKitchenRow,
  emptyLaundryRow,
  emptySharedSpaceRow,
  adjustRoomAccessLabels,
  clampInt,
  MAX_ROOM_SLOTS,
  MAX_BATHROOM_SLOTS,
  MAX_KITCHEN_SLOTS,
  MAX_SHARED_SPACE_SLOTS,
  MAX_LAUNDRY_SLOTS,
  AMENITY_OPTIONS,
  PET_OPTIONS,
  PROPERTY_TYPE_OPTIONS,
  FURNISHED_OPTIONS,
  SHARED_SPACE_TYPE_OPTIONS,
  BATHROOM_TYPE_OPTIONS,
  KITCHEN_TYPE_OPTIONS,
  PROPERTIES_LEASING_META_KEYS,
  PROPERTIES_LEASING_PACKAGE_KEYS,
  PROPERTY_AIR,
  PROPERTY_EDIT_REQUEST_FIELD,
} from '../lib/managerPropertyFormAirtableMap.js'
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
import PortalShell, { DataTable, StatusPill } from '../components/PortalShell'
import Modal from '../components/Modal'
import AddPropertyWizard from '../components/AddPropertyWizard'
import { PropertyDetailPanel } from '../lib/propertyDetailPanel.jsx'
import { ApplicationDetailPanel, applicationViewModelFromAirtableRow } from '../lib/applicationDetailPanel.jsx'
import ManagerApplicationLease from '../components/ManagerApplicationLease.jsx'
import {
  PortalOpsCard,
  PortalOpsEmptyState,
  PortalOpsMetric,
  PortalOpsStatusBadge,
} from '../components/PortalOpsUI'
import {
  deriveApplicationApprovalState,
  applicationRejectedFieldName,
} from '../lib/applicationApprovalState.js'
import {
  loadAdminMeetingCalendarProfiles,
  updateAdminMeetingAvailability,
} from '../lib/adminPortalAirtable.js'

// ─── Session ──────────────────────────────────────────────────────────────────
export const MANAGER_SESSION_KEY = 'axis_manager'
const MANAGER_ONBOARDING_KEY = 'axis_manager_onboarding'

/** Pill toolbar controls — Calendar property picker matches Leases / Applications row */
const MANAGER_PILL_SELECT_WRAP_CLS = 'relative min-w-0 flex-1 sm:min-w-[220px] sm:flex-none'
const MANAGER_PILL_SELECT_CLS =
  'h-[42px] w-full min-w-0 cursor-pointer appearance-none rounded-full border border-slate-200 bg-white py-2.5 pl-4 pr-10 text-sm font-medium text-slate-800 transition focus:border-[#2563eb] focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400'
const MANAGER_PILL_SELECT_CHEVRON = (
  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden>
    ▾
  </span>
)
const MANAGER_PILL_REFRESH_CLS =
  'h-[42px] shrink-0 rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50'

// ─── Records API config — split by Airtable base to match the rest of the app ─
const AIRTABLE_TOKEN = import.meta.env.VITE_AIRTABLE_TOKEN
const CORE_BASE_ID = import.meta.env.VITE_AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const CORE_AIRTABLE_BASE_URL = `https://api.airtable.com/v0/${CORE_BASE_ID}`
const APPLICATIONS_TABLE_NAME =
  String(import.meta.env.VITE_AIRTABLE_APPLICATIONS_TABLE || 'Applications').trim() || 'Applications'

// ─── Lease status configuration ───────────────────────────────────────────────
// Each status has a color set used by StatusBadge and the stats row
const STATUS_CONFIG = {
  'Draft ready':     { bg: 'bg-amber-50',  text: 'text-amber-700',  border: 'border-amber-200',  dot: 'bg-amber-400'  },
  'Sent to resident':{ bg: 'bg-axis/5',    text: 'text-axis',       border: 'border-axis/20',    dot: 'bg-axis'       },
  'Draft Generated': { bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200',   dot: 'bg-blue-400'   },
  'Under Review':    { bg: 'bg-amber-50',  text: 'text-amber-700',  border: 'border-amber-200',  dot: 'bg-amber-400'  },
  'Changes Needed':  { bg: 'bg-red-50',    text: 'text-red-700',    border: 'border-red-200',    dot: 'bg-red-500'    },
  'Approved':        { bg: 'bg-green-50',  text: 'text-green-700',  border: 'border-green-200',  dot: 'bg-green-500'  },
  'Published':       { bg: 'bg-axis/5',    text: 'text-axis',       border: 'border-axis/20',    dot: 'bg-axis'       },
  'Signed':          { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', dot: 'bg-purple-500' },
}

const ALL_STATUSES = Object.keys(STATUS_CONFIG)
const LEASE_FLOW_CARDS = [
  {
    id: 'draft_ready',
    label: 'Draft Ready',
    match: (status) => ['Draft Generated', 'Under Review', 'Changes Needed', 'Approved'].includes(status),
    activeStatuses: ['Draft Generated', 'Under Review', 'Changes Needed', 'Approved'],
    cls: 'border-amber-200 bg-amber-50 text-amber-700',
  },
  {
    id: 'sent_to_resident',
    label: 'Sent to Resident',
    match: (status) => status === 'Published',
    activeStatuses: ['Published'],
    cls: 'border-axis/20 bg-axis/5 text-axis',
  },
  {
    id: 'signed',
    label: 'Signed',
    match: (status) => status === 'Signed',
    activeStatuses: ['Signed'],
    cls: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  },
]

function leaseDraftMatchesQueueFilter(status, filterValue) {
  const normalized = String(status || '').trim()
  if (!filterValue) return true
  if (filterValue === '__draft_ready__') {
    return ['Draft Generated', 'Under Review', 'Changes Needed', 'Approved'].includes(normalized)
  }
  if (filterValue === '__sent_to_resident__') return normalized === 'Published'
  if (filterValue === '__signed__') return normalized === 'Signed'
  return normalized === filterValue
}

function leaseUiStatusLabel(status) {
  const normalized = String(status || '').trim()
  if (['Draft Generated', 'Under Review', 'Changes Needed', 'Approved'].includes(normalized)) return 'Draft ready'
  if (normalized === 'Published') return 'Sent to resident'
  if (normalized === 'Signed') return 'Signed'
  return normalized || 'Draft ready'
}

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
  return String(p?.['Property Name'] || p?.Name || p?.Property || '').trim()
}

/** House visible in manager portal lists once Axis marks it approved / live. */
function isPropertyRecordApproved(p) {
  const s = String(p.Status || '').trim().toLowerCase()
  if (s === 'pending_review' || s === 'pending review') return false

  const a = String(p['Approval Status'] || '').trim().toLowerCase()
  /** Awaiting first admin review — must win over a stray Listed checkbox default in Airtable. */
  if (a === 'pending') return false
  if (a === 'rejected') return false

  if (p.Approved === true || p.Approved === 1) return true
  if (a === 'approved') return true
  if (s === 'approved' || s === 'live' || s === 'active') return true

  /** Legacy rows: Listed without workflow fields — treat as approved unless explicitly blocked above. */
  const listedRaw = p?.Listed
  const listed =
    listedRaw === true ||
    listedRaw === 1 ||
    listedRaw === '1' ||
    (typeof listedRaw === 'string' && listedRaw.trim().toLowerCase() === 'true')
  if (listed && p.Approved !== false) return true

  return false
}

function isPropertyRecordRejected(p) {
  const a = String(p?.['Approval Status'] || '').trim().toLowerCase()
  const s = String(p?.Status || '').trim().toLowerCase()
  return a === 'rejected' || s === 'rejected'
}

/** Admin used “Request edits” — manager must update and resubmit (listing stays off the public site). */
function propertyNeedsAdminEditRequest(p) {
  const a = String(p?.['Approval Status'] || '').trim().toLowerCase()
  return a === 'changes requested' || a === 'changes_requested'
}

function managerLinkArray(val) {
  if (Array.isArray(val)) return val.map(String)
  if (typeof val === 'string' && val.startsWith('rec')) return [val]
  return []
}

/**
 * Property must be assigned to this manager.
 *
 * Primary check: canonical Owner ID field (set during back-fill).
 * Fallback: legacy email / linked-record / Manager ID checks so records
 * that haven't been back-filled yet still work during migration.
 */
function propertyAssignedToManager(p, manager) {
  const recId = String(manager?.id || '').trim()

  // ── Primary: Owner ID field (post-migration) ──────────────────────────────
  const ownerId = String(p['Owner ID'] || '').trim()
  if (ownerId && recId && ownerId === recId) return true

  // ── Fallback: legacy checks (pre-migration records) ───────────────────────
  const email = String(manager?.email || '').trim().toLowerCase()
  const mid = String(manager?.managerId || '').trim()
  const emails = [
    String(p['Manager Email'] || '').trim().toLowerCase(),
    String(p['Site Manager Email'] || '').trim().toLowerCase(),
  ].filter(Boolean)
  if (email && emails.length && emails.includes(email)) return true
  for (const k of ['Manager Profile', 'Manager', 'Site Manager', 'Property Manager']) {
    const links = managerLinkArray(p[k])
    if (recId && links.includes(recId)) return true
  }
  const pid = String(p['Manager ID'] || '').trim()
  if (mid && pid && pid === mid) return true
  return false
}

/** Listed + on marketing (same bar as Properties → Listed); calendar availability / tour slots only for these. */
function propertyEligibleForManagerCalendarScheduling(p, manager) {
  return propertyAssignedToManager(p, manager) && propertyListingVisibleForMarketing(p)
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
  const assignedNames = new Set()
  const pendingAssigned = []
  if (isManagerInternalPreview(manager)) {
    for (const p of list) {
      const n = propertyRecordName(p)
      if (n) assignedNames.add(n)
      if (isPropertyRecordApproved(p) && n) {
        approvedNames.add(n)
      }
    }
    return { approvedNames, assignedNames, pendingAssigned: [] }
  }
  for (const p of list) {
    if (!propertyAssignedToManager(p, manager)) continue
    const n = propertyRecordName(p)
    if (n) assignedNames.add(n)
    if (isPropertyRecordApproved(p)) {
      if (n) approvedNames.add(n)
    } else {
      pendingAssigned.push(p)
    }
  }
  return { approvedNames, assignedNames, pendingAssigned }
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

/** Same rules as resident portal PaymentsPanel — rent vs fee/extra charges. */
function getPaymentKind(payment) {
  if (!payment) return 'rent'
  const raw = [payment.Type, payment.Category, payment.Kind, payment['Line Item Type'], payment.Month, payment.Notes]
    .filter(Boolean)
    .map((x) => String(x))
    .join(' ')
    .toLowerCase()
  if (/(fee|fine|damage|late fee|late charge|cleaning|lockout)/.test(raw)) return 'fee'
  return 'rent'
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
  return String(
    record?.['Resident Name'] ||
      record?.Name ||
      record?.['Resident profile'] ||
      record?.Resident ||
      '',
  ).trim() || 'Resident not set'
}

/** First linked Resident Profile record id from a Payments row, when present. */
function paymentResidentRecordId(record) {
  const raw = record?.Resident
  if (!Array.isArray(raw) || raw.length === 0) return ''
  const id = String(raw[0]).trim()
  return /^rec[a-zA-Z0-9]{14,}$/.test(id) ? id : ''
}

function paymentRoomLabel(record) {
  return formatPaymentRoomTitle(record)
}

/** Simplified manager-facing status: Open | In Progress | Completed */
function managerWorkOrderStatusLabel(record) {
  if (!record) return 'Open'
  if (workOrderIsResolvedRecord(record)) return 'Completed'
  const raw = String(record.Status || '').trim().toLowerCase()
  if (raw.includes('progress') || raw.includes('schedule')) return 'In Progress'
  return 'Open'
}

function managerWorkOrderStatusTone(record) {
  const label = managerWorkOrderStatusLabel(record)
  if (label === 'Completed') return 'emerald'
  if (label === 'In Progress') return 'axis'
  return 'slate'
}

/** Bucket for filter cards: separates scheduled vs in-progress work. */
function managerWorkOrderBucket(record) {
  if (!record) return 'open'
  if (workOrderIsResolvedRecord(record)) return 'completed'
  const raw = String(record.Status || '').trim().toLowerCase()
  if (raw.includes('schedule')) return 'scheduled'
  if (raw.includes('progress')) return 'in_progress'
  return 'open'
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

/** Availability editor window: 6:00 AM – 8:00 PM. */
const TOUR_GRID_START_HOUR = 6
const TOUR_GRID_END_HOUR = 20
const TOUR_GRID_STEP_MIN = 30
const TOUR_GRID_START_MIN = TOUR_GRID_START_HOUR * 60
const TOUR_GRID_END_MIN = TOUR_GRID_END_HOUR * 60
const TOUR_GRID_HALF_COUNT = Math.round((TOUR_GRID_END_MIN - TOUR_GRID_START_MIN) / TOUR_GRID_STEP_MIN)
const TIMELINE_HEIGHT_PX = 700

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
    for (const token of cal[d] || []) {
      const trimmed = String(token).trim()
      const pair = trimmed.match(/^(\d+)-(\d+)$/)
      if (pair) {
        const start = Number(pair[1])
        const end = Number(pair[2])
        if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
          for (const idx of halfHourIndicesOverlappingRange(start, end)) {
            set.add(idx)
          }
        }
        continue
      }
      const range = slotRangeMinutes(trimmed)
      if (!range) continue
      for (const idx of halfHourIndicesOverlappingRange(range.start, range.end)) {
        set.add(idx)
      }
    }
    o[d] = [...set].sort((a, b) => a - b)
  }
  return o
}

function extractNoteValue(notes, label) {
  const escaped = String(label || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = String(notes || '').match(new RegExp(`(?:^|\\n)${escaped}:\\s*(.+?)(?:\\n|$)`, 'i'))
  return match ? match[1].trim() : ''
}

function extractMultilineNoteValue(notes, label) {
  const escaped = String(label || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const startRe = new RegExp(`(?:^|\\n)${escaped}:\\s*`, 'i')
  const s = String(notes || '')
  const startMatch = s.match(startRe)
  if (!startMatch) return ''
  const after = s.slice(startMatch.index + startMatch[0].length)
  const stopMatch = after.match(/\n[A-Za-z][A-Za-z ]*:/)
  const block = stopMatch ? after.slice(0, stopMatch.index) : after
  return block.trim()
}

function buildTourNotesText(existingNotes, metadata) {
  const labels = ['Tour Manager', 'Tour Availability', 'Tour Notes']
  let stripped = String(existingNotes || '').trim()
  labels.forEach((label) => {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    stripped = stripped.replace(new RegExp(`(?:^|\\n)${escaped}:\\s*[\\s\\S]*?(?=(?:\\n[A-Za-z][A-Za-z ]*:)|$)`, 'gi'), '')
  })
  stripped = stripped.replace(/^\n+|\n+$/g, '').trim()

  const parts = []
  if (metadata.manager) parts.push(`Tour Manager: ${metadata.manager}`)
  if (metadata.availability) parts.push(`Tour Availability: ${metadata.availability}`)
  if (metadata.notes) parts.push(`Tour Notes: ${metadata.notes}`)
  if (stripped) parts.push(stripped)
  return parts.join('\n')
}

function encodeTourAvailabilityFromWeeklyFree(weeklyArrays) {
  const lines = []
  for (const day of TOUR_DAYS) {
    const ranges = timeRangesFromWeeklyFree(weeklyArrays, day)
    if (!ranges.length) continue
    const parts = ranges.map((r) => `${Math.round(r.start)}-${Math.round(r.end)}`)
    lines.push(`${day}: ${parts.join(', ')}`)
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
  const cap = Math.min(Math.max(0, minutes), 24 * 60)
  const safe = Math.min(cap, 23 * 60 + 59)
  const h = Math.floor(safe / 60)
  const m = safe % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function minutesFromInputValue(value, opts = {}) {
  const m = String(value || '').match(/^(\d{2}):(\d{2})$/)
  if (!m) return null
  const hh = Number(m[1])
  const mm = Number(m[2])
  if (opts.treat2359AsEndOfDay && hh === 23 && mm === 59) return 24 * 60
  return hh * 60 + mm
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
  const start = last ? Math.min(last.end + TOUR_GRID_STEP_MIN, 22 * 60) : 10 * 60
  const end = Math.min(start + 120, TOUR_GRID_END_MIN)
  return [...normalized, { start, end }]
}

function snapMinutesToGrid(minutes) {
  const s = Math.round(minutes / TOUR_GRID_STEP_MIN) * TOUR_GRID_STEP_MIN
  return Math.max(TOUR_GRID_START_MIN, Math.min(TOUR_GRID_END_MIN, s))
}

/** Drag or tap on a vertical day column to add availability (green blocks). */
function DayAvailabilityTimeline({ ranges, onRangesChange, disabled }) {
  const trackRef = useRef(null)
  const rangesRef = useRef(ranges)
  const [draft, setDraft] = useState(null)
  const [selectedIdx, setSelectedIdx] = useState(null)

  useEffect(() => {
    rangesRef.current = ranges
  }, [ranges])

  useEffect(() => {
    if (selectedIdx != null && selectedIdx >= ranges.length) setSelectedIdx(null)
  }, [ranges, selectedIdx])

  function minutesFromEvent(clientY) {
    const el = trackRef.current
    if (!el) return TOUR_GRID_START_MIN
    const rect = el.getBoundingClientRect()
    const t = (clientY - rect.top) / Math.max(rect.height, 1)
    const raw = TOUR_GRID_START_MIN + t * (TOUR_GRID_END_MIN - TOUR_GRID_START_MIN)
    return snapMinutesToGrid(raw)
  }

  function onTrackPointerDown(e) {
    if (disabled) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (e.target.closest('[data-availability-block]')) return
    e.preventDefault()
    setSelectedIdx(null)
    const start = minutesFromEvent(e.clientY)
    setDraft({ start, cur: start })

    function onMove(ev) {
      setDraft({ start, cur: minutesFromEvent(ev.clientY) })
    }
    function onUp(ev) {
      const endMin = minutesFromEvent(ev.clientY)
      let lo = Math.min(start, endMin)
      let hi = Math.max(start, endMin)
      // Treat tap/click as a request to add one grid slot.
      if (hi - lo < TOUR_GRID_STEP_MIN) {
        lo = Math.min(lo, TOUR_GRID_END_MIN - TOUR_GRID_STEP_MIN)
        hi = lo + TOUR_GRID_STEP_MIN
      }
      if (hi - lo >= TOUR_GRID_STEP_MIN) {
        onRangesChange(normalizeTimeRanges([...rangesRef.current, { start: lo, end: hi }]))
      }
      setDraft(null)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  const previewRange =
    draft && Math.abs(draft.cur - draft.start) >= TOUR_GRID_STEP_MIN
      ? { start: Math.min(draft.start, draft.cur), end: Math.max(draft.start, draft.cur) }
      : null

  const timelineHours = Array.from(
    { length: TOUR_GRID_END_HOUR - TOUR_GRID_START_HOUR + 1 },
    (_, idx) => TOUR_GRID_START_HOUR + idx,
  )
  const totalHours = TOUR_GRID_END_HOUR - TOUR_GRID_START_HOUR

  return (
    <div>
      <div className="grid grid-cols-[52px_minmax(0,1fr)] gap-2">
        <div className="relative" style={{ height: TIMELINE_HEIGHT_PX }}>
          {timelineHours.map((hour) => {
            const top = ((hour - TOUR_GRID_START_HOUR) / totalHours) * TIMELINE_HEIGHT_PX
            return (
              <div
                key={hour}
                className="absolute right-1 -translate-y-1/2 text-[10px] font-semibold tabular-nums text-slate-400"
                style={{ top }}
              >
                {displayTimeFromMinutes(hour * 60)}
              </div>
            )
          })}
        </div>
        <div
          ref={trackRef}
          role="application"
          aria-label="Availability timeline, drag to add time ranges"
          onPointerDown={onTrackPointerDown}
          className={classNames(
            'relative rounded-2xl border border-slate-200 bg-white select-none touch-none',
            disabled ? 'cursor-not-allowed opacity-50' : 'cursor-crosshair',
          )}
          style={{ height: TIMELINE_HEIGHT_PX }}
        >
          {Array.from({ length: totalHours + 1 }, (_, h) => (
            <div
              key={h}
              className="pointer-events-none absolute left-0 right-0 border-t border-slate-100"
              style={{ top: `${(h / totalHours) * 100}%` }}
            />
          ))}
          {ranges.map((range, idx) => (
            <button
              key={`${range.start}-${range.end}-${idx}`}
              type="button"
              data-availability-block
              onClick={(e) => {
                e.stopPropagation()
                setSelectedIdx(selectedIdx === idx ? null : idx)
              }}
              className={classNames(
                'absolute left-2 right-2 rounded-xl border px-2 py-1.5 text-left text-xs font-semibold shadow-sm transition',
                selectedIdx === idx
                  ? 'z-20 border-emerald-600 bg-emerald-200/95 text-emerald-950 ring-2 ring-emerald-500/40'
                  : 'z-10 border-emerald-300 bg-emerald-100/95 text-emerald-900 hover:bg-emerald-200/80',
              )}
              style={timelineBlockStyle(range.start, range.end)}
            >
              {formatTimeRangeLabel(range)}
            </button>
          ))}
          {previewRange ? (
            <div
              className="pointer-events-none absolute left-2 right-2 z-[5] rounded-xl border border-dashed border-emerald-500/60 bg-emerald-200/40"
              style={timelineBlockStyle(previewRange.start, previewRange.end)}
            />
          ) : null}
        </div>
      </div>

      {selectedIdx != null && ranges[selectedIdx] ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Edit block</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-slate-600">Start</label>
              <input
                type="time"
                step={1800}
                value={inputValueFromMinutes(ranges[selectedIdx].start)}
                disabled={disabled}
                onChange={(e) => {
                  const m = minutesFromInputValue(e.target.value)
                  if (m == null) return
                  const next = [...ranges]
                  const cur = next[selectedIdx]
                  const end = Math.max(cur.end, m + TOUR_GRID_STEP_MIN)
                  next[selectedIdx] = { start: m, end: end }
                  onRangesChange(normalizeTimeRanges(next))
                }}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              />
            </div>
            <span className="hidden text-center text-sm font-semibold text-slate-400 sm:block">to</span>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-slate-600">End</label>
              <input
                type="time"
                step={1800}
                value={inputValueFromMinutes(ranges[selectedIdx].end)}
                disabled={disabled}
                onChange={(e) => {
                  const m = minutesFromInputValue(e.target.value, { treat2359AsEndOfDay: true })
                  if (m == null) return
                  const next = [...ranges]
                  const cur = next[selectedIdx]
                  if (m <= cur.start) return
                  next[selectedIdx] = { start: cur.start, end: m }
                  onRangesChange(normalizeTimeRanges(next))
                }}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              />
            </div>
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              onRangesChange(ranges.filter((_, i) => i !== selectedIdx))
              setSelectedIdx(null)
            }}
            className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-40"
          >
            Remove block
          </button>
        </div>
      ) : null}
    </div>
  )
}

function bookingBadgeTone(row) {
  const type = String(row.Type || '').trim().toLowerCase()
  const approval = String(row['Manager Approval'] || '').trim().toLowerCase()
  if (type === 'work order') return 'bg-amber-50 text-amber-900 border-amber-200'
  if (type === 'issue' || type === 'other') return 'bg-slate-100 text-slate-700 border-slate-200'
  if (type === 'meeting') return 'bg-violet-50 text-violet-800 border-violet-200'
  if (approval === 'approved') return 'bg-emerald-50 text-emerald-800 border-emerald-200'
  if (approval === 'declined') return 'bg-red-50 text-red-700 border-red-200'
  return 'bg-sky-50 text-sky-800 border-sky-200'
}

function bookingLabel(row) {
  const type = String(row.Type || '').trim().toLowerCase()
  if (type === 'meeting') return 'Meeting'
  if (type === 'work order') return 'Work order'
  if (type === 'issue' || type === 'other') return 'Issue'
  return 'Booked tour'
}

function parsePreferredTimeRange(preferredTime) {
  const parts = String(preferredTime || '')
    .split('-')
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length !== 2) return null
  const parseLabel = (value) => {
    const match = String(value).match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i)
    if (!match) return null
    let hour = Number(match[1]) % 12
    const minute = Number(match[2] || '0')
    const meridiem = String(match[3] || '').toUpperCase()
    if (meridiem === 'PM') hour += 12
    return hour * 60 + minute
  }
  const start = parseLabel(parts[0])
  const end = parseLabel(parts[1])
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  return {
    start: Math.max(TOUR_GRID_START_MIN, start),
    end: Math.min(TOUR_GRID_END_MIN, end),
  }
}

function timelineBlockStyle(start, end) {
  const total = TOUR_GRID_END_MIN - TOUR_GRID_START_MIN
  const safeStart = Math.max(TOUR_GRID_START_MIN, Math.min(TOUR_GRID_END_MIN, start))
  const safeEnd = Math.max(safeStart, Math.min(TOUR_GRID_END_MIN, end))
  return {
    top: `${((safeStart - TOUR_GRID_START_MIN) / total) * 100}%`,
    height: `${Math.max(((safeEnd - safeStart) / total) * 100, 2)}%`,
  }
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
        No hours set for this day
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

function AvailabilityCalendar({ view, anchorDate, selectedDateKey, onSelectDate, weeklyFree, bookedByDate }) {
  const y = anchorDate.getFullYear()
  const m = anchorDate.getMonth()
  const daysInMonth = new Date(y, m + 1, 0).getDate()
  const firstDow = new Date(y, m, 1).getDay()
  const todayKey = dateKeyFromDate(new Date())
  const weekStart = startOfWeekSunday(anchorDate)
  const weekDays = Array.from({ length: 7 }, (_, i) => addDaysDate(weekStart, i))

  const dayRanges = (key) => {
    if (view !== 'day' && key !== selectedDateKey) return []
    return timeRangesFromWeeklyFree(weeklyFree, weekdayAbbrFromDateKey(key))
  }
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
          'min-h-[154px] rounded-3xl border p-4 text-left transition',
          selected ? 'border-[#2563eb] bg-[#2563eb]/5 ring-2 ring-[#2563eb]/20' : 'border-slate-200 bg-slate-50/70 hover:bg-white',
          dateKey === todayKey ? 'ring-1 ring-slate-300' : '',
        )}
      >
        <div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{dayLabel}</div>
            <div className="mt-1 text-lg font-black text-slate-900">{dateLabel}</div>
          </div>
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
        </div>
      </button>
    )
  }

  if (view === 'day') {
    const dateKey = dateKeyFromDate(anchorDate)
    const ranges = dayRanges(dateKey)
    const dayBookings = bookings(dateKey)
    const timelineHours = Array.from(
      { length: TOUR_GRID_END_HOUR - TOUR_GRID_START_HOUR + 1 },
      (_, idx) => TOUR_GRID_START_HOUR + idx,
    )
    const totalHours = TOUR_GRID_END_HOUR - TOUR_GRID_START_HOUR
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
          <div className="grid grid-cols-[52px_minmax(0,1fr)] gap-2">
            <div className="relative" style={{ height: TIMELINE_HEIGHT_PX }}>
              {timelineHours.map((hour) => {
                const top = `${((hour - TOUR_GRID_START_HOUR) / totalHours) * 100}%`
                return (
                  <div key={hour} className="absolute left-0 right-0 -translate-y-1/2 text-[10px] font-semibold tabular-nums text-slate-400" style={{ top }}>
                    {displayTimeFromMinutes(hour * 60)}
                  </div>
                )
              })}
            </div>
            <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white" style={{ height: TIMELINE_HEIGHT_PX }}>
              {Array.from({ length: totalHours + 1 }, (_, h) => (
                <div
                  key={`line-${h}`}
                  className="absolute left-0 right-0 border-t border-dashed border-slate-200"
                  style={{ top: `${(h / totalHours) * 100}%` }}
                />
              ))}
              {ranges.map((range) => (
                <div
                  key={`avail-${range.start}-${range.end}`}
                  className="absolute left-3 right-3 rounded-2xl bg-emerald-100/90 px-4 py-3 text-sm font-semibold text-emerald-900 shadow-sm ring-1 ring-emerald-200"
                  style={timelineBlockStyle(range.start, range.end)}
                >
                  {formatTimeRangeLabel(range)}
                </div>
              ))}
              {dayBookings.map((row, idx) => {
                const parsed = parsePreferredTimeRange(row['Preferred Time'])
                if (!parsed) return null
                return (
                  <div
                    key={row.id}
                    className={`absolute rounded-2xl border px-3 py-2 text-sm shadow-sm ${bookingBadgeTone(row)}`}
                    style={{
                      ...timelineBlockStyle(parsed.start, parsed.end),
                      left: idx % 2 === 0 ? '0.75rem' : '50%',
                      right: idx % 2 === 0 ? '50%' : '0.75rem',
                    }}
                  >
                    <div className="font-semibold">{bookingLabel(row)}</div>
                    <div className="mt-1 text-xs opacity-80">
                      {[row.Name || 'Guest', row['Preferred Time'], row.Property].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                )
              })}
              {!ranges.length && !dayBookings.length ? (
                <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-slate-500">
                  No availability or scheduled items for this date yet
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (view === 'week') {
    return (
      <div className="flex flex-col gap-3">
        {weekDays.map((day) => renderDayCard(
          dateKeyFromDate(day),
          day.toLocaleDateString('en-US', { weekday: 'long' }),
          day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        ))}
      </div>
    )
  }

  const cells = []
  for (let i = 0; i < firstDow; i += 1) cells.push(null)
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(day)

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
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
  onRangesChange,
  onSave,
  onClearDay,
  scheduledItems,
  availSaving,
  manager,
  propertyOptions,
  selectedPropertyId,
  onSelectProperty,
  calendarMode = 'manager',
}) {
  const isAdminCalendar = calendarMode === 'admin'
  const hasApprovedPick = Array.isArray(propertyOptions) && propertyOptions.length > 0
  const disabled = availSaving || isManagerInternalPreview(manager) || !selectedPropertyId

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm lg:sticky lg:top-6">
      <h2 className="text-xl font-black text-slate-900">Availability editor</h2>
      <label className="mt-4 block text-xs font-semibold text-slate-700">
        {isAdminCalendar ? 'Admin profile' : 'Property'}
        <span className="font-normal text-slate-400">{isAdminCalendar ? ' (meeting calendar)' : ' (listed only)'}</span>
        <div className={`${MANAGER_PILL_SELECT_WRAP_CLS} mt-1.5 max-w-full`}>
          <select
            value={selectedPropertyId}
            onChange={(e) => onSelectProperty(e.target.value)}
            disabled={!hasApprovedPick}
            className={MANAGER_PILL_SELECT_CLS}
          >
            {!hasApprovedPick ? (
              <option value="">{isAdminCalendar ? 'No enabled admins' : 'No listed properties'}</option>
            ) : (
              propertyOptions.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))
            )}
          </select>
          {MANAGER_PILL_SELECT_CHEVRON}
        </div>
      </label>

      {isManagerInternalPreview(manager) ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {manager.__axisDeveloper
            ? 'Developer preview: availability edits are disabled'
            : 'Internal preview: availability edits are disabled (no linked manager profile)'}
        </div>
      ) : null}

      {hasApprovedPick && !selectedPropertyId ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {isAdminCalendar ? 'Select an admin profile to add availability blocks.' : 'Select a property to add availability blocks.'}
        </div>
      ) : null}

      <div className="mt-6">
        <DayAvailabilityTimeline ranges={ranges} onRangesChange={onRangesChange} disabled={disabled} />
      </div>

      <div className="mt-6">
        <div className="mb-3 text-sm font-bold text-slate-900">Items on this date</div>
        {scheduledItems?.length ? (
          <div className="space-y-2">
            {scheduledItems.map((item) => (
              <div
                key={item.id}
                className={`rounded-2xl border px-3 py-3 text-sm ${bookingBadgeTone(item)}`}
              >
                <div className="font-semibold">{bookingLabel(item)}</div>
                <div className="mt-1 text-xs opacity-80">
                  {[item.Name || 'Guest', item['Preferred Time'], item.Property].filter(Boolean).join(' · ')}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
            Nothing scheduled for this date.
          </div>
        )}
      </div>

      <div className="mt-6 flex flex-wrap gap-2 text-sm">
        <button
          type="button"
          onClick={onClearDay}
          disabled={availSaving || isManagerInternalPreview(manager) || !hasApprovedPick}
          className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 font-semibold text-red-700 hover:bg-red-100 disabled:opacity-40"
        >
          Clear day
        </button>
      </div>

      <div className="mt-6">
        <button
          type="button"
          onClick={onSave}
          disabled={availSaving || isManagerInternalPreview(manager) || !hasApprovedPick}
          className="w-full rounded-2xl bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] px-4 py-3 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(37,99,235,0.22)] disabled:opacity-50"
        >
          {availSaving ? 'Saving…' : 'Save availability'}
        </button>
      </div>
    </div>
  )
}

function LetUsMeetModal({ open, initialDateKey, manager, onClose, onCreated, approvedPropertyNames = [] }) {
  const [date, setDate] = useState(initialDateKey)
  const [itemType, setItemType] = useState('Meeting')
  const [property, setProperty] = useState('')
  const [startTime, setStartTime] = useState('10:00')
  const [endTime, setEndTime] = useState('11:00')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const canScheduleTours = Array.isArray(approvedPropertyNames) && approvedPropertyNames.length > 0

  useEffect(() => {
    if (!open) return
    setDate(initialDateKey)
    setItemType('Meeting')
    setProperty('')
    setStartTime('10:00')
    setEndTime('11:00')
    setNotes('')
    setSaving(false)
    setError('')
  }, [open, initialDateKey])

  useEffect(() => {
    if (!open) return
    if (itemType === 'Tour' && !canScheduleTours) setItemType('Meeting')
  }, [open, itemType, canScheduleTours])

  if (!open) return null

  async function handleSave() {
    setError('')
    const startMinutes = minutesFromInputValue(startTime)
    const endMinutes = minutesFromInputValue(endTime)
    if (!date || startMinutes == null || endMinutes == null || endMinutes <= startMinutes) {
      setError('Choose a valid date and time range.')
      return
    }
    if (itemType === 'Tour') {
      if (!canScheduleTours) {
        setError('You need at least one listed property before scheduling a tour.')
        return
      }
      if (!String(property || '').trim()) {
        setError('Select a property for this tour.')
        return
      }
    }

    setSaving(true)
    try {
      const res = await fetch('/api/forms?action=tour', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: manager?.name || 'Axis manager',
          email: manager?.email || 'manager@axis.invalid',
          type: itemType,
          property: property || '',
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
        <h3 className="mt-2 text-2xl font-black text-slate-900">Quick schedule item</h3>
        <p className="mt-2 text-sm text-slate-500">Create a one-off tour, meeting, work order visit, or issue reminder for this day</p>
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-slate-700">Type</label>
          <div className={MANAGER_PILL_SELECT_WRAP_CLS}>
            <select value={itemType} onChange={(e) => setItemType(e.target.value)} className={MANAGER_PILL_SELECT_CLS}>
              <option value="Meeting">Meeting</option>
              {canScheduleTours ? <option value="Tour">Tour</option> : null}
              <option value="Work Order">Work Order</option>
              <option value="Issue">Issue</option>
            </select>
            {MANAGER_PILL_SELECT_CHEVRON}
          </div>
          {!canScheduleTours ? (
            <p className="mt-1.5 text-xs text-slate-500">Tours require a listed property (Properties → Listed).</p>
          ) : null}
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-slate-700">Date</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={portalAuthInputCls} />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-xs font-semibold text-slate-700">Property</label>
          <div className={MANAGER_PILL_SELECT_WRAP_CLS + ' max-w-full sm:max-w-md'}>
            <select
              value={property}
              onChange={(e) => setProperty(e.target.value)}
              disabled={!canScheduleTours}
              className={MANAGER_PILL_SELECT_CLS}
            >
              {!canScheduleTours ? (
                <option value="">No approved properties</option>
              ) : (
                <>
                  <option value="">{itemType === 'Tour' ? 'Select property…' : 'Optional — select property'}</option>
                  {approvedPropertyNames.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </>
              )}
            </select>
            {MANAGER_PILL_SELECT_CHEVRON}
          </div>
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
        <PortalPrimaryButton
          type="button"
          onClick={handleSave}
          disabled={
            saving ||
            (itemType === 'Tour' && canScheduleTours && !String(property || '').trim())
          }
        >
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
      // Airtable returns errors in two shapes:
      //   { error: { type, message } }          — nested object
      //   { error: "TYPE", message: "..." }     — flat (used by some endpoints)
      if (parsed?.error?.message) throw new Error(parsed.error.message)
      if (typeof parsed?.message === 'string') throw new Error(parsed.message)
    } catch (e) {
      if (e instanceof SyntaxError) {
        // body was not JSON — fall through
      } else {
        throw e
      }
    }
    throw new Error(body.slice(0, 400))
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

/** Full list for manager calendar (Airtable returns max ~100 rows per request without pagination). */
async function fetchAllLeaseDraftsForCalendar() {
  const rows = []
  let offset = null
  do {
    const url = new URL(`${CORE_AIRTABLE_BASE_URL}/Lease%20Drafts`)
    url.searchParams.set('sort[0][field]', 'Updated At')
    url.searchParams.set('sort[0][direction]', 'desc')
    if (offset) url.searchParams.set('offset', offset)
    const data = await atRequest(url.toString())
    for (const r of data.records || []) rows.push(mapRecord(r))
    offset = data.offset || null
  } while (offset)
  return rows
}

// ─── Applications data layer ──────────────────────────────────────────────────
async function fetchApplications({ property } = {}) {
  const url = new URL(`${CORE_AIRTABLE_BASE_URL}/${encodeURIComponent(APPLICATIONS_TABLE_NAME)}`)
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
  const data = await atRequest(
    `${CORE_AIRTABLE_BASE_URL}/${encodeURIComponent(APPLICATIONS_TABLE_NAME)}/${recordId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ fields, typecast: true }),
    },
  )
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

function buildManagerListingPatch(property, listed) {
  const nextListed = listed === true
  /**
   * Airtable often omits unchecked checkbox fields from GET responses, so
   * `hasOwnProperty(property, 'Listed')` is false even when the column exists.
   * Skipping `Listed` on PATCH left the box false and relist appeared to do nothing.
   * Optional axis columns are still only written when present on the row (unknown-field safe).
   */
  const patch = {
    Listed: nextListed,
    'Approval Status': nextListed ? 'Approved' : 'Unlisted',
  }
  if (Object.prototype.hasOwnProperty.call(property || {}, 'Axis Admin Listing Status')) {
    patch['Axis Admin Listing Status'] = nextListed ? 'Live' : 'Unlisted'
  }
  if (Object.prototype.hasOwnProperty.call(property || {}, 'Admin Listing Status')) {
    patch['Admin Listing Status'] = nextListed ? 'Live' : 'Unlisted'
  }
  return patch
}

async function createPropertyAdmin(fields) {
  const data = await atRequest(`${CORE_AIRTABLE_BASE_URL}/Properties`, {
    method: 'POST',
    body: JSON.stringify({ fields, typecast: true }),
  })
  return mapRecord(data)
}

async function deletePropertyAdmin(recordId) {
  const res = await fetch(`${CORE_AIRTABLE_BASE_URL}/Properties/${recordId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${AIRTABLE_TOKEN}`,
      'Content-Type': 'application/json',
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    let msg = `Delete failed: ${res.status}`
    try { msg = JSON.parse(body)?.error?.message || msg } catch { /* ignore */ }
    throw new Error(msg)
  }
  return res.json()
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
  const rows = []
  let offset = null
  do {
    const url = new URL(`${CORE_AIRTABLE_BASE_URL}/Scheduling`)
    url.searchParams.set('sort[0][field]', 'Preferred Date')
    url.searchParams.set('sort[0][direction]', 'desc')
    if (offset) url.searchParams.set('offset', offset)
    const data = await atRequest(url.toString())
    for (const record of data.records || []) rows.push(mapRecord(record))
    offset = data.offset || null
  } while (offset)
  const em = String(managerEmail || '').trim().toLowerCase()
  const props = (propertyNames || []).map((p) => String(p).trim().toLowerCase()).filter(Boolean)
  return rows.filter((r) => {
    const rme = String(r['Manager Email'] || '').trim().toLowerCase()
    if (em && rme === em) return true
    const prop = String(r.Property || '').trim().toLowerCase()
    if (!prop || !props.length) return false
    return props.some((pn) => prop === pn || prop.includes(pn) || pn.includes(prop))
  })
}

/** All Scheduling rows (admin calendar — paginated, no manager/property filter). */
async function fetchAllSchedulingRows() {
  const rows = []
  let offset = null
  do {
    const url = new URL(`${CORE_AIRTABLE_BASE_URL}/Scheduling`)
    url.searchParams.set('sort[0][field]', 'Preferred Date')
    url.searchParams.set('sort[0][direction]', 'desc')
    if (offset) url.searchParams.set('offset', offset)
    const data = await atRequest(url.toString())
    for (const record of data.records || []) rows.push(mapRecord(record))
    offset = data.offset || null
  } while (offset)
  return rows
}

function workOrderScheduledMeta(record) {
  const rec = record || {}
  const meta = parseWorkOrderMetaBlock(rec['Management Notes'] || '')

  const normalizeDateKey = (value) => {
    const raw = String(value || '').trim()
    if (!raw) return ''
    const iso = raw.match(/(\d{4}-\d{2}-\d{2})/)
    if (iso) return iso[1]
    const us = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)
    if (us) {
      const month = Number(us[1])
      const day = Number(us[2])
      let year = Number(us[3])
      if (year < 100) year += year >= 70 ? 1900 : 2000
      if (!Number.isFinite(month) || !Number.isFinite(day) || !Number.isFinite(year)) return ''
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    }
    const parsed = new Date(raw)
    if (Number.isNaN(parsed.getTime())) return ''
    return parsed.toISOString().slice(0, 10)
  }

  const parseClockToMinutes = (value) => {
    const m = String(value || '')
      .trim()
      .toUpperCase()
      .match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/)
    if (!m) return null
    let h = Number(m[1]) % 12
    const min = Number(m[2] || '0')
    if (!Number.isFinite(h) || !Number.isFinite(min) || min < 0 || min > 59) return null
    if (m[3] === 'PM') h += 12
    return h * 60 + min
  }

  const formatClock = (minutes) => {
    const total = Number(minutes)
    if (!Number.isFinite(total)) return ''
    const h24 = Math.floor(total / 60)
    const min = total % 60
    let h12 = h24 % 12
    if (h12 === 0) h12 = 12
    const ap = h24 >= 12 ? 'PM' : 'AM'
    return `${h12}:${String(min).padStart(2, '0')} ${ap}`
  }

  const normalizeRange = (value) => {
    const raw = String(value || '').trim()
    if (!raw) return ''
    const pair = raw.match(/^(\d+)-(\d+)$/)
    if (pair) {
      const start = Number(pair[1])
      const end = Number(pair[2])
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
        return `${formatClock(start)} - ${formatClock(end)}`
      }
    }
    const joined = raw.replace(/\s+to\s+/i, ' - ')
    const parts = joined
      .split(/\s*[-–]\s*/)
      .map((part) => part.trim())
      .filter(Boolean)
    if (parts.length === 2) {
      const start = parseClockToMinutes(parts[0])
      const end = parseClockToMinutes(parts[1])
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
        return `${formatClock(start)} - ${formatClock(end)}`
      }
    }
    const single = parseClockToMinutes(raw)
    if (Number.isFinite(single)) {
      return `${formatClock(single)} - ${formatClock(single + 60)}`
    }
    return ''
  }

  const dateCandidates = [
    rec['Scheduled Date'],
    rec['Schedule Date'],
    rec['Visit Date'],
    rec['Appointment Date'],
    rec['Work Date'],
    rec['Scheduled For'],
    meta['scheduled date'],
    meta.date,
    meta.scheduled,
  ]
  const timeCandidates = [
    rec['Scheduled Time'],
    rec['Schedule Time'],
    rec['Visit Time'],
    rec['Appointment Time'],
    rec['Time Window'],
    rec['Scheduled Window'],
    rec['Scheduled For'],
    meta['scheduled time'],
    meta.window,
    meta.time,
    meta.scheduled,
  ]

  let date = ''
  for (const candidate of dateCandidates) {
    const key = normalizeDateKey(candidate)
    if (key) {
      date = key
      break
    }
  }

  let preferredTime = ''
  for (const candidate of timeCandidates) {
    const range = normalizeRange(candidate)
    if (range) {
      preferredTime = range
      break
    }
  }

  if (!date) return null
  return { date, preferredTime }
}

function workOrdersToCalendarRows(workOrders, allowedPropertyNamesLower) {
  const rows = []
  for (const workOrder of workOrders || []) {
    const scheduled = workOrderScheduledMeta(workOrder)
    if (!scheduled) continue
    const property = String(workOrder.Property || workOrder.House || '').trim()
    const lowerProperty = property.toLowerCase()
    if (allowedPropertyNamesLower?.size && lowerProperty && !allowedPropertyNamesLower.has(lowerProperty)) {
      continue
    }
    rows.push({
      id: `wo:${workOrder.id}`,
      Type: 'Work Order',
      Name: String(workOrder.Title || 'Work order').trim(),
      Property: property,
      Status: String(workOrder.Status || '').trim(),
      'Preferred Date': scheduled.date,
      'Preferred Time': scheduled.preferredTime,
      _workOrder: workOrder,
    })
  }
  return rows
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

/** Airtable sometimes returns linked/rich values as objects or arrays — never pass those raw to React text nodes. */
function safePortalText(value, fallback = '') {
  if (value == null || value === '') return fallback
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    const parts = value.map((v) => safePortalText(v, '')).filter(Boolean)
    return parts.length ? parts.join(' ') : fallback
  }
  if (typeof value === 'object') {
    if (typeof value.text === 'string') return value.text
    if (typeof value.name === 'string') return value.name
  }
  return fallback
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

/** Matches admin portal property toolbar buttons (`AdminPortal.jsx`). */
const MANAGER_PROP_TOOLBAR_BTN =
  'rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold shadow-sm transition hover:bg-slate-50 disabled:opacity-50'

function managerPropertySectionTableStatus(section) {
  switch (section) {
    case 'pending':
      return { label: 'Pending approval', tone: 'amber' }
    case 'rejected':
      return { label: 'Rejected', tone: 'red' }
    case 'request_change':
      return { label: 'Changes requested', tone: 'violet' }
    case 'listed':
      return { label: 'Live', tone: 'green' }
    case 'unlisted':
      return { label: 'Unlisted', tone: 'violet' }
    default:
      return { label: 'Property', tone: 'slate' }
  }
}

function managerPropertyToDetailPanelModel(p) {
  const name = propertyRecordName(p) || 'Untitled house'
  const statusRaw = String(p['Approval Status'] || p.Status || '—').trim()
  const statusDisplay = statusRaw ? statusRaw.replace(/_/g, ' ').toUpperCase() : '—'
  return {
    id: p.id,
    name,
    address: p.Address || '—',
    status: statusDisplay,
    description: String(p.Description || '').trim() || String(p['Other Info'] || '').trim(),
    _airtable: p,
  }
}

function HouseManagementPanel({ manager, onPropertiesChange }) {
  const [properties, setProperties] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editingPropertyId, setEditingPropertyId] = useState(null)
  const [detailsPropertyId, setDetailsPropertyId] = useState(null)
  const [deletingPropertyId, setDeletingPropertyId] = useState(null)
  const [listingBusyPropertyId, setListingBusyPropertyId] = useState(null)
  const [addOpen, setAddOpen] = useState(false)
  const [propertiesSection, setPropertiesSection] = useState('pending')
  const [tourForm, setTourForm] = useState({
    propertyName: '',
    address: '',
    propertyType: '',
    pets: '',
    amenities: [],
    securityDeposit: '',
    utilitiesFee: '',
    applicationFee: '',
    otherInfo: '',
    roomCount: 1,
    rooms: [],
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

  function optionalPropertyCurrency(raw) {
    const s = String(raw ?? '').trim()
    if (!s) return undefined
    const n = Number(s)
    if (!Number.isFinite(n) || n < 0) return undefined
    return n
  }

  const approvedAssigned = useMemo(
    () => properties.filter((p) => propertyAssignedToManager(p, manager) && isPropertyRecordApproved(p)),
    [properties, manager],
  )
  const rejectedAssigned = useMemo(
    () => properties.filter((p) => propertyAssignedToManager(p, manager) && isPropertyRecordRejected(p)),
    [properties, manager],
  )
  const pendingAssigned = useMemo(
    () =>
      properties.filter(
        (p) =>
          propertyAssignedToManager(p, manager) &&
          !isPropertyRecordApproved(p) &&
          !isPropertyRecordRejected(p),
      ),
    [properties, manager],
  )
  const changesRequestedAssigned = useMemo(
    () => approvedAssigned.filter((p) => propertyNeedsAdminEditRequest(p)),
    [approvedAssigned],
  )
  const listedAssigned = useMemo(
    () =>
      approvedAssigned.filter(
        (p) => propertyListingVisibleForMarketing(p) && !propertyNeedsAdminEditRequest(p),
      ),
    [approvedAssigned],
  )
  const unlistedAssigned = useMemo(
    () =>
      approvedAssigned.filter(
        (p) => !propertyListingVisibleForMarketing(p) && !propertyNeedsAdminEditRequest(p),
      ),
    [approvedAssigned],
  )
  const managedPropertyCount =
    pendingAssigned.length +
    changesRequestedAssigned.length +
    listedAssigned.length +
    unlistedAssigned.length +
    rejectedAssigned.length
  /** Rows for the selected property tab (unified card UI for all of these). */
  const managerPropertyTabRows = useMemo(() => {
    switch (propertiesSection) {
      case 'pending':
        return pendingAssigned
      case 'rejected':
        return rejectedAssigned
      case 'request_change':
        return changesRequestedAssigned
      case 'listed':
        return listedAssigned
      case 'unlisted':
        return unlistedAssigned
      default:
        return null
    }
  }, [
    propertiesSection,
    pendingAssigned,
    rejectedAssigned,
    changesRequestedAssigned,
    listedAssigned,
    unlistedAssigned,
  ])

  useEffect(() => {
    setDetailsPropertyId(null)
    setEditingPropertyId(null)
  }, [propertiesSection])

  async function handleSaveTourHours(property) {
    setSaving(true)
    try {
      const patch = {}
      // Basic fields
      const pname = String(tourForm.propertyName || '').trim()
      if (pname) patch['Property Name'] = pname
      const addr = String(tourForm.address || '').trim()
      if (addr) patch.Address = addr
      if (tourForm.propertyType) patch['Property Type'] = tourForm.propertyType
      if (tourForm.pets) patch['Pets'] = tourForm.pets
      if (Array.isArray(tourForm.amenities)) patch['Amenities'] = tourForm.amenities
      // Fees
      const sd = optionalPropertyCurrency(tourForm.securityDeposit)
      if (sd !== undefined) patch['Security Deposit'] = sd
      const uf = optionalPropertyCurrency(tourForm.utilitiesFee)
      if (uf !== undefined) patch['Utilities Fee'] = uf
      const af = optionalPropertyCurrency(tourForm.applicationFee)
      if (af !== undefined) patch['Application Fee'] = af
      // Other info
      patch['Other Info'] = String(tourForm.otherInfo || '')
      // Auto site manager email
      const sme = String(manager?.email || property['Site Manager Email'] || '').trim()
      if (sme) patch['Site Manager Email'] = sme
      // Room count + per-room fields
      const rc = clampInt(tourForm.roomCount, 1, MAX_ROOM_SLOTS)
      patch['Room Count'] = rc
      tourForm.rooms.slice(0, rc).forEach((room, i) => {
        const n = i + 1
        const rent = optionalPropertyCurrency(room.rent)
        if (rent !== undefined) patch[`Room ${n} Rent`] = rent
        if (room.availability) patch[`Room ${n} Availability`] = room.availability
        if (room.furnished) patch[`Room ${n} Furnished`] = room.furnished
        const uc = optionalPropertyCurrency(room.utilitiesCost)
        if (uc !== undefined) patch[`Room ${n} Utilities Cost`] = uc
      })
      // Reset approval — editing requires re-approval by admin
      patch['Approved'] = false
      patch['Approval Status'] = 'Pending'
      patch[PROPERTY_EDIT_REQUEST_FIELD] = ''
      const updated = await updatePropertyAdmin(property.id, patch)
      setProperties((current) => {
        const next = current.map((item) => (item.id === property.id ? updated : item))
        onPropertiesChange?.(next)
        return next
      })
      toast.success('Submitted — pending admin approval')
      if (propertyNeedsAdminEditRequest(property)) {
        setPropertiesSection('pending')
      }
      setEditingPropertyId(null)
    } catch (err) {
      toast.error('Could not save property: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const selectedManagerProperty = useMemo(() => {
    if (!detailsPropertyId) return null
    return managerPropertyTabRows?.find((p) => p.id === detailsPropertyId) || null
  }, [detailsPropertyId, managerPropertyTabRows])

  function beginEditListing(property) {
    const rc = clampInt(property['Room Count'] ?? 1, 1, MAX_ROOM_SLOTS)
    setEditingPropertyId(property.id)
    setDetailsPropertyId(property.id)
    setTourForm({
      propertyName: String(property['Property Name'] ?? property.Name ?? ''),
      address: String(property.Address ?? ''),
      propertyType: String(property['Property Type'] ?? ''),
      pets: String(property.Pets ?? ''),
      amenities: Array.isArray(property.Amenities) ? [...property.Amenities] : (property.Amenities ? [property.Amenities] : []),
      securityDeposit: String(property['Security Deposit'] ?? ''),
      utilitiesFee: String(property['Utilities Fee'] ?? ''),
      applicationFee: String(property['Application Fee'] ?? ''),
      otherInfo: String(property['Other Info'] ?? ''),
      roomCount: rc,
      rooms: Array.from({ length: rc }, (_, i) => {
        const n = i + 1
        const avail = property[`Room ${n} Availability`]
        return {
          rent: String(property[`Room ${n} Rent`] ?? property[`Room ${n} for Rent`] ?? ''),
          availability: avail ? String(avail).slice(0, 10) : '',
          furnished: String(property[`Room ${n} Furnished`] ?? ''),
          utilitiesCost: String(property[`Room ${n} Utilities Cost`] ?? ''),
        }
      }),
    })
  }

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-2xl font-black text-slate-900">Properties</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              disabled={isManagerInternalPreview(manager)}
              className="rounded-2xl bg-[#2563eb] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
            >
              + Add property
            </button>
            <button
              type="button"
              onClick={loadProperties}
              className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
            >
              Refresh
            </button>
          </div>
        </div>

        {loading ? (
          <div className="mt-5 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-5 text-sm text-slate-500">Loading houses…</div>
        ) : managedPropertyCount === 0 ? (
          <div className="mt-5 rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-6 py-10 text-center">
            <div className="mb-3 text-4xl" aria-hidden>🏠</div>
            <p className="text-sm font-semibold text-slate-800">No properties yet</p>
          </div>
        ) : (
          <div className="mt-5 space-y-5">
            <div className="grid gap-2 rounded-[28px] border border-slate-200 bg-slate-50 p-2 sm:grid-cols-2 xl:grid-cols-5">
              {[
                ['pending', 'Pending', pendingAssigned.length],
                ['request_change', 'Request change', changesRequestedAssigned.length],
                ['listed', 'Listed', listedAssigned.length],
                ['unlisted', 'Unlisted', unlistedAssigned.length],
                ['rejected', 'Rejected', rejectedAssigned.length],
              ].map(([key, label, count]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPropertiesSection(key)}
                  className={`rounded-2xl border px-4 py-3 text-left transition ${
                    propertiesSection === key
                      ? 'border-[#2563eb]/30 bg-white text-slate-900 shadow-[0_10px_24px_rgba(37,99,235,0.14)]'
                      : 'border-transparent text-slate-600 hover:border-slate-200 hover:bg-white/70 hover:text-slate-900'
                  }`}
                >
                  <div className="text-lg font-black leading-none tabular-nums text-slate-900">{count}</div>
                  <div className="mt-1 text-sm font-semibold">{label}</div>
                </button>
              ))}
            </div>

            {managerPropertyTabRows != null ? (
              managerPropertyTabRows.length ? (
                <div className="space-y-4">
                  <DataTable
                    empty="No properties in this view"
                    columns={[
                      {
                        key: 'property',
                        label: 'Property',
                        headerClassName: 'w-[28%]',
                        render: (p) => (
                          <>
                            <div className="font-semibold text-slate-900">{propertyRecordName(p) || 'Untitled house'}</div>
                            <div className="text-xs text-slate-500">{p.Address || 'Address not set'}</div>
                          </>
                        ),
                      },
                      {
                        key: 'summary',
                        label: 'Summary',
                        headerClassName: 'w-[42%]',
                        render: (p) => (
                          <div className="flex flex-wrap gap-1.5">
                            {p['Property Type'] ? <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">{p['Property Type']}</span> : null}
                            {p['Room Count'] ? <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">{p['Room Count']} rooms</span> : null}
                            {p['Bathroom Count'] ? <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">{p['Bathroom Count']} baths</span> : null}
                            {p['Application Fee'] ? <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">App fee ${p['Application Fee']}</span> : null}
                          </div>
                        ),
                      },
                      {
                        key: 'status',
                        label: 'Status',
                        headerClassName: 'w-[16%] text-center',
                        cellClassName: 'text-center',
                        render: () => {
                          const statusPill = managerPropertySectionTableStatus(propertiesSection)
                          return <StatusPill tone={statusPill.tone}>{statusPill.label}</StatusPill>
                        },
                      },
                      {
                        key: 'actions',
                        label: 'Action',
                        headerClassName: 'w-[14%] text-right',
                        cellClassName: 'text-right',
                        render: (p) => (
                          <button
                            type="button"
                            className="whitespace-nowrap text-sm font-semibold text-[#2563eb]"
                            onClick={() => {
                              setEditingPropertyId(null)
                              setDetailsPropertyId(detailsPropertyId === p.id ? null : p.id)
                            }}
                          >
                            {detailsPropertyId === p.id ? 'Hide' : 'Details'}
                          </button>
                        ),
                      },
                    ]}
                    rows={managerPropertyTabRows.map((p) => ({ key: p.id, data: p }))}
                  />

                  {selectedManagerProperty ? (
                    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
                      {propertiesSection === 'request_change' && selectedManagerProperty[PROPERTY_EDIT_REQUEST_FIELD] ? (
                        <div className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-950">
                          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-violet-800">From Axis</div>
                          <p className="mt-1 whitespace-pre-wrap">{selectedManagerProperty[PROPERTY_EDIT_REQUEST_FIELD]}</p>
                        </div>
                      ) : null}

                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h2 className="text-lg font-black text-slate-900">{propertyRecordName(selectedManagerProperty) || 'Untitled house'}</h2>
                          <p className="mt-1 text-sm text-slate-600">{selectedManagerProperty.Address || 'Address not set'}</p>
                        </div>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {propertiesSection === 'listed' ? (
                            <button
                              type="button"
                              disabled={
                                listingBusyPropertyId === selectedManagerProperty.id ||
                                deletingPropertyId === selectedManagerProperty.id ||
                                isManagerInternalPreview(manager)
                              }
                              onClick={async () => {
                                if (!window.confirm(`Unlist "${propertyRecordName(selectedManagerProperty) || 'this property'}" from the public site? It stays in your portal.`)) return
                                setListingBusyPropertyId(selectedManagerProperty.id)
                                try {
                                  await updatePropertyAdmin(selectedManagerProperty.id, buildManagerListingPatch(selectedManagerProperty, false))
                                  toast.success('Property unlisted')
                                  await loadProperties()
                                } catch (err) {
                                  toast.error(err.message || 'Unlist failed — add a "Listed" checkbox on the Properties table in Airtable.')
                                } finally {
                                  setListingBusyPropertyId(null)
                                }
                              }}
                              className={`${MANAGER_PROP_TOOLBAR_BTN} text-slate-800 hover:bg-slate-100`}
                            >
                              {listingBusyPropertyId === selectedManagerProperty.id ? 'Saving…' : 'Unlist'}
                            </button>
                          ) : propertiesSection === 'unlisted' ? (
                            <button
                              type="button"
                              disabled={
                                listingBusyPropertyId === selectedManagerProperty.id ||
                                deletingPropertyId === selectedManagerProperty.id ||
                                isManagerInternalPreview(manager)
                              }
                              onClick={async () => {
                                setListingBusyPropertyId(selectedManagerProperty.id)
                                try {
                                  await updatePropertyAdmin(selectedManagerProperty.id, buildManagerListingPatch(selectedManagerProperty, true))
                                  toast.success('Property listed on the site again')
                                  await loadProperties()
                                } catch (err) {
                                  toast.error(err.message || 'Relist failed — add a "Listed" checkbox on the Properties table in Airtable.')
                                } finally {
                                  setListingBusyPropertyId(null)
                                }
                              }}
                              className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-50"
                            >
                              {listingBusyPropertyId === selectedManagerProperty.id ? 'Saving…' : 'Relist'}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            disabled={deletingPropertyId === selectedManagerProperty.id || isManagerInternalPreview(manager)}
                            onClick={async () => {
                              if (!window.confirm(`Delete "${propertyRecordName(selectedManagerProperty) || 'this property'}"? This cannot be undone.`)) return
                              setDeletingPropertyId(selectedManagerProperty.id)
                              try {
                                await deletePropertyAdmin(selectedManagerProperty.id)
                                toast.success('Property deleted')
                                setDetailsPropertyId(null)
                                setEditingPropertyId(null)
                                await loadProperties()
                              } catch (err) {
                                toast.error(err.message || 'Delete failed')
                              } finally {
                                setDeletingPropertyId(null)
                              }
                            }}
                            className="rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-50"
                          >
                            {deletingPropertyId === selectedManagerProperty.id ? 'Deleting…' : 'Delete'}
                          </button>
                        </div>
                      </div>

                      <PropertyDetailPanel property={managerPropertyToDetailPanelModel(selectedManagerProperty)} ownerLabel={manager?.email || '—'} />

                      {editingPropertyId === selectedManagerProperty.id ? (
                        <div className="space-y-5 border-t border-slate-200 pt-4">
                    <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 font-medium">
                      Saving changes will reset this property to pending admin approval.
                    </div>

                    {/* Basics */}
                    <div>
                      <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Basics</div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="sm:col-span-2">
                          <label className="mb-1 block text-xs font-semibold text-slate-600">Property name</label>
                          <input
                            type="text"
                            value={tourForm.propertyName}
                            onChange={(e) => setTourForm((f) => ({ ...f, propertyName: e.target.value }))}
                            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="mb-1 block text-xs font-semibold text-slate-600">Address</label>
                          <input
                            type="text"
                            value={tourForm.address}
                            onChange={(e) => setTourForm((f) => ({ ...f, address: e.target.value }))}
                            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-semibold text-slate-600">Property type</label>
                          <select
                            value={tourForm.propertyType}
                            onChange={(e) => setTourForm((f) => ({ ...f, propertyType: e.target.value }))}
                            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900"
                          >
                            <option value="">Select…</option>
                            {PROPERTY_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-semibold text-slate-600">Pets</label>
                          <select
                            value={tourForm.pets}
                            onChange={(e) => setTourForm((f) => ({ ...f, pets: e.target.value }))}
                            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900"
                          >
                            <option value="">Select…</option>
                            {PET_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* Fees */}
                    <div>
                      <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Fees</div>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div>
                          <label className="mb-1 block text-xs font-semibold text-slate-600">Application fee ($)</label>
                          <input type="number" min="0" step="1"
                            value={tourForm.applicationFee}
                            onChange={(e) => setTourForm((f) => ({ ...f, applicationFee: e.target.value }))}
                            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-semibold text-slate-600">Security deposit ($)</label>
                          <input type="number" min="0" step="1"
                            value={tourForm.securityDeposit}
                            onChange={(e) => setTourForm((f) => ({ ...f, securityDeposit: e.target.value }))}
                            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-semibold text-slate-600">Utilities fee ($/mo)</label>
                          <input type="number" min="0" step="1"
                            value={tourForm.utilitiesFee}
                            onChange={(e) => setTourForm((f) => ({ ...f, utilitiesFee: e.target.value }))}
                            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Amenities */}
                    <div>
                      <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Amenities</div>
                      <div className="flex flex-wrap gap-2">
                        {AMENITY_OPTIONS.map((a) => {
                          const checked = tourForm.amenities.includes(a)
                          return (
                            <button
                              key={a}
                              type="button"
                              onClick={() => setTourForm((f) => ({
                                ...f,
                                amenities: checked ? f.amenities.filter((x) => x !== a) : [...f.amenities, a],
                              }))}
                              className={[
                                'rounded-full border px-3 py-1 text-xs font-semibold transition',
                                checked
                                  ? 'border-[#2563eb] bg-[#2563eb] text-white'
                                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300',
                              ].join(' ')}
                            >
                              {a}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    {/* Rooms */}
                    <div>
                      <div className="mb-2 flex items-center gap-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
                        <span>Rooms</span>
                        <div className="flex items-center gap-1.5">
                          <button type="button"
                            onClick={() => setTourForm((f) => {
                              const next = Math.max(1, f.roomCount - 1)
                              return { ...f, roomCount: next, rooms: f.rooms.slice(0, next) }
                            })}
                            className="flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 text-slate-500 hover:bg-slate-100 text-base leading-none"
                          >−</button>
                          <span className="text-slate-700 normal-case font-semibold text-xs">{tourForm.roomCount}</span>
                          <button type="button"
                            onClick={() => setTourForm((f) => {
                              const next = Math.min(MAX_ROOM_SLOTS, f.roomCount + 1)
                              const rooms = [...f.rooms]
                              while (rooms.length < next) rooms.push({ rent: '', availability: '', furnished: '', utilitiesCost: '' })
                              return { ...f, roomCount: next, rooms }
                            })}
                            className="flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 text-slate-500 hover:bg-slate-100 text-base leading-none"
                          >+</button>
                        </div>
                      </div>
                      <div className="space-y-3">
                        {Array.from({ length: tourForm.roomCount }, (_, i) => {
                          const room = tourForm.rooms[i] ?? { rent: '', availability: '', furnished: '', utilitiesCost: '' }
                          const setRoom = (upd) => setTourForm((f) => {
                            const rooms = [...f.rooms]
                            while (rooms.length <= i) rooms.push({ rent: '', availability: '', furnished: '', utilitiesCost: '' })
                            rooms[i] = { ...rooms[i], ...upd }
                            return { ...f, rooms }
                          })
                          return (
                            <div key={i} className="rounded-xl border border-slate-100 bg-white p-3 grid gap-2 sm:grid-cols-4">
                              <div className="sm:col-span-4 text-xs font-semibold text-slate-500 mb-1">Room {i + 1}</div>
                              <div>
                                <label className="mb-1 block text-[11px] text-slate-500">Rent ($)</label>
                                <input type="number" min="0" step="1"
                                  value={room.rent}
                                  onChange={(e) => setRoom({ rent: e.target.value })}
                                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900"
                                />
                              </div>
                              <div>
                                <label className="mb-1 block text-[11px] text-slate-500">Available</label>
                                <input type="date"
                                  value={room.availability ? room.availability.slice(0, 10) : ''}
                                  onChange={(e) => setRoom({ availability: e.target.value })}
                                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900"
                                />
                              </div>
                              <div>
                                <label className="mb-1 block text-[11px] text-slate-500">Furnished</label>
                                <select
                                  value={room.furnished}
                                  onChange={(e) => setRoom({ furnished: e.target.value })}
                                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900"
                                >
                                  <option value="">—</option>
                                  {FURNISHED_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                                </select>
                              </div>
                              <div>
                                <label className="mb-1 block text-[11px] text-slate-500">Utils cost ($/mo)</label>
                                <input type="number" min="0" step="1"
                                  value={room.utilitiesCost}
                                  onChange={(e) => setRoom({ utilitiesCost: e.target.value })}
                                  className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900"
                                />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>

                    {/* Other Info */}
                    <div>
                      <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Other info</div>
                      <textarea
                        rows={3}
                        value={tourForm.otherInfo}
                        onChange={(e) => setTourForm((f) => ({ ...f, otherInfo: e.target.value }))}
                        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 resize-none"
                        placeholder="Any additional details…"
                      />
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setEditingPropertyId(null)}
                        className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSaveTourHours(selectedManagerProperty)}
                        className="rounded-2xl bg-[#2563eb] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                        disabled={saving}
                      >
                        {saving ? 'Saving…' : 'Save & submit for approval'}
                      </button>
                    </div>
                        </div>
                      ) : (
                        <div className="flex gap-2 border-t border-slate-200 pt-4">
                          {propertiesSection !== 'rejected' ? (
                            <button
                              type="button"
                              onClick={() => beginEditListing(selectedManagerProperty)}
                              className={MANAGER_PROP_TOOLBAR_BTN}
                            >
                              Edit listing
                            </button>
                          ) : null}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-6 py-10 text-center">
                  <div className="mb-3 text-4xl" aria-hidden>🏠</div>
                  <p className="text-sm font-semibold text-slate-800">No properties in this view</p>
                </div>
              )
            ) : null}
          </div>
        )}

        {addOpen ? (
          <AddPropertyWizard
            manager={manager}
            onClose={() => setAddOpen(false)}
            onCreated={(created) => {
              setProperties((current) => {
                const next = [...current, created]
                onPropertiesChange?.(next)
                return next
              })
              setPropertiesSection('pending')
            }}
            createPropertyAdmin={createPropertyAdmin}
          />
        ) : null}
    </div>
  )
}

// ─── ManagerProfilePanel ──────────────────────────────────────────────────────
// Profile view: editable personal info
function ManagerProfilePanel({ manager, onManagerUpdate }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ name: manager.name || '', phone: manager.phone || '' })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    setForm({ name: manager.name || '', phone: manager.phone || '' })
  }, [manager.name, manager.phone])

  function handleCancelEdit() {
    setForm({ name: manager.name || '', phone: manager.phone || '' })
    setSaveError('')
    setEditing(false)
  }

  async function handleSaveProfile(event) {
    event.preventDefault()
    if (isManagerInternalPreview(manager)) {
      toast.info('Profile save is disabled in preview mode')
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
      setEditing(false)
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
      <section className="rounded-3xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <h2 className="mt-2 text-2xl font-black text-slate-900">Profile</h2>
          {!editing ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="shrink-0 rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 transition hover:border-[#2563eb]/40 hover:bg-slate-50"
            >
              Edit info
            </button>
          ) : null}
        </div>

        {!editing ? (
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 text-sm font-semibold text-slate-700">Full name</p>
              <div className={readonlyCls}>{manager.name || '—'}</div>
            </div>
            <div>
              <p className="mb-1.5 text-sm font-semibold text-slate-700">Email</p>
              <div className={readonlyCls}>{manager.email || '—'}</div>
            </div>
            <div>
              <p className="mb-1.5 text-sm font-semibold text-slate-700">Phone</p>
              <div className={readonlyCls}>{manager.phone || '—'}</div>
            </div>
            <div>
              <p className="mb-1.5 text-sm font-semibold text-slate-700">Manager ID</p>
              <div className={`${readonlyCls} font-mono`}>{manager.managerId || '—'}</div>
            </div>
          </div>
        ) : (
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
            <div className="flex flex-wrap gap-3 sm:col-span-2">
              <button
                type="submit"
                disabled={saving || (!form.name.trim() && !form.phone.trim())}
                className="rounded-2xl bg-[#2563eb] px-6 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save changes'}
              </button>
              <button
                type="button"
                onClick={handleCancelEdit}
                disabled={saving}
                className="rounded-2xl border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </form>
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
      <div className="w-full max-w-2xl rounded-3xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-200 px-8 py-5">
          <div>
            <h2 className="text-xl font-black text-slate-900">Generate lease draft</h2>
            <p className="mt-0.5 text-sm text-slate-500">Choose the resident and property details, then generate the first lease draft for review</p>
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
const WORK_ORDER_UI_STATUSES = ['Open', 'In Progress', 'Completed']

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
    const title = safePortalText(w.Title, 'Request').slice(0, 48)
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
  manager,
  approvedHouseCount = 0,
  stats,
  statsLoading,
  dataWarnings,
  onNavigate,
  inboxUnopenedCount,
}) {
  const displayDataWarnings = useMemo(
    () => consolidateManagerDashboardWarnings(dataWarnings || []),
    [dataWarnings],
  )
  const s = stats || {}
  const pendingApps = statsLoading ? '—' : s.pendingApps ?? 0
  const leasePending = statsLoading ? '—' : s.leasePending ?? 0
  const rentOverdue = statsLoading ? '—' : s.rentOverdue ?? 0
  const openWo = statsLoading ? '—' : s.openWo ?? 0
  const upcomingEvents = statsLoading ? '—' : s.upcomingEvents ?? 0

  const firstName = String(manager?.name || '').split(' ')[0] || null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-black uppercase tracking-[0.08em] text-slate-900">
          {firstName ? `WELCOME ${firstName}` : 'DASHBOARD'}
        </h2>
      </div>

      {displayDataWarnings?.length ? (
        <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <div className="font-semibold text-amber-900">Some data could not load</div>
          <ul className="mt-2 list-inside list-disc space-y-1 text-amber-900/90">
            {displayDataWarnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      ) : null}

      {/* Metric cards — same order as sidebar: Leases, Applications, Properties, Payments, Work orders, Inbox */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <button
          type="button"
          onClick={() => onNavigate('leases')}
          className="flex flex-col gap-1 rounded-3xl border border-blue-100 bg-blue-50 p-5 text-left transition hover:border-blue-200 hover:shadow-sm"
        >
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-blue-600">Leases · Action needed</span>
          <span className="text-3xl font-black tabular-nums text-blue-700">{leasePending}</span>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('applications')}
          className="flex flex-col gap-1 rounded-3xl border border-blue-100 bg-blue-50 p-5 text-left transition hover:border-blue-200 hover:shadow-sm"
        >
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-blue-600">Applications · Pending</span>
          <span className="text-3xl font-black tabular-nums text-blue-700">{pendingApps}</span>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('properties')}
          className="flex flex-col gap-1 rounded-3xl border border-blue-100 bg-blue-50 p-5 text-left transition hover:border-blue-200 hover:shadow-sm"
        >
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-blue-600">Properties · Approved</span>
          <span className="text-3xl font-black tabular-nums text-blue-700">{approvedHouseCount}</span>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('payments')}
          className="flex flex-col gap-1 rounded-3xl border border-blue-100 bg-blue-50 p-5 text-left transition hover:border-blue-200 hover:shadow-sm"
        >
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-blue-600">Payments · Overdue</span>
          <span className="text-3xl font-black tabular-nums text-blue-700">{rentOverdue}</span>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('workorders')}
          className="flex flex-col gap-1 rounded-3xl border border-blue-100 bg-blue-50 p-5 text-left transition hover:border-blue-200 hover:shadow-sm"
        >
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-blue-600">Work Orders · Open</span>
          <span className="text-3xl font-black tabular-nums text-blue-700">{openWo}</span>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('calendar')}
          className="flex flex-col gap-1 rounded-3xl border border-blue-100 bg-blue-50 p-5 text-left transition hover:border-blue-200 hover:shadow-sm"
        >
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-blue-600">Calendar · Events</span>
          <span className="text-3xl font-black tabular-nums text-blue-700">{upcomingEvents}</span>
        </button>

        {/* Inbox — full-width spanning all columns */}
        <button
          type="button"
          onClick={() => onNavigate('inbox')}
          className="col-span-full flex items-center justify-between rounded-3xl border border-blue-100 bg-blue-50 px-6 py-5 text-left transition hover:border-blue-200 hover:shadow-sm"
        >
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-600">Inbox</span>
            {(inboxUnopenedCount ?? 0) > 0 ? (
              <span
                className="flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-blue-600 px-1.5 text-[10px] font-black text-white tabular-nums"
                title="Unopened conversations"
                aria-label={`${inboxUnopenedCount} unopened conversation${inboxUnopenedCount === 1 ? '' : 's'}`}
              >
                {inboxUnopenedCount}
              </span>
            ) : null}
          </div>
          <span className="text-lg font-black text-blue-700">Open messages →</span>
        </button>
      </div>
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
  const [quickFilter, setQuickFilter] = useState('all')
  const [propertyFilter, setPropertyFilter] = useState('')
  const [residentFilter, setResidentFilter] = useState('')
  const [record, setRecord] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('Open')
  const [managementNotes, setManagementNotes] = useState('')
  const [residentUpdate, setResidentUpdate] = useState('')
  const [resolutionSummary, setResolutionSummary] = useState('')

  const fieldCls =
    'w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/20'

  function applyRecordToForm(nextRecord) {
    setStatus(managerWorkOrderStatusLabel(nextRecord))
    setManagementNotes(workOrderPlainNotes(nextRecord?.['Management Notes']))
    setResidentUpdate(safePortalText(nextRecord?.Update, ''))
    setResolutionSummary(safePortalText(nextRecord?.['Resolution Summary'], ''))
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
      console.error('[WorkOrdersTabPanel] getAllWorkOrders failed', err)
      setList([])
      setListError('Unable to load work orders. Please try again.')
      if (!isAirtablePermissionErrorMessage(err?.message)) toast.error('Unable to load work orders. Please try again')
    } finally {
      setListLoading(false)
    }
  }, [scopeLower])

  useEffect(() => {
    loadList()
  }, [loadList])

  const woBucketCounts = useMemo(() => {
    const counts = { open: 0, scheduled: 0, in_progress: 0, completed: 0 }
    for (const row of list) {
      const b = managerWorkOrderBucket(row)
      if (counts[b] !== undefined) counts[b] += 1
    }
    return counts
  }, [list])

  const filteredList = useMemo(() => {
    let rows = list
    if (quickFilter !== 'all') rows = rows.filter((row) => managerWorkOrderBucket(row) === quickFilter)
    if (propertyFilter) rows = rows.filter((row) => String(workOrderPropertyLabel(row)).trim().toLowerCase() === propertyFilter)
    if (residentFilter) rows = rows.filter((row) => String(paymentResidentLabel(row)).trim().toLowerCase() === residentFilter)
    return [...rows].sort((a, b) => new Date(b['Date Submitted'] || b.created_at || 0) - new Date(a['Date Submitted'] || a.created_at || 0))
  }, [list, quickFilter, propertyFilter, residentFilter])

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
      const resolved = status === 'Completed'
      const meta = parseWorkOrderMetaBlock(record?.['Management Notes'])
      const fields = {
        Status: resolved ? 'Completed' : status,
        'Management Notes': mergeWorkOrderMetaBlock(managementNotes, {
          'assigned to': meta['assigned to'] || '',
          scheduled: meta.scheduled || '',
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
    <div className="mb-10">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h2 className="mr-auto text-2xl font-black text-slate-900">Work orders</h2>
        <select
          value={propertyFilter}
          onChange={(e) => setPropertyFilter(e.target.value)}
          className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm transition focus:border-[#2563eb] focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20"
        >
          <option value="">All properties</option>
          {(() => {
            const map = new Map()
            for (const name of allowedPropertyNames || []) {
              const display = String(name || '').trim()
              if (!display) continue
              const value = display.toLowerCase()
              if (!map.has(value)) map.set(value, display)
            }
            for (const row of list) {
              const display = String(workOrderPropertyLabel(row)).trim()
              if (!display) continue
              const value = display.toLowerCase()
              if (!map.has(value)) map.set(value, display)
            }
            return [...map.entries()]
              .sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: 'base' }))
              .map(([value, display]) => (
                <option key={value} value={value}>{display}</option>
              ))
          })()}
        </select>
        <select
          value={residentFilter}
          onChange={(e) => setResidentFilter(e.target.value)}
          className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm transition focus:border-[#2563eb] focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20"
        >
          <option value="">All residents</option>
          {[...new Set(list.map((r) => String(paymentResidentLabel(r)).trim()).filter(Boolean))].sort().map((r) => (
            <option key={r} value={r.toLowerCase()}>{r}</option>
          ))}
        </select>
        <button
          onClick={loadList}
          className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
        >
          Refresh
        </button>
      </div>

      {listError ? (
        <div role="alert" className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-950">
          <div className="font-semibold text-amber-900">Unable to load work orders</div>
          <p className="mt-2 text-amber-900/90">{listError}</p>
        </div>
      ) : null}

      <div className="mb-5 grid gap-2 rounded-[28px] border border-slate-200 bg-slate-50 p-2 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['all', 'All', list.length],
          ['open', 'Open', woBucketCounts.open],
          ['scheduled', 'Scheduled', woBucketCounts.scheduled],
          ['completed', 'Completed', woBucketCounts.completed],
        ].map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            onClick={() => setQuickFilter(key)}
            className={`rounded-2xl border px-4 py-3 text-left transition ${
              quickFilter === key
                ? 'border-[#2563eb]/30 bg-white text-slate-900 shadow-[0_10px_24px_rgba(37,99,235,0.14)]'
                : 'border-transparent text-slate-600 hover:border-slate-200 hover:bg-white/70 hover:text-slate-900'
            }`}
          >
            <div className="text-lg font-black leading-none tabular-nums text-slate-900">{count}</div>
            <div className="mt-1 text-sm font-semibold">{label}</div>
          </button>
        ))}
      </div>

      <div className={classNames('grid gap-6', record ? 'xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]' : '')}>
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          {listLoading ? (
            <div className="px-6 py-16 text-center text-sm text-slate-500">Loading work orders…</div>
          ) : filteredList.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <div className="mb-3 text-4xl" aria-hidden>{list.length === 0 ? '🔧' : '🔍'}</div>
              <div className="text-sm font-semibold text-slate-700">{list.length === 0 ? 'No work orders yet' : 'Nothing matches this filter'}</div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Title</th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Description</th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Property</th>
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
                      <td className="px-4 py-4 text-sm font-semibold text-slate-900">{safePortalText(row.Title, 'Untitled request')}</td>
                      <td className="max-w-xs px-4 py-4 text-sm text-slate-600">
                        <span className="line-clamp-2">{safePortalText(row.Description, '—')}</span>
                      </td>
                      <td className="px-4 py-4 text-sm text-slate-600">{workOrderPropertyLabel(row) || '—'}</td>
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
            title={safePortalText(record.Title, 'Work order')}
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
            </div>

            <div className="rounded-3xl border border-slate-200 bg-slate-50 px-5 py-4">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Issue details</div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-700">{safePortalText(record.Description, 'No description provided')}</p>
            </div>

            <form onSubmit={handleSave} className="mt-5 space-y-4">
              <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Status</label>
                <select value={status} onChange={(e) => setStatus(e.target.value)} className={fieldCls}>
                  {WORK_ORDER_UI_STATUSES.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
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
        ) : null}
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
  const [rentRows, setRentRows] = useState([])
  const [allScopedRows, setAllScopedRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [busy, setBusy] = useState({})
  const [paymentsLoadError, setPaymentsLoadError] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [payPropertyFilter, setPayPropertyFilter] = useState('')
  const [payResidentFilter, setPayResidentFilter] = useState('')
  const [fineTitle, setFineTitle] = useState('')
  const [fineAmount, setFineAmount] = useState('')
  const [fineDue, setFineDue] = useState('')
  const [fineNotes, setFineNotes] = useState('')
  const [fineSaving, setFineSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setPaymentsLoadError('')
    try {
      const all = await getAllPaymentsRecords()
      const scopedAll = scopeLower.size ? all.filter((p) => paymentInScope(p, scopeLower)) : []
      const rentOnly = scopedAll.filter(isRentPaymentRecord)
      rentOnly.sort(
        (a, b) =>
          new Date(b['Due Date'] || b.created_at || 0) - new Date(a['Due Date'] || a.created_at || 0),
      )
      const allSorted = [...scopedAll].sort(
        (a, b) =>
          new Date(b['Due Date'] || b.created_at || 0) - new Date(a['Due Date'] || a.created_at || 0),
      )
      setRentRows(rentOnly)
      setAllScopedRows(allSorted)
    } catch (err) {
      console.error('[ManagerPaymentsPanel] getAllPaymentsRecords failed', err)
      setPaymentsLoadError('Unable to load payments. Please try again.')
      setRentRows([])
      setAllScopedRows([])
      const isPerm = isAirtablePermissionErrorMessage(err?.message)
      if (!isPerm) {
        toast.error('Unable to load payments. Please try again')
      }
    } finally {
      setLoading(false)
    }
  }, [scopeLower])

  useEffect(() => {
    load()
  }, [load])

  const payPropertyChoices = useMemo(() => {
    const map = new Map()
    for (const name of allowedPropertyNames || []) {
      const display = String(name || '').trim()
      if (!display) continue
      const value = display.toLowerCase()
      if (!map.has(value)) map.set(value, display)
    }
    for (const row of rentRows) {
      const display = String(paymentPropertyLabel(row) || '').trim()
      if (!display) continue
      const value = display.toLowerCase()
      if (!map.has(value)) map.set(value, display)
    }
    return [...map.entries()]
      .sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: 'base' }))
      .map(([value, display]) => ({ value, display }))
  }, [rentRows, allowedPropertyNames])

  const payResidentChoices = useMemo(() => {
    const rows = payPropertyFilter
      ? rentRows.filter((r) => String(paymentPropertyLabel(r) || '').trim().toLowerCase() === payPropertyFilter)
      : rentRows
    const map = new Map()
    for (const row of rows) {
      const display = String(paymentResidentLabel(row) || '').trim()
      if (!display) continue
      const value = display.toLowerCase()
      if (!map.has(value)) map.set(value, display)
    }
    return [...map.entries()]
      .sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: 'base' }))
      .map(([value, display]) => ({ value, display }))
  }, [rentRows, payPropertyFilter])

  useEffect(() => {
    if (!payResidentFilter) return
    const ok = payResidentChoices.some((c) => c.value === payResidentFilter)
    if (!ok) setPayResidentFilter('')
  }, [payResidentFilter, payResidentChoices])

  const paymentRows = useMemo(
    () => {
      let filtered = rentRows
      if (payPropertyFilter) filtered = filtered.filter((p) => String(paymentPropertyLabel(p)).trim().toLowerCase() === payPropertyFilter)
      if (payResidentFilter) filtered = filtered.filter((p) => String(paymentResidentLabel(p)).trim().toLowerCase() === payResidentFilter)
      return filtered.map((row) => ({ ...row, __computedStatus: paymentComputedStatus(row) }))
    },
    [rentRows, payPropertyFilter, payResidentFilter],
  )

  const totalCollected = useMemo(
    () => paymentRows.reduce((sum, row) => sum + paymentAmountPaid(row), 0),
    [paymentRows],
  )
  const overdueRentAmount = useMemo(
    () =>
      paymentRows
        .filter((row) => row.__computedStatus === 'overdue')
        .reduce((sum, row) => sum + paymentBalanceDue(row), 0),
    [paymentRows],
  )
  const pendingRentAmount = useMemo(
    () =>
      paymentRows
        .filter((row) => ['unpaid', 'due_soon', 'partial'].includes(row.__computedStatus))
        .reduce((sum, row) => sum + paymentBalanceDue(row), 0),
    [paymentRows],
  )

  const overdueLineCount = useMemo(
    () => paymentRows.filter((row) => row.__computedStatus === 'overdue').length,
    [paymentRows],
  )
  const paidLineCount = useMemo(
    () => paymentRows.filter((row) => row.__computedStatus === 'paid').length,
    [paymentRows],
  )
  const pendingLineCount = useMemo(
    () => paymentRows.filter((row) => ['unpaid', 'due_soon', 'partial'].includes(row.__computedStatus)).length,
    [paymentRows],
  )

  const filteredForList = useMemo(() => {
    let list = paymentRows
    if (filter === 'pending') {
      list = list.filter((row) => ['unpaid', 'due_soon', 'partial'].includes(row.__computedStatus))
    } else if (filter !== 'all') {
      list = list.filter((row) => row.__computedStatus === filter)
    }
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
    const rid = paymentResidentRecordId(selectedRow)
    if (rid) {
      return allScopedRows
        .filter((row) => paymentResidentRecordId(row) === rid)
        .sort((a, b) => new Date(b['Due Date'] || b.created_at || 0) - new Date(a['Due Date'] || a.created_at || 0))
    }
    const residentName = paymentResidentLabel(selectedRow)
    return allScopedRows
      .filter((row) => paymentResidentLabel(row) === residentName)
      .sort((a, b) => new Date(b['Due Date'] || b.created_at || 0) - new Date(a['Due Date'] || a.created_at || 0))
  }, [allScopedRows, selectedRow])

  const extraChargeRows = useMemo(
    () => residentDetailRows.filter((row) => getPaymentKind(row) === 'fee'),
    [residentDetailRows],
  )

  function findScopedPaymentById(id) {
    return allScopedRows.find((row) => row.id === id) || rentRows.find((row) => row.id === id) || null
  }

  async function markPaid(id) {
    setBusy((b) => ({ ...b, [id]: true }))
    try {
      await updatePaymentRecord(id, {
        Status: 'Paid',
        'Paid Date': new Date().toISOString().slice(0, 10),
        'Amount Paid': paymentAmountDue(findScopedPaymentById(id) || {}),
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

  async function submitFine(event) {
    event.preventDefault()
    if (!selectedRow) return
    const residentId = paymentResidentRecordId(selectedRow)
    if (!residentId) {
      toast.error('This payment row has no linked resident. Link Resident on the payment in Airtable, then try again')
      return
    }
    const amt = Number(String(fineAmount).replace(/[^0-9.]/g, ''))
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    const title = fineTitle.trim() || 'Fine / extra charge'
    setFineSaving(true)
    try {
      let propertyName = paymentPropertyLabel(selectedRow)
      let roomNumber = String(selectedRow['Room Number'] ?? selectedRow.Room ?? selectedRow.Unit ?? selectedRow['Unit / Room'] ?? '').trim()
      if (!propertyName || !roomNumber) {
        const profile = await getResidentById(residentId).catch(() => null)
        if (profile) {
          if (!propertyName) propertyName = String(profile.House || '').trim()
          if (!roomNumber) roomNumber = String(profile['Unit Number'] || '').trim()
        }
      }
      const fields = {
        Resident: [residentId],
        Amount: amt,
        Balance: amt,
        Status: 'Unpaid',
        Type: 'Fine',
        Category: 'Fee',
        Month: title,
        Notes: fineNotes.trim() || undefined,
        'Due Date': fineDue.trim() || undefined,
        'Property Name': propertyName || undefined,
        'Room Number': roomNumber || undefined,
        'Resident Name': paymentResidentLabel(selectedRow) || undefined,
      }
      await createPaymentRecord(fields)
      toast.success('Fine posted for this resident')
      setFineTitle('')
      setFineAmount('')
      setFineDue('')
      setFineNotes('')
      await load()
    } catch (err) {
      toast.error(err.message || 'Could not create charge')
    } finally {
      setFineSaving(false)
    }
  }

  return (
    <div className="mb-10">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h2 className="mr-auto text-2xl font-black text-slate-900">Payments</h2>
        {!paymentsLoadError ? (
          <>
            <select
              value={payPropertyFilter}
              onChange={(e) => setPayPropertyFilter(e.target.value)}
              disabled={loading}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm transition focus:border-[#2563eb] focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20 disabled:opacity-60"
              aria-label="Filter by property"
            >
              <option value="">All properties</option>
              {payPropertyChoices.map(({ value, display }) => (
                <option key={value} value={value}>
                  {display}
                </option>
              ))}
            </select>
            <select
              value={payResidentFilter}
              onChange={(e) => setPayResidentFilter(e.target.value)}
              disabled={loading}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm transition focus:border-[#2563eb] focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20 disabled:opacity-60"
              aria-label="Filter by resident"
            >
              <option value="">All residents</option>
              {payResidentChoices.map(({ value, display }) => (
                <option key={value} value={value}>
                  {display}
                </option>
              ))}
            </select>
          </>
        ) : null}
        <button
          onClick={load}
          className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
        >
          Refresh
        </button>
      </div>

      {paymentsLoadError ? (
        <div
          role="alert"
          className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-950"
        >
          <div className="font-semibold text-amber-900">Unable to load payments</div>
          <p className="mt-2 text-amber-900/90">{paymentsLoadError}</p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-amber-900/85">
            <li>
              In your data service’s developer console, open your personal access token and grant access to the base that contains the{' '}
              <strong>Payments</strong> table.
            </li>
            <li>
              Enable scopes <strong className="font-mono text-xs">data.records:read</strong> and{' '}
              <strong className="font-mono text-xs">data.records:write</strong> for that base.
            </li>
            <li>
              Payments are read from workspace <code className="rounded bg-white/80 px-1.5 py-0.5 text-xs">{AIRTABLE_PAYMENTS_BASE_ID}</code>.
            </li>
          </ul>
        </div>
      ) : null}

      <div className="mb-5 grid gap-2 rounded-[28px] border border-slate-200 bg-slate-50 p-2 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['all', 'All', paymentRows.length],
          ['overdue', 'Overdue', overdueLineCount],
          ['paid', 'Paid', paidLineCount],
          ['pending', 'Pending', pendingLineCount],
        ].map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`rounded-2xl border px-4 py-3 text-left transition ${
              filter === key
                ? 'border-[#2563eb]/30 bg-white text-slate-900 shadow-[0_10px_24px_rgba(37,99,235,0.14)]'
                : 'border-transparent text-slate-600 hover:border-slate-200 hover:bg-white/70 hover:text-slate-900'
            }`}
          >
            <div className="text-lg font-black leading-none tabular-nums text-slate-900">{count}</div>
            <div className="mt-1 text-sm font-semibold">{label}</div>
          </button>
        ))}
      </div>

      <div className={classNames('grid gap-6', selectedId ? 'xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]' : '')}>
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
          {loading ? (
            <div className="px-6 py-16 text-center text-sm text-slate-500">Loading payments…</div>
          ) : rentRows.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <div className="mb-3 text-4xl" aria-hidden>💳</div>
              <div className="text-sm font-semibold text-slate-700">No rent charges to show</div>
            </div>
          ) : filteredForList.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <div className="mb-3 text-4xl" aria-hidden>🔍</div>
              <div className="text-sm font-semibold text-slate-700">Nothing matches this filter</div>
            </div>
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
                    <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-slate-200 px-4 py-4">
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
                <p className="mt-3 text-sm text-slate-500">No extra charges for this resident</p>
              ) : (
                <div className="mt-3 space-y-3">
                  {extraChargeRows.map((row) => (
                    <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-slate-200 px-4 py-4">
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

            <form onSubmit={submitFine} className="mt-6 rounded-3xl border border-dashed border-slate-200 bg-slate-50/80 p-4">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Add fine / extra charge</div>
              <p className="mt-2 text-xs text-slate-500">
                Creates an unpaid fee line linked to this resident. Residents see it on Payments → Fees and extras.
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-xs font-semibold text-slate-600">Title</span>
                  <input
                    value={fineTitle}
                    onChange={(e) => setFineTitle(e.target.value)}
                    placeholder="e.g. Late fee, cleaning charge"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-axis focus:ring-2 focus:ring-axis/20"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-600">Amount (USD)</span>
                  <input
                    value={fineAmount}
                    onChange={(e) => setFineAmount(e.target.value)}
                    inputMode="decimal"
                    placeholder="0"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-axis focus:ring-2 focus:ring-axis/20"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-600">Due date (optional)</span>
                  <input
                    type="date"
                    value={fineDue}
                    onChange={(e) => setFineDue(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-axis focus:ring-2 focus:ring-axis/20"
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-xs font-semibold text-slate-600">Notes (optional)</span>
                  <textarea
                    value={fineNotes}
                    onChange={(e) => setFineNotes(e.target.value)}
                    rows={2}
                    placeholder="Internal or resident-facing context"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-axis focus:ring-2 focus:ring-axis/20"
                  />
                </label>
              </div>
              <button
                type="submit"
                disabled={fineSaving || !paymentResidentRecordId(selectedRow)}
                className="mt-4 rounded-full bg-axis px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {fineSaving ? 'Saving…' : 'Create charge'}
              </button>
            </form>
          </PortalOpsCard>
        ) : null}
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
  const st = deriveApplicationApprovalState(app)
  if (st === 'pending') return 0
  if (st === 'approved') return 1
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
  const [detailAppId, setDetailAppId] = useState(null)
  const [scopedRows, setScopedRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [propertyFilter, setPropertyFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
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

  const propertyFilteredRows = useMemo(() => {
    let rows = scopedRows
    if (propertyFilter.trim()) rows = rows.filter((a) => String(a['Property Name'] || '').trim() === propertyFilter.trim())
    return rows
  }, [scopedRows, propertyFilter])

  const filteredRows = useMemo(() => {
    if (statusFilter === 'pending') return propertyFilteredRows.filter((a) => deriveApplicationApprovalState(a) === 'pending')
    if (statusFilter === 'approved') return propertyFilteredRows.filter((a) => deriveApplicationApprovalState(a) === 'approved')
    if (statusFilter === 'rejected') return propertyFilteredRows.filter((a) => deriveApplicationApprovalState(a) === 'rejected')
    return propertyFilteredRows
  }, [propertyFilteredRows, statusFilter])

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
            managerRecordId: manager?.id || '',
          }),
        })
        const data = await readJsonResponse(res)
        if (!res.ok) throw new Error(data.error || 'Could not approve application')
        setScopedRows((prev) =>
          prev.map((a) =>
            a.id === recordId ? { ...a, ...(data.application || {}) } : a,
          ),
        )
        if (Array.isArray(data.residentRecordsUpdated) && data.residentRecordsUpdated.length > 0) {
          toast.success(
            (data.message || 'Application approved') +
              ` Resident portal access updated (${data.residentRecordsUpdated.length} profile${data.residentRecordsUpdated.length === 1 ? '' : 's'})`,
          )
        } else {
          toast.success(data.message || 'Application approved and lease draft generated')
        }
      } else {
        const rf = applicationRejectedFieldName()
        const updated = await patchApplication(recordId, { Approved: null, [rf]: true })
        setScopedRows((prev) =>
          prev.map((a) => {
            if (a.id !== recordId) return a
            const next = { ...a, ...updated, [rf]: true }
            delete next.Approved
            return next
          }),
        )
        toast.success('Application rejected')
      }
    } catch (err) {
      toast.error('Could not update application: ' + err.message)
    } finally {
      setApproving(a => { const n = { ...a }; delete n[recordId]; return n })
    }
  }

  const statusLabel = (app) => {
    const st = deriveApplicationApprovalState(app)
    if (st === 'approved') return { label: 'Approved', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' }
    if (st === 'rejected') return { label: 'Rejected', cls: 'border-red-200 bg-red-50 text-red-700' }
    return { label: 'Pending review', cls: 'border-amber-200 bg-amber-50 text-amber-700' }
  }

  const filterOptions = allowedPropertyNames || []

  return (
    <div className="mb-10">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h2 className="mr-auto w-full text-2xl font-black text-slate-900 sm:w-auto">Applications</h2>
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:ml-auto sm:w-auto sm:flex-nowrap">
          <div className={MANAGER_PILL_SELECT_WRAP_CLS}>
            <select
              value={propertyFilter}
              onChange={e => setPropertyFilter(e.target.value)}
              className={MANAGER_PILL_SELECT_CLS}
            >
              <option value="">All your properties</option>
              {filterOptions.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            {MANAGER_PILL_SELECT_CHEVRON}
          </div>
          <button type="button" onClick={load} className={MANAGER_PILL_REFRESH_CLS}>
            Refresh
          </button>
        </div>
      </div>

      <div className="mb-5 grid gap-2 rounded-[28px] border border-slate-200 bg-slate-50 p-2 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['all', 'All', propertyFilteredRows.length],
          ['pending', 'Pending', propertyFilteredRows.filter((a) => deriveApplicationApprovalState(a) === 'pending').length],
          ['approved', 'Approved', propertyFilteredRows.filter((a) => deriveApplicationApprovalState(a) === 'approved').length],
          ['rejected', 'Rejected', propertyFilteredRows.filter((a) => deriveApplicationApprovalState(a) === 'rejected').length],
        ].map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            onClick={() => { setStatusFilter(key); setDetailAppId(null) }}
            className={`rounded-2xl border px-4 py-3 text-left transition ${
              statusFilter === key
                ? 'border-[#2563eb]/30 bg-white text-slate-900 shadow-[0_10px_24px_rgba(37,99,235,0.14)]'
                : 'border-transparent text-slate-600 hover:border-slate-200 hover:bg-white/70 hover:text-slate-900'
            }`}
          >
            <div className="text-lg font-black leading-none tabular-nums text-slate-900">{count}</div>
            <div className="mt-1 text-sm font-semibold">{label}</div>
          </button>
        ))}
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

      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
        {loading ? (
          <div className="px-6 py-16 text-center text-sm text-slate-500">Loading applications…</div>
        ) : loadError ? (
          <div className="px-6 py-16 text-center">
            <div className="mb-3 text-4xl" aria-hidden>⚠️</div>
            <div className="text-sm font-semibold text-slate-700">Could not load the list</div>
            <p className="mt-1 text-sm text-slate-500">Check the message above and try Refresh</p>
          </div>
        ) : scopedRows.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <div className="mb-3 text-4xl" aria-hidden>📋</div>
            <div className="text-sm font-semibold text-slate-700">No applications yet</div>
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <div className="mb-3 text-4xl" aria-hidden>🏠</div>
            <div className="text-sm font-semibold text-slate-700">No {statusFilter !== 'all' ? statusFilter + ' ' : ''}applications</div>
            <p className="mt-1 text-sm text-slate-500">
              {statusFilter !== 'all' ? 'Try switching to a different filter tab' : 'Choose "All your properties" or another house to see more'}
            </p>
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
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setDetailAppId((id) => (id === app.id ? null : app.id))}
                        className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                      >
                        {detailAppId === app.id ? 'Hide details' : 'Details'}
                      </button>
                      <button
                        onClick={() => handleDecision(app.id, true)}
                        disabled={!!busy || deriveApplicationApprovalState(app) === 'approved'}
                        className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-40"
                      >
                        {busy === 'approving' ? 'Approving…' : 'Approve'}
                      </button>
                      <button
                        onClick={() => handleDecision(app.id, false)}
                        disabled={!!busy || deriveApplicationApprovalState(app) === 'rejected'}
                        className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-40"
                      >
                        {busy === 'rejecting' ? 'Rejecting…' : 'Reject'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
            {detailAppId ? (
              <div className="border-t border-slate-100 px-4 py-5 sm:px-6">
                {(() => {
                  const row = scopedRows.find((a) => a.id === detailAppId)
                  const vm = row ? applicationViewModelFromAirtableRow(row) : null
                  return vm ? (
                    <>
                      <ApplicationDetailPanel application={vm} partnerLabel="—" onClose={() => setDetailAppId(null)} />
                      {row?.Approved === true ? (
                        <ManagerApplicationLease
                          applicationId={detailAppId}
                          managerName={manager?.name || manager?.email || 'Manager'}
                        />
                      ) : null}
                    </>
                  ) : null
                })()}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

// ─── CalendarTabPanel ─────────────────────────────────────────────────────────
export function CalendarTabPanel({ manager, allowedPropertyNames, calendarMode = 'manager' }) {
  const isAdminCalendar = calendarMode === 'admin'
  const view = 'month'
  const [anchorDate, setAnchorDate] = useState(() => new Date())
  const [selectedDateKey, setSelectedDateKey] = useState(() => dateKeyFromDate(new Date()))
  const [schedulingRows, setSchedulingRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [properties, setProperties] = useState([])
  const [calendarProfiles, setCalendarProfiles] = useState([])
  const [weeklyFreeByProperty, setWeeklyFreeByProperty] = useState({})
  const [selectedPropertyId, setSelectedPropertyId] = useState('')
  const [availSaving, setAvailSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [sched, props, workOrders, adminProfiles] = await Promise.all([
        isAdminCalendar
          ? fetchAllSchedulingRows()
          : fetchSchedulingForManagerScope({ managerEmail: manager?.email, propertyNames: allowedPropertyNames || [] }),
        fetchPropertiesAdmin(),
        getAllWorkOrders().catch(() => []),
        isAdminCalendar ? loadAdminMeetingCalendarProfiles().catch(() => []) : Promise.resolve([]),
      ])
      const allowedLower = isAdminCalendar
        ? null
        : new Set(
            (allowedPropertyNames || []).map((name) => String(name).trim().toLowerCase()).filter(Boolean),
          )
      const workOrderRows = workOrdersToCalendarRows(workOrders, allowedLower)
      setSchedulingRows([...sched, ...workOrderRows])
      setProperties(props)
      const approvedAssigned = props
            .filter((p) => propertyEligibleForManagerCalendarScheduling(p, manager))
            .sort((a, b) =>
              propertyRecordName(a).localeCompare(propertyRecordName(b), undefined, { sensitivity: 'base' }),
            )

      const enabledAdminProfiles = isAdminCalendar
        ? (Array.isArray(adminProfiles) ? adminProfiles : []).filter((p) => p.enabled)
        : []
      setCalendarProfiles(enabledAdminProfiles)

      const byProperty = {}
      if (isAdminCalendar) {
        enabledAdminProfiles.forEach((profile) => {
          const text = String(profile.meetingAvailability || '').trim()
          byProperty[profile.id] = text ? weeklyFreeArraysFromTourText(text) : emptyWeeklyFreeArrays()
        })
      } else {
        approvedAssigned.forEach((property) => {
          const text = extractMultilineNoteValue(property.Notes, 'Tour Availability') || ''
          byProperty[property.id] = text ? weeklyFreeArraysFromTourText(text) : emptyWeeklyFreeArrays()
        })
      }
      setWeeklyFreeByProperty(byProperty)
      setSelectedPropertyId((current) => {
        if (isAdminCalendar) {
          if (enabledAdminProfiles.some((p) => p.id === current)) return current
          const byEmail = enabledAdminProfiles.find((p) => String(p.email || '').toLowerCase() === String(manager?.email || '').toLowerCase())
          return byEmail?.id || enabledAdminProfiles[0]?.id || ''
        }
        if (approvedAssigned.some((p) => p.id === current)) return current
        return approvedAssigned[0]?.id || ''
      })
    } catch (err) {
      console.error('[CalendarTabPanel] load error', err)
    } finally {
      setLoading(false)
    }
  }, [manager, allowedPropertyNames, isAdminCalendar])

  useEffect(() => { load() }, [load])

  const bookedByDate = useMemo(() => {
    const events = (schedulingRows || []).map((row) => eventFromSchedulingRow(row))
    const m = new Map()
    for (const ev of events) {
      const d = String(ev.dateKey || '').trim()
      if (!d) continue
      if (!m.has(d)) m.set(d, [])
      m.get(d).push(ev.source)
    }
    return m
  }, [schedulingRows])

  const scheduledItemsForSelectedDay = useMemo(
    () => bookedByDate.get(selectedDateKey) || [],
    [bookedByDate, selectedDateKey],
  )

  const approvedAssignedProperties = useMemo(() => {
    if (isAdminCalendar) {
      return properties
        .filter((p) => isPropertyRecordApproved(p))
        .sort((a, b) =>
          propertyRecordName(a).localeCompare(propertyRecordName(b), undefined, { sensitivity: 'base' }),
        )
    }
    return properties
      .filter((p) => propertyEligibleForManagerCalendarScheduling(p, manager))
      .sort((a, b) =>
        propertyRecordName(a).localeCompare(propertyRecordName(b), undefined, { sensitivity: 'base' }),
      )
  }, [properties, manager, isAdminCalendar])

  const selectedProperty = useMemo(
    () => approvedAssignedProperties.find((p) => p.id === selectedPropertyId) || null,
    [approvedAssignedProperties, selectedPropertyId],
  )

  const selectedCalendarProfile = useMemo(
    () => calendarProfiles.find((p) => p.id === selectedPropertyId) || null,
    [calendarProfiles, selectedPropertyId],
  )

  const availabilityOwnerOptions = useMemo(() => {
    if (isAdminCalendar) {
      return calendarProfiles.map((profile) => ({
        id: profile.id,
        label: profile.name || profile.email,
      }))
    }
    return approvedAssignedProperties.map((p) => ({ id: p.id, label: propertyRecordName(p) || 'Property' }))
  }, [isAdminCalendar, calendarProfiles, approvedAssignedProperties])

  const selectedWeeklyFree = useMemo(
    () => weeklyFreeByProperty[selectedPropertyId] || emptyWeeklyFreeArrays(),
    [weeklyFreeByProperty, selectedPropertyId],
  )

  function handleSelectDate(key) {
    setSelectedDateKey(key)
    setAnchorDate(dateFromCalendarKey(key))
  }

  async function handleSaveAvailability() {
    if (isAdminCalendar) {
      if (!selectedCalendarProfile) {
        toast.error('Select an admin profile first')
        return
      }
      setAvailSaving(true)
      try {
        const encoded = encodeTourAvailabilityFromWeeklyFree(selectedWeeklyFree)
        await updateAdminMeetingAvailability(selectedCalendarProfile.id, encoded)
        setCalendarProfiles((current) =>
          current.map((profile) =>
            profile.id === selectedCalendarProfile.id
              ? { ...profile, meetingAvailability: encoded }
              : profile,
          ),
        )
        toast.success(`Availability saved for ${selectedCalendarProfile.name || selectedCalendarProfile.email}`)
      } catch (err) {
        toast.error(err.message || 'Could not save availability')
      } finally {
        setAvailSaving(false)
      }
      return
    }
    if (!selectedProperty) {
      toast.error('Select a property first')
      return
    }
    setAvailSaving(true)
    try {
      const encoded = encodeTourAvailabilityFromWeeklyFree(selectedWeeklyFree)
      const updated = await updatePropertyAdmin(selectedProperty.id, {
        Notes: buildTourNotesText(selectedProperty.Notes, { manager: manager?.name || '', availability: encoded }),
      })
      setProperties((current) => current.map((item) => (item.id === updated.id ? updated : item)))
      toast.success(`Availability saved for ${propertyRecordName(selectedProperty) || 'property'}`)
    } catch (err) {
      toast.error(err.message || 'Could not save availability')
    } finally {
      setAvailSaving(false)
    }
  }

  function handleClearDay() {
    if (!selectedPropertyId) return
    const abbr = weekdayAbbrFromDateKey(selectedDateKey)
    setWeeklyFreeByProperty((prev) => {
      const base = prev[selectedPropertyId] || emptyWeeklyFreeArrays()
      const next = cloneWeeklyArrays(base)
      next[abbr] = []
      return { ...prev, [selectedPropertyId]: next }
    })
  }

  const calendarStats = useMemo(() => {
    const today = new Date()
    const todayStr = dateKeyFromDate(today)
    const weekStart = startOfWeekSunday(today)
    let weekCount = 0
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart)
      d.setDate(d.getDate() + i)
      weekCount += bookedByDate.get(dateKeyFromDate(d))?.length || 0
    }
    const monthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
    const monthCount = schedulingRows.filter((r) => String(r['Preferred Date'] || '').trim().slice(0, 7) === monthStr).length
    return {
      today: bookedByDate.get(todayStr)?.length || 0,
      week: weekCount,
      month: monthCount,
      total: schedulingRows.length,
    }
  }, [schedulingRows, bookedByDate])

  return (
    <div className="mb-10">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h2 className="mr-auto w-full text-2xl font-black text-slate-900 sm:w-auto">Calendar</h2>
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:ml-auto sm:w-auto sm:flex-nowrap">
          <div className={MANAGER_PILL_SELECT_WRAP_CLS}>
            <select
              value={selectedPropertyId}
              onChange={(e) => setSelectedPropertyId(e.target.value)}
              disabled={!availabilityOwnerOptions.length}
              className={MANAGER_PILL_SELECT_CLS}
            >
              {availabilityOwnerOptions.length ? (
                availabilityOwnerOptions.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))
              ) : (
                <option value="">{isAdminCalendar ? 'No enabled admins' : 'No listed properties'}</option>
              )}
            </select>
            {MANAGER_PILL_SELECT_CHEVRON}
          </div>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className={MANAGER_PILL_REFRESH_CLS}
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="mb-5 grid gap-2 rounded-[28px] border border-slate-200 bg-slate-50 p-2 sm:grid-cols-2 xl:grid-cols-4">
        <button
          type="button"
          onClick={() => {
            const t = new Date()
            const k = dateKeyFromDate(t)
            setSelectedDateKey(k)
            setAnchorDate(t)
          }}
          className="rounded-2xl border border-transparent px-4 py-3 text-left text-slate-600 transition hover:border-slate-200 hover:bg-white"
        >
          <div className="text-lg font-black leading-none tabular-nums text-slate-900">{calendarStats.today}</div>
          <div className="mt-1 text-sm font-semibold">Today</div>
        </button>
        <button
          type="button"
          onClick={() => {
            const d = startOfWeekSunday(new Date())
            const k = dateKeyFromDate(d)
            setSelectedDateKey(k)
            setAnchorDate(d)
          }}
          className="rounded-2xl border border-transparent px-4 py-3 text-left text-slate-600 transition hover:border-slate-200 hover:bg-white"
        >
          <div className="text-lg font-black leading-none tabular-nums text-slate-900">{calendarStats.week}</div>
          <div className="mt-1 text-sm font-semibold">This week</div>
        </button>
        <button
          type="button"
          onClick={() => {
            const d = new Date()
            const first = new Date(d.getFullYear(), d.getMonth(), 1)
            const k = dateKeyFromDate(first)
            setSelectedDateKey(k)
            setAnchorDate(first)
          }}
          className="rounded-2xl border border-transparent px-4 py-3 text-left text-slate-600 transition hover:border-slate-200 hover:bg-white"
        >
          <div className="text-lg font-black leading-none tabular-nums text-slate-900">{calendarStats.month}</div>
          <div className="mt-1 text-sm font-semibold">This month</div>
        </button>
        <div className="rounded-2xl border border-transparent px-4 py-3 text-left text-slate-600">
          <div className="text-lg font-black leading-none tabular-nums text-slate-900">{calendarStats.total}</div>
          <div className="mt-1 text-sm font-semibold">Total booked</div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <AvailabilityCalendar
          view={view}
          anchorDate={anchorDate}
          selectedDateKey={selectedDateKey}
          onSelectDate={handleSelectDate}
          weeklyFree={selectedWeeklyFree}
          bookedByDate={bookedByDate}
        />
        <AvailabilityEditorPanel
          selectedDateKey={selectedDateKey}
          ranges={timeRangesFromWeeklyFree(selectedWeeklyFree, weekdayAbbrFromDateKey(selectedDateKey))}
          onRangesChange={(ranges) => {
            if (!selectedPropertyId) return
            const abbr = weekdayAbbrFromDateKey(selectedDateKey)
            setWeeklyFreeByProperty((prev) => {
              const base = prev[selectedPropertyId] || emptyWeeklyFreeArrays()
              return { ...prev, [selectedPropertyId]: weeklyFreeWithDayRanges(base, abbr, ranges) }
            })
          }}
          onOpenMeet={() => setMeetOpen(true)}
          onSave={handleSaveAvailability}
          onClearDay={handleClearDay}
          scheduledItems={scheduledItemsForSelectedDay}
          availSaving={availSaving}
          manager={manager}
          propertyOptions={availabilityOwnerOptions}
          selectedPropertyId={selectedPropertyId}
          onSelectProperty={setSelectedPropertyId}
          calendarMode={calendarMode}
        />
      </div>
    </div>
  )
}

// ─── ManagerDashboard ─────────────────────────────────────────────────────────
const MANAGER_DASH_TABS = [
  ['dashboard', 'Dashboard'],
  ['properties', 'Properties'],
  ['leases', 'Leases'],
  ['applications', 'Applications'],
  ['payments', 'Payments'],
  ['workorders', 'Work orders'],
  ['calendar', 'Calendar'],
  ['inbox', 'Inbox'],
  ['profile', 'Profile'],
]

const MANAGER_NAV_ITEMS = MANAGER_DASH_TABS.map(([id, label]) => ({ id, label }))

function ManagerDashboard({ manager: managerProp, openDraftId, onOpenDraft, onCloseDraft, onSignOut, onManagerUpdate }) {
  const [manager, setManager] = useState(managerProp)
  const [dashView, setDashView] = useState(() => {
    const h = window.location.hash.slice(1)
    return MANAGER_DASH_TABS.some(([id]) => id === h) ? h : 'dashboard'
  })
  useEffect(() => { window.location.hash = dashView }, [dashView])
  const [drafts, setDrafts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showGenerateModal, setShowGenerateModal] = useState(false)
  const [filters, setFilters] = useState({ status: '', property: '' })
  const [propertyRecords, setPropertyRecords] = useState([])
  const [billingLoading, setBillingLoading] = useState(false)
  const [overviewStats, setOverviewStats] = useState(null)
  const [overviewStatsLoading, setOverviewStatsLoading] = useState(false)
  const [overviewDataWarnings, setOverviewDataWarnings] = useState([])
  const [leasesLoadError, setLeasesLoadError] = useState('')
  const [inboxUnopenedCount, setInboxUnopenedCount] = useState(0)

  const managerScope = useMemo(() => computeManagerScope(propertyRecords, manager), [propertyRecords, manager])
  const scopedPropertyOptions = useMemo(
    () => Array.from(managerScope.assignedNames || managerScope.approvedNames).sort(),
    [managerScope.assignedNames, managerScope.approvedNames],
  )
  /** Calendar / tour scheduling: Axis-approved houses only */
  const approvedScopedPropertyOptions = useMemo(
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

  const loadDrafts = useCallback(async () => {
    setLoading(true)
    setLeasesLoadError('')
    try {
      const rows = await fetchLeaseDrafts({ ...filters, status: '' })
      const names = managerScope.approvedNames
      let scoped =
        names.size > 0 ? rows.filter((d) => leaseDraftInScope(d, names)) : []
      scoped = scoped.filter((d) => leaseDraftMatchesQueueFilter(d.Status, filters.status))
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
    if (dashView !== 'leases') onCloseDraft?.()
  }, [dashView, onCloseDraft])

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

        const pendingApps = apps.filter((a) => deriveApplicationApprovalState(a) === 'pending').length
        const leasePending = dr.filter((d) => LEASE_STATUSES_NEEDING_ACTION.has(String(d.Status || '').trim())).length
        const rentOverdue = rentRows.filter((p) => isPaymentOverdueRecord(p)).length
        const openWo = wo.filter((w) => !workOrderIsResolvedRecord(w)).length
        const todayKey = dateKeyFromDate(new Date())
        const upcomingEvents = buildCalendarEvents(dr, wo, apps).filter((ev) => ev.date >= todayKey).length

        setOverviewStats({
          pendingApps,
          leasePending,
          rentOverdue,
          openWo,
          upcomingEvents,
        })
      })
      .finally(() => {
        if (!cancelled) setOverviewStatsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [dashView, managerScope.approvedNames, approvedNamesLower])

  // Unopened threads for dashboard badge (same rule as inbox: never opened, or new messages since last open)
  useEffect(() => {
    const email = String(manager?.email || '').trim()
    if (!email || !portalInboxAirtableConfigured()) return
    let cancelled = false
    async function fetchUnopenedCount() {
      try {
        const [msgs, stateMap] = await Promise.all([
          getAllPortalInternalThreadMessages(),
          fetchInboxThreadStateMap(email),
        ])
        const latestByThread = new Map()
        for (const m of msgs) {
          const tk = portalInboxThreadKeyFromRecord(m)
          if (!tk) continue
          const ts = m.Timestamp ? new Date(m.Timestamp) : null
          if (!ts) continue
          const prev = latestByThread.get(tk)
          if (!prev || ts > prev) latestByThread.set(tk, ts)
        }
        let unopened = 0
        for (const [tk, latest] of latestByThread) {
          const state = stateMap.get(tk)
          if (!state?.lastReadAt || latest > state.lastReadAt) unopened++
        }
        if (!cancelled) setInboxUnopenedCount(unopened)
      } catch {
        // non-fatal
      }
    }
    fetchUnopenedCount()
    return () => { cancelled = true }
  }, [manager])

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

  const leaseFilterCardId = useMemo(() => {
    const s = filters.status
    if (!s) return 'all'
    if (s === '__draft_ready__') return 'draft_ready'
    if (s === '__sent_to_resident__') return 'sent_to_resident'
    if (s === '__signed__') return 'signed'
    return 'all'
  }, [filters.status])

  const leaseFilterItems = useMemo(() => {
    const total = drafts.length
    const flow = LEASE_FLOW_CARDS.map((card) => ({
      id: card.id,
      label: card.label,
      value: String(drafts.filter((d) => card.match(String(d.Status || '').trim())).length),
      hint: 'In queue',
      tone: card.id === 'draft_ready' ? 'amber' : card.id === 'signed' ? 'emerald' : 'axis',
    }))
    return [
      { id: 'all', label: 'All', value: String(total), hint: 'Every stage', tone: 'slate' },
      ...flow,
    ]
  }, [drafts])

  function setLeaseFilterCardId(cardId) {
    const map = {
      all: '',
      draft_ready: '__draft_ready__',
      sent_to_resident: '__sent_to_resident__',
      signed: '__signed__',
    }
    setFilters((f) => ({ ...f, status: map[cardId] ?? '' }))
  }

  function handleGenerated(newDraft) {
    setDrafts(prev => [{ id: newDraft.id, ...newDraft }, ...prev])
  }

  const canReview = status => ['Draft Generated', 'Under Review', 'Changes Needed'].includes(status)

  async function handleBillingPortal() {
    if (isManagerInternalPreview(manager)) {
      toast.error('Billing is not available in preview mode')
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
      toast.error(err.message || 'Could not open billing portal')
      setBillingLoading(false)
    }
  }

  const managerUserMeta = [manager.role, manager.managerId].filter(Boolean).join(' · ') || undefined

  return (
    <>
      <PortalShell
        brandTitle="Axis"
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
          <ManagerProfilePanel manager={manager} onManagerUpdate={handleManagerUpdate} />
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
        ) : dashView === 'calendar' ? (
          <CalendarTabPanel manager={manager} allowedPropertyNames={approvedScopedPropertyOptions} />
        ) : dashView === 'inbox' ? (
          <ManagerInboxPage manager={manager} allowedPropertyNames={scopedPropertyOptions} />
        ) : dashView === 'dashboard' ? (
          <ManagerDashboardHomePanel
            manager={manager}
            approvedHouseCount={managerScope.approvedNames.size}
            stats={overviewStats}
            statsLoading={overviewStatsLoading}
            dataWarnings={overviewDataWarnings}
            onNavigate={setDashView}
            inboxUnopenedCount={inboxUnopenedCount}
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
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <h2 className="mr-auto w-full text-2xl font-black text-slate-900 sm:w-auto">Leases</h2>

          <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:ml-auto sm:w-auto sm:flex-nowrap">
            <div className={MANAGER_PILL_SELECT_WRAP_CLS}>
              <select
                value={filters.property}
                onChange={e => setFilters(f => ({ ...f, property: e.target.value }))}
                className={MANAGER_PILL_SELECT_CLS}
              >
                <option value="">All your properties</option>
                {scopedPropertyOptions.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              {MANAGER_PILL_SELECT_CHEVRON}
            </div>

            <button type="button" onClick={loadDrafts} className={MANAGER_PILL_REFRESH_CLS}>
              Refresh
            </button>
          </div>
        </div>

        <div className="mb-5 grid gap-2 rounded-[28px] border border-slate-200 bg-slate-50 p-2 sm:grid-cols-2 xl:grid-cols-4">
          {leaseFilterItems.map(({ id, label, value }) => (
            <button
              key={id}
              type="button"
              onClick={() => { setLeaseFilterCardId(id) }}
              className={`rounded-2xl border px-4 py-3 text-left transition ${
                leaseFilterCardId === id
                  ? 'border-[#2563eb]/30 bg-white text-slate-900 shadow-[0_10px_24px_rgba(37,99,235,0.14)]'
                  : 'border-transparent text-slate-600 hover:border-slate-200 hover:bg-white/70 hover:text-slate-900'
              }`}
            >
              <div className="text-lg font-black leading-none tabular-nums text-slate-900">{value}</div>
              <div className="mt-1 text-sm font-semibold">{label}</div>
            </button>
          ))}
        </div>

        {/* Drafts table */}
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
          {loading ? (
            <div className="px-6 py-16 text-center text-sm text-slate-500">Loading lease queue…</div>
          ) : drafts.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <div className="mb-3 text-4xl" aria-hidden>📄</div>
              <div className="text-sm font-semibold text-slate-700">No leases yet</div>
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
                        <StatusBadge status={leaseUiStatusLabel(draft['Status'])} />
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

        {openDraftId ? (
          <div className="mt-6">
            <LeaseEditor draftId={openDraftId} manager={manager} onBack={onCloseDraft} embedded />
          </div>
        ) : null}

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
function LeaseEditor({ draftId, manager, onBack, embedded = false }) {
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

      // Auto-transition to manager review when the draft is first opened
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

  // ── Approve → publish to portal → SignForge e-sign email (one step) ───────
  async function handleApprove() {
    setActionLoading('approve')
    try {
      const now = new Date().toISOString()
      const updated = await patchLeaseDraft(draftId, {
        'Manager Edited Content': editorContent,
        'Manager Notes': managerNotes,
        'Status': 'Published',
        'Approved By': manager.name,
        'Approved At': now,
        'Published At': now,
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
      await logAudit({
        leaseDraftId: draftId,
        actionType: 'Published',
        performedBy: manager.name,
        performedByRole: manager.role,
        notes: `Published to resident portal by ${manager.name}`,
      })
      await refreshAudit()

      const sfRes = await fetch('/api/portal?action=signforge-send-lease', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leaseDraftId: draftId,
          performedBy: manager.name,
          performedByRole: manager.role,
        }),
      })
      const sfData = await readJsonResponse(sfRes)
      if (sfRes.ok) {
        if (sfData.draft) {
          setDraft(sfData.draft)
        } else {
          setDraft(await fetchLeaseDraft(draftId))
        }
        await refreshAudit()
        toast.success('Lease sent to the resident for signature')
      } else if (sfRes.status === 501) {
        toast.success(
          'Lease approved and published. Add SIGNFORGE_API_KEY to your server environment to email the lease for signature',
        )
      } else {
        toast.error(
          sfData.error ||
          'Lease is visible to the resident, but the signing email did not go out. Use "Resend signing link" to retry',
        )
      }
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
      toast.success('Lease sent via SignForge — the resident receives a signing link by email')
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
      <div className={embedded ? 'rounded-3xl border border-slate-200 bg-white px-6 py-12 text-center' : 'flex min-h-screen items-center justify-center bg-slate-50'}>
        <div className="text-sm text-slate-500">Loading draft…</div>
      </div>
    )
  }

  return (
    <div className={embedded ? 'overflow-hidden rounded-3xl border border-slate-200 bg-slate-50' : 'flex min-h-screen flex-col bg-slate-50'}>
      {/* Editor header */}
      <header className={`${embedded ? '' : 'sticky top-0 z-10'} border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-6`}>
        <div className={`${embedded ? '' : 'mx-auto max-w-7xl'} flex items-center gap-3`}>
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
                {actionLoading === 'approve' ? 'Sending…' : 'Send to resident'}
              </button>
            )}
            {canPublish && (
              <button
                onClick={handlePublish}
                disabled={!!actionLoading}
                className="rounded-xl bg-[#2563eb] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
              >
                {actionLoading === 'publish' ? 'Sending…' : 'Send to resident'}
              </button>
            )}
            {canSignforgeSend && (
              <button
                type="button"
                onClick={handleSignforgeSend}
                disabled={!!actionLoading}
                className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-800 transition hover:bg-violet-100 disabled:opacity-50"
              >
                {actionLoading === 'signforge' ? 'Sending…' : 'Resend signing link'}
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
            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
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
            <div className="overflow-hidden rounded-3xl border border-amber-200 bg-white">
              <div className="border-b border-amber-200 bg-amber-50 px-5 py-2.5">
                <span className="text-xs font-semibold text-amber-700">
                  Read-only · original AI-generated draft · not shown to residents
                </span>
              </div>
              <div className="h-[calc(100vh-310px)] min-h-[480px] overflow-y-auto p-6">
                <pre className="whitespace-pre-wrap font-mono text-sm leading-7 text-slate-800">
                  {draft?.['AI Draft Content'] || 'No AI draft content stored'}
                </pre>
              </div>
            </div>
          )}

          {/* ── Audit Log tab ── */}
          {activeTab === 'audit' && (
            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-6 py-4">
                <h3 className="font-black text-slate-900">Audit Trail</h3>
                <p className="mt-0.5 text-sm text-slate-500">
                  Complete history of every action taken on this lease draft.
                </p>
              </div>
              {auditLog.length === 0 ? (
                <div className="px-6 py-10 text-center text-sm text-slate-500">No audit entries recorded yet</div>
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
          <div className="rounded-3xl border border-slate-200 bg-white p-5">
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
            <div className="rounded-3xl border border-green-200 bg-green-50 p-5">
              <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-green-600">Approval Record</div>
              <div className="space-y-2">
                {draft?.['Approved By']  && <DetailRow label="Approved by" value={draft['Approved By']} />}
                {draft?.['Approved At']  && <DetailRow label="Approved"    value={fmtDateTime(draft['Approved At'])} />}
                {draft?.['Published At'] && <DetailRow label="Published"   value={fmtDateTime(draft['Published At'])} />}
              </div>
            </div>
          )}

          {/* Internal notes */}
          <div className="rounded-3xl border border-slate-200 bg-white p-5">
            <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Internal Notes</div>
            <p className="mb-3 text-xs text-slate-500">Visible to managers only — not shown to residents</p>
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
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
              <div className="text-sm font-semibold text-slate-700">Ready to send?</div>
              <p className="mt-1.5 text-sm text-slate-500">
                Save your edits, then click <strong>Send to resident</strong>. That makes the lease visible in the resident portal and emails the signing link when SignForge is configured.
              </p>
            </div>
          )}
          {canPublish && (
            <div className="rounded-3xl border border-axis/20 bg-axis/5 p-5">
              <div className="text-sm font-semibold text-axis">Legacy lease waiting to send</div>
              <p className="mt-1.5 text-sm text-axis/80">
                This lease is in an older intermediate state. Use <strong>Send to resident</strong>, then resend the signing link if needed.
              </p>
            </div>
          )}
          {status === 'Published' && (
            <div className="rounded-3xl border border-violet-200 bg-violet-50/80 p-5">
              <div className="text-sm font-semibold text-violet-900">E-sign (SignForge)</div>
              <p className="mt-1.5 text-sm text-violet-800/90">
                New leases are emailed for signature when you send them to the resident. If sending failed or this lease predates that flow, use <strong>Resend signing link</strong> in the header (
                <a className="underline font-medium" href="https://signforge.io/dashboard" target="_blank" rel="noreferrer">
                  SignForge
                </a>
                , <code className="rounded bg-violet-100 px-1 text-[11px]">SIGNFORGE_API_KEY</code>).
              </p>
            </div>
          )}
          {['Published', 'Signed'].includes(status) && (
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
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
                {actionLoading === 'approve' ? 'Sending…' : 'Send to resident'}
              </button>
            )}
            {canPublish && (
              <button onClick={handlePublish} disabled={!!actionLoading} className="w-full rounded-2xl bg-[#2563eb] py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50">
                {actionLoading === 'publish' ? 'Sending…' : 'Send to resident'}
              </button>
            )}
            {canSignforgeSend && (
              <button
                type="button"
                onClick={handleSignforgeSend}
                disabled={!!actionLoading}
                className="w-full rounded-2xl border border-violet-200 bg-violet-50 py-3 text-sm font-semibold text-violet-800 transition hover:bg-violet-100 disabled:opacity-50"
              >
                {actionLoading === 'signforge' ? 'Sending…' : 'Resend signing link'}
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
  }

  function handleSignOut() {
    sessionStorage.removeItem(MANAGER_SESSION_KEY)
    setManager(null)
    setAuthChecked(true)
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
  }

  function handleCloseDraft() {
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

  return (
    <ManagerDashboard
      manager={manager}
      openDraftId={openDraftId}
      onOpenDraft={handleOpenDraft}
      onCloseDraft={handleCloseDraft}
      onSignOut={handleSignOut}
      onManagerUpdate={handleManagerUpdate}
    />
  )
}

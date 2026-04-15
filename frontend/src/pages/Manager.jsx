// ─── Axis Manager Portal ──────────────────────────────────────────────────────
// Route: /manager
//
// This is the internal manager-only interface for reviewing, editing, and
// approving AI-generated lease drafts before they are visible to residents.
//
// Workflow enforced by this page:
//   Draft Generated → Under Review → Published (+ SignForge) → Signed
//
// Residents see only "Published" or "Signed" leases in their portal.
// Every action (open, edit, approve, reject, publish) is written to Audit Log.
//
// Components:
//   Unauthenticated /manager → redirects to /portal?portal=manager (shared portal hub)
//   GenerateDraftModal — form to create a new AI lease draft
//   ManagerDashboard   — filterable table of all lease drafts
//   LeaseEditor        — full-screen editor for lease text + header actions (publish / send)
//   Manager (default)  — root component managing session + view routing

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import toast from 'react-hot-toast'
import { HOUSING_CONTACT_MESSAGE } from '../lib/housingSite'
import {
  workOrderScheduledMeta,
  workOrderPhotoAttachmentUrls,
  normalizeWorkOrderScheduleDateKey,
} from '../lib/workOrderShared.js'
import { readJsonResponse } from '../lib/readJsonResponse'
import { PORTAL_TAB_H2_CLS, PORTAL_SECTION_TITLE_CLS } from '../lib/portalTabHeader'
import {
  CALENDAR_EVENT_TYPES,
  eventFromSchedulingRow,
  normalizeEventType,
} from '../lib/calendarEventModel'
import {
  AXIS_SCHEDULING_CHANGED_EVENT,
  dispatchAxisSchedulingChanged,
} from '../lib/portalCalendarSync.js'
import {
  airtableFieldScalar,
  availabilityTablesAreSplit,
  buildAdminMeetingAvailabilityConfig,
  buildGlobalAdminFreeRangesMapByDate,
  buildManagerAvailabilityConfig,
  intervalFromMaRecord,
  mergePropertyAvailabilityRanges,
  normalizeDateKey,
  normalizeWeekdayAbbr,
  recordIsGlobalAdminRow,
  slotLabelFromRange,
  expandMinuteRangesToCanonicalTourSlotLabels,
  parseTourTimeSlotLabelToMinutesRange,
} from '../../../shared/manager-availability-merge.js'
import {
  listManagerAvailabilityForProperty,
  listManagerAvailabilityForManagerEmail,
  createManagerAvailabilityRecordsBatch,
  createAdminMeetingAvailabilityRecord,
  deleteManagerAvailabilityRecord,
  deleteAdminMeetingAvailabilityRecord,
  buildAdminMeetingAvailabilityRecordFields,
  buildManagerAvailabilitySlotRowFields,
  formatHHmmFromMinutes,
  listAdminMeetingAvailabilityRows,
  listManagerAvailabilityRows,
} from '../lib/managerAvailabilityAirtable.js'
import ManagerInboxPage from '../components/manager-inbox/ManagerInboxPage'
import {
  getWorkOrderById,
  updateWorkOrder,
  getAllWorkOrders,
  listAllResidentsRecords,
  workOrderLinkedResidentRecordIds,
  workOrderLinkedPropertyRecordIds,
  resolveResidentRecordIdForWorkOrderBilling,
  getAllPaymentsRecords,
  getLeaseDraftsForResident,
  getPaymentsForResident,
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
  siteManagerThreadKey,
  housingPublicAdminPropertyThread,
  HOUSING_PUBLIC_ADMIN_GENERAL_THREAD,
  fetchBlockedTourDates,
  createBlockedTourDate,
  deleteBlockedTourDate,
  getApplicationsForOwner,
} from '../lib/airtable'
import {
  ROOM_CLEANING_FEE_USD,
  ensurePostpayRoomCleaningFeePayment,
  workOrderShouldCreatePaymentWhenScheduled,
} from '../lib/roomCleaningWorkOrder.js'
import { residentLeasingThreadVisibleToManager } from '../lib/portalInboxResidentScope.js'
import {
  classifyResidentPaymentLine,
  formatPaymentNotesForDisplay,
  getPaymentKind,
  isPostpayRoomCleaningPaymentRecord,
  listDashboardDuePaymentLines,
  managerPaymentLineDisplayTitle,
} from '../lib/residentPaymentsShared.js'
import {
  buildPropertyWizardInitialValues,
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
import { portalChromeSecondaryButtonClass } from '../lib/portalLayout.js'
import { PortalEmptyVisual } from '../components/portalNavIcons.jsx'
import AddPropertyWizard from '../components/AddPropertyWizard'
import { PropertyDetailPanel } from '../lib/propertyDetailPanel.jsx'
import { ApplicationDetailPanel, applicationViewModelFromAirtableRow } from '../lib/applicationDetailPanel.jsx'
import LeaseHTMLTemplate from '../components/LeaseHTMLTemplate.jsx'
import LeaseManagerSignPanel from '../components/LeaseManagerSignPanel.jsx'
import { pickManagerSignatureFromDraft } from '../../../shared/lease-manager-signature-fields.js'
import {
  PortalOpsCard,
  PortalOpsEmptyState,
  PortalOpsStatusBadge,
} from '../components/PortalOpsUI'
import {
  deriveApplicationApprovalState,
  applicationRejectedFieldName,
  leaseDraftPassesApplicationApprovalGate,
} from '../lib/applicationApprovalState.js'
import {
  paymentsIndicateFirstMonthRentPaid,
  paymentsIndicateSecurityDepositPaid,
} from '../../../shared/lease-access-requirements.js'
import ManagerLeasingTab from './ManagerLeasingTab.jsx'
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
  Draft: { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200', dot: 'bg-slate-400' },
  'Admin review': { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', dot: 'bg-blue-500' },
  'Manager Review': { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', dot: 'bg-orange-500' },
  'With resident': { bg: 'bg-axis/5', text: 'text-axis', border: 'border-axis/20', dot: 'bg-axis' },
  'Draft Generated': { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', dot: 'bg-blue-400' },
  'Under Review': { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', dot: 'bg-amber-400' },
  Approved: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200', dot: 'bg-green-500' },
  Published: { bg: 'bg-axis/5', text: 'text-axis', border: 'border-axis/20', dot: 'bg-axis' },
  Signed: { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', dot: 'bg-purple-500' },
}

const ALL_STATUSES = Object.keys(STATUS_CONFIG)
const LEASE_FLOW_CARDS = [
  {
    id: 'draft_ready',
    label: 'Manager Review',
    match: (status) =>
      ['Draft Generated', 'Under Review', 'Changes Needed', 'Approved', 'Sent Back to Manager'].includes(status),
    activeStatuses: ['Draft Generated', 'Under Review', 'Changes Needed', 'Approved', 'Sent Back to Manager'],
    cls: 'border-amber-200 bg-amber-50 text-amber-700',
  },
  {
    id: 'sent_to_resident',
    label: 'With Resident',
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
  if (['Draft Generated', 'Under Review', 'Changes Needed', 'Approved', 'Sent Back to Manager'].includes(normalized)) {
    return 'Manager Review'
  }
  if (
    ['Submitted to Admin', 'Admin In Review', 'Changes Made', 'Manager Approved', 'Ready for Signature'].includes(
      normalized,
    )
  ) {
    return 'Admin review'
  }
  if (normalized === 'Published') return 'With resident'
  if (normalized === 'Signed') return 'Signed'
  return normalized || 'Manager Review'
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

function managerProfilePropertyRefs(manager) {
  const recordIds = new Set()
  const names = new Set()
  const keys = [
    'Assigned Properties',
    'Approved Properties',
    'Properties',
    'Property Access',
    'House Access',
  ]
  for (const key of keys) {
    const raw = manager?.[key]
    if (raw == null) continue
    const values = Array.isArray(raw)
      ? raw
      : String(raw)
          .split(/,|\n/)
          .map((v) => v.trim())
          .filter(Boolean)
    for (const value of values) {
      const text = String(value || '').trim()
      if (!text) continue
      if (/^rec[a-zA-Z0-9]{8,}$/.test(text)) {
        recordIds.add(text)
      } else {
        names.add(text.toLowerCase())
      }
    }
  }
  return { recordIds, names }
}

function propertyMatchesManagerProfileRef(propertyRecord, manager) {
  const refs = managerProfilePropertyRefs(manager)
  const propertyId = String(propertyRecord?.id || '').trim()
  const propertyName = propertyRecordName(propertyRecord).trim().toLowerCase()
  if (propertyId && refs.recordIds.has(propertyId)) return true
  if (propertyName && refs.names.has(propertyName)) return true
  return false
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

  // Plain-text fallback for older rows where manager fields are not linked records.
  const managerName = String(manager?.name || '').trim().toLowerCase()
  if (managerName) {
    for (const k of ['Manager Name', 'Site Manager Name', 'Manager', 'Site Manager', 'Property Manager']) {
      const raw = p?.[k]
      if (raw == null) continue
      if (Array.isArray(raw)) {
        const hasName = raw.some((v) => String(v || '').trim().toLowerCase() === managerName)
        if (hasName) return true
      } else {
        const text = String(raw || '').trim().toLowerCase()
        if (text && text === managerName) return true
      }
    }
  }

  return false
}

/** Listed + on marketing (same bar as Properties → Listed); calendar availability / tour slots only for these. */
function propertyEligibleForManagerCalendarScheduling(p, manager) {
  return propertyAssignedToManager(p, manager)
}

function propertyNameInAllowedScope(p, allowedPropertyNames) {
  const allowed = new Set((allowedPropertyNames || []).map((name) => String(name).trim().toLowerCase()).filter(Boolean))
  if (!allowed.size) return false
  const n = propertyRecordName(p).toLowerCase()
  return !!n && allowed.has(n)
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
    if (!propertyAssignedToManager(p, manager) && !propertyMatchesManagerProfileRef(p, manager)) continue
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

/** Union of assigned + approved names. (`new Set() || x` is wrong — empty Set is truthy.) */
function mergedManagerPropertyNames(scope) {
  const out = new Set()
  if (scope?.assignedNames?.size) for (const n of scope.assignedNames) out.add(n)
  if (scope?.approvedNames?.size) for (const n of scope.approvedNames) out.add(n)
  return out
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
  return getPaymentKind(p) === 'rent'
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
  // Prefer plain-text name fields; skip linked-record arrays (contain IDs, not names)
  const candidates = [w['Property Name'], w.Property, w['House']]
  for (const v of candidates) {
    if (!v) continue
    if (Array.isArray(v)) continue // linked record IDs — not useful as a name
    const s = String(v).trim()
    if (s) return s
  }
  return ''
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

function residentHouseRecordIds(resident) {
  const out = []
  for (const key of ['House', 'Property', 'Properties']) {
    const v = resident?.[key]
    if (Array.isArray(v)) {
      for (const x of v) {
        const s = String(x).trim()
        if (/^rec[a-zA-Z0-9]{14,}$/.test(s)) out.push(s)
      }
    } else if (typeof v === 'string' && /^rec[a-zA-Z0-9]{14,}$/.test(v.trim())) {
      out.push(v.trim())
    }
  }
  return out
}

function residentDisplayPropertyName(resident) {
  const explicit = String(resident?.['Property Name'] || '').trim()
  if (explicit) return explicit
  for (const key of ['Property', 'House', 'Properties']) {
    const v = resident?.[key]
    if (Array.isArray(v)) continue
    const s = String(v || '').trim()
    if (s && !/^rec[a-zA-Z0-9]{14,}$/.test(s)) return s
  }
  return ''
}

function residentBelongsToManagerScope(resident, scopeLower, scopeIds) {
  if (scopeIds?.size) {
    for (const id of residentHouseRecordIds(resident)) {
      if (scopeIds.has(id)) return true
    }
  }
  if (!scopeLower?.size) return false
  const raw = residentDisplayPropertyName(resident)
  const prop = raw.toLowerCase()
  const normalizedProp = normalizePortalScopeLabel(raw)
  if (!prop && !normalizedProp) return false
  return [...scopeLower].some((ns) => {
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

/** Resident Profile ids whose house/property is in the manager's scope (names + property record ids). */
function buildManagerScopedResidentIdSet(residents, scopeLower, scopeIds) {
  const out = new Set()
  for (const r of residents || []) {
    if (!residentBelongsToManagerScope(r, scopeLower, scopeIds)) continue
    const id = String(r?.id || '').trim()
    if (id) out.add(id)
  }
  return out
}

function workOrderInScope(w, approvedNamesLowerSet, approvedPropertyIdsSet, scopedResidentIds) {
  // Match by linked resident when the WO row has no usable property name / house link (common for resident-submitted WOs).
  if (scopedResidentIds?.size) {
    for (const rid of workOrderLinkedResidentRecordIds(w)) {
      if (scopedResidentIds.has(rid)) return true
    }
  }

  // Match by linked property record IDs (all field names createWorkOrder may use).
  if (approvedPropertyIdsSet?.size) {
    for (const id of workOrderLinkedPropertyRecordIds(w)) {
      if (approvedPropertyIdsSet.has(id)) return true
    }
  }

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

function isFeeWaivePaymentRow(record) {
  const t = String(record?.Type || record?.['Payment Type'] || '').trim().toLowerCase()
  return t === 'fee waive'
}

function paymentComputedStatus(record) {
  if (isFeeWaivePaymentRow(record)) return 'waiver'
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

/** Pending tab: match resident “Due or upcoming” — hide post-pay WO room-cleaning lines (Fees & extras on resident). */
function isManagerPendingPrimaryRow(record) {
  const st = paymentComputedStatus(record)
  if (st === 'waiver') return false
  if (!['unpaid', 'due_soon', 'partial'].includes(st)) return false
  return !isPostpayRoomCleaningPaymentRecord(record)
}

function paymentStatusLabel(status) {
  switch (status) {
    case 'paid': return 'Paid'
    case 'partial': return 'Partial'
    case 'due_soon': return 'Due Soon'
    case 'overdue': return 'Overdue'
    case 'waiver': return 'Fee waive'
    default: return 'Unpaid'
  }
}

function paymentStatusTone(status) {
  switch (status) {
    case 'paid': return 'emerald'
    case 'partial': return 'axis'
    case 'due_soon': return 'amber'
    case 'overdue': return 'red'
    case 'waiver': return 'blue'
    default: return 'slate'
  }
}

function managerToneForResidentPaymentLabel(st) {
  const s = String(st || '').trim()
  if (s === 'Paid') return 'emerald'
  if (s === 'Partial') return 'axis'
  if (s === 'Due Soon') return 'amber'
  if (s === 'Overdue') return 'red'
  return 'slate'
}

function paymentResidentLabel(record) {
  return String(
    record?.['Resident Name'] ||
      record?.Name ||
      record?.['Resident Profile'] ||
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

/** Manager-facing status aligned with workflow: Open → Scheduled → Completed (plus In Progress). */
function managerWorkOrderStatusLabel(record) {
  if (!record) return 'Open'
  if (workOrderIsResolvedRecord(record)) return 'Completed'
  const visit = workOrderScheduledMeta(record)
  const raw = String(record.Status || '').trim().toLowerCase()
  if (visit?.date || raw.includes('schedule')) return 'Scheduled'
  if (raw.includes('progress') || raw.includes('review')) return 'In Progress'
  if (raw === 'submitted' || raw === 'open' || raw === '') return 'Open'
  return 'Open'
}

function managerWorkOrderStatusTone(record) {
  const label = managerWorkOrderStatusLabel(record)
  if (label === 'Completed') return 'emerald'
  if (label === 'Scheduled') return 'axis'
  if (label === 'In Progress') return 'amber'
  return 'slate'
}

function managerWorkOrderStatusPillTone(record) {
  const label = managerWorkOrderStatusLabel(record)
  if (label === 'Completed') return 'green'
  if (label === 'Scheduled') return 'axis'
  if (label === 'In Progress') return 'amber'
  return 'slate'
}

/** Filter cards: open = not yet scheduled; scheduled = visit date set; completed = resolved. */
function managerWorkOrderBucket(record) {
  if (!record) return 'open'
  if (workOrderIsResolvedRecord(record)) return 'completed'
  if (workOrderScheduledMeta(record)?.date) return 'scheduled'
  const raw = String(record.Status || '').trim().toLowerCase()
  if (raw.includes('schedule')) return 'scheduled'
  return 'open'
}

function residentPreferredTimeWindowLabel(record) {
  const candidates = [
    record?.['Preferred Time Window'],
    record?.['Preferred Time'],
    record?.['Time Window'],
    record?.['Preferred Entry Time'],
  ]
  for (const value of candidates) {
    const text = String(value || '').trim()
    if (text) return text
  }
  return String(workOrderScheduledMeta(record)?.preferredTime || '').trim()
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

/** Availability / calendar time grid: 6:00 AM – 9:00 PM (scrollable). */
const TOUR_GRID_START_HOUR = 6
const TOUR_GRID_END_HOUR = 21
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

/** Tour grid text: dedicated Airtable fields first, then Notes `Tour Availability:` (matches admin merge pattern). */
function propertyTourAvailabilityText(property) {
  if (!property) return ''
  const explicit = String(property['Tour Availability'] || property['Calendar Availability'] || '').trim()
  const fromNotes = extractMultilineNoteValue(property['Notes'], 'Tour Availability') || ''
  return explicit || fromNotes
}

function propertyTourManagerDisplayName(property) {
  if (!property) return ''
  const col = String(property['Tour Manager'] || '').trim()
  if (col) return col
  return extractNoteValue(property['Notes'] || '', 'Tour Manager')
}

function managerAvailabilityRowIsActive(row, activeField) {
  const v = row?.[activeField]
  if (v === false || v === 0 || String(v || '').toLowerCase() === 'false') return false
  return true
}

/**
 * Sort key for manager calendar property dropdown: prefer properties with Manager Availability rows,
 * then Properties-section tour text (`Tour Availability` / Notes), then name.
 */
function propertyManagerCalendarPriorityScore(property, managerAvailRows, fieldsConfig) {
  if (!property || !fieldsConfig) return 0
  const pid = String(property.id || '').trim()
  const pname = propertyRecordName(property).trim().toLowerCase()
  let score = 0
  for (const row of managerAvailRows || []) {
    if (!managerAvailabilityRowIsActive(row, fieldsConfig.active)) continue
    const rid = airtableFieldScalar(row[fieldsConfig.propertyRecordId])
    const rpn = String(row[fieldsConfig.propertyName] || '').trim().toLowerCase()
    const matches =
      (pid && rid === pid) ||
      (pname && rpn && (pname === rpn || pname.includes(rpn) || rpn.includes(pname)))
    if (matches) score += 4
  }
  if (String(propertyTourAvailabilityText(property) || '').trim()) score += 1
  return score
}

function sortPropertiesByManagerCalendarPriority(list, managerAvailRows, env) {
  const cfg = buildManagerAvailabilityConfig(env).fields
  return [...(list || [])].sort((a, b) => {
    const sa = propertyManagerCalendarPriorityScore(a, managerAvailRows, cfg)
    const sb = propertyManagerCalendarPriorityScore(b, managerAvailRows, cfg)
    if (sb !== sa) return sb - sa
    return propertyRecordName(a).localeCompare(propertyRecordName(b), undefined, { sensitivity: 'base' })
  })
}

/** Split Scheduling-derived rows for month mini-strip / day timeline (tours vs work orders). */
function splitCalendarStripBookings(dayBookings) {
  const tours = []
  const workOrders = []
  for (const row of dayBookings || []) {
    if (row?._workOrder || normalizeEventType(row?.Type) === CALENDAR_EVENT_TYPES.WORK_ORDER) {
      workOrders.push(row)
    } else if (normalizeEventType(row?.Type) === CALENDAR_EVENT_TYPES.TOUR) {
      tours.push(row)
    }
  }
  return { tours, workOrders }
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

/** Copy one weekday’s free half-hour indices to every weekday (repeating template). */
function weeklyFreeCopySourceDayToAllDays(weeklyArrays, sourceDayAbbr) {
  const src = [...(weeklyArrays?.[sourceDayAbbr] || [])].sort((a, b) => a - b)
  const base = weeklyArrays && typeof weeklyArrays === 'object' ? weeklyArrays : emptyWeeklyFreeArrays()
  const next = cloneWeeklyArrays(base)
  for (const d of TOUR_DAYS) {
    next[d] = [...src]
  }
  return next
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

/** e.g. "750-840" minute spans from property tour text → readable range */
function formatTourAvailabilityNumericSegmentForUi(token) {
  const raw = String(token || '').trim()
  const m = raw.match(/^(\d+)-(\d+)$/)
  if (!m) return raw
  const a = Number(m[1])
  const b = Number(m[2])
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return raw
  return formatTimeRangeLabel({ start: a, end: b })
}

function parsedTourAvailabilityLinesForSidebar(rawText) {
  const lines = []
  for (const line of String(rawText || '').split(/\n|;/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const m = trimmed.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s*[:\-]\s*(.+)$/i)
    if (!m) {
      lines.push({ dayLabel: '', body: trimmed })
      continue
    }
    const dayLabel = m[1].charAt(0).toUpperCase() + m[1].slice(1, 3).toLowerCase()
    const pieces = m[2]
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .map(formatTourAvailabilityNumericSegmentForUi)
    lines.push({ dayLabel, body: pieces.join(' · ') })
  }
  return lines
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
    if (prev && range.start < prev.end) prev.end = Math.max(prev.end, range.end)
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

/** Stronger tour vs work-order hues for calendar strips and list rows */
function bookingEventStripClass(row) {
  const type = String(row.Type || '').trim().toLowerCase()
  if (type === 'work order') return 'border-amber-600 bg-amber-400/95'
  if (type === 'tour') return 'border-violet-600 bg-violet-400/95'
  if (type === 'meeting') return 'border-indigo-600 bg-indigo-400/90'
  if (type === 'issue' || type === 'other') return 'border-slate-500 bg-slate-400/90'
  return 'border-sky-600 bg-sky-400/95'
}

function bookingBadgeTone(row) {
  const type = String(row.Type || '').trim().toLowerCase()
  const approval = String(row['Manager Approval'] || '').trim().toLowerCase()
  if (type === 'availability' || type === 'meeting availability') return 'bg-emerald-50 text-emerald-800 border-emerald-200'
  if (type === 'work order') return 'bg-amber-50 text-amber-950 border-amber-300'
  if (type === 'tour') return 'bg-violet-50 text-violet-950 border-violet-300'
  if (type === 'issue' || type === 'other') return 'bg-slate-100 text-slate-700 border-slate-200'
  if (type === 'meeting') return 'bg-indigo-50 text-indigo-900 border-indigo-200'
  if (approval === 'approved') return 'bg-emerald-50 text-emerald-800 border-emerald-200'
  if (approval === 'declined') return 'bg-red-50 text-red-700 border-red-200'
  return 'bg-sky-50 text-sky-900 border-sky-300'
}

function bookingLabel(row) {
  const type = String(row.Type || '').trim().toLowerCase()
  if (type === 'availability') return 'Tour availability (saved slot)'
  if (type === 'meeting availability') return 'Meeting availability'
  if (type === 'meeting') return 'Meeting'
  if (type === 'work order') return 'Work order visit'
  if (type === 'issue' || type === 'other') return 'Issue'
  if (type === 'tour') return 'Tour booking'
  return 'Booked tour'
}

/** Month/week/day strips, day timeline, and “Items on this date” only list real bookings. */
function isWorkOrderOrScheduledTourCalendarRow(row) {
  if (!row || typeof row !== 'object') return false
  if (row._workOrder) return true
  const t = normalizeEventType(row.Type)
  return t === CALENDAR_EVENT_TYPES.WORK_ORDER || t === CALENDAR_EVENT_TYPES.TOUR
}

/**
 * Parse Scheduling `Preferred Time` for calendar layout — matches server `tour.js` and
 * `workOrderShared` (hyphen, en/em dash, "to", minute ranges, 24h HH:MM).
 */
function parsePreferredTimeRange(preferredTime) {
  const raw = String(preferredTime || '').trim()
  if (!raw) return null

  const pair = raw.match(/^(\d{1,4})-(\d{1,4})$/)
  if (pair) {
    const start = Number(pair[1])
    const end = Number(pair[2])
    if (Number.isFinite(start) && Number.isFinite(end) && end > start && start < 48 * 60 && end <= 48 * 60) {
      return {
        start: Math.max(TOUR_GRID_START_MIN, start),
        end: Math.min(TOUR_GRID_END_MIN, end),
      }
    }
  }

  const joined = raw.replace(/\s+to\s+/i, ' - ')
  const parts = joined
    .split(/\s*[\-–—]\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length !== 2) return null

  const parseLabel = (value) => {
    const v = String(value).trim()
    const hm24 = v.match(/^(\d{1,2}):(\d{2})$/)
    if (hm24) {
      const hh = Number(hm24[1])
      const mm = Number(hm24[2])
      if (Number.isFinite(hh) && Number.isFinite(mm) && hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
        return hh * 60 + mm
      }
    }
    const match = v.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i)
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

/** Mini day column: free (emerald) | tours (violet) | work orders (amber). */
function MonthDayMiniStrip({ ranges, dayBookings, blocked }) {
  const { tours, workOrders } = splitCalendarStripBookings(dayBookings)
  return (
    <div
      className="relative mt-1 h-[72px] w-full overflow-hidden rounded-xl border border-slate-200/80 bg-slate-100/80"
      aria-hidden
    >
      {blocked ? <div className="absolute inset-0 z-20 rounded-xl bg-red-200/50" /> : null}
      {!blocked ? (
        <>
          <div className="absolute inset-y-0 left-0 z-[1] w-[32%]">
            {(ranges || []).map((range) => (
              <div
                key={`a-${range.start}-${range.end}`}
                className="absolute left-0 right-0 rounded-sm bg-emerald-400/90 shadow-sm ring-1 ring-emerald-600/25"
                style={timelineBlockStyle(range.start, range.end)}
              />
            ))}
          </div>
          <div className="absolute inset-y-0 left-[33%] z-[2] w-[33%]">
            {tours.map((row) => {
              const parsed = parsePreferredTimeRange(row['Preferred Time'])
              if (!parsed) return null
              return (
                <div
                  key={row.id}
                  className="absolute left-0 right-0 rounded-sm border border-violet-600 bg-violet-400/95 shadow-sm"
                  style={timelineBlockStyle(parsed.start, parsed.end)}
                />
              )
            })}
          </div>
          <div className="absolute inset-y-0 right-0 z-[2] w-[32%]">
            {workOrders.map((row) => {
              const parsed = parsePreferredTimeRange(row['Preferred Time'])
              if (!parsed) return null
              return (
                <div
                  key={row.id}
                  className="absolute left-0 right-0 rounded-sm border border-amber-600 bg-amber-400/95 shadow-sm"
                  style={timelineBlockStyle(parsed.start, parsed.end)}
                />
              )
            })}
          </div>
        </>
      ) : null}
    </div>
  )
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

function AvailabilityCalendar({ view, anchorDate, selectedDateKey, onSelectDate, weeklyFree, bookedByDate, blockedDates, dayFreeOverrides }) {
  const y = anchorDate.getFullYear()
  const m = anchorDate.getMonth()
  const daysInMonth = new Date(y, m + 1, 0).getDate()
  const firstDow = new Date(y, m, 1).getDay()
  const todayKey = dateKeyFromDate(new Date())
  const weekStart = startOfWeekSunday(anchorDate)
  const weekDays = Array.from({ length: 7 }, (_, i) => addDaysDate(weekStart, i))

  const dayRanges = (key) => {
    if (dayFreeOverrides != null) {
      if (!Object.prototype.hasOwnProperty.call(dayFreeOverrides, key)) {
        return []
      }
      const o = dayFreeOverrides[key]
      return Array.isArray(o) ? normalizeTimeRanges(o) : []
    }
    // Manager tour template: show the same weekly pattern on every day in month/week (not only selected).
    return timeRangesFromWeeklyFree(weeklyFree, weekdayAbbrFromDateKey(key))
  }
  const bookings = (key) => bookedByDate.get(key) || []
  const isBlocked = (key) => Boolean(blockedDates?.has(key))

  const renderDayCard = (dateKey, dayLabel, dateLabel) => {
    const ranges = dayRanges(dateKey)
    const dayBookings = bookings(dateKey)
    const selected = selectedDateKey === dateKey
    const blocked = isBlocked(dateKey)
    const aria = `${dayLabel} ${dateLabel}${blocked ? ', blocked' : ''}`
    return (
      <button
        key={dateKey}
        type="button"
        onClick={() => onSelectDate(dateKey)}
        aria-label={aria}
        title={aria}
        className={classNames(
          'min-h-[118px] rounded-2xl border p-2 text-left transition',
          selected ? 'border-[#2563eb] bg-[#2563eb]/5 ring-2 ring-[#2563eb]/20' : 'border-slate-200 bg-white hover:border-slate-300',
          blocked ? 'border-red-200 bg-red-50/50' : '',
          dateKey === todayKey && !selected ? 'ring-1 ring-slate-300' : '',
        )}
      >
        <span className="sr-only">{aria}</span>
        <div className="flex items-start justify-between gap-1">
          {blocked ? (
            <span className="rounded bg-red-100 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-red-700">
              Off
            </span>
          ) : (
            <span className="inline-block w-6 shrink-0" aria-hidden />
          )}
          <span className="ml-auto text-xs font-black tabular-nums text-slate-800">{dateLabel}</span>
        </div>
        <MonthDayMiniStrip ranges={ranges} dayBookings={dayBookings} blocked={blocked} />
      </button>
    )
  }

  if (view === 'day') {
    const dateKey = dateKeyFromDate(anchorDate)
    const ranges = dayRanges(dateKey)
    const dayBookings = bookings(dateKey)
    const { tours: dayTourRows, workOrders: dayWorkOrderRows } = splitCalendarStripBookings(dayBookings)
    const timelineHours = Array.from(
      { length: TOUR_GRID_END_HOUR - TOUR_GRID_START_HOUR + 1 },
      (_, idx) => TOUR_GRID_START_HOUR + idx,
    )
    const totalHours = TOUR_GRID_END_HOUR - TOUR_GRID_START_HOUR
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="max-h-[min(78vh,900px)] overflow-y-auto overflow-x-hidden rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
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
              <div className="absolute inset-y-0 left-2 z-[1] w-[28%]">
                {ranges.map((range) => (
                  <div
                    key={`avail-${range.start}-${range.end}`}
                    className="absolute left-0 right-0 rounded-xl bg-emerald-100/95 px-2 py-1.5 text-[11px] font-semibold text-emerald-950 shadow-sm ring-1 ring-emerald-300"
                    style={timelineBlockStyle(range.start, range.end)}
                  >
                    <span className="line-clamp-3 leading-tight">{formatTimeRangeLabel(range)}</span>
                  </div>
                ))}
              </div>
              <div className="absolute inset-y-0 left-[30%] z-[2] w-[34%]">
                {dayTourRows.map((row) => {
                  const parsed = parsePreferredTimeRange(row['Preferred Time'])
                  if (!parsed) return null
                  return (
                    <div
                      key={row.id}
                      className="absolute left-0 right-0 rounded-xl border-2 border-violet-500 bg-violet-50 px-2 py-1.5 text-[11px] font-semibold text-violet-950 shadow-md"
                      style={timelineBlockStyle(parsed.start, parsed.end)}
                    >
                      <div className="font-bold">Tour</div>
                      <div className="mt-0.5 line-clamp-3 font-medium leading-tight opacity-95">
                        {[row.Name || 'Guest', row['Preferred Time']].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="absolute inset-y-0 right-2 z-[2] w-[34%]">
                {dayWorkOrderRows.map((row) => {
                  const parsed = parsePreferredTimeRange(row['Preferred Time'])
                  if (!parsed) return null
                  return (
                    <div
                      key={row.id}
                      className="absolute left-0 right-0 rounded-xl border-2 border-amber-500 bg-amber-50 px-2 py-1.5 text-[11px] font-semibold text-amber-950 shadow-md"
                      style={timelineBlockStyle(parsed.start, parsed.end)}
                    >
                      <div className="font-bold">Work order</div>
                      <div className="mt-0.5 line-clamp-3 font-medium leading-tight opacity-95">
                        {[row.Name || 'Visit', row.Property, row['Preferred Time']].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (view === 'week') {
    const timelineHours = Array.from(
      { length: TOUR_GRID_END_HOUR - TOUR_GRID_START_HOUR + 1 },
      (_, idx) => TOUR_GRID_START_HOUR + idx,
    )
    const totalHours = TOUR_GRID_END_HOUR - TOUR_GRID_START_HOUR
    const todayKey = dateKeyFromDate(new Date())
    return (
      <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="max-h-[min(78vh,900px)] overflow-auto">
          <div
            className="grid min-w-[720px] gap-0"
            style={{ gridTemplateColumns: `52px repeat(7, minmax(96px, 1fr))` }}
          >
            <div className="sticky left-0 z-30 border-b border-r border-slate-200 bg-white" />
            {weekDays.map((day) => {
              const dk = dateKeyFromDate(day)
              const selected = selectedDateKey === dk
              return (
                <button
                  key={dk}
                  type="button"
                  onClick={() => onSelectDate(dk)}
                  className={classNames(
                    'border-b border-r border-slate-200 px-1 py-2.5 text-center transition',
                    selected ? 'bg-[#2563eb]/10 ring-1 ring-inset ring-[#2563eb]/25' : 'bg-slate-50/90 hover:bg-slate-100',
                    dk === todayKey && !selected ? 'bg-sky-50/80' : '',
                  )}
                >
                  <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                    {day.toLocaleDateString('en-US', { weekday: 'short' })}
                  </div>
                  <div className="mt-0.5 text-sm font-black tabular-nums text-slate-900">
                    {day.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </div>
                </button>
              )
            })}

            <div
              className="sticky left-0 z-20 border-r border-slate-200 bg-white"
              style={{ height: TIMELINE_HEIGHT_PX }}
            >
              <div className="relative h-full">
                {timelineHours.map((hour) => {
                  const top = `${((hour - TOUR_GRID_START_HOUR) / totalHours) * 100}%`
                  return (
                    <div
                      key={hour}
                      className="absolute left-0 right-1 -translate-y-1/2 text-right text-[10px] font-semibold tabular-nums text-slate-500"
                      style={{ top }}
                    >
                      {displayTimeFromMinutes(hour * 60)}
                    </div>
                  )
                })}
              </div>
            </div>

            {weekDays.map((day) => {
              const dk = dateKeyFromDate(day)
              const ranges = dayRanges(dk)
              const dayBookings = bookings(dk)
              const { tours: colTours, workOrders: colWo } = splitCalendarStripBookings(dayBookings)
              const blocked = isBlocked(dk)
              const selected = selectedDateKey === dk
              return (
                <div
                  key={`col-${dk}`}
                  className={classNames(
                    'relative border-r border-slate-200',
                    selected ? 'bg-[#2563eb]/[0.04]' : 'bg-white',
                  )}
                  style={{ height: TIMELINE_HEIGHT_PX }}
                >
                  <button
                    type="button"
                    className="absolute inset-0 z-0 cursor-pointer"
                    aria-label={`Select ${dk}`}
                    onClick={() => onSelectDate(dk)}
                  />
                  {Array.from({ length: totalHours + 1 }, (_, h) => (
                    <div
                      key={`g-${dk}-${h}`}
                      className="pointer-events-none absolute left-0 right-0 border-t border-slate-100"
                      style={{ top: `${(h / totalHours) * 100}%` }}
                    />
                  ))}
                  {blocked ? (
                    <div className="pointer-events-none absolute inset-0 z-30 rounded-none bg-red-200/40" />
                  ) : null}
                  <div className="pointer-events-none absolute inset-y-0 left-[4%] z-[1] w-[28%]">
                    {ranges.map((range) => (
                      <div
                        key={`a-${dk}-${range.start}-${range.end}`}
                        className="absolute left-0 right-0 rounded-md bg-emerald-100/95 px-0.5 py-0.5 text-[8px] font-bold leading-tight text-emerald-950 shadow-sm ring-1 ring-emerald-300/80"
                        style={timelineBlockStyle(range.start, range.end)}
                      >
                        <span className="line-clamp-2">{formatTimeRangeLabel(range)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="pointer-events-none absolute inset-y-0 left-[32%] z-[2] w-[34%]">
                    {colTours.map((row) => {
                      const parsed = parsePreferredTimeRange(row['Preferred Time'])
                      if (!parsed) return null
                      return (
                        <div
                          key={row.id}
                          className="absolute left-0 right-0 rounded-md border border-violet-500 bg-violet-50 px-0.5 py-0.5 text-[8px] font-bold text-violet-950 shadow-sm"
                          style={timelineBlockStyle(parsed.start, parsed.end)}
                        >
                          <span className="line-clamp-2">Tour</span>
                        </div>
                      )
                    })}
                  </div>
                  <div className="pointer-events-none absolute inset-y-0 right-[4%] z-[2] w-[34%]">
                    {colWo.map((row) => {
                      const parsed = parsePreferredTimeRange(row['Preferred Time'])
                      if (!parsed) return null
                      return (
                        <div
                          key={row.id}
                          className="absolute left-0 right-0 rounded-md border border-amber-500 bg-amber-50 px-0.5 py-0.5 text-[8px] font-bold text-amber-950 shadow-sm"
                          style={timelineBlockStyle(parsed.start, parsed.end)}
                        >
                          <span className="line-clamp-2">WO</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
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
  ranges,
  onRangesChange,
  onSave,
  onCopyHoursToWholeWeek,
  scheduledItems,
  availSaving,
  manager,
  propertyOptions,
  selectedPropertyId,
  onSelectProperty,
  isDateBlocked,
  onBlockDay,
  onUnblockDay,
  blockSaving,
  repeatWeekly = false,
  onRepeatWeeklyChange,
  onCancelDraft,
  saveButtonLabel,
  availabilityHint,
  hidePropertyPicker = false,
  selectedPropertyRecord = null,
  /** When false, tour timeline edits are disabled (calendar no longer persists to property Notes). */
  structuredAvailabilityEnabled = true,
}) {
  const hasApprovedPick = Array.isArray(propertyOptions) && propertyOptions.length > 0
  const disabled =
    availSaving || isManagerInternalPreview(manager) || !selectedPropertyId || !structuredAvailabilityEnabled
  const tourManagerLine = useMemo(() => propertyTourManagerDisplayName(selectedPropertyRecord), [selectedPropertyRecord])
  const tourParsedLines = useMemo(
    () => parsedTourAvailabilityLinesForSidebar(propertyTourAvailabilityText(selectedPropertyRecord)),
    [selectedPropertyRecord],
  )
  const showTourSummary =
    Boolean(selectedPropertyRecord) && (Boolean(String(tourManagerLine || '').trim()) || tourParsedLines.length > 0)

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm lg:sticky lg:top-6">
      <h2 className={PORTAL_SECTION_TITLE_CLS}>Availability editor</h2>
      {!hidePropertyPicker ? (
        <label className="mt-4 block text-xs font-semibold text-slate-700">
          Property
          <div className={`${MANAGER_PILL_SELECT_WRAP_CLS} mt-1.5 max-w-full`}>
            <select
              value={selectedPropertyId}
              onChange={(e) => onSelectProperty(e.target.value)}
              disabled={!hasApprovedPick}
              className={MANAGER_PILL_SELECT_CLS}
            >
              {!hasApprovedPick ? (
                <option value=""></option>
              ) : (
                propertyOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))
              )}
            </select>
            {MANAGER_PILL_SELECT_CHEVRON}
          </div>
        </label>
      ) : null}

      {isManagerInternalPreview(manager) ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {manager.__axisDeveloper
            ? 'Developer preview: availability edits are disabled'
            : 'Internal preview: availability edits are disabled (no linked manager profile)'}
        </div>
      ) : null}

      {hasApprovedPick && !selectedPropertyId ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Select a property to add availability blocks.
        </div>
      ) : null}

      {availabilityHint ? (
        <p className="mt-3 text-xs leading-relaxed text-slate-500">{availabilityHint}</p>
      ) : null}

      {showTourSummary ? (
        <div className="mt-4 rounded-2xl border border-emerald-200/80 bg-emerald-50/50 px-4 py-3">
          <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-800/90">Tour on this property</div>
          {tourManagerLine ? (
            <div className="mt-2 text-sm font-semibold text-slate-900">
              <span className="text-slate-500">Tour manager · </span>
              {tourManagerLine}
            </div>
          ) : null}
          {tourParsedLines.length ? (
            <ul className="mt-2 space-y-1.5 text-xs leading-snug text-slate-800">
              {tourParsedLines.map((row, idx) => (
                <li key={`tour-line-${idx}`} className="flex gap-2">
                  {row.dayLabel ? (
                    <span className="w-9 shrink-0 font-bold tabular-nums text-emerald-900">{row.dayLabel}</span>
                  ) : null}
                  <span className="min-w-0 flex-1">{row.body}</span>
                </li>
              ))}
            </ul>
          ) : tourManagerLine ? null : (
            <p className="mt-2 text-xs text-slate-600">No tour window text on the property yet.</p>
          )}
        </div>
      ) : null}

      {typeof onRepeatWeeklyChange === 'function' ? (
        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300"
            checked={repeatWeekly}
            disabled={disabled}
            onChange={(e) => onRepeatWeeklyChange(e.target.checked)}
          />
          <span>
            <span className="font-semibold text-slate-900">Apply every week</span>
            <span className="mt-0.5 block text-xs font-normal text-slate-500">
              When checked, saved hours repeat on this weekday from the selected date forward. When unchecked, only the
              selected calendar date is updated.
            </span>
          </span>
        </label>
      ) : null}

      <div className="mt-6">
        <DayAvailabilityTimeline ranges={ranges} onRangesChange={onRangesChange} disabled={disabled} />
      </div>

      <div className="mt-6">
        <div className="mb-3 text-sm font-bold text-slate-900">Scheduling (tours &amp; visits)</div>
        <p className="mb-2 text-[11px] leading-snug text-slate-500">
          Confirmed bookings and work orders live in the Scheduling table — not in Manager Availability.
        </p>
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

      {typeof onCopyHoursToWholeWeek === 'function' ? (
        <div className="mt-4">
          <button
            type="button"
            onClick={onCopyHoursToWholeWeek}
            disabled={disabled}
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 disabled:opacity-50"
          >
            Copy this day&apos;s hours to Mon–Sun
          </button>
        </div>
      ) : null}

      {typeof onCancelDraft === 'function' ? (
        <div className="mt-3">
          <button
            type="button"
            onClick={onCancelDraft}
            disabled={disabled}
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel draft
          </button>
        </div>
      ) : null}

      {typeof onSave === 'function' ? (
        <div className="mt-6">
          <button
            type="button"
            onClick={onSave}
            disabled={availSaving || isManagerInternalPreview(manager) || !hasApprovedPick}
            className="w-full rounded-2xl bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] px-4 py-3 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(37,99,235,0.22)] disabled:opacity-50"
          >
            {availSaving ? 'Saving…' : saveButtonLabel || 'Save to property & calendar'}
          </button>
        </div>
      ) : null}
    </div>
  )
}

function AdminDayAvailabilityEditor({
  ranges,
  onRangesChange,
  onClearDay,
  onSaveNow,
  scheduledItems,
  availSaving,
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm lg:sticky lg:top-6">
      <h2 className={PORTAL_SECTION_TITLE_CLS}>Meeting availability</h2>
      <p className="mt-2 text-xs leading-relaxed text-slate-500">
        Drag on the timeline to add blocks, then save. Your changes sync to the Scheduling table in Airtable (Contact Axis
        booking).
      </p>

      <div className="mt-6">
        <DayAvailabilityTimeline ranges={ranges} onRangesChange={onRangesChange} disabled={availSaving} />
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
        {typeof onSaveNow === 'function' ? (
          <button
            type="button"
            onClick={() => void onSaveNow()}
            disabled={availSaving}
            className="rounded-xl bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] px-4 py-2.5 font-semibold text-white shadow-sm hover:brightness-105 disabled:opacity-40"
          >
            {availSaving ? 'Saving…' : 'Save to Airtable now'}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onClearDay}
          disabled={availSaving}
          className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 font-semibold text-red-700 hover:bg-red-100 disabled:opacity-40"
        >
          Clear day
        </button>
      </div>
    </div>
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
  const rows = []
  let offset = null
  do {
    const url = new URL(`${CORE_AIRTABLE_BASE_URL}/Properties`)
    if (offset) url.searchParams.set('offset', offset)
    const data = await atRequest(url.toString())
    for (const record of (data.records || [])) rows.push(mapRecord(record))
    offset = data.offset || null
  } while (offset)
  return rows
}

async function updatePropertyAdmin(recordId, fields) {
  const data = await atRequest(`${CORE_AIRTABLE_BASE_URL}/Properties/${recordId}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields, typecast: true }),
  })
  return mapRecord(data)
}

/** Strip unknown Airtable field from PATCH error message (same idea as createSchedulingRecord). */
function airtableUnknownFieldFromError(err) {
  const msg = String(err?.message || '')
  return (
    msg.match(/Unknown field name:\s*"([^"]+)"/i)?.[1] ||
    msg.match(/Unknown field name:\s*'([^']+)'/i)?.[1] ||
    ''
  )
}

/** Airtable error may use different casing than our payload keys (e.g. "notes" vs "Notes"). */
function resolvePayloadKeyForUnknownField(payload, unknownRaw) {
  if (!unknownRaw || !payload || typeof payload !== 'object') return ''
  const u = String(unknownRaw).trim()
  if (Object.prototype.hasOwnProperty.call(payload, u)) return u
  const lower = u.toLowerCase()
  for (const k of Object.keys(payload)) {
    if (k.toLowerCase() === lower) return k
  }
  return ''
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

function workOrdersToCalendarRows(workOrders, allowedPropertyNamesLower) {
  const rows = []
  for (const workOrder of workOrders || []) {
    if (workOrderIsResolvedRecord(workOrder)) continue
    const st = String(workOrder.Status || '').trim().toLowerCase()
    if (['completed', 'resolved', 'closed', 'cancelled', 'canceled', 'done'].includes(st)) continue
    const scheduled = workOrderScheduledMeta(workOrder)
    if (!scheduled) continue
    const property = workOrderPropertyLabel(workOrder) || String(workOrder.Property || workOrder.House || '').trim()
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

function schedulingRowsForCalendarView(rows, options) {
  const { selectedPropertyName, managerEmail, showAllRows = false } = options

  if (showAllRows) {
    return (rows || []).filter((row) => String(row?.['Preferred Date'] || '').trim())
  }

  return (rows || []).filter((row) => {
    if (row._workOrder) {
      const prop = String(row.Property || '').trim().toLowerCase()
      const sel = String(selectedPropertyName || '').trim().toLowerCase()
      if (!sel || !prop) return false
      return prop === sel || prop.includes(sel) || sel.includes(prop)
    }

    const type = normalizeEventType(row.Type)
    const prop = String(row.Property || '').trim().toLowerCase()
    const rme = String(row['Manager Email'] || '').trim().toLowerCase()
    const mem = String(managerEmail || '').trim().toLowerCase()
    const selProp = String(selectedPropertyName || '').trim().toLowerCase()

    if (!selProp) return false
    if (prop) {
      return prop === selProp || prop.includes(selProp) || selProp.includes(prop)
    }
    if (mem && rme === mem && (type === CALENDAR_EVENT_TYPES.MEETING || type === CALENDAR_EVENT_TYPES.ISSUE)) {
      return true
    }
    return false
  })
}

async function patchSchedulingRecord(recordId, fields) {
  const id = String(recordId || '').trim()
  if (!id) throw new Error('Missing scheduling record id.')
  let payload = { ...(fields || {}) }
  let lastErr = null
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const data = await atRequest(`${CORE_AIRTABLE_BASE_URL}/Scheduling/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: payload, typecast: true }),
      })
      return mapRecord(data)
    } catch (err) {
      lastErr = err
      const unknownRaw = airtableUnknownFieldFromError(err)
      const key = resolvePayloadKeyForUnknownField(payload, unknownRaw)
      if (!key) break
      const { [key]: _drop, ...rest } = payload
      payload = rest
    }
  }
  throw lastErr || new Error('Could not update scheduling record.')
}

async function deleteSchedulingRecord(recordId) {
  const id = String(recordId || '').trim()
  if (!id) return
  const res = await fetch(`${CORE_AIRTABLE_BASE_URL}/Scheduling/${id}`, {
    method: 'DELETE',
    headers: atHeaders(),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    let msg = `Delete failed: ${res.status}`
    try { msg = JSON.parse(body)?.error?.message || msg } catch { /* ignore */ }
    throw new Error(msg)
  }
}

async function createSchedulingRecord(fields) {
  let payload = { ...(fields || {}) }
  let lastErr = null

  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const data = await atRequest(`${CORE_AIRTABLE_BASE_URL}/Scheduling`, {
        method: 'POST',
        body: JSON.stringify({ fields: payload, typecast: true }),
      })
      return mapRecord(data)
    } catch (err) {
      lastErr = err
      const unknownRaw = airtableUnknownFieldFromError(err)
      const key = resolvePayloadKeyForUnknownField(payload, unknownRaw)
      if (!key) break
      const { [key]: _drop, ...rest } = payload
      payload = rest
      continue
    }
  }

  throw lastErr || new Error('Could not create scheduling record.')
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
  const [editWizardProperty, setEditWizardProperty] = useState(null)
  const [detailsPropertyId, setDetailsPropertyId] = useState(null)
  const [deletingPropertyId, setDeletingPropertyId] = useState(null)
  const [listingBusyPropertyId, setListingBusyPropertyId] = useState(null)
  const [addOpen, setAddOpen] = useState(false)
  const [propertiesSection, setPropertiesSection] = useState('pending')
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
    setEditWizardProperty(null)
  }, [propertiesSection])

  const selectedManagerProperty = useMemo(() => {
    if (!detailsPropertyId) return null
    return managerPropertyTabRows?.find((p) => p.id === detailsPropertyId) || null
  }, [detailsPropertyId, managerPropertyTabRows])

  function beginEditListing(property) {
    setDetailsPropertyId(property.id)
    setEditWizardProperty(property)
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
            <PortalEmptyVisual variant="house" />
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
                    emptyIcon={<PortalEmptyVisual variant="house" />}
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
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-6 py-10 text-center">
                  <PortalEmptyVisual variant="house" />
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

        {editWizardProperty ? (
          <AddPropertyWizard
            mode="edit"
            initialValues={buildPropertyWizardInitialValues(editWizardProperty)}
            manager={manager}
            onClose={() => {
              setEditWizardProperty(null)
            }}
            onSubmitProperty={async (fields) => {
              const patch = {
                ...fields,
                Approved: false,
                'Approval Status': 'Pending',
                [PROPERTY_EDIT_REQUEST_FIELD]: '',
              }
              return updatePropertyAdmin(editWizardProperty.id, patch)
            }}
            onCreated={(updated) => {
              setProperties((current) => {
                const next = current.map((item) => (item.id === updated.id ? updated : item))
                onPropertiesChange?.(next)
                return next
              })
              setEditWizardProperty(null)
              setDetailsPropertyId(updated.id)
              setPropertiesSection('pending')
            }}
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
// Prefers /api/generate-lease-from-template when Application Record ID is provided
// so lease financials and room details come from exact Airtable property data.
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
      const appId = String(form.applicationRecordId || '').trim()
      const useTemplate = Boolean(appId)
      const endpoint = useTemplate
        ? '/api/generate-lease-from-template'
        : '/api/portal?action=generate-lease-draft'
      const payload = useTemplate
        ? { applicationRecordId: appId, managerName: manager.name, forceRegenerate: true }
        : { ...form, generatedBy: manager.name, generatedByRole: manager.role }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await readJsonResponse(res)
      if (!res.ok) throw new Error(data.error || 'Generation failed')
      toast.success(
        useTemplate
          ? 'Lease draft generated from application and property data'
          : 'Lease draft generated — ready for review',
      )
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
            <h2 className={PORTAL_SECTION_TITLE_CLS}>Generate lease draft</h2>
            <p className="mt-0.5 text-sm text-slate-500">Resident, property, and term — then generate the draft for review.</p>
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
    const visit = workOrderScheduledMeta(w)
    if (visit?.date) {
      const timeSuffix = visit.preferredTime ? ` · ${visit.preferredTime}` : ''
      events.push({ date: visit.date, label: `WO visit · ${title}${timeSuffix}`, type: 'wo' })
    }
    const sub = parseCalendarDay(w['Date Submitted'] || w.created_at)
    if (sub && sub !== visit?.date) events.push({ date: sub, label: `WO submitted · ${title}`, type: 'wo' })
    const lu = parseCalendarDay(w['Last Update'])
    if (lu && lu !== sub && lu !== visit?.date) events.push({ date: lu, label: `WO update · ${title}`, type: 'wo' })
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

function addMonthsToDate(d, deltaMonths) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setMonth(x.getMonth() + deltaMonths)
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

  const actionLease = !statsLoading && typeof leasePending === 'number' && leasePending > 0
  const actionApps = !statsLoading && typeof pendingApps === 'number' && pendingApps > 0
  const actionRent = !statsLoading && typeof rentOverdue === 'number' && rentOverdue > 0
  const actionWo = !statsLoading && typeof openWo === 'number' && openWo > 0
  const showActionBanner = actionLease || actionApps || actionRent || actionWo

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-black uppercase tracking-[0.08em] text-slate-900">
          {firstName ? `WELCOME ${firstName}` : 'DASHBOARD'}
        </h2>
      </div>

      {showActionBanner ? (
        <div
          role="status"
          aria-label="Items needing your attention"
          className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 shadow-sm"
        >
          <p className="text-sm font-bold text-amber-950">Action needed</p>
          <ul className="mt-3 space-y-2">
            {actionApps ? (
              <li className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/60 px-3 py-2 text-sm text-amber-950">
                <span>
                  <span className="font-semibold tabular-nums">{pendingApps}</span>
                  {` application${pendingApps === 1 ? '' : 's'} awaiting your review`}
                </span>
                <button
                  type="button"
                  onClick={() => onNavigate('applications')}
                  className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-700"
                >
                  Review
                </button>
              </li>
            ) : null}
            {actionLease ? (
              <li className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/60 px-3 py-2 text-sm text-amber-950">
                <span>
                  <span className="font-semibold tabular-nums">{leasePending}</span>
                  {` lease${leasePending === 1 ? '' : 's'} need your attention (draft, review, or publish)`}
                </span>
                <button
                  type="button"
                  onClick={() => onNavigate('leases')}
                  className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-700"
                >
                  Open leases
                </button>
              </li>
            ) : null}
            {actionRent ? (
              <li className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/60 px-3 py-2 text-sm text-amber-950">
                <span>
                  <span className="font-semibold tabular-nums">{rentOverdue}</span>
                  {` overdue rent payment${rentOverdue === 1 ? '' : 's'}`}
                </span>
                <button
                  type="button"
                  onClick={() => onNavigate('payments')}
                  className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-700"
                >
                  View payments
                </button>
              </li>
            ) : null}
            {actionWo ? (
              <li className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/60 px-3 py-2 text-sm text-amber-950">
                <span>
                  <span className="font-semibold tabular-nums">{openWo}</span>
                  {` open work order${openWo === 1 ? '' : 's'}`}
                </span>
                <button
                  type="button"
                  onClick={() => onNavigate('workorders')}
                  className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-700"
                >
                  Open work orders
                </button>
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      {displayDataWarnings?.length ? (
        <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <div className="font-semibold text-amber-900">Some data could not load</div>
          <ul className="mt-2 list-inside list-disc space-y-1 text-amber-900/90">
            {displayDataWarnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      ) : null}

      {/* Metric cards — requested order: Properties, Leases, Applications, Payments, Work orders, Calendar */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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

function WorkOrdersTabPanel({ allowedPropertyNames, allowedPropertyIds }) {
  const scopeLower = useMemo(
    () => new Set((allowedPropertyNames || []).map((n) => String(n).trim().toLowerCase()).filter(Boolean)),
    [allowedPropertyNames],
  )
  const scopeIds = useMemo(
    () => new Set((allowedPropertyIds || []).map((id) => String(id).trim()).filter(Boolean)),
    [allowedPropertyIds],
  )
  const [list, setList] = useState([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [quickFilter, setQuickFilter] = useState('open')
  const [propertyFilter, setPropertyFilter] = useState('')
  const [residentFilter, setResidentFilter] = useState('')
  const [sortBy, setSortBy] = useState('resident')
  const [residentsById, setResidentsById] = useState(new Map())
  const [record, setRecord] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [scheduledVisitDate, setScheduledVisitDate] = useState('')
  /** One repair attempt per WO id per session — backfills Payments when WO was scheduled without a fee row. */
  const cleaningPaymentRepairAttemptedRef = useRef(new Set())
  const woDetailPhotoUrls = useMemo(() => workOrderPhotoAttachmentUrls(record), [record])
  const tomorrowIso = useMemo(() => {
    const next = new Date()
    next.setHours(0, 0, 0, 0)
    next.setDate(next.getDate() + 1)
    return next.toISOString().slice(0, 10)
  }, [])

  const fieldCls =
    'w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/20'

  function applyRecordToForm(nextRecord) {
    const sm = workOrderScheduledMeta(nextRecord)
    const fallback =
      normalizeWorkOrderScheduleDateKey(nextRecord?.['Scheduled Visit Date']) ||
      normalizeWorkOrderScheduleDateKey(nextRecord?.['Scheduled Date'])
    setScheduledVisitDate(sm?.date || fallback || '')
  }

  const scheduledKeyForCleaningRepair = useMemo(() => {
    if (!record) return ''
    const sm = workOrderScheduledMeta(record)
    return (
      sm?.date ||
      normalizeWorkOrderScheduleDateKey(record['Scheduled Visit Date']) ||
      normalizeWorkOrderScheduleDateKey(record['Scheduled Date']) ||
      ''
    )
  }, [record])

  function submittedAt(row) {
    return new Date(row?.['Date Submitted'] || row?.created_at || 0).getTime()
  }

  const residentRecordForWorkOrder = useCallback(
    (row) => {
      for (const rid of workOrderLinkedResidentRecordIds(row || {})) {
        const resident = residentsById.get(rid)
        if (resident) return resident
      }
      return null
    },
    [residentsById],
  )

  const residentLabelForWorkOrder = useCallback(
    (row) => {
      const linkedResident = residentRecordForWorkOrder(row)
      const linkedName = String(linkedResident?.Name || linkedResident?.['Resident Name'] || '').trim()
      if (linkedName) return linkedName
      const fallback = String(paymentResidentLabel(row)).trim()
      if (/^rec[a-zA-Z0-9]{14,}$/.test(fallback)) return 'Resident not set'
      return fallback || 'Resident not set'
    },
    [residentRecordForWorkOrder],
  )

  const propertyLabelForWorkOrder = useCallback(
    (row) => {
      const fromRow = String(workOrderPropertyLabel(row)).trim()
      if (fromRow && !/^rec[a-zA-Z0-9]{14,}$/.test(fromRow)) return fromRow
      const linkedResident = residentRecordForWorkOrder(row)
      const fromResident = String(residentDisplayPropertyName(linkedResident)).trim()
      if (fromResident) return fromResident
      return 'House not set'
    },
    [residentRecordForWorkOrder],
  )

  const loadList = useCallback(async () => {
    if (!scopeLower.size && !scopeIds.size) {
      setList([])
      setListLoading(false)
      setListError('')
      return
    }
    setListLoading(true)
    setListError('')
    try {
      const [all, residents] = await Promise.all([getAllWorkOrders(), listAllResidentsRecords()])
      const nextResidentsById = new Map()
      for (const resident of residents || []) {
        const id = String(resident?.id || '').trim()
        if (id) nextResidentsById.set(id, resident)
      }
      setResidentsById(nextResidentsById)
      const scopedResidentIds = buildManagerScopedResidentIdSet(residents, scopeLower, scopeIds)
      setList(all.filter((row) => workOrderInScope(row, scopeLower, scopeIds, scopedResidentIds)))
    } catch (err) {
      console.error('[WorkOrdersTabPanel] getAllWorkOrders failed', err)
      setList([])
      setResidentsById(new Map())
      setListError('Unable to load work orders. Please try again.')
      if (!isAirtablePermissionErrorMessage(err?.message)) toast.error('Unable to load work orders. Please try again')
    } finally {
      setListLoading(false)
    }
  }, [scopeLower, scopeIds])

  useEffect(() => {
    loadList()
  }, [loadList])

  /** If a post-pay cleaning WO is already Scheduled but has no fee row (e.g. Category mismatch or date-only field), create it once. */
  useEffect(() => {
    if (!record?.id) return
    if (String(record.Status || '').trim().toLowerCase() !== 'scheduled') return
    if (!workOrderShouldCreatePaymentWhenScheduled(record)) return
    if (!scheduledKeyForCleaningRepair) return
    if (cleaningPaymentRepairAttemptedRef.current.has(record.id)) return

    const billingRid = resolveResidentRecordIdForWorkOrderBilling(record, residentsById)
    if (!billingRid) return

    let cancelled = false
    ;(async () => {
      try {
        const payments = await getPaymentsForResident({ id: billingRid })
        if (cancelled) return
        const resRec = residentsById.get(billingRid) || { id: billingRid }
        const merged = { ...record, 'Scheduled Date': scheduledKeyForCleaningRepair }
        const result = await ensurePostpayRoomCleaningFeePayment({
          workOrder: merged,
          billingResidentId: billingRid,
          residentProfile: resRec,
          paymentsPrefetch: payments,
          scheduledDateIso: scheduledKeyForCleaningRepair,
        })
        cleaningPaymentRepairAttemptedRef.current.add(record.id)
        if (result.created) {
          toast.success(
            `Added $${ROOM_CLEANING_FEE_USD} room cleaning fee to resident Payments (due ${scheduledKeyForCleaningRepair}).`,
          )
        }
      } catch (e) {
        console.warn('[WorkOrdersTabPanel] cleaning fee repair', e)
        cleaningPaymentRepairAttemptedRef.current.add(record.id)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [record, scheduledKeyForCleaningRepair, residentsById])

  const woBucketCounts = useMemo(() => {
    const counts = { open: 0, scheduled: 0, in_progress: 0, completed: 0 }
    for (const row of list) {
      const b = managerWorkOrderBucket(row)
      if (counts[b] !== undefined) counts[b] += 1
    }
    return counts
  }, [list])

  const propertyChoices = useMemo(() => {
    const map = new Map()
    for (const name of allowedPropertyNames || []) {
      const display = String(name || '').trim()
      if (!display) continue
      const value = display.toLowerCase()
      if (!map.has(value)) map.set(value, display)
    }
    for (const row of list) {
      const display = String(propertyLabelForWorkOrder(row)).trim()
      if (!display) continue
      const value = display.toLowerCase()
      if (!map.has(value)) map.set(value, display)
    }
    return [...map.entries()]
      .sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: 'base' }))
      .map(([value, display]) => ({ value, display }))
  }, [list, allowedPropertyNames, propertyLabelForWorkOrder])

  const residentChoices = useMemo(() => {
    const map = new Map()
    const scopedIds = buildManagerScopedResidentIdSet([...residentsById.values()], scopeLower, scopeIds)
    for (const rid of scopedIds) {
      const res = residentsById.get(rid)
      if (!res) continue
      const display = String(res?.Name || res?.['Resident Name'] || '').trim()
      if (!display) continue
      const value = display.toLowerCase()
      if (!map.has(value)) map.set(value, display)
    }
    for (const row of list) {
      const display = String(residentLabelForWorkOrder(row)).trim()
      if (!display) continue
      const value = display.toLowerCase()
      if (!map.has(value)) map.set(value, display)
    }
    return [...map.entries()]
      .sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: 'base' }))
      .map(([value, display]) => ({ value, display }))
  }, [list, residentLabelForWorkOrder, residentsById, scopeLower, scopeIds])

  useEffect(() => {
    if (!propertyFilter) return
    if (!propertyChoices.some((choice) => choice.value === propertyFilter)) setPropertyFilter('')
  }, [propertyChoices, propertyFilter])

  useEffect(() => {
    if (!residentFilter) return
    if (!residentChoices.some((choice) => choice.value === residentFilter)) setResidentFilter('')
  }, [residentChoices, residentFilter])

  const filteredList = useMemo(() => {
    let rows = list
    rows = rows.filter((row) => managerWorkOrderBucket(row) === quickFilter)
    if (propertyFilter) rows = rows.filter((row) => String(propertyLabelForWorkOrder(row)).trim().toLowerCase() === propertyFilter)
    if (residentFilter) rows = rows.filter((row) => String(residentLabelForWorkOrder(row)).trim().toLowerCase() === residentFilter)
    return [...rows].sort((a, b) => {
      if (sortBy === 'property') {
        const cmp = String(propertyLabelForWorkOrder(a)).localeCompare(String(propertyLabelForWorkOrder(b)), undefined, { sensitivity: 'base' })
        if (cmp !== 0) return cmp
        return submittedAt(b) - submittedAt(a)
      }
      if (sortBy === 'resident') {
        const cmp = String(residentLabelForWorkOrder(a)).localeCompare(String(residentLabelForWorkOrder(b)), undefined, { sensitivity: 'base' })
        if (cmp !== 0) return cmp
        return submittedAt(b) - submittedAt(a)
      }
      return submittedAt(b) - submittedAt(a)
    })
  }, [list, quickFilter, propertyFilter, residentFilter, sortBy, propertyLabelForWorkOrder, residentLabelForWorkOrder])

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
    const dateStr = String(scheduledVisitDate || '').trim()
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (dateStr) {
      const scheduledDate = new Date(`${dateStr}T00:00:00`)
      if (!(scheduledDate > today)) {
        toast.error('Scheduled visit date must be after today')
        return
      }
    }

    const isScheduling = Boolean(dateStr)
    const resolved = isScheduling ? false : workOrderIsResolvedRecord(record)
    const nextStatus = isScheduling ? 'Scheduled' : (resolved ? 'Completed' : 'Open')

    setSaving(true)
    try {
      const fields = {
        Status: nextStatus,
        Resolved: resolved,
      }
      if (dateStr) {
        fields['Scheduled Date'] = dateStr
      } else {
        fields['Scheduled Date'] = ''
      }

      let nextRecord
      try {
        nextRecord = await updateWorkOrder(record.id, fields)
      } catch (err) {
        const msg = String(err?.message || '')
        const m = msg.match(/Unknown field name:\s*"([^"]+)"/i)
        if (m?.[1] === 'Scheduled Date' && fields['Scheduled Date']) {
          const { 'Scheduled Date': _sd, ...rest } = fields
          nextRecord = await updateWorkOrder(record.id, rest)
        } else {
          throw err
        }
      }
      setRecord(nextRecord)
      applyRecordToForm(nextRecord)
      await loadList()

      const mergedWorkOrder = { ...record, ...nextRecord }
      let successMsg = isScheduling ? 'Work order scheduled' : 'Work order saved'
      if (isScheduling && dateStr && mergedWorkOrder?.id && workOrderShouldCreatePaymentWhenScheduled(mergedWorkOrder)) {
        const billingRid = resolveResidentRecordIdForWorkOrderBilling(mergedWorkOrder, residentsById)
        if (billingRid) {
          try {
            const resRec = residentsById.get(billingRid) || { id: billingRid }
            const payments = await getPaymentsForResident({ id: billingRid })
            const result = await ensurePostpayRoomCleaningFeePayment({
              workOrder: mergedWorkOrder,
              billingResidentId: billingRid,
              residentProfile: resRec,
              paymentsPrefetch: payments,
              scheduledDateIso: dateStr,
            })
            if (result.created) {
              successMsg = `Work order scheduled — added $${ROOM_CLEANING_FEE_USD} room cleaning fee to Payments (due ${dateStr}).`
            }
          } catch (payErr) {
            console.error('[WorkOrdersTabPanel] cleaning payment on schedule', payErr)
            toast.success(successMsg)
            toast.error(
              String(payErr?.message || '').slice(0, 120) ||
                'Cleaning fee could not be added to Payments — add it manually or retry.',
            )
            return
          }
        } else {
          toast.error(
            'Could not link this cleaning request to a resident profile for billing. Add a Resident Profile link on the work order or ensure portal submitter email is present.',
          )
        }
      }

      toast.success(successMsg)
    } catch (err) {
      toast.error(err.message || 'Could not save work order')
    } finally {
      setSaving(false)
    }
  }

  async function handleMarkCompleted() {
    if (!record?.id || saving) return
    setSaving(true)
    try {
      const fields = {
        Status: 'Completed',
        Resolved: true,
      }
      const nextRecord = await updateWorkOrder(record.id, fields)
      setRecord(nextRecord)
      applyRecordToForm(nextRecord)
      await loadList()
      toast.success('Work order marked completed')
    } catch (err) {
      toast.error(err?.message || 'Could not mark work order complete')
    } finally {
      setSaving(false)
    }
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
          {propertyChoices.map(({ value, display }) => (
            <option key={value} value={value}>{display}</option>
          ))}
        </select>
        <select
          value={residentFilter}
          onChange={(e) => setResidentFilter(e.target.value)}
          className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm transition focus:border-[#2563eb] focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20"
        >
          <option value="">All residents</option>
          {residentChoices.map(({ value, display }) => (
            <option key={value} value={value}>{display}</option>
          ))}
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value)}
          className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm transition focus:border-[#2563eb] focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20"
        >
          <option value="property">Sort by property</option>
          <option value="resident">Sort by resident</option>
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

      <div className="mb-5 grid gap-2 rounded-[28px] border border-slate-200 bg-slate-50 p-2 sm:grid-cols-3 xl:grid-cols-3">
        {[
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

      <div className="space-y-6">
        {listLoading ? (
          <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50/80 px-6 py-16 text-center text-sm text-slate-500">
            Loading work orders…
          </div>
        ) : (
          <DataTable
            empty={list.length === 0 ? 'No work orders yet' : 'Nothing matches this filter'}
            emptyIcon={<PortalEmptyVisual variant={list.length === 0 ? 'workorders' : 'search'} />}
            columns={[
              {
                key: 'desc',
                label: 'Description',
                render: (d) => <span className="font-semibold text-slate-900">{safePortalText(d.Title, 'Untitled request')}</span>,
              },
              {
                key: 'thumb',
                label: 'Photo',
                headerClassName: 'w-[72px]',
                cellClassName: 'w-[72px]',
                render: (d) => {
                  const src = workOrderPhotoAttachmentUrls(d)[0]
                  if (!src) return <span className="text-slate-400">—</span>
                  return (
                    <a
                      href={src}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block overflow-hidden rounded-xl border border-slate-200 bg-slate-100 shadow-sm"
                      title="Open photo"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <img src={src} alt="" className="h-12 w-12 object-cover" loading="lazy" />
                    </a>
                  )
                },
              },
              {
                key: 'sub',
                label: 'Submitted',
                render: (d) => <span className="text-slate-600">{fmtDate(d['Date Submitted'] || d.created_at)}</span>,
              },
              {
                key: 'prop',
                label: 'Property',
                render: (d) => <span className="text-slate-600">{propertyLabelForWorkOrder(d)}</span>,
              },
              {
                key: 'res',
                label: 'Resident',
                render: (d) => <span className="text-slate-600">{residentLabelForWorkOrder(d)}</span>,
              },
              {
                key: 'stat',
                label: 'Status',
                render: (d) => (
                  <StatusPill tone={managerWorkOrderStatusPillTone(d)}>{managerWorkOrderStatusLabel(d)}</StatusPill>
                ),
              },
              {
                key: 'act',
                label: '',
                headerClassName: 'text-right',
                cellClassName: 'text-right',
                render: (d) => (
                  <button
                    type="button"
                    onClick={() => setRecord((current) => (current?.id === d.id ? null : d))}
                    className="text-sm font-semibold text-[#2563eb] hover:underline"
                  >
                    {record?.id === d.id ? 'Hide details' : 'Details'}
                  </button>
                ),
              },
            ]}
            rows={filteredList.map((row) => ({ key: row.id, data: row }))}
          />
        )}

        {record ? (
          <PortalOpsCard
            title={safePortalText(record.Title, 'Work order')}
            description={`${propertyLabelForWorkOrder(record)} · ${residentLabelForWorkOrder(record)}`}
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
              {residentPreferredTimeWindowLabel(record) ? (
                <PortalOpsStatusBadge tone="axis">
                  Resident time window: {residentPreferredTimeWindowLabel(record)}
                </PortalOpsStatusBadge>
              ) : null}
            </div>

            <div className="rounded-3xl border border-slate-200 bg-slate-50 px-5 py-4">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Issue details</div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-700">{safePortalText(record.Description, 'No description provided')}</p>
            </div>

            {woDetailPhotoUrls.length > 0 ? (
              <div className="mt-5">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Photos</div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {woDetailPhotoUrls.map((src) => (
                    <a
                      key={src}
                      href={src}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
                    >
                      <img src={src} alt="Work order attachment" className="h-28 w-28 object-cover sm:h-36 sm:w-36" />
                    </a>
                  ))}
                </div>
              </div>
            ) : null}

            <form onSubmit={handleSave} className="mt-5 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                    Scheduled visit date
                  </label>
                  <input
                    type="date"
                    value={scheduledVisitDate}
                    onChange={(e) => setScheduledVisitDate(e.target.value)}
                    min={tomorrowIso}
                    className={fieldCls}
                  />
                </div>
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                    Resident time window
                  </label>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                    {residentPreferredTimeWindowLabel(record) || 'Not provided'}
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={saving}
                className="rounded-full bg-axis px-5 py-3 text-sm font-semibold text-white transition hover:brightness-105 disabled:opacity-50"
              >
                {saving ? 'Scheduling…' : 'Schedule'}
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
  const [filter, setFilter] = useState('pending')
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
  const [waiveAmount, setWaiveAmount] = useState('')
  const [waiveReason, setWaiveReason] = useState('')
  const [waiveSaving, setWaiveSaving] = useState(false)
  const [residentPaymentBundle, setResidentPaymentBundle] = useState({
    loading: false,
    resident: null,
    payments: [],
    drafts: [],
    error: '',
  })

  const load = useCallback(async () => {
    setLoading(true)
    setPaymentsLoadError('')
    try {
      const all = await getAllPaymentsRecords()
      const scopedAll = scopeLower.size ? all.filter((p) => paymentInScope(p, scopeLower)) : []
      const allSorted = [...scopedAll].sort(
        (a, b) =>
          new Date(b['Due Date'] || b.created_at || 0) - new Date(a['Due Date'] || a.created_at || 0),
      )
      setRentRows(allSorted)
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
        .filter((row) => isManagerPendingPrimaryRow(row))
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
    () => paymentRows.filter((row) => isManagerPendingPrimaryRow(row)).length,
    [paymentRows],
  )

  const filteredForList = useMemo(() => {
    let list = paymentRows
    if (filter === 'pending') {
      list = list.filter((row) => isManagerPendingPrimaryRow(row))
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

  const selectedResidentRecordId = selectedRow ? paymentResidentRecordId(selectedRow) : ''

  useEffect(() => {
    if (!selectedResidentRecordId) {
      setResidentPaymentBundle({ loading: false, resident: null, payments: [], drafts: [], error: '' })
      return
    }
    let cancelled = false
    setResidentPaymentBundle((b) => ({ ...b, loading: true, error: '' }))
    Promise.all([
      getResidentById(selectedResidentRecordId),
      getPaymentsForResident({ id: selectedResidentRecordId }),
      getLeaseDraftsForResident(selectedResidentRecordId, '').catch(() => []),
    ])
      .then(([resident, payments, drafts]) => {
        if (cancelled) return
        setResidentPaymentBundle({
          loading: false,
          resident: resident || null,
          payments: Array.isArray(payments) ? payments : [],
          drafts: Array.isArray(drafts) ? drafts : [],
          error: '',
        })
      })
      .catch((err) => {
        if (cancelled) return
        setResidentPaymentBundle({
          loading: false,
          resident: null,
          payments: [],
          drafts: [],
          error: err?.message || 'Could not load resident payments',
        })
      })
    return () => {
      cancelled = true
    }
  }, [selectedResidentRecordId])

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

  const feeRowsExcludingPostpayCleaning = useMemo(
    () => extraChargeRows.filter((row) => !isPostpayRoomCleaningPaymentRecord(row)),
    [extraChargeRows],
  )

  const postpayCleaningRows = useMemo(
    () => residentDetailRows.filter((row) => isPostpayRoomCleaningPaymentRecord(row) && paymentBalanceDue(row) > 0),
    [residentDetailRows],
  )

  const portalDueLinesForSelectedResident = useMemo(() => {
    if (!residentPaymentBundle.payments.length) return []
    return listDashboardDuePaymentLines(residentPaymentBundle.payments)
  }, [residentPaymentBundle.payments])

  const moveInLedgerHints = useMemo(() => {
    if (residentPaymentBundle.loading || !residentPaymentBundle.resident) return []
    const payments = residentPaymentBundle.payments
    if (!Array.isArray(payments) || payments.length === 0) return []
    const hints = []
    if (!paymentsIndicateSecurityDepositPaid(payments)) {
      hints.push(
        'Security deposit is not recorded as paid in Payments yet — confirm against the lease or resident portal move-in checklist.',
      )
    }
    if (!paymentsIndicateFirstMonthRentPaid(payments)) {
      hints.push(
        'First month rent is not recorded as paid yet — residents often pay this before monthly rent lines appear.',
      )
    }
    return hints
  }, [residentPaymentBundle.loading, residentPaymentBundle.resident, residentPaymentBundle.payments])

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

  async function submitFeeWaive(event) {
    event.preventDefault()
    if (!selectedRow) return
    const residentId = paymentResidentRecordId(selectedRow)
    if (!residentId) {
      toast.error('This payment row has no linked resident. Link Resident on the payment in Airtable, then try again')
      return
    }
    const amt = Number(String(waiveAmount).replace(/[^0-9.]/g, ''))
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error('Enter a valid waiver amount')
      return
    }
    const reason = String(waiveReason || '').trim()
    if (!reason) {
      toast.error('Add a short reason for this waiver')
      return
    }
    setWaiveSaving(true)
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
        Balance: 0,
        Status: 'Posted',
        Type: 'Fee Waive',
        Category: 'Waiver',
        Month: 'Fee waiver',
        Notes: reason,
        'Property Name': propertyName || undefined,
        'Room Number': roomNumber || undefined,
        'Resident Name': paymentResidentLabel(selectedRow) || undefined,
      }
      await createPaymentRecord(fields)
      toast.success('Fee waive recorded')
      setWaiveAmount('')
      setWaiveReason('')
      await load()
    } catch (err) {
      toast.error(err.message || 'Could not record waiver')
    } finally {
      setWaiveSaving(false)
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

      <div className="mb-5 grid gap-2 rounded-[28px] border border-slate-200 bg-slate-50 p-2 sm:grid-cols-3">
        {[
          ['pending', 'Pending', pendingLineCount],
          ['overdue', 'Overdue', overdueLineCount],
          ['paid', 'Paid', paidLineCount],
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
              <PortalEmptyVisual variant="payments" />
              <div className="text-sm font-semibold text-slate-700">No payments to show</div>
            </div>
          ) : filteredForList.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <PortalEmptyVisual variant="search" />
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
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Charge</th>
                    <th className="px-4 py-3 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Line amount</th>
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
                        <td className="max-w-[200px] px-4 py-4 text-sm font-medium text-slate-800">{managerPaymentLineDisplayTitle(row)}</td>
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
          <div className="scroll-mt-28 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm lg:scroll-mt-8">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div className="min-w-0">
                <h3 className="text-2xl font-black text-slate-900">{paymentResidentLabel(selectedRow)}</h3>
                <p className="mt-1 text-sm text-slate-600">
                  {paymentPropertyLabel(selectedRow) || 'House not set'} · {paymentRoomLabel(selectedRow)}
                </p>
              </div>
              {paymentComputedStatus(selectedRow) !== 'paid' ? (
                <button
                  type="button"
                  disabled={busy[selectedRow.id]}
                  onClick={() => markPaid(selectedRow.id)}
                  className="shrink-0 rounded-full bg-axis px-4 py-2 text-sm font-semibold text-white transition hover:brightness-105 disabled:opacity-50"
                >
                  {busy[selectedRow.id] ? 'Updating…' : 'Mark paid'}
                </button>
              ) : null}
            </div>

            <div className="min-w-0 space-y-6 px-5 py-5 sm:px-6">
              <div className="rounded-2xl border border-slate-100 bg-slate-50/90 px-4 py-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Selected charge</div>
                <div className="mt-2 text-lg font-black text-slate-900">{managerPaymentLineDisplayTitle(selectedRow)}</div>
                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Line total</dt>
                    <dd className="mt-0.5 font-bold text-slate-900">{money(paymentAmountDue(selectedRow))}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Balance due</dt>
                    <dd className="mt-0.5 font-bold text-slate-900">{money(paymentBalanceDue(selectedRow))}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Due date</dt>
                    <dd className="mt-0.5 text-slate-800">{fmtDate(selectedRow['Due Date'])}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Classification</dt>
                    <dd className="mt-0.5 capitalize text-slate-800">
                      {String(classifyResidentPaymentLine(selectedRow)).replace(/_/g, ' ')}
                    </dd>
                  </div>
                </dl>
              </div>

              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Due on resident dashboard</div>
                <p className="mt-1 text-xs text-slate-500">
                  Same open-balance Airtable lines as the resident home dashboard (excludes work-order room cleaning — see below).
                </p>
                {residentPaymentBundle.loading ? (
                  <p className="mt-3 text-sm text-slate-500">Loading resident ledger…</p>
                ) : residentPaymentBundle.error ? (
                  <p className="mt-3 text-sm text-amber-800">{residentPaymentBundle.error}</p>
                ) : !selectedResidentRecordId ? (
                  <p className="mt-3 text-sm text-slate-500">Link this payment to a resident in Airtable to load the full ledger.</p>
                ) : portalDueLinesForSelectedResident.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-500">
                    No open balance lines in this view. Move-in placeholders (e.g. deposit before a row exists) still appear in the resident
                    Payments tab.
                  </p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {portalDueLinesForSelectedResident.map((line) => (
                      <div
                        key={line.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-100 bg-white px-3 py-3"
                      >
                        <div className="min-w-0 text-sm font-semibold text-slate-900">{line.label}</div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="text-sm font-bold text-slate-900">{money(line.balance)}</span>
                          <PortalOpsStatusBadge tone={managerToneForResidentPaymentLabel(line.status)}>{line.status}</PortalOpsStatusBadge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {moveInLedgerHints.length > 0 ? (
                <div className="rounded-2xl border border-amber-100 bg-amber-50/90 px-4 py-3 text-sm text-amber-950">
                  <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-amber-900/90">Move-in ledger hints</div>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {moveInLedgerHints.map((hint, idx) => (
                      <li key={`move-in-hint-${idx}`}>{hint}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {postpayCleaningRows.length > 0 ? (
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Work order room cleaning</div>
                  <p className="mt-1 text-xs text-slate-500">Shown here for managers; residents pay it under Payments → Fees & extras.</p>
                  <div className="mt-2 space-y-2">
                    {postpayCleaningRows.map((row) => {
                      const computed = paymentComputedStatus(row)
                      return (
                        <div
                          key={row.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-100 bg-white px-3 py-3"
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-slate-900">{managerPaymentLineDisplayTitle(row)}</div>
                            <div className="mt-0.5 text-xs text-slate-500">Due {fmtDate(row['Due Date'])}</div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className="text-sm font-bold text-slate-900">{money(paymentBalanceDue(row))}</span>
                            <PortalOpsStatusBadge tone={paymentStatusTone(computed)}>{paymentStatusLabel(computed)}</PortalOpsStatusBadge>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : null}

              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Rent & utilities schedule</div>
                <div className="mt-3 space-y-2">
                  {residentDetailRows.filter((row) => getPaymentKind(row) === 'rent').length === 0 ? (
                    <p className="text-sm text-slate-500">No rent or utilities lines for this resident yet.</p>
                  ) : (
                    residentDetailRows
                      .filter((row) => getPaymentKind(row) === 'rent')
                      .slice(0, 8)
                      .map((row) => {
                        const computed = paymentComputedStatus(row)
                        return (
                          <div
                            key={row.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-100 bg-white px-3 py-3"
                          >
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-slate-900">{managerPaymentLineDisplayTitle(row)}</div>
                              <div className="mt-0.5 text-xs text-slate-500">Due {fmtDate(row['Due Date'])}</div>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <span className="text-sm font-bold text-slate-900">{money(paymentBalanceDue(row))}</span>
                              <PortalOpsStatusBadge tone={paymentStatusTone(computed)}>{paymentStatusLabel(computed)}</PortalOpsStatusBadge>
                            </div>
                          </div>
                        )
                      })
                  )}
                </div>
              </div>

              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Fines & extra charges</div>
                {feeRowsExcludingPostpayCleaning.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-500">No fee lines on file for this resident.</p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {feeRowsExcludingPostpayCleaning.map((row) => {
                      const note = formatPaymentNotesForDisplay(row.Notes)
                      const computed = paymentComputedStatus(row)
                      return (
                        <div
                          key={row.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-100 bg-white px-3 py-3"
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-slate-900">{managerPaymentLineDisplayTitle(row)}</div>
                            <div className="mt-0.5 text-xs text-slate-500">{note}</div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className="text-sm font-bold text-slate-900">{money(paymentBalanceDue(row) || paymentAmountDue(row))}</span>
                            <PortalOpsStatusBadge tone={paymentStatusTone(computed)}>{paymentStatusLabel(computed)}</PortalOpsStatusBadge>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>

            <form onSubmit={submitFeeWaive} className="border-t border-slate-100 px-5 py-5 sm:px-6">
              <div className="rounded-3xl border border-dashed border-violet-200 bg-violet-50/50 p-4">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-violet-700">Fee waive</div>
              <p className="mt-2 text-xs text-slate-600">
                Record a waiver for tracking — it does not count as a rent/deposit payment. Linked to this resident
                {paymentPropertyLabel(selectedRow) ? ` · ${paymentPropertyLabel(selectedRow)}` : ''}.
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-slate-600">Amount (USD)</span>
                  <input
                    value={waiveAmount}
                    onChange={(e) => setWaiveAmount(e.target.value)}
                    inputMode="decimal"
                    placeholder="0"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-xs font-semibold text-slate-600">Reason / notes</span>
                  <textarea
                    value={waiveReason}
                    onChange={(e) => setWaiveReason(e.target.value)}
                    rows={2}
                    placeholder="Why this fee is waived"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-500/20"
                  />
                </label>
              </div>
              <button
                type="submit"
                disabled={waiveSaving || !paymentResidentRecordId(selectedRow)}
                className="mt-4 rounded-full bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {waiveSaving ? 'Saving…' : 'Record fee waive'}
              </button>
              </div>
            </form>

            <form onSubmit={submitFine} className="border-t border-slate-100 px-5 py-5 sm:px-6">
              <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50/80 p-4">
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
              </div>
            </form>
          </div>
        ) : null}
      </div>
    </div>
  )
}

// ─── ApplicationsPanel ────────────────────────────────────────────────────────
function ApplicationsPanel({ allowedPropertyNames, manager }) {
  const [detailAppId, setDetailAppId] = useState(null)
  const [scopedRows, setScopedRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [propertyFilter, setPropertyFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('pending')
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
    return propertyFilteredRows.filter((a) => deriveApplicationApprovalState(a) === 'pending')
  }, [propertyFilteredRows, statusFilter])

  const applications = useMemo(
    () => [...filteredRows].sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()),
    [filteredRows],
  )

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
        window.dispatchEvent(new CustomEvent('axis:lease-drafts-changed', {
          detail: { source: 'application-approved', applicationRecordId: recordId },
        }))
      } else {
        const res = await fetch('/api/portal?action=manager-reject-application', {
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
        if (!res.ok) throw new Error(data.error || 'Could not reject application')
        const rf = applicationRejectedFieldName()
        const app = data.application || {}
        setScopedRows((prev) =>
          prev.map((a) => {
            if (a.id !== recordId) return a
            const next = { ...a, ...app, [rf]: true }
            delete next.Approved
            return next
          }),
        )
        toast.success(data.message || 'Application rejected')
      }
    } catch (err) {
      toast.error('Could not update application: ' + err.message)
    } finally {
      setApproving(a => { const n = { ...a }; delete n[recordId]; return n })
    }
  }

  async function handleSendBackToPending(recordId) {
    setApproving((a) => ({ ...a, [recordId]: 'pending' }))
    try {
      const res = await fetch('/api/portal?action=manager-application-set-pending', {
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
      if (!res.ok) throw new Error(data.error || 'Could not move application to pending')
      setScopedRows((prev) => prev.map((a) => (a.id === recordId ? { ...a, ...(data.application || {}) } : a)))
      toast.success(data.message || 'Application moved back to pending')
      window.dispatchEvent(new CustomEvent('axis:lease-drafts-changed', {
        detail: { source: 'application-pending', applicationRecordId: recordId },
      }))
    } catch (err) {
      toast.error('Could not move application to pending: ' + err.message)
    } finally {
      setApproving((a) => {
        const n = { ...a }
        delete n[recordId]
        return n
      })
    }
  }

  async function handleRefundApplicationFee(recordId) {
    setApproving((a) => ({ ...a, [recordId]: 'refunding' }))
    try {
      const row = scopedRows.find((a) => a.id === recordId)
      if (!row) throw new Error('Application not found')

      const state = deriveApplicationApprovalState(row)
      if (state === 'approved') {
        throw new Error('Only non-approved applications can be refunded')
      }

      const rawFee = Number(
        row['Application Fee Paid'] ?? row['Application Fee'] ?? row['Fee Paid'] ?? row['Paid Amount'] ?? 0,
      )
      const amount = Number.isFinite(rawFee) && rawFee > 0 ? rawFee : 1

      const now = new Date()
      const dueDate = now.toISOString().slice(0, 10)
      const month = now.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
      await createPaymentRecord({
        Name: `Application fee refund — ${row['Signer Full Name'] || 'Applicant'}`,
        Type: 'Application Fee Refund',
        Category: 'Fee',
        Status: 'Paid',
        Amount: amount,
        'Amount Paid': amount,
        Balance: 0,
        Month: month,
        'Due Date': dueDate,
        'Resident Name': row['Signer Full Name'] || '',
        'Property Name': row['Property Name'] || '',
        'Room Number': row['Room Number'] || '',
        Notes: `Refunded application fee after ${state} decision (APP-${String(row['Application ID'] || row.id)})`,
      })

      toast.success(`Application fee refund logged (${money(amount)})`)
    } catch (err) {
      toast.error('Could not refund application fee: ' + err.message)
    } finally {
      setApproving((a) => {
        const n = { ...a }
        delete n[recordId]
        return n
      })
    }
  }

  const statusLabel = (app) => {
    const st = deriveApplicationApprovalState(app)
    if (st === 'approved') return { label: 'Approved', cls: 'border-emerald-200 bg-emerald-50 text-emerald-700' }
    if (st === 'rejected') return { label: 'Rejected', cls: 'border-red-200 bg-red-50 text-red-700' }
    return { label: 'Pending review', cls: 'border-amber-200 bg-amber-50 text-amber-700' }
  }

  const filterOptions = allowedPropertyNames || []

  const applicationStatusPill = (app) => {
    const st = deriveApplicationApprovalState(app)
    if (st === 'approved') return { label: 'Approved', tone: 'emerald' }
    if (st === 'rejected') return { label: 'Rejected', tone: 'red' }
    return { label: 'Pending review', tone: 'amber' }
  }

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

      <div className="mb-5 grid gap-2 rounded-[28px] border border-slate-200 bg-slate-50 p-2 sm:grid-cols-3 xl:grid-cols-3">
        {[
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
            <PortalEmptyVisual variant="warning" />
            <div className="text-sm font-semibold text-slate-700">Could not load the list</div>
            <p className="mt-1 text-sm text-slate-500">Check the message above and try Refresh</p>
          </div>
        ) : scopedRows.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <PortalEmptyVisual variant="applications" />
            <div className="text-sm font-semibold text-slate-700">No applications yet</div>
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <PortalEmptyVisual variant="applications" />
            <div className="text-sm font-semibold text-slate-700">No {statusFilter} applications</div>
          </div>
        ) : (
          <>
            <DataTable
              empty="No applications in this view"
              emptyIcon={<PortalEmptyVisual variant="applications" />}
              columns={[
                {
                  key: 'applicant',
                  label: 'Applicant',
                  headerClassName: 'w-[30%]',
                  render: (app) => (
                    <>
                      <div className="font-semibold text-slate-900">{app['Signer Full Name'] || '—'}</div>
                      <div className="text-xs text-slate-500">{app['Signer Email'] || '—'}</div>
                    </>
                  ),
                },
                {
                  key: 'summary',
                  label: 'Summary',
                  headerClassName: 'w-[40%]',
                  render: (app) => (
                    <div className="flex flex-wrap gap-1.5">
                      {app['Property Name'] ? (
                        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">{app['Property Name']}</span>
                      ) : null}
                      {app['Room Number'] ? (
                        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">Room {app['Room Number']}</span>
                      ) : null}
                      {app['Lease Term'] ? (
                        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">{app['Lease Term']}</span>
                      ) : null}
                      {app['Application ID'] ? (
                        <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-mono font-semibold text-slate-600">APP-{String(app['Application ID'])}</span>
                      ) : null}
                    </div>
                  ),
                },
                {
                  key: 'status',
                  label: 'Status',
                  headerClassName: 'w-[16%] text-center',
                  cellClassName: 'text-center',
                  render: (app) => {
                    const p = applicationStatusPill(app)
                    return <StatusPill tone={p.tone}>{p.label}</StatusPill>
                  },
                },
                {
                  key: 'actions',
                  label: 'Action',
                  headerClassName: 'w-[14%] text-right',
                  cellClassName: 'text-right',
                  render: (app) => (
                    <button
                      type="button"
                      className="whitespace-nowrap text-sm font-semibold text-[#2563eb]"
                      onClick={() => setDetailAppId((id) => (id === app.id ? null : app.id))}
                    >
                      {detailAppId === app.id ? 'Hide' : 'Details'}
                    </button>
                  ),
                },
              ]}
              rows={applications.map((app) => ({ key: app.id, data: app }))}
            />
            {detailAppId ? (
              <div className="border-t border-slate-100 px-4 py-5 sm:px-6">
                {(() => {
                  const row = scopedRows.find((a) => a.id === detailAppId)
                  const vm = row ? applicationViewModelFromAirtableRow(row) : null
                  return vm ? (
                    <ApplicationDetailPanel
                      application={vm}
                      partnerLabel="—"
                      onClose={() => setDetailAppId(null)}
                      adminReview={{
                        busy: !!approving[detailAppId],
                        onApprove: () => handleDecision(detailAppId, true),
                        onReject: () => handleDecision(detailAppId, false),
                        onUnapprove: () => handleSendBackToPending(detailAppId),
                        onRefund: () => handleRefundApplicationFee(detailAppId),
                      }}
                    />
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
export function CalendarTabPanel({ manager, allowedPropertyNames, loadAllSchedulingRows = false }) {
  const [view, setView] = useState('week')
  const [anchorDate, setAnchorDate] = useState(() => startOfWeekSunday(new Date()))
  const [selectedDateKey, setSelectedDateKey] = useState(() => dateKeyFromDate(new Date()))
  const [schedulingRows, setSchedulingRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [properties, setProperties] = useState([])
  /** Per-property weekly tour-availability grid (half-hour indices by weekday). */
  const [weeklyFreeByProperty, setWeeklyFreeByProperty] = useState({})
  const [selectedPropertyId, setSelectedPropertyId] = useState('')
  const [availSaving, setAvailSaving] = useState(false)
  const [adminDayRanges, setAdminDayRanges] = useState([])
  const [blockedDateRecords, setBlockedDateRecords] = useState([])
  const [blockSaving, setBlockSaving] = useState(false)
  /** Structured Manager Availability table (per-date + weekly recurring). Falls back to legacy property text when unset/disabled. */
  const [maTableOk, setMaTableOk] = useState(false)
  const [maRecords, setMaRecords] = useState([])
  /** All Manager Availability rows for this manager — property dropdown sort (structured table + Properties tour text). */
  const [managerAvailRowsForSort, setManagerAvailRowsForSort] = useState([])
  const [pendingRanges, setPendingRanges] = useState([])
  const [repeatWeekly, setRepeatWeekly] = useState(false)
  const maDirtyRef = useRef(false)
  /** Avoid leaving "Apply every week" on when switching days — easy to accidentally write recurring rules. */
  useEffect(() => {
    setRepeatWeekly(false)
  }, [selectedDateKey, selectedPropertyId])
  const maCfg = useMemo(() => buildManagerAvailabilityConfig(import.meta.env), [])
  const adminMaCfg = useMemo(() => buildAdminMeetingAvailabilityConfig(import.meta.env), [])
  const splitAdminMa = useMemo(() => availabilityTablesAreSplit(import.meta.env), [])
  const [adminMaRecords, setAdminMaRecords] = useState([])
  /** Tour template: user edited weekly grid — debounced persist to Airtable */
  const availabilityDirtyRef = useRef(false)
  const adminAvailabilityDirtyRef = useRef(false)
  /** Latest Properties rows for autosave (avoid stale closure in debounced timeout). */
  const propertiesRef = useRef([])
  const managerRef = useRef(manager)
  /** Pending tour grid to write — keyed so property switch still saves the edited property. */
  const tourDirtyPayloadRef = useRef(null)
  /** Latest admin-day editor context for autosave / flush. */
  const adminAutosaveCtxRef = useRef({})
  const flushPendingCalendarWritesRef = useRef(async () => true)

  useEffect(() => {
    propertiesRef.current = properties
  }, [properties])
  useEffect(() => {
    managerRef.current = manager
  }, [manager])

  /** Stable scope for partial calendar reloads (avoid full `load()` wiping in-flight availability edits). */
  const calendarFetchScopeRef = useRef({
    loadAll: false,
    managerEmail: '',
    propertyNames: [],
  })
  useEffect(() => {
    calendarFetchScopeRef.current = {
      loadAll: !!loadAllSchedulingRows,
      managerEmail: String(manager?.email || '').trim(),
      propertyNames: Array.isArray(allowedPropertyNames)
        ? allowedPropertyNames
        : [...(allowedPropertyNames || [])],
    }
  }, [loadAllSchedulingRows, manager?.email, allowedPropertyNames])

  useEffect(() => {
    if (loadAllSchedulingRows) return
    const off = String(import.meta.env.VITE_USE_MANAGER_AVAILABILITY_TABLE || '').trim().toLowerCase()
    if (off === 'false' || off === '0' || off === 'none') {
      setMaTableOk(false)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        await listManagerAvailabilityRows('')
        if (!cancelled) setMaTableOk(true)
      } catch {
        if (!cancelled) setMaTableOk(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadAllSchedulingRows])

  useEffect(() => {
    if (!loadAllSchedulingRows || !splitAdminMa) {
      setAdminMaRecords([])
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const rows = await listAdminMeetingAvailabilityRows('')
        if (!cancelled) setAdminMaRecords(rows)
      } catch {
        if (!cancelled) setAdminMaRecords([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadAllSchedulingRows, splitAdminMa, manager?.email])

  useEffect(() => {
    if (!maTableOk || !selectedPropertyId || loadAllSchedulingRows) {
      setMaRecords([])
      return
    }
    let cancelled = false
    const prop = properties.find((p) => p.id === selectedPropertyId)
    const pname = prop ? propertyRecordName(prop) : ''
    ;(async () => {
      try {
        const rows = await listManagerAvailabilityForProperty(selectedPropertyId, pname)
        if (!cancelled) setMaRecords(rows)
      } catch {
        if (!cancelled) setMaRecords([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [maTableOk, selectedPropertyId, properties, loadAllSchedulingRows])

  const refreshSchedulingRowsOnly = useCallback(async () => {
    const { loadAll, managerEmail, propertyNames } = calendarFetchScopeRef.current
    try {
      const sched = loadAll
        ? await fetchAllSchedulingRows()
        : await fetchSchedulingForManagerScope({ managerEmail, propertyNames })
      const workOrders = await getAllWorkOrders().catch(() => [])
      const allowedLower = loadAll
        ? null
        : new Set(
            (propertyNames || []).map((name) => String(name).trim().toLowerCase()).filter(Boolean),
          )
      const workOrderRows = workOrdersToCalendarRows(workOrders, allowedLower)
      setSchedulingRows([...sched, ...workOrderRows])
    } catch (err) {
      console.error('[CalendarTabPanel] refreshSchedulingRowsOnly', err)
    }
  }, [])

  const load = useCallback(async () => {
    const flushed = await flushPendingCalendarWritesRef.current()
    if (!flushed) {
      toast.error('Save your calendar changes before refreshing, or fix the error shown above.')
      return
    }
    setLoading(true)
    availabilityDirtyRef.current = false
    tourDirtyPayloadRef.current = null
    try {
      const [sched, props, workOrders, maRowsForSort] = await Promise.all([
        loadAllSchedulingRows
          ? fetchAllSchedulingRows()
          : fetchSchedulingForManagerScope({ managerEmail: manager?.email, propertyNames: allowedPropertyNames || [] }),
        fetchPropertiesAdmin(),
        getAllWorkOrders().catch(() => []),
        !loadAllSchedulingRows
          ? listManagerAvailabilityForManagerEmail(manager?.email).catch(() => [])
          : Promise.resolve([]),
      ])
      if (!loadAllSchedulingRows) setManagerAvailRowsForSort(Array.isArray(maRowsForSort) ? maRowsForSort : [])
      else setManagerAvailRowsForSort([])
      const allowedLower = loadAllSchedulingRows
        ? null
        : new Set(
            (allowedPropertyNames || []).map((name) => String(name).trim().toLowerCase()).filter(Boolean),
          )
      const workOrderRows = workOrdersToCalendarRows(workOrders, allowedLower)
      setSchedulingRows([...sched, ...workOrderRows])
      setProperties(props)
      let approvedAssigned = props.filter((p) => {
        if (loadAllSchedulingRows) return isPropertyRecordApproved(p)
        return (
          propertyEligibleForManagerCalendarScheduling(p, manager) ||
          propertyNameInAllowedScope(p, allowedPropertyNames)
        )
      })
      if (!loadAllSchedulingRows) {
        approvedAssigned = sortPropertiesByManagerCalendarPriority(
          approvedAssigned,
          Array.isArray(maRowsForSort) ? maRowsForSort : [],
          import.meta.env,
        )
      } else {
        approvedAssigned = [...approvedAssigned].sort((a, b) =>
          propertyRecordName(a).localeCompare(propertyRecordName(b), undefined, { sensitivity: 'base' }),
        )
      }

      // Email-based fallback: if the normal assignment checks found nothing and we have a
      // manager email, match on the Manager Email / Site Manager Email field directly.
      // This handles properties that were added before Owner ID back-fill ran.
      if (approvedAssigned.length === 0 && !loadAllSchedulingRows && manager?.email) {
        const em = String(manager.email || '').trim().toLowerCase()
        if (em) {
          const emailFallback = props.filter((p) => {
            const me = String(p['Manager Email'] || '').trim().toLowerCase()
            const sme = String(p['Site Manager Email'] || '').trim().toLowerCase()
            return (me && me === em) || (sme && sme === em)
          })
          if (emailFallback.length > 0) {
            approvedAssigned = sortPropertiesByManagerCalendarPriority(
              emailFallback,
              Array.isArray(maRowsForSort) ? maRowsForSort : [],
              import.meta.env,
            )
          }
        }
      }

      // Last-resort fallback: if still empty (data not yet linked), show all named properties
      // so the manager can still set availability.
      if (approvedAssigned.length === 0 && !loadAllSchedulingRows) {
        approvedAssigned = sortPropertiesByManagerCalendarPriority(
          props.filter((p) => Boolean(propertyRecordName(p))),
          Array.isArray(maRowsForSort) ? maRowsForSort : [],
          import.meta.env,
        )
      }

      const byProperty = {}
      approvedAssigned.forEach((property) => {
        const text = propertyTourAvailabilityText(property) || ''
        byProperty[property.id] = text ? weeklyFreeArraysFromTourText(text) : emptyWeeklyFreeArrays()
      })
      setWeeklyFreeByProperty(byProperty)
      setSelectedPropertyId((current) => {
        if (approvedAssigned.some((p) => p.id === current)) return current
        return approvedAssigned[0]?.id || ''
      })
    } catch (err) {
      console.error('[CalendarTabPanel] load error', err)
    } finally {
      setLoading(false)
    }
  }, [manager, allowedPropertyNames, loadAllSchedulingRows])

  useEffect(() => { load() }, [load])

  /** Public Contact tour bookings use the house manager email on Scheduling rows — not the logged-in admin — so admin calendar must not filter those out. */
  useEffect(() => {
    const onSchedulingChanged = () => {
      void refreshSchedulingRowsOnly()
    }
    window.addEventListener(AXIS_SCHEDULING_CHANGED_EVENT, onSchedulingChanged)
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void refreshSchedulingRowsOnly()
    }, 22000)
    return () => {
      window.removeEventListener(AXIS_SCHEDULING_CHANGED_EVENT, onSchedulingChanged)
      clearInterval(id)
    }
  }, [refreshSchedulingRowsOnly])

  useEffect(() => {
    if (!loadAllSchedulingRows) return
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void load()
    }, 45000)
    return () => clearInterval(id)
  }, [loadAllSchedulingRows, load])

  useEffect(() => {
    const flush = () => {
      void flushPendingCalendarWritesRef.current()
    }
    const onVis = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  const approvedAssignedProperties = useMemo(() => {
    if (loadAllSchedulingRows) {
      return properties
        .filter((p) => isPropertyRecordApproved(p))
        .sort((a, b) =>
          propertyRecordName(a).localeCompare(propertyRecordName(b), undefined, { sensitivity: 'base' }),
        )
    }
    const primary = properties.filter((p) => (
      propertyEligibleForManagerCalendarScheduling(p, manager) ||
      propertyNameInAllowedScope(p, allowedPropertyNames)
    ))
    const sortMgr = (list) => sortPropertiesByManagerCalendarPriority(list, managerAvailRowsForSort, import.meta.env)
    // Email fallback (same logic as load())
    if (primary.length === 0 && manager?.email) {
      const em = String(manager.email || '').trim().toLowerCase()
      if (em) {
        const fallback = properties.filter((p) => {
          const me = String(p['Manager Email'] || '').trim().toLowerCase()
          const sme = String(p['Site Manager Email'] || '').trim().toLowerCase()
          return (me && me === em) || (sme && sme === em)
        })
        if (fallback.length > 0) return sortMgr(fallback)
      }
    }
    const results = sortMgr(primary)
    if (results.length === 0) {
      return sortMgr(properties.filter((p) => Boolean(propertyRecordName(p))))
    }
    return results
  }, [properties, manager, loadAllSchedulingRows, allowedPropertyNames, managerAvailRowsForSort])

  const selectedProperty = useMemo(
    () => approvedAssignedProperties.find((p) => p.id === selectedPropertyId) || null,
    [approvedAssignedProperties, selectedPropertyId],
  )

  const availabilityOwnerOptions = useMemo(
    () => approvedAssignedProperties
      .map((p) => ({ id: p.id, label: propertyRecordName(p) || 'Property' }))
      .filter((option) => Boolean(String(option.label || '').trim())),
    [approvedAssignedProperties],
  )

  const selectedWeeklyFree = useMemo(
    () => weeklyFreeByProperty[selectedPropertyId] || emptyWeeklyFreeArrays(),
    [weeklyFreeByProperty, selectedPropertyId],
  )

  const saveTourDirtyIfNeeded = useCallback(async () => {
    if (maTableOk) {
      availabilityDirtyRef.current = false
      tourDirtyPayloadRef.current = null
      return true
    }
    if (!availabilityDirtyRef.current) return true
    const pending = tourDirtyPayloadRef.current
    if (!pending?.propertyId) {
      availabilityDirtyRef.current = false
      return true
    }
    availabilityDirtyRef.current = false
    tourDirtyPayloadRef.current = null
    toast.error(
      'Tour availability is no longer saved to property Notes. Enable the Manager Availability Airtable table (remove VITE_USE_MANAGER_AVAILABILITY_TABLE=false) and use Save on the timeline.',
      { id: 'calendar-avail-legacy-blocked', duration: 6000 },
    )
    return true
  }, [])

  const persistAdminMeetingAvailability = useCallback(
    async (dayKey, ranges, existingRows) => {
      const adminEmail = String(manager?.email || '').trim().toLowerCase()
      if (!adminEmail || !dayKey) return
      setAvailSaving(true)
      try {
        if (splitAdminMa) {
          await Promise.all((existingRows || []).map((row) => deleteAdminMeetingAvailabilityRecord(row.id)))
          const mgrId = String(manager?.airtableRecordId || manager?.id || '').trim()
          for (const range of ranges || []) {
            const fields = buildAdminMeetingAvailabilityRecordFields({
              propertyName: '',
              propertyRecordId: '',
              managerEmail: adminEmail,
              managerRecordId: mgrId,
              dateKey: dayKey,
              weekdayAbbr: weekdayAbbrFromDateKey(dayKey),
              startHHmm: formatHHmmFromMinutes(range.start),
              endHHmm: formatHHmmFromMinutes(range.end),
              isRecurring: false,
            })
            await createAdminMeetingAvailabilityRecord(fields)
          }
          try {
            const refreshed = await listAdminMeetingAvailabilityRows('')
            setAdminMaRecords(refreshed)
          } catch {
            /* non-fatal */
          }
        } else {
          await Promise.all((existingRows || []).map((row) => deleteSchedulingRecord(row.id)))
          for (const range of ranges || []) {
            await createSchedulingRecord({
              Name: String(manager?.name || 'Axis admin').trim(),
              Email: adminEmail,
              Type: 'Meeting Availability',
              Status: 'Available',
              'Manager Email': adminEmail,
              'Tour Manager': String(manager?.name || '').trim(),
              'Preferred Date': dayKey,
              'Preferred Time': `${displayTimeFromMinutes(range.start)} - ${displayTimeFromMinutes(range.end)}`,
              'Scheduled Date': dayKey,
              'Scheduled Time': `${displayTimeFromMinutes(range.start)} - ${displayTimeFromMinutes(range.end)}`,
            })
          }
        }
        toast.success('Saved', { id: 'calendar-admin-avail-autosave', duration: 1800 })
        await refreshSchedulingRowsOnly()
        dispatchAxisSchedulingChanged({ reason: 'admin-meeting-availability' })
      } catch (err) {
        toast.error(err.message || 'Could not save availability')
        throw err
      } finally {
        setAvailSaving(false)
      }
    },
    [manager, refreshSchedulingRowsOnly, splitAdminMa],
  )

  const saveTourDirtyRef = useRef(saveTourDirtyIfNeeded)
  saveTourDirtyRef.current = saveTourDirtyIfNeeded
  const saveMaRef = useRef(async () => true)
  const persistAdminRef = useRef(persistAdminMeetingAvailability)
  persistAdminRef.current = persistAdminMeetingAvailability

  const flushPendingCalendarWrites = useCallback(async () => {
    if (!loadAllSchedulingRows && maTableOk && maDirtyRef.current) {
      const ok = await saveMaRef.current()
      if (!ok) return false
    }
    if (!loadAllSchedulingRows && !maTableOk && availabilityDirtyRef.current) {
      const ok = await saveTourDirtyRef.current()
      if (!ok) return false
    }
    if (loadAllSchedulingRows && adminAvailabilityDirtyRef.current) {
      const ctx = adminAutosaveCtxRef.current
      const dayKey = String(ctx?.selectedDateKey || '').trim()
      if (!dayKey) return true
      adminAvailabilityDirtyRef.current = false
      try {
        await persistAdminRef.current(dayKey, ctx.adminDayRanges, ctx.adminAvailabilityRowsForSelectedDay)
      } catch {
        adminAvailabilityDirtyRef.current = true
        return false
      }
    }
    return true
  }, [loadAllSchedulingRows])

  flushPendingCalendarWritesRef.current = flushPendingCalendarWrites

  const selectPropertyAndFlush = useCallback(
    async (nextId) => {
      const next = String(nextId || '').trim()
      if (!loadAllSchedulingRows && next && next !== String(selectedPropertyId || '').trim()) {
        if (maTableOk && maDirtyRef.current) {
          const ok = await saveMaRef.current()
          if (!ok) return
        }
        if (!maTableOk) {
          const ok = await saveTourDirtyIfNeeded()
          if (!ok) return
        }
      }
      setSelectedPropertyId(next)
    },
    [loadAllSchedulingRows, selectedPropertyId, saveTourDirtyIfNeeded, maTableOk],
  )

  // Manager: property-scoped rows. Admin: org-wide tours/work orders/meetings; "Meeting Availability" stays scoped to this admin.
  const schedulingRowsForView = useMemo(() => {
    if (loadAllSchedulingRows) {
      const adminEmail = String(manager?.email || '').trim().toLowerCase()
      return (schedulingRows || []).filter((row) => {
        const dk = String(row?.['Preferred Date'] || '').trim()
        if (!dk) return false
        const type = String(row?.Type || '').trim().toLowerCase()
        const rme = String(row['Manager Email'] || '').trim().toLowerCase()
        if (type === 'meeting availability') return adminEmail && rme === adminEmail
        if (['tour', 'work order', 'meeting', 'issue', 'other', 'availability'].includes(type)) return true
        return adminEmail && rme === adminEmail
      })
    }
    return (schedulingRows || []).filter((row) => {
      const prop = String(row.Property || '').trim().toLowerCase()
      const sel = String(propertyRecordName(selectedProperty || {}) || '').trim().toLowerCase()
      return prop === sel || prop.includes(sel) || sel.includes(prop)
    })
  }, [schedulingRows, selectedProperty, loadAllSchedulingRows, manager?.email])

  const computeMergedForDateKey = useCallback(
    (dateKey) => {
      if (!maTableOk || !selectedProperty) {
        return timeRangesFromWeeklyFree(selectedWeeklyFree, weekdayAbbrFromDateKey(dateKey))
      }
      const selProp = String(propertyRecordName(selectedProperty) || '').trim().toLowerCase()
      const tourRows = (schedulingRowsForView || []).filter((row) => {
        const t = String(row.Type || '').trim().toLowerCase()
        if (t !== 'tour') return false
        const dk = String(row['Preferred Date'] || '').trim().slice(0, 10)
        if (dk !== dateKey) return false
        const rp = String(row.Property || '').trim().toLowerCase()
        return !selProp || rp === selProp || rp.includes(selProp) || selProp.includes(rp)
      })
      const bookedLabels = tourRows
        .map((row) => {
          const p = parsePreferredTimeRange(row['Preferred Time'])
          return p ? slotLabelFromRange(p.start, p.end) : ''
        })
        .filter(Boolean)
      const ranges = mergePropertyAvailabilityRanges({
        records: maRecords.map((r) => ({ fields: r })),
        fieldsConfig: maCfg.fields,
        dateKey,
        propertyName: propertyRecordName(selectedProperty),
        propertyRecordId: selectedProperty.id,
        managerEmail: manager?.email,
        managerRecordId: manager?.airtableRecordId || manager?.id || '',
        legacyAvailabilityText: propertyTourAvailabilityText(selectedProperty),
        bookedSlotLabels: bookedLabels,
      })
      return normalizeTimeRanges(ranges)
    },
    [
      maTableOk,
      selectedProperty,
      maRecords,
      maCfg.fields,
      manager?.email,
      manager?.airtableRecordId,
      manager?.id,
      schedulingRowsForView,
      selectedWeeklyFree,
    ],
  )

  const mergedForSelectedDay = useMemo(
    () => computeMergedForDateKey(selectedDateKey),
    [computeMergedForDateKey, selectedDateKey],
  )

  useEffect(() => {
    if (loadAllSchedulingRows) return
    if (!maTableOk) return
    if (maDirtyRef.current) return
    setPendingRanges(mergedForSelectedDay)
  }, [mergedForSelectedDay, maTableOk, loadAllSchedulingRows, selectedDateKey])

  const managerDayFreeOverrides = useMemo(() => {
    if (loadAllSchedulingRows || !maTableOk || !selectedProperty) return null
    const keys = new Set()
    const y = anchorDate.getFullYear()
    const m = anchorDate.getMonth()
    const last = new Date(y, m + 1, 0).getDate()
    for (let d = 1; d <= last; d += 1) {
      keys.add(calendarDateKey(y, m, d))
    }
    // Week view uses 7 days from Sunday; those dates can sit outside anchor month — include them or the grid shows empty strips.
    const ws = startOfWeekSunday(anchorDate)
    for (let i = 0; i < 7; i += 1) {
      keys.add(dateKeyFromDate(addDaysDate(ws, i)))
    }
    const sel = String(selectedDateKey || '').trim().slice(0, 10)
    if (sel) {
      keys.add(sel)
      const wsSel = startOfWeekSunday(dateFromCalendarKey(sel))
      for (let i = 0; i < 7; i += 1) {
        keys.add(dateKeyFromDate(addDaysDate(wsSel, i)))
      }
    }
    const out = {}
    for (const key of keys) {
      if (!key) continue
      out[key] = computeMergedForDateKey(key)
    }
    return out
  }, [loadAllSchedulingRows, maTableOk, selectedProperty, anchorDate, selectedDateKey, computeMergedForDateKey])

  const saveManagerAvailabilityToAirtable = useCallback(async () => {
    if (!maTableOk || !selectedProperty || !manager?.email) {
      toast.error('Manager Availability is not available or property is not selected.')
      return false
    }
    if (!selectedDateKey) {
      toast.error('No date selected.')
      return false
    }
    const dk = selectedDateKey
    const abbr = weekdayAbbrFromDateKey(dk)
    const propName = propertyRecordName(selectedProperty)
    const propId = selectedProperty.id
    const mgrEmail = String(manager.email || '').trim().toLowerCase()
    const mgrId = String(manager.airtableRecordId || manager.id || '').trim()
    const ranges = normalizeTimeRanges(pendingRanges)
    const f = maCfg.fields
    const isRecVal = (row) =>
      row[f.isRecurring] === true ||
      row[f.isRecurring] === 1 ||
      String(row[f.isRecurring] || '').toLowerCase() === 'true' ||
      String(row[f.isRecurring] || '').toLowerCase() === 'yes'
    const isActiveVal = (row) => {
      const v = row[f.active]
      if (v === false || v === 0 || String(v).toLowerCase() === 'false') return false
      return true
    }
    setAvailSaving(true)
    try {
      const toDelete = maRecords.filter((row) => {
        if (!isActiveVal(row)) return false
        const rowPropId = airtableFieldScalar(row[f.propertyRecordId])
        const rowPropName = String(row[f.propertyName] || '').trim().toLowerCase()
        const matchesProp =
          (propId && rowPropId === propId) ||
          (propName.trim().toLowerCase() && rowPropName === propName.trim().toLowerCase())
        const rowMgrId = airtableFieldScalar(row[f.managerRecordId])
        const rowMgrEmail = String(row[f.managerEmail] || '').trim().toLowerCase()
        const matchesMgr =
          rowMgrEmail === mgrEmail || (mgrId && rowMgrId === mgrId)
        if (!matchesProp || !matchesMgr) return false
        if (repeatWeekly) return isRecVal(row) && normalizeWeekdayAbbr(row[f.weekday]) === abbr
        return !isRecVal(row) && normalizeDateKey(row[f.date]) === dk
      })
      await Promise.all(toDelete.map((row) => deleteManagerAvailabilityRecord(row.id)))
      const slotLabels = expandMinuteRangesToCanonicalTourSlotLabels(ranges)
      const fieldsList = []
      for (const label of slotLabels) {
        const pr = parseTourTimeSlotLabelToMinutesRange(label)
        if (!pr || pr.end <= pr.start) continue
        fieldsList.push(
          buildManagerAvailabilitySlotRowFields({
            propertyName: propName,
            propertyRecordId: propId,
            managerEmail: mgrEmail,
            managerRecordId: mgrId,
            dateKey: dk,
            weekdayAbbr: abbr,
            slotStartMinutes: pr.start,
            slotLabel: label,
            status: 'available',
            isRecurring: repeatWeekly,
            source: 'manager_portal',
          }),
        )
      }
      await createManagerAvailabilityRecordsBatch(fieldsList)
      const refreshed = await listManagerAvailabilityForProperty(propId, propName)
      const selProp = String(propName || '').trim().toLowerCase()
      const tourRows = (schedulingRowsForView || []).filter((row) => {
        const t = String(row.Type || '').trim().toLowerCase()
        if (t !== 'tour') return false
        const rowDk = String(row['Preferred Date'] || '').trim().slice(0, 10)
        if (rowDk !== dk) return false
        const rp = String(row.Property || '').trim().toLowerCase()
        return !selProp || rp === selProp || rp.includes(selProp) || selProp.includes(rp)
      })
      const bookedLabels = tourRows
        .map((row) => {
          const p = parsePreferredTimeRange(row['Preferred Time'])
          return p ? slotLabelFromRange(p.start, p.end) : ''
        })
        .filter(Boolean)
      const mergedAfter = normalizeTimeRanges(
        mergePropertyAvailabilityRanges({
          records: refreshed.map((r) => ({ fields: r })),
          fieldsConfig: maCfg.fields,
          dateKey: dk,
          propertyName: propName,
          propertyRecordId: propId,
          managerEmail: mgrEmail,
          managerRecordId: mgrId,
          legacyAvailabilityText: propertyTourAvailabilityText(selectedProperty),
          bookedSlotLabels: bookedLabels,
        }),
      )
      setMaRecords(refreshed)
      maDirtyRef.current = false
      setPendingRanges(mergedAfter)
      toast.success(repeatWeekly ? 'Weekly availability saved' : 'Availability saved')
      try {
        const maSort = await listManagerAvailabilityForManagerEmail(mgrEmail)
        setManagerAvailRowsForSort(Array.isArray(maSort) ? maSort : [])
      } catch {
        /* non-fatal */
      }
      await refreshSchedulingRowsOnly()
      dispatchAxisSchedulingChanged({ reason: 'manager-availability' })
      return true
    } catch (err) {
      toast.error(err.message || 'Failed to save availability')
      return false
    } finally {
      setAvailSaving(false)
    }
  }, [
    maTableOk,
    selectedProperty,
    manager,
    selectedDateKey,
    pendingRanges,
    repeatWeekly,
    maRecords,
    maCfg.fields,
    refreshSchedulingRowsOnly,
    schedulingRowsForView,
  ])

  useEffect(() => {
    saveMaRef.current = saveManagerAvailabilityToAirtable
  }, [saveManagerAvailabilityToAirtable])

  const bookedByDate = useMemo(() => {
    const map = new Map()
    for (const row of schedulingRowsForView || []) {
      if (!isWorkOrderOrScheduledTourCalendarRow(row)) continue
      const dk = String(row?.['Preferred Date'] || '').trim().slice(0, 10)
      if (!dk) continue
      const list = map.get(dk) || []
      list.push(row)
      map.set(dk, list)
    }
    return map
  }, [schedulingRowsForView])

  // Items on selected day: work orders + scheduled tours only (not meetings, issues, or availability rows)
  const scheduledItemsForSelectedDay = useMemo(() => {
    return (schedulingRowsForView || []).filter((row) => {
      if (!isWorkOrderOrScheduledTourCalendarRow(row)) return false
      const rowDate = String(row['Preferred Date'] || '').trim().slice(0, 10)
      return rowDate === selectedDateKey
    })
  }, [schedulingRowsForView, selectedDateKey])

  const adminAvailabilityRowsForSelectedDay = useMemo(() => {
    if (!loadAllSchedulingRows) return []
    const adminEmail = String(manager?.email || '').trim().toLowerCase()
    if (!adminEmail) return []
    if (splitAdminMa) {
      const f = adminMaCfg.fields
      const wkSel = weekdayAbbrFromDateKey(selectedDateKey)
      return (adminMaRecords || []).filter((row) => {
        if (!recordIsGlobalAdminRow(row, f)) return false
        if (String(row[f.managerEmail] || '').trim().toLowerCase() !== adminEmail) return false
        const isRec =
          row[f.isRecurring] === true ||
          row[f.isRecurring] === 1 ||
          String(row[f.isRecurring] || '').toLowerCase() === 'true' ||
          String(row[f.isRecurring] || '').toLowerCase() === 'yes'
        if (isRec) return normalizeWeekdayAbbr(row[f.weekday]) === wkSel
        return normalizeDateKey(row[f.date]) === selectedDateKey
      })
    }
    return (schedulingRows || []).filter((row) => {
      const type = String(row?.Type || '').trim().toLowerCase()
      if (type !== 'meeting availability') return false
      const rowDate = String(row?.['Preferred Date'] || '').trim().slice(0, 10)
      if (rowDate !== selectedDateKey) return false
      const rowEmail = String(row?.['Manager Email'] || '').trim().toLowerCase()
      return rowEmail === adminEmail
    })
  }, [
    loadAllSchedulingRows,
    schedulingRows,
    manager?.email,
    selectedDateKey,
    splitAdminMa,
    adminMaRecords,
    adminMaCfg.fields,
  ])

  const adminRangesFromRows = useMemo(() => {
    if (splitAdminMa) {
      return normalizeTimeRanges(
        adminAvailabilityRowsForSelectedDay
          .map((row) => intervalFromMaRecord(row, adminMaCfg.fields))
          .filter(Boolean),
      )
    }
    return normalizeTimeRanges(
      adminAvailabilityRowsForSelectedDay
        .map((row) => parsePreferredTimeRange(row?.['Preferred Time']))
        .filter(Boolean),
    )
  }, [adminAvailabilityRowsForSelectedDay, splitAdminMa, adminMaCfg.fields])

  /** Per-date explicit availability (admin calendar) for month/week/day green blocks. */
  const adminMeetingAvailabilityFreeByDate = useMemo(() => {
    if (!loadAllSchedulingRows) return null
    const adminEmail = String(manager?.email || '').trim().toLowerCase()
    if (!adminEmail) return null
    if (splitAdminMa) {
      const mapRanges = buildGlobalAdminFreeRangesMapByDate({
        records: adminMaRecords,
        config: adminMaCfg,
        adminEmail,
        daysAhead: 120,
      })
      const byDate = {}
      for (const [dk, ranges] of Object.entries(mapRanges)) {
        byDate[dk] = normalizeTimeRanges(ranges)
      }
      return byDate
    }
    const byDate = {}
    for (const row of schedulingRows || []) {
      const type = String(row?.Type || '').trim().toLowerCase()
      if (type !== 'meeting availability') continue
      const rme = String(row['Manager Email'] || '').trim().toLowerCase()
      if (rme !== adminEmail) continue
      const dk = String(row['Preferred Date'] || '').trim().slice(0, 10)
      if (!dk) continue
      const parsed = parsePreferredTimeRange(row['Preferred Time'])
      if (!parsed) continue
      if (!byDate[dk]) byDate[dk] = []
      byDate[dk].push(parsed)
    }
    for (const dk of Object.keys(byDate)) {
      byDate[dk] = normalizeTimeRanges(byDate[dk])
    }
    return byDate
  }, [loadAllSchedulingRows, schedulingRows, manager?.email, splitAdminMa, adminMaRecords, adminMaCfg])

  /** Month/week grid: reflect Manager Availability editor state on the selected day (not only rows already in Airtable). */
  const calendarDayFreeOverrides = useMemo(() => {
    if (loadAllSchedulingRows) return adminMeetingAvailabilityFreeByDate
    if (!maTableOk || !managerDayFreeOverrides) return managerDayFreeOverrides
    return {
      ...managerDayFreeOverrides,
      [selectedDateKey]: normalizeTimeRanges(pendingRanges),
    }
  }, [loadAllSchedulingRows, maTableOk, managerDayFreeOverrides, selectedDateKey, pendingRanges, adminMeetingAvailabilityFreeByDate])

  const adminScheduledItemsForDay = scheduledItemsForSelectedDay

  useEffect(() => {
    if (!loadAllSchedulingRows) return
    if (adminAvailabilityDirtyRef.current) return
    setAdminDayRanges(adminRangesFromRows)
  }, [loadAllSchedulingRows, adminRangesFromRows, selectedDateKey])

  // Load blocked dates whenever the selected property changes
  useEffect(() => {
    if (!selectedPropertyId) {
      setBlockedDateRecords([])
      return
    }
    fetchBlockedTourDates(selectedPropertyId)
      .then(setBlockedDateRecords)
      .catch(() => setBlockedDateRecords([]))
  }, [selectedPropertyId])

  const blockedDatesSet = useMemo(() => {
    const s = new Set()
    for (const rec of blockedDateRecords) {
      const d = String(rec['Date'] || '').trim().slice(0, 10)
      if (d) s.add(d)
    }
    return s
  }, [blockedDateRecords])

  const blockedRecordForSelectedDay = useMemo(
    () => blockedDateRecords.find((r) => String(r['Date'] || '').trim().slice(0, 10) === selectedDateKey) || null,
    [blockedDateRecords, selectedDateKey],
  )

  async function handleBlockDay() {
    if (!selectedProperty || !selectedDateKey) return
    setBlockSaving(true)
    try {
      const newRec = await createBlockedTourDate({
        propertyId: selectedPropertyId,
        propertyName: propertyRecordName(selectedProperty),
        date: selectedDateKey,
        managerId: manager?.id || '',
        managerName: manager?.name || manager?.email || '',
      })
      setBlockedDateRecords((prev) => [...prev, newRec])
      toast.success(`${selectedDateKey} blocked`)
    } catch (err) {
      toast.error(err.message || 'Could not block day')
    } finally {
      setBlockSaving(false)
    }
  }

  async function handleUnblockDay() {
    if (!blockedRecordForSelectedDay) return
    setBlockSaving(true)
    try {
      await deleteBlockedTourDate(blockedRecordForSelectedDay.id)
      setBlockedDateRecords((prev) => prev.filter((r) => r.id !== blockedRecordForSelectedDay.id))
      toast.success(`${selectedDateKey} unblocked`)
    } catch (err) {
      toast.error(err.message || 'Could not unblock day')
    } finally {
      setBlockSaving(false)
    }
  }

  async function handleSelectDate(key) {
    const nextKey = String(key || '').trim()
    if (!loadAllSchedulingRows && maTableOk && maDirtyRef.current) {
      const ok = await saveManagerAvailabilityToAirtable()
      if (!ok) return
    }
    if (!loadAllSchedulingRows && !maTableOk && availabilityDirtyRef.current) {
      const ok = await saveTourDirtyIfNeeded()
      if (!ok) return
    }
    if (loadAllSchedulingRows && adminAvailabilityDirtyRef.current) {
      const {
        manager: mgr,
        selectedDateKey: dayKey,
        adminDayRanges: ranges,
        adminAvailabilityRowsForSelectedDay: rows,
      } = adminAutosaveCtxRef.current
      adminAvailabilityDirtyRef.current = false
      try {
        await persistAdminMeetingAvailability(dayKey, ranges, rows)
      } catch {
        adminAvailabilityDirtyRef.current = true
        return
      }
    }
    setSelectedDateKey(nextKey)
    setAnchorDate(dateFromCalendarKey(nextKey))
  }

  useEffect(() => {
    if (loadAllSchedulingRows || maTableOk) return
    if (!availabilityDirtyRef.current) return
    const t = window.setTimeout(() => {
      void saveTourDirtyIfNeeded()
    }, 550)
    return () => window.clearTimeout(t)
  }, [weeklyFreeByProperty, selectedPropertyId, selectedDateKey, loadAllSchedulingRows, saveTourDirtyIfNeeded, maTableOk])

  adminAutosaveCtxRef.current = {
    manager,
    selectedDateKey,
    adminDayRanges,
    adminAvailabilityRowsForSelectedDay,
  }

  useEffect(() => {
    if (!loadAllSchedulingRows) return
    if (!adminAvailabilityDirtyRef.current) return
    const t = window.setTimeout(async () => {
      const {
        manager: mgr,
        selectedDateKey: dayKey,
        adminDayRanges: ranges,
        adminAvailabilityRowsForSelectedDay: rows,
      } = adminAutosaveCtxRef.current
      const adminEmail = String(mgr?.email || '').trim().toLowerCase()
      if (!adminEmail) return
      adminAvailabilityDirtyRef.current = false
      try {
        await persistAdminMeetingAvailability(dayKey, ranges, rows)
      } catch {
        adminAvailabilityDirtyRef.current = true
      }
    }, 550)
    return () => window.clearTimeout(t)
  }, [adminDayRanges, selectedDateKey, loadAllSchedulingRows, persistAdminMeetingAvailability])

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
    const statsRows = loadAllSchedulingRows
      ? schedulingRowsForView.filter((r) => {
          const t = String(r.Type || '').trim().toLowerCase()
          return t !== 'meeting availability' && t !== 'availability'
        })
      : schedulingRowsForView
    const monthCount = statsRows.filter((r) => String(r['Preferred Date'] || '').trim().slice(0, 7) === monthStr).length
    return {
      today: bookedByDate.get(todayStr)?.length || 0,
      week: weekCount,
      month: monthCount,
      total: statsRows.length,
    }
  }, [schedulingRowsForView, bookedByDate, loadAllSchedulingRows])

  return (
    <div className="pb-2">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h2 className={PORTAL_TAB_H2_CLS}>Calendar</h2>
        <div className="flex w-full min-w-0 flex-wrap items-center justify-end gap-2 sm:ml-auto sm:w-auto sm:flex-nowrap">
          {!loadAllSchedulingRows && (
            <div className={MANAGER_PILL_SELECT_WRAP_CLS}>
              <select
                value={selectedPropertyId}
                onChange={(e) => void selectPropertyAndFlush(e.target.value)}
                disabled={!availabilityOwnerOptions.length}
                className={MANAGER_PILL_SELECT_CLS}
              >
                {availabilityOwnerOptions.length ? (
                  availabilityOwnerOptions.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))
                ) : (
                  <option value="">No properties</option>
                )}
              </select>
              {MANAGER_PILL_SELECT_CHEVRON}
            </div>
          )}
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

      {loadAllSchedulingRows ? (
        <div className="mb-5 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          {splitAdminMa
            ? 'Admin meeting hours are stored in the Admin Meeting Availability table; confirmed meetings still appear in Scheduling. Public Contact Axis slots update from the API after save.'
            : 'Meetings and availability here sync to Contact Axis booking (Scheduling rows).'}
        </div>
      ) : null}

      <div className="mb-5 grid gap-2 rounded-[28px] border border-slate-200 bg-slate-50 p-2 sm:grid-cols-2 xl:grid-cols-4">
        <button
          type="button"
          onClick={() => {
            void (async () => {
              const t = new Date()
              const k = dateKeyFromDate(t)
              await handleSelectDate(k)
              setView('day')
            })()
          }}
          className={classNames(
            'rounded-2xl border px-4 py-3 text-left transition',
            view === 'day'
              ? 'border-[#2563eb]/30 bg-white text-slate-900 shadow-[0_10px_24px_rgba(37,99,235,0.14)]'
              : 'border-transparent text-slate-600 hover:border-slate-200 hover:bg-white',
          )}
        >
          <div className="text-lg font-black leading-none tabular-nums text-slate-900">{calendarStats.today}</div>
          <div className="mt-1 text-sm font-semibold">Today</div>
        </button>
        <button
          type="button"
          onClick={() => {
            void (async () => {
              const d = startOfWeekSunday(new Date())
              const k = dateKeyFromDate(d)
              await handleSelectDate(k)
              setAnchorDate(d)
              setView('week')
            })()
          }}
          className={classNames(
            'rounded-2xl border px-4 py-3 text-left transition',
            view === 'week'
              ? 'border-[#2563eb]/30 bg-white text-slate-900 shadow-[0_10px_24px_rgba(37,99,235,0.14)]'
              : 'border-transparent text-slate-600 hover:border-slate-200 hover:bg-white',
          )}
        >
          <div className="text-lg font-black leading-none tabular-nums text-slate-900">{calendarStats.week}</div>
          <div className="mt-1 text-sm font-semibold">This week</div>
        </button>
        <button
          type="button"
          onClick={() => {
            void (async () => {
              const d = new Date()
              const first = new Date(d.getFullYear(), d.getMonth(), 1)
              const k = dateKeyFromDate(first)
              await handleSelectDate(k)
              setAnchorDate(first)
              setView('month')
            })()
          }}
          className={classNames(
            'rounded-2xl border px-4 py-3 text-left transition',
            view === 'month'
              ? 'border-[#2563eb]/30 bg-white text-slate-900 shadow-[0_10px_24px_rgba(37,99,235,0.14)]'
              : 'border-transparent text-slate-600 hover:border-slate-200 hover:bg-white',
          )}
        >
          <div className="text-lg font-black leading-none tabular-nums text-slate-900">{calendarStats.month}</div>
          <div className="mt-1 text-sm font-semibold">This month</div>
        </button>
        <div className="rounded-2xl border border-transparent px-4 py-3 text-left text-slate-600">
          <div className="text-lg font-black leading-none tabular-nums text-slate-900">{calendarStats.total}</div>
          <div className="mt-1 text-sm font-semibold">Total booked</div>
        </div>
      </div>

      {!loadAllSchedulingRows ? (
        <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-semibold text-slate-700 shadow-sm">
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Manager availability</span>
          <span className="inline-flex items-center gap-2">
            <span className="h-3 w-10 rounded bg-emerald-400 ring-1 ring-emerald-600/30" aria-hidden />
            Manager free
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-3 w-10 rounded bg-violet-400 ring-1 ring-violet-600/30" aria-hidden />
            Tour (Scheduling)
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="h-3 w-10 rounded bg-amber-400 ring-1 ring-amber-600/30" aria-hidden />
            Work order
          </span>
          <span className="min-w-0 text-[11px] font-normal leading-snug text-slate-500">
            Green blocks follow Manager Availability (and property tour windows when that table is off). Tour bookings stay
            in Scheduling (violet).
          </span>
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="text-sm font-semibold text-slate-800">
          {view === 'month'
            ? anchorDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
            : view === 'week'
              ? formatWeekRangeLabel(startOfWeekSunday(anchorDate))
              : new Date(selectedDateKey + 'T12:00:00').toLocaleDateString('en-US', {
                  weekday: 'long',
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            onClick={() => void (async () => {
              if (view === 'month') {
                const d = addMonthsToDate(anchorDate, -1)
                const first = new Date(d.getFullYear(), d.getMonth(), 1)
                const k = dateKeyFromDate(first)
                await handleSelectDate(k)
                setAnchorDate(first)
              } else if (view === 'week') {
                const d = addDaysDate(anchorDate, -7)
                const ws = startOfWeekSunday(d)
                await handleSelectDate(dateKeyFromDate(ws))
                setAnchorDate(ws)
              } else {
                const d = addDaysDate(dateFromCalendarKey(selectedDateKey), -1)
                const k = dateKeyFromDate(d)
                await handleSelectDate(k)
                setAnchorDate(d)
              }
            })()}
          >
            Previous
          </button>
          <button
            type="button"
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            onClick={() => void (async () => {
              if (view === 'month') {
                const d = addMonthsToDate(anchorDate, 1)
                const first = new Date(d.getFullYear(), d.getMonth(), 1)
                const k = dateKeyFromDate(first)
                await handleSelectDate(k)
                setAnchorDate(first)
              } else if (view === 'week') {
                const d = addDaysDate(anchorDate, 7)
                const ws = startOfWeekSunday(d)
                await handleSelectDate(dateKeyFromDate(ws))
                setAnchorDate(ws)
              } else {
                const d = addDaysDate(dateFromCalendarKey(selectedDateKey), 1)
                const k = dateKeyFromDate(d)
                await handleSelectDate(k)
                setAnchorDate(d)
              }
            })()}
          >
            Next
          </button>
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
          blockedDates={loadAllSchedulingRows ? new Set() : blockedDatesSet}
          dayFreeOverrides={calendarDayFreeOverrides}
        />
        {!loadAllSchedulingRows && (
          <AvailabilityEditorPanel
            structuredAvailabilityEnabled={maTableOk}
            ranges={
              maTableOk
                ? pendingRanges
                : timeRangesFromWeeklyFree(selectedWeeklyFree, weekdayAbbrFromDateKey(selectedDateKey))
            }
            onRangesChange={(ranges) => {
              if (!selectedPropertyId) return
              if (maTableOk) {
                maDirtyRef.current = true
                setPendingRanges(normalizeTimeRanges(ranges))
              }
            }}
            onSave={() => void (maTableOk ? saveManagerAvailabilityToAirtable() : saveTourDirtyIfNeeded())}
            repeatWeekly={maTableOk ? repeatWeekly : false}
            onRepeatWeeklyChange={maTableOk ? (v) => setRepeatWeekly(v) : undefined}
            onCancelDraft={
              maTableOk
                ? () => {
                    maDirtyRef.current = false
                    setPendingRanges(mergedForSelectedDay)
                    setRepeatWeekly(false)
                  }
                : undefined
            }
            saveButtonLabel={maTableOk ? 'Save availability to Airtable' : undefined}
            availabilityHint={
              maTableOk
                ? 'Drag the timeline to add manager free blocks, then Save (or switch day — unsaved changes save first). “Apply every week” repeats on this weekday from the selected date forward; it resets when you change days. Each saved window is stored as 30-minute rows in Manager Availability with a Time Slot value (e.g. 7:00am-7:30am). Confirmed tours still come from Scheduling.'
                : 'The calendar no longer writes tour hours to property Notes. Enable the Manager Availability Airtable table (see docs: remove VITE_USE_MANAGER_AVAILABILITY_TABLE=false) to edit slots here.'
            }
            hidePropertyPicker
            selectedPropertyRecord={selectedProperty}
            scheduledItems={scheduledItemsForSelectedDay}
            availSaving={availSaving}
            manager={manager}
            propertyOptions={availabilityOwnerOptions}
            selectedPropertyId={selectedPropertyId}
            onSelectProperty={(id) => void selectPropertyAndFlush(id)}
            isDateBlocked={blockedDatesSet.has(selectedDateKey)}
            onBlockDay={handleBlockDay}
            onUnblockDay={handleUnblockDay}
            blockSaving={blockSaving}
          />
        )}
        {loadAllSchedulingRows ? (
          <AdminDayAvailabilityEditor
            ranges={adminDayRanges}
            onRangesChange={(next) => {
              adminAvailabilityDirtyRef.current = true
              setAdminDayRanges(next)
            }}
            onClearDay={() => {
              adminAvailabilityDirtyRef.current = true
              setAdminDayRanges([])
            }}
            onSaveNow={async () => {
              const ctx = adminAutosaveCtxRef.current
              const dayKey = String(ctx?.selectedDateKey || '').trim()
              if (!dayKey) return
              adminAvailabilityDirtyRef.current = false
              try {
                await persistAdminMeetingAvailability(dayKey, ctx.adminDayRanges, ctx.adminAvailabilityRowsForSelectedDay)
              } catch {
                adminAvailabilityDirtyRef.current = true
              }
            }}
            scheduledItems={adminScheduledItemsForDay}
            availSaving={availSaving}
          />
        ) : null}
      </div>
    </div>
  )
}

// ─── ManagerDashboard ─────────────────────────────────────────────────────────
const MANAGER_DASH_TABS = [
  ['dashboard', 'Dashboard'],
  ['properties', 'Properties'],
  ['applications', 'Applications'],
  ['leases', 'Leases'],
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
    if (h === 'leasing') return 'leases'
    return MANAGER_DASH_TABS.some(([id]) => id === h) ? h : 'dashboard'
  })
  useEffect(() => { window.location.hash = dashView }, [dashView])
  const [drafts, setDrafts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showGenerateModal, setShowGenerateModal] = useState(false)
  const [filters, setFilters] = useState({ status: '__draft_ready__', property: '' })
  const [propertyRecords, setPropertyRecords] = useState([])
  const [billingLoading, setBillingLoading] = useState(false)
  const [overviewStats, setOverviewStats] = useState(null)
  const [overviewStatsLoading, setOverviewStatsLoading] = useState(false)
  const [overviewDataWarnings, setOverviewDataWarnings] = useState([])
  const [leasesLoadError, setLeasesLoadError] = useState('')
  const [inboxUnopenedCount, setInboxUnopenedCount] = useState(0)

  const managerScope = useMemo(() => computeManagerScope(propertyRecords, manager), [propertyRecords, manager])
  const scopedPropertyOptions = useMemo(
    () => Array.from(mergedManagerPropertyNames(managerScope)).sort(),
    [managerScope],
  )
  // Property record IDs for the work orders scope filter (matches linked House field directly)
  const scopedPropertyIds = useMemo(() => {
    const names = mergedManagerPropertyNames(managerScope)
    return propertyRecords
      .filter((p) => {
        const n = propertyRecordName(p)
        return n && names.has(n)
      })
      .map((p) => p.id)
  }, [propertyRecords, managerScope])
  /** Same name + property-id scope as WorkOrdersTabPanel (assigned + approved properties). */
  const mergedPropertyNamesLower = useMemo(
    () =>
      new Set(
        [...mergedManagerPropertyNames(managerScope)]
          .map((n) => String(n).trim().toLowerCase())
          .filter(Boolean),
      ),
    [managerScope],
  )
  const workOrderScopePropertyIds = useMemo(
    () => new Set(scopedPropertyIds.map((id) => String(id).trim()).filter(Boolean)),
    [scopedPropertyIds],
  )
  /** Calendar / tour scheduling: all houses linked to this manager (including pending approval). */
  const calendarScopedPropertyOptions = useMemo(
    () => Array.from(managerScope.assignedNames).sort(),
    [managerScope.assignedNames],
  )
  const approvedNamesLower = useMemo(
    () => new Set([...managerScope.approvedNames].map((n) => String(n).trim().toLowerCase()).filter(Boolean)),
    [managerScope.approvedNames],
  )

  function handleManagerUpdate(updated) {
    setManager(updated)
    onManagerUpdate?.(updated)
  }

  useEffect(() => {
    const managerId = String(manager?.id || '').trim()
    if (!managerId || isManagerInternalPreview(manager)) return
    let cancelled = false
    fetchManagerRecordById(managerId)
      .then((record) => {
        if (cancelled || !record) return
        const next = { ...manager, ...record }
        setManager(next)
        onManagerUpdate?.(next)
      })
      .catch(() => {
        // non-fatal: keep existing manager context
      })
    return () => {
      cancelled = true
    }
  }, [manager?.id])

  const loadDrafts = useCallback(async () => {
    setLoading(true)
    setLeasesLoadError('')
    try {
      const ownerKey = String(manager?.id || manager?.airtableRecordId || '').trim()
      const [rows, appsForOwner] = await Promise.all([
        fetchLeaseDrafts({ property: filters.property, status: '' }),
        getApplicationsForOwner(ownerKey).catch(() => []),
      ])
      const appById = new Map(appsForOwner.map((a) => [a.id, a]))
      const names = managerScope.approvedNames
      const scoped =
        names.size > 0
          ? rows.filter(
              (d) =>
                leaseDraftInScope(d, names) &&
                leaseDraftPassesApplicationApprovalGate(d, appById),
            )
          : []
      // Keep full property-scoped list in state; status tab only filters the table + card counts stay stable.
      setDrafts(scoped)
    } catch (err) {
      setLeasesLoadError(formatDataLoadError(err))
    } finally {
      setLoading(false)
    }
  }, [filters.property, managerScope.approvedNames, manager?.id, manager?.airtableRecordId])

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
      listAllResidentsRecords(),
    ])
      .then((results) => {
        if (cancelled) return
        const warnings = []
        const appsRaw = results[0].status === 'fulfilled' ? results[0].value : null
        const drRaw = results[1].status === 'fulfilled' ? results[1].value : null
        const woRaw = results[2].status === 'fulfilled' ? results[2].value : null
        const payRaw = results[3].status === 'fulfilled' ? results[3].value : null
        const residentsRaw = results[4].status === 'fulfilled' ? results[4].value : null
        if (results[0].status === 'rejected') warnings.push(`Applications: ${formatDataLoadError(results[0].reason)}`)
        if (results[1].status === 'rejected') warnings.push(`Lease drafts: ${formatDataLoadError(results[1].reason)}`)
        if (results[2].status === 'rejected') warnings.push(`Work orders: ${formatDataLoadError(results[2].reason)}`)
        if (results[3].status === 'rejected') warnings.push(`Payments: ${formatDataLoadError(results[3].reason)}`)
        if (results[4].status === 'rejected') warnings.push(`Residents: ${formatDataLoadError(results[4].reason)}`)
        setOverviewDataWarnings(warnings)

        if (!appsRaw && !drRaw && !woRaw && !payRaw) {
          setOverviewStats(null)
          return
        }

        const apps = approvedNamesLower.size
          ? (appsRaw || []).filter((a) => applicationInScope(a, approvedNamesLower))
          : []
        const appByIdForLeases = new Map((apps || []).map((a) => [a.id, a]))
        const dr = names.size
          ? (drRaw || []).filter(
              (d) =>
                leaseDraftInScope(d, names) &&
                leaseDraftPassesApplicationApprovalGate(d, appByIdForLeases),
            )
          : []
        const scopedResidentIds = residentsRaw
          ? buildManagerScopedResidentIdSet(residentsRaw, mergedPropertyNamesLower, workOrderScopePropertyIds)
          : new Set()
        const wo =
          mergedPropertyNamesLower.size || workOrderScopePropertyIds.size || scopedResidentIds.size
            ? (woRaw || []).filter((w) =>
                workOrderInScope(w, mergedPropertyNamesLower, workOrderScopePropertyIds, scopedResidentIds),
              )
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
  }, [dashView, managerScope.approvedNames, approvedNamesLower, mergedPropertyNamesLower, workOrderScopePropertyIds])

  // Unopened threads for dashboard badge (aligned with ManagerInboxPage: scope + site-manager + property website inquiries)
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
        const managerSiteKey = siteManagerThreadKey(email)
        const allowedAdminPropertyKeys = new Set(
          (scopedPropertyIds || []).map((id) => housingPublicAdminPropertyThread(id)),
        )
        const byTk = new Map()
        for (const m of msgs) {
          const tk = portalInboxThreadKeyFromRecord(m)
          if (!tk) continue
          if (!byTk.has(tk)) byTk.set(tk, [])
          byTk.get(tk).push(m)
        }
        let unopened = 0
        for (const [tk, list] of byTk) {
          if (tk.startsWith('internal:site-manager:')) {
            if (tk !== managerSiteKey && !tk.startsWith(`${managerSiteKey}:t:`)) continue
          }
          if (
            tk === HOUSING_PUBLIC_ADMIN_GENERAL_THREAD ||
            tk.startsWith(`${HOUSING_PUBLIC_ADMIN_GENERAL_THREAD}:t:`)
          ) {
            continue
          }
          if (tk.startsWith('internal:admin-public:property:')) {
            let propAllowed = false
            for (const prefix of allowedAdminPropertyKeys) {
              if (tk === prefix || tk.startsWith(`${prefix}:t:`)) {
                propAllowed = true
                break
              }
            }
            if (!propAllowed) continue
          } else if (tk.startsWith('internal:admin-public:')) {
            continue
          }
          if (tk.startsWith('internal:resident-leasing:')) {
            if (!residentLeasingThreadVisibleToManager(list, mergedPropertyNamesLower)) continue
          }
          if (tk.startsWith('internal:mgmt-admin:') || tk.startsWith('internal:resident-admin:')) continue
          let latest = 0
          for (const m of list) {
            const ts = new Date(m.Timestamp || m.created_at || 0).getTime()
            if (ts > latest) latest = ts
          }
          if (latest <= 0) continue
          const state = stateMap.get(tk)
          if (state?.trashed) continue
          const latestDate = new Date(latest)
          if (!state?.lastReadAt || latestDate > state.lastReadAt) unopened++
        }
        if (!cancelled) setInboxUnopenedCount(unopened)
      } catch {
        // non-fatal
      }
    }
    fetchUnopenedCount()
    return () => {
      cancelled = true
    }
  }, [manager, scopedPropertyIds, mergedPropertyNamesLower])

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
    if (!s) return 'draft_ready'
    if (s === '__draft_ready__') return 'draft_ready'
    if (s === '__sent_to_resident__') return 'sent_to_resident'
    if (s === '__signed__') return 'signed'
    return 'draft_ready'
  }, [filters.status])

  const leaseFilterItems = useMemo(() => {
    const flow = LEASE_FLOW_CARDS.map((card) => ({
      id: card.id,
      label: card.label,
      value: String(drafts.filter((d) => card.match(String(d.Status || '').trim())).length),
      hint: 'In queue',
      tone: card.id === 'draft_ready' ? 'amber' : card.id === 'signed' ? 'emerald' : 'axis',
    }))
    return flow
  }, [drafts])

  const visibleLeaseDrafts = useMemo(
    () => drafts.filter((d) => leaseDraftMatchesQueueFilter(d.Status, filters.status)),
    [drafts, filters.status],
  )

  function setLeaseFilterCardId(cardId) {
    const map = {
      draft_ready: '__draft_ready__',
      sent_to_resident: '__sent_to_resident__',
      signed: '__signed__',
    }
    setFilters((f) => ({ ...f, status: map[cardId] ?? '__draft_ready__' }))
  }

  function handleGenerated(newDraft) {
    setDrafts(prev => [{ id: newDraft.id, ...newDraft }, ...prev])
  }

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

  return (
    <>
      <PortalShell
        brandTitle="Manager"
        desktopNav="sidebar"
        navItems={MANAGER_NAV_ITEMS}
        activeId={dashView}
        onNavigate={setDashView}
        onSignOut={onSignOut}
        pinMainScroll={dashView === 'calendar'}
        sidebarFooterExtra={
          <button
            type="button"
            onClick={handleBillingPortal}
            disabled={billingLoading}
            className={`${portalChromeSecondaryButtonClass} disabled:opacity-50`}
          >
            {billingLoading ? 'Opening…' : 'Billing'}
          </button>
        }
      >
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
          <WorkOrdersTabPanel manager={manager} allowedPropertyNames={scopedPropertyOptions} allowedPropertyIds={scopedPropertyIds} />
        ) : dashView === 'calendar' ? (
          <CalendarTabPanel manager={manager} allowedPropertyNames={calendarScopedPropertyOptions} />
        ) : dashView === 'inbox' ? (
          <ManagerInboxPage
            manager={manager}
            allowedPropertyNames={scopedPropertyOptions}
            allowedPropertyIds={scopedPropertyIds}
          />
        ) : dashView === 'leases' ? (
          <ManagerLeasingTab manager={manager} allowedPropertyNames={scopedPropertyOptions} />
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
          <div className="mr-auto flex w-full flex-col sm:w-auto">
            <h2 className="text-2xl font-black text-slate-900">Leases</h2>
          </div>

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

        <div className="mb-5 grid gap-2 rounded-[28px] border border-slate-200 bg-slate-50 p-2 sm:grid-cols-3 xl:grid-cols-3">
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
              <PortalEmptyVisual variant="document" />
              <div className="text-sm font-semibold text-slate-700">No leases yet</div>
            </div>
          ) : (
            <div className="space-y-4 p-4 sm:p-5">
              <DataTable
                empty={(
                  <div className="flex flex-col items-center gap-3">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                      stroke="currentColor"
                      className="h-10 w-10 shrink-0 text-[#2563eb]"
                      aria-hidden
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                      />
                    </svg>
                    <span>No leases in this view</span>
                  </div>
                )}
                columns={[
                  {
                    key: 'resident',
                    label: 'Resident',
                    headerClassName: 'w-[30%]',
                    render: (draft) => (
                      <>
                        <div className="font-semibold text-slate-900">{draft['Resident Name'] || '—'}</div>
                        <div className="text-xs text-slate-500">{draft['Resident Email'] || 'No email on file'}</div>
                      </>
                    ),
                  },
                  {
                    key: 'property',
                    label: 'Property',
                    headerClassName: 'w-[30%]',
                    render: (draft) => (
                      <>
                        <div className="text-sm font-semibold text-slate-900">{draft['Property'] || '—'}</div>
                        <div className="text-xs text-slate-500">{draft['Unit'] ? `Unit ${draft['Unit']}` : 'Unit not set'}</div>
                      </>
                    ),
                  },
                  {
                    key: 'status',
                    label: 'Status',
                    headerClassName: 'w-[20%] text-center',
                    cellClassName: 'text-center',
                    render: (draft) => <StatusBadge status={leaseUiStatusLabel(draft['Status'])} />,
                  },
                  {
                    key: 'actions',
                    label: 'Action',
                    headerClassName: 'w-[20%] text-right',
                    cellClassName: 'text-right',
                    render: (draft) => (
                      <button
                        type="button"
                        className="whitespace-nowrap text-sm font-semibold text-[#2563eb] hover:underline"
                        onClick={() =>
                          openDraftId === draft.id ? onCloseDraft() : onOpenDraft(draft.id)
                        }
                      >
                        {openDraftId === draft.id ? 'Hide details' : 'Details'}
                      </button>
                    ),
                  },
                ]}
                rows={visibleLeaseDrafts.map((draft) => ({ key: draft.id, data: draft }))}
              />
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

// ─── LeaseEditor ──────────────────────────────────────────────────────────────
// Full-screen editor for reviewing, editing, and approving a single lease draft.
function LeaseEditor({ draftId, manager, onBack, embedded = false }) {
  const [draft, setDraft] = useState(null)
  const [editorContent, setEditorContent] = useState('')
  const [managerNotes, setManagerNotes] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [actionLoading, setActionLoading] = useState('') // 'approve' | 'publish' | 'signforge' | 'signforge-status'
  const leaseFileInputRef = useRef(null)

  const leaseDataForPreview = useMemo(() => {
    if (!draft) return null
    try {
      const raw = draft['Lease JSON']
      if (raw == null || !String(raw).trim()) return null
      const o = JSON.parse(String(raw))
      return o && typeof o === 'object' ? o : null
    } catch {
      return null
    }
  }, [draft])

  const managerSigOnDraft = useMemo(() => pickManagerSignatureFromDraft(draft, import.meta.env), [draft])

  const loadDraft = useCallback(async () => {
    setLoading(true)
    try {
      const d = await fetchLeaseDraft(draftId)
      setDraft(d)
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
      }
    } catch (err) {
      toast.error('Could not load draft: ' + err.message)
    } finally {
      setLoading(false)
    }
  }, [draftId, manager])

  useEffect(() => { loadDraft() }, [loadDraft])

  function handleLeaseTextFileSelected(ev) {
    const input = ev.target
    const f = input.files?.[0]
    if (!f) return
    const name = f.name.toLowerCase()
    const okType = /^text\//.test(f.type) || name.endsWith('.txt') || name.endsWith('.md')
    if (!okType) {
      toast.error('Upload a .txt or .md file, or copy text from Word/PDF into the lease box.')
      input.value = ''
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      setEditorContent(String(reader.result ?? ''))
      toast.success('Lease text loaded from file — click Save when ready')
    }
    reader.onerror = () => toast.error('Could not read that file')
    reader.readAsText(f)
    input.value = ''
  }

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
      toast.success('Edits saved')
    } catch (err) {
      toast.error('Save failed: ' + err.message)
    } finally {
      setSaving(false)
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
        <div className={`${embedded ? '' : 'mx-auto max-w-7xl'} flex items-center justify-between gap-3`}>
          {/* Status Area */}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-base font-black text-slate-900">
                {draft?.['Resident Name'] || '—'}
                {draft?.['Property'] ? ` — ${draft['Property']}` : ''}
                {draft?.['Unit'] ? `, ${draft['Unit']}` : ''}
              </h1>
              {status && <StatusBadge status={leaseUiStatusLabel(status)} size="lg" />}
            </div>
          </div>
          
          {/* Send to resident button (in header if canApprove) */}
          {canApprove && (
            <button
              type="button"
              onClick={handleApprove}
              disabled={!!actionLoading}
              className="ml-auto shrink-0 whitespace-nowrap rounded-xl bg-green-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-700 disabled:opacity-50"
            >
              {actionLoading === 'approve' ? 'Sending…' : 'Send to resident'}
            </button>
          )}
        </div>
      </header>

      {/* Body — lease-focused column (no sidebar) */}
      <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-5 sm:px-6">
        <div className="min-w-0 space-y-4">
          {leaseDataForPreview ? (
            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-5 py-3">
                <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Formatted lease agreement</div>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                >
                  Print / PDF
                </button>
              </div>
              <div className="max-h-[min(80vh,880px)] overflow-y-auto overflow-x-hidden bg-white p-2">
                <LeaseHTMLTemplate
                  leaseData={leaseDataForPreview}
                  signedBy={draft?.Status === 'Signed' ? draft?.['Signature Text'] : undefined}
                  signedAt={draft?.Status === 'Signed' ? draft?.['Signed At'] : undefined}
                  managerSignedBy={managerSigOnDraft.text || undefined}
                  managerSignedAt={managerSigOnDraft.at || undefined}
                  managerSignatureImageUrl={managerSigOnDraft.image || undefined}
                />
              </div>
            </div>
          ) : draft && !loading ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-950">
              <strong>No structured lease data yet.</strong> Open the linked application → Details → use{' '}
              <strong>Generate Lease</strong> / <strong>Regenerate Lease</strong> to fill <strong>Lease JSON</strong>, then refresh this page.
            </div>
          ) : null}

          {leaseDataForPreview && draft && manager ? (
            <LeaseManagerSignPanel
              draft={draft}
              manager={manager}
              onSaved={async (id, fields) => {
                const updated = await patchLeaseDraft(id, fields)
                setDraft(updated)
                try {
                  await logAudit({
                    leaseDraftId: id,
                    actionType: 'Manager Signed',
                    performedBy: manager.name,
                    performedByRole: manager.role,
                    notes: 'Manager saved landlord counter-signature on lease draft',
                  })
                } catch {
                  /* non-fatal */
                }
              }}
            />
          ) : null}

          {canEdit ? (
            <>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Upload your lease</div>
                <p className="mt-1 text-xs text-slate-500">
                  Use a plain-text file (.txt or .md). For Word or PDF, copy the text and paste it into the lease editor below.
                </p>
                <input
                  ref={leaseFileInputRef}
                  type="file"
                  accept=".txt,.md,text/plain"
                  className="hidden"
                  onChange={handleLeaseTextFileSelected}
                />
                <button
                  type="button"
                  onClick={() => leaseFileInputRef.current?.click()}
                  disabled={!!actionLoading}
                  className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
                >
                  Choose file…
                </button>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <label className="mb-1 block text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
                  Changes and instructions
                </label>
                <p className="mb-2 text-xs text-slate-500">
                  Describe edits you need or notes for your team. Saved with the lease (not shown to the resident as lease text).
                </p>
                <textarea
                  value={managerNotes}
                  onChange={(e) => setManagerNotes(e.target.value)}
                  rows={4}
                  placeholder="e.g. Update parking clause, add pet addendum, fix move-out date…"
                  className="w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[#2563eb] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20"
                />
              </div>
            </>
          ) : null}

          {!canEdit && !leaseDataForPreview ? (
            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 bg-slate-50 px-5 py-2.5">
                <span className="text-xs font-semibold text-slate-500">
                  Read-only — this lease has been {leaseUiStatusLabel(status).toLowerCase()}
                </span>
              </div>
              {String(editorContent || '').trim() ? (
                <div className="max-h-[min(55vh,520px)] overflow-y-auto p-5">
                  <pre className="whitespace-pre-wrap font-mono text-sm leading-7 text-slate-800">{editorContent}</pre>
                </div>
              ) : (
                <p className="px-5 py-4 text-sm text-slate-500">
                  No plain-text copy on file. When <strong>Lease JSON</strong> is filled, the formatted agreement above is what residents see.
                </p>
              )}
            </div>
          ) : null}

          {(canEdit ||
            canApprove ||
            canPublish ||
            canSignforgeSend ||
            canSignforgeRefresh) && (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                {canEdit && (
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving || !!actionLoading}
                    className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 sm:px-4"
                  >
                    {saving ? 'Saving…' : 'Save'}
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
              <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                {canApprove && (
                  <button
                    type="button"
                    onClick={handleApprove}
                    disabled={!!actionLoading}
                    className="rounded-xl bg-green-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-700 disabled:opacity-50"
                  >
                    {actionLoading === 'approve' ? 'Sending…' : 'Send to resident'}
                  </button>
                )}
                {canPublish && (
                  <button
                    type="button"
                    onClick={handlePublish}
                    disabled={!!actionLoading}
                    className="rounded-xl bg-[#2563eb] px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
                  >
                    {actionLoading === 'publish' ? 'Sending…' : 'Send to resident'}
                  </button>
                )}
              </div>
            </div>
          )}
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

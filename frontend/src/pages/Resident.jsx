import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { properties } from '../data/properties'
import { EmbeddedStripeCheckout } from '../components/EmbeddedStripeCheckout'
import LeaseHTMLTemplate from '../components/LeaseHTMLTemplate'
import LeaseSignPanel from '../components/LeaseSignPanel'
import {
  PortalOpsCard,
  PortalOpsEmptyState,
  PortalOpsMetric,
  PortalOpsStatusBadge,
} from '../components/PortalOpsUI'
import ResidentPortalInbox from '../components/portal-inbox/ResidentPortalInbox'
import {
  PortalField,
  PortalNotice,
  PortalPasswordInput,
  PortalPrimaryButton,
  PortalSegmentedControl,
  portalAuthInputCls,
} from '../components/PortalAuthUI'
import PortalShell, { DataTable, StatusPill } from '../components/PortalShell'
import { PortalNavGlyph } from '../components/portalNavIcons.jsx'
import { HOUSING_CONTACT_MESSAGE, HOUSING_CONTACT_SCHEDULE } from '../lib/housingSite'
import {
  airtableReady,
  createResident,
  createWorkOrder,
  deleteWorkOrderForResident,
  getApplicationById,
  getApprovedLeaseForResident,
  getCurrentLeaseVersion,
  getLeaseDraftsForResident,
  submitResidentLeaseIssueReport,
  uploadLeaseVersionPdfFile,
  getPropertyByName,
  getPaymentsForResident,
  createPaymentRecord,
  updatePaymentRecord,
  deletePaymentRecord,
  listResidentPortalRoomHoldPaymentRecords,
  buildResidentPortalRoomHoldNotes,
  getResidentByEmail,
  getResidentById,
  getWorkOrdersForResident,
  loginResident,
  stripWorkOrderPortalSubmitterLine,
  updateResident,
  getAllPortalInternalThreadMessages,
  fetchInboxThreadStateMap,
  portalInboxAirtableConfigured,
  portalInboxThreadKeyFromRecord,
} from '../lib/airtable'
import { applicationRejectedFieldName, deriveApplicationApprovalState } from '../lib/applicationApprovalState.js'
import { anyLeaseDraftAllowsSignWithoutMoveInPay } from '../lib/leaseMoveInOverride.js'
import { isResidentLeaseBodyViewable, isResidentLeaseSignable } from '../lib/residentLeaseAccess.js'
import { pickManagerSignatureFromDraft } from '../../../shared/lease-manager-signature-fields.js'
import {
  evaluateLeaseAccessPrereqs,
  isFeeWaivePaymentRecord,
  normalizeLeaseAccessRequirement,
  paymentsIndicateFirstMonthRentPaid,
  paymentsIndicateSecurityDepositPaid,
} from '../../../shared/lease-access-requirements.js'
import { workOrderScheduledMeta } from '../lib/workOrderShared.js'
import {
  classifyResidentPaymentLine,
  dueDateStringForMonth,
  finalizeResidentPaymentAfterStripeSuccess,
  findRentPaymentForBillingMonth,
  findUtilitiesPaymentForBillingMonth,
  getPaymentKind,
  iterRecurringBillingMonthKeys,
  listDashboardDuePaymentLines,
  longMonthLabel,
  reconcilePaymentStatusesInAirtable,
  rentDueDayFromResident,
} from '../lib/residentPaymentsShared.js'
import {
  ROOM_CLEANING_FEE_USD,
  ensurePostpayRoomCleaningFeePayment,
  residentPostpayCleaningDescriptionSuffix,
  workOrderShouldCreatePaymentWhenScheduled,
} from '../lib/roomCleaningWorkOrder.js'

const SESSION_KEY = 'axis_resident'

const requestCategories = [
  'Plumbing',
  'Electrical',
  'Heating / Cooling',
  'Appliance',
  'General Maintenance',
  'Cleaning',
  'Other',
]
const urgencyOptions = ['Low', 'Medium', 'Urgent']
const preferredTimeWindowOptions = ['Morning', 'Afternoon', 'Evening']

function normalizeUnitLabel(value) {
  return String(value || '').replace(/^Unit\s+/i, 'Room ').trim()
}

const WORK_ORDER_RESOLVED_VISIBLE_MS = 7 * 86400000

function parseWorkOrderDate(value) {
  if (value == null || value === '') return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value
  const str = String(value).trim()
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) {
    const y = Number(m[1])
    const mo = Number(m[2]) - 1
    const d = Number(m[3])
    return new Date(y, mo, d)
  }
  const parsed = new Date(str)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function isWorkOrderResolved(record) {
  if (!record) return false
  const resolvedCheckbox = record.Resolved === true || record.Resolved === 1 || record.Resolved === '1'
  const status = String(record.Status || '').trim().toLowerCase()
  return resolvedCheckbox || status === 'resolved' || status === 'completed' || status === 'closed'
}

/** Prefer explicit "Last Update" / "Date Resolved" for the 7-day rule (not submission date). */
function getWorkOrderLastUpdateDate(record) {
  if (!record) return null
  const keys = ['Last Update', 'Last Updated', 'Date Resolved']
  for (const k of keys) {
    const d = parseWorkOrderDate(record[k])
    if (d) return d
  }
  return null
}

/**
 * Resolved work orders stay visible for 7 days after Last Update (when set).
 * If resolved but no last-update date yet, keep visible so residents still see resolution + summary.
 */
function isWorkOrderHiddenFromResidentList(record) {
  if (!isWorkOrderResolved(record)) return false
  const last = getWorkOrderLastUpdateDate(record)
  if (!last) return false
  return Date.now() - last.getTime() > WORK_ORDER_RESOLVED_VISIBLE_MS
}

function isWorkOrderOpen(record) {
  return !isWorkOrderResolved(record)
}

function residentWorkOrderStatusLabel(record) {
  if (!record) return 'Open'
  if (isWorkOrderResolved(record)) {
    return 'Done'
  }
  const visit = workOrderScheduledMeta(record)
  if (visit?.date) return 'Scheduled'
  const raw = String(record.Status || '').trim().toLowerCase()
  if (raw.includes('schedule')) return 'Scheduled'
  if (raw.includes('review') || raw.includes('progress')) return 'In Progress'
  if (raw === 'submitted' || raw === 'open') return 'Open'
  return 'Open'
}

function residentWorkOrderStatusTone(record) {
  const label = residentWorkOrderStatusLabel(record)
  if (label === 'Done') return 'emerald'
  if (label === 'Scheduled') return 'axis'
  if (label === 'In Progress') return 'amber'
  return 'slate'
}

function residentWorkOrderStatusPillTone(record) {
  const label = residentWorkOrderStatusLabel(record)
  if (label === 'Done') return 'green'
  if (label === 'Scheduled') return 'axis'
  if (label === 'In Progress') return 'amber'
  return 'slate'
}

function residentWorkOrderFilterBucket(record) {
  if (!record) return 'open'
  if (isWorkOrderResolved(record)) return 'completed'
  const visit = workOrderScheduledMeta(record)
  if (visit?.date) return 'scheduled'
  const raw = String(record.Status || '').trim().toLowerCase()
  if (raw.includes('schedule')) return 'scheduled'
  return 'open'
}

function parseWorkOrderSchedule(record) {
  const sm = workOrderScheduledMeta(record)
  if (sm?.date) {
    return sm.preferredTime ? `${sm.date} · ${sm.preferredTime}` : sm.date
  }
  const explicit =
    record?.['Scheduled Date'] ||
    record?.['Scheduled At'] ||
    record?.['Schedule Date'] ||
    record?.['Scheduled Time']
  if (explicit) return String(explicit)
  const raw = String(record?.Update || '').match(/scheduled for:\s*(.+)/i)
  return raw?.[1]?.trim() || ''
}


function parseDisplayDate(value) {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const raw = String(value).trim()
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function formatDate(value) {
  const d = parseDisplayDate(value)
  if (!d) return 'No date'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function classNames(...values) {
  return values.filter(Boolean).join(' ')
}

/** Consistent header controls across resident tabs (Payments, Work Orders, Lease). */
const RP_HEADER_BTN_SECONDARY =
  'rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50'
const RP_HEADER_BTN_PRIMARY =
  'rounded-full bg-axis px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50'
const RP_HEADER_SELECT =
  'rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 shadow-sm transition focus:border-[#2563eb] focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20'

function isApprovalGranted(value) {
  if (value === true || value === 1) return true
  const normalized = String(value || '').trim().toLowerCase()
  return ['true', '1', 'yes', 'approved'].includes(normalized)
}

/** Linked Applications record ids on Resident Profile (apply / manager-approve pipeline). */
function residentApplicationsRecordIds(resident) {
  const apps = resident?.Applications
  if (!Array.isArray(apps)) return []
  return apps
    .map((id) => String(id || '').trim())
    .filter((s) => s.startsWith('rec') && s.length >= 11)
}

function residentApplicationUnlocked(resident) {
  if (isResidentApplicationRejected(resident)) return false
  if (isApprovalGranted(resident?.['Application Approval'])) return true
  // Applicants with a linked Applications row must not unlock on `Approved` alone (legacy / mis-set rows).
  if (residentApplicationsRecordIds(resident).length > 0) return false
  return isApprovalGranted(resident?.Approved)
}

function isResidentApplicationRejected(resident) {
  const rejectedKey = applicationRejectedFieldName()
  const rejectionFlags = [
    resident?.[rejectedKey],
    resident?.Rejected,
    resident?.['Application Rejected'],
    resident?.['Rejected'],
  ]
  const hasRejectedFlag = rejectionFlags.some((value) => {
    if (value === true || value === 1) return true
    const normalized = String(value || '').trim().toLowerCase()
    return ['true', '1', 'yes', 'rejected', 'declined', 'denied'].includes(normalized)
  })
  if (hasRejectedFlag) return true

  const statusFields = [
    resident?.['Application Status'],
    resident?.['Approval Status'],
    resident?.['Application Approval'],
    resident?.Status,
    resident?.Decision,
  ]
  return statusFields.some((value) => {
    const normalized = String(value || '').trim().toLowerCase()
    return ['rejected', 'declined', 'denied', 'not approved'].includes(normalized)
  })
}

/**
 * @param {'pending' | 'approved' | 'rejected' | null | undefined} linkedAppState
 *   Live state from the Applications table when the resident row links to an application (source of truth).
 */
function residentPortalAccessState(resident, linkedAppState) {
  if (isResidentApplicationRejected(resident)) return 'rejected'
  if (linkedAppState === 'rejected') return 'rejected'
  if (linkedAppState === 'approved') return 'approved'
  if (linkedAppState === 'pending') return 'pending'
  return residentApplicationUnlocked(resident) ? 'approved' : 'pending'
}

function ResidentPendingApprovalGate() {
  return (
    <div className="rounded-3xl border border-amber-200 bg-amber-50/60 px-6 py-12 text-center shadow-soft">
      <p className="text-base font-semibold text-amber-950">Waiting for manager approval</p>
      <p className="mx-auto mt-2 max-w-lg text-sm text-amber-900/90">
        You&apos;re signed in. Your rental application is still being reviewed. When a manager approves it in Axis, this section will unlock. You can update your profile anytime from the sidebar.
      </p>
    </div>
  )
}

function ResidentRejectedGate() {
  return (
    <div className="rounded-3xl border border-red-200 bg-red-50/60 px-6 py-12 text-center shadow-soft">
      <p className="text-base font-semibold text-red-900">Application not approved</p>
      <p className="mx-auto mt-2 max-w-lg text-sm text-red-900/90">
        Your application was not approved. Payments, work orders, leasing, and inbox are disabled for this account.
      </p>
    </div>
  )
}

function formatMoney(value) {
  return `$${Number(value || 0).toLocaleString()}`
}

function parseErrorMessage(err) {
  const raw = err?.message ? String(err.message) : String(err || '')
  try {
    const j = JSON.parse(raw)
    const inner = j?.error?.message || j?.message
    if (typeof inner === 'string' && inner.trim()) return inner.trim()
  } catch { /* not JSON */ }
  return raw || 'An error occurred.'
}

function getLeaseTermLabel(resident) {
  const t = String(resident?.['Lease Term'] || '').trim()
  if (t) return t
  if (resident?.['Lease Start Date'] && !resident?.['Lease End Date']) return 'Month-to-Month'
  return 'Fixed Term'
}

function getRoomMonthlyRent(propertyName, unitNumber) {
  if (!propertyName || !unitNumber) return 0
  const property = properties.find((p) => p.name === propertyName)
  if (property) {
    for (const plan of property.roomPlans || []) {
      const room = (plan.rooms || []).find((r) => normalizeUnitLabel(r.name) === normalizeUnitLabel(unitNumber))
      if (room?.price) {
        const amount = parseInt(String(room.price).replace(/[^0-9]/g, ''), 10)
        if (Number.isFinite(amount) && amount > 0) return amount
      }
    }
  }
  const propKey = String(propertyName || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
  const roomDigits =
    String(normalizeUnitLabel(unitNumber) || '')
      .replace(/^room\s*/i, '')
      .match(/(\d+)/)?.[1] || ''
  if (!roomDigits) return 0
  if (propKey.includes('5259') && propKey.includes('brooklyn')) {
    const brooklyn = { 1: 865, 2: 865, 3: 825, 4: 825, 5: 825, 6: 800, 7: 800, 8: 800, 9: 800 }
    return brooklyn[Number(roomDigits)] || 0
  }
  if (propKey.includes('4709a') || propKey.includes('4709 a')) {
    const a = { 1: 775, 2: 775, 3: 775, 4: 775, 5: 775, 6: 775, 7: 775, 8: 775, 9: 750, 10: 875 }
    return a[Number(roomDigits)] || 0
  }
  if (propKey.includes('4709b') || propKey.includes('4709 b')) {
    const b = { 1: 775, 2: 800, 3: 800, 4: 800, 5: 800, 6: 800, 7: 800, 8: 800, 9: 800 }
    return b[Number(roomDigits)] || 0
  }
  return 0
}

function getStaticSecurityDeposit(propertyName) {
  const property = properties.find((p) => p.name === propertyName)
  if (property?.securityDeposit) {
    const amount = parseInt(String(property.securityDeposit).replace(/[^0-9]/g, ''), 10)
    if (Number.isFinite(amount) && amount > 0) return amount
  }
  const k = String(propertyName || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
  if (k.includes('5259') && k.includes('brooklyn')) return 600
  if (k.includes('4709a') || k.includes('4709 a')) return 500
  if (k.includes('4709b') || k.includes('4709 b')) return 500
  return 0
}

/** Monthly flat utilities (resident profile overrides property default). */
function getMonthlyUtilitiesAmount(propertyName, resident) {
  const fromResident =
    resident?.['Utilities Fee'] ??
    resident?.['Monthly Utilities'] ??
    resident?.['Utilities Amount'] ??
    resident?.['Utilities']
  if (fromResident != null && fromResident !== '') {
    if (typeof fromResident === 'number' && Number.isFinite(fromResident) && fromResident > 0) return fromResident
    const n = parseInt(String(fromResident).replace(/[^0-9]/g, ''), 10)
    if (Number.isFinite(n) && n > 0) return n
  }
  const property = properties.find((p) => p.name === propertyName)
  if (property?.utilitiesFee) {
    const n = parseInt(String(property.utilitiesFee).replace(/[^0-9]/g, ''), 10)
    if (Number.isFinite(n) && n > 0) return n
  }
  return 0
}

/** Parse currency / numeric fields from Airtable or Lease JSON (same idea as manager portal). */
function parseResidentMoney(value) {
  if (value == null || value === '') return 0
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  const digits = String(value).replace(/[^0-9]/g, '')
  if (!digits) return 0
  const n = parseInt(digits, 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Default room hold shown in Payments when no matching Airtable row yet (override per resident or VITE_ROOM_HOLD_FEE_USD). */
function residentRoomHoldFeeUsd(resident) {
  const keys = ['Room Hold Fee', 'Hold Fee', 'Hold Fee Amount']
  for (const k of keys) {
    const n = parseResidentMoney(resident?.[k])
    if (n > 0) return n
  }
  const envRaw = String(import.meta.env.VITE_ROOM_HOLD_FEE_USD ?? '100').trim()
  if (envRaw === '0' || envRaw.toLowerCase() === 'false') return 0
  const env = parseInt(envRaw.replace(/[^0-9]/g, ''), 10)
  return Number.isFinite(env) && env > 0 ? env : 100
}

/** Checkbox (or truthy text) on Residents — hold bed before signing lease. Order: env override, then common Airtable names. */
function roomHoldWithoutLeaseFieldCandidates() {
  const fromEnv = String(import.meta.env.VITE_RESIDENT_ROOM_HOLD_WITHOUT_LEASE_FIELD || '').trim()
  const defaults = [
    'Room Hold Without Lease',
    'Hold Room Without Lease',
    'Hold Room Without Signing Lease',
  ]
  const ordered = [...(fromEnv ? [fromEnv] : []), ...defaults]
  return [...new Set(ordered.map((x) => String(x || '').trim()).filter(Boolean))]
}

function airtableResponseIsUnknownFieldName(err) {
  const raw = err?.message != null ? String(err.message) : String(err)
  try {
    const j = JSON.parse(raw)
    return j?.error?.type === 'UNKNOWN_FIELD_NAME'
  } catch {
    return /UNKNOWN_FIELD_NAME/i.test(raw) || /Unknown field name/i.test(raw)
  }
}

function airtableResponseIsInvalidValueForColumn(err) {
  const raw = err?.message != null ? String(err.message) : String(err)
  try {
    const j = JSON.parse(raw)
    return j?.error?.type === 'INVALID_VALUE_FOR_COLUMN'
  } catch {
    return /INVALID_VALUE_FOR_COLUMN/i.test(raw)
  }
}

/** Parse comma-separated PATCH values from env (e.g. single-select option labels). */
function roomHoldEnvValueList(envKey) {
  const raw = String(import.meta.env[envKey] || '').trim()
  if (!raw) return []
  const out = []
  for (const part of raw.split(',')) {
    const t = String(part || '').trim()
    if (!t) continue
    const lower = t.toLowerCase()
    if (lower === 'null') {
      out.push(null)
      continue
    }
    if (lower === 'true') {
      out.push(true)
      continue
    }
    if (lower === 'false') {
      out.push(false)
      continue
    }
    if (/^-?\d+$/.test(t)) {
      const n = parseInt(t, 10)
      out.push(Number.isFinite(n) ? n : t)
      continue
    }
    out.push(t)
  }
  return out
}

function uniquePatchValues(values) {
  const out = []
  const seen = new Set()
  for (const v of values) {
    const key =
      v === null ? '\0null' : typeof v === 'boolean' ? `b:${v}` : typeof v === 'number' ? `n:${v}` : `s:${String(v)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(v)
  }
  return out
}

/** Values to PATCH for hold path: checkbox booleans first, then common single-select / text literals. Env overrides are tried first. */
function roomHoldWithoutLeaseValueCandidates(wantHold) {
  const envKey = wantHold
    ? 'VITE_RESIDENT_ROOM_HOLD_WITHOUT_LEASE_TRUE_VALUES'
    : 'VITE_RESIDENT_ROOM_HOLD_WITHOUT_LEASE_FALSE_VALUES'
  const fromEnv = roomHoldEnvValueList(envKey)
  const builtIns = wantHold
    ? [
        true,
        1,
        'Yes',
        'Hold only',
        'Room hold only',
        'Hold room only',
        'Hold',
        'Room hold',
        'Hold without lease',
      ]
    : [false, 0, 'No', 'Signing lease', 'Lease', 'Normal move-in', 'Signing the lease', '', null]
  return uniquePatchValues([...fromEnv, ...builtIns])
}

/**
 * PATCH resident hold-path flag; tries field names and value shapes until Airtable accepts one.
 * @returns {Promise<object>} mapped resident record
 */
async function updateResidentRoomHoldPathFlag(residentId, wantHold) {
  const candidates = roomHoldWithoutLeaseFieldCandidates()
  const values = roomHoldWithoutLeaseValueCandidates(wantHold)
  let lastErr = null
  for (const field of candidates) {
    let unknownField = false
    for (const value of values) {
      try {
        return await updateResident(residentId, { [field]: value })
      } catch (e) {
        lastErr = e
        if (airtableResponseIsUnknownFieldName(e)) {
          unknownField = true
          break
        }
        if (airtableResponseIsInvalidValueForColumn(e)) continue
        throw e
      }
    }
    if (unknownField) continue
  }
  const triedFields = candidates.map((f) => `"${f}"`).join(', ')
  const hint =
    'Use a Checkbox field, or a Single select whose options match one of the values we try (booleans, Yes/No, Hold only / Signing lease). You can set VITE_RESIDENT_ROOM_HOLD_WITHOUT_LEASE_TRUE_VALUES and VITE_RESIDENT_ROOM_HOLD_WITHOUT_LEASE_FALSE_VALUES to your exact option labels (comma-separated).'
  const tail = lastErr?.message ? ` ${String(lastErr.message).slice(0, 280)}` : ''
  throw new Error(`Could not save move-in path. Tried fields: ${triedFields}. ${hint}${tail}`)
}

function residentOptedRoomHoldWithoutSigningLease(resident) {
  if (!resident || typeof resident !== 'object') return false
  const keys = roomHoldWithoutLeaseFieldCandidates()
  const holdTokens = new Set([
    'true',
    'yes',
    'y',
    '1',
    'checked',
    'hold only',
    'room hold only',
    'hold room only',
    'hold',
    'room hold',
    'hold without lease',
    'hold room without lease',
  ])
  for (const key of keys) {
    const v = resident[key]
    if (v === true || v === 1) return true
    const s = String(v ?? '').trim().toLowerCase()
    if (holdTokens.has(s)) return true
  }
  return false
}

/** Hold fee credits toward security deposit when the resident is on the hold-without-lease path. */
function residentRoomHoldCreditTowardDepositUsd(resident) {
  if (!residentOptedRoomHoldWithoutSigningLease(resident)) return 0
  return residentRoomHoldFeeUsd(resident)
}

/** Newest signed lease draft (for payments: rent / utilities / deposit match the signed unit). */
function pickSignedLeaseDraft(drafts) {
  if (!Array.isArray(drafts) || drafts.length === 0) return null
  const signed = drafts.filter((d) => String(d.Status || '').trim() === 'Signed')
  if (signed.length === 0) return null
  return [...signed].sort(
    (a, b) =>
      new Date(b['Published At'] || b.created_at || 0) - new Date(a['Published At'] || a.created_at || 0),
  )[0]
}

/**
 * Move-in and recurring payment fallbacks: after the lease is signed, amounts follow the signed
 * Lease Drafts row (Property / Unit / Rent Amount / Utilities Fee / Deposit Amount), with Lease JSON
 * and static room lookup as backups (e.g. 4709A vs Brooklyn deposit differs on the draft).
 */
function residentPaymentsPricing(resident, signedLeaseDraft) {
  const profileHouse = String(resident?.House || '').trim()
  const profileUnit = String(resident?.['Unit Number'] || '').trim()

  if (!signedLeaseDraft) {
    const depositDirect =
      parseResidentMoney(resident['Security Deposit Amount'] ?? resident['Security Deposit']) ||
      getStaticSecurityDeposit(profileHouse)
    const holdCredit = residentRoomHoldCreditTowardDepositUsd(resident)
    const securityDeposit =
      holdCredit > 0 && depositDirect > 0 ? Math.max(0, depositDirect - holdCredit) : depositDirect
    return {
      propertyName: profileHouse,
      unitNumber: profileUnit,
      monthlyRent: getRoomMonthlyRent(profileHouse, profileUnit),
      utilitiesFee: getMonthlyUtilitiesAmount(profileHouse, resident),
      securityDeposit,
    }
  }

  const prop = String(signedLeaseDraft.Property || signedLeaseDraft['Property Name'] || profileHouse).trim()
  const unit = String(signedLeaseDraft.Unit || signedLeaseDraft['Unit Number'] || profileUnit).trim()

  let leaseJson = null
  try {
    const raw = signedLeaseDraft['Lease JSON']
    if (raw && typeof raw === 'string') leaseJson = JSON.parse(raw)
  } catch {
    leaseJson = null
  }

  let monthlyRent = parseResidentMoney(signedLeaseDraft['Rent Amount'])
  if (monthlyRent <= 0 && leaseJson) monthlyRent = parseResidentMoney(leaseJson.monthlyRent)
  if (monthlyRent <= 0) monthlyRent = getRoomMonthlyRent(prop, unit)

  let utilitiesFee = parseResidentMoney(signedLeaseDraft['Utilities Fee'])
  if (utilitiesFee <= 0 && leaseJson) utilitiesFee = parseResidentMoney(leaseJson.utilityFee ?? leaseJson.utilitiesFee)
  if (utilitiesFee <= 0) utilitiesFee = getMonthlyUtilitiesAmount(prop, resident)

  let securityDeposit = parseResidentMoney(signedLeaseDraft['Deposit Amount'])
  if (securityDeposit <= 0 && leaseJson) securityDeposit = parseResidentMoney(leaseJson.securityDeposit)
  if (securityDeposit <= 0) {
    securityDeposit =
      parseResidentMoney(resident['Security Deposit Amount'] ?? resident['Security Deposit']) ||
      getStaticSecurityDeposit(prop || profileHouse)
  }

  const holdCredit = residentRoomHoldCreditTowardDepositUsd(resident)
  if (holdCredit > 0 && securityDeposit > 0) {
    securityDeposit = Math.max(0, securityDeposit - holdCredit)
  }

  return {
    propertyName: prop || profileHouse,
    unitNumber: unit || profileUnit,
    monthlyRent,
    utilitiesFee,
    securityDeposit,
  }
}

const leaseSigningFields = ['DocuSign Signing URL', 'DocuSign URL', 'Lease Signing URL', 'Lease Sign URL', 'Lease Document URL', 'Lease URL']

function firstAvailableLink(record, fields) {
  if (!record) return ''
  for (const field of fields) {
    const value = record[field]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function resolveLeaseSigningUrl(resident) {
  return firstAvailableLink(resident, leaseSigningFields) || import.meta.env.VITE_DOCUSIGN_SIGNING_URL || ''
}

function statusPillToneForResidentPayment(status) {
  if (status === 'Paid') return 'green'
  if (status === 'Overdue') return 'red'
  if (status === 'Due Soon') return 'amber'
  if (status === 'Partial') return 'axis'
  return 'blue'
}

function ResidentPaymentDetailPanel({ row, onClose, onPayNow, payLoadingKey }) {
  if (!row) return null
  const tone = statusPillToneForResidentPayment(row.statusLabel)
  const canPay = row.balance > 0
  const payKey = row.payCategory || 'rent'
  const busy = payLoadingKey === payKey && Boolean(payLoadingKey)

  return (
    <div className="space-y-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-black text-slate-900">{row.title}</h2>
          <p className="mt-1 text-sm text-slate-600">{row.subtitle}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusPill tone={tone}>{row.statusLabel}</StatusPill>
            {row.statusHint ? (
              <span className="text-xs font-medium text-amber-700">{row.statusHint}</span>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          className="shrink-0 text-sm font-semibold text-slate-500 hover:text-slate-800"
          onClick={onClose}
        >
          Close
        </button>
      </div>

      {canPay ? (
        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          <button
            type="button"
            disabled={busy}
            onClick={onPayNow}
            className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            {busy ? 'Opening…' : 'Pay now'}
          </button>
        </div>
      ) : null}

      {row.metaRows?.length ? (
        <dl className="space-y-0 border-t border-slate-100 pt-4">
          {row.metaRows.map(({ label, value }, i) => (
            <div
              key={i}
              className="grid gap-1 border-b border-slate-100 py-2.5 last:border-b-0 sm:grid-cols-[minmax(0,200px)_1fr] sm:gap-4"
            >
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
              <dd className="text-sm text-slate-900">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  )
}

function residentAmountDue(payment) {
  const direct = Number(payment?.Amount ?? payment?.['Amount Due'] ?? payment?.Total ?? 0)
  return Number.isFinite(direct) ? direct : 0
}

function residentAmountPaid(payment) {
  const explicit = Number(payment?.['Amount Paid'] ?? payment?.['Paid Amount'] ?? payment?.Paid ?? payment?.['Collected Amount'])
  if (Number.isFinite(explicit) && explicit >= 0) return explicit
  const rawStatus = String(payment?.Status || '').trim().toLowerCase()
  return rawStatus === 'paid' ? residentAmountDue(payment) : 0
}

function residentBalance(payment) {
  const explicit = Number(payment?.Balance ?? payment?.['Balance Due'] ?? payment?.Outstanding)
  if (Number.isFinite(explicit)) return Math.max(0, explicit)
  return Math.max(0, residentAmountDue(payment) - residentAmountPaid(payment))
}

function residentPaymentLineStatus(payment) {
  const balance = residentBalance(payment)
  const due = parseDisplayDate(payment?.['Due Date'])
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (balance <= 0) return 'Paid'
  if (balance < residentAmountDue(payment)) return 'Partial'
  if (due) {
    const diffDays = Math.ceil((due.getTime() - today.getTime()) / 86400000)
    if (diffDays < 0) return 'Overdue'
    if (diffDays <= 5) return 'Due Soon'
  }
  return 'Unpaid'
}

/** Rent-only snapshot for dashboard + summaries (aligned with Payments tab logic). */
function buildResidentRentSnapshot(payments, resident) {
  const list = Array.isArray(payments) ? payments : []
  const sortedPayments = [...list].sort(
    (a, b) => new Date(a['Due Date'] || a.created_at || 0) - new Date(b['Due Date'] || b.created_at || 0),
  )
  const rentPayments = sortedPayments.filter((p) => getPaymentKind(p) === 'rent')
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  let unpaidTotal = 0
  let overdueTotal = 0
  let paidTotal = 0
  for (const p of rentPayments) {
    if (residentPaymentLineStatus(p) === 'Paid') {
      const rec = residentAmountPaid(p)
      paidTotal += rec > 0 ? rec : residentAmountDue(p)
      continue
    }
    const bal = residentBalance(p)
    if (bal <= 0) continue
    unpaidTotal += bal
    const due = parseDisplayDate(p['Due Date'])
    if (due && !Number.isNaN(due.getTime()) && due < today) {
      overdueTotal += bal
    }
  }
  const unpaidRent = rentPayments.filter((p) => residentBalance(p) > 0)
  const currentDuePayment = unpaidRent[0] || null
  const fallbackRent = getRoomMonthlyRent(resident?.House, resident?.['Unit Number'])
  const nextDue = currentDuePayment
    ? {
        balance: residentBalance(currentDuePayment),
        dueDate: currentDuePayment['Due Date'],
        month: currentDuePayment.Month,
        status: residentPaymentLineStatus(currentDuePayment),
      }
    : fallbackRent > 0
      ? {
          balance: fallbackRent,
          dueDate: resident?.['Next Rent Due'] || '',
          month: 'Current rent',
          status: 'Unpaid',
        }
      : null
  return { unpaidTotal, overdueTotal, paidTotal, nextDue, rentPayments }
}

function dashboardPaymentStatusTone(status) {
  if (status === 'Paid') return 'emerald'
  if (status === 'Partial') return 'axis'
  if (status === 'Due Soon') return 'amber'
  if (status === 'Overdue') return 'red'
  return 'slate'
}

// ─── Shared UI ────────────────────────────────────────────────────────────────

function SectionCard({ title, description, children, action }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-7">
        <div>
          <h2 className="text-2xl font-black text-slate-900">{title}</h2>
          {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
        </div>
        {action}
      </div>
      <div className="px-5 py-5 sm:px-7 sm:py-6">{children}</div>
    </div>
  )
}

class PanelErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }
  componentDidCatch(error, info) {
    console.error('[ResidentPortal] Panel error:', error, info)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-3xl border border-red-200 bg-red-50 px-6 py-10 text-center">
          <p className="text-sm font-semibold text-red-800">This section hit an error</p>
          <p className="mt-1 text-xs text-red-700">
            {this.state.error?.message || 'An unexpected error occurred. Try refreshing.'}
          </p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, error: null })}
            className="mt-4 rounded-full border border-red-300 bg-white px-5 py-2 text-xs font-semibold text-red-800 transition hover:bg-red-50"
          >
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function SetupRequired() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_100%)] px-4">
      <div className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-soft">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-50">
          <svg className="h-6 w-6 text-amber-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>
        <h1 className="text-2xl font-black text-slate-900">Portal configuration required</h1>
        <p className="mt-3 text-sm leading-7 text-slate-500">
          The API token doesn&apos;t have access to the Resident Portal database. To fix this:
        </p>
        <ol className="mt-5 space-y-2 text-left text-sm text-slate-700">
          <li className="flex gap-2"><span className="font-bold text-axis">1.</span> Open your personal access token in your data provider&apos;s developer hub and edit it</li>
          <li className="flex gap-2"><span className="font-bold text-axis">2.</span> Under <strong>Base access</strong>, add the workspace that matches this site&apos;s configured base ID (<code className="rounded bg-slate-100 px-1 text-xs">{import.meta.env.VITE_AIRTABLE_BASE_ID || 'not set — check .env'}</code>)</li>
          <li className="flex gap-2"><span className="font-bold text-axis">3.</span> Ensure scopes include <code className="rounded bg-slate-100 px-1 text-xs">data.records:read</code> and <code className="rounded bg-slate-100 px-1 text-xs">data.records:write</code></li>
          <li className="flex gap-2"><span className="font-bold text-axis">4.</span> Save the token — no code change needed</li>
        </ol>
      </div>
    </div>
  )
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export function ResidentAuthForm({ onLogin, footer = null, variant = 'default' }) {
  const urlAppId = typeof window !== 'undefined'
    ? (new URLSearchParams(window.location.search).get('appId') || '')
    : ''
  const [tab, setTab] = useState(urlAppId ? 'activate' : 'signin')
  const [signInForm, setSignInForm] = useState({ email: '', password: '' })
  const [activateForm, setActivateForm] = useState({ applicationId: urlAppId, email: '', password: '' })
  const [signInLoading, setSignInLoading] = useState(false)
  const [activationLoading, setActivationLoading] = useState(false)
  const [signInError, setSignInError] = useState('')
  const [activationError, setActivationError] = useState('')
  const [postCreateMessage, setPostCreateMessage] = useState('')

  async function handleLogin(event) {
    event.preventDefault()
    setSignInLoading(true)
    setSignInError('')
    setPostCreateMessage('')
    try {
      const resident = await loginResident(signInForm.email.trim(), signInForm.password)
      if (!resident) {
        setSignInError('Invalid email or password. Contact Axis if you need help.')
        return
      }
      const leaseEnd = resident['Lease End Date']
      if (leaseEnd && new Date(leaseEnd) < new Date(new Date().toDateString())) {
        setSignInError('Your lease has ended. Contact Axis to discuss renewal.')
        return
      }
      onLogin(resident)
    } catch (err) {
      setSignInError(err.message || 'Login failed. Please try again.')
    } finally {
      setSignInLoading(false)
    }
  }

  async function handleSignup(event) {
    event.preventDefault()
    if (activateForm.password.length < 6) {
      setActivationError('Password must be at least 6 characters.')
      return
    }
    setActivationLoading(true)
    setActivationError('')
    try {
      const app = await getApplicationById(activateForm.applicationId.trim())
      if (!app) {
        setActivationError('Application not found. Check your Application ID (format: APP-recXXXXXXXXXXXXXX).')
        return
      }
      const appEmail = String(app['Signer Email'] || '').trim().toLowerCase()
      if (appEmail !== activateForm.email.trim().toLowerCase()) {
        setActivationError('Email does not match the application. Use the email you applied with.')
        return
      }
      const rawAppInput = activateForm.applicationId.trim()
      const applicationRecordId = rawAppInput.startsWith('APP-') ? rawAppInput.slice(4) : rawAppInput
      const applicationLink =
        applicationRecordId.startsWith('rec') && applicationRecordId.length > 10
          ? [applicationRecordId]
          : null

      const existing = await getResidentByEmail(activateForm.email.trim())
      if (existing) {
        if (existing.Password) {
          setActivationError('An account with this email already exists. Please sign in.')
          return
        }
        const patch = {
          Password: activateForm.password,
          Status: 'Active',
          'Lease Term': existing['Lease Term'] || app['Lease Term'] || '',
        }
        if (applicationLink && !(Array.isArray(existing.Applications) && existing.Applications.length)) {
          patch.Applications = applicationLink
        }
        if (app['Application ID'] != null && existing['Application ID'] == null) {
          patch['Application ID'] = app['Application ID']
        }
        await updateResident(existing.id, patch)
        setPostCreateMessage(
          'Account saved. Sign in below — your dashboard will show a short notice until a manager approves your application.',
        )
        setSignInForm((c) => ({ ...c, email: activateForm.email.trim(), password: '' }))
        setActivateForm((c) => ({ ...c, password: '' }))
        setTab('signin')
        return
      }
      await createResident({
        Name: app['Signer Full Name'] || '',
        Email: app['Signer Email'] || '',
        Password: activateForm.password,
        Phone: app['Signer Phone Number'] || '',
        House: app['Property Name'] || '',
        'Unit Number': app['Room Number'] || '',
        'Lease Term': app['Lease Term'] || '',
        'Lease Start Date': app['Lease Start Date'] || null,
        'Lease End Date': app['Lease End Date'] || null,
        Status: 'Active',
        Approved: false,
        ...(applicationLink ? { Applications: applicationLink } : {}),
        ...(app['Application ID'] != null ? { 'Application ID': app['Application ID'] } : {}),
      })
      setPostCreateMessage(
        'Account created. Sign in below — you can use the portal while you wait; full features unlock after manager approval.',
      )
      setSignInForm((c) => ({ ...c, email: activateForm.email.trim(), password: '' }))
      setActivateForm({ applicationId: '', email: '', password: '' })
      setTab('signin')
    } catch (err) {
      setActivationError(err.message || 'Could not create account. Please try again.')
    } finally {
      setActivationLoading(false)
    }
  }

  const portalEntry = variant === 'portal-entry'
  const showSignInActivateTabs = !portalEntry

  return (
    <>
      {showSignInActivateTabs ? (
        <PortalSegmentedControl
          tabs={[['signin', 'Sign in'], ['activate', 'Create account']]}
          active={tab}
          onChange={(id) => {
            setTab(id)
            setSignInError('')
            setActivationError('')
            setPostCreateMessage('')
          }}
        />
      ) : null}

      {tab === 'signin' ? (
        <form onSubmit={handleLogin} className={showSignInActivateTabs ? 'mt-6 space-y-4' : 'mt-0 space-y-4'}>
          {postCreateMessage ? <PortalNotice>{postCreateMessage}</PortalNotice> : null}
          <PortalField label="Email">
            <input type="email" required value={signInForm.email}
              onChange={(e) => setSignInForm((c) => ({ ...c, email: e.target.value }))}
              placeholder="you@example.com" autoComplete="email" className={portalAuthInputCls} />
          </PortalField>
          <PortalField label="Password">
            <PortalPasswordInput value={signInForm.password}
              onChange={(e) => setSignInForm((c) => ({ ...c, password: e.target.value }))}
              autoComplete="current-password" />
          </PortalField>
          {signInError ? <PortalNotice tone="error">{signInError}</PortalNotice> : null}
          <PortalPrimaryButton type="submit" disabled={signInLoading}>
            {signInLoading ? 'Signing in…' : 'Sign in'}
          </PortalPrimaryButton>
          {portalEntry ? (
            <div className="flex flex-col gap-3 pt-1 text-center text-sm text-slate-500">
              <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
                <Link
                  to={HOUSING_CONTACT_MESSAGE}
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
                  setTab('activate')
                  setSignInError('')
                  setActivationError('')
                  setPostCreateMessage('')
                }}
                className="font-semibold text-slate-600 hover:text-slate-900"
              >
                Create account
              </button>
            </div>
          ) : null}
        </form>
      ) : (
        <form onSubmit={handleSignup} className={showSignInActivateTabs ? 'mt-6 space-y-4' : 'mt-0 space-y-4'}>
          {portalEntry ? (
            <div className="mb-4 text-center">
              <button
                type="button"
                onClick={() => {
                  setTab('signin')
                  setSignInError('')
                  setActivationError('')
                  setPostCreateMessage('')
                }}
                className="text-sm font-semibold text-[#2563eb] hover:text-slate-900"
              >
                ← Back to sign in
              </button>
            </div>
          ) : null}
          <PortalNotice>
            Use the email and Application ID from your application. You can create an account anytime; sign-in stays locked until a manager approves your application.{' '}
            <span className="font-mono font-semibold text-slate-800">APP-rec…</span>
          </PortalNotice>
          <PortalField label="Application ID" required>
            <input required value={activateForm.applicationId}
              onChange={(e) => setActivateForm((c) => ({ ...c, applicationId: e.target.value }))}
              placeholder="APP-recXXXXXXXXXXXXXX" className={portalAuthInputCls} />
          </PortalField>
          <PortalField label="Email" required>
            <input type="email" required value={activateForm.email}
              onChange={(e) => setActivateForm((c) => ({ ...c, email: e.target.value }))}
              placeholder="Same email as your application" autoComplete="email" className={portalAuthInputCls} />
          </PortalField>
          <PortalField label="Create password" required>
            <PortalPasswordInput value={activateForm.password}
              onChange={(e) => setActivateForm((c) => ({ ...c, password: e.target.value }))}
              placeholder="Minimum 6 characters" autoComplete="new-password" />
          </PortalField>
          {activationError ? <PortalNotice tone="error">{activationError}</PortalNotice> : null}
          <PortalPrimaryButton type="submit" disabled={activationLoading}>
            {activationLoading ? 'Verifying…' : 'Create account'}
          </PortalPrimaryButton>
        </form>
      )}

      {footer ? <div className="mt-8 text-center text-sm text-slate-400">{footer}</div> : null}
    </>
  )
}

// ─── Work Orders ──────────────────────────────────────────────────────────────

function WorkOrdersPanel({
  resident,
  requests: requestsProp,
  onRequestCreated,
  onWorkOrderUpdated,
  onRefresh,
  onDataRefresh,
  onOpenPayments,
}) {
  const requests = Array.isArray(requestsProp) ? requestsProp : []
  const [woFilter, setWoFilter] = useState('open')
  const [refreshing, setRefreshing] = useState(false)
  const [deleteBusyId, setDeleteBusyId] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [form, setForm] = useState({
    title: '',
    category: requestCategories[0],
    urgency: urgencyOptions[1],
    preferredTimeWindow: preferredTimeWindowOptions[0],
    description: '',
  })
  const [photo, setPhoto] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const woBucketCounts = useMemo(() => {
    const c = { open: 0, scheduled: 0, in_progress: 0, completed: 0 }
    for (const r of requests) {
      const b = residentWorkOrderFilterBucket(r)
      if (c[b] !== undefined) c[b] += 1
    }
    return c
  }, [requests])

  const filteredRequests = useMemo(
    () => requests.filter((r) => residentWorkOrderFilterBucket(r) === woFilter),
    [requests, woFilter],
  )

  async function handleRefresh() {
    if (!onRefresh) return
    setRefreshing(true)
    try {
      await onRefresh()
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    if (filteredRequests.length === 0) {
      setSelectedId(null)
      return
    }
    setSelectedId((current) =>
      current && filteredRequests.some((r) => r.id === current) ? current : filteredRequests[0].id,
    )
  }, [filteredRequests])

  const selectedRequest = useMemo(
    () => (selectedId ? filteredRequests.find((r) => r.id === selectedId) : null),
    [filteredRequests, selectedId],
  )

  const fieldCls = 'w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10'

  async function handleSubmit(event) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    setSuccess('')
    try {
      if (photo) {
        if (!photo.type.startsWith('image/')) throw new Error('Please upload an image file.')
        if (photo.size > 10 * 1024 * 1024) throw new Error('Keep the photo under 10 MB.')
      }
      const desc =
        form.category === 'Cleaning'
          ? `${String(form.description || '').trim()}${residentPostpayCleaningDescriptionSuffix()}`
          : form.description
      const created = await createWorkOrder({
        resident,
        title: form.title,
        category: form.category,
        urgency: form.urgency === 'Medium' ? 'Routine' : form.urgency,
        preferredEntry: form.preferredTimeWindow,
        preferredTimeWindow: form.preferredTimeWindow,
        description: desc,
        photoFile: photo || null,
      })
      setForm({ title: '', category: requestCategories[0], urgency: urgencyOptions[1], preferredTimeWindow: preferredTimeWindowOptions[0], description: '' })
      setPhoto(null)
      setSuccess('Request submitted')
      setShowForm(false)
      onRequestCreated(created)
    } catch (err) {
      setError(err.message || 'Could not submit request.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDeleteWorkOrder(workOrder) {
    if (!workOrder?.id) return
    const label = String(workOrder.Title || 'this work order').trim()
    const confirmed = window.confirm(`Delete ${label}? This cannot be undone.`)
    if (!confirmed) return
    setDeleteBusyId(workOrder.id)
    setError('')
    setSuccess('')
    try {
      await deleteWorkOrderForResident(workOrder.id, resident)
      setSelectedId((cur) => (cur === workOrder.id ? null : cur))
      setSuccess('Work order deleted')
      await onWorkOrderUpdated?.()
    } catch (err) {
      setError(err?.message || 'Could not delete work order.')
    } finally {
      setDeleteBusyId('')
    }
  }

  return (
    <div className="mb-10">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h2 className="mr-auto text-2xl font-black text-slate-900">Work Orders</h2>
        <button
          type="button"
          onClick={() => {
            setShowForm((value) => !value)
            setError('')
            setSuccess('')
          }}
          className={RP_HEADER_BTN_PRIMARY}
        >
          {showForm ? 'Close form' : 'Create new work order'}
        </button>
        {onRefresh ? (
          <button type="button" onClick={() => handleRefresh()} disabled={refreshing} className={RP_HEADER_BTN_SECONDARY}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        ) : null}
      </div>

      <div className="mb-5 grid gap-2 rounded-[28px] border border-slate-200 bg-slate-50 p-2 sm:grid-cols-2 xl:grid-cols-3">
        {[
          ['open', 'Open', woBucketCounts.open],
          ['scheduled', 'Scheduled', woBucketCounts.scheduled],
          ['completed', 'Completed', woBucketCounts.completed],
        ].map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            onClick={() => setWoFilter(key)}
            className={`rounded-2xl border px-4 py-3 text-left transition ${
              woFilter === key
                ? 'border-[#2563eb]/30 bg-white text-slate-900 shadow-[0_10px_24px_rgba(37,99,235,0.14)]'
                : 'border-transparent text-slate-600 hover:border-slate-200 hover:bg-white/70 hover:text-slate-900'
            }`}
          >
            <div className="text-lg font-black leading-none tabular-nums text-slate-900">{count}</div>
            <div className="mt-1 text-sm font-semibold">{label}</div>
          </button>
        ))}
      </div>

        {showForm ? (
          <form onSubmit={handleSubmit} className="mt-6 grid gap-4 border-t border-slate-100 pt-6 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-2 block text-sm font-semibold text-slate-700">Title</label>
              <input
                required
                value={form.title}
                onChange={(e) => setForm((current) => ({ ...current, title: e.target.value }))}
                className={fieldCls}
                placeholder="Kitchen sink leaking"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Category</label>
              <select
                value={form.category}
                onChange={(e) => setForm((current) => ({ ...current, category: e.target.value }))}
                className={fieldCls}
              >
                {requestCategories.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
              {form.category === 'Cleaning' ? (
                <p className="mt-2 text-xs leading-relaxed text-slate-600">
                  One-time room cleaning: submit this request for your manager. When they set a visit date, a{' '}
                  <span className="font-semibold">{formatMoney(ROOM_CLEANING_FEE_USD)}</span> unpaid charge appears
                  under Payments (pay with card there). It is due within seven days after the scheduled visit date.
                </p>
              ) : null}
            </div>
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Priority</label>
              <select
                value={form.urgency}
                onChange={(e) => setForm((current) => ({ ...current, urgency: e.target.value }))}
                className={fieldCls}
              >
                {urgencyOptions.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Preferred time window</label>
              <select
                value={form.preferredTimeWindow}
                onChange={(e) => setForm((current) => ({ ...current, preferredTimeWindow: e.target.value }))}
                className={fieldCls}
              >
                {preferredTimeWindowOptions.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="mb-2 block text-sm font-semibold text-slate-700">Description</label>
              <textarea
                required
                rows={5}
                value={form.description}
                onChange={(e) => setForm((current) => ({ ...current, description: e.target.value }))}
                className={fieldCls}
                placeholder="What is happening, where is it, and anything the team should know before they arrive."
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-2 block text-sm font-semibold text-slate-700">Photo (optional)</label>
              <label className="flex min-h-[120px] cursor-pointer flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center transition hover:border-axis">
                <span className="text-sm font-semibold text-slate-700">{photo ? photo.name : 'Upload photo'}</span>
                <span className="mt-1 text-xs text-slate-400">JPG, PNG, or HEIC · max 10 MB</span>
                <input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] || null)} className="hidden" />
              </label>
            </div>
            {success ? <div className="sm:col-span-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div> : null}
            {error ? <div className="sm:col-span-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={submitting}
                className="rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
              >
                {submitting ? 'Submitting...' : 'Submit Work Order'}
              </button>
            </div>
          </form>
        ) : null}

        {requests.length === 0 ? (
          <div className="mt-6">
            <PortalOpsEmptyState
              icon={<PortalNavGlyph tabId="workorders" className="h-8 w-8 text-slate-500" />}
              title="No work orders yet"
            />
          </div>
        ) : filteredRequests.length === 0 ? (
          <div className="mt-6">
            <PortalOpsEmptyState
              icon={<PortalNavGlyph tabId="search" className="h-8 w-8 text-slate-500" />}
              title="Nothing in this view"
              description="Try another filter above — your requests may be in a different stage"
            />
          </div>
        ) : (
          <div className="mt-6 space-y-6">
            <DataTable
              empty="Nothing in this view"
              columns={[
                {
                  key: 'd',
                  label: 'Description',
                  render: (r) => <span className="font-semibold text-slate-900">{r.Title || 'Work order'}</span>,
                },
                {
                  key: 'sub',
                  label: 'Submitted',
                  render: (r) => (
                    <span className="text-slate-600">{formatDate(r['Date Submitted'] || r.created_at)}</span>
                  ),
                },
                {
                  key: 'cat',
                  label: 'Category',
                  render: (r) => <span className="text-slate-600">{r.Category || '—'}</span>,
                },
                {
                  key: 'st',
                  label: 'Status',
                  render: (r) => (
                    <StatusPill tone={residentWorkOrderStatusPillTone(r)}>{residentWorkOrderStatusLabel(r)}</StatusPill>
                  ),
                },
                {
                  key: 'act',
                  label: '',
                  headerClassName: 'text-right',
                  cellClassName: 'text-right',
                  render: (r) => (
                    <button
                      type="button"
                      className="text-sm font-semibold text-[#2563eb] hover:underline"
                      onClick={() => setSelectedId((cur) => (cur === r.id ? null : r.id))}
                    >
                      {selectedId === r.id ? 'Hide details' : 'Details'}
                    </button>
                  ),
                },
              ]}
              rows={filteredRequests.map((r) => ({ key: r.id, data: r }))}
            />

            {selectedRequest ? (
              <PortalOpsCard
                title={selectedRequest.Title || 'Work order'}
                description={`${selectedRequest.Category || 'General'} · Submitted ${formatDate(selectedRequest['Date Submitted'] || selectedRequest.created_at)}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <PortalOpsStatusBadge tone={residentWorkOrderStatusTone(selectedRequest)}>
                    {residentWorkOrderStatusLabel(selectedRequest)}
                  </PortalOpsStatusBadge>
                  <PortalOpsStatusBadge tone={selectedRequest.Priority === 'Urgent' || selectedRequest.Priority === 'Emergency' ? 'red' : 'slate'}>
                    {selectedRequest.Priority || 'Medium'}
                  </PortalOpsStatusBadge>
                  {parseWorkOrderSchedule(selectedRequest) ? (
                    <PortalOpsStatusBadge tone="axis">
                      Scheduled {parseWorkOrderSchedule(selectedRequest)}
                    </PortalOpsStatusBadge>
                  ) : null}
                </div>

                <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50 px-5 py-4">
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Issue details</div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-700">
                    {stripWorkOrderPortalSubmitterLine(selectedRequest.Description) || 'No description added'}
                  </p>
                </div>

                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={() => handleDeleteWorkOrder(selectedRequest)}
                    disabled={deleteBusyId === selectedRequest.id}
                    className="rounded-full border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-50"
                  >
                    {deleteBusyId === selectedRequest.id ? 'Deleting...' : 'Delete Work Order'}
                  </button>
                </div>

                {selectedRequest['Resolution Summary'] || selectedRequest['Management Notes'] ? (
                  <div className="mt-5 grid gap-4 lg:grid-cols-2">
                    {selectedRequest['Resolution Summary'] ? (
                      <div className="rounded-3xl border border-emerald-200 bg-emerald-50 px-5 py-4">
                        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-700">Completion note</div>
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-emerald-900">
                          {selectedRequest['Resolution Summary']}
                        </p>
                      </div>
                    ) : null}
                    {selectedRequest['Management Notes'] && !selectedRequest['Resolution Summary'] ? (
                      <div className="rounded-3xl border border-slate-200 bg-white px-5 py-4">
                        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Team notes</div>
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-700">
                          {selectedRequest['Management Notes']}
                        </p>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </PortalOpsCard>
            ) : null}
          </div>
        )}
    </div>
  )
}

// ─── Profile ──────────────────────────────────────────────────────────────────

function ProfilePanel({ resident, onUpdated }) {
  const [name, setName] = useState(resident.Name || '')
  const [email, setEmail] = useState(resident.Email || '')
  const [phone, setPhone] = useState(resident.Phone || '')
  const [isEditing, setIsEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    setName(resident.Name || '')
    setEmail(resident.Email || '')
    setPhone(resident.Phone || '')
    setIsEditing(false)
  }, [resident])

  async function handleSubmit(event) {
    event.preventDefault()
    setSaving(true)
    setMessage('')
    setSaveError('')
    try {
      const updated = await updateResident(resident.id, { Name: name, Email: email, Phone: phone })
      onUpdated(updated)
      setMessage('Profile updated')
      setIsEditing(false)
    } catch (err) {
      setSaveError(err.message || 'Could not save profile. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const inputCls =
    'w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm transition focus:border-[#2563eb] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20'
  const readonlyCls = `${inputCls} cursor-default bg-slate-100 text-slate-500`

  function handleCancelEdit() {
    setName(resident.Name || '')
    setEmail(resident.Email || '')
    setPhone(resident.Phone || '')
    setIsEditing(false)
    setMessage('')
    setSaveError('')
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <h2 className="mt-2 text-2xl font-black text-slate-900">Profile</h2>
          {!isEditing ? (
            <button
              type="button"
              onClick={() => {
                setIsEditing(true)
                setMessage('')
                setSaveError('')
              }}
              className="shrink-0 rounded-2xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 transition hover:border-[#2563eb]/40 hover:bg-slate-50"
            >
              Edit info
            </button>
          ) : null}
        </div>

        {!isEditing ? (
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <p className="mb-1.5 text-sm font-semibold text-slate-700">Resident ID</p>
              <div className={`${readonlyCls} font-mono text-sm tracking-tight`}>
                {String(resident.id || '').trim() || '—'}
              </div>
              <p className="mt-1.5 text-xs text-slate-500">Your Axis / Airtable resident record id (for support and linking).</p>
            </div>
            <div>
              <p className="mb-1.5 text-sm font-semibold text-slate-700">Full name</p>
              <div className={readonlyCls}>{name || '—'}</div>
            </div>
            <div>
              <p className="mb-1.5 text-sm font-semibold text-slate-700">Email</p>
              <div className={readonlyCls}>{email || '—'}</div>
            </div>
            <div>
              <p className="mb-1.5 text-sm font-semibold text-slate-700">Phone</p>
              <div className={readonlyCls}>{phone || '—'}</div>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 grid gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Resident ID</p>
              <p className="mt-1 break-all font-mono text-sm font-medium text-slate-900">{String(resident.id || '').trim() || '—'}</p>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">Full name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                className={inputCls}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">Phone</label>
              <input
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 (206) 555-0100"
                className={inputCls}
              />
            </div>
            {message ? (
              <div className="sm:col-span-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>
            ) : null}
            {saveError ? (
              <div className="sm:col-span-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{saveError}</div>
            ) : null}
            <div className="flex flex-wrap gap-3 sm:col-span-2">
              <button
                type="submit"
                disabled={saving || (!name.trim() && !phone.trim())}
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

      <section className="rounded-3xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-black text-slate-900">Your home & lease</h2>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Unit</div>
            <div className="mt-2 text-sm font-semibold text-slate-900">{normalizeUnitLabel(resident['Unit Number'] || '') || '—'}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Lease type</div>
            <div className="mt-2 text-sm font-semibold text-slate-900">{getLeaseTermLabel(resident)}</div>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Lease dates</div>
            <div className="mt-2 text-sm font-semibold text-slate-900">
              {resident['Lease Start Date'] ? formatDate(resident['Lease Start Date']) : '—'}
              {' → '}
              {resident['Lease End Date'] ? formatDate(resident['Lease End Date']) : 'Ongoing'}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

// ─── Payments ─────────────────────────────────────────────────────────────────

function PaymentsPanel({ resident, onResidentUpdated, highlightCategory, onPaymentsDataUpdated }) {
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [actionLoading, setActionLoading] = useState('')
  const [embeddedCheckout, setEmbeddedCheckout] = useState(null)
  const [payFilter, setPayFilter] = useState('pending')
  const [payDetailId, setPayDetailId] = useState(null)
  const [payTableSort, setPayTableSort] = useState('due_asc')
  const [leaseDraftsForPayments, setLeaseDraftsForPayments] = useState([])
  const pendingStripeCheckoutRef = useRef(null)
  const paymentStatusReconcileSigRef = useRef('')

  useEffect(() => {
    setPayDetailId(null)
  }, [payFilter])

  useEffect(() => {
    paymentStatusReconcileSigRef.current = ''
  }, [resident.id])

  const loadPayments = useCallback(() => {
    setLoading(true)
    setError('')
    return getPaymentsForResident(resident)
      .then(setPayments)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [resident])

  const reloadLeaseDraftsForPayments = useCallback(() => {
    return getLeaseDraftsForResident(resident.id, resident.Email || '')
      .then((d) => setLeaseDraftsForPayments(Array.isArray(d) ? d : []))
      .catch(() => setLeaseDraftsForPayments([]))
  }, [resident.id, resident.Email])

  useEffect(() => {
    loadPayments()
  }, [loadPayments])

  useEffect(() => {
    reloadLeaseDraftsForPayments()
  }, [reloadLeaseDraftsForPayments])

  /** Keep Airtable `Status` aligned with balance + due date (manager exports + automations). */
  useEffect(() => {
    if (loading) return
    const rows = Array.isArray(payments) ? payments : []
    if (!rows.length) return
    const sig = rows.map((p) => `${p.id}:${p.Status}:${p.Amount}:${p['Amount Paid']}:${p.Balance}:${p['Due Date']}`).join('|')
    if (paymentStatusReconcileSigRef.current === sig) return
    paymentStatusReconcileSigRef.current = sig
    let cancelled = false
    ;(async () => {
      const patched = await reconcilePaymentStatusesInAirtable(rows, updatePaymentRecord)
      if (cancelled || patched === 0) return
      try {
        const fresh = await getPaymentsForResident(resident)
        if (!cancelled) setPayments(Array.isArray(fresh) ? fresh : [])
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loading, payments, resident])

  const amountDueForRecord = useCallback((payment) => {
    const direct = Number(payment?.Amount ?? payment?.['Amount Due'] ?? payment?.Total ?? 0)
    return Number.isFinite(direct) ? direct : 0
  }, [])

  const amountPaidForRecord = useCallback((payment) => {
    const explicit = Number(payment?.['Amount Paid'] ?? payment?.['Paid Amount'] ?? payment?.Paid ?? payment?.['Collected Amount'])
    if (Number.isFinite(explicit) && explicit >= 0) return explicit
    const rawStatus = String(payment?.Status || '').trim().toLowerCase()
    return rawStatus === 'paid' ? amountDueForRecord(payment) : 0
  }, [amountDueForRecord])

  const balanceForRecord = useCallback((payment) => {
    const explicit = Number(payment?.Balance ?? payment?.['Balance Due'] ?? payment?.Outstanding)
    if (Number.isFinite(explicit)) return Math.max(0, explicit)
    return Math.max(0, amountDueForRecord(payment) - amountPaidForRecord(payment))
  }, [amountDueForRecord, amountPaidForRecord])

  const paymentStatusForRecord = useCallback((payment) => {
    const balance = balanceForRecord(payment)
    const due = parseDisplayDate(payment?.['Due Date'])
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    if (balance <= 0) return 'Paid'
    if (balance < amountDueForRecord(payment)) return 'Partial'
    if (due) {
      const diffDays = Math.ceil((due.getTime() - today.getTime()) / 86400000)
      if (diffDays < 0) return 'Overdue'
      if (diffDays <= 5) return 'Due Soon'
    }
    return 'Unpaid'
  }, [amountDueForRecord, balanceForRecord])

  const paymentToneForStatus = useCallback((status) => {
    if (status === 'Paid') return 'emerald'
    if (status === 'Partial') return 'axis'
    if (status === 'Due Soon') return 'amber'
    if (status === 'Overdue') return 'red'
    return 'slate'
  }, [])

  const sortedPayments = useMemo(
    () => [...payments].sort((a, b) => new Date(a['Due Date'] || a.created_at || 0) - new Date(b['Due Date'] || b.created_at || 0)),
    [payments],
  )

  const rentPayments = useMemo(() => sortedPayments.filter((payment) => getPaymentKind(payment) === 'rent'), [sortedPayments])
  const feePayments = useMemo(() => sortedPayments.filter((payment) => getPaymentKind(payment) === 'fee'), [sortedPayments])
  const unpaidRentPayments = useMemo(
    () => rentPayments.filter((payment) => balanceForRecord(payment) > 0),
    [balanceForRecord, rentPayments],
  )
  const currentDuePayment = unpaidRentPayments[0] || null
  const currentStatus = currentDuePayment ? paymentStatusForRecord(currentDuePayment) : 'Paid'
  const currentAmountDue = currentDuePayment ? balanceForRecord(currentDuePayment) : 0
  const leaseDraftForPaymentsPricing = useMemo(
    () => pickLeaseDraftForPaymentsPricing(leaseDraftsForPayments),
    [leaseDraftsForPayments],
  )
  const payPricing = useMemo(
    () => residentPaymentsPricing(resident, leaseDraftForPaymentsPricing),
    [resident, leaseDraftForPaymentsPricing],
  )
  const fallbackRentAmount = payPricing.monthlyRent
  const fallbackUtilitiesAmount = payPricing.utilitiesFee
  const effectiveCurrentDue = currentDuePayment || (fallbackRentAmount > 0 ? {
    Amount: fallbackRentAmount,
    Month: 'Current rent',
    'Due Date': resident['Next Rent Due'] || '',
  } : null)
  const paymentHistory = useMemo(
    () => [...rentPayments].filter((payment) => paymentStatusForRecord(payment) === 'Paid').sort((a, b) => new Date(b['Paid Date'] || b['Due Date'] || 0) - new Date(a['Paid Date'] || a['Due Date'] || 0)),
    [paymentStatusForRecord, rentPayments],
  )
  const feeChargeRows = useMemo(
    () => [...feePayments].sort((a, b) => new Date(a['Due Date'] || a.created_at || 0) - new Date(b['Due Date'] || b.created_at || 0)),
    [feePayments],
  )

  const firstMonthRentPaid = useMemo(
    () => rentPayments.some((p) => paymentStatusForRecord(p) === 'Paid'),
    [rentPayments, paymentStatusForRecord],
  )

  const firstMonthUtilitiesPaid = useMemo(
    () =>
      sortedPayments.some(
        (p) => classifyResidentPaymentLine(p) === 'first_utilities' && paymentStatusForRecord(p) === 'Paid',
      ),
    [sortedPayments, paymentStatusForRecord],
  )

  const holdFeePaymentRecord = useMemo(
    () => sortedPayments.find((p) => classifyResidentPaymentLine(p) === 'hold_fee') || null,
    [sortedPayments],
  )

  const holdFeePaid = useMemo(
    () =>
      sortedPayments.some(
        (p) => classifyResidentPaymentLine(p) === 'hold_fee' && paymentStatusForRecord(p) === 'Paid',
      ),
    [sortedPayments, paymentStatusForRecord],
  )

  const depositPaymentRecord = useMemo(
    () => sortedPayments.find((p) => classifyResidentPaymentLine(p) === 'deposit') || null,
    [sortedPayments],
  )

  const firstRentPaymentRecord = useMemo(
    () => sortedPayments.find((p) => classifyResidentPaymentLine(p) === 'first_rent') || null,
    [sortedPayments],
  )

  const firstUtilitiesPaymentRecord = useMemo(
    () => sortedPayments.find((p) => classifyResidentPaymentLine(p) === 'first_utilities') || null,
    [sortedPayments],
  )

  const tableSourcePayments = useMemo(() => {
    const showHoldInMoveIn = residentOptedRoomHoldWithoutSigningLease(resident)
    return sortedPayments.filter((p) => {
      if (depositPaymentRecord && p.id === depositPaymentRecord.id) return false
      if (firstRentPaymentRecord && p.id === firstRentPaymentRecord.id) return false
      if (firstUtilitiesPaymentRecord && p.id === firstUtilitiesPaymentRecord.id) return false
      if (showHoldInMoveIn && holdFeePaymentRecord && p.id === holdFeePaymentRecord.id) return false
      return true
    })
  }, [
    sortedPayments,
    depositPaymentRecord,
    firstRentPaymentRecord,
    firstUtilitiesPaymentRecord,
    holdFeePaymentRecord,
    resident,
  ])

  const buildRowFromPayment = useCallback(
    (payment, overrides = {}) => {
      const lineKind = classifyResidentPaymentLine(payment)
      const dueRaw = payment?.['Due Date']
      const dueDateLabel = dueRaw ? formatDate(dueRaw) : ''
      const bal = balanceForRecord(payment)
      const due = amountDueForRecord(payment)
      const paid = amountPaidForRecord(payment)
      const status = paymentStatusForRecord(payment)
      const title = payment.Month || payment.Type || (lineKind === 'fee' ? 'Fee or extra' : 'Rent')
      const subtitle =
        [payPricing.propertyName, normalizeUnitLabel(payPricing.unitNumber || '')].filter(Boolean).join(' · ') ||
        'Your home'
      let recordedAt = null
      if (payment?.created_at) {
        try {
          recordedAt = new Date(payment.created_at).toLocaleString()
        } catch {
          recordedAt = String(payment.created_at)
        }
      }
      const payCategory =
        lineKind === 'fee'
          ? 'fee'
          : lineKind === 'hold_fee'
            ? 'hold_fee'
            : lineKind === 'first_utilities'
              ? 'first_utilities'
              : lineKind === 'monthly_utilities'
                ? 'monthly_utilities'
                : lineKind === 'monthly_rent'
                  ? 'monthly_rent'
                  : lineKind === 'deposit'
                    ? 'deposit'
                    : 'rent'
      const metaRows = []
      if (dueDateLabel) metaRows.push({ label: 'Due date', value: dueDateLabel })
      if (bal > 0) {
        metaRows.push({ label: 'Amount to pay', value: formatMoney(bal) })
      } else if (paid > 0) {
        metaRows.push({ label: 'Paid', value: formatMoney(paid) })
      } else {
        metaRows.push({ label: 'Amount', value: formatMoney(due) })
      }
      const payDescription = overrides.payDescription || `${title} — ${subtitle}`
      return {
        id: payment.id,
        title,
        subtitle,
        dueDateLabel,
        displayAmount: bal > 0 ? bal : due,
        balance: bal,
        statusLabel: status,
        statusHint:
          status === 'Overdue'
            ? 'This balance is past due — pay as soon as you can'
            : status === 'Due Soon'
              ? 'Due within the next few days'
              : '',
        metaRows,
        recordedAt,
        payCategory,
        paymentRecordId: /^rec[a-zA-Z0-9]{14,}$/.test(String(payment?.id || '').trim())
          ? payment.id
          : undefined,
        sortDue: parseDisplayDate(dueRaw)?.getTime() ?? 0,
        sortAmount: due,
        payDescription,
        ...overrides,
      }
    },
    [payPricing, amountDueForRecord, amountPaidForRecord, balanceForRecord, paymentStatusForRecord],
  )

  const depositRow = useMemo(() => {
    if (depositPaymentRecord) {
      return buildRowFromPayment(depositPaymentRecord, {
        title: 'Initial security deposit',
        payDescription: `Security deposit — ${payPricing.propertyName || 'your home'}`,
      })
    }
    if (payPricing.securityDeposit <= 0) return null
    const moveIn = resident['Lease Start Date'] ? formatDate(resident['Lease Start Date']) : ''
    const holdCredit = residentRoomHoldCreditTowardDepositUsd(resident)
    const depositHint =
      holdCredit > 0
        ? `Amount reflects a ${formatMoney(holdCredit)} credit from your room hold fee toward the deposit`
        : 'Typically due at or before move-in unless your lease says otherwise'
    return {
      id: 'synth-security-deposit',
      title: 'Initial security deposit',
      subtitle:
        [payPricing.propertyName, normalizeUnitLabel(payPricing.unitNumber || '')].filter(Boolean).join(' · ') ||
        'Your home',
      dueDateLabel: moveIn,
      displayAmount: payPricing.securityDeposit,
      balance: payPricing.securityDeposit,
      statusLabel: 'Unpaid',
      statusHint: depositHint,
      metaRows: [
        { label: 'Due date', value: moveIn || '—' },
        { label: 'Amount to pay', value: formatMoney(payPricing.securityDeposit) },
      ],
      recordedAt: null,
      payCategory: 'deposit',
      paymentRecordId: undefined,
      sortDue: parseDisplayDate(resident['Lease Start Date'])?.getTime() ?? 0,
      sortAmount: payPricing.securityDeposit,
      payDescription: `Security deposit — ${payPricing.propertyName || 'your home'}`,
    }
  }, [
    buildRowFromPayment,
    depositPaymentRecord,
    payPricing.propertyName,
    payPricing.securityDeposit,
    payPricing.unitNumber,
    resident,
    resident['Lease Start Date'],
  ])

  const holdFeeRow = useMemo(() => {
    if (!residentOptedRoomHoldWithoutSigningLease(resident)) return null
    const amount = residentRoomHoldFeeUsd(resident)
    if (amount <= 0) return null
    if (holdFeePaymentRecord) {
      return buildRowFromPayment(holdFeePaymentRecord, {
        title: 'Room hold fee',
        payDescription: `Room hold fee — ${payPricing.propertyName || 'your home'}`,
      })
    }
    if (holdFeePaid) return null
    const subtitle =
      [payPricing.propertyName, normalizeUnitLabel(payPricing.unitNumber || '')].filter(Boolean).join(' · ') ||
      'Your home'
    const moveIn = resident['Lease Start Date'] ? formatDate(resident['Lease Start Date']) : ''
    return {
      id: 'synth-room-hold-unpaid',
      title: 'Room hold fee',
      subtitle,
      dueDateLabel: moveIn || '—',
      displayAmount: amount,
      balance: amount,
      statusLabel: 'Unpaid',
      statusHint: 'Credited toward rent or deposit; see your leasing notice for refund timing',
      metaRows: [
        { label: 'Due date', value: moveIn || '—' },
        { label: 'Amount to pay', value: formatMoney(amount) },
      ],
      recordedAt: null,
      payCategory: 'hold_fee',
      paymentRecordId: undefined,
      sortDue: parseDisplayDate(resident['Lease Start Date'])?.getTime() ?? 0,
      sortAmount: amount,
      payDescription: `Room hold fee — ${payPricing.propertyName || 'your home'}`,
    }
  }, [
    buildRowFromPayment,
    holdFeePaid,
    holdFeePaymentRecord,
    payPricing.propertyName,
    payPricing.unitNumber,
    resident,
    resident['Lease Start Date'],
  ])

  const firstMonthRow = useMemo(() => {
    if (firstRentPaymentRecord) {
      return buildRowFromPayment(firstRentPaymentRecord, {
        title: 'First month rent',
        payDescription: `First month rent — ${payPricing.propertyName || 'your home'}`,
      })
    }
    if (fallbackRentAmount <= 0) return null
    const subtitle =
      [payPricing.propertyName, normalizeUnitLabel(payPricing.unitNumber || '')].filter(Boolean).join(' · ') ||
      'Your home'
    if (firstMonthRentPaid) {
      const paidRent = [...rentPayments]
        .filter((p) => paymentStatusForRecord(p) === 'Paid')
        .sort(
          (a, b) =>
            new Date(b['Paid Date'] || b['Due Date'] || 0) - new Date(a['Paid Date'] || a['Due Date'] || 0),
        )[0]
      const amt = paidRent ? amountDueForRecord(paidRent) : fallbackRentAmount
      const pd = paidRent?.['Paid Date'] ? formatDate(paidRent['Paid Date']) : ''
      let recordedAt = null
      if (paidRent?.created_at) {
        try {
          recordedAt = new Date(paidRent.created_at).toLocaleString()
        } catch {
          recordedAt = String(paidRent.created_at)
        }
      }
      return {
        id: 'synth-first-month-paid',
        title: 'First month rent',
        subtitle,
        dueDateLabel: paidRent?.['Due Date'] ? formatDate(paidRent['Due Date']) : '',
        displayAmount: amt,
        balance: 0,
        statusLabel: 'Paid',
        statusHint: '',
        metaRows: [
          ...(paidRent?.['Due Date'] ? [{ label: 'Due date', value: formatDate(paidRent['Due Date']) }] : []),
          ...(pd ? [{ label: 'Paid on', value: pd }] : []),
          { label: 'Paid', value: formatMoney(amt) },
        ],
        recordedAt,
        payCategory: 'rent',
        paymentRecordId: paidRent?.id,
        sortDue: parseDisplayDate(paidRent?.['Due Date'])?.getTime() ?? 0,
        sortAmount: amt,
        payDescription: `First month rent — ${payPricing.propertyName || 'your home'}`,
      }
    }
    return {
      id: 'synth-first-month-unpaid',
      title: 'First month rent',
      subtitle,
      dueDateLabel: resident['Lease Start Date'] ? formatDate(resident['Lease Start Date']) : '',
      displayAmount: fallbackRentAmount,
      balance: fallbackRentAmount,
      statusLabel: 'Unpaid',
      statusHint: 'Pay when you are ready to satisfy your move-in rent',
      metaRows: [
        { label: 'Due date', value: resident['Lease Start Date'] ? formatDate(resident['Lease Start Date']) : '—' },
        { label: 'Amount to pay', value: formatMoney(fallbackRentAmount) },
      ],
      recordedAt: null,
      payCategory: 'rent',
      paymentRecordId: undefined,
      sortDue: parseDisplayDate(resident['Lease Start Date'])?.getTime() ?? 0,
      sortAmount: fallbackRentAmount,
      payDescription: `First month rent — ${payPricing.propertyName || 'your home'}`,
    }
  }, [
    buildRowFromPayment,
    firstMonthRentPaid,
    firstRentPaymentRecord,
    fallbackRentAmount,
    paymentStatusForRecord,
    rentPayments,
    amountDueForRecord,
    payPricing.propertyName,
    payPricing.unitNumber,
    resident['Lease Start Date'],
  ])

  const firstUtilitiesRow = useMemo(() => {
    if (firstUtilitiesPaymentRecord) {
      return buildRowFromPayment(firstUtilitiesPaymentRecord, {
        title: 'First month utilities',
        payDescription: `First month utilities — ${payPricing.propertyName || 'your home'}`,
      })
    }
    if (fallbackUtilitiesAmount <= 0) return null
    if (firstMonthUtilitiesPaid) return null
    const subtitle =
      [payPricing.propertyName, normalizeUnitLabel(payPricing.unitNumber || '')].filter(Boolean).join(' · ') ||
      'Your home'
    return {
      id: 'synth-first-utilities-unpaid',
      title: 'First month utilities',
      subtitle,
      dueDateLabel: resident['Lease Start Date'] ? formatDate(resident['Lease Start Date']) : '',
      displayAmount: fallbackUtilitiesAmount,
      balance: fallbackUtilitiesAmount,
      statusLabel: 'Unpaid',
      statusHint: 'Typically due at move-in (flat utilities for this home)',
      metaRows: [
        { label: 'Due date', value: resident['Lease Start Date'] ? formatDate(resident['Lease Start Date']) : '—' },
        { label: 'Amount to pay', value: formatMoney(fallbackUtilitiesAmount) },
      ],
      recordedAt: null,
      payCategory: 'first_utilities',
      paymentRecordId: undefined,
      sortDue: parseDisplayDate(resident['Lease Start Date'])?.getTime() ?? 0,
      sortAmount: fallbackUtilitiesAmount,
      payDescription: `First month utilities — ${payPricing.propertyName || 'your home'}`,
    }
  }, [
    buildRowFromPayment,
    firstUtilitiesPaymentRecord,
    firstMonthUtilitiesPaid,
    fallbackUtilitiesAmount,
    payPricing.propertyName,
    payPricing.unitNumber,
    resident['Lease Start Date'],
  ])

  /**
   * After move-in rent is satisfied, show each following month’s rent + (when configured) utilities
   * until the horizon. Missing Airtable rows appear as synthetic lines so the schedule auto-advances.
   */
  const monthlyRecurringRowVMs = useMemo(() => {
    const leaseStart = resident['Lease Start Date']
    if (!leaseStart || !firstMonthRentPaid || payPricing.monthlyRent <= 0) return []

    const horizon = Number(import.meta.env.VITE_PAYMENT_SCHEDULE_HORIZON_MONTHS || 12) || 12
    const yms = iterRecurringBillingMonthKeys(leaseStart, resident['Lease End Date'], horizon)
    const rd = rentDueDayFromResident(resident)
    const vms = []

    for (const ym of yms) {
      const dueStr = dueDateStringForMonth(ym, rd)
      const rentRec = findRentPaymentForBillingMonth(sortedPayments, ym)
      if (rentRec) {
        vms.push(
          buildRowFromPayment(rentRec, {
            title: rentRec.Month || `${longMonthLabel(ym)} rent`,
            payDescription: `${longMonthLabel(ym)} rent — ${payPricing.propertyName || 'your home'}`,
          }),
        )
      } else {
        const fakeRent = {
          id: `synth-month-rent-${ym}`,
          Amount: payPricing.monthlyRent,
          'Due Date': dueStr,
          Month: `${longMonthLabel(ym)} rent`,
          Type: 'Monthly rent',
          Status: 'Unpaid',
        }
        vms.push(
          buildRowFromPayment(fakeRent, {
            payDescription: `${longMonthLabel(ym)} rent — ${payPricing.propertyName || 'your home'}`,
          }),
        )
      }

      if (fallbackUtilitiesAmount > 0 && firstMonthUtilitiesPaid) {
        const urec = findUtilitiesPaymentForBillingMonth(sortedPayments, ym)
        if (urec) {
          vms.push(
            buildRowFromPayment(urec, {
              title: urec.Month || `${longMonthLabel(ym)} utilities`,
              payDescription: `${longMonthLabel(ym)} utilities — ${payPricing.propertyName || 'your home'}`,
            }),
          )
        } else {
          const fakeU = {
            id: `synth-month-util-${ym}`,
            Amount: fallbackUtilitiesAmount,
            'Due Date': dueStr,
            Month: `${longMonthLabel(ym)} utilities`,
            Type: 'Monthly utilities',
            Status: 'Unpaid',
          }
          vms.push(
            buildRowFromPayment(fakeU, {
              payDescription: `${longMonthLabel(ym)} utilities — ${payPricing.propertyName || 'your home'}`,
            }),
          )
        }
      }
    }
    return vms
  }, [
    buildRowFromPayment,
    firstMonthRentPaid,
    firstMonthUtilitiesPaid,
    fallbackUtilitiesAmount,
    payPricing.monthlyRent,
    payPricing.propertyName,
    resident,
    sortedPayments,
  ])

  useEffect(() => {
    if (highlightCategory === 'extension' || highlightCategory === 'fees') {
      setPayFilter('fees')
      setPayDetailId(null)
      return
    }
    if (!highlightCategory) return
    if (
      highlightCategory === 'deposit' ||
      highlightCategory === 'rent' ||
      highlightCategory === 'utilities' ||
      highlightCategory === 'hold'
    ) {
      setPayFilter('pending')
    }
    if (highlightCategory === 'hold') {
      setPayDetailId(
        holdFeePaymentRecord?.id ||
          (!holdFeePaid &&
          residentOptedRoomHoldWithoutSigningLease(resident) &&
          residentRoomHoldFeeUsd(resident) > 0
            ? 'synth-room-hold-unpaid'
            : null),
      )
      return
    }
    if (highlightCategory === 'deposit') {
      setPayDetailId('synth-security-deposit')
      return
    }
    if (highlightCategory === 'rent') {
      setPayDetailId(
        firstRentPaymentRecord?.id || (firstMonthRentPaid ? 'synth-first-month-paid' : 'synth-first-month-unpaid'),
      )
      return
    }
    if (highlightCategory === 'utilities') {
      setPayDetailId(
        firstUtilitiesPaymentRecord?.id ||
          (!firstMonthUtilitiesPaid && fallbackUtilitiesAmount > 0 ? 'synth-first-utilities-unpaid' : null),
      )
    }
  }, [
    highlightCategory,
    firstRentPaymentRecord,
    firstUtilitiesPaymentRecord,
    firstMonthRentPaid,
    firstMonthUtilitiesPaid,
    fallbackUtilitiesAmount,
    holdFeePaid,
    holdFeePaymentRecord,
    resident,
  ])

  const recordRowsForCurrentFilter = useMemo(() => {
    return tableSourcePayments.filter((p) => {
      if (payFilter === 'fees') return getPaymentKind(p) === 'fee'
      if (payFilter === 'paid') return paymentStatusForRecord(p) === 'Paid'
      return balanceForRecord(p) > 0
    })
  }, [tableSourcePayments, payFilter, paymentStatusForRecord, balanceForRecord])

  const recordVMsForFilter = useMemo(
    () => recordRowsForCurrentFilter.map((p) => buildRowFromPayment(p)),
    [recordRowsForCurrentFilter, buildRowFromPayment],
  )

  const moveInRowsCombined = useMemo(
    () => [holdFeeRow, depositRow, firstMonthRow, firstUtilitiesRow].filter(Boolean),
    [holdFeeRow, depositRow, firstMonthRow, firstUtilitiesRow],
  )

  const unifiedPaymentRows = useMemo(() => {
    if (payFilter === 'fees') return recordVMsForFilter
    if (payFilter === 'paid') {
      const mi = moveInRowsCombined.filter((r) => r.statusLabel === 'Paid')
      const mo = monthlyRecurringRowVMs.filter((r) => r.statusLabel === 'Paid')
      return [...mi, ...mo, ...recordVMsForFilter]
    }
    const mi = moveInRowsCombined.filter((r) => r.balance > 0)
    const mo = monthlyRecurringRowVMs.filter((r) => r.balance > 0)
    return [...mi, ...mo, ...recordVMsForFilter]
  }, [payFilter, moveInRowsCombined, monthlyRecurringRowVMs, recordVMsForFilter])

  const sortedUnifiedPaymentRows = useMemo(() => {
    const arr = [...unifiedPaymentRows]
    const moveInRank = (id) => {
      const s = String(id)
      if (s === 'synth-room-hold-unpaid' || (holdFeePaymentRecord && s === holdFeePaymentRecord.id)) return 0
      if (s === 'synth-security-deposit') return 1
      if (s.startsWith('synth-first-month')) return 2
      if (s.startsWith('synth-first-utilities')) return 3
      const utilRec = firstUtilitiesPaymentRecord
      if (utilRec && s === utilRec.id) return 3
      if (s.startsWith('synth-month-rent-') || s.startsWith('synth-month-util-')) return 4
      return 4
    }
    arr.sort((a, b) => {
      const mr = moveInRank(a.id) - moveInRank(b.id)
      if (mr !== 0) return mr
      if (payTableSort === 'due_desc') return b.sortDue - a.sortDue
      if (payTableSort === 'amount_desc') return b.sortAmount - a.sortAmount
      if (payTableSort === 'amount_asc') return a.sortAmount - b.sortAmount
      return a.sortDue - b.sortDue
    })
    return arr
  }, [unifiedPaymentRows, payTableSort, firstUtilitiesPaymentRecord, holdFeePaymentRecord])

  const detailRow = useMemo(() => {
    if (!payDetailId) return null
    return (
      sortedUnifiedPaymentRows.find((r) => r.id === payDetailId) ||
      unifiedPaymentRows.find((r) => r.id === payDetailId) ||
      null
    )
  }, [payDetailId, sortedUnifiedPaymentRows, unifiedPaymentRows])

  const effectiveCurrentDueDate = effectiveCurrentDue?.['Due Date']

  const launchCheckout = useCallback(
    async ({ amount, items, description, category, paymentRecordId, syntheticRowId }) => {
      setActionError('')
      setActionLoading(category)
      pendingStripeCheckoutRef.current = {
        amount,
        items,
        description,
        category,
        paymentRecordId,
        syntheticRowId,
        residentId: resident.id,
        residentName: resident.Name,
        residentEmail: resident.Email,
        propertyName: payPricing.propertyName || resident.House,
        unitNumber: payPricing.unitNumber || resident['Unit Number'],
      }
      setEmbeddedCheckout({
        title: description,
        request: {
          residentId: resident.id,
          residentName: resident.Name,
          residentEmail: resident.Email,
          propertyName: payPricing.propertyName || resident.House,
          unitNumber: payPricing.unitNumber || resident['Unit Number'],
          amount,
          items,
          description,
          category,
          paymentRecordId,
          syntheticRowId,
        },
        category,
      })
    },
    [payPricing.propertyName, payPricing.unitNumber, resident],
  )

  const handleEmbeddedCheckoutClose = useCallback(() => {
    setActionLoading('')
    pendingStripeCheckoutRef.current = null
    setEmbeddedCheckout(null)
  }, [])

  const handleEmbeddedCheckoutComplete = useCallback(async () => {
    setActionLoading('')
    setEmbeddedCheckout(null)
    const checkoutPayload = pendingStripeCheckoutRef.current
    pendingStripeCheckoutRef.current = null
    setLoading(true)
    try {
      if (checkoutPayload) {
        await finalizeResidentPaymentAfterStripeSuccess(
          { resident, checkoutPayload },
          { updatePaymentRecord, createPaymentRecord },
        ).catch(() => {})
      }
      const [refreshed, drafts] = await Promise.all([
        getPaymentsForResident(resident),
        getLeaseDraftsForResident(resident.id, resident.Email || '').catch(() => []),
      ])
      const rows = Array.isArray(refreshed) ? refreshed : []
      setPayments(rows)
      setLeaseDraftsForPayments(Array.isArray(drafts) ? drafts : [])
      onPaymentsDataUpdated?.(rows)
      // Parent passes `setResident` — must receive a record, not `undefined`, or the whole portal crashes.
      const nextResident = await getResidentById(resident.id)
      if (nextResident) onResidentUpdated?.(nextResident)
    } catch (err) {
      setActionError(err.message || 'Payment completed, but refreshing the balance failed.')
    } finally {
      setLoading(false)
    }
  }, [resident, onPaymentsDataUpdated, onResidentUpdated])

  return (
    <div className="mb-10">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="mr-auto min-w-0">
          <h2 className="text-2xl font-black text-slate-900">Payments</h2>
        </div>
        <label className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <span className="font-semibold text-slate-800">Sort</span>
          <select value={payTableSort} onChange={(e) => setPayTableSort(e.target.value)} className={RP_HEADER_SELECT}>
            <option value="due_asc">Due date (soonest)</option>
            <option value="due_desc">Due date (latest)</option>
            <option value="amount_desc">Amount (high → low)</option>
            <option value="amount_asc">Amount (low → high)</option>
          </select>
        </label>
        <button type="button" onClick={() => loadPayments()} disabled={loading} className={RP_HEADER_BTN_SECONDARY}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="mb-5 grid gap-2 rounded-[28px] border border-slate-200 bg-slate-50 p-2 sm:grid-cols-2 xl:grid-cols-3">
        {[
          [
            'pending',
            'Due or upcoming',
            moveInRowsCombined.filter((r) => r.balance > 0).length +
              monthlyRecurringRowVMs.filter((r) => r.balance > 0).length +
              tableSourcePayments.filter((p) => balanceForRecord(p) > 0).length,
          ],
          [
            'paid',
            'Paid',
            moveInRowsCombined.filter((r) => r.statusLabel === 'Paid').length +
              monthlyRecurringRowVMs.filter((r) => r.statusLabel === 'Paid').length +
              tableSourcePayments.filter((p) => paymentStatusForRecord(p) === 'Paid').length,
          ],
          ['fees', 'Fees & extras', feeChargeRows.length],
        ].map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            onClick={() => setPayFilter(key)}
            className={`rounded-2xl border px-4 py-3 text-left transition ${
              payFilter === key
                ? 'border-[#2563eb]/30 bg-white text-slate-900 shadow-[0_10px_24px_rgba(37,99,235,0.14)]'
                : 'border-transparent text-slate-600 hover:border-slate-200 hover:bg-white/70 hover:text-slate-900'
            }`}
          >
            <div className="text-lg font-black leading-none tabular-nums text-slate-900">{count}</div>
            <div className="mt-1 text-sm font-semibold">{label}</div>
          </button>
        ))}
      </div>

      {loading ? <p className="text-sm text-slate-400">Loading payments...</p> : null}
      {!loading && (
        <>
          {error ? (
            <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Payment history could not be loaded right now. Try refreshing
            </div>
          ) : null}

          {actionError ? (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{actionError}</div>
          ) : null}

          <div className="mt-6 space-y-4">
            <DataTable
              empty={
                payFilter === 'fees' && feeChargeRows.length === 0
                  ? (
                      <div className="flex flex-col items-center gap-3">
                        <svg
                          className="h-10 w-10 shrink-0 text-slate-400"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={1.5}
                          viewBox="0 0 24 24"
                          aria-hidden
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M9 14.25h6m-6 3h6m2.25 3.75H6.75a2.25 2.25 0 0 1-2.25-2.25V5.25A2.25 2.25 0 0 1 6.75 3h10.5A2.25 2.25 0 0 1 19.5 5.25v13.5A2.25 2.25 0 0 1 17.25 21Zm-8.25-12h6a.75.75 0 0 0 .75-.75v-1.5a.75.75 0 0 0-.75-.75h-6a.75.75 0 0 0-.75.75v1.5c0 .414.336.75.75.75Z"
                          />
                        </svg>
                        <span>No fee or extra charges right now</span>
                      </div>
                    )
                  : payFilter === 'paid' && unifiedPaymentRows.length === 0
                    ? 'No paid items in this view yet'
                    : payFilter === 'pending' && unifiedPaymentRows.length === 0
                      ? 'Nothing due right now'
                      : unifiedPaymentRows.length === 0
                        ? 'No payment rows to show'
                        : 'No payment rows to show'
              }
              columns={[
                {
                  key: 'd',
                  label: 'Description',
                  render: (row) => <span className="font-semibold text-slate-900">{row.title}</span>,
                },
                {
                  key: 'due',
                  label: 'Due date',
                  render: (row) => <span className="text-slate-600">{row.dueDateLabel || '—'}</span>,
                },
                {
                  key: 'amt',
                  label: 'Amount',
                  render: (row) => (
                    <span className="font-semibold text-slate-900">{formatMoney(row.balance > 0 ? row.balance : row.displayAmount)}</span>
                  ),
                },
                {
                  key: 'pu',
                  label: 'Paid / Unpaid',
                  render: (row) => (
                    <StatusPill tone={statusPillToneForResidentPayment(row.statusLabel)}>{row.statusLabel}</StatusPill>
                  ),
                },
                {
                  key: 'act',
                  label: '',
                  render: (row) => (
                    <button
                      type="button"
                      className="text-sm font-semibold text-[#2563eb] hover:underline"
                      onClick={() => setPayDetailId((id) => (id === row.id ? null : row.id))}
                    >
                      {payDetailId === row.id ? 'Hide details' : 'Details'}
                    </button>
                  ),
                },
              ]}
              rows={sortedUnifiedPaymentRows.map((row) => ({ key: row.id, data: row }))}
            />
            {payDetailId && detailRow ? (
              <ResidentPaymentDetailPanel
                row={detailRow}
                onClose={() => setPayDetailId(null)}
                onPayNow={() =>
                  launchCheckout({
                    amount: detailRow.balance,
                    description: detailRow.payDescription,
                    category: detailRow.payCategory,
                    paymentRecordId: detailRow.paymentRecordId,
                    syntheticRowId: String(detailRow.id || '').startsWith('synth-') ? detailRow.id : undefined,
                  })}
                payLoadingKey={actionLoading}
              />
            ) : null}
          </div>

          <EmbeddedStripeCheckout
            open={Boolean(embeddedCheckout)}
            title={embeddedCheckout?.title || 'Secure Payment'}
            checkoutRequest={embeddedCheckout?.request}
            onClose={handleEmbeddedCheckoutClose}
            onComplete={handleEmbeddedCheckoutComplete}
          />
        </>
      )}
    </div>
  )
}

// ─── Leasing ──────────────────────────────────────────────────────────────────

/** Never surface internal Airtable status "Changes Needed" to residents. */
function residentLeaseStatusDisplay(raw) {
  const s = String(raw || '').trim()
  if (!s) return 'Pending'
  if (s === 'Published' || s === 'Ready for Signature') return 'Ready to sign'
  if (s === 'Signed') return 'Signed'
  if (['Draft Generated', 'Under Review', 'Changes Needed', 'Approved', 'Submitted to Admin', 'Admin In Review', 'Changes Made', 'Sent Back to Manager', 'Manager Approved'].includes(s)) {
    return 'Preparing lease'
  }
  return s
}

/** Pick the best available lease draft: Signed > Published > Ready for Signature > any (newest first). */
function pickBestLeaseDraft(drafts) {
  if (!Array.isArray(drafts) || drafts.length === 0) return null
  const sorted = [...drafts].sort((a, b) => {
    const pb = new Date(b['Published At'] || b.created_at || 0).getTime()
    const pa = new Date(a['Published At'] || a.created_at || 0).getTime()
    return pb - pa
  })
  return (
    sorted.find((d) => String(d.Status || '').trim() === 'Signed') ||
    sorted.find((d) => String(d.Status || '').trim() === 'Published') ||
    sorted.find((d) => String(d.Status || '').trim() === 'Ready for Signature') ||
    sorted[0]
  )
}

/** Prefer signed lease for amounts; else best draft so Published rows still drive move-in amounts before signing. */
function pickLeaseDraftForPaymentsPricing(drafts) {
  return pickSignedLeaseDraft(drafts) || pickBestLeaseDraft(drafts) || null
}

function LeasingPanel({ resident, payments, onOpenPayments, onNavigateTab, onLeaseDataRefresh }) {
  const leaseTermLabel = getLeaseTermLabel(resident)
  const isMonthToMonth = leaseTermLabel.toLowerCase().includes('month-to-month')
  const moveInLabel = resident['Lease Start Date'] ? formatDate(resident['Lease Start Date']) : '—'
  const moveOutLabel = resident['Lease End Date'] ? formatDate(resident['Lease End Date']) : (isMonthToMonth ? 'No fixed end date' : '—')

  const [holdPathBusy, setHoldPathBusy] = useState(false)
  const [holdPathError, setHoldPathError] = useState('')

  const [leaseDrafts, setLeaseDrafts] = useState([])
  const [leaseLoading, setLeaseLoading] = useState(true)
  const [selectedLeaseDraftId, setSelectedLeaseDraftId] = useState(null)
  const [showLeaseText, setShowLeaseText] = useState(false)
  const [extendByMonths, setExtendByMonths] = useState('3')
  const [extendMode, setExtendMode] = useState('months')
  const [extendToDate, setExtendToDate] = useState('')
  const [extendNotice, setExtendNotice] = useState('')
  const [currentLeasePdf, setCurrentLeasePdf] = useState(null)
  const [propertyForLeaseAccess, setPropertyForLeaseAccess] = useState(null)
  const [leaseToolbarNotice, setLeaseToolbarNotice] = useState('')
  const [leaseIssueOpen, setLeaseIssueOpen] = useState(false)
  const [leaseIssueText, setLeaseIssueText] = useState('')
  const [leaseIssueBusy, setLeaseIssueBusy] = useState(false)
  const [leaseUploadBusy, setLeaseUploadBusy] = useState(false)
  const leasePdfFileInputRef = useRef(null)

  useEffect(() => {
    const house = String(resident.House || '').trim()
    if (!house) {
      setPropertyForLeaseAccess(null)
      return
    }
    let cancelled = false
    getPropertyByName(house)
      .then((rec) => {
        if (!cancelled) setPropertyForLeaseAccess(rec)
      })
      .catch(() => {
        if (!cancelled) setPropertyForLeaseAccess(null)
      })
    return () => {
      cancelled = true
    }
  }, [resident.House])

  const loadLeaseDrafts = useCallback(async () => {
    setLeaseLoading(true)
    try {
      const drafts = await getLeaseDraftsForResident(resident.id, resident.Email || '')
      setLeaseDrafts(drafts)
    } catch {
      setLeaseDrafts([])
    } finally {
      setLeaseLoading(false)
    }
  }, [resident.id, resident.Email])

  useEffect(() => {
    loadLeaseDrafts()
  }, [loadLeaseDrafts])

  useEffect(() => {
    if (!selectedLeaseDraftId) return
    if (!leaseDrafts.some((d) => d.id === selectedLeaseDraftId)) {
      setSelectedLeaseDraftId(null)
    }
  }, [leaseDrafts, selectedLeaseDraftId])

  const payPricingLeasePanel = useMemo(
    () => residentPaymentsPricing(resident, pickLeaseDraftForPaymentsPricing(leaseDrafts)),
    [resident, leaseDrafts],
  )

  const depositPreviewLabel = useMemo(() => {
    if (payPricingLeasePanel.securityDeposit > 0) return formatMoney(payPricingLeasePanel.securityDeposit)
    return '—'
  }, [payPricingLeasePanel.securityDeposit])

  const firstMonthRentPaid = useMemo(
    () => paymentsIndicateFirstMonthRentPaid(Array.isArray(payments) ? payments : []),
    [payments],
  )

  const securityDepositPaid = useMemo(() => {
    const list = Array.isArray(payments) ? payments : []
    if (paymentsIndicateSecurityDepositPaid(list)) return true
    return list.some(
      (p) => classifyResidentPaymentLine(p) === 'deposit' && residentPaymentLineStatus(p) === 'Paid',
    )
  }, [payments])

  const activeLeaseDraft = useMemo(() => {
    if (!Array.isArray(leaseDrafts) || leaseDrafts.length === 0) return null
    if (selectedLeaseDraftId) {
      const found = leaseDrafts.find((d) => d.id === selectedLeaseDraftId)
      if (found) return found
    }
    return pickBestLeaseDraft(leaseDrafts)
  }, [leaseDrafts, selectedLeaseDraftId])
  const signWithoutMoveInPayOverride = useMemo(
    () => anyLeaseDraftAllowsSignWithoutMoveInPay(leaseDrafts),
    [leaseDrafts],
  )
  const leaseAccessRequirement = normalizeLeaseAccessRequirement(
    propertyForLeaseAccess?.['Lease Access Requirement'],
  )
  const leaseAccessEval = useMemo(
    () =>
      evaluateLeaseAccessPrereqs({
        requirement: leaseAccessRequirement,
        securityDepositPaid,
        firstMonthRentPaid,
        managerSignWithoutPayOverride: signWithoutMoveInPayOverride,
      }),
    [
      leaseAccessRequirement,
      securityDepositPaid,
      firstMonthRentPaid,
      signWithoutMoveInPayOverride,
    ],
  )
  const moveInPrereqsMet = leaseAccessEval.met

  const leaseStatus = activeLeaseDraft?.Status ? String(activeLeaseDraft.Status).trim() : ''
  const managerSigOnActiveDraft = useMemo(
    () => pickManagerSignatureFromDraft(activeLeaseDraft, import.meta.env),
    [activeLeaseDraft],
  )
  const leaseIsSigned = leaseStatus === 'Signed'
  const holdPath = residentOptedRoomHoldWithoutSigningLease(resident) ? 'hold' : 'lease'

  const saveLeaseHoldPreference = useCallback(
    async (next) => {
      const wantHold = next === 'hold'
      if (wantHold === residentOptedRoomHoldWithoutSigningLease(resident)) return
      if (leaseIsSigned) return
      setHoldPathBusy(true)
      setHoldPathError('')
      try {
        await updateResidentRoomHoldPathFlag(resident.id, wantHold)
        const portalHolds = await listResidentPortalRoomHoldPaymentRecords(resident.id)
        const isDeletableHoldRow = (p) => {
          const st = String(p?.Status || '').trim().toLowerCase()
          if (st === 'paid') return false
          const bal = Number(p?.Balance)
          const paid = Number(p?.['Amount Paid'])
          if (Number.isFinite(bal) && bal <= 0) return false
          if (Number.isFinite(paid) && paid > 0) return false
          return true
        }
        if (wantHold) {
          const amt = residentRoomHoldFeeUsd(resident)
          const unpaid = portalHolds.filter(isDeletableHoldRow)
          if (amt > 0 && unpaid.length === 0) {
            const rawDue = resident['Lease Start Date']
            const dueStr =
              rawDue != null && String(rawDue).trim()
                ? String(rawDue).trim().slice(0, 10)
                : new Date().toISOString().slice(0, 10)
            await createPaymentRecord({
              Resident: [resident.id],
              Amount: amt,
              Balance: amt,
              Status: 'Unpaid',
              Type: 'Room Hold Fee',
              Month: 'Room hold fee',
              Notes: buildResidentPortalRoomHoldNotes(resident.id),
              'Due Date': dueStr,
              'Property Name': String(resident.House || '').trim() || undefined,
              'Room Number': String(resident['Unit Number'] || '').trim() || undefined,
              'Resident Name': String(resident.Name || '').trim() || undefined,
            })
          }
        } else {
          for (const p of portalHolds) {
            if (!isDeletableHoldRow(p)) continue
            try {
              await deletePaymentRecord(p.id)
            } catch (delErr) {
              console.warn('[Resident] could not delete room hold payment', p.id, delErr)
            }
          }
        }
        await onLeaseDataRefresh?.()
      } catch (e) {
        setHoldPathError(e?.message || 'Could not save your choice')
      } finally {
        setHoldPathBusy(false)
      }
    },
    [resident, leaseIsSigned, onLeaseDataRefresh],
  )

  /** Extension only after move-in charges are satisfied and the lease is signed. */
  const canRequestLeaseExtension = leaseIsSigned && securityDepositPaid && firstMonthRentPaid
  const leaseBodyAllowed = isResidentLeaseBodyViewable(leaseStatus, activeLeaseDraft)
  const leaseContent = leaseBodyAllowed
    ? (activeLeaseDraft?.['Manager Edited Content'] || activeLeaseDraft?.['AI Draft Content'] || '')
    : ''
  const leasePreview = useMemo(() => {
    if (!activeLeaseDraft) return ''
    if (!leaseBodyAllowed) {
      return leaseStatus === 'Draft Generated'
        ? 'Lease is being prepared — check back after your manager publishes it.'
        : 'Lease not ready yet — your manager will send it soon.'
    }
    return leaseContent || `Axis Resident Lease\n\nProperty: ${resident.House || '—'}\nUnit: ${resident['Unit Number'] || '—'}\nTerm: ${leaseTermLabel}\nMove-in: ${moveInLabel}\nMove-out: ${moveOutLabel}\nSecurity Deposit: ${depositPreviewLabel}\n\nPay move-in charges in Payments before signing.`
  }, [activeLeaseDraft, leaseBodyAllowed, leaseStatus, leaseContent, resident.House, resident['Unit Number'], leaseTermLabel, moveInLabel, moveOutLabel, depositPreviewLabel])

  const leaseHasGeneratedPdfSource = useMemo(() => {
    if (!activeLeaseDraft) return false
    try {
      const j = JSON.parse(activeLeaseDraft['Lease JSON'] || '{}')
      if (j && typeof j === 'object' && Object.keys(j).length > 0) return true
    } catch {
      /* ignore */
    }
    return Boolean(String(activeLeaseDraft['AI Draft Content'] || '').trim())
  }, [activeLeaseDraft])

  const handleResidentDownloadGeneratedPdf = useCallback(async () => {
    if (!activeLeaseDraft?.id) return
    setLeaseToolbarNotice('')
    try {
      const res = await fetch('/api/portal?action=lease-resident-download-generated-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leaseDraftId: activeLeaseDraft.id,
          residentRecordId: resident.id,
          residentEmail: resident.Email || '',
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error || `Download failed (${res.status})`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const prop = String(activeLeaseDraft.Property || 'lease').replace(/\s+/g, '-').slice(0, 48)
      a.download = `axis-generated-lease-${prop}.pdf`
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setLeaseToolbarNotice('Download started.')
    } catch (e) {
      setLeaseToolbarNotice(e?.message || 'Could not download PDF.')
    }
  }, [activeLeaseDraft, resident.id, resident.Email])

  const handleLeasePdfUpload = useCallback(
    async (event) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file || !activeLeaseDraft?.id) return
      setLeaseUploadBusy(true)
      setLeaseToolbarNotice('')
      try {
        await uploadLeaseVersionPdfFile({
          leaseDraftId: activeLeaseDraft.id,
          file,
          uploaderName: resident.Name || resident.Email || 'Resident',
          uploaderRole: 'Resident',
        })
        const pdf = await getCurrentLeaseVersion(activeLeaseDraft.id)
        setCurrentLeasePdf(pdf)
        setLeaseToolbarNotice('PDF uploaded.')
      } catch (e) {
        setLeaseToolbarNotice(e?.message || 'Upload failed.')
      } finally {
        setLeaseUploadBusy(false)
      }
    },
    [activeLeaseDraft, resident.Name, resident.Email],
  )

  const handleSubmitLeaseIssue = useCallback(async () => {
    const msg = leaseIssueText.trim()
    if (!msg || !activeLeaseDraft) return
    setLeaseIssueBusy(true)
    setLeaseToolbarNotice('')
    try {
      await submitResidentLeaseIssueReport({
        draft: activeLeaseDraft,
        resident,
        message: msg,
      })
      setLeaseIssueText('')
      setLeaseIssueOpen(false)
      setLeaseToolbarNotice('Your manager has been notified.')
      await loadLeaseDrafts()
    } catch (e) {
      setLeaseToolbarNotice(e?.message || 'Could not send request.')
    } finally {
      setLeaseIssueBusy(false)
    }
  }, [leaseIssueText, activeLeaseDraft, resident, loadLeaseDrafts])

  useEffect(() => {
    let cancelled = false
    if (!activeLeaseDraft?.id) {
      setCurrentLeasePdf(null)
      return () => {
        cancelled = true
      }
    }
    const st = String(activeLeaseDraft.Status || '').trim()
    if (!isResidentLeaseBodyViewable(st, activeLeaseDraft)) {
      setCurrentLeasePdf(null)
      return () => {
        cancelled = true
      }
    }
    getCurrentLeaseVersion(activeLeaseDraft.id)
      .then((pdf) => {
        if (!cancelled) setCurrentLeasePdf(pdf || null)
      })
      .catch(() => {
        if (!cancelled) setCurrentLeasePdf(null)
      })
    return () => {
      cancelled = true
    }
  }, [activeLeaseDraft?.id, activeLeaseDraft?.Status])

  function handleRequestExtension() {
    if (extendMode === 'date') {
      if (!extendToDate) return
      setExtendNotice(`Draft: extend to ${extendToDate}. Send in Inbox.`)
    } else {
      const n = parseInt(extendByMonths, 10)
      if (!n || n < 1) return
      setExtendNotice(`Draft: +${n} month${n === 1 ? '' : 's'}. Send in Inbox.`)
    }
  }

  const leaseDraftTableRows = useMemo(() => {
    const list = Array.isArray(leaseDrafts) ? leaseDrafts : []
    const sorted = [...list].sort((a, b) => {
      const pb = new Date(b['Published At'] || b.created_at || 0).getTime()
      const pa = new Date(a['Published At'] || a.created_at || 0).getTime()
      return pb - pa
    })
    return sorted.map((d) => ({
      key: d.id,
      data: d,
    }))
  }, [leaseDrafts])

  return (
    <div className="mb-10">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h2 className="mr-auto text-2xl font-black text-slate-900">Lease</h2>
        <button type="button" onClick={() => loadLeaseDrafts()} disabled={leaseLoading} className={RP_HEADER_BTN_SECONDARY}>
          {leaseLoading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="mb-5 rounded-2xl border border-slate-200 bg-white px-4 py-4 text-sm text-slate-800 shadow-sm">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Move-in path</p>
        <p className="mt-2 leading-relaxed text-slate-700">
          If you do not sign the lease, the room is not held and someone else can claim it.
        </p>
        <p className="mt-2 leading-relaxed text-slate-700">
          If you pay the room hold fee of{' '}
          <span className="font-semibold">{formatMoney(residentRoomHoldFeeUsd(resident))}</span>, we will hold the room for
          72 hours.
        </p>
        {leaseIsSigned ? (
          <p className="mt-3 text-sm text-slate-600">Lease signed — finish any balance in Payments.</p>
        ) : (
          <>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:gap-3">
              <button
                type="button"
                disabled={holdPathBusy}
                onClick={() => saveLeaseHoldPreference('lease')}
                className={classNames(
                  'flex-1 rounded-2xl border px-4 py-3 text-sm font-semibold transition',
                  holdPath === 'lease'
                    ? 'border-[#2563eb]/40 bg-white text-slate-900 shadow-sm ring-2 ring-[#2563eb]/25'
                    : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white',
                  holdPathBusy && 'cursor-wait opacity-60',
                )}
              >
                Sign lease (normal move-in)
              </button>
              <button
                type="button"
                disabled={holdPathBusy}
                onClick={() => saveLeaseHoldPreference('hold')}
                className={classNames(
                  'flex-1 rounded-2xl border px-4 py-3 text-sm font-semibold transition',
                  holdPath === 'hold'
                    ? 'border-[#2563eb]/40 bg-white text-slate-900 shadow-sm ring-2 ring-[#2563eb]/25'
                    : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white',
                  holdPathBusy && 'cursor-wait opacity-60',
                )}
              >
                Hold room only
              </button>
            </div>
            {holdPathBusy ? <p className="mt-2 text-xs text-slate-500">Saving…</p> : null}
            {holdPathError ? <p className="mt-2 text-xs font-medium text-red-600">{holdPathError}</p> : null}
          </>
        )}
        {residentOptedRoomHoldWithoutSigningLease(resident) ? (
          <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50/90 px-3 py-3 text-slate-800">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-sky-900">Room hold</p>
            <p className="mt-2 leading-relaxed">
              Pay the room hold fee in Payments — your room is held for 72 hours after we receive payment. May be{' '}
              <span className="font-semibold">non-refundable</span> if you miss deadlines.
            </p>
            <button
              type="button"
              onClick={() => onOpenPayments('hold')}
              className="mt-3 text-sm font-semibold text-[#2563eb] underline decoration-sky-400 underline-offset-2 hover:decoration-[#2563eb]"
            >
              Pay hold fee
            </button>
          </div>
        ) : null}
      </div>

      <div className="space-y-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        {leaseLoading ? (
          <div className="rounded-[24px] border border-slate-200 bg-white p-6 text-sm text-slate-400">Loading lease…</div>
        ) : null}

        {!leaseLoading && !moveInPrereqsMet ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 shadow-sm">
            <p className="font-semibold text-amber-950">Lease locked</p>
            <p className="mt-1 leading-relaxed text-amber-900/90">
              {leaseAccessEval.blockReason || 'Pay required move-in items to view and sign.'}
            </p>
            <button
              type="button"
              onClick={() => onOpenPayments('pending')}
              className="mt-3 text-sm font-semibold text-amber-950 underline decoration-amber-800/50 underline-offset-2 hover:decoration-amber-950"
            >
              Payments
            </button>
          </div>
        ) : null}

        {!leaseLoading && leaseDrafts.length > 0 ? (
          <div>
            <DataTable
              emptyIcon={false}
              empty="No leases to show yet."
              columns={[
                {
                  key: 'status',
                  label: 'Status',
                  render: (d) => (
                    <StatusPill tone="slate">{residentLeaseStatusDisplay(String(d.Status || '').trim())}</StatusPill>
                  ),
                },
                {
                  key: 'updated',
                  label: 'Updated',
                  render: (d) => {
                    const raw = d['Published At'] || d.created_at
                    if (!raw) return '—'
                    const dt = parseDisplayDate(String(raw))
                    return dt
                      ? dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
                      : String(raw).slice(0, 16)
                  },
                },
                {
                  key: 'actions',
                  label: '',
                  headerClassName: 'text-right',
                  cellClassName: 'text-right',
                  render: (d) => {
                    const isThisActive = activeLeaseDraft?.id === d.id
                    const showingFormatted = Boolean(showLeaseText && isThisActive && leaseBodyAllowed)
                    if (showingFormatted) {
                      return (
                        <button
                          type="button"
                          onClick={() => setShowLeaseText(false)}
                          className="rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                        >
                          Hide
                        </button>
                      )
                    }
                    return (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedLeaseDraftId(d.id)
                          setShowLeaseText(true)
                        }}
                        className="rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs font-semibold text-[#2563eb] transition hover:bg-slate-50"
                      >
                        Details
                      </button>
                    )
                  },
                },
              ]}
              rows={leaseDraftTableRows}
            />
            {leaseDrafts.length > 1 && selectedLeaseDraftId ? (
              <button
                type="button"
                onClick={() => {
                  setSelectedLeaseDraftId(null)
                  setShowLeaseText(false)
                }}
                className="mt-2 text-xs font-semibold text-slate-500 underline decoration-slate-300 underline-offset-2 hover:text-slate-800"
              >
                Use the latest lease automatically
              </button>
            ) : null}
          </div>
        ) : null}

        {!leaseLoading && leaseDrafts.length === 0 ? (
          <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-5 py-5 text-center text-sm text-slate-600">
            No lease yet — your manager will add one here.
          </div>
        ) : null}

        {!leaseLoading && moveInPrereqsMet && activeLeaseDraft ? (
          <>
          <div className="rounded-[24px] border border-[#2563eb]/20 bg-[linear-gradient(135deg,#eff6ff_0%,#ffffff_100%)] p-5">
            {signWithoutMoveInPayOverride && (!securityDepositPaid || !firstMonthRentPaid) ? (
              <div className="mb-3 rounded-lg border border-sky-200 bg-white/90 px-3 py-2 text-xs text-sky-950">
                Signing allowed before deposit + first month are paid. Other charges may still be due in{' '}
                <button
                  type="button"
                  onClick={() => onOpenPayments('pending')}
                  className="font-semibold text-[#2563eb] underline decoration-sky-400 underline-offset-2 hover:decoration-[#2563eb]"
                >
                  Payments
                </button>
                .
              </div>
            ) : null}
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Lease document</div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${
                        leaseStatus === 'Signed'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                          : leaseStatus === 'Published' || leaseStatus === 'Ready for Signature'
                            ? 'border-blue-200 bg-blue-50 text-blue-800'
                            : 'border-slate-200 bg-slate-100 text-slate-600'
                      }`}
                    >
                      {residentLeaseStatusDisplay(leaseStatus)}
                    </span>
                    {currentLeasePdf?.['File Name'] ? (
                      <span className="truncate text-xs font-medium text-slate-500" title={currentLeasePdf['File Name']}>
                        PDF · {currentLeasePdf['File Name']}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                  <input
                    ref={leasePdfFileInputRef}
                    type="file"
                    accept="application/pdf,.pdf"
                    className="hidden"
                    onChange={handleLeasePdfUpload}
                  />
                  {leaseBodyAllowed ? (
                    <button
                      type="button"
                      disabled={leaseUploadBusy}
                      onClick={() => leasePdfFileInputRef.current?.click()}
                      className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#2563eb] transition hover:bg-slate-50 disabled:opacity-50"
                    >
                      {leaseUploadBusy ? 'Uploading…' : 'Upload PDF'}
                    </button>
                  ) : null}
                  {leaseBodyAllowed && currentLeasePdf?.['PDF URL'] ? (
                    <a
                      href={currentLeasePdf['PDF URL']}
                      download={String(currentLeasePdf['File Name'] || 'lease-agreement.pdf')
                        .replace(/[^\w.\-]+/g, '_')
                        .replace(/^_+|_+$/g, '') || 'lease-agreement.pdf'}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#2563eb] transition hover:bg-slate-50"
                    >
                      Download PDF
                    </a>
                  ) : null}
                  {leaseBodyAllowed && leaseHasGeneratedPdfSource ? (
                    <button
                      type="button"
                      onClick={handleResidentDownloadGeneratedPdf}
                      className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#2563eb] transition hover:bg-slate-50"
                    >
                      Download generated PDF
                    </button>
                  ) : null}
                  {leaseBodyAllowed ? (
                    <button
                      type="button"
                      onClick={() => {
                        setLeaseIssueText('')
                        setLeaseIssueOpen(true)
                      }}
                      className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 transition hover:bg-amber-100"
                    >
                      Request change from manager
                    </button>
                  ) : null}
                  {leaseBodyAllowed ? (
                    <button
                      type="button"
                      onClick={() => window.print()}
                      className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                    >
                      Print
                    </button>
                  ) : null}
                </div>
              </div>
              {leaseToolbarNotice ? (
                <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-700 sm:px-5">{leaseToolbarNotice}</div>
              ) : null}
              {leaseBodyAllowed && !showLeaseText ? (
                <div className="border-b border-slate-100 px-4 py-2.5 text-xs text-slate-500 sm:px-5">
                  Tap <span className="font-semibold text-slate-700">Details</span> on a row above to read or sign. Questions →{' '}
                  <button
                    type="button"
                    onClick={() => onNavigateTab?.('inbox')}
                    className="font-semibold text-[#2563eb] underline decoration-sky-400 underline-offset-2 hover:decoration-[#2563eb]"
                  >
                    Inbox
                  </button>
                  .
                </div>
              ) : null}
              {showLeaseText && leaseBodyAllowed
                ? (() => {
                    let leaseData = null
                    try {
                      const raw = activeLeaseDraft?.['Lease JSON']
                      leaseData = raw ? JSON.parse(raw) : null
                    } catch {
                      /* use null */
                    }

                    const isSigned = leaseStatus === 'Signed'
                    const showSignPanel = isResidentLeaseSignable(leaseStatus)
                    const signedBy = isSigned ? (activeLeaseDraft?.['Signature Text'] || '') : undefined
                    const signedAt = isSigned ? (activeLeaseDraft?.['Signed At'] || '') : undefined

                    return (
                      <div className="border-t border-slate-100 px-3 pb-4 sm:px-4">
                        <div className="max-h-[min(80vh,880px)] overflow-y-auto overflow-x-hidden rounded-[20px] border border-slate-200 bg-white p-2 shadow-sm">
                          {leaseData ? (
                            <LeaseHTMLTemplate
                              leaseData={leaseData}
                              signedBy={signedBy}
                              signedAt={signedAt}
                              managerSignedBy={managerSigOnActiveDraft.text || undefined}
                              managerSignedAt={managerSigOnActiveDraft.at || undefined}
                              managerSignatureImageUrl={managerSigOnActiveDraft.image || undefined}
                            />
                          ) : (
                            <div className="max-h-[500px] overflow-y-auto p-6">
                              <pre className="whitespace-pre-wrap font-mono text-sm leading-7 text-slate-800">{leasePreview}</pre>
                            </div>
                          )}
                        </div>

                        {showSignPanel && leaseData ? (
                          <div className="mt-4">
                            <LeaseSignPanel
                              leaseDraftId={activeLeaseDraft.id}
                              tenantName={leaseData.tenantName || resident.Name}
                              residentRecordId={resident.id}
                              onSigned={(sig) => {
                                setLeaseDrafts((prev) =>
                                  prev.map((d) =>
                                    d.id === activeLeaseDraft.id
                                      ? {
                                          ...d,
                                          Status: 'Signed',
                                          'Signature Text': sig,
                                          'Signed At': new Date().toISOString(),
                                        }
                                      : d,
                                  ),
                                )
                              }}
                            />
                          </div>
                        ) : null}

                        {isSigned ? (
                          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/60 px-5 py-3 text-center">
                            <p className="text-sm font-semibold text-emerald-800">Lease signed — {signedBy}</p>
                            {signedAt ? (
                              <p className="mt-0.5 text-xs text-emerald-700">{new Date(signedAt).toLocaleString()}</p>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    )
                  })()
                : null}
              {currentLeasePdf?.['PDF URL'] ? (
                <div className="border-t border-slate-100 px-4 pb-4 sm:px-5">
                  <div className="overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-sm">
                    <iframe title="Resident lease PDF" src={currentLeasePdf['PDF URL']} className="h-[420px] w-full bg-white" />
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {leaseIssueOpen ? (
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4"
              role="dialog"
              aria-modal="true"
              aria-labelledby="resident-lease-issue-title"
              onClick={(e) => {
                if (e.target === e.currentTarget) {
                  setLeaseIssueOpen(false)
                  setLeaseIssueText('')
                }
              }}
            >
              <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
                <h3 id="resident-lease-issue-title" className="text-lg font-black text-slate-900">
                  Request change from manager
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  Describe typos, missing terms, or questions. Your house manager will see this in the lease thread.
                </p>
                <textarea
                  value={leaseIssueText}
                  onChange={(e) => setLeaseIssueText(e.target.value)}
                  rows={5}
                  placeholder="What needs to be fixed or clarified?"
                  className="mt-4 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/20"
                />
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    disabled={leaseIssueBusy}
                    onClick={() => {
                      setLeaseIssueOpen(false)
                      setLeaseIssueText('')
                    }}
                    className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={leaseIssueBusy || !leaseIssueText.trim()}
                    onClick={handleSubmitLeaseIssue}
                    className="rounded-full bg-[#2563eb] px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
                  >
                    {leaseIssueBusy ? 'Sending…' : 'Send to manager'}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          </>
        ) : null}

        {canRequestLeaseExtension ? (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Request lease extension</div>
            <div className="mb-3 flex w-fit gap-1 rounded-xl border border-slate-200 bg-white p-1">
              <button
                type="button"
                onClick={() => { setExtendMode('months'); setExtendNotice('') }}
                className={classNames('rounded-lg px-3 py-1 text-xs font-semibold transition', extendMode === 'months' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100')}
              >
                By months
              </button>
              <button
                type="button"
                onClick={() => { setExtendMode('date'); setExtendNotice('') }}
                className={classNames('rounded-lg px-3 py-1 text-xs font-semibold transition', extendMode === 'date' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100')}
              >
                By date
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {extendMode === 'months' ? (
                <>
                  <input
                    type="number"
                    min="1"
                    max="60"
                    value={extendByMonths}
                    onChange={(e) => { setExtendByMonths(e.target.value); setExtendNotice('') }}
                    className="w-24 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/20"
                    placeholder="Months"
                  />
                  <span className="text-sm text-slate-500">month{extendByMonths === '1' ? '' : 's'}</span>
                </>
              ) : (
                <input
                  type="date"
                  value={extendToDate}
                  onChange={(e) => { setExtendToDate(e.target.value); setExtendNotice('') }}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/20"
                />
              )}
              <button
                type="button"
                onClick={handleRequestExtension}
                className="rounded-full border border-[#2563eb]/40 bg-[#2563eb]/10 px-4 py-2 text-xs font-semibold text-[#2563eb] transition hover:bg-[#2563eb]/15"
              >
                Extend
              </button>
            </div>
            {extendNotice ? <p className="mt-2 text-xs text-slate-600">{extendNotice}</p> : null}
          </div>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-600">
            <p className="font-semibold text-slate-800">Lease extension</p>
            <p className="mt-1 leading-relaxed">After your lease is signed and deposit + first month are paid.</p>
          </div>
        )}

      </div>
    </div>
  )
}

// ─── Inbox (same Messages + thread model as manager / admin portals) ─────────

function ResidentInboxPanel({ resident }) {
  return (
    <ResidentPortalInbox resident={resident} />
  )
}

// ─── Resident dashboard (home) ───────────────────────────────────────────────

function ResidentDashboardHome({
  resident,
  visibleWorkOrders,
  payments,
  approvedLease,
  onNavigate,
  setPaymentFocus,
  pendingApplicationApproval,
  applicationRejected,
  portalFeaturesLocked,
  inboxUnopenedCount,
}) {
  const snapshot = useMemo(() => buildResidentRentSnapshot(payments, resident), [payments, resident])
  const duePaymentLines = useMemo(() => listDashboardDuePaymentLines(payments), [payments])
  const totalDueFromRows = useMemo(
    () => duePaymentLines.reduce((sum, row) => sum + row.balance, 0),
    [duePaymentLines],
  )
  const hasOverdueAny = useMemo(
    () => duePaymentLines.some((row) => row.status === 'Overdue'),
    [duePaymentLines],
  )
  const hasOverdueRent = snapshot.overdueTotal > 0
  const lock = Boolean(portalFeaturesLocked)
  const fallbackDueFromSnapshot =
    !lock && totalDueFromRows === 0 && snapshot.nextDue && snapshot.nextDue.balance > 0
  const paymentCardTotal = lock ? 0 : fallbackDueFromSnapshot ? snapshot.nextDue.balance : totalDueFromRows
  const paymentCardValue = lock ? '—' : paymentCardTotal > 0 ? formatMoney(paymentCardTotal) : '—'
  const paymentCardUrgent = hasOverdueAny || hasOverdueRent
  const openWoCount = useMemo(
    () => visibleWorkOrders.filter((r) => isWorkOrderOpen(r)).length,
    [visibleWorkOrders],
  )
  const workOrderCardValue = lock ? '—' : openWoCount === 0 ? 'none' : 'In Progress'
  const leaseStatus = approvedLease?.Status ? String(approvedLease.Status).trim() : null
  const leaseTermLabel = getLeaseTermLabel(resident)
  const leaseSigningUrl = resolveLeaseSigningUrl(resident)
  const leaseNeedsSigning = Boolean(leaseStatus && leaseStatus !== 'Signed')
  const firstName = String(resident?.Name || '').split(' ')[0] || 'Resident'
  const homeLabel = [resident.House, normalizeUnitLabel(resident['Unit Number'] || '')].filter(Boolean).join(' · ') || null
  const leaseDurationHeadline = lock ? '—' : leaseTermLabel.trim() || '—'
  const leaseCardSubline = lock
    ? applicationRejected
      ? 'Not available for this account'
      : 'Available after your application is approved'
    : leaseNeedsSigning
      ? 'Sign your lease to finish onboarding'
      : leaseStatus === 'Signed'
        ? 'Lease signed'
        : approvedLease
          ? residentLeaseStatusDisplay(leaseStatus || 'In progress')
          : ''

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black uppercase tracking-[0.08em] text-slate-900">
          {`WELCOME ${firstName}`}
        </h2>
      </div>

      {!lock && leaseNeedsSigning ? (
        <div
          role="status"
          className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 shadow-sm"
        >
          <p className="text-sm font-bold text-amber-950">Sign your lease</p>
          <p className="mt-1 text-sm text-amber-900/90">Lease is ready — open it to sign.</p>
          <button
            type="button"
            onClick={() => {
              if (leaseSigningUrl) {
                window.location.href = leaseSigningUrl
                return
              }
              onNavigate('leasing')
            }}
            className="mt-3 inline-flex rounded-full border border-amber-300 bg-amber-100 px-5 py-2.5 text-xs font-semibold text-amber-950 transition hover:bg-amber-200"
          >
            {leaseSigningUrl ? 'Open signing' : 'Go to lease'}
          </button>
        </div>
      ) : null}

      {!lock && paymentCardUrgent ? (
        <div role="status" className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 shadow-sm">
          <p className="text-sm font-bold text-red-950">Payment overdue</p>
          <p className="mt-1 text-sm text-red-900/90">
            One or more charges are past due. Open Payments to review each line item and pay now.
          </p>
          <button
            type="button"
            onClick={() => {
              setPaymentFocus('overdue')
              onNavigate('payments')
            }}
            className="mt-3 inline-flex rounded-full border border-red-300 bg-red-100 px-5 py-2.5 text-xs font-semibold text-red-950 transition hover:bg-red-200"
          >
            Go to payments
          </button>
        </div>
      ) : null}

      {/* Pending approval banner */}
      {pendingApplicationApproval ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-950">
          <p className="font-semibold">Application under review</p>
          <p className="mt-1 text-amber-900/90">
            A property manager still needs to approve your application before work orders, payments, leasing, and inbox are available.
          </p>
        </div>
      ) : null}

      {applicationRejected ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-950">
          <p className="font-semibold">Application not approved</p>
          <p className="mt-1 text-red-900/90">
            Payments, work orders, leasing, and inbox are disabled for this account.
          </p>
        </div>
      ) : null}

      {/* Metric cards — Lease → Payments → Work orders → Your home */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div
          className={classNames(
            'flex flex-col gap-2 rounded-3xl border p-5 text-left transition',
            lock ? 'cursor-default border-slate-200 bg-slate-50 opacity-80' : 'hover:shadow-sm',
            !lock &&
              (leaseNeedsSigning
                ? 'border-amber-200 bg-amber-50 hover:border-amber-300'
                : leaseStatus === 'Signed'
                  ? 'border-emerald-200 bg-emerald-50 hover:border-emerald-300'
                  : 'border-blue-100 bg-blue-50 hover:border-blue-200'),
          )}
        >
          <span
            className={classNames(
              'text-[10px] font-bold uppercase tracking-[0.14em]',
              lock
                ? 'text-slate-500'
                : leaseNeedsSigning
                  ? 'text-amber-700'
                  : leaseStatus === 'Signed'
                    ? 'text-emerald-600'
                    : 'text-blue-600',
            )}
          >
            Lease
          </span>
          <span
            className={classNames(
              'text-3xl font-black leading-tight',
              lock
                ? 'text-slate-600'
                : leaseNeedsSigning
                  ? 'text-amber-800'
                  : leaseStatus === 'Signed'
                    ? 'text-emerald-700'
                    : 'text-blue-700',
            )}
          >
            {leaseDurationHeadline}
          </span>
          {leaseCardSubline ? (
            <p
              className={classNames(
                'text-sm',
                lock ? 'text-slate-600' : leaseNeedsSigning ? 'text-amber-800/90' : 'text-slate-600',
              )}
            >
              {leaseCardSubline}
            </p>
          ) : null}
          {leaseStatus === 'Signed' ? (
            <button
              type="button"
              disabled={lock}
              onClick={() => {
                if (lock) return
                onNavigate('leasing')
              }}
              className="mt-1 inline-flex w-fit rounded-full border border-emerald-300 bg-emerald-100 px-4 py-2 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Extend
            </button>
          ) : leaseNeedsSigning ? (
            <button
              type="button"
              disabled={lock}
              onClick={() => {
                if (lock) return
                if (leaseSigningUrl) {
                  window.location.href = leaseSigningUrl
                  return
                }
                onNavigate('leasing')
              }}
              className="mt-1 inline-flex w-fit rounded-full border border-amber-300 bg-amber-100 px-4 py-2 text-xs font-semibold text-amber-900 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Sign lease
            </button>
          ) : (
            <button
              type="button"
              disabled={lock}
              onClick={() => {
                if (lock) return
                onNavigate('leasing')
              }}
              className="mt-1 inline-flex w-fit rounded-full border border-blue-200 bg-blue-100 px-4 py-2 text-xs font-semibold text-blue-800 transition hover:bg-blue-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              View lease
            </button>
          )}
        </div>

        <button
          type="button"
          disabled={lock}
          onClick={() => {
            if (lock) return
            setPaymentFocus(paymentCardUrgent ? 'overdue' : '')
            onNavigate('payments')
          }}
          className={classNames(
            'flex flex-col gap-1 rounded-3xl border p-5 text-left transition hover:shadow-sm',
            paymentCardUrgent
              ? 'border-red-100 bg-red-50 hover:border-red-200'
              : 'border-blue-100 bg-blue-50 hover:border-blue-200',
            lock && 'cursor-not-allowed opacity-60',
          )}
        >
          <span
            className={classNames(
              'text-[10px] font-bold uppercase tracking-[0.14em]',
              paymentCardUrgent ? 'text-red-600' : 'text-blue-600',
            )}
          >
            {paymentCardUrgent ? 'Total payment overdue' : 'Total payment due'}
          </span>
          <span
            className={classNames('text-3xl font-black tabular-nums', paymentCardUrgent ? 'text-red-700' : 'text-blue-700')}
          >
            {paymentCardValue}
          </span>
          {!lock && duePaymentLines.length > 1 ? (
            <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto border-t border-slate-200/90 pt-2 text-left text-[11px] leading-snug text-slate-700">
              {duePaymentLines.slice(0, 8).map((row, idx) => (
                <li key={row.id || `${row.label}-${idx}`} className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{row.label}</span>
                  <span className="shrink-0 font-black tabular-nums text-slate-900">{formatMoney(row.balance)}</span>
                </li>
              ))}
              {duePaymentLines.length > 8 ? (
                <li className="pt-0.5 text-[10px] font-semibold text-slate-500">
                  +{duePaymentLines.length - 8} more in Payments
                </li>
              ) : null}
            </ul>
          ) : null}
        </button>

        <button
          type="button"
          disabled={lock}
          onClick={() => {
            if (lock) return
            onNavigate('workorders')
          }}
          className={classNames(
            'flex flex-col gap-1 rounded-3xl border border-blue-100 bg-blue-50 p-5 text-left transition hover:border-blue-200 hover:shadow-sm',
            lock && 'cursor-not-allowed opacity-60',
          )}
        >
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-blue-600">Work Orders</span>
          <span className="text-3xl font-black tabular-nums text-blue-700">{workOrderCardValue}</span>
        </button>

        {homeLabel ? (
          <div className="rounded-3xl border border-blue-100 bg-blue-50 p-5">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-blue-600">Your home</p>
            <p className="mt-1 text-lg font-black leading-snug text-blue-700">{homeLabel}</p>
          </div>
        ) : (
          <div className="rounded-3xl border border-blue-100 bg-blue-50 p-5">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-blue-600">Your home</p>
            <p className="mt-1 text-lg font-black text-blue-700/80">—</p>
          </div>
        )}

        <button
          type="button"
          disabled={lock}
          onClick={() => {
            if (lock) return
            onNavigate('inbox')
          }}
          className={classNames(
            'col-span-full flex items-center justify-between rounded-3xl border border-blue-100 bg-blue-50 px-6 py-5 text-left transition hover:border-blue-200 hover:shadow-sm',
            lock && 'cursor-not-allowed opacity-60',
          )}
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

// ─── Dashboard ────────────────────────────────────────────────────────────────

const RESIDENT_TAB_IDS = new Set(['dashboard', 'leasing', 'payments', 'workorders', 'inbox', 'profile'])

function Dashboard({ resident, onResidentUpdated, onSignOut }) {
  const [tab, setTab] = useState(() => {
    const h = window.location.hash.slice(1)
    return RESIDENT_TAB_IDS.has(h) ? h : 'dashboard'
  })
  useEffect(() => { window.location.hash = tab }, [tab])
  const [paymentFocus, setPaymentFocus] = useState('')
  const [requests, setRequests] = useState([])
  const [payments, setPayments] = useState([])
  const [approvedLease, setApprovedLease] = useState(null)
  const [loading, setLoading] = useState(true)
  const [inboxUnopenedCount, setInboxUnopenedCount] = useState(0)

  const visibleWorkOrders = useMemo(
    () => requests.filter((r) => !isWorkOrderHiddenFromResidentList(r)),
    [requests],
  )
  const openRequestCount = useMemo(
    () => requests.filter((r) => isWorkOrderOpen(r)).length,
    [requests],
  )
  const homeLabel = [resident.House, normalizeUnitLabel(resident['Unit Number'] || '')].filter(Boolean).join(' · ') || 'Not assigned'

  const refreshResidentAndPayments = useCallback(async () => {
    const id = String(resident?.id || '').trim()
    if (!id) return
    try {
      const [nextResident, pays] = await Promise.all([
        getResidentById(id),
        getPaymentsForResident({ id }).catch(() => []),
      ])
      if (nextResident) onResidentUpdated(nextResident)
      setPayments(Array.isArray(pays) ? pays : [])
    } catch {
      /* non-fatal */
    }
  }, [resident, onResidentUpdated])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [nextRequests, nextPayments, lease] = await Promise.all([
        getWorkOrdersForResident(resident).catch(() => []),
        getPaymentsForResident(resident).catch(() => []),
        getApprovedLeaseForResident(resident.id, resident.Email || '').catch(() => null),
      ])
      setRequests(nextRequests)
      setPayments(nextPayments)
      setApprovedLease(lease)

      try {
        let payRows = Array.isArray(nextPayments) ? nextPayments : []
        let createdAny = false
        for (const wo of nextRequests || []) {
          if (!workOrderShouldCreatePaymentWhenScheduled(wo)) continue
          const { created } = await ensurePostpayRoomCleaningFeePayment({
            workOrder: wo,
            billingResidentId: resident.id,
            residentProfile: resident,
            paymentsPrefetch: payRows,
          })
          if (created) {
            createdAny = true
            payRows = await getPaymentsForResident(resident).catch(() => payRows)
          }
        }
        if (createdAny) setPayments(payRows)
      } catch {
        /* non-fatal: billing backfill should not block portal load */
      }
    } finally {
      setLoading(false)
    }
  }, [resident])

  const refreshWorkOrdersOnly = useCallback(async () => {
    const nextRequests = await getWorkOrdersForResident(resident).catch(() => [])
    setRequests(nextRequests)
  }, [resident])

  useEffect(() => {
    loadData()
  }, [loadData])

  const applicationRecordIds = useMemo(() => residentApplicationsRecordIds(resident), [resident])
  const [linkedApplicationApprovalState, setLinkedApplicationApprovalState] = useState(null)

  useEffect(() => {
    if (!applicationRecordIds.length) {
      setLinkedApplicationApprovalState(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const app = await getApplicationById(applicationRecordIds[0])
        if (cancelled) return
        setLinkedApplicationApprovalState(app ? deriveApplicationApprovalState(app) : 'pending')
      } catch {
        if (!cancelled) setLinkedApplicationApprovalState(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [applicationRecordIds])

  const accessState = useMemo(
    () => residentPortalAccessState(resident, linkedApplicationApprovalState),
    [resident, linkedApplicationApprovalState],
  )
  const applicationUnlocked = accessState === 'approved'
  const isRejected = accessState === 'rejected'

  useEffect(() => {
    const email = String(resident?.Email || '').trim()
    if (!email || !portalInboxAirtableConfigured()) return
    if (accessState !== 'approved') {
      setInboxUnopenedCount(0)
      return
    }
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
  }, [resident, accessState])

  const RESTRICTED_TAB_IDS = new Set(['leasing', 'payments', 'workorders', 'inbox'])
  const restrictNavTabs = accessState !== 'approved'

  const handleNavigate = useCallback((nextTab) => {
    if (restrictNavTabs && RESTRICTED_TAB_IDS.has(nextTab)) {
      setTab('dashboard')
      return
    }
    setTab(nextTab)
  }, [restrictNavTabs])

  useEffect(() => {
    if (restrictNavTabs && RESTRICTED_TAB_IDS.has(tab)) {
      setTab('dashboard')
    }
  }, [restrictNavTabs, tab])

  const TABS = [
    ['dashboard', 'Dashboard'],
    ['leasing', 'Lease'],
    ['payments', 'Payments'],
    ['workorders', 'Work Orders'],
    ['inbox', 'Inbox'],
    ['profile', 'Profile'],
  ].filter(([id]) => !(restrictNavTabs && RESTRICTED_TAB_IDS.has(id)))

  return (
    <PortalShell
      brandTitle="Axis"
      desktopNav="sidebar"
      navItems={TABS.map(([id, label]) => ({ id, label }))}
      activeId={tab}
      onNavigate={handleNavigate}
      onSignOut={onSignOut}
    >
        {loading ? (
          <div className="rounded-3xl border border-slate-200 bg-white px-6 py-16 text-center text-sm text-slate-400 shadow-soft">
            Loading...
          </div>
        ) : null}

        {!loading && tab === 'dashboard' ? (
          <ResidentDashboardHome
            resident={resident}
            visibleWorkOrders={visibleWorkOrders}
            payments={payments}
            approvedLease={approvedLease}
            onNavigate={handleNavigate}
            setPaymentFocus={setPaymentFocus}
            pendingApplicationApproval={accessState === 'pending'}
            applicationRejected={isRejected}
            portalFeaturesLocked={!applicationUnlocked}
            inboxUnopenedCount={inboxUnopenedCount}
          />
        ) : null}
        {!loading && tab === 'workorders' ? (
          applicationUnlocked ? (
            <PanelErrorBoundary>
              <WorkOrdersPanel
                resident={resident}
                requests={visibleWorkOrders}
                onRequestCreated={loadData}
                onWorkOrderUpdated={loadData}
                onRefresh={refreshWorkOrdersOnly}
                onDataRefresh={loadData}
                onOpenPayments={() => {
                  setPaymentFocus('fees')
                  handleNavigate('payments')
                }}
              />
            </PanelErrorBoundary>
          ) : (
            isRejected ? <ResidentRejectedGate /> : <ResidentPendingApprovalGate />
          )
        ) : null}
        {!loading && tab === 'leasing' ? (
          applicationUnlocked ? (
            <LeasingPanel
              resident={resident}
              payments={payments}
              onOpenPayments={(focus = '') => {
                setPaymentFocus(focus)
                handleNavigate('payments')
              }}
              onNavigateTab={handleNavigate}
              onLeaseDataRefresh={refreshResidentAndPayments}
            />
          ) : (
            isRejected ? <ResidentRejectedGate /> : <ResidentPendingApprovalGate />
          )
        ) : null}
        {!loading && tab === 'payments' ? (
          applicationUnlocked ? (
            <PanelErrorBoundary>
              <PaymentsPanel
                resident={resident}
                onResidentUpdated={onResidentUpdated}
                highlightCategory={paymentFocus}
                onPaymentsDataUpdated={setPayments}
              />
            </PanelErrorBoundary>
          ) : (
            isRejected ? <ResidentRejectedGate /> : <ResidentPendingApprovalGate />
          )
        ) : null}
        {!loading && tab === 'inbox' ? (
          applicationUnlocked ? <ResidentInboxPanel resident={resident} /> : (isRejected ? <ResidentRejectedGate /> : <ResidentPendingApprovalGate />)
        ) : null}
        {!loading && tab === 'profile' ? (
          <ProfilePanel resident={resident} onUpdated={onResidentUpdated} />
        ) : null}
    </PortalShell>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function Resident() {
  const [resident, setResident] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!airtableReady) { setLoading(false); return }
    const storedId = sessionStorage.getItem(SESSION_KEY)
    if (!storedId) { setLoading(false); return }
    let mounted = true
    getResidentById(storedId)
      .then((r) => {
        if (!mounted || !r) return
        const leaseEnd = r['Lease End Date']
        if (leaseEnd && new Date(leaseEnd) < new Date(new Date().toDateString())) {
          sessionStorage.removeItem(SESSION_KEY)
          return
        }
        setResident(r)
      })
      .catch(() => { sessionStorage.removeItem(SESSION_KEY) })
      .finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [])

  function handleSignOut() {
    sessionStorage.removeItem(SESSION_KEY)
    setResident(null)
  }

  if (!airtableReady) return <SetupRequired />
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_100%)] text-sm text-slate-400">
        Loading...
      </div>
    )
  }
  if (!resident) {
    return <Navigate to="/portal?portal=resident" replace />
  }

  return (
    <Dashboard
      resident={resident}
      onResidentUpdated={setResident}
      onSignOut={handleSignOut}
    />
  )
}

import { Component, useCallback, useEffect, useMemo, useState } from 'react'
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
import { HOUSING_CONTACT_MESSAGE, HOUSING_CONTACT_SCHEDULE } from '../lib/housingSite'
import {
  airtableReady,
  createResident,
  createWorkOrder,
  getApplicationById,
  getApprovedLeaseForResident,
  getLeaseDraftsForResident,
  getPaymentsForResident,
  getResidentByEmail,
  getResidentById,
  appendWorkOrderUpdateFromResident,
  getWorkOrdersForResident,
  loginResident,
  stripWorkOrderPortalSubmitterLine,
  updateResident,
  getAllPortalInternalThreadMessages,
  fetchInboxThreadStateMap,
  portalInboxAirtableConfigured,
  portalInboxThreadKeyFromRecord,
} from '../lib/airtable'
import { applicationRejectedFieldName } from '../lib/applicationApprovalState.js'

const SESSION_KEY = 'axis_resident'

const requestCategories = ['Plumbing', 'Electrical', 'Heating / Cooling', 'Appliance', 'General Maintenance', 'Cleaning', 'Other']
const urgencyOptions = ['Low', 'Medium', 'Urgent']

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
  return resolvedCheckbox || status === 'resolved'
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

function workOrderHasManagerActivity(record) {
  if (!record || typeof record !== 'object') return false
  const activityFields = [
    record['Management Notes'],
    record.Update,
    record['Scheduled Date'],
    record['Scheduled At'],
    record['Schedule Date'],
    record['Scheduled Time'],
    record['Last Update'],
    record['Last Updated'],
  ]
  return activityFields.some((value) => String(value || '').trim().length > 0)
}

function residentWorkOrderStatusLabel(record) {
  if (!record) return 'Processed'
  if (isWorkOrderResolved(record)) {
    return 'Done'
  }
  const raw = String(record.Status || '').trim().toLowerCase()
  if (raw.includes('review')) return 'In Progress'
  if (raw.includes('schedule')) return 'In Progress'
  if (raw.includes('progress')) return 'In Progress'
  if (workOrderHasManagerActivity(record)) return 'In Progress'
  return 'Processed'
}

function residentWorkOrderStatusTone(record) {
  const label = residentWorkOrderStatusLabel(record)
  if (label === 'Done') return 'emerald'
  if (label === 'In Progress') return 'amber'
  return 'slate'
}

function residentWorkOrderFilterBucket(record) {
  if (!record) return 'open'
  if (isWorkOrderResolved(record)) return 'completed'
  const L = residentWorkOrderStatusLabel(record)
  if (L === 'Scheduled') return 'scheduled'
  if (L === 'In Progress') return 'in_progress'
  return 'open'
}

function parseWorkOrderSchedule(record) {
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

function residentApplicationUnlocked(resident) {
  if (isResidentApplicationRejected(resident)) return false
  return (
    isApprovalGranted(resident?.['Application Approval']) || isApprovalGranted(resident?.Approved)
  )
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

function residentPortalAccessState(resident) {
  if (isResidentApplicationRejected(resident)) return 'rejected'
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
  if (!property) return 0
  for (const plan of property.roomPlans || []) {
    const room = (plan.rooms || []).find((r) => normalizeUnitLabel(r.name) === normalizeUnitLabel(unitNumber))
    if (room?.price) {
      const amount = parseInt(String(room.price).replace(/[^0-9]/g, ''), 10)
      if (Number.isFinite(amount) && amount > 0) return amount
    }
  }
  return 0
}

function getStaticSecurityDeposit(propertyName) {
  const property = properties.find((p) => p.name === propertyName)
  if (!property?.securityDeposit) return 0
  const amount = parseInt(String(property.securityDeposit).replace(/[^0-9]/g, ''), 10)
  return Number.isFinite(amount) && amount > 0 ? amount : 0
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

function getPaymentKind(payment) {
  if (!payment || typeof payment !== 'object') return 'rent'
  const raw = [payment.Type, payment.Category, payment.Kind, payment['Line Item Type'], payment.Month, payment.Notes]
    .filter(Boolean).join(' ').toLowerCase()
  if (/(fee|fine|damage|late fee|late charge|cleaning|lockout)/.test(raw)) return 'fee'
  return 'rent'
}

/** Finer bucket for resident UI (deposit / move-in rent vs recurring rent vs fees). */
function classifyResidentPaymentLine(payment) {
  if (!payment || typeof payment !== 'object') return 'rent'
  const raw = [payment.Type, payment.Category, payment.Kind, payment['Line Item Type'], payment.Month, payment.Notes]
    .filter(Boolean).join(' ').toLowerCase()
  if (/(security deposit|sec\.?\s*deposit|tenant deposit|initial deposit)/i.test(raw) && !/return/i.test(raw)) return 'deposit'
  if (/(^|\s)(first month|1st month|first months|move-?in rent)/i.test(raw)) return 'first_rent'
  if (/(first month.{0,20}util|1st month.{0,20}util|move-?in.{0,20}util|move-?in.{0,12}utilities)/i.test(raw))
    return 'first_utilities'
  if (/(^|\s)(first|1st)\s+month\s+utilities/i.test(raw)) return 'first_utilities'
  return getPaymentKind(payment) === 'fee' ? 'fee' : 'rent'
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

/** Append-only notes on the Work Orders record (no Messages table). */
function WorkOrderNotesComposer({ workOrder, residentEmail, onUpdated, embedded = false }) {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)

  const wrap = embedded
    ? 'flex min-h-0 flex-1 flex-col overflow-hidden border-t border-slate-200 bg-slate-50/80'
    : 'mt-4 rounded-3xl border border-slate-200 bg-slate-50 p-4'
  const scroll = embedded ? 'min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4' : 'space-y-3'
  const formWrap = classNames('flex gap-2', embedded ? 'shrink-0 border-t border-slate-200 bg-white px-4 py-3' : 'mt-4')
  const updateText = String(workOrder.Update || workOrder['Latest Update'] || '').trim()

  async function handleSend(event) {
    event.preventDefault()
    if (!draft.trim()) return
    const text = draft.trim()
    setSending(true)
    try {
      await appendWorkOrderUpdateFromResident(workOrder.id, residentEmail, text)
      setDraft('')
      onUpdated?.()
    } finally {
      setSending(false)
    }
  }

  return (
    <div className={wrap}>
      <div className={scroll}>
        {!updateText ? (
          <p className="text-sm text-slate-400">No updates yet. Add a note below — your property team sees it on the work order</p>
        ) : (
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Update log</div>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{updateText}</p>
          </div>
        )}
      </div>
      <form onSubmit={handleSend} className={formWrap}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a note for the team…"
          className="flex-1 rounded-full border border-slate-200 px-4 py-2.5 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
        />
        <button
          type="submit"
          disabled={sending || !draft.trim()}
          className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  )
}

function WorkOrdersPanel({ resident, requests: requestsProp, onRequestCreated, onWorkOrderUpdated, onRefresh }) {
  const requests = Array.isArray(requestsProp) ? requestsProp : []
  const [woFilter, setWoFilter] = useState('all')
  const [refreshing, setRefreshing] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [form, setForm] = useState({
    title: '',
    category: requestCategories[0],
    urgency: urgencyOptions[1],
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

  const filteredRequests = useMemo(() => {
    return woFilter === 'all' ? requests : requests.filter((r) => residentWorkOrderFilterBucket(r) === woFilter)
  }, [requests, woFilter])

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
      const created = await createWorkOrder({
        resident,
        title: form.title,
        category: form.category,
        urgency: form.urgency === 'Medium' ? 'Routine' : form.urgency,
        preferredEntry: 'Anytime',
        description: form.description,
        photoFile: photo || null,
      })
      setForm({ title: '', category: requestCategories[0], urgency: urgencyOptions[1], description: '' })
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

      <div className="mb-5 grid gap-2 rounded-[28px] border border-slate-200 bg-slate-50 p-2 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['all', 'All', requests.length],
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
              icon="🛠"
              title="No work orders yet"
            />
          </div>
        ) : filteredRequests.length === 0 ? (
          <div className="mt-6">
            <PortalOpsEmptyState
              icon="🔍"
              title="Nothing in this view"
              description="Try another filter above — your requests may be in a different stage"
            />
          </div>
        ) : (
          <div className="mt-6 grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-5 py-4">
                <h3 className="text-sm font-black text-slate-900">My Work Orders</h3>
              </div>
              <div className="divide-y divide-slate-100">
                {filteredRequests.map((request) => (
                  <button
                    key={request.id}
                    type="button"
                    onClick={() => setSelectedId(request.id)}
                    className={classNames(
                      'flex w-full flex-col gap-2 px-5 py-4 text-left transition',
                      selectedId === request.id ? 'bg-axis/5' : 'hover:bg-slate-50',
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold text-slate-900">{request.Title || 'Work order'}</div>
                        <div className="mt-1 text-xs text-slate-400">
                          {request.Category || 'General'} · {formatDate(request['Date Submitted'] || request.created_at)}
                        </div>
                      </div>
                      <PortalOpsStatusBadge tone={residentWorkOrderStatusTone(request)}>
                        {residentWorkOrderStatusLabel(request)}
                      </PortalOpsStatusBadge>
                    </div>
                    <p className="line-clamp-2 text-sm text-slate-500">
                      {stripWorkOrderPortalSubmitterLine(request.Description) || 'No description added'}
                    </p>
                  </button>
                ))}
              </div>
            </div>

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

                <div className="mt-5 overflow-hidden rounded-3xl border border-slate-200">
                  <div className="border-b border-slate-200 bg-white px-5 py-4">
                    <div className="text-sm font-black text-slate-900">Notes to the team</div>
                    <div className="mt-1 text-xs text-slate-400">Appends to the work order update log (no separate message thread)</div>
                  </div>
                  <WorkOrderNotesComposer
                    workOrder={selectedRequest}
                    residentEmail={resident.Email}
                    onUpdated={onWorkOrderUpdated}
                    embedded
                  />
                </div>
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
  const [payFilter, setPayFilter] = useState('all')
  const [payDetailId, setPayDetailId] = useState(null)
  const [payTableSort, setPayTableSort] = useState('due_asc')

  useEffect(() => {
    setPayDetailId(null)
  }, [payFilter])

  const loadPayments = useCallback(() => {
    setLoading(true)
    setError('')
    return getPaymentsForResident(resident)
      .then(setPayments)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [resident])

  useEffect(() => {
    loadPayments()
  }, [loadPayments])

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
  const fallbackRentAmount = useMemo(() => getRoomMonthlyRent(resident.House, resident['Unit Number']), [resident])
  const fallbackUtilitiesAmount = useMemo(
    () => getMonthlyUtilitiesAmount(resident.House, resident),
    [resident.House, resident],
  )
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

  const expectedDepositAmount = useMemo(() => {
    const raw =
      resident['Security Deposit Amount'] ??
      resident['Security Deposit'] ??
      getStaticSecurityDeposit(resident.House)
    if (raw == null || raw === '') return 0
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw
    const n = parseInt(String(raw).replace(/[^0-9]/g, ''), 10)
    return Number.isFinite(n) && n > 0 ? n : 0
  }, [resident.House, resident['Security Deposit'], resident['Security Deposit Amount']])

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
    return sortedPayments.filter((p) => {
      if (depositPaymentRecord && p.id === depositPaymentRecord.id) return false
      if (firstRentPaymentRecord && p.id === firstRentPaymentRecord.id) return false
      if (firstUtilitiesPaymentRecord && p.id === firstUtilitiesPaymentRecord.id) return false
      return true
    })
  }, [sortedPayments, depositPaymentRecord, firstRentPaymentRecord, firstUtilitiesPaymentRecord])

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
      const subtitle = [resident.House, normalizeUnitLabel(resident['Unit Number'] || '')].filter(Boolean).join(' · ') || 'Your home'
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
          : lineKind === 'first_utilities'
            ? 'first_utilities'
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
        paymentRecordId: payment.id,
        sortDue: parseDisplayDate(dueRaw)?.getTime() ?? 0,
        sortAmount: due,
        payDescription,
        ...overrides,
      }
    },
    [resident, amountDueForRecord, amountPaidForRecord, balanceForRecord, paymentStatusForRecord],
  )

  const depositRow = useMemo(() => {
    if (depositPaymentRecord) {
      return buildRowFromPayment(depositPaymentRecord, {
        title: 'Initial security deposit',
        payDescription: `Security deposit — ${resident.House || 'your home'}`,
      })
    }
    if (expectedDepositAmount <= 0) return null
    const moveIn = resident['Lease Start Date'] ? formatDate(resident['Lease Start Date']) : ''
    return {
      id: 'synth-security-deposit',
      title: 'Initial security deposit',
      subtitle: [resident.House, normalizeUnitLabel(resident['Unit Number'] || '')].filter(Boolean).join(' · ') || 'Your home',
      dueDateLabel: moveIn,
      displayAmount: expectedDepositAmount,
      balance: expectedDepositAmount,
      statusLabel: 'Unpaid',
      statusHint: 'Typically due at or before move-in unless your lease says otherwise',
      metaRows: [
        { label: 'Due date', value: moveIn || '—' },
        { label: 'Amount to pay', value: formatMoney(expectedDepositAmount) },
      ],
      recordedAt: null,
      payCategory: 'deposit',
      paymentRecordId: undefined,
      sortDue: parseDisplayDate(resident['Lease Start Date'])?.getTime() ?? 0,
      sortAmount: expectedDepositAmount,
      payDescription: `Security deposit — ${resident.House || 'your home'}`,
    }
  }, [
    buildRowFromPayment,
    depositPaymentRecord,
    expectedDepositAmount,
    resident.House,
    resident['Lease Start Date'],
    resident['Unit Number'],
  ])

  const firstMonthRow = useMemo(() => {
    if (firstRentPaymentRecord) {
      return buildRowFromPayment(firstRentPaymentRecord, {
        title: 'First month rent',
        payDescription: `First month rent — ${resident.House || 'your home'}`,
      })
    }
    if (fallbackRentAmount <= 0) return null
    const subtitle = [resident.House, normalizeUnitLabel(resident['Unit Number'] || '')].filter(Boolean).join(' · ') || 'Your home'
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
        payDescription: `First month rent — ${resident.House || 'your home'}`,
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
      payDescription: `First month rent — ${resident.House || 'your home'}`,
    }
  }, [
    buildRowFromPayment,
    firstMonthRentPaid,
    firstRentPaymentRecord,
    fallbackRentAmount,
    paymentStatusForRecord,
    rentPayments,
    amountDueForRecord,
    resident.House,
    resident['Lease Start Date'],
    resident['Unit Number'],
  ])

  const firstUtilitiesRow = useMemo(() => {
    if (firstUtilitiesPaymentRecord) {
      return buildRowFromPayment(firstUtilitiesPaymentRecord, {
        title: 'First month utilities',
        payDescription: `First month utilities — ${resident.House || 'your home'}`,
      })
    }
    if (fallbackUtilitiesAmount <= 0) return null
    if (firstMonthUtilitiesPaid) return null
    const subtitle = [resident.House, normalizeUnitLabel(resident['Unit Number'] || '')].filter(Boolean).join(' · ') || 'Your home'
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
      payDescription: `First month utilities — ${resident.House || 'your home'}`,
    }
  }, [
    buildRowFromPayment,
    firstUtilitiesPaymentRecord,
    firstMonthUtilitiesPaid,
    fallbackUtilitiesAmount,
    resident.House,
    resident['Lease Start Date'],
    resident['Unit Number'],
  ])

  useEffect(() => {
    if (highlightCategory === 'extension') {
      setPayFilter('fees')
      setPayDetailId(null)
      return
    }
    if (!highlightCategory) return
    if (highlightCategory === 'deposit' || highlightCategory === 'rent' || highlightCategory === 'utilities') {
      setPayFilter('pending')
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
  ])

  const recordRowsForCurrentFilter = useMemo(() => {
    return tableSourcePayments.filter((p) => {
      if (payFilter === 'fees') return getPaymentKind(p) === 'fee'
      if (payFilter === 'paid') return paymentStatusForRecord(p) === 'Paid'
      if (payFilter === 'pending') return balanceForRecord(p) > 0
      return true
    })
  }, [tableSourcePayments, payFilter, paymentStatusForRecord, balanceForRecord])

  const recordVMsForFilter = useMemo(
    () => recordRowsForCurrentFilter.map((p) => buildRowFromPayment(p)),
    [recordRowsForCurrentFilter, buildRowFromPayment],
  )

  const moveInRowsCombined = useMemo(
    () => [depositRow, firstMonthRow, firstUtilitiesRow].filter(Boolean),
    [depositRow, firstMonthRow, firstUtilitiesRow],
  )

  const unifiedPaymentRows = useMemo(() => {
    if (payFilter === 'fees') return recordVMsForFilter
    if (payFilter === 'paid') {
      const mi = moveInRowsCombined.filter((r) => r.statusLabel === 'Paid')
      return [...mi, ...recordVMsForFilter]
    }
    if (payFilter === 'pending') {
      const mi = moveInRowsCombined.filter((r) => r.balance > 0)
      return [...mi, ...recordVMsForFilter]
    }
    return [...moveInRowsCombined, ...recordVMsForFilter]
  }, [payFilter, moveInRowsCombined, recordVMsForFilter])

  const sortedUnifiedPaymentRows = useMemo(() => {
    const arr = [...unifiedPaymentRows]
    const moveInRank = (id) => {
      const s = String(id)
      if (s === 'synth-security-deposit') return 0
      if (s.startsWith('synth-first-month')) return 1
      if (s.startsWith('synth-first-utilities')) return 2
      const utilRec = firstUtilitiesPaymentRecord
      if (utilRec && s === utilRec.id) return 2
      return 3
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
  }, [unifiedPaymentRows, payTableSort, firstUtilitiesPaymentRecord])

  const detailRow = useMemo(() => {
    if (!payDetailId) return null
    return (
      sortedUnifiedPaymentRows.find((r) => r.id === payDetailId) ||
      unifiedPaymentRows.find((r) => r.id === payDetailId) ||
      null
    )
  }, [payDetailId, sortedUnifiedPaymentRows, unifiedPaymentRows])

  const effectiveCurrentDueDate = effectiveCurrentDue?.['Due Date']

  async function launchCheckout({ amount, items, description, category, paymentRecordId }) {
    setActionError('')
    setActionLoading(category)
    setEmbeddedCheckout({
      title: description,
      request: {
        residentId: resident.id, residentName: resident.Name, residentEmail: resident.Email,
        propertyName: resident.House, unitNumber: resident['Unit Number'],
        amount, items, description, category, paymentRecordId,
      },
      category,
    })
  }

  function handleEmbeddedCheckoutClose() {
    setActionLoading('')
    setEmbeddedCheckout(null)
  }

  async function handleEmbeddedCheckoutComplete() {
    setActionLoading('')
    setEmbeddedCheckout(null)
    setLoading(true)
    try {
      const refreshed = await getPaymentsForResident(resident)
      const rows = Array.isArray(refreshed) ? refreshed : []
      setPayments(rows)
      onPaymentsDataUpdated?.(rows)
      // Parent passes `setResident` — must receive a record, not `undefined`, or the whole portal crashes.
      const nextResident = await getResidentById(resident.id)
      if (nextResident) onResidentUpdated?.(nextResident)
    } catch (err) {
      setActionError(err.message || 'Payment completed, but refreshing the balance failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mb-10">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="mr-auto min-w-0">
          <h2 className="text-2xl font-black text-slate-900">Payments</h2>
          {fallbackUtilitiesAmount > 0 ? (
            <p className="mt-1 text-sm text-slate-600">
              Monthly utilities (flat):{' '}
              <span className="font-semibold text-slate-900">{formatMoney(fallbackUtilitiesAmount)}/mo</span>
            </p>
          ) : null}
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

      <div className="mb-5 grid gap-2 rounded-[28px] border border-slate-200 bg-slate-50 p-2 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['all', 'All activity', sortedPayments.length],
          ['pending', 'Due or upcoming', unpaidRentPayments.length],
          ['paid', 'Paid rent', paymentHistory.length],
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
                  ? 'No fees or utilities charges right now'
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

/** Pick the best available lease draft: Signed > Published > any (newest first). */
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
    sorted[0]
  )
}

function LeasingPanel({ resident, payments, onOpenPayments }) {
  const leaseTermLabel = getLeaseTermLabel(resident)
  const isMonthToMonth = leaseTermLabel.toLowerCase().includes('month-to-month')
  const leaseSigningUrl = resolveLeaseSigningUrl(resident)
  const moveInLabel = resident['Lease Start Date'] ? formatDate(resident['Lease Start Date']) : '—'
  const moveOutLabel = resident['Lease End Date'] ? formatDate(resident['Lease End Date']) : (isMonthToMonth ? 'No fixed end date' : '—')

  const [leaseDrafts, setLeaseDrafts] = useState([])
  const [leaseLoading, setLeaseLoading] = useState(true)
  const [showLeaseText, setShowLeaseText] = useState(false)
  const [extendByMonths, setExtendByMonths] = useState('3')
  const [extendMode, setExtendMode] = useState('months')
  const [extendToDate, setExtendToDate] = useState('')
  const [extendNotice, setExtendNotice] = useState('')

  const loadLeaseDrafts = useCallback(async () => {
    setLeaseLoading(true)
    try {
      const drafts = await getLeaseDraftsForResident(resident.id)
      setLeaseDrafts(drafts)
    } catch {
      setLeaseDrafts([])
    } finally {
      setLeaseLoading(false)
    }
  }, [resident.id])

  useEffect(() => {
    loadLeaseDrafts()
  }, [loadLeaseDrafts])

  const depositPreviewLabel = useMemo(() => {
    const raw =
      resident['Security Deposit Amount'] ??
      resident['Security Deposit'] ??
      getStaticSecurityDeposit(resident.House)
    if (raw == null || raw === '') return '—'
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return formatMoney(raw)
    const n = parseInt(String(raw).replace(/[^0-9]/g, ''), 10)
    return Number.isFinite(n) && n > 0 ? formatMoney(n) : '—'
  }, [resident.House, resident['Security Deposit'], resident['Security Deposit Amount']])

  const firstMonthRentPaid = useMemo(() => {
    const list = Array.isArray(payments) ? payments : []
    const firstMonthLinePaid = list.some(
      (p) => classifyResidentPaymentLine(p) === 'first_rent' && residentPaymentLineStatus(p) === 'Paid',
    )
    if (firstMonthLinePaid) return true
    return list.some((p) => getPaymentKind(p) === 'rent' && residentPaymentLineStatus(p) === 'Paid')
  }, [payments])

  const securityDepositPaid = useMemo(() => {
    const list = Array.isArray(payments) ? payments : []
    return list.some((p) => classifyResidentPaymentLine(p) === 'deposit' && residentPaymentLineStatus(p) === 'Paid')
  }, [payments])

  const moveInPrereqsMet = securityDepositPaid && firstMonthRentPaid
  const canViewFullLease = moveInPrereqsMet

  const activeLeaseDraft = useMemo(() => pickBestLeaseDraft(leaseDrafts), [leaseDrafts])
  const leaseStatus = activeLeaseDraft?.Status ? String(activeLeaseDraft.Status).trim() : ''
  const leaseIsSigned = leaseStatus === 'Signed'
  /** Extension only after move-in charges are satisfied and the lease is signed. */
  const canRequestLeaseExtension = leaseIsSigned && securityDepositPaid && firstMonthRentPaid
  const leaseBodyAllowed = leaseStatus === 'Published' || leaseStatus === 'Signed'
  const leaseContent = leaseBodyAllowed
    ? (activeLeaseDraft?.['Manager Edited Content'] || activeLeaseDraft?.['AI Draft Content'] || '')
    : ''
  const leasePreview = useMemo(() => {
    if (!activeLeaseDraft) return ''
    if (!leaseBodyAllowed) {
      return leaseStatus === 'Draft Generated'
        ? 'Your lease is being drafted. Full terms will appear here once your manager publishes your lease'
        : 'Your lease is being reviewed internally. The full document will appear here once it is sent to you'
    }
    return leaseContent || `Axis Resident Lease\n\nProperty: ${resident.House || '—'}\nUnit: ${resident['Unit Number'] || '—'}\nTerm: ${leaseTermLabel}\nMove-in: ${moveInLabel}\nMove-out: ${moveOutLabel}\nSecurity Deposit: ${depositPreviewLabel}\n\nPay security deposit and first month rent before signing.`
  }, [activeLeaseDraft, leaseBodyAllowed, leaseStatus, leaseContent, resident.House, resident['Unit Number'], leaseTermLabel, moveInLabel, moveOutLabel, depositPreviewLabel])

  function handleRequestExtension() {
    if (extendMode === 'date') {
      if (!extendToDate) return
      setExtendNotice(`Extension request prepared to ${extendToDate}. Please send this in Inbox to your manager.`)
    } else {
      const n = parseInt(extendByMonths, 10)
      if (!n || n < 1) return
      setExtendNotice(`Extension request prepared for +${n} month${n === 1 ? '' : 's'}. Please send this in Inbox to your manager.`)
    }
  }

  return (
    <div className="mb-10">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h2 className="mr-auto text-2xl font-black text-slate-900">Lease</h2>
        <button type="button" onClick={() => loadLeaseDrafts()} disabled={leaseLoading} className={RP_HEADER_BTN_SECONDARY}>
          {leaseLoading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {!moveInPrereqsMet ? (
        <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-950 shadow-sm">
          <p className="font-semibold text-amber-950">Lease document not available yet</p>
          <p className="mt-1.5 leading-relaxed text-amber-900/90">
            This section stays locked until your <span className="font-semibold">security deposit</span> and{' '}
            <span className="font-semibold">first month rent</span> are paid. Use Payments to complete them, then your
            lease document and signing will unlock here.
          </p>
          <button
            type="button"
            onClick={() => onOpenPayments('pending')}
            className="mt-3 text-sm font-semibold text-amber-950 underline decoration-amber-800/50 underline-offset-2 hover:decoration-amber-950"
          >
            Go to Payments
          </button>
        </div>
      ) : null}

      <div className="space-y-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        {/* Lease document card — only after deposit + first rent paid */}
        {leaseLoading ? (
          <div className="rounded-[24px] border border-slate-200 bg-white p-6 text-sm text-slate-400">Loading lease…</div>
        ) : !moveInPrereqsMet ? null : !activeLeaseDraft ? (
          <div className="rounded-[24px] border border-slate-200 bg-slate-50 px-5 py-5 text-center text-sm text-slate-600">
            Your manager will publish your lease document here when it is ready.
          </div>
        ) : (
          <div className="rounded-[24px] border border-[#2563eb]/20 bg-[linear-gradient(135deg,#eff6ff_0%,#ffffff_100%)] p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#2563eb]">Lease Document</div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${
                    leaseStatus === 'Signed' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' :
                    leaseStatus === 'Published' ? 'border-blue-200 bg-blue-50 text-blue-800' :
                    'border-slate-200 bg-slate-100 text-slate-600'
                  }`}>
                    {leaseStatus || 'Pending'}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowLeaseText((v) => !v)}
                disabled={!leaseBodyAllowed}
                title={leaseBodyAllowed ? '' : 'Available once your manager publishes the lease'}
                className="shrink-0 rounded-full bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {showLeaseText ? 'Hide' : 'View lease'}
              </button>
            </div>
            {!leaseBodyAllowed && (
              <p className="mt-3 text-sm text-slate-500">
                {leaseStatus === 'Draft Generated'
                  ? 'Your lease is being drafted — the full document will appear here once your manager publishes it.'
                  : 'Your lease is being reviewed internally. The full document will appear here once it is sent to you.'}
              </p>
            )}
            {showLeaseText && leaseBodyAllowed && (() => {
              let leaseData = null
              try {
                const raw = activeLeaseDraft?.['Lease JSON']
                leaseData = raw ? JSON.parse(raw) : null
              } catch { /* use null */ }

              const isSigned = leaseStatus === 'Signed'
              const isPublished = leaseStatus === 'Published'
              const signedBy = isSigned ? (activeLeaseDraft?.['Signature Text'] || '') : undefined
              const signedAt = isSigned ? (activeLeaseDraft?.['Signed At'] || '') : undefined

              return (
                <div className="mt-5">
                  <div className="mb-3 flex justify-end">
                    <button
                      type="button"
                      onClick={() => window.print()}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                    >
                      Print / Download PDF
                    </button>
                  </div>

                  {leaseData ? (
                    <LeaseHTMLTemplate
                      leaseData={leaseData}
                      signedBy={signedBy}
                      signedAt={signedAt}
                    />
                  ) : (
                    <div className="overflow-hidden rounded-[20px] border border-slate-200 bg-white">
                      <div className="max-h-[500px] overflow-y-auto p-6">
                        <pre className="whitespace-pre-wrap font-mono text-sm leading-7 text-slate-800">{leasePreview}</pre>
                      </div>
                    </div>
                  )}

                  {isPublished && leaseData ? (
                    <LeaseSignPanel
                      leaseDraftId={activeLeaseDraft.id}
                      tenantName={leaseData.tenantName || resident.Name}
                      onSigned={(sig) => {
                        setLeaseDrafts((prev) =>
                          prev.map((d) =>
                            d.id === activeLeaseDraft.id
                              ? { ...d, Status: 'Signed', 'Signature Text': sig, 'Signed At': new Date().toISOString() }
                              : d
                          )
                        )
                      }}
                    />
                  ) : null}

                  {isSigned ? (
                    <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/60 px-5 py-3 text-center">
                      <p className="text-sm font-semibold text-emerald-800">
                        Lease signed — {signedBy}
                      </p>
                      {signedAt ? (
                        <p className="mt-0.5 text-xs text-emerald-700">
                          {new Date(signedAt).toLocaleString()}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )
            })()}
          </div>
        )}

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
            <p className="mt-1 leading-relaxed">
              Extension requests are not available until your lease is <span className="font-medium text-slate-800">signed</span> and
              your <span className="font-medium text-slate-800">security deposit</span> and{' '}
              <span className="font-medium text-slate-800">first month rent</span> are paid.
            </p>
          </div>
        )}

        <div>
          <button
            type="button"
            onClick={() => { if (canViewFullLease) setShowLeaseText((v) => !v) }}
            disabled={!canViewFullLease}
            className={classNames('rounded-full px-5 py-2.5 text-sm font-semibold transition', canViewFullLease ? 'bg-slate-900 text-white hover:bg-slate-800' : 'cursor-not-allowed bg-slate-200 text-slate-400')}
          >
            {showLeaseText ? 'Hide full lease' : 'View full lease'}
          </button>
          {showLeaseText ? (
            leaseLoading ? (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">Loading lease…</div>
            ) : !canViewFullLease ? (
              <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
                Full lease text is not available until your security deposit and first month rent are paid. Use Payments to
                complete them.
              </div>
            ) : !activeLeaseDraft ? (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
                Your manager will publish your lease document when it is ready.
              </div>
            ) : (
              <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <div className="border-b border-slate-100 bg-slate-50 px-5 py-3 text-xs font-semibold text-slate-600">
                  Full lease preview · Pay security deposit and first month rent before signing.
                </div>
                <div className="max-h-[540px] overflow-y-auto p-6">
                  <pre className="whitespace-pre-wrap font-mono text-sm leading-7 text-slate-800">{leasePreview}</pre>
                </div>
              </div>
            )
          ) : null}
        </div>
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
  inboxUnopenedCount,
}) {
  const snapshot = useMemo(() => buildResidentRentSnapshot(payments, resident), [payments, resident])
  const hasOverdueRent = snapshot.overdueTotal > 0
  const paymentCardValue = hasOverdueRent
    ? formatMoney(snapshot.overdueTotal)
    : snapshot.nextDue
      ? formatMoney(snapshot.nextDue.balance)
      : '—'
  const openWoCount = useMemo(
    () => visibleWorkOrders.filter((r) => isWorkOrderOpen(r)).length,
    [visibleWorkOrders],
  )
  const workOrderCardValue = visibleWorkOrders.length === 0 ? 'None' : openWoCount > 0 ? 'In Progress' : 'Done'
  const leaseStatus = approvedLease?.Status ? String(approvedLease.Status).trim() : null
  const leaseTermLabel = getLeaseTermLabel(resident)
  const leaseSigningUrl = resolveLeaseSigningUrl(resident)
  const leaseNeedsSigning = Boolean(leaseStatus && leaseStatus !== 'Signed')
  const firstName = String(resident?.Name || '').split(' ')[0] || 'Resident'
  const homeLabel = [resident.House, normalizeUnitLabel(resident['Unit Number'] || '')].filter(Boolean).join(' · ') || null
  const leaseDurationHeadline = leaseTermLabel.trim() || '—'
  const leaseCardSubline = leaseNeedsSigning
    ? 'Sign your lease to finish onboarding'
    : leaseStatus === 'Signed'
      ? 'Lease signed'
      : approvedLease
        ? String(leaseStatus || 'In progress')
        : 'Lease document not on file yet'

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black uppercase tracking-[0.08em] text-slate-900">
          {`WELCOME ${firstName}`}
        </h2>
      </div>

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
          className={`flex flex-col gap-2 rounded-3xl border p-5 text-left transition hover:shadow-sm ${
            leaseNeedsSigning
              ? 'border-amber-200 bg-amber-50 hover:border-amber-300'
              : leaseStatus === 'Signed'
                ? 'border-emerald-200 bg-emerald-50 hover:border-emerald-300'
                : 'border-blue-100 bg-blue-50 hover:border-blue-200'
          }`}
        >
          <span
            className={`text-[10px] font-bold uppercase tracking-[0.14em] ${
              leaseNeedsSigning
                ? 'text-amber-700'
                : leaseStatus === 'Signed'
                  ? 'text-emerald-600'
                  : 'text-blue-600'
            }`}
          >
            Lease
          </span>
          <span
            className={`text-3xl font-black leading-tight ${
              leaseNeedsSigning
                ? 'text-amber-800'
                : leaseStatus === 'Signed'
                  ? 'text-emerald-700'
                  : 'text-blue-700'
            }`}
          >
            {leaseDurationHeadline}
          </span>
          <p className={`text-sm ${leaseNeedsSigning ? 'text-amber-800/90' : 'text-slate-600'}`}>{leaseCardSubline}</p>
          {leaseStatus === 'Signed' ? (
            <button
              type="button"
              onClick={() => onNavigate('leasing')}
              className="mt-1 inline-flex w-fit rounded-full border border-emerald-300 bg-emerald-100 px-4 py-2 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-200"
            >
              Extend
            </button>
          ) : leaseNeedsSigning ? (
            <button
              type="button"
              onClick={() => {
                if (leaseSigningUrl) {
                  window.location.href = leaseSigningUrl
                  return
                }
                onNavigate('leasing')
              }}
              className="mt-1 inline-flex w-fit rounded-full border border-amber-300 bg-amber-100 px-4 py-2 text-xs font-semibold text-amber-900 transition hover:bg-amber-200"
            >
              Sign lease
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onNavigate('leasing')}
              className="mt-1 inline-flex w-fit rounded-full border border-blue-200 bg-blue-100 px-4 py-2 text-xs font-semibold text-blue-800 transition hover:bg-blue-200"
            >
              View lease
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => { setPaymentFocus(hasOverdueRent ? 'overdue' : ''); onNavigate('payments') }}
          className={classNames(
            'flex flex-col gap-1 rounded-3xl border p-5 text-left transition hover:shadow-sm',
            hasOverdueRent
              ? 'border-red-100 bg-red-50 hover:border-red-200'
              : 'border-blue-100 bg-blue-50 hover:border-blue-200',
          )}
        >
          <span className={classNames('text-[10px] font-bold uppercase tracking-[0.14em]', hasOverdueRent ? 'text-red-600' : 'text-blue-600')}>
            {hasOverdueRent ? 'Payments · Overdue' : 'Payments · Due'}
          </span>
          <span className={classNames('text-3xl font-black tabular-nums', hasOverdueRent ? 'text-red-700' : 'text-blue-700')}>
            {paymentCardValue}
          </span>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('workorders')}
          className="flex flex-col gap-1 rounded-3xl border border-blue-100 bg-blue-50 p-5 text-left transition hover:border-blue-200 hover:shadow-sm"
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

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [nextRequests, nextPayments, lease] = await Promise.all([
        getWorkOrdersForResident(resident).catch(() => []),
        getPaymentsForResident(resident).catch(() => []),
        getApprovedLeaseForResident(resident.id).catch(() => null),
      ])
      setRequests(nextRequests)
      setPayments(nextPayments)
      setApprovedLease(lease)
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

  useEffect(() => {
    const email = String(resident?.Email || '').trim()
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
  }, [resident])

  const accessState = residentPortalAccessState(resident)
  const applicationUnlocked = accessState === 'approved'
  const isRejected = accessState === 'rejected'
  const RESTRICTED_TAB_IDS = new Set(['leasing', 'payments', 'workorders', 'inbox'])

  const handleNavigate = useCallback((nextTab) => {
    if (isRejected && RESTRICTED_TAB_IDS.has(nextTab)) {
      setTab('dashboard')
      return
    }
    setTab(nextTab)
  }, [isRejected])

  useEffect(() => {
    if (isRejected && RESTRICTED_TAB_IDS.has(tab)) {
      setTab('dashboard')
    }
  }, [isRejected, tab])

  const TABS = [
    ['dashboard', 'Dashboard'],
    ['leasing', 'Lease'],
    ['payments', 'Payments'],
    ['workorders', 'Work Orders'],
    ['inbox', 'Inbox'],
    ['profile', 'Profile'],
  ].filter(([id]) => !(isRejected && RESTRICTED_TAB_IDS.has(id)))

  return (
    <PortalShell
      brandTitle="Axis"
      desktopNav="sidebar"
      navItems={TABS.map(([id, label]) => ({ id, label }))}
      activeId={tab}
      onNavigate={handleNavigate}
      onSignOut={onSignOut}
    >
      <div className="mx-auto w-full max-w-[1600px]">
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
              />
            </PanelErrorBoundary>
          ) : (
            isRejected ? <ResidentRejectedGate /> : <ResidentPendingApprovalGate />
          )
        ) : null}
        {!loading && tab === 'leasing' ? (
          applicationUnlocked ? (
            <LeasingPanel resident={resident} payments={payments} onOpenPayments={(focus = '') => { setPaymentFocus(focus); handleNavigate('payments') }} />
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
      </div>
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

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { properties } from '../data/properties'
import { EmbeddedStripeCheckout } from '../components/EmbeddedStripeCheckout'
import {
  PortalOpsCard,
  PortalOpsEmptyState,
  PortalOpsMetric,
  PortalOpsStatusBadge,
} from '../components/PortalOpsUI'
import ResidentPortalInbox from '../components/portal-inbox/ResidentPortalInbox'
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
import { HOUSING_CONTACT_MESSAGE, HOUSING_CONTACT_SCHEDULE } from '../lib/housingSite'
import {
  airtableReady,
  createResident,
  createWorkOrder,
  getApplicationById,
  getApprovedLeaseForResident,
  getLeaseDraftsForResident,
  getPaymentsForResident,
  getPropertyByName,
  getResidentByEmail,
  getResidentById,
  appendWorkOrderUpdateFromResident,
  getWorkOrdersForResident,
  loginResident,
  stripWorkOrderPortalSubmitterLine,
  updateResident,
} from '../lib/airtable'

const SESSION_KEY = 'axis_resident'

const requestCategories = ['Plumbing', 'Electrical', 'Heating / Cooling', 'Appliance', 'General Maintenance', 'Cleaning', 'Other']
const urgencyOptions = ['Low', 'Medium', 'Urgent']

function normalizeUnitLabel(value) {
  return String(value || '').replace(/^Unit\s+/i, 'Room ').trim()
}

function extractRoomNumber(value) {
  const match = String(value || '').match(/(\d+)/)
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
}

function compareRoomLabels(a, b) {
  const n = extractRoomNumber(a) - extractRoomNumber(b)
  if (n !== 0) return n
  return String(a || '').localeCompare(String(b || ''), undefined, { numeric: true, sensitivity: 'base' })
}

const statusStyles = {
  Submitted: 'border-slate-200 bg-slate-100 text-slate-700',
  'In Progress': 'border-sky-200 bg-sky-50 text-sky-700',
  Resolved: 'border-emerald-200 bg-emerald-50 text-emerald-700',
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

function residentWorkOrderStatusLabel(record) {
  if (!record) return 'Submitted'
  if (isWorkOrderResolved(record)) {
    const raw = String(record.Status || '').trim().toLowerCase()
    return raw === 'closed' ? 'Closed' : 'Completed'
  }
  const raw = String(record.Status || '').trim().toLowerCase()
  if (raw.includes('review')) return 'In Review'
  if (raw.includes('schedule')) return 'Scheduled'
  if (raw.includes('progress')) return 'In Progress'
  return 'Submitted'
}

function residentWorkOrderStatusTone(record) {
  const label = residentWorkOrderStatusLabel(record)
  if (label === 'Completed' || label === 'Closed') return 'emerald'
  if (label === 'Scheduled') return 'axis'
  if (label === 'In Progress' || label === 'In Review') return 'amber'
  return 'slate'
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

const priorityStyles = {
  Routine: 'border-slate-200 bg-slate-100 text-slate-600',
  Low: 'border-slate-200 bg-slate-100 text-slate-600',
  Normal: 'border-slate-200 bg-slate-100 text-slate-600',
  High: 'border-amber-200 bg-amber-50 text-amber-700',
  Urgent: 'border-amber-200 bg-amber-50 text-amber-700',
  Emergency: 'border-red-200 bg-red-50 text-red-700',
  Critical: 'border-red-200 bg-red-50 text-red-700',
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

function isApprovalGranted(value) {
  if (value === true || value === 1) return true
  const normalized = String(value || '').trim().toLowerCase()
  return ['true', '1', 'yes', 'approved'].includes(normalized)
}

function residentApplicationUnlocked(resident) {
  return (
    isApprovalGranted(resident?.['Application Approval']) || isApprovalGranted(resident?.Approved)
  )
}

function ResidentPendingApprovalGate() {
  return (
    <div className="rounded-[28px] border border-amber-200 bg-amber-50/60 px-6 py-12 text-center shadow-soft">
      <p className="text-base font-semibold text-amber-950">Waiting for manager approval</p>
      <p className="mx-auto mt-2 max-w-lg text-sm text-amber-900/90">
        You&apos;re signed in. Your rental application is still being reviewed. When a manager approves it in Axis, this section will unlock. You can update your profile anytime from the sidebar.
      </p>
    </div>
  )
}

function formatMoney(value) {
  return `$${Number(value || 0).toLocaleString()}`
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
    <div className="rounded-[28px] border border-slate-200 bg-white shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-7">
        <div>
          <h2 className="text-xl font-black text-slate-900 sm:text-2xl">{title}</h2>
          {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
        </div>
        {action}
      </div>
      <div className="px-5 py-5 sm:px-7 sm:py-6">{children}</div>
    </div>
  )
}

function SetupRequired() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_100%)] px-4">
      <div className="w-full max-w-xl rounded-[28px] border border-slate-200 bg-white p-8 text-center shadow-soft">
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
    : 'mt-4 rounded-[24px] border border-slate-200 bg-slate-50 p-4'
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
          <p className="text-sm text-slate-400">No updates yet. Add a note below — your property team sees it on the work order.</p>
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

function WorkOrdersPanel({ resident, requests: requestsProp, onRequestCreated, onWorkOrderUpdated }) {
  const requests = Array.isArray(requestsProp) ? requestsProp : []
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

  useEffect(() => {
    if (requests.length === 0) {
      setSelectedId(null)
      return
    }
    setSelectedId((current) => (current && requests.some((r) => r.id === current) ? current : requests[0].id))
  }, [requests])

  const selectedRequest = useMemo(
    () => (selectedId ? requests.find((r) => r.id === selectedId) : null),
    [requests, selectedId]
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
      setSuccess('Request submitted.')
      setShowForm(false)
      onRequestCreated(created)
    } catch (err) {
      setError(err.message || 'Could not submit request.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <PortalOpsCard
        title="Work Orders"
        description="Submit a request fast, then track updates and visit times in one place."
        action={
          <button
            type="button"
            onClick={() => {
              setShowForm((value) => !value)
              setError('')
              setSuccess('')
            }}
            className="rounded-full bg-axis px-5 py-3 text-sm font-semibold text-white transition hover:brightness-105"
          >
            {showForm ? 'Close form' : 'Create new work order'}
          </button>
        }
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <PortalOpsMetric
            label="Open requests"
            value={requests.filter((item) => isWorkOrderOpen(item)).length}
            hint="Still waiting on review, scheduling, or repair."
            tone="amber"
          />
          <PortalOpsMetric
            label="Scheduled"
            value={requests.filter((item) => residentWorkOrderStatusLabel(item) === 'Scheduled').length}
            hint="A visit time has been added."
            tone="axis"
          />
          <PortalOpsMetric
            label="Completed"
            value={requests.filter((item) => residentWorkOrderStatusLabel(item) === 'Completed' || residentWorkOrderStatusLabel(item) === 'Closed').length}
            hint="Resolved and visible here for a few days."
            tone="emerald"
          />
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
              <label className="flex min-h-[120px] cursor-pointer flex-col items-center justify-center rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center transition hover:border-axis">
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
              description="When you submit a maintenance request, it will appear here with status updates."
            />
          </div>
        ) : (
          <div className="mt-6 grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
            <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-5 py-4">
                <h3 className="text-sm font-black text-slate-900">My Work Orders</h3>
              </div>
              <div className="divide-y divide-slate-100">
                {requests.map((request) => (
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
                      {stripWorkOrderPortalSubmitterLine(request.Description) || 'No description added.'}
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

                <div className="mt-5 rounded-[24px] border border-slate-200 bg-slate-50 px-5 py-4">
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Issue details</div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-700">
                    {stripWorkOrderPortalSubmitterLine(selectedRequest.Description) || 'No description added.'}
                  </p>
                </div>

                {selectedRequest['Resolution Summary'] || selectedRequest['Management Notes'] ? (
                  <div className="mt-5 grid gap-4 lg:grid-cols-2">
                    {selectedRequest['Resolution Summary'] ? (
                      <div className="rounded-[24px] border border-emerald-200 bg-emerald-50 px-5 py-4">
                        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-700">Completion note</div>
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-emerald-900">
                          {selectedRequest['Resolution Summary']}
                        </p>
                      </div>
                    ) : null}
                    {selectedRequest['Management Notes'] && !selectedRequest['Resolution Summary'] ? (
                      <div className="rounded-[24px] border border-slate-200 bg-white px-5 py-4">
                        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Team notes</div>
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-slate-700">
                          {selectedRequest['Management Notes']}
                        </p>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="mt-5 overflow-hidden rounded-[24px] border border-slate-200">
                  <div className="border-b border-slate-200 bg-white px-5 py-4">
                    <div className="text-sm font-black text-slate-900">Notes to the team</div>
                    <div className="mt-1 text-xs text-slate-400">Appends to the work order update log (no separate message thread).</div>
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
      </PortalOpsCard>
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
      setMessage('Profile updated.')
      setIsEditing(false)
    } catch (err) {
      setSaveError(err.message || 'Could not save profile. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10'
  const readCls = 'rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900'

  return (
    <SectionCard
      title="My Profile"
      action={
        <button type="button"
          onClick={() => {
            if (isEditing) { setName(resident.Name || ''); setEmail(resident.Email || ''); setPhone(resident.Phone || '') }
            setIsEditing((v) => !v)
            setMessage('')
            setSaveError('')
          }}
          className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-500">
          {isEditing ? 'Cancel' : 'Edit'}
        </button>
      }
    >
      {/* Locked lease info as plain text */}
      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl bg-slate-50 px-4 py-3">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Property</div>
          <div className="mt-1 text-sm font-semibold text-slate-900">{resident.House || '—'}</div>
        </div>
        <div className="rounded-2xl bg-slate-50 px-4 py-3">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Unit</div>
          <div className="mt-1 text-sm font-semibold text-slate-900">{normalizeUnitLabel(resident['Unit Number'] || '') || '—'}</div>
        </div>
        <div className="rounded-2xl bg-slate-50 px-4 py-3">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Lease Type</div>
          <div className="mt-1 text-sm font-semibold text-slate-900">{getLeaseTermLabel(resident)}</div>
        </div>
        <div className="rounded-2xl bg-slate-50 px-4 py-3">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Lease Dates</div>
          <div className="mt-1 text-sm font-semibold text-slate-900">
            {resident['Lease Start Date'] ? formatDate(resident['Lease Start Date']) : '—'}
            {' → '}
            {resident['Lease End Date'] ? formatDate(resident['Lease End Date']) : 'Ongoing'}
          </div>
        </div>
      </div>

      {/* Editable contact fields */}
      <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-2 block text-sm font-semibold text-slate-700">Full Name</label>
          {isEditing
            ? <input type="text" required value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
            : <div className={readCls}>{name || '—'}</div>}
        </div>
        <div>
          <label className="mb-2 block text-sm font-semibold text-slate-700">Email</label>
          {isEditing
            ? <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
            : <div className={readCls}>{email || '—'}</div>}
        </div>
        <div>
          <label className="mb-2 block text-sm font-semibold text-slate-700">Phone</label>
          {isEditing
            ? <input required value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} />
            : <div className={readCls}>{phone || '—'}</div>}
        </div>
        {message ? <div className="sm:col-span-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}
        {saveError ? <div className="sm:col-span-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{saveError}</div> : null}
        {isEditing ? (
          <div className="sm:col-span-2">
            <button type="submit" disabled={saving}
              className="rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50">
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        ) : null}
      </form>
    </SectionCard>
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

  useEffect(() => {
    getPaymentsForResident(resident)
      .then(setPayments)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [resident])

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
  const effectiveCurrentDue = currentDuePayment || (fallbackRentAmount > 0 ? {
    Amount: fallbackRentAmount,
    Month: 'Current rent',
    'Due Date': resident['Next Rent Due'] || '',
  } : null)
  const upcomingPayments = useMemo(
    () => unpaidRentPayments.filter((payment) => payment !== currentDuePayment),
    [currentDuePayment, unpaidRentPayments],
  )
  const paymentHistory = useMemo(
    () => [...rentPayments].filter((payment) => paymentStatusForRecord(payment) === 'Paid').sort((a, b) => new Date(b['Paid Date'] || b['Due Date'] || 0) - new Date(a['Paid Date'] || a['Due Date'] || 0)),
    [paymentStatusForRecord, rentPayments],
  )
  const feeChargeRows = useMemo(
    () => [...feePayments].sort((a, b) => new Date(a['Due Date'] || a.created_at || 0) - new Date(b['Due Date'] || b.created_at || 0)),
    [feePayments],
  )

  /** All rent periods — not limited to a single month (manager view is month-scoped). */
  const rentSummaryAllTime = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    let unpaidTotal = 0
    let overdueTotal = 0
    let paidTotal = 0
    for (const p of rentPayments) {
      if (paymentStatusForRecord(p) === 'Paid') {
        const rec = amountPaidForRecord(p)
        paidTotal += rec > 0 ? rec : amountDueForRecord(p)
        continue
      }
      const bal = balanceForRecord(p)
      if (bal <= 0) continue
      unpaidTotal += bal
      const due = parseDisplayDate(p?.['Due Date'])
      if (due && !Number.isNaN(due.getTime()) && due < today) {
        overdueTotal += bal
      }
    }
    return { unpaidTotal, overdueTotal, paidTotal }
  }, [rentPayments, paymentStatusForRecord, balanceForRecord, amountPaidForRecord, amountDueForRecord])

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
    <PortalOpsCard title="Payments" description="See what is due, pay it fast, and review past charges without extra clutter.">
      {loading ? <p className="text-sm text-slate-400">Loading payments...</p> : null}
      {!loading && (
        <>
          {error ? (
            <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Payment history could not be loaded right now. Try refreshing.
            </div>
          ) : null}

          <div className="rounded-[28px] border border-slate-200 bg-[linear-gradient(135deg,#ffffff_0%,#f8fbff_100%)] p-6 sm:p-7">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Rent Due</div>
                <div className="mt-3 text-4xl font-black tracking-tight text-slate-900">
                  {effectiveCurrentDue ? formatMoney(currentDuePayment ? currentAmountDue : effectiveCurrentDue.Amount) : '$0'}
                </div>
                <div className="mt-2 text-sm leading-6 text-slate-500">
                  {effectiveCurrentDue?.['Due Date'] ? `Due Date: ${formatDate(effectiveCurrentDue['Due Date'])}` : 'No rent currently due'}
                </div>
                <div className="mt-3">
                  <PortalOpsStatusBadge tone={paymentToneForStatus(currentStatus)}>
                    {currentStatus}
                  </PortalOpsStatusBadge>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={!effectiveCurrentDue || actionLoading === 'rent'}
                  onClick={() => launchCheckout({
                    amount: Number(currentDuePayment ? currentAmountDue : effectiveCurrentDue?.Amount || 0),
                    description: effectiveCurrentDue?.Month ? `Rent payment - ${effectiveCurrentDue.Month}` : 'Rent payment',
                    category: 'rent',
                    paymentRecordId: effectiveCurrentDue?.id,
                  })}
                  className="rounded-full bg-axis px-6 py-3 text-sm font-semibold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {actionLoading === 'rent' ? 'Opening...' : 'Pay Now'}
                </button>
              </div>
            </div>
          </div>

          {actionError ? (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{actionError}</div>
          ) : null}

          <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
            <div className="space-y-6">
              <PortalOpsCard title="Upcoming Payments" description="Upcoming rent that still needs payment.">
                {upcomingPayments.length === 0 ? (
                  <PortalOpsEmptyState
                    icon="📅"
                    title="No upcoming payments"
                    description="Nothing else is scheduled after your current due amount."
                  />
                ) : (
                  <div className="space-y-3">
                    {upcomingPayments.map((payment) => {
                      const status = paymentStatusForRecord(payment)
                      return (
                        <div key={payment.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-slate-200 px-4 py-4">
                          <div>
                            <div className="text-sm font-bold text-slate-900">{payment.Month || 'Rent payment'}</div>
                            <div className="mt-1 text-sm text-slate-500">Due {formatDate(payment['Due Date'])}</div>
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="text-sm font-bold text-slate-900">{formatMoney(balanceForRecord(payment))}</div>
                            <PortalOpsStatusBadge tone={paymentToneForStatus(status)}>{status}</PortalOpsStatusBadge>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </PortalOpsCard>

              <PortalOpsCard title="Past Payments" description="Your recent paid rent history.">
                {paymentHistory.length === 0 ? (
                  <PortalOpsEmptyState icon="🧾" title="No past payments yet" description="Paid rent will show up here once the first charge is settled." />
                ) : (
                  <div className="space-y-3">
                    {paymentHistory.map((payment) => (
                      <div key={payment.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-slate-200 px-4 py-4">
                        <div>
                          <div className="text-sm font-bold text-slate-900">{payment.Month || 'Rent payment'}</div>
                          <div className="mt-1 text-sm text-slate-500">
                            {payment['Paid Date'] ? `Paid ${formatDate(payment['Paid Date'])}` : `Due ${formatDate(payment['Due Date'])}`}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-sm font-bold text-slate-900">{formatMoney(amountDueForRecord(payment))}</div>
                          <PortalOpsStatusBadge tone="emerald">Paid</PortalOpsStatusBadge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </PortalOpsCard>
            </div>

            {feeChargeRows.length > 0 ? (
              <PortalOpsCard title="Fines & Extra Charges" description="Fees, fines, or other non-rent charges.">
                <div className="space-y-3">
                  {feeChargeRows.map((payment) => {
                    const status = paymentStatusForRecord(payment)
                    return (
                      <div
                        key={payment.id}
                        className={classNames(
                          'rounded-[24px] border px-4 py-4',
                          highlightCategory === 'extension' ? 'border-axis/40 bg-axis/5' : 'border-slate-200',
                        )}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-bold text-slate-900">{payment.Month || payment.Type || 'Extra charge'}</div>
                            <div className="mt-1 text-sm text-slate-500">
                              {payment['Due Date'] ? `Due ${formatDate(payment['Due Date'])}` : 'Extra charge'}
                            </div>
                            {payment.Notes ? <div className="mt-1 text-xs text-slate-400">{payment.Notes}</div> : null}
                          </div>
                          <div className="flex items-center gap-3">
                            <div className="text-sm font-bold text-slate-900">{formatMoney(balanceForRecord(payment) || amountDueForRecord(payment))}</div>
                            <PortalOpsStatusBadge tone={paymentToneForStatus(status)}>{status}</PortalOpsStatusBadge>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </PortalOpsCard>
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
    </PortalOpsCard>
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
  const leaseDepositPaid = Boolean(resident['Security Deposit Paid'] || resident['Deposit Paid'])
  const signedLeaseNote = String(resident['Security Deposit Paid Date'] || resident['Deposit Paid Date'] || '').trim()

  // First month rent: check if any paid rent payment exists
  const firstMonthRentPaid = useMemo(() => {
    const list = Array.isArray(payments) ? payments : []
    return list.some((p) => getPaymentKind(p) === 'rent' && residentPaymentLineStatus(p) === 'Paid')
  }, [payments])

  const [leaseDrafts, setLeaseDrafts] = useState([])
  const [leaseLoading, setLeaseLoading] = useState(true)
  const [showLeaseText, setShowLeaseText] = useState(false)
  const [houseDeposit, setHouseDeposit] = useState(0)
  const [depositLoading, setDepositLoading] = useState(true)
  const [depositError, setDepositError] = useState('')
  const [depositCheckoutLoading, setDepositCheckoutLoading] = useState(false)
  const [depositPaidState, setDepositPaidState] = useState(leaseDepositPaid)
  const [depositCheckout, setDepositCheckout] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLeaseLoading(true)
    getLeaseDraftsForResident(resident.id)
      .then((drafts) => {
        if (cancelled) return
        setLeaseDrafts(drafts)
      })
      .catch(() => { if (!cancelled) setLeaseDrafts([]) })
      .finally(() => { if (!cancelled) setLeaseLoading(false) })
    return () => { cancelled = true }
  }, [resident.id])

  useEffect(() => {
    let cancelled = false
    async function loadDeposit() {
      setDepositLoading(true)
      setDepositError('')
      try {
        const property = await getPropertyByName(resident.House)
        const depositText = property?.['Security Deposit'] || property?.securityDeposit || getStaticSecurityDeposit(resident.House) || resident['Security Deposit']
        const amount = parseInt(String(depositText || '').replace(/[^0-9]/g, ''), 10)
        if (!cancelled) setHouseDeposit(Number.isFinite(amount) && amount > 0 ? amount : 0)
      } catch {
        // silently ignore — deposit amount is not critical
      } finally {
        if (!cancelled) setDepositLoading(false)
      }
    }
    loadDeposit()
    return () => { cancelled = true }
  }, [resident.House, resident['Security Deposit']])

  useEffect(() => {
    setDepositPaidState(leaseDepositPaid)
  }, [leaseDepositPaid])

  const activeLeaseDraft = useMemo(() => pickBestLeaseDraft(leaseDrafts), [leaseDrafts])
  const leaseStatus = activeLeaseDraft?.Status ? String(activeLeaseDraft.Status).trim() : ''
  const leaseBodyAllowed = leaseStatus === 'Published' || leaseStatus === 'Signed'
  const leaseContent = leaseBodyAllowed
    ? (activeLeaseDraft?.['Manager Edited Content'] || activeLeaseDraft?.['AI Draft Content'] || '')
    : ''
  const leasePreview = useMemo(() => {
    if (!activeLeaseDraft) return ''
    if (!leaseBodyAllowed) {
      return leaseStatus === 'Draft Generated'
        ? 'Your lease is being drafted. Full terms will appear here once your manager publishes your lease.'
        : 'Your lease is being reviewed internally. The full document will appear here once it is sent to you.'
    }
    return leaseContent || `Axis Resident Lease\n\nProperty: ${resident.House || '—'}\nUnit: ${resident['Unit Number'] || '—'}\nTerm: ${leaseTermLabel}\nMove-in: ${moveInLabel}\nMove-out: ${moveOutLabel}\nSecurity Deposit: ${houseDeposit ? formatMoney(houseDeposit) : '—'}\n\nYour final document will appear here for review and signature.`
  }, [activeLeaseDraft, leaseBodyAllowed, leaseStatus, leaseContent, resident.House, resident['Unit Number'], leaseTermLabel, moveInLabel, moveOutLabel, houseDeposit])

  // Both deposit AND first month rent must be paid before signing is allowed
  const signingUnlocked = depositPaidState && firstMonthRentPaid

  async function handleDepositPaid() {
    setDepositCheckoutLoading(true)
    try {
      const today = new Date().toISOString().slice(0, 10)
      await updateResident(resident.id, {
        'Security Deposit Paid': true,
        'Security Deposit Paid Date': today,
        'Security Deposit Amount': houseDeposit || resident['Security Deposit Amount'] || null,
      })
      setDepositPaidState(true)
    } catch (err) {
      setDepositError(err.message || 'Could not record the deposit payment.')
    } finally {
      setDepositCheckoutLoading(false)
      setDepositCheckout(null)
    }
  }

  return (
    <SectionCard title="Leasing" description="Your current lease details and signing options.">
      <div className="space-y-5">
        <div className="rounded-[24px] border border-slate-200 bg-[linear-gradient(135deg,#ffffff_0%,#f8fafc_100%)] p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Current Lease</div>
                {isMonthToMonth ? (
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">Month-to-Month</span>
                ) : null}
              </div>
              <div className="mt-3 text-3xl font-black tracking-tight text-slate-900">{leaseTermLabel}</div>
            </div>
            <div className="grid min-w-[240px] gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Move-in</div>
                <div className="mt-2 text-xl font-black text-slate-900">{moveInLabel}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Move-out</div>
                <div className="mt-2 text-xl font-black text-slate-900">{moveOutLabel}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Lease document card — no sort dropdown; auto-shows the best available draft */}
        {leaseLoading ? (
          <div className="rounded-[24px] border border-slate-200 bg-white p-6 text-sm text-slate-400">Loading lease…</div>
        ) : !activeLeaseDraft ? (
          <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-6 text-center">
            <p className="text-sm font-semibold text-slate-700">Your lease has not been generated yet.</p>
            <p className="mt-1 text-sm text-slate-500">Your manager will prepare a lease document once your application is approved.</p>
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
            {showLeaseText && leaseBodyAllowed && (
              <div className="mt-5 overflow-hidden rounded-[20px] border border-slate-200 bg-white">
                <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-5 py-3">
                  <span className="text-xs font-semibold text-slate-500">
                    {resident.House}{resident['Unit Number'] ? ` · ${normalizeUnitLabel(resident['Unit Number'])}` : ''} · {resident.Name}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const blob = new Blob([leasePreview], { type: 'text/plain' })
                      const url = URL.createObjectURL(blob)
                      const a = document.createElement('a')
                      a.href = url
                      a.download = `lease-${String(resident.Name || 'document').replace(/\s+/g, '-').toLowerCase()}.txt`
                      a.click()
                      URL.revokeObjectURL(url)
                    }}
                    className="text-xs font-semibold text-[#2563eb] hover:underline"
                  >
                    Download
                  </button>
                </div>
                <div className="max-h-[500px] overflow-y-auto p-6">
                  <pre className="whitespace-pre-wrap font-mono text-sm leading-7 text-slate-800">{leasePreview}</pre>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Security Deposit */}
        <div className="rounded-[24px] border border-slate-200 bg-white p-5">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Security Deposit</div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h3 className="text-xl font-black text-slate-900">
              {depositLoading ? 'Loading…' : (houseDeposit ? formatMoney(houseDeposit) : 'Not set')}
            </h3>
            {depositPaidState ? (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                Paid{signedLeaseNote ? ` · ${formatDate(signedLeaseNote)}` : ''}
              </span>
            ) : null}
          </div>
          {!depositPaidState && (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => {
                  if (!houseDeposit) return
                  setDepositCheckout({
                    title: 'Security deposit',
                    request: {
                      residentId: resident.id,
                      residentName: resident.Name,
                      residentEmail: resident.Email,
                      propertyName: resident.House,
                      unitNumber: resident['Unit Number'],
                      amount: houseDeposit,
                      description: 'Security deposit payment',
                      category: 'security_deposit',
                    },
                  })
                }}
                disabled={depositLoading || !houseDeposit || depositCheckoutLoading}
                className="rounded-full bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] px-5 py-3 text-sm font-semibold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Pay security deposit
              </button>
            </div>
          )}
        </div>

        {/* First Month Rent */}
        <div className="rounded-[24px] border border-slate-200 bg-white p-5">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">First Month Rent</div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {firstMonthRentPaid ? (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">Paid</span>
            ) : (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">Unpaid</span>
            )}
          </div>
          {!firstMonthRentPaid && (
            <p className="mt-2 text-sm text-slate-500">
              Pay your first month's rent from the{' '}
              <button type="button" onClick={() => onOpenPayments()} className="font-semibold text-[#2563eb] underline">Payments</button>{' '}
              tab. Lease signing unlocks once both the deposit and first month rent are paid.
            </p>
          )}
        </div>

        {/* Lease Signing */}
        <div className="rounded-[24px] border border-slate-200 bg-white p-5">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Lease Signing</div>
          <h3 className="mt-2 text-xl font-black text-slate-900">Review & Sign</h3>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            {signingUnlocked
              ? 'Your security deposit and first month rent are both paid. Signing is unlocked.'
              : 'Pay the security deposit and first month rent to unlock signing.'}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {signingUnlocked && leaseSigningUrl ? (
              <button
                type="button"
                onClick={() => { window.location.href = leaseSigningUrl }}
                className="rounded-full bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] px-5 py-3 text-sm font-semibold text-white transition hover:brightness-105"
              >
                Sign lease
              </button>
            ) : signingUnlocked ? (
              <p className="text-sm text-slate-400">Your manager will send a signing link once the lease is ready.</p>
            ) : (
              <button
                type="button"
                disabled
                className="rounded-full border border-slate-200 bg-slate-50 px-5 py-3 text-sm font-semibold text-slate-400 cursor-not-allowed"
              >
                Signing locked
              </button>
            )}
          </div>
        </div>

        <EmbeddedStripeCheckout
          open={Boolean(depositCheckout)}
          title={depositCheckout?.title || 'Security deposit'}
          checkoutRequest={depositCheckout?.request}
          onClose={() => setDepositCheckout(null)}
          onComplete={handleDepositPaid}
        />
      </div>
    </SectionCard>
  )
}

// ─── Inbox (same Messages + thread model as manager / admin portals) ─────────

function ResidentInboxPanel({ resident }) {
  return (
    <SectionCard
      title="Inbox"
      description="Email-style threads with your house team and Axis admin — subjects, trash, and read state stay in sync across portals."
    >
      <div className="min-h-[380px]">
        <ResidentPortalInbox resident={resident} />
      </div>
    </SectionCard>
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
}) {
  const snapshot = useMemo(() => buildResidentRentSnapshot(payments, resident), [payments, resident])
  const openWoCount = useMemo(
    () => visibleWorkOrders.filter((r) => isWorkOrderOpen(r)).length,
    [visibleWorkOrders],
  )
  const scheduledWoCount = useMemo(
    () => visibleWorkOrders.filter((r) => residentWorkOrderStatusLabel(r) === 'Scheduled').length,
    [visibleWorkOrders],
  )
  const recentWorkOrders = useMemo(() => {
    return [...visibleWorkOrders]
      .sort(
        (a, b) =>
          new Date(b['Date Submitted'] || b.created_at || 0) - new Date(a['Date Submitted'] || a.created_at || 0),
      )
      .slice(0, 4)
  }, [visibleWorkOrders])

  const leaseStatus = approvedLease?.Status ? String(approvedLease.Status).trim() : ''
  const nextStatus = snapshot.nextDue?.status || 'Paid'
  const nextTone = dashboardPaymentStatusTone(nextStatus)

  function goPayments(focus = '') {
    setPaymentFocus(focus)
    onNavigate('payments')
  }

  return (
    <div className="space-y-8">
      <div className="rounded-[28px] border border-slate-200 bg-[linear-gradient(135deg,#ffffff_0%,#f8fbff_100%)] p-6 sm:p-8">
        {pendingApplicationApproval ? (
          <>
            <p className="text-sm font-semibold text-amber-900">Application under review</p>
            <p className="mt-2 text-sm leading-7 text-slate-600">
              You&apos;re signed in. A property manager still needs to approve your application before rent checkout, maintenance requests, leasing tasks, and inbox messaging are available. Your profile stays open so you can keep contact details current.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm leading-7 text-slate-600">
              Here&apos;s a quick view of rent, maintenance, and leasing. Use the sidebar anytime to open a full section.
            </p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <PortalOpsMetric
                label="Next rent due"
                value={snapshot.nextDue ? formatMoney(snapshot.nextDue.balance) : '$0'}
                hint={
                  snapshot.nextDue?.dueDate
                    ? `Due ${formatDate(snapshot.nextDue.dueDate)} · ${snapshot.nextDue.month || 'Rent'}`
                    : snapshot.nextDue
                      ? String(snapshot.nextDue.month || 'Rent')
                      : 'No rent line items yet'
                }
                tone={snapshot.nextDue ? nextTone : 'slate'}
              />
              <PortalOpsMetric
                label="Unpaid rent"
                value={formatMoney(snapshot.unpaidTotal)}
                hint="Total balance still owed"
                tone={snapshot.unpaidTotal > 0 ? 'axis' : 'slate'}
              />
              <PortalOpsMetric
                label="Overdue"
                value={formatMoney(snapshot.overdueTotal)}
                hint="Past due, not paid"
                tone={snapshot.overdueTotal > 0 ? 'red' : 'slate'}
              />
              <PortalOpsMetric
                label="Open work orders"
                value={openWoCount}
                hint={scheduledWoCount > 0 ? `${scheduledWoCount} scheduled` : 'Nothing in progress'}
                tone={openWoCount > 0 ? 'amber' : 'emerald'}
              />
            </div>
          </>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-7">
          <PortalOpsCard
            title="Shortcuts"
            description={pendingApplicationApproval ? 'Available after your application is approved.' : 'Jump to the most common tasks.'}
          >
            {pendingApplicationApproval ? (
              <p className="text-sm text-slate-600">
                Use the sidebar to open a section — you&apos;ll see a short notice on each tab until a manager approves your application.
              </p>
            ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => goPayments('')}
                className="flex flex-col items-start rounded-2xl border border-slate-200 bg-slate-50/80 px-5 py-4 text-left transition hover:border-axis/40 hover:bg-white"
              >
                <span className="text-sm font-black text-slate-900">Pay rent</span>
                <span className="mt-1 text-xs text-slate-500">Balances, history, and checkout</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('workorders')}
                className="flex flex-col items-start rounded-2xl border border-slate-200 bg-slate-50/80 px-5 py-4 text-left transition hover:border-axis/40 hover:bg-white"
              >
                <span className="text-sm font-black text-slate-900">Work orders</span>
                <span className="mt-1 text-xs text-slate-500">Submit or track maintenance</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('inbox')}
                className="flex flex-col items-start rounded-2xl border border-slate-200 bg-slate-50/80 px-5 py-4 text-left transition hover:border-axis/40 hover:bg-white"
              >
                <span className="text-sm font-black text-slate-900">Inbox</span>
                <span className="mt-1 text-xs text-slate-500">Message your house team</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigate('leasing')}
                className="flex flex-col items-start rounded-2xl border border-slate-200 bg-slate-50/80 px-5 py-4 text-left transition hover:border-axis/40 hover:bg-white"
              >
                <span className="text-sm font-black text-slate-900">Leasing</span>
                <span className="mt-1 text-xs text-slate-500">Lease, deposit, and signing</span>
              </button>
            </div>
            )}
          </PortalOpsCard>

          <PortalOpsCard title="Recent maintenance" description="Latest requests tied to your unit.">
            {pendingApplicationApproval ? (
              <PortalOpsEmptyState
                icon="🛠"
                title="Maintenance after approval"
                description="Once your application is approved, you can submit and track work orders from the Work Orders tab."
                action={
                  <button
                    type="button"
                    onClick={() => onNavigate('workorders')}
                    className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Work Orders
                  </button>
                }
              />
            ) : recentWorkOrders.length === 0 ? (
              <PortalOpsEmptyState
                icon="🛠"
                title="No work orders yet"
                description="Submit one from Work Orders when something needs attention."
                action={
                  <button
                    type="button"
                    onClick={() => onNavigate('workorders')}
                    className="rounded-full bg-axis px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-105"
                  >
                    Open Work Orders
                  </button>
                }
              />
            ) : (
              <div className="space-y-3">
                {recentWorkOrders.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => onNavigate('workorders')}
                    className="flex w-full flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 px-4 py-3 text-left transition hover:border-axis/30 hover:bg-slate-50/80"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold text-slate-900">{w.Title || 'Work order'}</div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        {w.Category || 'General'} · {formatDate(w['Date Submitted'] || w.created_at)}
                      </div>
                    </div>
                    <PortalOpsStatusBadge tone={residentWorkOrderStatusTone(w)}>
                      {residentWorkOrderStatusLabel(w)}
                    </PortalOpsStatusBadge>
                  </button>
                ))}
              </div>
            )}
          </PortalOpsCard>
        </div>

        <div className="space-y-6 lg:col-span-5">
          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-soft">
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Your home</div>
            <div className="mt-2 text-lg font-black text-slate-900">
              {[resident.House, normalizeUnitLabel(resident['Unit Number'] || '')].filter(Boolean).join(' · ') || 'Not assigned'}
            </div>
            <div className="mt-3 text-sm text-slate-500">{getLeaseTermLabel(resident)}</div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onNavigate('profile')}
                className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Profile
              </button>
              <Link
                to={HOUSING_CONTACT_SCHEDULE}
                className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                Schedule tour
              </Link>
            </div>
          </div>

          <PortalOpsCard
            title="Lease document"
            description="Published or signed lease from your manager."
          >
            {leaseStatus ? (
              <div className="space-y-3">
                <PortalOpsStatusBadge tone={leaseStatus === 'Signed' ? 'emerald' : 'axis'}>{leaseStatus}</PortalOpsStatusBadge>
                <p className="text-sm text-slate-600">
                  Open the Leasing tab to read the full document or complete next steps.
                </p>
                <button
                  type="button"
                  onClick={() => onNavigate('leasing')}
                  className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  Go to Leasing
                </button>
              </div>
            ) : (
              <PortalOpsEmptyState
                icon="📄"
                title="No published lease yet"
                description="When your manager publishes your lease, it will show in Leasing."
                action={
                  <button
                    type="button"
                    onClick={() => onNavigate('leasing')}
                    className="rounded-full bg-axis px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-105"
                  >
                    Leasing
                  </button>
                }
              />
            )}
          </PortalOpsCard>

          <div className="rounded-[24px] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-4 text-sm text-slate-600">
            <span className="font-semibold text-slate-800">Need help?</span>{' '}
            <Link to={HOUSING_CONTACT_MESSAGE} className="font-semibold text-axis underline decoration-axis/30 underline-offset-2">
              Message Axis
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function Dashboard({ resident, onResidentUpdated, onSignOut }) {
  const [tab, setTab] = useState('dashboard')
  const [paymentFocus, setPaymentFocus] = useState('')
  const [requests, setRequests] = useState([])
  const [payments, setPayments] = useState([])
  const [approvedLease, setApprovedLease] = useState(null)
  const [loading, setLoading] = useState(true)

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

  useEffect(() => {
    loadData()
  }, [loadData])

  const applicationUnlocked = residentApplicationUnlocked(resident)

  const TABS = [
    ['dashboard', 'Dashboard'],
    ['workorders', 'Work Orders'],
    ['leasing', 'Leasing'],
    ['payments', 'Payments'],
    ['inbox', 'Inbox'],
    ['profile', 'Profile'],
  ]

  return (
    <PortalShell
      brandTitle="Axis"
      brandSubtitle="Resident portal"
      navItems={TABS.map(([id, label]) => ({ id, label }))}
      activeId={tab}
      onNavigate={setTab}
      userLabel={resident.Name || 'Resident'}
      userMeta={[homeLabel, resident.Email].filter(Boolean).join(' · ') || undefined}
      onSignOut={onSignOut}
    >
      <div className="mx-auto w-full max-w-[1600px]">
        <div className="mb-8">
          <h1 className="text-4xl font-black tracking-tight text-slate-900">
            {tab === 'dashboard' ? `Hi, ${resident.Name || 'Resident'}` : `Welcome back, ${resident.Name || 'Resident'}`}
          </h1>
          <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-500">
            <span>{getLeaseTermLabel(resident)}</span>
            {applicationUnlocked && tab !== 'dashboard' && openRequestCount > 0 ? (
              <span className="font-semibold text-sky-600">{openRequestCount} open work order{openRequestCount === 1 ? '' : 's'}</span>
            ) : null}
          </div>
        </div>

        {!applicationUnlocked ? (
          <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-950 shadow-sm">
            <p className="font-semibold">Waiting for manager approval</p>
            <p className="mt-1 text-amber-900/90">
              Your account is active. A property manager still needs to approve your rental application before work orders, payments, leasing, and inbox are fully available. Open Profile anytime to update your contact details.
            </p>
          </div>
        ) : null}

        {loading ? (
          <div className="rounded-[28px] border border-slate-200 bg-white px-6 py-16 text-center text-sm text-slate-400 shadow-soft">
            Loading...
          </div>
        ) : null}

        {!loading && tab === 'dashboard' ? (
          <ResidentDashboardHome
            resident={resident}
            visibleWorkOrders={visibleWorkOrders}
            payments={payments}
            approvedLease={approvedLease}
            onNavigate={setTab}
            setPaymentFocus={setPaymentFocus}
            pendingApplicationApproval={!applicationUnlocked}
          />
        ) : null}
        {!loading && tab === 'workorders' ? (
          applicationUnlocked ? (
            <WorkOrdersPanel
              resident={resident}
              requests={visibleWorkOrders}
              onRequestCreated={loadData}
              onWorkOrderUpdated={loadData}
            />
          ) : (
            <ResidentPendingApprovalGate />
          )
        ) : null}
        {!loading && tab === 'leasing' ? (
          applicationUnlocked ? (
            <LeasingPanel resident={resident} payments={payments} onOpenPayments={(focus = '') => { setPaymentFocus(focus); setTab('payments') }} />
          ) : (
            <ResidentPendingApprovalGate />
          )
        ) : null}
        {!loading && tab === 'payments' ? (
          applicationUnlocked ? (
            <PaymentsPanel
              resident={resident}
              onResidentUpdated={onResidentUpdated}
              highlightCategory={paymentFocus}
              onPaymentsDataUpdated={setPayments}
            />
          ) : (
            <ResidentPendingApprovalGate />
          )
        ) : null}
        {!loading && tab === 'inbox' ? (
          applicationUnlocked ? <ResidentInboxPanel resident={resident} /> : <ResidentPendingApprovalGate />
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

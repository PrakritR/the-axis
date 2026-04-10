import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { properties } from '../data/properties'
import { EmbeddedStripeCheckout } from '../components/EmbeddedStripeCheckout'
import { readJsonResponse } from '../lib/readJsonResponse'
import { HousingMessageForm } from '../components/HousingMessageForm'
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
import { ManagerAuthForm, MANAGER_SESSION_KEY } from './Manager'
import { HOUSING_CONTACT_MESSAGE, HOUSING_CONTACT_SCHEDULE } from '../lib/housingSite'
import {
  airtableReady,
  createResident,
  createWorkOrder,
  getAnnouncements,
  getApplicationById,
  getApprovedLeaseForResident,
  getMessages,
  getPaymentsForResident,
  getPropertyByName,
  getResidentByEmail,
  getResidentById,
  appendWorkOrderUpdateFromResident,
  getWorkOrdersForResident,
  loginResident,
  sendMessage,
  updateResident,
} from '../lib/airtable'

const SESSION_KEY = 'axis_resident'

const requestCategories = ['Plumbing', 'Electrical', 'HVAC', 'Appliance', 'Pest', 'Structural', 'Other']
const urgencyOptions = ['Routine', 'Urgent', 'Emergency']
const entryOptions = ['Morning', 'Afternoon', 'Evening']

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

const MATCH_ALL_TOKENS = new Set(['all', 'all properties', 'all residents', 'everyone'])

function buildResidentMatchKeys(resident) {
  const house = String(resident.House || '').trim()
  const room = normalizeUnitLabel(resident['Unit Number'] || '')
  const propCode = house.match(/4709[AB]|5259/i)?.[0]?.toUpperCase() || ''
  const keys = new Set()
  const add = (...vals) => vals.forEach((v) => { if (v) keys.add(v.toLowerCase().trim()) })
  add(house, propCode)
  const roomNum = room.replace(/^Room\s*/i, '')
  add(room, roomNum)
  if (propCode && room) {
    add(
      `${propCode} - ${room}`, `${propCode} - ${roomNum}`,
      `${propCode} ${room}`, `${propCode} ${roomNum}`,
      `${house} - ${room}`, `${house} ${room}`,
    )
  }
  return keys
}

function announcementMatchesResident(item, resident) {
  const tokens = Array.isArray(item.Target) ? item.Target : []
  if (tokens.length === 0 || tokens.some((t) => MATCH_ALL_TOKENS.has(t))) return true
  const residentKeys = buildResidentMatchKeys(resident)
  return tokens.some((token) => residentKeys.has(token.toLowerCase().trim()))
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

const priorityStyles = {
  Routine: 'border-slate-200 bg-slate-100 text-slate-600',
  Low: 'border-slate-200 bg-slate-100 text-slate-600',
  Normal: 'border-slate-200 bg-slate-100 text-slate-600',
  High: 'border-amber-200 bg-amber-50 text-amber-700',
  Urgent: 'border-amber-200 bg-amber-50 text-amber-700',
  Emergency: 'border-red-200 bg-red-50 text-red-700',
  Critical: 'border-red-200 bg-red-50 text-red-700',
}

const paymentStatusStyles = {
  Paid: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  Pending: 'border-amber-200 bg-amber-50 text-amber-700',
  Overdue: 'border-red-200 bg-red-50 text-red-700',
  Partial: 'border-sky-200 bg-sky-50 text-sky-700',
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

function getUtilitiesFee(propertyName) {
  const property = properties.find((p) => p.name === propertyName)
  if (!property?.utilitiesFee) return 0
  const amount = parseInt(String(property.utilitiesFee).replace(/[^0-9]/g, ''), 10)
  return Number.isFinite(amount) && amount > 0 ? amount : 0
}

function getStaticSecurityDeposit(propertyName) {
  const property = properties.find((p) => p.name === propertyName)
  if (!property?.securityDeposit) return 0
  const amount = parseInt(String(property.securityDeposit).replace(/[^0-9]/g, ''), 10)
  return Number.isFinite(amount) && amount > 0 ? amount : 0
}

const leaseSigningFields = ['DocuSign Signing URL', 'DocuSign URL', 'Lease Signing URL', 'Lease Sign URL', 'Lease Document URL', 'Lease URL']
const residentPaymentFields = ['Resident Payment URL', 'Payment URL', 'Payment Link', 'Resident Portal URL', 'Portal URL']
const stripeCustomerFields = ['Stripe Customer ID', 'Stripe Customer', 'Stripe CustomerId']
const paymentRecordLinkFields = ['Checkout URL', 'Payment URL', 'Payment Link', 'Portal URL']

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

function resolveResidentPaymentUrl(resident, payments = []) {
  return (
    firstAvailableLink(resident, residentPaymentFields) ||
    payments.map((p) => firstAvailableLink(p, paymentRecordLinkFields)).find(Boolean) ||
    import.meta.env.VITE_RESIDENT_PAYMENT_URL || ''
  )
}

function getResidentStripeCustomerId(resident, payments = []) {
  return (
    firstAvailableLink(resident, stripeCustomerFields) ||
    payments.map((p) => firstAvailableLink(p, stripeCustomerFields)).find(Boolean) || ''
  )
}

function getPaymentKind(payment) {
  const raw = [payment.Type, payment.Category, payment.Kind, payment['Line Item Type'], payment.Month, payment.Notes]
    .filter(Boolean).join(' ').toLowerCase()
  if (/(fee|fine|damage|late fee|late charge|cleaning|lockout)/.test(raw)) return 'fee'
  return 'rent'
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
          <li className="flex gap-2"><span className="font-bold text-axis">2.</span> Under <strong>Base access</strong>, add the AXIS Forms base (<code className="rounded bg-slate-100 px-1 text-xs">appNBX2inqfJMyqYV</code>)</li>
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

  async function handleLogin(event) {
    event.preventDefault()
    setSignInLoading(true)
    setSignInError('')
    try {
      const resident = await loginResident(signInForm.email.trim(), signInForm.password)
      if (!resident) {
        setSignInError('Invalid email or password. Contact Axis if you need help.')
        return
      }
      if (resident.Approved !== true) {
        setSignInError('Your application is still under review. You\'ll be able to log in once a manager approves it. Contact Axis if you have questions.')
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
      if (app.Approved !== true) {
        setActivationError('Your application hasn\'t been approved yet. A manager needs to review and approve it before you can create your account. Check back soon or contact Axis.')
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
          Approved: true,
          'Lease Term': existing['Lease Term'] || app['Lease Term'] || '',
        }
        if (applicationLink && !(Array.isArray(existing.Applications) && existing.Applications.length)) {
          patch.Applications = applicationLink
        }
        if (app['Application ID'] != null && existing['Application ID'] == null) {
          patch['Application ID'] = app['Application ID']
        }
        const resident = await updateResident(existing.id, patch)
        onLogin(resident)
        return
      }
      const resident = await createResident({
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
        Approved: true,
        ...(applicationLink ? { Applications: applicationLink } : {}),
        ...(app['Application ID'] != null ? { 'Application ID': app['Application ID'] } : {}),
      })
      onLogin(resident)
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
          onChange={(id) => { setTab(id); setSignInError(''); setActivationError('') }}
        />
      ) : null}

      {tab === 'signin' ? (
        <form onSubmit={handleLogin} className={showSignInActivateTabs ? 'mt-6 space-y-4' : 'mt-0 space-y-4'}>
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
                onClick={() => { setTab('activate'); setSignInError(''); setActivationError('') }}
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
                onClick={() => { setTab('signin'); setSignInError(''); setActivationError('') }}
                className="text-sm font-semibold text-[#2563eb] hover:text-slate-900"
              >
                ← Back to sign in
              </button>
            </div>
          ) : null}
          <PortalNotice>
            Use the email and Application ID from your approved application.{' '}
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

function PortalEntryLogin({ onLogin }) {
  const navigate = useNavigate()
  const [portalType, setPortalType] = useState('resident')
  const isResident = portalType === 'resident'

  function handleManagerLogin(manager) {
    sessionStorage.setItem(MANAGER_SESSION_KEY, JSON.stringify(manager))
    navigate('/manager')
  }

  return (
    <PortalAuthPage>
      <PortalAuthCard title={isResident ? 'Resident portal' : 'Manager portal'}>
        <PortalSegmentedControl
          tabs={[
            ['resident', 'Resident portal'],
            ['manager', 'Manager portal'],
          ]}
          active={portalType}
          onChange={setPortalType}
        />
        <div className="mt-6">
          {isResident ? (
            <ResidentAuthForm onLogin={onLogin} variant="portal-entry" />
          ) : (
            <ManagerAuthForm onLogin={handleManagerLogin} variant="portal-entry" />
          )}
        </div>
      </PortalAuthCard>
    </PortalAuthPage>
  )
}

// ─── Work Orders ──────────────────────────────────────────────────────────────

function RequestThread({ workOrder, residentEmail, onThreadUpdated }) {
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)

  const loadMessages = useCallback(async () => {
    const next = await getMessages(workOrder.id)
    setMessages(next)
  }, [workOrder.id])

  useEffect(() => { loadMessages() }, [loadMessages])

  async function handleSend(event) {
    event.preventDefault()
    if (!draft.trim()) return
    const text = draft.trim()
    setSending(true)
    try {
      await sendMessage({ workOrderId: workOrder.id, senderEmail: residentEmail, message: text })
      setDraft('')
      try {
        await appendWorkOrderUpdateFromResident(workOrder.id, residentEmail, text)
      } catch (syncErr) {
        console.warn('[work order] Update field sync skipped:', syncErr?.message || syncErr)
      }
      await loadMessages()
      onThreadUpdated?.()
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="mt-4 rounded-[24px] border border-slate-200 bg-slate-50 p-4">
      <div className="space-y-3">
        {messages.length === 0 ? (
          <p className="text-sm text-slate-400">No updates yet.</p>
        ) : (
          messages.map((msg) => {
            const isAdmin = Boolean(msg['Is Admin'])
            return (
              <div key={msg.id} className={classNames('flex', isAdmin ? 'justify-start' : 'justify-end')}>
                <div className={classNames(
                  'max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6',
                  isAdmin ? 'rounded-tl-sm bg-white text-slate-800' : 'rounded-tr-sm bg-slate-900 text-white'
                )}>
                  <div className={classNames('mb-1 text-[11px] font-bold uppercase tracking-[0.18em]', isAdmin ? 'text-slate-400' : 'text-white/55')}>
                    {isAdmin ? 'Axis Team' : 'You'}
                  </div>
                  <p>{msg.Message}</p>
                  <div className={classNames('mt-2 text-[11px]', isAdmin ? 'text-slate-400' : 'text-white/55')}>
                    {formatDate(msg.Timestamp || msg.created_at)}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
      <form onSubmit={handleSend} className="mt-4 flex gap-2">
        <input value={draft} onChange={(e) => setDraft(e.target.value)}
          placeholder="Send an update or reply..."
          className="flex-1 rounded-full border border-slate-200 px-4 py-2.5 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10" />
        <button type="submit" disabled={sending || !draft.trim()}
          className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50">
          Send
        </button>
      </form>
    </div>
  )
}

function WorkOrdersPanel({ resident, requests, onRequestCreated, onWorkOrderUpdated }) {
  const [showForm, setShowForm] = useState(false)
  const [expandedId, setExpandedId] = useState(null)
  const [form, setForm] = useState({
    title: '', category: requestCategories[0], urgency: urgencyOptions[0],
    preferredEntry: entryOptions[0], description: '',
  })
  const [photo, setPhoto] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

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
        resident, title: form.title, category: form.category,
        urgency: form.urgency, preferredEntry: form.preferredEntry,
        description: form.description, photoFile: photo || null,
      })
      setForm({ title: '', category: requestCategories[0], urgency: urgencyOptions[0], preferredEntry: entryOptions[0], description: '' })
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
    <SectionCard
      title="Work Orders"
      description="Submit and track requests. Resolved items stay here for 7 days after the last update date in Airtable."
      action={
        <button type="button"
          onClick={() => { setShowForm((v) => !v); setError(''); setSuccess('') }}
          className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-500">
          {showForm ? 'Cancel' : '+ New request'}
        </button>
      }
    >
      {showForm && (
        <form onSubmit={handleSubmit} className="mb-8 grid gap-4 border-b border-slate-100 pb-8 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-2 block text-sm font-semibold text-slate-700">Issue Title</label>
            <input required value={form.title}
              onChange={(e) => setForm((c) => ({ ...c, title: e.target.value }))}
              className={fieldCls} placeholder="Kitchen sink leaking" />
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Category</label>
            <select value={form.category} onChange={(e) => setForm((c) => ({ ...c, category: e.target.value }))} className={fieldCls}>
              {requestCategories.map((o) => <option key={o}>{o}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Urgency</label>
            <select value={form.urgency} onChange={(e) => setForm((c) => ({ ...c, urgency: e.target.value }))} className={fieldCls}>
              {urgencyOptions.map((o) => <option key={o}>{o}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="mb-2 block text-sm font-semibold text-slate-700">Description</label>
            <textarea required rows={4} value={form.description}
              onChange={(e) => setForm((c) => ({ ...c, description: e.target.value }))}
              className={fieldCls} placeholder="Describe the issue and its location." />
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Preferred Entry</label>
            <select value={form.preferredEntry} onChange={(e) => setForm((c) => ({ ...c, preferredEntry: e.target.value }))} className={fieldCls}>
              {entryOptions.map((o) => <option key={o}>{o}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Photo (optional)</label>
            <label className="flex min-h-[112px] cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-center transition hover:border-slate-900">
              <span className="text-sm font-semibold text-slate-700">{photo ? photo.name : 'Upload photo'}</span>
              <span className="mt-1 text-xs text-slate-400">JPG, PNG, or HEIC · max 10 MB</span>
              <input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] || null)} className="hidden" />
            </label>
          </div>
          {success ? <div className="sm:col-span-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{success}</div> : null}
          {error ? <div className="sm:col-span-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
          <div className="sm:col-span-2">
            <button type="submit" disabled={submitting}
              className="rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50">
              {submitting ? 'Submitting...' : 'Submit request'}
            </button>
          </div>
        </form>
      )}

      {requests.length === 0 && !showForm ? (
        <div className="flex flex-col items-center gap-4 py-12 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-2xl">📋</div>
          <div>
            <p className="text-base font-semibold text-slate-900">No work orders yet</p>
            <p className="mt-1 text-sm text-slate-500">Submit a request and it'll appear here with status updates.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {requests.map((request) => {
            const status = request.Status || 'Submitted'
            const priority = request.Priority || 'Routine'
            const notes = request['Management Notes']
            const photo = Array.isArray(request.Photo) ? request.Photo[0] : null
            const isExpanded = expandedId === request.id
            const resolved = isWorkOrderResolved(request)
            const appId = request['Application ID']
            const updateLog = request.Update || request['Latest Update']
            const resolutionSummary = request['Resolution Summary']

            return (
              <div key={request.id} className="rounded-[24px] border border-slate-200 p-5 transition hover:border-slate-300">
                <button type="button"
                  onClick={() => setExpandedId((c) => c === request.id ? null : request.id)}
                  className="w-full text-left">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-bold text-slate-900">{request.Title}</h3>
                        <span className={classNames('rounded-full border px-2.5 py-1 text-[11px] font-semibold', statusStyles[status] || statusStyles.Submitted)}>{status}</span>
                        <span className={classNames('rounded-full border px-2.5 py-1 text-[11px] font-semibold', priorityStyles[priority] || priorityStyles.Routine)}>{priority}</span>
                        {resolved ? (
                          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">Resolved</span>
                        ) : null}
                      </div>
                      <p className="mt-1.5 text-sm leading-6 text-slate-500">{request.Description}</p>
                      {appId != null && String(appId).trim() !== '' ? (
                        <p className="mt-2 text-xs font-medium text-slate-400">Application ID: {String(appId)}</p>
                      ) : null}
                    </div>
                    <div className="text-right text-xs text-slate-400">
                      <div>{request.Category}</div>
                      <div className="mt-1">{formatDate(request['Date Submitted'] || request.created_at)}</div>
                    </div>
                  </div>
                </button>

                {resolutionSummary && resolved ? (
                  <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                    <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-700">Resolution summary</div>
                    <div className="mt-1 whitespace-pre-wrap text-sm leading-6 text-emerald-900">{resolutionSummary}</div>
                  </div>
                ) : null}

                {updateLog ? (
                  <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Update log</div>
                    <div className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{updateLog}</div>
                  </div>
                ) : null}

                {notes ? (
                  <div className="mt-3 rounded-2xl bg-slate-50 px-4 py-3">
                    <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Management Notes</div>
                    <div className="mt-1 text-sm text-slate-600">{notes}</div>
                  </div>
                ) : null}

                {photo?.url ? (
                  <div className="mt-3">
                    <a href={photo.url} target="_blank" rel="noreferrer"
                      className="inline-flex rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-500">
                      View attached photo
                    </a>
                  </div>
                ) : null}

                {isExpanded ? (
                  <RequestThread
                    workOrder={request}
                    residentEmail={resident.Email}
                    onThreadUpdated={onWorkOrderUpdated}
                  />
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </SectionCard>
  )
}

// ─── Announcements ────────────────────────────────────────────────────────────

function AnnouncementsPanel({ items }) {
  return (
    <SectionCard title="Announcements" description="Updates from the Axis team.">
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">No announcements right now.</p>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <div key={item.id} className="rounded-[24px] border border-slate-200 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-bold text-slate-900">{item.Title}</h3>
                {item.Pinned ? (
                  <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700">Pinned</span>
                ) : null}
                {item.Priority ? (
                  <span className={classNames('rounded-full border px-2.5 py-1 text-[11px] font-semibold', priorityStyles[item.Priority] || priorityStyles.Routine)}>
                    {item.Priority}
                  </span>
                ) : null}
              </div>
              {item['Short Summary'] ? <p className="mt-2 text-sm font-medium text-slate-500">{item['Short Summary']}</p> : null}
              <p className="mt-2 text-sm leading-7 text-slate-600">{item.Message}</p>
              <div className="mt-2 text-xs text-slate-400">{formatDate(item['Start Date'] || item['Date Posted'] || item.CreatedAt)}</div>
              {item['CTA Text'] && item['CTA Link'] ? (
                <a href={item['CTA Link']} target="_blank" rel="noreferrer"
                  className="mt-3 inline-flex rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-500">
                  {item['CTA Text']}
                </a>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
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

function PaymentsPanel({ resident, onResidentUpdated, highlightCategory }) {
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

  const unpaidPayments = payments.filter((p) => p.Status !== 'Paid')
  const outstanding = unpaidPayments.reduce((sum, p) => sum + (Number(p.Amount) || 0), 0)
  const rentPayments = unpaidPayments.filter((p) => getPaymentKind(p) === 'rent')
  const feePayments = unpaidPayments.filter((p) => getPaymentKind(p) === 'fee')
  const nextDue = rentPayments[0] || unpaidPayments.find((p) => p.Status === 'Pending' || p.Status === 'Overdue')
  const feesDue = feePayments.reduce((sum, p) => sum + (Number(p.Amount) || 0), 0)
  const paymentUrl = useMemo(() => resolveResidentPaymentUrl(resident, payments), [resident, payments])
  const stripeCustomerId = useMemo(() => getResidentStripeCustomerId(resident, payments), [resident, payments])
  const fallbackRentAmount = useMemo(() => getRoomMonthlyRent(resident.House, resident['Unit Number']), [resident])
  const utilitiesAmount = useMemo(() => getUtilitiesFee(resident.House), [resident])
  const effectiveNextDue = nextDue || (fallbackRentAmount > 0 ? {
    Amount: fallbackRentAmount, Month: 'Current rent',
    Notes: 'Calculated from your current house and room assignment.',
  } : null)
  const leaseExtensionAmount = fallbackRentAmount + utilitiesAmount

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
      setPayments(refreshed)
      onResidentUpdated?.()
    } catch (err) {
      setActionError(err.message || 'Payment completed, but refreshing the balance failed.')
    } finally {
      setLoading(false)
    }
  }

  async function openPortal() {
    if (!stripeCustomerId) {
      if (paymentUrl) { window.location.href = paymentUrl; return }
      setActionError('A Stripe customer ID is needed before the billing portal can open.')
      return
    }
    setActionError('')
    setActionLoading('portal')
    try {
      const response = await fetch('/api/stripe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'portal', customerId: stripeCustomerId }),
      })
      const data = await readJsonResponse(response)
      if (!response.ok) throw new Error(data.error || 'Unable to open customer portal.')
      window.location.href = data.url
    } catch (err) {
      setActionError(err.message || 'Unable to open the billing portal.')
    } finally {
      setActionLoading('')
    }
  }

  return (
    <SectionCard title="Payments" description="Pay rent, clear fees, and review your payment history.">
      {loading ? <p className="text-sm text-slate-400">Loading payments...</p> : null}
      {!loading && (
        <>
          {error ? (
            <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Payment history could not be loaded right now, but checkout is still available below.
            </div>
          ) : null}

          <div className="rounded-[24px] border border-slate-200 bg-[linear-gradient(135deg,#ffffff_0%,#f8fafc_100%)] p-6">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Current Due</div>
                <div className="mt-3 text-4xl font-black tracking-tight text-slate-900">
                  {effectiveNextDue ? formatMoney(effectiveNextDue.Amount) : '$0'}
                </div>
                <div className="mt-2 text-sm leading-6 text-slate-500">
                  {effectiveNextDue
                    ? `${effectiveNextDue.Month || 'Current rent'}${effectiveNextDue['Due Date'] ? ` · Due ${formatDate(effectiveNextDue['Due Date'])}` : ''}`
                    : 'No rent currently due'}
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <button type="button"
                  disabled={!effectiveNextDue || actionLoading === 'rent'}
                  onClick={() => launchCheckout({
                    amount: Number(effectiveNextDue?.Amount || 0),
                    description: effectiveNextDue?.Month ? `Rent payment - ${effectiveNextDue.Month}` : 'Rent payment',
                    category: 'rent', paymentRecordId: effectiveNextDue?.id,
                  })}
                  className="rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">
                  {actionLoading === 'rent' ? 'Opening...' : 'Pay rent'}
                </button>
                <button type="button"
                  disabled={actionLoading === 'portal'}
                  onClick={openPortal}
                  className="rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-500 disabled:opacity-50">
                  {actionLoading === 'portal' ? 'Opening...' : 'Billing portal'}
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Outstanding Balance</div>
                <div className={classNames('mt-2 text-2xl font-black', outstanding > 0 ? 'text-red-600' : 'text-emerald-600')}>
                  {outstanding > 0 ? `$${outstanding.toLocaleString()}` : '$0'}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Next Due</div>
                <div className="mt-2 text-lg font-black text-slate-900">
                  {effectiveNextDue ? effectiveNextDue.Month || formatDate(effectiveNextDue['Due Date']) : '—'}
                </div>
                {effectiveNextDue?.['Due Date'] && <div className="mt-0.5 text-xs text-slate-400">{formatDate(effectiveNextDue['Due Date'])}</div>}
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Payment Records</div>
                <div className="mt-2 text-lg font-black text-slate-900">{payments.length}</div>
                <div className="mt-0.5 text-xs text-slate-400">{feePayments.length} open fee item{feePayments.length === 1 ? '' : 's'}</div>
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-[24px] border border-slate-200 bg-white p-5">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Other Fees & Fines</div>
              <h3 className="mt-2 text-xl font-black text-slate-900">{formatMoney(feesDue)}</h3>
              <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
                <div className="text-sm text-slate-500">
                  {feePayments.length > 0 ? `${feePayments.length} open item${feePayments.length === 1 ? '' : 's'}` : 'No open fees or fines'}
                </div>
                <button type="button"
                  disabled={feesDue <= 0 || actionLoading === 'fees'}
                  onClick={() => launchCheckout({
                    amount: feesDue, description: 'Resident fees and fines',
                    category: 'fees', paymentRecordId: feePayments.map((p) => p.id).join(','),
                  })}
                  className="rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-500 disabled:opacity-50">
                  {actionLoading === 'fees' ? 'Opening...' : 'Pay fees'}
                </button>
              </div>
              {feePayments.length > 0 ? (
                <div className="mt-4 space-y-2">
                  {feePayments.slice(0, 4).map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-4 py-3">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">{p.Month || p.Type || 'Fee'}</div>
                        {p.Notes ? <div className="mt-0.5 text-xs text-slate-400">{p.Notes}</div> : null}
                      </div>
                      <div className="text-sm font-bold text-slate-900">{formatMoney(p.Amount)}</div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className={classNames(
              'rounded-[24px] border bg-slate-50 p-5 transition',
              highlightCategory === 'extension' ? 'border-axis/50 ring-2 ring-axis/20' : 'border-slate-200'
            )}>
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Lease Extension</div>
              <h3 className="mt-2 text-xl font-black text-slate-900">{formatMoney(leaseExtensionAmount)}</h3>
              <p className="mt-3 text-sm leading-6 text-slate-500">
                Continue your lease by paying the next month of rent and utilities.
              </p>
              <div className="mt-4 space-y-2 rounded-2xl bg-white px-4 py-4 text-sm text-slate-600">
                <div className="flex items-center justify-between gap-3">
                  <span>Next month rent</span>
                  <span className="font-semibold text-slate-900">{formatMoney(fallbackRentAmount)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>Utilities</span>
                  <span className="font-semibold text-slate-900">{formatMoney(utilitiesAmount)}</span>
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-2">
                  <span className="font-semibold text-slate-900">Total due</span>
                  <span className="text-base font-black text-slate-900">{formatMoney(leaseExtensionAmount)}</span>
                </div>
              </div>
              <button type="button"
                disabled={leaseExtensionAmount <= 0 || actionLoading === 'extension'}
                onClick={() => launchCheckout({
                  amount: leaseExtensionAmount,
                  items: [
                    { name: 'Next month rent', amount: fallbackRentAmount },
                    { name: 'Utilities', amount: utilitiesAmount },
                  ].filter((i) => i.amount > 0),
                  description: 'Lease extension payment',
                  category: 'extension',
                })}
                className="mt-4 rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50">
                {actionLoading === 'extension' ? 'Opening...' : 'Pay to extend lease'}
              </button>
              <div className="mt-3 text-xs text-slate-400">
                {resident.Email} · {[resident.House, resident['Unit Number']].filter(Boolean).join(' · ') || 'House / unit not set'}
              </div>
            </div>
          </div>

          {actionError ? (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{actionError}</div>
          ) : null}

          {payments.length === 0 ? (
            <p className="mt-6 text-sm text-slate-400">No payment records yet. Contact Axis if you have questions about your balance.</p>
          ) : (
            <div className="mt-6 space-y-3">
              {payments.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 px-4 py-3">
                  <div>
                    <div className="font-semibold text-slate-900">{p.Month || 'Payment'}</div>
                    {p.Notes && <div className="mt-0.5 text-xs text-slate-400">{p.Notes}</div>}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-sm font-bold text-slate-900">${Number(p.Amount || 0).toLocaleString()}</div>
                    <span className={classNames('rounded-full border px-2.5 py-1 text-[11px] font-semibold', paymentStatusStyles[p.Status] || paymentStatusStyles.Pending)}>
                      {p.Status || 'Pending'}
                    </span>
                    {p['Paid Date'] && <div className="text-xs text-slate-400">Paid {formatDate(p['Paid Date'])}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}

          <EmbeddedStripeCheckout
            open={Boolean(embeddedCheckout)}
            title={embeddedCheckout?.title || 'Secure Payment'}
            checkoutRequest={embeddedCheckout?.request}
            onClose={handleEmbeddedCheckoutClose}
            onComplete={handleEmbeddedCheckoutComplete}
          />
        </>
      )}
    </SectionCard>
  )
}

// ─── Leasing ──────────────────────────────────────────────────────────────────

function LeasingPanel({ resident, onOpenPayments }) {
  const leaseTermLabel = getLeaseTermLabel(resident)
  const isMonthToMonth = leaseTermLabel.toLowerCase().includes('month-to-month')
  const leaseSigningUrl = resolveLeaseSigningUrl(resident)
  const moveInLabel = resident['Lease Start Date'] ? formatDate(resident['Lease Start Date']) : '—'
  const moveOutLabel = resident['Lease End Date'] ? formatDate(resident['Lease End Date']) : (isMonthToMonth ? 'No fixed end date' : '—')
  const leaseDepositPaid = Boolean(resident['Security Deposit Paid'] || resident['Deposit Paid'])
  const signedLeaseNote = String(resident['Security Deposit Paid Date'] || resident['Deposit Paid Date'] || '').trim()

  const [approvedLease, setApprovedLease] = useState(null)
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
    getApprovedLeaseForResident(resident.id)
      .then((lease) => { if (!cancelled) setApprovedLease(lease) })
      .catch(() => {})
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
      } catch (err) {
        if (!cancelled) setDepositError(err.message || 'Could not load the deposit amount.')
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

  const leaseContent = approvedLease?.['Manager Edited Content'] || approvedLease?.['AI Draft Content'] || ''
  const leaseStatus = approvedLease?.['Status']
  const leasePreview = leaseContent || `Axis Resident Lease\n\nProperty: ${resident.House || '—'}\nUnit: ${resident['Unit Number'] || '—'}\nTerm: ${leaseTermLabel}\nMove-in: ${moveInLabel}\nMove-out: ${moveOutLabel}\nSecurity Deposit: ${houseDeposit ? formatMoney(houseDeposit) : '—'}\n\nThis is a placeholder lease document for now. Your final document will appear here for review and signature.`

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

        <div className="rounded-[24px] border border-[#2563eb]/20 bg-[linear-gradient(135deg,#eff6ff_0%,#ffffff_100%)] p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#2563eb]">Lease Document</div>
              <h3 className="mt-2 text-xl font-black text-slate-900">Placeholder lease</h3>
            </div>
            <button
              type="button"
              onClick={() => setShowLeaseText((v) => !v)}
              className="shrink-0 rounded-full bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-105"
            >
              {showLeaseText ? 'Hide' : 'View lease'}
            </button>
          </div>
          {showLeaseText && (
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

        {depositError ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{depositError}</div>
        ) : null}

        <div className="rounded-[24px] border border-slate-200 bg-white p-5">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Security Deposit</div>
          <h3 className="mt-2 text-xl font-black text-slate-900">
            {depositLoading ? 'Loading…' : (houseDeposit ? formatMoney(houseDeposit) : 'Not set')}
          </h3>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            Pay the security deposit first. Once it’s marked paid, lease signing unlocks automatically.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
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
              disabled={depositLoading || !houseDeposit || depositPaidState || depositCheckoutLoading}
              className="rounded-full bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] px-5 py-3 text-sm font-semibold text-white transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {depositPaidState ? 'Deposit paid' : 'Pay deposit'}
            </button>
            {depositPaidState ? (
              <div className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
                Paid{signedLeaseNote ? ` · ${formatDate(signedLeaseNote)}` : ''}
              </div>
            ) : null}
          </div>
        </div>

        <div className="rounded-[24px] border border-slate-200 bg-white p-5">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Lease Signing</div>
          <h3 className="mt-2 text-xl font-black text-slate-900">Review & Sign</h3>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            {depositPaidState
              ? 'Your deposit is paid, so lease signing is unlocked.'
              : 'Pay the security deposit first. Signing stays locked until the deposit is marked paid.'}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {depositPaidState && leaseSigningUrl ? (
              <button type="button" onClick={() => { window.location.href = leaseSigningUrl }}
                className="rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-500">
                Open DocuSign
              </button>
            ) : (
              <div className="text-sm text-slate-400">
                {depositPaidState ? 'Signing link will appear here once prepared.' : 'Deposit required before signing.'}
              </div>
            )}
            <button type="button" onClick={() => onOpenPayments('extension')}
              className="rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800">
              Payments
            </button>
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

// ─── Contact (leasing messages in-app; tour still on /contact) ───────────────

function ContactPanel({ resident }) {
  const prefill = useMemo(
    () => ({
      name: resident.Name || '',
      email: resident.Email || '',
      phone: resident['Phone Number'] || resident.Phone || '',
      house: resident.House || '',
      unitNumber: resident['Unit Number'] || '',
    }),
    [resident],
  )

  return (
    <div className="space-y-8">
      <SectionCard
        title="Message leasing"
        description="Send a message to the leasing team from here — same inbox as the main contact page. Your name, email, and home are filled in when we can match them."
      >
        <HousingMessageForm variant="resident" prefill={prefill} formIdPrefix="resident-housing-msg" />
      </SectionCard>

      <div className="rounded-[24px] border border-slate-200 bg-white px-5 py-4 text-sm leading-6 text-slate-600 shadow-soft sm:px-6">
        <span className="font-semibold text-slate-800">Tours:</span>{' '}
        <Link
          to={HOUSING_CONTACT_SCHEDULE}
          className="font-semibold text-axis underline decoration-axis/30 underline-offset-2 transition hover:decoration-axis"
        >
          Schedule a tour
        </Link>
        {' '}on the contact page (in person or virtual).
      </div>

      <div className="rounded-[18px] border border-slate-100 bg-slate-50/70 px-4 py-3 text-sm leading-6 text-slate-600">
        <span className="font-semibold text-slate-800">Work orders &amp; rent:</span>{' '}
        use <strong>Work Orders</strong> and <strong>Payments</strong> in this portal — not this form.
      </div>
    </div>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function Dashboard({ resident, onResidentUpdated, onSignOut }) {
  const [tab, setTab] = useState('workorders')
  const [paymentFocus, setPaymentFocus] = useState('')
  const [requests, setRequests] = useState([])
  const [announcements, setAnnouncements] = useState([])
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
      const [nextRequests, nextAnnouncements] = await Promise.all([
        getWorkOrdersForResident(resident).catch(() => []),
        getAnnouncements().catch(() => []),
      ])
      setRequests(nextRequests)
      setAnnouncements(nextAnnouncements.filter((item) => announcementMatchesResident(item, resident)))
    } finally {
      setLoading(false)
    }
  }, [resident])

  useEffect(() => {
    loadData()
    const interval = setInterval(async () => {
      try {
        const next = await getAnnouncements()
        setAnnouncements(next.filter((item) => announcementMatchesResident(item, resident)))
      } catch {}
    }, 60_000)
    return () => clearInterval(interval)
  }, [loadData, resident])

  const TABS = [
    ['workorders', 'Work Orders'],
    ['leasing', 'Leasing'],
    ['payments', 'Payments'],
    ['announcements', 'Announcements'],
    ['contact', 'Contact'],
    ['profile', 'Profile'],
  ]

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_55%,#f8fafc_100%)]">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-6">
          <div>
            <div className="text-sm font-semibold text-slate-900">{homeLabel}</div>
            <div className="mt-0.5 text-sm text-slate-400">{resident.Email}</div>
          </div>
          <button type="button" onClick={onSignOut}
            className="rounded-full border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-500">
            Sign out
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-8">
          <h1 className="text-4xl font-black tracking-tight text-slate-900">
            Welcome back, {resident.Name || 'Resident'}
          </h1>
          <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-500">
            <span>
              {getLeaseTermLabel(resident)}
              {resident['Lease End Date'] ? ` · through ${formatDate(resident['Lease End Date'])}` : ''}
            </span>
            {openRequestCount > 0 ? (
              <span className="font-semibold text-sky-600">{openRequestCount} open work order{openRequestCount === 1 ? '' : 's'}</span>
            ) : null}
          </div>
        </div>

        <div className="mb-6 flex flex-wrap gap-2 rounded-[24px] border border-slate-200 bg-white p-2 shadow-soft">
          {TABS.map(([id, label]) => (
            <button key={id} type="button" onClick={() => setTab(id)}
              className={classNames(
                'rounded-[18px] px-4 py-3 text-sm font-semibold transition',
                tab === id ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
              )}>
              <span className="inline-flex items-center gap-2">
                <span>{label}</span>
                {id === 'announcements' && announcements.length > 0 && tab !== id ? (
                  <span className="h-2 w-2 rounded-full bg-axis" />
                ) : null}
              </span>
            </button>
          ))}
        </div>

        {loading ? (
          <div className="rounded-[28px] border border-slate-200 bg-white px-6 py-16 text-center text-sm text-slate-400 shadow-soft">
            Loading...
          </div>
        ) : null}

        {!loading && tab === 'workorders' ? (
          <WorkOrdersPanel
            resident={resident}
            requests={visibleWorkOrders}
            onRequestCreated={loadData}
            onWorkOrderUpdated={loadData}
          />
        ) : null}
        {!loading && tab === 'leasing' ? (
          <LeasingPanel resident={resident} onOpenPayments={(focus = '') => { setPaymentFocus(focus); setTab('payments') }} />
        ) : null}
        {!loading && tab === 'payments' ? (
          <PaymentsPanel resident={resident} onResidentUpdated={onResidentUpdated} highlightCategory={paymentFocus} />
        ) : null}
        {!loading && tab === 'announcements' ? (
          <AnnouncementsPanel items={announcements} />
        ) : null}
        {!loading && tab === 'contact' ? <ContactPanel resident={resident} /> : null}
        {!loading && tab === 'profile' ? (
          <ProfilePanel resident={resident} onUpdated={onResidentUpdated} />
        ) : null}
      </div>
    </div>
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
      .then((r) => { if (mounted && r) setResident(r) })
      .catch(() => { sessionStorage.removeItem(SESSION_KEY) })
      .finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [])

  function handleLogin(r) {
    sessionStorage.setItem(SESSION_KEY, r.id)
    setResident(r)
  }

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
  if (!resident) return <PortalEntryLogin onLogin={handleLogin} />

  return (
    <Dashboard
      resident={resident}
      onResidentUpdated={setResident}
      onSignOut={handleSignOut}
    />
  )
}

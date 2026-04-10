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

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import toast from 'react-hot-toast'
import { HOUSING_CONTACT_MESSAGE } from '../lib/housingSite'
import { readJsonResponse } from '../lib/readJsonResponse'
import { getWorkOrderById, updateWorkOrder } from '../lib/airtable'
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

// ─── Session ──────────────────────────────────────────────────────────────────
export const MANAGER_SESSION_KEY = 'axis_manager'
const MANAGER_ONBOARDING_KEY = 'axis_manager_onboarding'

// ─── Records API config — same base as the rest of the portal ────────────────
const AIRTABLE_TOKEN = import.meta.env.VITE_AIRTABLE_TOKEN
const BASE_ID = import.meta.env.VITE_AIRTABLE_APPLICATIONS_BASE_ID || 'appNBX2inqfJMyqYV'
const AIRTABLE_BASE_URL = `https://api.airtable.com/v0/${BASE_ID}`

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

const DEFAULT_AXIS_PROPERTIES = [
  '4709A 8th Ave NE',
  '4709B 8th Ave NE',
  '5259 Brooklyn Ave NE',
]

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

function classNames(...values) {
  return values.filter(Boolean).join(' ')
}

const TOUR_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const TOUR_SLOTS = ['9:00 AM', '10:30 AM', '12:00 PM', '1:30 PM', '3:00 PM', '4:30 PM', '6:00 PM']

async function atRequest(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { ...atHeaders(), ...(options.headers || {}) } })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(body)
  }
  return res.json()
}

// ─── Data layer ───────────────────────────────────────────────────────────────

async function fetchLeaseDrafts({ status, property, resident } = {}) {
  const url = new URL(`${AIRTABLE_BASE_URL}/Lease%20Drafts`)
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
  const url = new URL(`${AIRTABLE_BASE_URL}/Applications`)
  if (property) {
    url.searchParams.set('filterByFormula', `FIND("${property.replace(/"/g, '\\"')}", {Property Name}) > 0`)
  }
  url.searchParams.set('sort[0][field]', 'Created')
  url.searchParams.set('sort[0][direction]', 'desc')
  const data = await atRequest(url.toString())
  return (data.records || []).map(mapRecord)
}

async function patchApplication(recordId, fields) {
  const data = await atRequest(`${AIRTABLE_BASE_URL}/Applications/${recordId}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields, typecast: true }),
  })
  return mapRecord(data)
}

async function fetchLeaseDraft(recordId) {
  const data = await atRequest(`${AIRTABLE_BASE_URL}/Lease%20Drafts/${recordId}`)
  return mapRecord(data)
}

async function patchLeaseDraft(recordId, fields) {
  const data = await atRequest(`${AIRTABLE_BASE_URL}/Lease%20Drafts/${recordId}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields, typecast: true }),
  })
  return mapRecord(data)
}

async function fetchPropertiesAdmin() {
  const data = await atRequest(`${AIRTABLE_BASE_URL}/Properties`)
  return (data.records || []).map(mapRecord)
}

async function createPropertyAdmin(fields) {
  const data = await atRequest(`${AIRTABLE_BASE_URL}/Properties`, {
    method: 'POST',
    body: JSON.stringify({ fields, typecast: true }),
  })
  return mapRecord(data)
}

async function updatePropertyAdmin(recordId, fields) {
  const data = await atRequest(`${AIRTABLE_BASE_URL}/Properties/${recordId}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields, typecast: true }),
  })
  return mapRecord(data)
}

async function fetchAuditLog(leaseDraftId) {
  const formula = encodeURIComponent(`{Lease Draft ID} = "${leaseDraftId}"`)
  const url = `${AIRTABLE_BASE_URL}/Audit%20Log?filterByFormula=${formula}&sort[0][field]=Timestamp&sort[0][direction]=asc`
  const data = await atRequest(url)
  return (data.records || []).map(mapRecord)
}

// Log an action to the Audit Log table — failures are non-fatal
async function logAudit({ leaseDraftId, actionType, performedBy, performedByRole, notes = '' }) {
  try {
    await atRequest(`${AIRTABLE_BASE_URL}/Audit%20Log`, {
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

function HouseManagementPanel({ onPropertiesChange }) {
  const [properties, setProperties] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editingPropertyId, setEditingPropertyId] = useState(null)
  const [form, setForm] = useState({
    name: '',
    address: '',
    utilitiesFee: '',
    securityDeposit: '',
  })
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

  async function handleSubmit(event) {
    event.preventDefault()
    setSaving(true)
    try {
      const created = await createPropertyAdmin({
        Name: form.name.trim(),
        Address: form.address.trim(),
        ...(form.utilitiesFee ? { 'Utilities Fee': Number(form.utilitiesFee) } : {}),
        ...(form.securityDeposit ? { 'Security Deposit': Number(form.securityDeposit) } : {}),
      })
      setProperties((current) => {
        const next = [created, ...current]
        onPropertiesChange?.(next)
        return next
      })
      setForm({ name: '', address: '', utilitiesFee: '', securityDeposit: '' })
      toast.success('House added')
    } catch (err) {
      toast.error('Could not add house: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

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
    setTourForm((current) => {
      const lines = String(current.availability || '')
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
      if (lineIndex >= 0) {
        nextLines[lineIndex] = nextValue
      } else {
        nextLines.push(nextValue)
      }
      return { ...current, availability: nextLines.filter(Boolean).join('\n') }
    })
  }

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
          Add internal property records for leasing and resident operations. Public marketing listings still use the website property dataset.
        </p>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-slate-700">House name</label>
            <input
              type="text"
              required
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              placeholder="4709C 8th Ave NE"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 transition focus:border-[#2563eb] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-slate-700">Address</label>
            <input
              type="text"
              value={form.address}
              onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))}
              placeholder="Full street address"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 transition focus:border-[#2563eb] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-slate-700">Utilities fee</label>
            <input
              type="number"
              min="0"
              step="1"
              value={form.utilitiesFee}
              onChange={(event) => setForm((current) => ({ ...current, utilitiesFee: event.target.value }))}
              placeholder="150"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 transition focus:border-[#2563eb] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-slate-700">Security deposit</label>
            <input
              type="number"
              min="0"
              step="1"
              value={form.securityDeposit}
              onChange={(event) => setForm((current) => ({ ...current, securityDeposit: event.target.value }))}
              placeholder="500"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 transition focus:border-[#2563eb] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20"
            />
          </div>
          <button
            type="submit"
            disabled={saving || !form.name.trim()}
            className="w-full rounded-2xl bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] px-5 py-3.5 text-sm font-semibold text-white shadow-[0_6px_18px_rgba(37,99,235,0.22)] transition hover:brightness-105 disabled:opacity-50"
          >
            {saving ? 'Adding house…' : 'Add house'}
          </button>
        </form>
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
        ) : properties.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-5 text-sm text-slate-500">No houses found yet.</div>
        ) : (
          <div className="mt-5 space-y-3">
            {properties.map((property) => (
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
                          setTourForm({ manager: '', availability: '', notes: '' })
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
function ManagerProfilePanel({ manager, onManagerUpdate }) {
  const [form, setForm] = useState({ name: manager.name || '', phone: manager.phone || '' })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [properties, setProperties] = useState([])
  const [propsLoading, setPropsLoading] = useState(true)

  useEffect(() => {
    fetchPropertiesAdmin()
      .then(setProperties)
      .catch(() => setProperties([]))
      .finally(() => setPropsLoading(false))
  }, [])

  async function handleSaveProfile(event) {
    event.preventDefault()
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
        <h2 className="mt-2 text-xl font-black text-slate-900">Plan overview</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {[
            { label: 'Role', value: manager.role || 'Manager' },
            { label: 'Manager ID', value: manager.managerId || '—' },
            { label: 'Properties', value: propsLoading ? '…' : `${properties.length} ${properties.length === 1 ? 'house' : 'houses'}` },
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
        <h2 className="mt-2 text-xl font-black text-slate-900">Managed addresses</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          All properties registered in the Axis operations system. To add or edit properties, go to House&nbsp;Management in the dashboard.
        </p>

        {propsLoading ? (
          <div className="mt-5 text-sm text-slate-500">Loading properties…</div>
        ) : properties.length === 0 ? (
          <div className="mt-5 rounded-2xl border border-slate-100 bg-slate-50 p-6 text-center text-sm text-slate-500">
            No properties added yet. Use House Management in the dashboard to add your first property.
          </div>
        ) : (
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {properties.map((p) => (
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

function ManagerOperationsPanel({ manager, propertyCount, onGenerateDraft, onOpenBilling }) {
  const cards = [
    {
      title: 'Add houses',
      body: 'Create internal property records for new homes you want to manage through Axis.',
      action: 'Go to house setup',
      onClick: () => {
        const target = document.getElementById('house-management')
        target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      },
    },
    {
      title: 'Generate leases',
      body: 'Start a new lease draft for an approved resident and move it into review.',
      action: 'Generate draft',
      onClick: onGenerateDraft,
    },
    {
      title: 'Manager subscription',
      body: 'Open billing to manage the recurring manager subscription connected to this portal.',
      action: 'Open billing',
      onClick: onOpenBilling,
    },
  ]

  return (
    <section className="mb-8 rounded-[28px] border border-slate-200 bg-white p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#2563eb]">Portal tools</div>
          <h2 className="mt-2 text-2xl font-black text-slate-900">Manager operations</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
            Use this portal to add houses, review applications through lease generation, manage leasing, and keep your manager subscription active.
          </p>
        </div>
        <div className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Manager</div>
          <div className="mt-1 text-sm font-semibold text-slate-900">{manager.name || manager.email}</div>
          <div className="mt-1 text-xs text-slate-500">
            {manager.managerId || 'Manager ID pending'} · {propertyCount} {propertyCount === 1 ? 'house' : 'houses'}
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {cards.map((card) => (
          <div key={card.title} className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
            <h3 className="text-lg font-black text-slate-900">{card.title}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-500">{card.body}</p>
            <button
              type="button"
              onClick={card.onClick}
              className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-[#2563eb] hover:text-[#2563eb]"
            >
              {card.action}
            </button>
          </div>
        ))}
      </div>
    </section>
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
                  <select value={form.property} onChange={set('property')} required className={inputCls}>
                    <option value="">Select property…</option>
                    {propertyOptions.map((property) => <option key={property} value={property}>{property}</option>)}
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

function WorkOrdersManagerPanel() {
  const [idInput, setIdInput] = useState('')
  const [record, setRecord] = useState(null)
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
    setResolved(r.Resolved === true || r.Resolved === 1 || r.Resolved === '1')
    setLastUpdate(workOrderLastUpdateToInput(r['Last Update']))
  }

  async function handleLoad() {
    const id = normalizeWorkOrderRecordId(idInput)
    setLoadError('')
    setRecord(null)
    if (!id) {
      setLoadError('Paste a work order record ID (rec…).')
      return
    }
    setLoading(true)
    try {
      const wo = await getWorkOrderById(id)
      setRecord(wo)
      applyRecordToForm(wo)
    } catch (err) {
      setLoadError(err.message || 'Could not load work order.')
    } finally {
      setLoading(false)
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
      toast.success('Work order saved')
    } catch (err) {
      toast.error(err.message || 'Could not save work order')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div id="work-orders" className="mb-8 scroll-mt-24 rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-black text-slate-900">Work orders</h2>
      <p className="mt-1 text-sm text-slate-500">
        Open a request by Airtable record ID (from the Work Orders table, starts with <code className="rounded bg-slate-100 px-1">rec</code>
        …), edit fields, then save.
      </p>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-400">Work order record ID</label>
          <input
            value={idInput}
            onChange={(e) => setIdInput(e.target.value)}
            placeholder="recXXXXXXXXXXXXXX"
            className={fieldCls}
          />
        </div>
        <button
          type="button"
          onClick={handleLoad}
          disabled={loading}
          className="shrink-0 rounded-2xl border border-slate-200 bg-slate-50 px-5 py-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-100 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Load'}
        </button>
      </div>

      {loadError ? (
        <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{loadError}</div>
      ) : null}

      {record ? (
        <form onSubmit={handleSave} className="mt-6 space-y-4 border-t border-slate-100 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Record</div>
              <div className="font-mono text-xs text-slate-600">{record.id}</div>
            </div>
            {record['Date Submitted'] || record.created_at ? (
              <div className="text-xs text-slate-400">
                Submitted {fmtDate(record['Date Submitted'] || record.created_at)}
              </div>
            ) : null}
          </div>

          <div>
            <div className="mb-1 text-xs font-semibold text-slate-500">Title</div>
            <div className="text-base font-bold text-slate-900">{record.Title || '—'}</div>
            {record.Description ? (
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">{record.Description}</p>
            ) : null}
          </div>

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
              rows={3}
              value={managementNotes}
              onChange={(e) => setManagementNotes(e.target.value)}
              className={fieldCls}
              placeholder="Internal / resident-visible notes from management"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-600">Update</label>
            <textarea
              rows={4}
              value={updateText}
              onChange={(e) => setUpdateText(e.target.value)}
              className={fieldCls}
              placeholder="Status update shown on the work order thread"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-600">Resolution summary</label>
            <textarea
              rows={3}
              value={resolutionSummary}
              onChange={(e) => setResolutionSummary(e.target.value)}
              className={fieldCls}
              placeholder="Summary when the request is resolved"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3">
              <input
                type="checkbox"
                checked={resolved}
                onChange={(e) => setResolved(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-[#2563eb] focus:ring-[#2563eb]"
              />
              <span className="text-sm font-semibold text-slate-800">Resolved</span>
            </label>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-600">Last update (date)</label>
              <input
                type="date"
                value={lastUpdate}
                onChange={(e) => setLastUpdate(e.target.value)}
                className={fieldCls}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="rounded-2xl bg-[#2563eb] px-6 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save work order'}
          </button>
        </form>
      ) : null}
    </div>
  )
}

// ─── ApplicationsPanel ────────────────────────────────────────────────────────
function ApplicationsPanel({ propertyOptions }) {
  const [applications, setApplications] = useState([])
  const [loading, setLoading] = useState(true)
  const [propertyFilter, setPropertyFilter] = useState('')
  const [approving, setApproving] = useState({}) // recordId -> 'approving' | 'rejecting'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setApplications(await fetchApplications({ property: propertyFilter }))
    } catch (err) {
      toast.error('Failed to load applications: ' + err.message)
    } finally {
      setLoading(false)
    }
  }, [propertyFilter])

  useEffect(() => { load() }, [load])

  async function handleDecision(recordId, approved) {
    setApproving(a => ({ ...a, [recordId]: approved ? 'approving' : 'rejecting' }))
    try {
      const updated = await patchApplication(recordId, { Approved: approved })
      setApplications(prev => prev.map(a => a.id === recordId ? { ...a, Approved: updated.Approved } : a))
      toast.success(approved ? 'Application approved — resident can now log in.' : 'Application rejected.')
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

  return (
    <div className="mb-10">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h2 className="mr-auto text-xl font-black text-slate-900">Applications</h2>
        <select
          value={propertyFilter}
          onChange={e => setPropertyFilter(e.target.value)}
          className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm transition focus:border-[#2563eb] focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20"
        >
          <option value="">All properties</option>
          {propertyOptions.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <button
          onClick={load}
          className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
        >
          Refresh
        </button>
      </div>

      <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white">
        {loading ? (
          <div className="px-6 py-16 text-center text-sm text-slate-500">Loading applications…</div>
        ) : applications.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <div className="mb-3 text-4xl">📋</div>
            <div className="text-sm font-semibold text-slate-700">No applications yet</div>
            <p className="mt-1 text-sm text-slate-500">Applications submitted via the Apply page will appear here.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {applications.map(app => {
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
        )}
      </div>
    </div>
  )
}

// ─── ManagerDashboard ─────────────────────────────────────────────────────────
function ManagerDashboard({ manager: managerProp, onOpenDraft, onSignOut, onManagerUpdate }) {
  const [manager, setManager] = useState(managerProp)
  const [dashView, setDashView] = useState('dashboard') // 'dashboard' | 'applications' | 'profile'
  const [drafts, setDrafts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showGenerateModal, setShowGenerateModal] = useState(false)
  const [filters, setFilters] = useState({ status: '', property: '', resident: '' })
  const [propertyOptions, setPropertyOptions] = useState(DEFAULT_AXIS_PROPERTIES)
  const [propertyCount, setPropertyCount] = useState(0)
  const [billingLoading, setBillingLoading] = useState(false)

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
    try {
      setDrafts(await fetchLeaseDrafts(filters))
    } catch (err) {
      toast.error('Failed to load lease drafts: ' + err.message)
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => { loadDrafts() }, [loadDrafts])
  const handlePropertiesChange = useCallback((records) => {
    const nextRecords = Array.isArray(records) ? records : []
    const names = nextRecords
      .map((record) => record.Name || record.Property || record.Address || '')
      .filter(Boolean)

    setPropertyCount(nextRecords.length)
    setPropertyOptions(Array.from(new Set([...DEFAULT_AXIS_PROPERTIES, ...names])))
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

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top nav */}
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#2563eb]">
              <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <span className="text-base font-black text-slate-900">Axis Manager Portal</span>
              <span className="ml-2 text-sm text-slate-400">Operations, houses &amp; leasing</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <div className="text-sm font-semibold text-slate-900">{manager.name}</div>
              <div className="text-xs text-slate-500">{manager.role}{manager.managerId ? ` · ${manager.managerId}` : ''}</div>
            </div>
            <button
              onClick={handleBillingPortal}
              disabled={billingLoading}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
            >
              {billingLoading ? 'Opening billing…' : 'Billing'}
            </button>
            <button
              onClick={onSignOut}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
            >
              Sign out
            </button>
          </div>
        </div>

        {/* View tabs — Dashboard / Applications / Profile */}
        <div className="flex gap-1 border-b border-slate-200 px-6">
          {[['dashboard', 'Dashboard'], ['applications', 'Applications'], ['profile', 'Profile']].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setDashView(key)}
              className={`-mb-px border-b-2 px-4 py-3 text-sm font-semibold transition ${dashView === key ? 'border-[#2563eb] text-[#2563eb]' : 'border-transparent text-slate-500 hover:text-slate-900'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
        {/* ── Profile view ── */}
        {dashView === 'profile' ? (
          <ManagerProfilePanel manager={manager} onManagerUpdate={handleManagerUpdate} />
        ) : dashView === 'applications' ? (
          <ApplicationsPanel propertyOptions={propertyOptions} />
        ) : (
        <>
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
          <h2 className="mr-auto text-xl font-black text-slate-900">Lease queue</h2>

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
            <option value="">All properties</option>
            {propertyOptions.map(p => <option key={p} value={p}>{p}</option>)}
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

        <ManagerOperationsPanel
          manager={manager}
          propertyCount={propertyCount}
          onGenerateDraft={() => setShowGenerateModal(true)}
          onOpenBilling={handleBillingPortal}
        />

        <WorkOrdersManagerPanel />

        <div id="house-management" className="mb-8 scroll-mt-24">
          <HouseManagementPanel onPropertiesChange={handlePropertiesChange} />
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
          Axis Manager Portal · Manage houses, generate leases, and review drafts before publication · {new Date().getFullYear()}
        </p>
      </>
      )}
      </div>

      {showGenerateModal && (
        <GenerateDraftModal
          manager={manager}
          propertyOptions={propertyOptions}
          onClose={() => setShowGenerateModal(false)}
          onGenerated={handleGenerated}
        />
      )}
    </div>
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
  const [actionLoading, setActionLoading] = useState('') // 'reject' | 'approve' | 'publish'
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

  // Derive which actions are available for the current status
  const status = draft?.['Status']
  const canEdit    = draft && !['Published', 'Signed'].includes(status)
  const canApprove = draft && ['Under Review', 'Changes Needed'].includes(status)
  const canPublish = draft && status === 'Approved'
  const canReject  = draft && ['Under Review', 'Draft Generated', 'Changes Needed'].includes(status)

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
  const [view, setView] = useState('dashboard') // 'dashboard' | 'editor'
  const [openDraftId, setOpenDraftId] = useState(null)

  // Restore session from sessionStorage on first render
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(MANAGER_SESSION_KEY)
      if (saved) setManager(JSON.parse(saved))
    } catch {
      sessionStorage.removeItem(MANAGER_SESSION_KEY)
    }
  }, [])

  function handleLogin(managerData) {
    setManager(managerData)
    setView('dashboard')
  }

  function handleSignOut() {
    sessionStorage.removeItem(MANAGER_SESSION_KEY)
    setManager(null)
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

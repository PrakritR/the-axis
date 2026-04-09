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
//   ManagerLogin       — email/password login via /api/manager-auth
//   GenerateDraftModal — form to create a new AI lease draft
//   ManagerDashboard   — filterable table of all lease drafts
//   LeaseEditor        — full-screen editor with sidebar, tabs, action buttons
//   Manager (default)  — root component managing session + view routing

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'

// ─── Session ──────────────────────────────────────────────────────────────────
const MANAGER_SESSION_KEY = 'axis_manager'
const MANAGER_ONBOARDING_KEY = 'axis_manager_onboarding'

// ─── Airtable config — same base as the rest of the portal ───────────────────
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
  'Published':       { bg: 'bg-teal-50',   text: 'text-teal-700',   border: 'border-teal-200',   dot: 'bg-teal-500'   },
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

// ─── Airtable helpers ─────────────────────────────────────────────────────────
function atHeaders() {
  return { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' }
}

function mapRecord(record) {
  return { id: record.id, ...record.fields, created_at: record.createdTime }
}

function classNames(...values) {
  return values.filter(Boolean).join(' ')
}

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

function ManagerPasswordInput({ value, onChange, placeholder, autoComplete }) {
  const [show, setShow] = useState(false)

  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        required
        autoComplete={autoComplete || 'current-password'}
        placeholder={placeholder || '••••••••'}
        className="w-full rounded-[24px] border border-slate-200 bg-slate-50 px-5 py-4 pr-12 text-base text-slate-900 placeholder:text-slate-400 transition focus:border-[#0ea5a4] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0ea5a4]/20"
      />
      <button
        type="button"
        onClick={() => setShow((current) => !current)}
        tabIndex={-1}
        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-slate-700"
      >
        {show ? (
          <svg className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
          </svg>
        ) : (
          <svg className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        )}
      </button>
    </div>
  )
}

function ManagerStep({ number, title, description, children, tone = 'default' }) {
  const tones = {
    default: 'border-slate-200 bg-slate-50',
    success: 'border-emerald-200 bg-emerald-50',
  }

  return (
    <div className={`rounded-[28px] border p-5 ${tones[tone] || tones.default}`}>
      <div className="flex items-start gap-4">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-black ${tone === 'success' ? 'bg-emerald-600 text-white' : 'bg-white text-slate-900'}`}>
          {number}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-black text-slate-900">{title}</h3>
          <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
          <div className="mt-4">{children}</div>
        </div>
      </div>
    </div>
  )
}

// ─── ManagerLogin ─────────────────────────────────────────────────────────────
function ManagerLogin({ onLogin }) {
  const queryString = typeof window !== 'undefined' ? window.location.search : ''
  const initialSearch = new URLSearchParams(queryString)
  const [signInForm, setSignInForm] = useState({ email: '', password: '' })
  const [subscriptionForm, setSubscriptionForm] = useState({ name: '', email: '', promoCode: 'FIRST20' })
  const [activationForm, setActivationForm] = useState({ managerId: '', name: '', email: '', password: '' })
  const [showActivation, setShowActivation] = useState(initialSearch.get('setup') === 'success')
  const [subscriptionReady, setSubscriptionReady] = useState(false)
  const [accountExists, setAccountExists] = useState(false)
  const [notice, setNotice] = useState('')
  const [loginError, setLoginError] = useState('')
  const [subscriptionError, setSubscriptionError] = useState('')
  const [activationError, setActivationError] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const [subscriptionLoading, setSubscriptionLoading] = useState(false)
  const [activationLoading, setActivationLoading] = useState(false)
  const [setupLoading, setSetupLoading] = useState(false)

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
    const normalizedManagerId = String(data.managerId || '').trim().toUpperCase()
    const nextAccountExists = Boolean(data.accountExists)
    const nextSubscriptionReady = Boolean(normalizedManagerId)

    setSubscriptionReady(nextSubscriptionReady)
    setAccountExists(nextAccountExists)
    setShowActivation(nextSubscriptionReady && !nextAccountExists)
    setSignInForm((current) => ({ ...current, email: normalizedEmail || current.email }))
    setSubscriptionForm((current) => ({
      ...current,
      name: normalizedName || current.name,
      email: normalizedEmail || current.email,
    }))
    setActivationForm((current) => ({
      ...current,
      managerId: normalizedManagerId || current.managerId,
      name: normalizedName || current.name,
      email: normalizedEmail || current.email,
    }))

    persistOnboarding({
      name: normalizedName,
      email: normalizedEmail,
      managerId: normalizedManagerId,
      promoCode: subscriptionForm.promoCode,
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
      if (parsed.promoCode) {
        setSubscriptionForm((current) => ({ ...current, promoCode: parsed.promoCode }))
      }
    } catch {
      clearOnboarding()
    }
  }, [])

  useEffect(() => {
    const searchParams = new URLSearchParams(queryString)
    const sessionId = searchParams.get('session_id') || ''
    const setupState = searchParams.get('setup') || ''

    if (setupState === 'cancelled') {
      setNotice('Manager subscription checkout was cancelled. You can restart it below whenever you are ready.')
    }

    if (!sessionId || setupState !== 'success') return

    let cancelled = false

    async function completeSetup() {
      setSetupLoading(true)
      setSubscriptionError('')
      setActivationError('')
      try {
        const res = await fetch(`/api/manager-subscription-complete?session_id=${encodeURIComponent(sessionId)}`)
        const data = await res.json()
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

  async function handleSubmit(event) {
    event.preventDefault()
    setLoginError('')
    setLoginLoading(true)
    try {
      const res = await fetch('/api/manager-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: signInForm.email.trim().toLowerCase(),
          password: signInForm.password,
        }),
      })
      const data = await res.json()
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
      const res = await fetch('/api/manager-create-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          managerId: activationForm.managerId.trim().toUpperCase(),
          name: activationForm.name.trim(),
          email: activationForm.email.trim().toLowerCase(),
          password: activationForm.password,
        }),
      })
      const data = await res.json()
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

  async function startSubscriptionSetup() {
    const normalizedName = subscriptionForm.name.trim()
    const normalizedEmail = subscriptionForm.email.trim().toLowerCase()
    const normalizedPromoCode = subscriptionForm.promoCode.trim().toUpperCase()

    if (!normalizedName || !normalizedEmail) {
      setSubscriptionError('Name and email are required to start manager setup.')
      return
    }

    setNotice('')
    setSubscriptionError('')
    setSubscriptionLoading(true)

    persistOnboarding({
      name: normalizedName,
      email: normalizedEmail,
      managerId: activationForm.managerId.trim().toUpperCase(),
      promoCode: normalizedPromoCode,
      subscriptionReady,
      accountExists,
    })

    try {
      const res = await fetch('/api/manager-create-subscription-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail, name: normalizedName, promoCode: normalizedPromoCode }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not start manager setup.')
      window.location.href = data.url
    } catch (err) {
      setSubscriptionError(err.message || 'Could not start manager setup.')
      setSubscriptionLoading(false)
    }
  }

  function scrollToSignIn() {
    document.getElementById('manager-signin-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const subscriptionManagerId = activationForm.managerId.trim().toUpperCase()

  return (
    <div className="flex min-h-screen items-start justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 px-4 py-10 sm:px-6 sm:py-14">
      <div className="w-full max-w-6xl">
        <div className="mb-10 text-center">
          <div className="inline-flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0ea5a4] shadow-[0_0_24px_rgba(14,165,164,0.35)]">
              <svg className="h-6 w-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <span className="text-2xl font-black tracking-tight text-white sm:text-3xl">Axis Manager Portal</span>
          </div>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
            Existing managers can sign in right away. New managers first start the recurring subscription, receive a manager ID, and then activate their account.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <section id="manager-signin-card" className="rounded-[32px] border border-white/10 bg-white p-7 shadow-[0_25px_60px_rgba(0,0,0,0.35)] sm:p-8">
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#0ea5a4]">Existing manager</div>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-900">Sign in</h1>
            <p className="mt-3 text-sm leading-7 text-slate-500">
              Use your email and password to open the manager portal, review leases, add houses, and manage resident operations.
            </p>

            <form onSubmit={handleSubmit} className="mt-7 space-y-5">
              <div>
                <label className="mb-1.5 block text-sm font-semibold text-slate-700">Email</label>
                <input
                  type="email"
                  value={signInForm.email}
                  onChange={(event) => setSignInForm((current) => ({ ...current, email: event.target.value }))}
                  required
                  autoComplete="email"
                  placeholder="you@axis-seattle.com"
                  className="w-full rounded-[24px] border border-slate-200 bg-slate-50 px-5 py-4 text-base text-slate-900 placeholder:text-slate-400 transition focus:border-[#0ea5a4] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0ea5a4]/20"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-semibold text-slate-700">Password</label>
                <ManagerPasswordInput
                  value={signInForm.password}
                  onChange={(event) => setSignInForm((current) => ({ ...current, password: event.target.value }))}
                  autoComplete="current-password"
                />
              </div>

              {loginError ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {loginError}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={loginLoading}
                className="w-full rounded-[24px] bg-slate-900 px-5 py-4 text-base font-semibold text-white transition hover:bg-[#0ea5a4] disabled:opacity-50"
              >
                {loginLoading ? 'Signing in…' : 'Sign in to manager portal'}
              </button>
            </form>

            <div className="mt-6 rounded-[24px] border border-slate-200 bg-slate-50 p-5">
              <div className="text-sm font-semibold text-slate-900">Need manager access?</div>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Start the manager subscription on the right. After checkout, we generate your manager ID and bring you back here to activate the account.
              </p>
            </div>
          </section>

          <section className="rounded-[32px] border border-white/10 bg-white p-7 shadow-[0_25px_60px_rgba(0,0,0,0.35)] sm:p-8">
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#0ea5a4]">New manager setup</div>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-900">Become a manager</h2>
            <p className="mt-3 text-sm leading-7 text-slate-500">
              Follow the three steps below. The sequence is simple: subscribe, receive your manager ID, then create your password and enter the portal.
            </p>

            {notice ? (
              <div className="mt-6 rounded-[24px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                {notice}
              </div>
            ) : null}

            {setupLoading ? (
              <div className="mt-6 rounded-[24px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                Verifying manager subscription…
              </div>
            ) : null}

            <div className="mt-6 space-y-4">
              <ManagerStep
                number="1"
                title="Start the manager subscription"
                description="Enter the manager name and email you want connected to the recurring subscription."
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="mb-1.5 block text-sm font-semibold text-slate-700">Manager name</label>
                    <input
                      type="text"
                      value={subscriptionForm.name}
                      onChange={(event) => {
                        const value = event.target.value
                        setSubscriptionForm((current) => ({ ...current, name: value }))
                        setActivationForm((current) => ({ ...current, name: value }))
                      }}
                      placeholder="Your name"
                      className="w-full rounded-[24px] border border-slate-200 bg-white px-5 py-4 text-base text-slate-900 placeholder:text-slate-400 transition focus:border-[#0ea5a4] focus:outline-none focus:ring-2 focus:ring-[#0ea5a4]/20"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-1.5 block text-sm font-semibold text-slate-700">Email</label>
                    <input
                      type="email"
                      value={subscriptionForm.email}
                      onChange={(event) => {
                        const value = event.target.value
                        setSubscriptionForm((current) => ({ ...current, email: value }))
                        setActivationForm((current) => ({ ...current, email: value }))
                      }}
                      placeholder="you@axis-seattle.com"
                      autoComplete="email"
                      className="w-full rounded-[24px] border border-slate-200 bg-white px-5 py-4 text-base text-slate-900 placeholder:text-slate-400 transition focus:border-[#0ea5a4] focus:outline-none focus:ring-2 focus:ring-[#0ea5a4]/20"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-1.5 block text-sm font-semibold text-slate-700">Promo code</label>
                    <input
                      type="text"
                      value={subscriptionForm.promoCode}
                      onChange={(event) => setSubscriptionForm((current) => ({ ...current, promoCode: event.target.value.toUpperCase() }))}
                      placeholder="FIRST20"
                      className="w-full rounded-[24px] border border-slate-200 bg-white px-5 py-4 text-base font-semibold uppercase tracking-[0.06em] text-slate-900 placeholder:text-slate-400 transition focus:border-[#0ea5a4] focus:outline-none focus:ring-2 focus:ring-[#0ea5a4]/20"
                    />
                  </div>
                </div>

                {subscriptionError ? (
                  <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {subscriptionError}
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={startSubscriptionSetup}
                  disabled={subscriptionLoading}
                  className="mt-4 w-full rounded-[24px] bg-[#0ea5a4] px-5 py-4 text-base font-semibold text-white transition hover:bg-[#0b8a89] disabled:opacity-50"
                >
                  {subscriptionLoading ? 'Starting checkout…' : 'Continue to recurring subscription'}
                </button>
              </ManagerStep>

              <ManagerStep
                number="2"
                title="Receive your manager ID"
                description="After Stripe checkout, we generate your manager ID automatically and keep it tied to the manager record in Airtable."
                tone={subscriptionReady ? 'success' : 'default'}
              >
                {subscriptionReady ? (
                  <div className="rounded-[24px] border border-emerald-200 bg-white px-5 py-4">
                    <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-600">Manager ID ready</div>
                    <div className="mt-2 text-2xl font-black tracking-[0.08em] text-slate-900">{subscriptionManagerId}</div>
                    <div className="mt-2 text-sm text-slate-500">{activationForm.email || subscriptionForm.email}</div>
                  </div>
                ) : (
                  <div className="rounded-[24px] border border-dashed border-slate-300 bg-white px-5 py-4 text-sm leading-6 text-slate-500">
                    Once checkout finishes, you will return here with your manager ID prefilled for the activation step.
                  </div>
                )}
              </ManagerStep>

              {accountExists ? (
                <ManagerStep
                  number="3"
                  title="Account already active"
                  description="This manager subscription already has an account. Sign in with your email and password to continue."
                  tone="success"
                >
                  <button
                    type="button"
                    onClick={scrollToSignIn}
                    className="rounded-[24px] border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-[#0ea5a4] hover:text-[#0ea5a4]"
                  >
                    Go to sign in
                  </button>
                </ManagerStep>
              ) : (
                <ManagerStep
                  number="3"
                  title="Activate your manager account"
                  description="Use the manager ID from step 2, set your password, and open the portal."
                >
                  {!showActivation && !subscriptionReady ? (
                    <div className="rounded-[24px] border border-dashed border-slate-300 bg-white px-5 py-4 text-sm leading-6 text-slate-500">
                      Finish the subscription first. If you already paid on another tab, click below and enter the manager ID you received.
                      <button
                        type="button"
                        onClick={() => setShowActivation(true)}
                        className="mt-4 block rounded-[20px] border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-[#0ea5a4] hover:text-[#0ea5a4]"
                      >
                        I already have a manager ID
                      </button>
                    </div>
                  ) : (
                    <form onSubmit={handleCreateAccount} className="space-y-4">
                      <div>
                        <label className="mb-1.5 block text-sm font-semibold text-slate-700">Manager ID</label>
                        <input
                          type="text"
                          value={activationForm.managerId}
                          onChange={(event) => setActivationForm((current) => ({ ...current, managerId: event.target.value.toUpperCase() }))}
                          required
                          placeholder="MGR-XXXXXXXXXXXXXX"
                          className="w-full rounded-[24px] border border-slate-200 bg-white px-5 py-4 text-base font-semibold uppercase tracking-[0.04em] text-slate-900 placeholder:text-slate-400 transition focus:border-[#0ea5a4] focus:outline-none focus:ring-2 focus:ring-[#0ea5a4]/20"
                        />
                      </div>
                      <div>
                        <label className="mb-1.5 block text-sm font-semibold text-slate-700">Manager name</label>
                        <input
                          type="text"
                          value={activationForm.name}
                          onChange={(event) => setActivationForm((current) => ({ ...current, name: event.target.value }))}
                          placeholder="Your name"
                          className="w-full rounded-[24px] border border-slate-200 bg-white px-5 py-4 text-base text-slate-900 placeholder:text-slate-400 transition focus:border-[#0ea5a4] focus:outline-none focus:ring-2 focus:ring-[#0ea5a4]/20"
                        />
                      </div>
                      <div>
                        <label className="mb-1.5 block text-sm font-semibold text-slate-700">Email</label>
                        <input
                          type="email"
                          value={activationForm.email}
                          onChange={(event) => setActivationForm((current) => ({ ...current, email: event.target.value }))}
                          required
                          autoComplete="email"
                          placeholder="you@axis-seattle.com"
                          className="w-full rounded-[24px] border border-slate-200 bg-white px-5 py-4 text-base text-slate-900 placeholder:text-slate-400 transition focus:border-[#0ea5a4] focus:outline-none focus:ring-2 focus:ring-[#0ea5a4]/20"
                        />
                      </div>
                      <div>
                        <label className="mb-1.5 block text-sm font-semibold text-slate-700">Create password</label>
                        <ManagerPasswordInput
                          value={activationForm.password}
                          onChange={(event) => setActivationForm((current) => ({ ...current, password: event.target.value }))}
                          autoComplete="new-password"
                          placeholder="Minimum 6 characters"
                        />
                      </div>

                      {activationError ? (
                        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                          {activationError}
                        </div>
                      ) : null}

                      <button
                        type="submit"
                        disabled={activationLoading}
                        className="w-full rounded-[24px] bg-slate-900 px-5 py-4 text-base font-semibold text-white transition hover:bg-[#0ea5a4] disabled:opacity-50"
                      >
                        {activationLoading ? 'Creating account…' : 'Create manager account'}
                      </button>
                    </form>
                  )}
                </ManagerStep>
              )}
            </div>
          </section>
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          Residents can sign in through the{' '}
          <a href="/resident" className="text-[#0ea5a4] hover:underline">resident portal →</a>
        </p>
      </div>
    </div>
  )
}

function HouseManagementPanel({ onPropertiesChange }) {
  const [properties, setProperties] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name: '',
    address: '',
    utilitiesFee: '',
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
      })
      setProperties((current) => {
        const next = [created, ...current]
        onPropertiesChange?.(next)
        return next
      })
      setForm({ name: '', address: '', utilitiesFee: '' })
      toast.success('House added')
    } catch (err) {
      toast.error('Could not add house: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
      <div className="rounded-[24px] border border-slate-200 bg-white p-6">
        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#0ea5a4]">House Management</div>
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
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 transition focus:border-[#0ea5a4] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0ea5a4]/20"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-slate-700">Address</label>
            <input
              type="text"
              value={form.address}
              onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))}
              placeholder="Full street address"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 transition focus:border-[#0ea5a4] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0ea5a4]/20"
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
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 transition focus:border-[#0ea5a4] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0ea5a4]/20"
            />
          </div>
          <button
            type="submit"
            disabled={saving || !form.name.trim()}
            className="w-full rounded-2xl bg-slate-900 px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-[#0ea5a4] disabled:opacity-50"
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
              </div>
            ))}
          </div>
        )}
      </div>
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
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#0ea5a4]">Portal tools</div>
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
              className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-[#0ea5a4] hover:text-[#0ea5a4]"
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
// Collects lease data and calls /api/generate-lease-draft
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
      const res = await fetch('/api/generate-lease-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, generatedBy: manager.name, generatedByRole: manager.role }),
      })
      const data = await res.json()
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

  const inputCls = 'w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm transition focus:border-[#0ea5a4] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0ea5a4]/20'
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
              className="inline-flex items-center gap-2 rounded-2xl bg-[#0ea5a4] px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0b8a89] disabled:opacity-50"
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

// ─── ManagerDashboard ─────────────────────────────────────────────────────────
function ManagerDashboard({ manager, onOpenDraft, onSignOut }) {
  const [drafts, setDrafts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showGenerateModal, setShowGenerateModal] = useState(false)
  const [filters, setFilters] = useState({ status: '', property: '', resident: '' })
  const [propertyOptions, setPropertyOptions] = useState(DEFAULT_AXIS_PROPERTIES)
  const [propertyCount, setPropertyCount] = useState(0)
  const [billingLoading, setBillingLoading] = useState(false)

  // Debounce the resident name search so we don't hammer Airtable on every keystroke
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
      const res = await fetch('/api/manager-billing-portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: manager.email }),
      })
      const data = await res.json()
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
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0ea5a4]">
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
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
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
              className="rounded-2xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm transition focus:border-[#0ea5a4] focus:outline-none focus:ring-2 focus:ring-[#0ea5a4]/20"
            />
          </div>

          {/* Status filter */}
          <select
            value={filters.status}
            onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm transition focus:border-[#0ea5a4] focus:outline-none focus:ring-2 focus:ring-[#0ea5a4]/20"
          >
            <option value="">All statuses</option>
            {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          {/* Property filter */}
          <select
            value={filters.property}
            onChange={e => setFilters(f => ({ ...f, property: e.target.value }))}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm transition focus:border-[#0ea5a4] focus:outline-none focus:ring-2 focus:ring-[#0ea5a4]/20"
          >
            <option value="">All properties</option>
            {propertyOptions.map(p => <option key={p} value={p}>{p}</option>)}
          </select>

          {/* Generate new draft */}
          <button
            onClick={() => setShowGenerateModal(true)}
            className="inline-flex items-center gap-2 rounded-2xl bg-[#0ea5a4] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0b8a89]"
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
                          className="rounded-xl border border-slate-200 px-4 py-1.5 text-sm font-semibold text-slate-700 transition hover:border-[#0ea5a4] hover:text-[#0ea5a4]"
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
                className="rounded-xl bg-[#0ea5a4] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0b8a89] disabled:opacity-50"
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
                    ? 'bg-slate-900 text-white'
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
                      className="rounded-xl bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-[#0ea5a4] disabled:opacity-50"
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
              className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 placeholder:text-slate-400 transition focus:border-[#0ea5a4] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0ea5a4]/20 disabled:opacity-60"
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
            <div className="rounded-[24px] border border-teal-200 bg-teal-50 p-5">
              <div className="text-sm font-semibold text-teal-800">Approved — ready to publish</div>
              <p className="mt-1.5 text-sm text-teal-700">
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
              <button onClick={handlePublish} disabled={!!actionLoading} className="w-full rounded-2xl bg-[#0ea5a4] py-3 text-sm font-semibold text-white transition hover:bg-[#0b8a89] disabled:opacity-50">
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
export default function Manager() {
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

  function handleOpenDraft(draftId) {
    setOpenDraftId(draftId)
    setView('editor')
  }

  function handleBackToDashboard() {
    setView('dashboard')
    setOpenDraftId(null)
  }

  if (!manager) {
    return <ManagerLogin onLogin={handleLogin} />
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
    />
  )
}

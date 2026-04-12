import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import ManagerInboxPage from '../components/manager-inbox/ManagerInboxPage'
import PortalShell, { StatCard, StatusPill, DataTable } from '../components/PortalShell'
import {
  adminApproveProperty,
  adminRejectApplication,
  adminUnapproveApplication,
  adminRejectProperty,
  adminRequestPropertyEdits,
  adminSetManagerActive,
  adminDeleteProperty,
  adminUnlistProperty,
  adminRelistProperty,
  isAdminPortalAirtableConfigured,
  loadAdminPortalDataset,
  loadResidentsForAdmin,
} from '../lib/adminPortalAirtable.js'
import { readJsonResponse } from '../lib/readJsonResponse'
import { authenticateAdminPortal } from '../lib/adminPortalSignIn'
import {
  markDeveloperPortalActive,
  clearDeveloperPortalFlags,
  seedDeveloperManagerSession,
  seedInternalStaffManagerSession,
} from '../lib/developerPortal'
import { ApplicationDetailPanel } from '../lib/applicationDetailPanel.jsx'
import { PropertyDetailPanel } from '../lib/propertyDetailPanel.jsx'
import { AXIS_ADMIN_SESSION_KEY } from './adminSessionConstants'
import AdminProfilePanel from './AdminProfilePanel.jsx'
import {
  getAllPortalInternalThreadMessages,
  fetchInboxThreadStateMap,
  portalInboxAirtableConfigured,
  portalInboxThreadKeyFromRecord,
} from '../lib/airtable.js'

export { AXIS_ADMIN_SESSION_KEY } from './adminSessionConstants'

const PROPERTY_STATUS_LABEL = {
  pending: 'Pending approval',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  rejected: 'Rejected',
  live: 'Live',
  inactive: 'Inactive',
  unlisted: 'Unlisted',
}

const NAV_BASE = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'properties', label: 'Properties' },
  { id: 'accounts', label: 'Managers' },
  { id: 'messages', label: 'Inbox' },
  { id: 'profile', label: 'Profile' },
]

/** All signed-in admin users can review applications from this UI. */
function canReviewApplicationsFromAdmin() {
  return true
}

function adminApplicationActorMeta(user) {
  return { name: user.name || user.email || 'Admin', role: 'Admin' }
}

const adminSelectCls =
  'rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/20'

function sortAccountsByMode(list, mode) {
  const copy = [...list]
  const house = (a) => String(a.houseSortKey || '')
  const acct = (a) => String(a.businessName || a.name || a.email || '').toLowerCase()
  if (mode === 'house_asc') {
    copy.sort(
      (a, b) =>
        house(a).localeCompare(house(b), undefined, { sensitivity: 'base' }) || acct(a).localeCompare(acct(b)),
    )
  } else if (mode === 'house_desc') {
    copy.sort(
      (a, b) =>
        house(b).localeCompare(house(a), undefined, { sensitivity: 'base' }) || acct(a).localeCompare(acct(b)),
    )
  } else if (mode === 'account_asc') {
    copy.sort((a, b) => acct(a).localeCompare(acct(b)))
  }
  return copy
}

function sortApplicationsByMode(list, mode) {
  const copy = [...list]
  const prop = (r) => String(r.propertyName || '').toLowerCase()
  const app = (r) => String(r.applicantName || '').toLowerCase()
  if (mode === 'house_asc') {
    copy.sort(
      (a, b) =>
        prop(a).localeCompare(prop(b), undefined, { sensitivity: 'base' }) || app(a).localeCompare(app(b)),
    )
  } else if (mode === 'house_desc') {
    copy.sort(
      (a, b) =>
        prop(b).localeCompare(prop(a), undefined, { sensitivity: 'base' }) || app(a).localeCompare(app(b)),
    )
  } else if (mode === 'applicant_asc') {
    copy.sort((a, b) => app(a).localeCompare(app(b)) || prop(a).localeCompare(prop(b)))
  }
  return copy
}

const loginInputCls =
  'mt-1 w-full rounded-xl border border-slate-600 bg-slate-900/40 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-500/40'

function propertyTone(st) {
  if (st === 'live') return 'green'
  if (st === 'pending') return 'amber'
  if (st === 'changes_requested') return 'violet'
  if (st === 'rejected') return 'red'
  if (st === 'unlisted') return 'violet'
  return 'slate'
}

function residentApprovedForProperty(resident) {
  if (!resident || typeof resident !== 'object') return false
  const approvedRaw = resident.Approved
  if (approvedRaw === true || approvedRaw === 1 || approvedRaw === '1') return true
  const statusRaw = String(resident.Status || resident['Approval Status'] || '').trim().toLowerCase()
  return statusRaw === 'approved' || statusRaw === 'active' || statusRaw === 'live'
}

function PortalHandoffCard({ accounts, residents, user }) {
  const [selectedManagerId, setSelectedManagerId] = useState('')
  const [selectedResidentId, setSelectedResidentId] = useState('')

  function openManagerPortal() {
    const manager = accounts.find((a) => a.id === selectedManagerId)
    if (!manager) return
    sessionStorage.setItem('axis_manager', JSON.stringify({
      id: manager.id,
      email: manager.email,
      name: manager.name,
    }))
    window.location.assign('/manager')
  }

  function openResidentPortal() {
    const resident = residents.find((r) => r.id === selectedResidentId)
    if (!resident) return
    sessionStorage.setItem('axis_resident', resident.id)
    window.location.assign('/resident')
  }

  const activeManagers = accounts.filter((a) => a.enabled)
  const sortedManagers = [...activeManagers].sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }),
  )
  const sortedResidents = [...residents].sort((a, b) =>
    String(a.Name || '').localeCompare(String(b.Name || ''), undefined, { sensitivity: 'base' }),
  )

  return (
    <div className="rounded-3xl border border-sky-200/90 bg-[linear-gradient(135deg,#f0f9ff_0%,#ffffff_100%)] p-5 shadow-sm">
      <h2 className="text-sm font-black text-slate-900">Open portals as a specific account</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-sky-800">Manager portal</div>
          <div className="flex gap-2">
            <select
              value={selectedManagerId}
              onChange={(e) => setSelectedManagerId(e.target.value)}
              className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400/30"
            >
              <option value="">— choose manager —</option>
              {sortedManagers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}{m.managedHousesLabel && m.managedHousesLabel !== '—' ? ` · ${m.managedHousesLabel}` : ''}
                </option>
              ))}
              {sortedManagers.length === 0 ? (
                <option disabled value="">No active managers found</option>
              ) : null}
            </select>
            <button
              type="button"
              disabled={!selectedManagerId}
              onClick={openManagerPortal}
              className="rounded-xl bg-[#2563eb] px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Open
            </button>
          </div>
        </div>
        <div>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-sky-800">Resident portal</div>
          <div className="flex gap-2">
            <select
              value={selectedResidentId}
              onChange={(e) => setSelectedResidentId(e.target.value)}
              className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400/30"
            >
              <option value="">— choose resident —</option>
              {sortedResidents.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.Name || r.Email || r.id}
                  {r.House ? ` · ${r.House}` : ''}
                  {r['Unit Number'] ? ` ${r['Unit Number']}` : ''}
                </option>
              ))}
              {sortedResidents.length === 0 ? (
                <option disabled value="">Loading residents…</option>
              ) : null}
            </select>
            <button
              type="button"
              disabled={!selectedResidentId}
              onClick={openResidentPortal}
              className="rounded-xl bg-[#2563eb] px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Open
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function AdminLoginView({ onAuthenticated }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function handleSignIn(e) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      const result = await authenticateAdminPortal(email, password)
      if (result.ok) {
        onAuthenticated(result.user)
        toast.success('Signed in')
        return
      }
      setErr(result.error || 'Sign-in failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-900 px-6 py-12">
      <div className="w-full max-w-md rounded-3xl border border-slate-700 bg-slate-800 p-8 shadow-xl">
        <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-sky-400">Axis Admin</div>
        <h1 className="mt-2 text-2xl font-black text-white">Admin portal</h1>

        <form onSubmit={handleSignIn} className="mt-6 space-y-4">
          <label className="block text-sm font-semibold text-slate-300">
            Email
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={loginInputCls}
              placeholder="you@company.com"
            />
          </label>
          <label className="block text-sm font-semibold text-slate-300">
            Password
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={loginInputCls}
            />
          </label>
          {err ? <p className="text-sm text-red-300">{err}</p> : null}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-2xl bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] py-3 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(37,99,235,0.25)] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default function AdminPortal() {
  const [session, setSession] = useState(() => {
    try {
      const raw = sessionStorage.getItem(AXIS_ADMIN_SESSION_KEY)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  })
  const [tab, setTab] = useState(() => {
    const h = window.location.hash.slice(1)
    return NAV_BASE.some((n) => n.id === h) ? h : 'dashboard'
  })
  useEffect(() => { window.location.hash = tab }, [tab])
  /** Within Properties: pending | approved | unlisted | rejected */
  const [propertiesSection, setPropertiesSection] = useState('pending')
  /** Within Applications: all | pending | approved | rejected */
  const [applicationsFilter, setApplicationsFilter] = useState('all')
  const [managersFilter, setManagersFilter] = useState('current')
  const [selectedManagerAccountId, setSelectedManagerAccountId] = useState(null)
  const [managerActionBusy, setManagerActionBusy] = useState(false)
  const [properties, setProperties] = useState(() => [])
  const [accounts, setAccounts] = useState(() => [])
  const [applications, setApplications] = useState(() => [])
  const [selectedApprovalId, setSelectedApprovalId] = useState(null)
  const [selectedApplicationId, setSelectedApplicationId] = useState(null)
  const [residents, setResidents] = useState([])
  const [dataLoading, setDataLoading] = useState(false)
  const [approvalBusy, setApprovalBusy] = useState(false)
  const [applicationReviewBusy, setApplicationReviewBusy] = useState(false)
  const [managerTableSort, setManagerTableSort] = useState('house_asc')
  const [applicationsTableSort, setApplicationsTableSort] = useState('house_asc')
  const [unopenedThreadCount, setUnopenedThreadCount] = useState(0)
  const [propertiesSearch, setPropertiesSearch] = useState('')
  const [managersSearch, setManagersSearch] = useState('')
  const [applicationsManagerFilter, setApplicationsManagerFilter] = useState('')
  const [applicationsHouseFilter, setApplicationsHouseFilter] = useState('')
  const airtableConfigWarned = useRef(false)

  const user = session

  useEffect(() => {
    if (session) markDeveloperPortalActive()
  }, [session])

  const refreshPortalData = useCallback(async () => {
    if (!session) return
    if (!isAdminPortalAirtableConfigured()) return
    setDataLoading(true)
    try {
      const [next, residentList] = await Promise.all([
        loadAdminPortalDataset(),
        loadResidentsForAdmin().catch(() => []),
      ])
      setProperties(next.properties)
      setAccounts(next.accounts)
      setApplications(next.applications)
      setResidents(residentList)
    } catch (e) {
      toast.error(e?.message || 'Could not load data.')
    } finally {
      setDataLoading(false)
    }
  }, [session])

  useEffect(() => {
    if (!session) return
    if (!isAdminPortalAirtableConfigured()) {
      if (!airtableConfigWarned.current) {
        airtableConfigWarned.current = true
        toast.error('Admin data needs API token and base ID configured (same as manager portal).')
      }
      return
    }
    refreshPortalData()
  }, [session, refreshPortalData])

  function persistSession(u) {
    setSession(u)
    sessionStorage.setItem(AXIS_ADMIN_SESSION_KEY, JSON.stringify(u))
    if (u) markDeveloperPortalActive()
  }

  function handleSignOut() {
    sessionStorage.removeItem(AXIS_ADMIN_SESSION_KEY)
    clearDeveloperPortalFlags()
    setSession(null)
  }

  // Unopened threads for dashboard badge
  useEffect(() => {
    if (!session?.email || !portalInboxAirtableConfigured()) return
    let cancelled = false
    async function fetchUnopenedCount() {
      try {
        const [msgs, stateMap] = await Promise.all([
          getAllPortalInternalThreadMessages(),
          fetchInboxThreadStateMap(session.email),
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
        if (!cancelled) setUnopenedThreadCount(unopened)
      } catch {
        // non-fatal — badge just stays at 0
      }
    }
    fetchUnopenedCount()
    return () => { cancelled = true }
  }, [session])

  useEffect(() => {
    if (tab !== 'applications') setSelectedApplicationId(null)
  }, [tab])

  useEffect(() => {
    if (tab !== 'properties') setSelectedApprovalId(null)
  }, [tab])

  useEffect(() => {
    setSelectedApprovalId(null)
  }, [propertiesSection])

  const navItems = useMemo(() => NAV_BASE, [])

  const pendingApprovals = useMemo(() => properties.filter((p) => p.status === 'pending' || p.status === 'changes_requested'), [properties])
  const approvedProperties = useMemo(
    () => properties.filter((p) => p.status === 'approved' || p.status === 'live'),
    [properties],
  )
  const unlistedProperties = useMemo(() => properties.filter((p) => p.status === 'unlisted'), [properties])
  const rejectedProperties = useMemo(() => properties.filter((p) => p.status === 'rejected'), [properties])
  const pendingApps = useMemo(
    () => applications.filter((a) => a.approvalPending).length,
    [applications],
  )
  const sortedAccounts = useMemo(
    () => sortAccountsByMode(accounts, managerTableSort),
    [accounts, managerTableSort],
  )
  const filteredAccounts = useMemo(
    () => managersFilter === 'current'
      ? sortedAccounts.filter((a) => a.enabled !== false)
      : sortedAccounts.filter((a) => a.enabled === false),
    [sortedAccounts, managersFilter],
  )
  const sortedApplications = useMemo(
    () => sortApplicationsByMode(applications, applicationsTableSort),
    [applications, applicationsTableSort],
  )
  const filteredApplications = useMemo(() => {
    if (applicationsFilter === 'pending') return sortedApplications.filter((a) => a.approvalPending)
    if (applicationsFilter === 'approved') return sortedApplications.filter((a) => a.approvalState === 'approved')
    if (applicationsFilter === 'rejected') return sortedApplications.filter((a) => a.approvalState === 'rejected')
    return sortedApplications
  }, [sortedApplications, applicationsFilter])

  const searchedPendingApprovals = useMemo(() => {
    const q = propertiesSearch.trim().toLowerCase()
    if (!q) return pendingApprovals
    return pendingApprovals.filter((p) => `${p.name} ${p.address}`.toLowerCase().includes(q))
  }, [pendingApprovals, propertiesSearch])
  const searchedApprovedProperties = useMemo(() => {
    const q = propertiesSearch.trim().toLowerCase()
    if (!q) return approvedProperties
    return approvedProperties.filter((p) => `${p.name} ${p.address}`.toLowerCase().includes(q))
  }, [approvedProperties, propertiesSearch])
  const searchedUnlistedProperties = useMemo(() => {
    const q = propertiesSearch.trim().toLowerCase()
    if (!q) return unlistedProperties
    return unlistedProperties.filter((p) => `${p.name} ${p.address}`.toLowerCase().includes(q))
  }, [unlistedProperties, propertiesSearch])
  const searchedRejectedProperties = useMemo(() => {
    const q = propertiesSearch.trim().toLowerCase()
    if (!q) return rejectedProperties
    return rejectedProperties.filter((p) => `${p.name} ${p.address}`.toLowerCase().includes(q))
  }, [rejectedProperties, propertiesSearch])
  const searchedAccounts = useMemo(() => {
    const q = managersSearch.trim().toLowerCase()
    if (!q) return filteredAccounts
    return filteredAccounts.filter((a) => `${a.businessName || ''} ${a.name || ''} ${a.email || ''} ${a.managedHousesLabel || ''}`.toLowerCase().includes(q))
  }, [filteredAccounts, managersSearch])
  const searchedApplications = useMemo(() => {
    let result = filteredApplications
    if (applicationsManagerFilter) result = result.filter((a) => a.ownerId === applicationsManagerFilter)
    if (applicationsHouseFilter) result = result.filter((a) => a.propertyName === applicationsHouseFilter)
    return result
  }, [filteredApplications, applicationsManagerFilter, applicationsHouseFilter])

  const applicationHouseOptions = useMemo(() => {
    const set = new Set()
    for (const p of properties) {
      const name = String(p?.name || '').trim()
      if (name) set.add(name)
    }
    for (const r of residents) {
      if (!residentApprovedForProperty(r)) continue
      const house = String(r?.House || r?.['Property Name'] || '').trim()
      if (house) set.add(house)
    }
    for (const a of applications) {
      const house = String(a?.propertyName || '').trim()
      if (house) set.add(house)
    }
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  }, [properties, residents, applications])

  const ownerLabel = (ownerId) => accounts.find((a) => a.id === ownerId)?.businessName || accounts.find((a) => a.id === ownerId)?.name || ownerId

  if (!session) {
    return <AdminLoginView onAuthenticated={persistSession} />
  }

  const approval = properties.find((p) => p.id === selectedApprovalId)
  const selectedApplication = applications.find((a) => a.id === selectedApplicationId)

  return (
    <PortalShell
      brandTitle="Axis"
      desktopNav="sidebar"
      navItems={navItems}
      activeId={tab}
      onNavigate={setTab}
      userLabel={user.name}
      userMeta="Full access"
      onSignOut={handleSignOut}
    >
      <div className="mx-auto w-full max-w-[1600px]">
      {tab === 'dashboard' && (
        <div className="space-y-6">
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-black uppercase tracking-[0.08em] text-slate-900">
                {user?.name ? `WELCOME ${user.name.split(' ')[0]}` : 'DASHBOARD'}
              </h1>
            </div>
            {dataLoading ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" />
                Syncing…
              </span>
            ) : (
              <button
                type="button"
                onClick={refreshPortalData}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50"
              >
                Refresh
              </button>
            )}
          </div>

          {/* Portal handoff — top */}
          {isAdminPortalAirtableConfigured() ? (
            <PortalHandoffCard accounts={accounts} residents={residents} user={user} />
          ) : null}

          {/* Action-needed banner */}
          {pendingApprovals.length > 0 ? (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-400 text-xs font-black text-white">
                {pendingApprovals.length}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-amber-900">Action needed</p>
                <p className="text-xs text-amber-800">
                  {`${pendingApprovals.length} propert${pendingApprovals.length === 1 ? 'y' : 'ies'} awaiting review`}
                </p>
              </div>
              <div className="flex gap-2">
                {pendingApprovals.length > 0 && (
                  <button
                    type="button"
                    onClick={() => { setTab('properties'); setPropertiesSection('pending') }}
                    className="rounded-xl bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-600"
                  >
                    Review properties
                  </button>
                )}
              </div>
            </div>
          ) : null}

          {/* Metrics grid — unified light blue tint */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {/* Properties pending */}
            <button
              type="button"
              onClick={() => { setTab('properties'); setPropertiesSection('pending') }}
              className="flex flex-col gap-1 rounded-3xl border border-sky-200/90 bg-sky-50 p-5 text-left transition hover:border-sky-300 hover:bg-sky-100/80 hover:shadow-sm"
            >
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-sky-800">Properties · Pending</span>
              <span className="text-3xl font-black tabular-nums text-slate-900">{pendingApprovals.length}</span>
            </button>

            {/* Properties approved (listed) */}
            <button
              type="button"
              onClick={() => { setTab('properties'); setPropertiesSection('approved') }}
              className="flex flex-col gap-1 rounded-3xl border border-sky-200/90 bg-sky-50 p-5 text-left transition hover:border-sky-300 hover:bg-sky-100/80 hover:shadow-sm"
            >
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-sky-800">Properties · Listed</span>
              <span className="text-3xl font-black tabular-nums text-slate-900">{approvedProperties.length}</span>
            </button>

            {/* Properties unlisted */}
            <button
              type="button"
              onClick={() => { setTab('properties'); setPropertiesSection('unlisted') }}
              className="flex flex-col gap-1 rounded-3xl border border-sky-200/90 bg-sky-50 p-5 text-left transition hover:border-sky-300 hover:bg-sky-100/80 hover:shadow-sm"
            >
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-sky-800">Properties · Unlisted</span>
              <span className="text-3xl font-black tabular-nums text-slate-900">{unlistedProperties.length}</span>
            </button>

            {/* Subscribed managers */}
            <button
              type="button"
              onClick={() => setTab('accounts')}
              className="flex flex-col gap-1 rounded-3xl border border-sky-200/90 bg-sky-50 p-5 text-left transition hover:border-sky-300 hover:bg-sky-100/80 hover:shadow-sm"
            >
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-sky-800">Managers · Subscribed</span>
              <span className="text-3xl font-black tabular-nums text-slate-900">{accounts.filter((a) => a.enabled).length}</span>
            </button>

            {/* Residents */}
            <button
              type="button"
              onClick={() => setTab('messages')}
              className="flex flex-col gap-1 rounded-3xl border border-sky-200/90 bg-sky-50 p-5 text-left transition hover:border-sky-300 hover:bg-sky-100/80 hover:shadow-sm"
            >
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-sky-800">Residents</span>
              <span className="text-3xl font-black tabular-nums text-slate-900">{residents.length}</span>
            </button>

            {/* Inbox — full-width row spanning all 3 columns */}
            <button
              type="button"
              onClick={() => setTab('messages')}
              className="col-span-full flex items-center justify-between rounded-3xl border border-sky-300/90 bg-gradient-to-r from-sky-100 to-sky-50 px-6 py-5 text-left transition hover:border-sky-400 hover:from-sky-200/70 hover:to-sky-100/90 hover:shadow-sm"
            >
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-sky-900">Inbox</span>
                {unopenedThreadCount > 0 ? (
                  <span
                    className="flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-black text-white tabular-nums"
                    title="Unopened conversations"
                    aria-label={`${unopenedThreadCount} unopened conversation${unopenedThreadCount === 1 ? '' : 's'}`}
                  >
                    {unopenedThreadCount}
                  </span>
                ) : null}
              </div>
              <span className="text-lg font-black text-slate-900">Open messages →</span>
            </button>
          </div>
        </div>
      )}

      {tab === 'properties' && (
        <div className="space-y-6">
          <div>
            <div className="mb-4">
              <h1 className="text-2xl font-black text-slate-900">Properties</h1>
            </div>
            <div className="inline-flex flex-wrap gap-1 rounded-2xl border border-slate-200 bg-slate-50 p-1">
              {[['pending', 'Pending', pendingApprovals.length], ['approved', 'Listed', approvedProperties.length], ['unlisted', 'Unlisted', unlistedProperties.length], ['rejected', 'Rejected', rejectedProperties.length]].map(([key, label, count]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPropertiesSection(key)}
                  className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                    propertiesSection === key
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {label}
                  <span className="ml-1.5 tabular-nums text-slate-500">({count})</span>
                </button>
              ))}
            </div>
          </div>

          {propertiesSection === 'pending' ? (
            <>
              <DataTable
                empty="No properties awaiting review"
                columns={[
                  { key: 'n', label: 'Property', render: (d) => <><div className="font-semibold">{d.name}</div><div className="text-xs text-slate-500">{d.address}</div></> },
                  { key: 'o', label: 'Manager', render: (d) => ownerLabel(d.ownerId) },
                  { key: 's', label: 'Status', render: (d) => <StatusPill tone={propertyTone(d.status)}>{PROPERTY_STATUS_LABEL[d.status] || d.status}</StatusPill> },
                  { key: 'dt', label: 'Submitted', render: (d) => new Date(d.submittedAt).toLocaleDateString() },
                  { key: 'a', label: '', render: (d) => (
                    <button type="button" className="text-sm font-semibold text-[#2563eb]" onClick={() => setSelectedApprovalId(d.id)}>Review</button>
                  ) },
                ]}
                rows={searchedPendingApprovals.map((p) => ({ key: p.id, data: p }))}
              />
              {approval ? (
                <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
                  <div className="flex justify-between gap-2">
                    <h2 className="text-lg font-black">{approval.name}</h2>
                    <button type="button" className="text-sm text-slate-500" onClick={() => setSelectedApprovalId(null)}>Close</button>
                  </div>
                  <p className="text-sm text-slate-600">{approval.description}</p>
                  <PropertyDetailPanel property={approval} ownerLabel={ownerLabel(approval.ownerId)} />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={approvalBusy}
                      className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      onClick={async () => {
                        if (!approval?.id) return
                        setApprovalBusy(true)
                        try {
                          await adminApproveProperty(approval.id)
                          await refreshPortalData()
                          toast.success('Property approved')
                          setSelectedApprovalId(null)
                        } catch (e) {
                          toast.error(e?.message || 'Approve failed')
                        } finally {
                          setApprovalBusy(false)
                        }
                      }}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={approvalBusy}
                      className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900 disabled:opacity-50"
                      onClick={async () => {
                        if (!approval?.id) return
                        setApprovalBusy(true)
                        try {
                          await adminRequestPropertyEdits(approval.id)
                          await refreshPortalData()
                          toast.success('Marked as changes requested')
                        } catch (e) {
                          toast.error(e?.message || 'Update failed (add single-line field "Approval Status" if missing).')
                        } finally {
                          setApprovalBusy(false)
                        }
                      }}
                    >
                      Request edits
                    </button>
                    <button
                      type="button"
                      disabled={approvalBusy}
                      className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-800 disabled:opacity-50"
                      onClick={async () => {
                        if (!approval?.id) return
                        setApprovalBusy(true)
                        try {
                          await adminRejectProperty(approval.id)
                          await refreshPortalData()
                          toast.success('Property rejected')
                          setSelectedApprovalId(null)
                        } catch (e) {
                          toast.error(e?.message || 'Reject failed')
                        } finally {
                          setApprovalBusy(false)
                        }
                      }}
                    >
                      Reject
                    </button>
                  </div>
                  <label className="block text-sm">
                    <span className="font-semibold text-slate-700">Internal notes (admin only)</span>
                    <textarea className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-2 text-sm" rows={2} defaultValue={approval.adminNotesInternal} readOnly />
                  </label>
                </div>
              ) : null}
            </>
          ) : propertiesSection === 'approved' ? (
            <>
              <DataTable
                empty="No listed properties"
                columns={[
                  { key: 'n', label: 'Property', render: (d) => <><div className="font-semibold">{d.name}</div><div className="text-xs text-slate-500">{d.address}</div></> },
                  { key: 'o', label: 'Manager', render: (d) => ownerLabel(d.ownerId) },
                  { key: 's', label: 'Status', render: (d) => <StatusPill tone={propertyTone(d.status)}>{PROPERTY_STATUS_LABEL[d.status] || d.status}</StatusPill> },
                  { key: 'a', label: '', render: (d) => (
                    <button type="button" className="text-sm font-semibold text-[#2563eb]" onClick={() => setSelectedApprovalId(selectedApprovalId === d.id ? null : d.id)}>
                      {selectedApprovalId === d.id ? 'Hide' : 'Details'}
                    </button>
                  ) },
                ]}
                rows={searchedApprovedProperties.map((p) => ({ key: p.id, data: p }))}
              />
              {approval && propertiesSection === 'approved' ? (
                <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="text-lg font-black">{approval.name}</h2>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <button
                        type="button"
                        disabled={approvalBusy}
                        onClick={async () => {
                          if (!window.confirm(`Unlist "${approval.name}"? It will stay in the portal but hide from the public site.`)) return
                          setApprovalBusy(true)
                          try {
                            await adminUnlistProperty(approval.id)
                            toast.success('Property unlisted')
                            setSelectedApprovalId(null)
                            await refreshPortalData()
                          } catch (err) {
                            toast.error(err.message || 'Unlist failed (add a "Listed" checkbox on Properties if missing).')
                          } finally {
                            setApprovalBusy(false)
                          }
                        }}
                        className="rounded-xl border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50"
                      >
                        Unlist
                      </button>
                      <button
                        type="button"
                        disabled={approvalBusy}
                        onClick={async () => {
                          if (!window.confirm(`Permanently delete "${approval.name}"? This cannot be undone.`)) return
                          setApprovalBusy(true)
                          try {
                            await adminDeleteProperty(approval.id)
                            toast.success('Property deleted')
                            setSelectedApprovalId(null)
                            await refreshPortalData()
                          } catch (err) {
                            toast.error(err.message || 'Delete failed')
                          } finally {
                            setApprovalBusy(false)
                          }
                        }}
                        className="rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                      >
                        {approvalBusy ? 'Working…' : 'Delete property'}
                      </button>
                      <button type="button" className="text-sm text-slate-500" onClick={() => setSelectedApprovalId(null)}>Close</button>
                    </div>
                  </div>
                  <p className="text-sm text-slate-600">{approval.description}</p>
                  <PropertyDetailPanel property={approval} ownerLabel={ownerLabel(approval.ownerId)} />
                </div>
              ) : null}
            </>
          ) : propertiesSection === 'unlisted' ? (
            <>
              <DataTable
                empty="No unlisted properties"
                columns={[
                  { key: 'n', label: 'Property', render: (d) => <><div className="font-semibold">{d.name}</div><div className="text-xs text-slate-500">{d.address}</div></> },
                  { key: 'o', label: 'Manager', render: (d) => ownerLabel(d.ownerId) },
                  { key: 's', label: 'Status', render: (d) => <StatusPill tone={propertyTone(d.status)}>{PROPERTY_STATUS_LABEL[d.status] || d.status}</StatusPill> },
                  { key: 'a', label: '', render: (d) => (
                    <button type="button" className="text-sm font-semibold text-[#2563eb]" onClick={() => setSelectedApprovalId(selectedApprovalId === d.id ? null : d.id)}>
                      {selectedApprovalId === d.id ? 'Hide' : 'Details'}
                    </button>
                  ) },
                ]}
                rows={searchedUnlistedProperties.map((p) => ({ key: p.id, data: p }))}
              />
              {approval && propertiesSection === 'unlisted' ? (
                <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="text-lg font-black">{approval.name}</h2>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <button
                        type="button"
                        disabled={approvalBusy}
                        onClick={async () => {
                          setApprovalBusy(true)
                          try {
                            await adminRelistProperty(approval.id)
                            toast.success('Property listed again')
                            setSelectedApprovalId(null)
                            await refreshPortalData()
                          } catch (err) {
                            toast.error(err.message || 'Relist failed (add a "Listed" checkbox on Properties if missing).')
                          } finally {
                            setApprovalBusy(false)
                          }
                        }}
                        className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        Relist
                      </button>
                      <button
                        type="button"
                        disabled={approvalBusy}
                        onClick={async () => {
                          if (!window.confirm(`Permanently delete "${approval.name}"? This cannot be undone.`)) return
                          setApprovalBusy(true)
                          try {
                            await adminDeleteProperty(approval.id)
                            toast.success('Property deleted')
                            setSelectedApprovalId(null)
                            await refreshPortalData()
                          } catch (err) {
                            toast.error(err.message || 'Delete failed')
                          } finally {
                            setApprovalBusy(false)
                          }
                        }}
                        className="rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                      >
                        {approvalBusy ? 'Working…' : 'Delete property'}
                      </button>
                      <button type="button" className="text-sm text-slate-500" onClick={() => setSelectedApprovalId(null)}>Close</button>
                    </div>
                  </div>
                  <p className="text-sm text-slate-600">Hidden from the public marketing site; still approved in Axis.</p>
                  <p className="text-sm text-slate-600">{approval.description}</p>
                  <PropertyDetailPanel property={approval} ownerLabel={ownerLabel(approval.ownerId)} />
                </div>
              ) : null}
            </>
          ) : (
            <>
              <DataTable
                empty="No rejected properties"
                columns={[
                  { key: 'n', label: 'Property', render: (d) => <><div className="font-semibold">{d.name}</div><div className="text-xs text-slate-500">{d.address}</div></> },
                  { key: 'o', label: 'Manager', render: (d) => ownerLabel(d.ownerId) },
                  { key: 's', label: 'Status', render: (d) => <StatusPill tone={propertyTone(d.status)}>{PROPERTY_STATUS_LABEL[d.status] || d.status}</StatusPill> },
                  { key: 'dt', label: 'Submitted', render: (d) => new Date(d.submittedAt).toLocaleDateString() },
                  { key: 'a', label: '', render: (d) => (
                    <button type="button" className="text-sm font-semibold text-[#2563eb]" onClick={() => setSelectedApprovalId(selectedApprovalId === d.id ? null : d.id)}>
                      {selectedApprovalId === d.id ? 'Hide' : 'Details'}
                    </button>
                  ) },
                ]}
                rows={searchedRejectedProperties.map((p) => ({ key: p.id, data: p }))}
              />
              {approval && propertiesSection === 'rejected' ? (
                <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
                  <div className="flex justify-between gap-2">
                    <h2 className="text-lg font-black">{approval.name}</h2>
                    <button type="button" className="text-sm text-slate-500" onClick={() => setSelectedApprovalId(null)}>Close</button>
                  </div>
                  <p className="text-sm text-slate-600">{approval.description}</p>
                  <PropertyDetailPanel property={approval} ownerLabel={ownerLabel(approval.ownerId)} />
                </div>
              ) : null}
            </>
          )}
        </div>
      )}

      {tab === 'accounts' && ((
        () => {
          const selectedManagerAccount = accounts.find((a) => a.id === selectedManagerAccountId) ?? null
          return (
            <div className="space-y-6">
              <div>
                <div className="mb-4">
                  <h1 className="text-2xl font-black">Managers</h1>
                </div>
                <div className="inline-flex flex-wrap gap-1 rounded-2xl border border-slate-200 bg-slate-50 p-1">
                  {[['current', 'Current subscribers', accounts.filter((a) => a.enabled !== false).length], ['past', 'Past subscribers', accounts.filter((a) => a.enabled === false).length]].map(([key, label, count]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => { setManagersFilter(key); setSelectedManagerAccountId(null) }}
                      className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                        managersFilter === key
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {label}
                      <span className="ml-1.5 tabular-nums text-slate-500">({count})</span>
                    </button>
                  ))}
                </div>
              </div>
              <DataTable
                empty={`No ${managersFilter === 'current' ? 'active' : 'past'} managers`}
                columns={[
                  { key: 'n', label: 'Account', render: (d) => <><div className="font-semibold">{d.businessName || d.name}</div><div className="text-xs text-slate-500">{d.email}</div></> },
                  { key: 'h', label: 'House / property', render: (d) => <span className="text-slate-700">{d.managedHousesLabel || '—'}</span> },
                  { key: 'v', label: 'Verification', render: (d) => <StatusPill tone={d.verificationStatus === 'verified' ? 'green' : 'amber'}>{d.verificationStatus}</StatusPill> },
                  { key: 'p', label: 'Properties', render: (d) => d.propertyCount },
                  { key: 'act', label: '', render: (d) => (
                    <button
                      type="button"
                      className="text-sm font-semibold text-[#2563eb] hover:underline"
                      onClick={() => setSelectedManagerAccountId(selectedManagerAccountId === d.id ? null : d.id)}
                    >
                      {selectedManagerAccountId === d.id ? 'Hide details' : 'Details'}
                    </button>
                  ) },
                ]}
                rows={searchedAccounts.map((a) => ({ key: a.id, data: a }))}
              />
              {selectedManagerAccount ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="mb-5 flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-lg font-black text-slate-900">{selectedManagerAccount.businessName || selectedManagerAccount.name}</h2>
                      <p className="mt-0.5 text-sm text-slate-500">{selectedManagerAccount.email}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedManagerAccountId(null)}
                      className="rounded-lg p-1 text-slate-400 hover:text-slate-600"
                      aria-label="Close"
                    >
                      <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                    </button>
                  </div>
                  <dl className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">House / property</dt>
                      <dd className="mt-1 text-sm text-slate-800">{selectedManagerAccount.managedHousesLabel || '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Properties</dt>
                      <dd className="mt-1 text-sm text-slate-800">{selectedManagerAccount.propertyCount}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Verification</dt>
                      <dd className="mt-1"><StatusPill tone={selectedManagerAccount.verificationStatus === 'verified' ? 'green' : 'amber'}>{selectedManagerAccount.verificationStatus}</StatusPill></dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Status</dt>
                      <dd className="mt-1"><StatusPill tone={selectedManagerAccount.enabled !== false ? 'green' : 'red'}>{selectedManagerAccount.enabled !== false ? 'Active' : 'Disabled'}</StatusPill></dd>
                    </div>
                  </dl>
                  <div className="mt-6 border-t border-slate-100 pt-5">
                    <button
                      type="button"
                      disabled={managerActionBusy}
                      className={`rounded-2xl px-5 py-2.5 text-sm font-semibold transition disabled:opacity-50 ${
                        selectedManagerAccount.enabled !== false
                          ? 'bg-red-50 text-red-700 hover:bg-red-100'
                          : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                      }`}
                      onClick={async () => {
                        const next = selectedManagerAccount.enabled === false
                        setManagerActionBusy(true)
                        setAccounts((ac) => ac.map((x) => (x.id === selectedManagerAccount.id ? { ...x, enabled: next } : x)))
                        try {
                          await adminSetManagerActive(selectedManagerAccount.id, next)
                          toast.success(next ? 'Manager account enabled' : 'Manager account disabled')
                          await refreshPortalData()
                        } catch (err) {
                          toast.error(err?.message || 'Could not update manager')
                          await refreshPortalData()
                        } finally {
                          setManagerActionBusy(false)
                        }
                      }}
                    >
                      {managerActionBusy ? 'Saving…' : selectedManagerAccount.enabled !== false ? 'Disable account' : 'Enable account'}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )
        }
      )())}

      {tab === 'messages' && (
        <ManagerInboxPage
          adminFullInbox
          manager={{ email: user.email || '', name: user.name || user.email || 'Admin' }}
          allowedPropertyNames={[]}
          adminComposeManagers={accounts
            .filter((a) => String(a.email || '').includes('@'))
            .map((a) => ({
              id: a.id,
              email: String(a.email).trim().toLowerCase(),
              label: `${a.businessName || a.name || 'Manager'} · ${a.email}`,
            }))}
          adminComposeResidents={residents
            .filter((r) => r.id && String(r.id).startsWith('rec'))
            .map((r) => ({
              id: r.id,
              email: String(r.Email || '').trim(),
              label: [r.Name, r.House].filter(Boolean).join(' · ') || String(r.Email || r.id),
            }))}
        />
      )}

      {tab === 'profile' && (
        <AdminProfilePanel
          user={user}
          onUserUpdate={(partial) => {
            setSession((prev) => {
              if (!prev) return prev
              const next = { ...prev, ...partial }
              try {
                sessionStorage.setItem(AXIS_ADMIN_SESSION_KEY, JSON.stringify(next))
              } catch {
                /* ignore */
              }
              return next
            })
          }}
        />
      )}
      </div>
    </PortalShell>
  )
}

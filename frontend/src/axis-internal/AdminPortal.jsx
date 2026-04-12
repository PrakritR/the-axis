import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import ManagerInboxPage from '../components/manager-inbox/ManagerInboxPage'
import PortalShell, { StatCard, StatusPill, DataTable } from '../components/PortalShell'
import {
  adminApproveProperty,
  adminRejectApplication,
  adminRejectProperty,
  adminRequestPropertyEdits,
  adminSetManagerActive,
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

export { AXIS_ADMIN_SESSION_KEY } from './adminSessionConstants'

const PROPERTY_STATUS_LABEL = {
  pending: 'Pending approval',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  rejected: 'Rejected',
  live: 'Live',
  inactive: 'Inactive',
}

const NAV_BASE = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'properties', label: 'Properties' },
  { id: 'accounts', label: 'Managers' },
  { id: 'applications', label: 'Applications' },
  { id: 'messages', label: 'Inbox' },
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
  return 'slate'
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
    <div className="rounded-[24px] border border-violet-300/60 bg-[linear-gradient(135deg,#f5f3ff_0%,#ffffff_100%)] p-5 shadow-sm">
      <h2 className="text-sm font-black text-violet-950">Open portals as a specific account</h2>
      <p className="mt-1 text-xs text-violet-900/80">
        Select a real manager or resident profile to jump directly into their portal session.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-violet-700">Manager portal</div>
          <div className="flex gap-2">
            <select
              value={selectedManagerId}
              onChange={(e) => setSelectedManagerId(e.target.value)}
              className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400/30"
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
              className="rounded-xl bg-violet-600 px-3 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Open
            </button>
          </div>
        </div>
        <div>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-violet-700">Resident portal</div>
          <div className="flex gap-2">
            <select
              value={selectedResidentId}
              onChange={(e) => setSelectedResidentId(e.target.value)}
              className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-400/30"
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
              className="rounded-xl bg-violet-600 px-3 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
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
      <div className="w-full max-w-md rounded-[28px] border border-slate-700 bg-slate-800 p-8 shadow-xl">
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
  const [tab, setTab] = useState('dashboard')
  /** Within Properties: approval queue vs full directory */
  const [propertiesSection, setPropertiesSection] = useState('queue')
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
  const airtableConfigWarned = useRef(false)

  const user = session

  useEffect(() => {
    if (session?.role === 'ceo') markDeveloperPortalActive()
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
    if (u?.role === 'ceo' || u?.role === 'internal_exec' || u?.role === 'internal_swe') {
      markDeveloperPortalActive()
    }
  }

  function handleSignOut() {
    sessionStorage.removeItem(AXIS_ADMIN_SESSION_KEY)
    clearDeveloperPortalFlags()
    setSession(null)
  }

  useEffect(() => {
    if (tab !== 'applications') setSelectedApplicationId(null)
  }, [tab])

  useEffect(() => {
    if (tab !== 'properties' || propertiesSection !== 'queue') setSelectedApprovalId(null)
  }, [tab, propertiesSection])

  const navItems = useMemo(() => NAV_BASE, [])

  const pendingApprovals = useMemo(() => properties.filter((p) => p.status === 'pending' || p.status === 'changes_requested'), [properties])
  const pendingApps = useMemo(
    () => applications.filter((a) => a.approvalPending).length,
    [applications],
  )

  const sortedAccounts = useMemo(
    () => sortAccountsByMode(accounts, managerTableSort),
    [accounts, managerTableSort],
  )
  const sortedApplications = useMemo(
    () => sortApplicationsByMode(applications, applicationsTableSort),
    [applications, applicationsTableSort],
  )

  const ownerLabel = (ownerId) => accounts.find((a) => a.id === ownerId)?.businessName || accounts.find((a) => a.id === ownerId)?.name || ownerId

  if (!session) {
    return <AdminLoginView onAuthenticated={persistSession} />
  }

  const approval = properties.find((p) => p.id === selectedApprovalId)
  const selectedApplication = applications.find((a) => a.id === selectedApplicationId)

  return (
    <PortalShell
      brandTitle="Axis"
      brandSubtitle="Admin portal"
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
        <div className="space-y-8">
          <h1 className="text-2xl font-black text-slate-900">Admin dashboard</h1>
          {dataLoading ? (
            <p className="text-sm text-slate-500">Syncing data…</p>
          ) : null}
          {isAdminPortalAirtableConfigured() ? (
            <PortalHandoffCard accounts={accounts} residents={residents} user={user} />
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Property approvals queue"
              value={pendingApprovals.length}
              onClick={() => {
                setTab('properties')
                setPropertiesSection('queue')
              }}
            />
            <StatCard
              label="All properties"
              value={properties.length}
              onClick={() => {
                setTab('properties')
                setPropertiesSection('directory')
              }}
            />
            <StatCard label="Pending applications" value={pendingApps} onClick={() => setTab('applications')} />
            <StatCard label="Managers" value={accounts.length} onClick={() => setTab('accounts')} />
            <StatCard label="Inbox" value="Open" onClick={() => setTab('messages')} />
          </div>
        </div>
      )}

      {tab === 'properties' && (
        <div className="space-y-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-2xl font-black text-slate-900">
                {propertiesSection === 'queue' ? 'Property approvals' : 'All properties'}
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                {propertiesSection === 'queue'
                  ? 'Review submissions and approve, request edits, or reject.'
                  : 'Directory of every property in the system.'}
              </p>
            </div>
            <div className="inline-flex flex-wrap gap-1 rounded-2xl border border-slate-200 bg-slate-50 p-1">
              <button
                type="button"
                onClick={() => setPropertiesSection('queue')}
                className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                  propertiesSection === 'queue'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Approvals queue
                {pendingApprovals.length > 0 ? (
                  <span className="ml-1.5 tabular-nums text-slate-500">({pendingApprovals.length})</span>
                ) : null}
              </button>
              <button
                type="button"
                onClick={() => setPropertiesSection('directory')}
                className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                  propertiesSection === 'directory'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All properties
                <span className="ml-1.5 tabular-nums text-slate-500">({properties.length})</span>
              </button>
            </div>
          </div>

          {propertiesSection === 'queue' ? (
            <>
              <DataTable
                empty="No properties awaiting review."
                columns={[
                  { key: 'n', label: 'Property', render: (d) => <><div className="font-semibold">{d.name}</div><div className="text-xs text-slate-500">{d.address}</div></> },
                  { key: 'o', label: 'Owner / partner', render: (d) => ownerLabel(d.ownerId) },
                  { key: 's', label: 'Status', render: (d) => <StatusPill tone={propertyTone(d.status)}>{PROPERTY_STATUS_LABEL[d.status] || d.status}</StatusPill> },
                  { key: 'dt', label: 'Submitted', render: (d) => new Date(d.submittedAt).toLocaleDateString() },
                  { key: 'a', label: '', render: (d) => (
                    <button type="button" className="text-sm font-semibold text-[#2563eb]" onClick={() => setSelectedApprovalId(d.id)}>Review</button>
                  ) },
                ]}
                rows={pendingApprovals.map((p) => ({ key: p.id, data: p }))}
              />
              {approval ? (
                <div className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm space-y-4">
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
          ) : (
            <DataTable
              empty="No properties."
              columns={[
                { key: 'n', label: 'Property', render: (d) => d.name },
                { key: 'o', label: 'Partner', render: (d) => ownerLabel(d.ownerId) },
                { key: 's', label: 'Status', render: (d) => <StatusPill tone={propertyTone(d.status)}>{PROPERTY_STATUS_LABEL[d.status] || d.status}</StatusPill> },
                { key: 'r', label: 'From', render: (d) => `$${d.rentFrom}` },
              ]}
              rows={properties.map((p) => ({ key: p.id, data: p }))}
            />
          )}
        </div>
      )}

      {tab === 'accounts' && (
        <div className="space-y-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h1 className="text-2xl font-black">Managers</h1>
            <label className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
              <span className="font-semibold text-slate-800">Sort by</span>
              <select
                className={adminSelectCls}
                value={managerTableSort}
                onChange={(e) => setManagerTableSort(e.target.value)}
              >
                <option value="house_asc">House (A–Z)</option>
                <option value="house_desc">House (Z–A)</option>
                <option value="account_asc">Account (A–Z)</option>
              </select>
            </label>
          </div>
          <DataTable
            empty="No accounts."
            columns={[
              { key: 'n', label: 'Account', render: (d) => <><div className="font-semibold">{d.businessName || d.name}</div><div className="text-xs text-slate-500">{d.email}</div></> },
              { key: 'h', label: 'House / property', render: (d) => <span className="text-slate-700">{d.managedHousesLabel || '—'}</span> },
              { key: 'v', label: 'Verification', render: (d) => <StatusPill tone={d.verificationStatus === 'verified' ? 'green' : 'amber'}>{d.verificationStatus}</StatusPill> },
              { key: 'p', label: 'Properties', render: (d) => d.propertyCount },
              { key: 'en', label: 'Enabled', render: (d) => (
                <button
                  type="button"
                  className="text-xs font-semibold text-[#2563eb]"
                  onClick={async () => {
                    const next = !d.enabled
                    setAccounts((ac) => ac.map((x) => (x.id === d.id ? { ...x, enabled: next } : x)))
                    try {
                      await adminSetManagerActive(d.id, next)
                      toast.success(next ? 'Manager activated' : 'Manager deactivated')
                      await refreshPortalData()
                    } catch (err) {
                      toast.error(err?.message || 'Could not update manager')
                      await refreshPortalData()
                    }
                  }}
                >
                  {d.enabled !== false ? 'Disable' : 'Enable'}
                </button>
              ) },
            ]}
            rows={sortedAccounts.map((a) => ({ key: a.id, data: a }))}
          />
        </div>
      )}

      {tab === 'applications' && (
        <div className="space-y-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h1 className="text-2xl font-black">Applications</h1>
            <label className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
              <span className="font-semibold text-slate-800">Sort by</span>
              <select
                className={adminSelectCls}
                value={applicationsTableSort}
                onChange={(e) => setApplicationsTableSort(e.target.value)}
              >
                <option value="house_asc">House (A–Z)</option>
                <option value="house_desc">House (Z–A)</option>
                <option value="applicant_asc">Applicant (A–Z)</option>
              </select>
            </label>
          </div>
          <DataTable
            empty="No applications."
            columns={[
              { key: 'p', label: 'House / property', render: (d) => d.propertyName },
              { key: 'a', label: 'Applicant', render: (d) => d.applicantName },
              { key: 'o', label: 'Partner', render: (d) => ownerLabel(d.ownerId) },
              { key: 's', label: 'Status', render: (d) => <StatusPill tone="blue">{d.status}</StatusPill> },
              {
                key: 'act',
                label: '',
                render: (d) => (
                  <button
                    type="button"
                    className="text-sm font-semibold text-[#2563eb] hover:underline"
                    onClick={() => setSelectedApplicationId(selectedApplicationId === d.id ? null : d.id)}
                  >
                    {selectedApplicationId === d.id ? 'Hide details' : 'Details'}
                  </button>
                ),
              },
            ]}
            rows={sortedApplications.map((a) => ({ key: a.id, data: a }))}
          />
          {selectedApplication ? (
            <ApplicationDetailPanel
              application={selectedApplication}
              partnerLabel={ownerLabel(selectedApplication.ownerId)}
              onClose={() => setSelectedApplicationId(null)}
              adminReview={
                selectedApplication.approvalPending && canReviewApplicationsFromAdmin()
                  ? {
                      busy: applicationReviewBusy,
                      onApprove: async () => {
                        const id = selectedApplication.id
                        if (!id) return
                        setApplicationReviewBusy(true)
                        try {
                          const { name: managerName, role: managerRole } = adminApplicationActorMeta(user)
                          const res = await fetch('/api/portal?action=manager-approve-application', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              applicationRecordId: id,
                              managerName,
                              managerRole,
                            }),
                          })
                          const data = await readJsonResponse(res)
                          if (!res.ok) throw new Error(data.error || 'Could not approve application')
                          await refreshPortalData()
                          if (Array.isArray(data.residentRecordsUpdated) && data.residentRecordsUpdated.length > 0) {
                            toast.success(
                              (data.message || 'Application approved.') +
                                ` Resident portal updated (${data.residentRecordsUpdated.length} profile${data.residentRecordsUpdated.length === 1 ? '' : 's'}).`,
                            )
                          } else {
                            toast.success(data.message || 'Application approved.')
                          }
                          setSelectedApplicationId(null)
                        } catch (e) {
                          toast.error(e?.message || 'Approve failed')
                        } finally {
                          setApplicationReviewBusy(false)
                        }
                      },
                      onReject: async () => {
                        const id = selectedApplication.id
                        if (!id) return
                        setApplicationReviewBusy(true)
                        try {
                          await adminRejectApplication(id)
                          await refreshPortalData()
                          toast.success('Application rejected.')
                          setSelectedApplicationId(null)
                        } catch (e) {
                          toast.error(e?.message || 'Reject failed')
                        } finally {
                          setApplicationReviewBusy(false)
                        }
                      },
                    }
                  : null
              }
            />
          ) : null}
        </div>
      )}

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
      </div>
    </PortalShell>
  )
}

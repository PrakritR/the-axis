import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import ManagerInboxPage from '../components/manager-inbox/ManagerInboxPage'
import PortalShell, { StatCard, StatusPill, DataTable } from '../components/PortalShell'
import {
  adminApproveProperty,
  adminRejectProperty,
  adminRequestPropertyEdits,
  adminSetManagerActive,
  isAdminPortalAirtableConfigured,
  loadAdminPortalDataset,
} from '../lib/adminPortalAirtable.js'
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
  { id: 'approvals', label: 'Property approvals' },
  { id: 'properties', label: 'Properties' },
  { id: 'accounts', label: 'Managers' },
  { id: 'applications', label: 'Applications' },
  { id: 'messages', label: 'Inbox' },
]

const APPROVER_ONLY_NAV = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'approvals', label: 'Property approvals' },
]

/** Internal staff can open portal test flows from the admin console. */
function showInternalPortalHandoff(role) {
  return role === 'ceo' || role === 'internal_exec' || role === 'internal_swe'
}

function showOwnerPortalJumps(role) {
  return role === 'owner' || role === 'ceo' || role === 'internal_exec' || role === 'internal_swe'
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
        if (result.user.role === 'ceo') {
          toast.success('Signed in as CEO')
        } else if (result.user.role === 'internal_exec') {
          toast.success('Signed in (executive)')
        } else if (result.user.role === 'internal_swe') {
          toast.success('Signed in (engineering)')
        } else if (result.user.role === 'internal_approver') {
          toast.success('Signed in (approvals)')
        } else if (result.user.role === 'owner') {
          toast.success('Signed in as site owner')
        } else {
          toast.success('Signed in')
        }
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
        <h1 className="mt-2 text-2xl font-black text-white">Internal portal</h1>
        <p className="mt-2 text-sm text-slate-400">
          Use the email and password from your internal <strong>Admin Profile</strong>, or the env CEO / site owner account configured on the server.
        </p>

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
  const [properties, setProperties] = useState(() => [])
  const [accounts, setAccounts] = useState(() => [])
  const [applications, setApplications] = useState(() => [])
  const [selectedApprovalId, setSelectedApprovalId] = useState(null)
  const [selectedApplicationId, setSelectedApplicationId] = useState(null)
  const [dataLoading, setDataLoading] = useState(false)
  const [approvalBusy, setApprovalBusy] = useState(false)
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
      const next = await loadAdminPortalDataset()
      setProperties(next.properties)
      setAccounts(next.accounts)
      setApplications(next.applications)
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
    if (!session) return
    if (session.role === 'internal_approver' && tab !== 'dashboard' && tab !== 'approvals') {
      setTab('dashboard')
    }
  }, [session, tab])

  useEffect(() => {
    if (tab !== 'applications') setSelectedApplicationId(null)
  }, [tab])

  const navItems = useMemo(() => {
    if (!session) return NAV_BASE
    if (session.role === 'internal_approver') return APPROVER_ONLY_NAV
    return NAV_BASE
  }, [session])

  const pendingApprovals = useMemo(() => properties.filter((p) => p.status === 'pending' || p.status === 'changes_requested'), [properties])
  const pendingApps = useMemo(
    () => applications.filter((a) => a.approvalPending).length,
    [applications],
  )

  const ownerLabel = (ownerId) => accounts.find((a) => a.id === ownerId)?.businessName || accounts.find((a) => a.id === ownerId)?.name || ownerId

  if (!session) {
    return <AdminLoginView onAuthenticated={persistSession} />
  }

  const approval = properties.find((p) => p.id === selectedApprovalId)
  const selectedApplication = applications.find((a) => a.id === selectedApplicationId)

  return (
    <PortalShell
      brandTitle="Axis internal"
      brandSubtitle={
        user.role === 'ceo'
          ? 'CEO'
          : user.role === 'internal_exec'
            ? 'Executive'
            : user.role === 'internal_swe'
              ? 'Engineering'
              : user.role === 'internal_approver'
                ? 'Approvals'
                : 'Admin portal'
      }
      navItems={navItems}
      activeId={tab}
      onNavigate={setTab}
      userLabel={user.name}
      userMeta={
        user.role === 'owner'
          ? 'Site owner'
          : user.role === 'ceo'
            ? 'CEO · full access'
            : user.role === 'internal_exec'
              ? `${user.airtableRole || 'Executive'} · full access`
              : user.role === 'internal_swe'
                ? `${user.airtableRole || 'SWE'} · full test access`
                : user.role === 'internal_approver'
                  ? 'Property approvals only'
                  : user.role || 'Admin'
      }
      onSignOut={handleSignOut}
    >
      {tab === 'dashboard' && (
        <div className="space-y-8">
          <h1 className="text-2xl font-black text-slate-900">
            {user.role === 'ceo'
              ? 'CEO dashboard'
              : user.role === 'internal_exec'
                ? 'Executive dashboard'
                : user.role === 'internal_swe'
                  ? 'Engineering dashboard'
                  : user.role === 'internal_approver'
                    ? 'Approvals dashboard'
                    : 'Admin dashboard'}
          </h1>
          {dataLoading ? (
            <p className="text-sm text-slate-500">Syncing data…</p>
          ) : null}
          {showInternalPortalHandoff(user.role) ? (
            <div className="rounded-[24px] border border-violet-300/60 bg-[linear-gradient(135deg,#f5f3ff_0%,#ffffff_100%)] p-5 shadow-sm">
              <h2 className="text-sm font-black text-violet-950">Open test portals</h2>
              <p className="mt-2 text-xs text-violet-900/80">
                Use the shared test records in your workspace to verify manager, resident, and admin flows end-to-end.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (user.role === 'ceo') {
                      seedDeveloperManagerSession()
                    } else {
                      seedInternalStaffManagerSession({
                        email: user.email,
                        name: user.name,
                        staffRole: user.airtableRole || user.role,
                      })
                    }
                    window.location.assign('/manager')
                  }}
                  className="rounded-xl bg-violet-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
                >
                  Open manager test portal
                </button>
                <a
                  href="/portal?portal=resident"
                  className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Open resident test login
                </a>
              </div>
            </div>
          ) : null}
          {showOwnerPortalJumps(user.role) ? (
            <div className="rounded-[24px] border border-[#2563eb]/25 bg-[linear-gradient(135deg,#eff6ff_0%,#ffffff_100%)] p-5 shadow-sm">
              <h2 className="text-sm font-black text-slate-900">Jump to other portals</h2>
              <div className="mt-4 flex flex-wrap gap-2">
                <a
                  href="/portal"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Resident hub
                </a>
                <a
                  href="/manager"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center rounded-xl bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] px-4 py-2 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
                >
                  Manager portal
                </a>
              </div>
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {user.role === 'internal_approver' ? (
              <StatCard label="Property approvals queue" value={pendingApprovals.length} onClick={() => setTab('approvals')} />
            ) : (
              <>
                <StatCard label="Property approvals queue" value={pendingApprovals.length} onClick={() => setTab('approvals')} />
                <StatCard label="Properties" value={properties.length} onClick={() => setTab('properties')} />
                <StatCard label="Pending applications" value={pendingApps} onClick={() => setTab('applications')} />
                <StatCard label="Managers" value={accounts.length} onClick={() => setTab('accounts')} />
                <StatCard label="Inbox" value="Open" onClick={() => setTab('messages')} />
              </>
            )}
          </div>
        </div>
      )}

      {tab === 'approvals' && (
        <div className="space-y-6">
          <h1 className="text-2xl font-black">Property approvals</h1>
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
        </div>
      )}

      {tab === 'properties' && (
        <div className="space-y-6">
          <h1 className="text-2xl font-black">Properties</h1>
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
        </div>
      )}

      {tab === 'accounts' && (
        <div className="space-y-6">
          <h1 className="text-2xl font-black">Managers</h1>
          <DataTable
            empty="No accounts."
            columns={[
              { key: 'n', label: 'Account', render: (d) => <><div className="font-semibold">{d.businessName || d.name}</div><div className="text-xs text-slate-500">{d.email}</div></> },
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
            rows={accounts.map((a) => ({ key: a.id, data: a }))}
          />
        </div>
      )}

      {tab === 'applications' && (
        <div className="space-y-6">
          <h1 className="text-2xl font-black">Applications</h1>
          <DataTable
            empty="No applications."
            columns={[
              { key: 'a', label: 'Applicant', render: (d) => d.applicantName },
              { key: 'p', label: 'Property', render: (d) => d.propertyName },
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
            rows={applications.map((a) => ({ key: a.id, data: a }))}
          />
          {selectedApplication ? (
            <ApplicationDetailPanel
              application={selectedApplication}
              partnerLabel={ownerLabel(selectedApplication.ownerId)}
              onClose={() => setSelectedApplicationId(null)}
            />
          ) : null}
        </div>
      )}

      {tab === 'messages' && (
        <ManagerInboxPage
          adminFullInbox
          manager={{ email: user.email || '', name: user.name || user.email || 'Admin' }}
          allowedPropertyNames={[]}
        />
      )}
    </PortalShell>
  )
}

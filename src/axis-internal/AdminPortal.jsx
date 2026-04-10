import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import PortalInternalInbox from '../components/PortalInternalInbox'
import PortalShell, { StatCard, StatusPill, DataTable } from '../components/PortalShell'
import {
  adminApproveProperty,
  adminPatchInquiryLeadStatus,
  adminPublishLeaseDraft,
  adminRejectProperty,
  adminRequestPropertyEdits,
  adminSetManagerActive,
  isAdminPortalAirtableConfigured,
  loadAdminPortalDataset,
} from '../lib/adminPortalAirtable.js'

const PROPERTY_STATUS_LABEL = {
  pending: 'Pending approval',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  rejected: 'Rejected',
  live: 'Live',
  inactive: 'Inactive',
}

const LEASE_PIPELINE_LABEL = {
  draft: 'Draft generated',
  under_review: 'Under review',
  manager_ok: 'Approved by manager',
  admin_review: 'Awaiting Axis admin',
  admin_ok: 'Approved by admin',
  sent_resident: 'Sent to resident',
  signed: 'Signed',
  archived: 'Archived',
}

const LEAD_STATUS_LABEL = {
  new: 'New lead',
  contacted: 'Contacted',
  follow_up: 'Follow-up needed',
  qualified: 'Qualified',
  onboarded: 'Onboarded',
  closed: 'Closed',
}
import {
  approveAdminRequest,
  denyAdminRequest,
  listPendingAdminRequests,
  submitAdminAccessRequest,
} from '../lib/adminPortalLocalAuth'
import { authenticateAdminPortal } from '../lib/adminPortalSignIn'
import {
  markDeveloperPortalActive,
  clearDeveloperPortalFlags,
  seedDeveloperManagerSession,
} from '../lib/developerPortal'
import { AXIS_ADMIN_SESSION_KEY } from './adminSessionConstants'

export { AXIS_ADMIN_SESSION_KEY } from './adminSessionConstants'

const NAV_BASE = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'approvals', label: 'Property approvals' },
  { id: 'properties', label: 'All properties' },
  { id: 'leads', label: 'Management leads' },
  { id: 'accounts', label: 'Management accounts' },
  { id: 'applications', label: 'Applications' },
  { id: 'leases', label: 'Lease approval' },
  { id: 'messages', label: 'Messages' },
  { id: 'access', label: 'Admin access' },
  { id: 'settings', label: 'Settings' },
]

const loginInputCls =
  'mt-1 w-full rounded-xl border border-slate-600 bg-slate-900/40 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-500/40'

function propertyTone(st) {
  if (st === 'live') return 'green'
  if (st === 'pending') return 'amber'
  if (st === 'changes_requested') return 'violet'
  if (st === 'rejected') return 'red'
  return 'slate'
}

function leadTone(st) {
  if (st === 'new') return 'amber'
  if (st === 'qualified' || st === 'onboarded') return 'green'
  if (st === 'closed') return 'slate'
  return 'blue'
}

function AdminLoginView({ onAuthenticated }) {
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [reqName, setReqName] = useState('')
  const [reqEmail, setReqEmail] = useState('')
  const [reqPassword, setReqPassword] = useState('')
  const [reqDone, setReqDone] = useState(false)

  async function handleSignIn(e) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      const result = await authenticateAdminPortal(email, password)
      if (result.ok) {
        onAuthenticated(result.user)
        if (result.user.role === 'developer') {
          toast.success('Developer console unlocked')
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

  async function handleRequestAccess(e) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      await submitAdminAccessRequest({ name: reqName, email: reqEmail, password: reqPassword })
      setReqDone(true)
      toast.success('Request submitted for owner review')
    } catch (ex) {
      setErr(ex?.message || 'Could not submit request')
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
          Sign in at this URL only. Site owner uses server-configured credentials; other admins are approved by the owner or developer.
        </p>

        <div className="mt-6 flex gap-1 rounded-2xl border border-slate-600 bg-slate-900/50 p-1">
          <button
            type="button"
            onClick={() => {
              setMode('signin')
              setErr('')
            }}
            className={`flex-1 rounded-xl py-2.5 text-sm font-semibold transition ${
              mode === 'signin' ? 'bg-sky-500 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('request')
              setErr('')
            }}
            className={`flex-1 rounded-xl py-2.5 text-sm font-semibold transition ${
              mode === 'request' ? 'bg-sky-500 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            Request access
          </button>
        </div>

        {mode === 'signin' ? (
          <form onSubmit={handleSignIn} className="mt-6 space-y-4">
            <label className="block text-sm font-semibold text-slate-300">
              Work email or developer username
              <input
                type="text"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={loginInputCls}
                placeholder="you@company.com or prakrit"
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
        ) : reqDone ? (
          <div className="mt-6 rounded-2xl border border-emerald-700/50 bg-emerald-950/40 px-4 py-4 text-sm text-emerald-100">
            Your request is pending. The site owner can approve or deny it under <strong>Admin access</strong> after signing in.
          </div>
        ) : (
          <form onSubmit={handleRequestAccess} className="mt-6 space-y-4">
            <label className="block text-sm font-semibold text-slate-300">
              Full name
              <input
                required
                value={reqName}
                onChange={(e) => setReqName(e.target.value)}
                className={loginInputCls}
              />
            </label>
            <label className="block text-sm font-semibold text-slate-300">
              Work email
              <input
                type="email"
                required
                value={reqEmail}
                onChange={(e) => setReqEmail(e.target.value)}
                className={loginInputCls}
              />
            </label>
            <label className="block text-sm font-semibold text-slate-300">
              Choose password
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={reqPassword}
                onChange={(e) => setReqPassword(e.target.value)}
                className={loginInputCls}
              />
            </label>
            <p className="text-xs text-slate-500">You will use this email and password at the same /admin sign-in after approval.</p>
            {err ? <p className="text-sm text-red-300">{err}</p> : null}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-2xl bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] py-3 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(37,99,235,0.25)] transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Submitting…' : 'Submit request'}
            </button>
          </form>
        )}
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
  const [leads, setLeads] = useState(() => [])
  const [accounts, setAccounts] = useState(() => [])
  const [applications, setApplications] = useState(() => [])
  const [leasePipeline, setLeasePipeline] = useState(() => [])
  const [selectedApprovalId, setSelectedApprovalId] = useState(null)
  const [accessTick, setAccessTick] = useState(0)
  const [dataLoading, setDataLoading] = useState(false)
  const [approvalBusy, setApprovalBusy] = useState(false)
  const airtableConfigWarned = useRef(false)

  const user = session

  useEffect(() => {
    if (session?.role === 'developer') markDeveloperPortalActive()
  }, [session])

  const refreshPortalData = useCallback(async () => {
    if (!session) return
    if (!isAdminPortalAirtableConfigured()) return
    setDataLoading(true)
    try {
      const next = await loadAdminPortalDataset()
      setProperties(next.properties)
      setLeads(next.leads)
      setAccounts(next.accounts)
      setApplications(next.applications)
      setLeasePipeline(next.leasePipeline)
    } catch (e) {
      toast.error(e?.message || 'Could not load Airtable data.')
    } finally {
      setDataLoading(false)
    }
  }, [session])

  useEffect(() => {
    if (!session) return
    if (!isAdminPortalAirtableConfigured()) {
      if (!airtableConfigWarned.current) {
        airtableConfigWarned.current = true
        toast.error('Admin data needs VITE_AIRTABLE_TOKEN and VITE_AIRTABLE_BASE_ID (same as manager portal).')
      }
      return
    }
    refreshPortalData()
  }, [session, refreshPortalData])

  function persistSession(u) {
    setSession(u)
    sessionStorage.setItem(AXIS_ADMIN_SESSION_KEY, JSON.stringify(u))
    if (u?.role === 'developer') {
      markDeveloperPortalActive()
    }
  }

  function handleSignOut() {
    sessionStorage.removeItem(AXIS_ADMIN_SESSION_KEY)
    clearDeveloperPortalFlags()
    setSession(null)
  }

  useEffect(() => {
    if (session && session.role !== 'owner' && session.role !== 'developer' && tab === 'access') {
      setTab('dashboard')
    }
  }, [session, tab])

  const navItems = useMemo(() => {
    if (!session || session.role === 'owner' || session.role === 'developer') return NAV_BASE
    return NAV_BASE.filter((n) => n.id !== 'access')
  }, [session])

  const pendingAdminRows = useMemo(() => {
    if (tab !== 'access') return []
    return listPendingAdminRequests().map((p) => ({ key: p.id, data: p }))
  }, [tab, accessTick])

  const pendingApprovals = useMemo(() => properties.filter((p) => p.status === 'pending' || p.status === 'changes_requested'), [properties])
  const liveCount = useMemo(() => properties.filter((p) => p.status === 'live').length, [properties])
  const newLeads = useMemo(() => leads.filter((l) => l.status === 'new').length, [leads])
  const pendingApps = useMemo(
    () => applications.filter((a) => a.approvalPending).length,
    [applications],
  )
  const leasesNeedAdmin = useMemo(
    () => leasePipeline.filter((l) => l.status === 'admin_review').length,
    [leasePipeline],
  )
  const leasesSent = useMemo(
    () => leasePipeline.filter((l) => l.status === 'sent_resident').length,
    [leasePipeline],
  )

  const ownerLabel = (ownerId) => accounts.find((a) => a.id === ownerId)?.businessName || accounts.find((a) => a.id === ownerId)?.name || ownerId

  if (!session) {
    return <AdminLoginView onAuthenticated={persistSession} />
  }

  const approval = properties.find((p) => p.id === selectedApprovalId)

  return (
    <PortalShell
      brandTitle="Axis internal"
      brandSubtitle={user.role === 'developer' ? 'Developer console' : 'Admin portal'}
      navItems={navItems}
      activeId={tab}
      onNavigate={setTab}
      userLabel={user.name}
      userMeta={
        user.role === 'owner'
          ? 'Site owner'
          : user.role === 'developer'
            ? 'Developer · Sentinel'
            : user.role === 'admin'
              ? 'Staff admin'
              : user.role || 'Admin'
      }
      onSignOut={handleSignOut}
    >
      {tab === 'dashboard' && (
        <div className="space-y-8">
          <h1 className="text-2xl font-black text-slate-900">
            {user.role === 'developer' ? 'Developer dashboard' : 'Admin dashboard'}
          </h1>
          {dataLoading ? (
            <p className="text-sm text-slate-500">Syncing data from Airtable…</p>
          ) : null}
          {user.role === 'developer' ? (
            <div className="rounded-[24px] border border-violet-300/60 bg-[linear-gradient(135deg,#f5f3ff_0%,#ffffff_100%)] p-5 shadow-sm">
              <h2 className="text-sm font-black text-violet-950">Sentinel access</h2>
              <p className="mt-1 text-xs text-violet-900/80">
                Full internal scope: approve staff admins and open the real manager portal with every property in scope (opens in this tab).
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    seedDeveloperManagerSession()
                    window.location.assign('/manager')
                  }}
                  className="rounded-xl bg-violet-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
                >
                  Manager portal (full scope)
                </button>
                <a
                  href="/portal"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Resident hub
                </a>
              </div>
            </div>
          ) : null}
          {user.role === 'owner' ? (
            <div className="rounded-[24px] border border-[#2563eb]/25 bg-[linear-gradient(135deg,#eff6ff_0%,#ffffff_100%)] p-5 shadow-sm">
              <h2 className="text-sm font-black text-slate-900">Jump to other portals</h2>
              <p className="mt-1 text-xs text-slate-600">
                Resident and manager links go to their normal entry points (real sign-in).
              </p>
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
            <StatCard label="Property approvals queue" value={pendingApprovals.length} onClick={() => setTab('approvals')} />
            <StatCard label="New management leads" value={newLeads} onClick={() => setTab('leads')} />
            <StatCard label="Live properties" value={liveCount} onClick={() => setTab('properties')} />
            <StatCard label="Pending applications" value={pendingApps} onClick={() => setTab('applications')} />
            <StatCard label="Leases awaiting admin" value={leasesNeedAdmin} onClick={() => setTab('leases')} />
            <StatCard label="Sent for signature" value={leasesSent} onClick={() => setTab('leases')} />
            <StatCard label="Management accounts" value={accounts.length} onClick={() => setTab('accounts')} />
            <StatCard label="Messages" value="Open" hint="Internal inbox" onClick={() => setTab('messages')} />
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
                      toast.success('Property approved in Airtable')
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
                      toast.success('Marked as changes requested in Airtable')
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
                      toast.success('Property rejected in Airtable')
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
          <h1 className="text-2xl font-black">All properties</h1>
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
          <p className="text-xs text-slate-500">Publish/unpublish, archive, and deep links to applications/leases will map to Airtable views.</p>
        </div>
      )}

      {tab === 'leads' && (
        <div className="space-y-6">
          <h1 className="text-2xl font-black">Management leads</h1>
          <DataTable
            empty="No leads."
            columns={[
              { key: 'name', label: 'Lead', render: (d) => <><div className="font-semibold">{d.name}</div><div className="text-xs text-slate-500">{d.email}</div></> },
              { key: 'src', label: 'Source', render: (d) => d.source },
              { key: 'st', label: 'Status', render: (d) => <StatusPill tone={leadTone(d.status)}>{LEAD_STATUS_LABEL[d.status] || d.status}</StatusPill> },
              { key: 'notes', label: 'Notes', render: (d) => <span className="line-clamp-2 text-xs">{d.notes}</span> },
              { key: 'act', label: '', render: (d) => (
                <select
                  className="rounded-lg border border-slate-200 text-xs"
                  value={d.status}
                  onChange={async (e) => {
                    const v = e.target.value
                    setLeads((ls) => ls.map((x) => (x.id === d.id ? { ...x, status: v } : x)))
                    try {
                      await adminPatchInquiryLeadStatus(d.id, v)
                      toast.success('Lead status saved')
                    } catch (err) {
                      toast.error(err?.message || 'Could not save (add a single-line field "Lead Status" to Inquiries).')
                      await refreshPortalData()
                    }
                  }}
                >
                  {Object.entries(LEAD_STATUS_LABEL).map(([k, lab]) => (
                    <option key={k} value={k}>{lab}</option>
                  ))}
                </select>
              ) },
            ]}
            rows={leads.map((l) => ({ key: l.id, data: l }))}
          />
          <p className="text-xs text-slate-500">Convert to Management account will create credentials + onboarding (integration stub).</p>
        </div>
      )}

      {tab === 'accounts' && (
        <div className="space-y-6">
          <h1 className="text-2xl font-black">Management accounts</h1>
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
          <h1 className="text-2xl font-black">All applications</h1>
          <DataTable
            empty="No applications."
            columns={[
              { key: 'a', label: 'Applicant', render: (d) => d.applicantName },
              { key: 'p', label: 'Property', render: (d) => d.propertyName },
              { key: 'o', label: 'Partner', render: (d) => ownerLabel(d.ownerId) },
              { key: 's', label: 'Status', render: (d) => <StatusPill tone="blue">{d.status}</StatusPill> },
              { key: 'act', label: '', render: () => (
                <span className="text-xs text-slate-400">→ Lease</span>
              ) },
            ]}
            rows={applications.map((a) => ({ key: a.id, data: a }))}
          />
          <p className="text-xs text-slate-500">Final approve/reject and handoff to lease generation connect to existing Applications / Lease Drafts tables.</p>
        </div>
      )}

      {tab === 'leases' && (
        <div className="space-y-6">
          <h1 className="text-2xl font-black">Lease approval center</h1>
          <DataTable
            empty="No leases."
            columns={[
              { key: 'r', label: 'Resident', render: (d) => d.residentName },
              { key: 'p', label: 'Property', render: (d) => d.propertyName },
              { key: 's', label: 'Status', render: (d) => <StatusPill tone={d.status === 'admin_review' ? 'amber' : 'green'}>{LEASE_PIPELINE_LABEL[d.status] || d.status}</StatusPill> },
              { key: 'act', label: '', render: (d) => (
                d.status === 'admin_review' ? (
                  <button
                    type="button"
                    className="text-sm font-semibold text-emerald-700"
                    onClick={async () => {
                      try {
                        await adminPublishLeaseDraft(d.id, user?.name || user?.email || 'Axis admin')
                        await refreshPortalData()
                        toast.success('Lease published to resident portal')
                      } catch (err) {
                        toast.error(err?.message || 'Publish failed')
                      }
                    }}
                  >
                    Publish to portal
                  </button>
                ) : '—'
              ) },
            ]}
            rows={leasePipeline.map((l) => ({ key: l.id, data: l }))}
          />
        </div>
      )}

      {tab === 'messages' && (
        <div className="space-y-4">
          <div>
            <h1 className="text-2xl font-black text-slate-900">Messages</h1>
            <p className="mt-1 text-sm text-slate-500">
              Inbox for partners and site managers. Threads use the <strong>Messages</strong> table (Thread Key + Channel); optional Airtable Form for submissions.
            </p>
          </div>
          <PortalInternalInbox variant="admin" userEmail={user.email} userDisplayName={user.name} />
        </div>
      )}

      {tab === 'access' && (user.role === 'owner' || user.role === 'developer') ? (
        <div className="space-y-6">
          <h1 className="text-2xl font-black text-slate-900">Admin access</h1>
          <p className="max-w-2xl text-sm text-slate-600">
            Approve or deny requests from the <strong>Request access</strong> tab on the sign-in screen. Site owner, Sentinel developer, and anyone with this tab can approve. Data lives in this browser&apos;s local storage until you connect Airtable or another backend.
          </p>
          <DataTable
            empty="No pending admin access requests."
            columns={[
              {
                key: 'n',
                label: 'Name',
                render: (d) => <span className="font-semibold">{d.name}</span>,
              },
              { key: 'e', label: 'Email', render: (d) => d.email },
              {
                key: 't',
                label: 'Requested',
                render: (d) => new Date(d.requestedAt).toLocaleString(),
              },
              {
                key: 'a',
                label: '',
                render: (d) => (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
                      onClick={async () => {
                        try {
                          await approveAdminRequest(d.id)
                          setAccessTick((x) => x + 1)
                          toast.success('Approved — they can sign in at /admin')
                        } catch (ex) {
                          toast.error(ex?.message || 'Approve failed')
                        }
                      }}
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-100"
                      onClick={() => {
                        denyAdminRequest(d.id)
                        setAccessTick((x) => x + 1)
                        toast.success('Request denied')
                      }}
                    >
                      Deny
                    </button>
                  </div>
                ),
              },
            ]}
            rows={pendingAdminRows}
          />
        </div>
      ) : null}

      {tab === 'settings' && (
        <div className="max-w-2xl space-y-6">
          <h1 className="text-2xl font-black">Settings</h1>
          <div className="rounded-[24px] border border-slate-200 bg-white p-6 space-y-4 text-sm text-slate-600">
            <p>Placeholder controls for application rules, lease templates, approval workflow flags, notifications, and role permissions.</p>
            <p className="text-xs text-slate-500 border border-slate-100 rounded-xl px-3 py-2 bg-slate-50">
              Additional controls can be wired to Airtable or your backend when ready.
            </p>
          </div>
        </div>
      )}
    </PortalShell>
  )
}

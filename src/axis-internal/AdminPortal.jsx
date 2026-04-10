import React, { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import PortalShell, { StatCard, StatusPill, DataTable } from './PortalShell'
import {
  MOCK_ADMIN_USER,
  MOCK_PROPERTIES,
  MOCK_APPLICATIONS,
  MOCK_LEASES,
  MOCK_LEADS,
  MOCK_MANAGEMENT_ACCOUNTS,
  PROPERTY_STATUS_LABEL,
  LEAD_STATUS_LABEL,
  LEASE_PIPELINE_LABEL,
} from './mock'

export const AXIS_ADMIN_SESSION_KEY = 'axis_admin_session'

const NAV = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'approvals', label: 'Property approvals' },
  { id: 'properties', label: 'All properties' },
  { id: 'leads', label: 'Management leads' },
  { id: 'accounts', label: 'Management accounts' },
  { id: 'applications', label: 'Applications' },
  { id: 'leases', label: 'Lease approval' },
  { id: 'messages', label: 'Messages' },
  { id: 'settings', label: 'Settings' },
]

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
  const [properties, setProperties] = useState(() => [...MOCK_PROPERTIES])
  const [leads, setLeads] = useState(() => [...MOCK_LEADS])
  const [accounts, setAccounts] = useState(() => [...MOCK_MANAGEMENT_ACCOUNTS])
  const [selectedApprovalId, setSelectedApprovalId] = useState(null)

  const user = session || MOCK_ADMIN_USER

  function persistSession(u) {
    setSession(u)
    sessionStorage.setItem(AXIS_ADMIN_SESSION_KEY, JSON.stringify(u))
  }

  function handleSignOut() {
    sessionStorage.removeItem(AXIS_ADMIN_SESSION_KEY)
    setSession(null)
  }

  const pendingApprovals = useMemo(() => properties.filter((p) => p.status === 'pending' || p.status === 'changes_requested'), [properties])
  const liveCount = useMemo(() => properties.filter((p) => p.status === 'live').length, [properties])
  const newLeads = useMemo(() => leads.filter((l) => l.status === 'new').length, [leads])
  const pendingApps = MOCK_APPLICATIONS.filter((a) => a.status === 'submitted' || a.status === 'under_review').length
  const leasesNeedAdmin = MOCK_LEASES.filter((l) => l.status === 'admin_review').length
  const leasesSent = MOCK_LEASES.filter((l) => l.status === 'sent_resident').length

  const ownerLabel = (ownerId) => accounts.find((a) => a.id === ownerId)?.businessName || accounts.find((a) => a.id === ownerId)?.name || ownerId

  if (!session) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-900 px-6">
        <div className="w-full max-w-md rounded-[28px] border border-slate-700 bg-slate-800 p-8 shadow-xl">
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-sky-400">Axis Admin</div>
          <h1 className="mt-2 text-2xl font-black text-white">Internal portal</h1>
          <p className="mt-2 text-sm text-slate-400">Full platform access. Demo sign-in only.</p>
          <button
            type="button"
            onClick={() => persistSession(MOCK_ADMIN_USER)}
            className="mt-6 w-full rounded-2xl bg-sky-500 py-3 text-sm font-semibold text-white hover:bg-sky-400"
          >
            Continue as demo admin
          </button>
        </div>
      </div>
    )
  }

  const approval = properties.find((p) => p.id === selectedApprovalId)

  return (
    <PortalShell
      brandTitle="Axis internal"
      brandSubtitle="Admin portal"
      navItems={NAV}
      activeId={tab}
      onNavigate={setTab}
      userLabel={user.name}
      userMeta={user.role || 'Admin'}
      onSignOut={handleSignOut}
    >
      {tab === 'dashboard' && (
        <div className="space-y-8">
          <h1 className="text-2xl font-black text-slate-900">Admin dashboard</h1>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Property approvals queue" value={pendingApprovals.length} onClick={() => setTab('approvals')} />
            <StatCard label="New management leads" value={newLeads} onClick={() => setTab('leads')} />
            <StatCard label="Live properties" value={liveCount} onClick={() => setTab('properties')} />
            <StatCard label="Pending applications" value={pendingApps} onClick={() => setTab('applications')} />
            <StatCard label="Leases awaiting admin" value={leasesNeedAdmin} onClick={() => setTab('leases')} />
            <StatCard label="Sent for signature" value={leasesSent} onClick={() => setTab('leases')} />
            <StatCard label="Management accounts" value={accounts.length} onClick={() => setTab('accounts')} />
            <StatCard label="System" value="OK" hint="Mock mode" onClick={() => setTab('settings')} />
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
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white"
                  onClick={() => {
                    setProperties((ps) => ps.map((x) => (x.id === approval.id ? { ...x, status: 'live', adminNotesVisible: 'Approved — listing can go live.' } : x)))
                    toast.success('Approved (demo)')
                    setSelectedApprovalId(null)
                  }}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900"
                  onClick={() => {
                    setProperties((ps) => ps.map((x) => (x.id === approval.id ? { ...x, status: 'changes_requested', adminNotesVisible: 'Please update photos and pricing.' } : x)))
                    toast.success('Requested changes (demo)')
                  }}
                >
                  Request edits
                </button>
                <button
                  type="button"
                  className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-800"
                  onClick={() => {
                    setProperties((ps) => ps.map((x) => (x.id === approval.id ? { ...x, status: 'rejected' } : x)))
                    toast.success('Rejected (demo)')
                    setSelectedApprovalId(null)
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
                  onChange={(e) => {
                    const v = e.target.value
                    setLeads((ls) => ls.map((x) => (x.id === d.id ? { ...x, status: v } : x)))
                    toast.success('Lead updated')
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
                  onClick={() => {
                    setAccounts((ac) => ac.map((x) => (x.id === d.id ? { ...x, enabled: !x.enabled } : x)))
                    toast.success('Toggled (demo)')
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
            rows={MOCK_APPLICATIONS.map((a) => ({ key: a.id, data: a }))}
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
                    onClick={() => toast.success('Admin approved (demo) — wire to patchLeaseDraft')}
                  >
                    Approve lease
                  </button>
                ) : '—'
              ) },
            ]}
            rows={MOCK_LEASES.map((l) => ({ key: l.id, data: l }))}
          />
        </div>
      )}

      {tab === 'messages' && (
        <div className="space-y-4">
          <h1 className="text-2xl font-black">Messages</h1>
          <p className="text-sm text-slate-500">Central hub for admin ↔ management and admin ↔ leads (mock). Reuse `Messages` / threaded model when connecting Airtable.</p>
          <div className="rounded-[24px] border border-slate-200 bg-white p-6 text-sm text-slate-600">
            <ul className="space-y-3">
              <li className="flex justify-between border-b border-slate-100 pb-2"><span className="font-semibold">Jordan Lee</span><StatusPill tone="amber">Unread</StatusPill></li>
              <li className="flex justify-between border-b border-slate-100 pb-2"><span className="font-semibold">Priya Shah (lead)</span><StatusPill tone="slate">Open</StatusPill></li>
            </ul>
          </div>
        </div>
      )}

      {tab === 'settings' && (
        <div className="max-w-2xl space-y-6">
          <h1 className="text-2xl font-black">Settings</h1>
          <div className="rounded-[24px] border border-slate-200 bg-white p-6 space-y-4 text-sm text-slate-600">
            <p>Placeholder controls for application rules, lease templates, approval workflow flags, notifications, and role permissions.</p>
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">No persistence in demo — structure only.</p>
          </div>
        </div>
      )}
    </PortalShell>
  )
}

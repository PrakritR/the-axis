import React, { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import PortalShell, { StatCard, StatusPill, DataTable } from './PortalShell'
import {
  MOCK_MANAGEMENT_USER,
  MOCK_PROPERTIES,
  MOCK_APPLICATIONS,
  MOCK_LEASES,
  MOCK_THREAD_MESSAGES,
  PROPERTY_STATUS_LABEL,
  LEASE_PIPELINE_LABEL,
  applicationsForOwner,
  leasesForOwner,
  propertiesForOwner,
  threadsForManagement,
} from './mock'

export const AXIS_MANAGEMENT_SESSION_KEY = 'axis_management_session'

const NAV = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'properties', label: 'My properties' },
  { id: 'add', label: 'Add property' },
  { id: 'applications', label: 'Applications' },
  { id: 'leases', label: 'Lease center' },
  { id: 'messages', label: 'Messages' },
  { id: 'account', label: 'Account' },
]

function propertyTone(st) {
  if (st === 'live') return 'green'
  if (st === 'pending') return 'amber'
  if (st === 'changes_requested') return 'violet'
  if (st === 'rejected') return 'red'
  if (st === 'inactive') return 'slate'
  return 'blue'
}

function leaseTone(st) {
  if (st === 'signed' || st === 'archived') return 'green'
  if (st === 'admin_review' || st === 'under_review') return 'amber'
  if (st === 'sent_resident') return 'axis'
  return 'slate'
}

export default function ManagementPortal() {
  const [session, setSession] = useState(() => {
    try {
      const raw = sessionStorage.getItem(AXIS_MANAGEMENT_SESSION_KEY)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  })
  const [tab, setTab] = useState('dashboard')
  const [extraProperties, setExtraProperties] = useState([])
  const [draftMessage, setDraftMessage] = useState('')
  const [activeThreadId, setActiveThreadId] = useState('th_1')
  const [selectedPropertyId, setSelectedPropertyId] = useState(null)

  const user = session || MOCK_MANAGEMENT_USER

  const myProperties = useMemo(
    () => propertiesForOwner(user.id, extraProperties),
    [user.id, extraProperties],
  )
  const myApps = useMemo(() => applicationsForOwner(user.id), [user.id])
  const myLeases = useMemo(() => leasesForOwner(user.id), [user.id])
  const myThreads = useMemo(() => threadsForManagement(user.id), [user.id])

  function persistSession(u) {
    setSession(u)
    sessionStorage.setItem(AXIS_MANAGEMENT_SESSION_KEY, JSON.stringify(u))
  }

  function handleSignOut() {
    sessionStorage.removeItem(AXIS_MANAGEMENT_SESSION_KEY)
    setSession(null)
  }

  if (!session) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-6">
        <div className="w-full max-w-md rounded-[28px] border border-slate-200 bg-white p-8 shadow-sm">
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#2563eb]">Axis Management</div>
          <h1 className="mt-2 text-2xl font-black text-slate-900">Partner portal</h1>
          <p className="mt-2 text-sm text-slate-500">
            For property owners and partners. Demo mode uses mock data; connect Airtable later.
          </p>
          <button
            type="button"
            onClick={() => persistSession(MOCK_MANAGEMENT_USER)}
            className="mt-6 w-full rounded-2xl bg-[#2563eb] py-3 text-sm font-semibold text-white hover:brightness-105"
          >
            Continue with demo account
          </button>
          <p className="mt-4 text-center text-xs text-slate-400">Production login will replace this step.</p>
        </div>
      </div>
    )
  }

  const pendingProps = myProperties.filter((p) => p.status === 'pending').length
  const liveProps = myProperties.filter((p) => p.status === 'live').length
  const pendingApps = myApps.filter((a) => a.status === 'submitted' || a.status === 'under_review').length
  const leasesReview = myLeases.filter((l) => ['under_review', 'admin_review', 'draft'].includes(l.status)).length
  const unread = myThreads.filter((t) => t.unreadForManagement).length

  const selectedProperty = myProperties.find((p) => p.id === selectedPropertyId)

  return (
    <PortalShell
      brandTitle="Axis internal"
      brandSubtitle="Management portal"
      navItems={NAV}
      activeId={tab}
      onNavigate={setTab}
      userLabel={user.name}
      userMeta={user.email}
      onSignOut={handleSignOut}
    >
      {tab === 'dashboard' && (
        <div className="space-y-8">
          <div>
            <h1 className="text-2xl font-black text-slate-900">Dashboard</h1>
            <p className="mt-1 text-sm text-slate-500">Summary for your portfolio (mock data).</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <StatCard label="My houses" value={myProperties.length} hint={`${liveProps} live`} onClick={() => setTab('properties')} />
            <StatCard label="Pending house approvals" value={pendingProps} hint="Submitted to Axis" onClick={() => setTab('properties')} />
            <StatCard label="Pending applications" value={pendingApps} hint="Across your properties" onClick={() => setTab('applications')} />
            <StatCard label="Leases awaiting review" value={leasesReview} hint="Pipeline" onClick={() => setTab('leases')} />
            <StatCard label="Unread from Axis" value={unread} hint="Admin messages" onClick={() => setTab('messages')} />
            <StatCard
              label="Account status"
              value={user.verificationStatus === 'verified' ? 'Verified' : 'Pending'}
              hint={user.agreementSigned ? 'Agreement on file' : 'Agreement pending'}
              onClick={() => setTab('account')}
            />
          </div>
        </div>
      )}

      {tab === 'properties' && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-2xl font-black text-slate-900">My properties</h1>
              <p className="mt-1 text-sm text-slate-500">Only your submitted listings. Final publish/approval may require Axis Admin.</p>
            </div>
            <button
              type="button"
              onClick={() => setTab('add')}
              className="rounded-2xl bg-[#2563eb] px-4 py-2.5 text-sm font-semibold text-white"
            >
              Add property
            </button>
          </div>
          <DataTable
            empty="No properties yet."
            columns={[
              { key: 'name', label: 'Property' },
              { key: 'status', label: 'Status', render: (d) => <StatusPill tone={propertyTone(d.status)}>{PROPERTY_STATUS_LABEL[d.status] || d.status}</StatusPill> },
              { key: 'rent', label: 'From', render: (d) => `$${d.rentFrom}/mo` },
              { key: 'submitted', label: 'Submitted', render: (d) => new Date(d.submittedAt).toLocaleDateString() },
              { key: 'act', label: '', render: (d) => (
                <button type="button" className="text-sm font-semibold text-[#2563eb]" onClick={() => setSelectedPropertyId(d.id)}>
                  Details
                </button>
              ) },
            ]}
            rows={myProperties.map((p) => ({ key: p.id, data: p }))}
          />

          {selectedProperty ? (
            <div className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black">{selectedProperty.name}</h2>
                  <p className="text-sm text-slate-500">{selectedProperty.address}</p>
                </div>
                <button type="button" className="text-sm text-slate-500 hover:text-slate-800" onClick={() => setSelectedPropertyId(null)}>
                  Close
                </button>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
                <div><span className="text-slate-400">Status</span><br /><StatusPill tone={propertyTone(selectedProperty.status)}>{PROPERTY_STATUS_LABEL[selectedProperty.status]}</StatusPill></div>
                <div><span className="text-slate-400">Rooms</span><br /><span className="font-semibold">{selectedProperty.rooms}</span></div>
                <div><span className="text-slate-400">Occupancy</span><br /><span className="font-semibold">{selectedProperty.occupancy} / {selectedProperty.rooms}</span></div>
                <div><span className="text-slate-400">Deposit</span><br /><span className="font-semibold">${selectedProperty.deposit}</span></div>
                <div className="sm:col-span-2"><span className="text-slate-400">Axis notes (visible)</span><br /><span className="text-slate-700">{selectedProperty.adminNotesVisible || '—'}</span></div>
              </div>
              <p className="mt-4 text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                Photo upload, pricing editor, and listing preview will connect to Airtable/storage. Editing is read-only in demo.
              </p>
            </div>
          ) : null}
        </div>
      )}

      {tab === 'add' && (
        <AddPropertyForm
          userId={user.id}
          onSubmitted={(p) => {
            setExtraProperties((x) => [...x, p])
            toast.success('Property submitted (demo) — pending Axis review.')
            setTab('properties')
          }}
        />
      )}

      {tab === 'applications' && (
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-black text-slate-900">Applications</h1>
            <p className="mt-1 text-sm text-slate-500">
              Applications for your properties. <strong>Final approval</strong> is handled by Axis Admin when configured.
            </p>
          </div>
          <DataTable
            empty="No applications."
            columns={[
              { key: 'applicant', label: 'Applicant', render: (d) => <><div className="font-semibold">{d.applicantName}</div><div className="text-xs text-slate-500">{d.applicantEmail}</div></> },
              { key: 'property', label: 'Property', render: (d) => d.propertyName },
              { key: 'status', label: 'Status', render: (d) => <StatusPill tone="blue">{d.status.replace('_', ' ')}</StatusPill> },
              { key: 'sub', label: 'Submitted', render: (d) => new Date(d.submittedAt).toLocaleDateString() },
              { key: 'final', label: 'Final approver', render: (d) => (d.finalApprovalBy === 'axis_admin' ? <span className="text-xs font-semibold text-violet-700">Axis Admin</span> : '—') },
            ]}
            rows={myApps.map((a) => ({ key: a.id, data: a }))}
          />
          <p className="text-xs text-slate-500">Comments, “mark reviewed”, and escalate-to-admin will use shared message threads (mock).</p>
        </div>
      )}

      {tab === 'leases' && (
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-black text-slate-900">Lease center</h1>
            <p className="mt-1 text-sm text-slate-500">
              Drafts from approved applications → your review → Axis Admin (if required) → resident signing. Aligns with existing Lease Drafts flow when wired.
            </p>
          </div>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
            <li>Application approved</li>
            <li>Auto-generated lease draft</li>
            <li>Management review</li>
            <li>Axis Admin approval (when required)</li>
            <li>Sent to resident portal / SignForge</li>
            <li>Signed &amp; archived</li>
          </ol>
          <DataTable
            empty="No leases in pipeline."
            columns={[
              { key: 'res', label: 'Resident', render: (d) => d.residentName },
              { key: 'prop', label: 'Property', render: (d) => d.propertyName },
              { key: 'st', label: 'Status', render: (d) => <StatusPill tone={leaseTone(d.status)}>{LEASE_PIPELINE_LABEL[d.status] || d.status}</StatusPill> },
              { key: 'up', label: 'Updated', render: (d) => new Date(d.updatedAt).toLocaleDateString() },
            ]}
            rows={myLeases.map((l) => ({ key: l.id, data: l }))}
          />
        </div>
      )}

      {tab === 'messages' && (
        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-black text-slate-900">Inbox</h2>
            <ul className="mt-3 space-y-2">
              {myThreads.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => setActiveThreadId(t.id)}
                    className={`w-full rounded-xl border px-3 py-2 text-left text-sm ${activeThreadId === t.id ? 'border-[#2563eb] bg-[#2563eb]/5' : 'border-slate-100 bg-slate-50'}`}
                  >
                    <div className="font-semibold text-slate-800">{t.subject}</div>
                    <div className="line-clamp-2 text-xs text-slate-500">{t.preview}</div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-black">Thread</h2>
            <div className="mt-4 max-h-[360px] space-y-3 overflow-y-auto">
              {(MOCK_THREAD_MESSAGES[activeThreadId] || []).map((m) => (
                <div key={m.id} className={`rounded-xl border px-3 py-2 text-sm ${m.from === 'admin' ? 'ml-6 border-violet-200 bg-violet-50' : 'mr-6 border-slate-200'}`}>
                  <div className="text-[11px] font-semibold text-slate-400">{m.from === 'admin' ? 'Axis Admin' : 'You'} · {new Date(m.at).toLocaleString()}</div>
                  <p className="mt-1 text-slate-800">{m.body}</p>
                </div>
              ))}
            </div>
            <form
              className="mt-4 flex flex-col gap-2 sm:flex-row"
              onSubmit={(e) => {
                e.preventDefault()
                if (!draftMessage.trim()) return
                toast.success('Message queued (demo — not persisted)')
                setDraftMessage('')
              }}
            >
              <input
                value={draftMessage}
                onChange={(e) => setDraftMessage(e.target.value)}
                placeholder="Message Axis Admin…"
                className="flex-1 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm"
              />
              <button type="submit" className="rounded-2xl bg-[#2563eb] px-5 py-2.5 text-sm font-semibold text-white">
                Send
              </button>
            </form>
          </div>
        </div>
      )}

      {tab === 'account' && (
        <div className="max-w-2xl space-y-6">
          <h1 className="text-2xl font-black">Account &amp; onboarding</h1>
          <div className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm space-y-2 text-sm">
            <div><span className="text-slate-400">Name</span><br /><span className="font-semibold">{user.name}</span></div>
            <div><span className="text-slate-400">Email</span><br /><span className="font-semibold">{user.email}</span></div>
            <div><span className="text-slate-400">Business</span><br /><span className="font-semibold">{user.businessName || '—'}</span></div>
            <div><span className="text-slate-400">Verification</span><br /><StatusPill tone="green">{user.verificationStatus}</StatusPill></div>
          </div>
          <div className="rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="font-black text-slate-900">Onboarding checklist</h2>
            <ul className="mt-3 space-y-2">
              {(user.onboardingSteps || []).map((s) => (
                <li key={s.id} className="flex items-center gap-2 text-sm">
                  <span className={s.done ? 'text-emerald-600' : 'text-slate-300'}>{s.done ? '✓' : '○'}</span>
                  {s.label}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-xs text-slate-500">Payout / tax placeholders can be added when billing is integrated.</p>
          </div>
        </div>
      )}
    </PortalShell>
  )
}

function AddPropertyForm({ userId, onSubmitted }) {
  const [form, setForm] = useState({
    name: '',
    address: '',
    description: '',
    rooms: '',
    bathrooms: '',
    rentFrom: '',
    deposit: '',
    utilities: '',
    amenities: '',
    availableDate: '',
    contactPhone: '',
    notes: '',
  })
  function set(k) {
    return (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  }
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-black">Add property</h1>
        <p className="mt-1 text-sm text-slate-500">Submit for Axis Admin review before going live.</p>
      </div>
      <form
        className="space-y-4 rounded-[24px] border border-slate-200 bg-white p-6 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault()
          if (!form.name.trim() || !form.address.trim()) {
            toast.error('Name and address are required.')
            return
          }
          onSubmitted({
            id: `prop_local_${Date.now()}`,
            ownerId: userId,
            name: form.name.trim(),
            address: form.address.trim(),
            description: form.description,
            rooms: Number(form.rooms) || 0,
            bathrooms: Number(form.bathrooms) || 0,
            rentFrom: Number(form.rentFrom) || 0,
            deposit: Number(form.deposit) || 0,
            utilitiesIncluded: form.utilities,
            amenities: form.amenities ? form.amenities.split(',').map((s) => s.trim()).filter(Boolean) : [],
            photos: 0,
            availableDate: form.availableDate || '',
            contactPhone: form.contactPhone,
            notesFromOwner: form.notes,
            adminNotesInternal: '',
            adminNotesVisible: '',
            status: 'pending',
            submittedAt: new Date().toISOString(),
            occupancy: 0,
          })
        }}
      >
        {[
          ['name', 'Property name', 'text', true],
          ['address', 'Address', 'text', true],
          ['description', 'Description', 'textarea', false],
          ['rooms', 'Number of rooms', 'number', false],
          ['bathrooms', 'Bathrooms', 'number', false],
          ['rentFrom', 'Rent from ($/mo)', 'number', false],
          ['deposit', 'Security deposit ($)', 'number', false],
          ['utilities', 'Utilities included', 'text', false],
          ['amenities', 'Amenities (comma-separated)', 'text', false],
          ['availableDate', 'Available date', 'date', false],
          ['contactPhone', 'Contact phone', 'tel', false],
          ['notes', 'Notes for Axis', 'textarea', false],
        ].map(([key, label, type, req]) => (
          <label key={key} className="block">
            <span className="text-sm font-semibold text-slate-700">{label}{req ? ' *' : ''}</span>
            {type === 'textarea' ? (
              <textarea value={form[key]} onChange={set(key)} rows={3} className="mt-1 w-full rounded-2xl border border-slate-200 px-4 py-2.5 text-sm" />
            ) : (
              <input type={type} value={form[key]} onChange={set(key)} className="mt-1 w-full rounded-2xl border border-slate-200 px-4 py-2.5 text-sm" />
            )}
          </label>
        ))}
        <button type="submit" className="w-full rounded-2xl bg-[#2563eb] py-3 text-sm font-semibold text-white">
          Submit for review
        </button>
      </form>
    </div>
  )
}

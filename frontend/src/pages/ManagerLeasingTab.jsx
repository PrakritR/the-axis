/**
 * ManagerLeasingTab.jsx
 *
 * The "Leasing" tab in the Manager portal. Shows all lease drafts for this
 * manager's properties with workflow status badges. Clicking a row opens the
 * shared LeaseWorkspace for the full back-and-forth editing flow.
 *
 * Props:
 *   manager              – manager session object (from localStorage axis_manager)
 *   allowedPropertyNames – Set or array of property names visible to this manager
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import toast from 'react-hot-toast'
import LeaseWorkspace from '../components/LeaseWorkspace.jsx'
import { DataTable } from '../components/PortalShell'
import { getStatusConfig, fmtTs } from '../lib/leaseWorkflowConstants.js'

const AIRTABLE_TOKEN = import.meta.env.VITE_AIRTABLE_TOKEN
const CORE_BASE_ID = import.meta.env.VITE_AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const APPS_BASE_ID = import.meta.env.VITE_AIRTABLE_APPLICATIONS_BASE_ID || CORE_BASE_ID
const APPLICATIONS_TABLE = (import.meta.env.VITE_AIRTABLE_APPLICATIONS_TABLE || 'Applications').trim() || 'Applications'
const AT_BASE = `https://api.airtable.com/v0/${CORE_BASE_ID}`
const APPS_BASE = `https://api.airtable.com/v0/${APPS_BASE_ID}`

function mapRecord(record) {
  return { id: record.id, ...record.fields, created_at: record.createdTime }
}

// ─── Data fetching ────────────────────────────────────────────────────────────
async function fetchLeaseDraftsForManager(ownerId) {
  const rows = []
  let offset = null
  do {
    const url = new URL(`${AT_BASE}/Lease%20Drafts`)
    // Filter to this manager's owner ID
    if (ownerId) {
      url.searchParams.set('filterByFormula', `{Owner ID} = "${ownerId}"`)
    }
    url.searchParams.set('sort[0][field]', 'Updated At')
    url.searchParams.set('sort[0][direction]', 'desc')
    if (offset) url.searchParams.set('offset', offset)
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(text.slice(0, 300))
    }
    const data = await res.json()
    for (const r of (data.records || [])) rows.push({ id: r.id, ...r.fields })
    offset = data.offset || null
  } while (offset)
  return rows
}

async function fetchAllLeaseDrafts() {
  const rows = []
  let offset = null
  do {
    const url = new URL(`${AT_BASE}/Lease%20Drafts`)
    url.searchParams.set('sort[0][field]', 'Updated At')
    url.searchParams.set('sort[0][direction]', 'desc')
    if (offset) url.searchParams.set('offset', offset)
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(text.slice(0, 300))
    }
    const data = await res.json()
    for (const r of (data.records || [])) rows.push({ id: r.id, ...r.fields })
    offset = data.offset || null
  } while (offset)
  return rows
}

async function fetchApprovedApplicationsForManager(ownerId) {
  const rows = []
  let offset = null
  do {
    const url = new URL(`${APPS_BASE}/${encodeURIComponent(APPLICATIONS_TABLE)}`)
    const ownerFormula = ownerId ? `, {Owner ID} = "${String(ownerId).replace(/"/g, '\\"')}"` : ''
    url.searchParams.set('filterByFormula', `AND({Approved}=TRUE()${ownerFormula})`)
    url.searchParams.set('sort[0][field]', 'Approved At')
    url.searchParams.set('sort[0][direction]', 'desc')
    if (offset) url.searchParams.set('offset', offset)
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(text.slice(0, 300))
    }
    const data = await res.json()
    for (const r of (data.records || [])) rows.push(mapRecord(r))
    offset = data.offset || null
  } while (offset)
  return rows
}

function toSyntheticLeaseDraftFromApplication(app) {
  return {
    id: `app-${app.id}`,
    '__syntheticFromApplication': true,
    'Application Record ID': app.id,
    'Status': 'Draft Generated',
    'Resident Name': app['Signer Full Name'] || app.Name || '—',
    'Resident Email': app['Signer Email'] || '',
    'Property': app['Property Name'] || '',
    'Unit': app['Room Number'] || '',
    'Lease Term': app['Lease Term'] || '',
    'Current Version': 1,
    'Updated At': app['Approved At'] || app.created_at || new Date().toISOString(),
  }
}

async function fetchUnreadNotificationCount(recipientRecordId) {
  if (!recipientRecordId) return 0
  try {
    const url = new URL(`${AT_BASE}/Lease%20Notifications`)
    url.searchParams.set('filterByFormula', `AND({Recipient Record ID}="${recipientRecordId}",NOT({Is Read}))`)
    url.searchParams.set('fields[]', 'Is Read')
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } })
    if (!res.ok) return 0
    const data = await res.json()
    return (data.records || []).length
  } catch {
    return 0
  }
}

// ─── Status filter options ────────────────────────────────────────────────────
const STATUS_FILTER_ITEMS = [
  { id: 'all', label: 'All Leases', match: () => true },
  {
    id: 'draft_ready',
    label: 'Draft Ready',
    match: (s) => ['Draft Generated', 'Under Review', 'Changes Needed', 'Approved', 'Sent Back to Manager'].includes(String(s || '').trim()),
  },
  {
    id: 'admin_review',
    label: 'Admin Review',
    match: (s) => ['Submitted to Admin', 'Admin In Review', 'Changes Made', 'Manager Approved', 'Ready for Signature'].includes(String(s || '').trim()),
  },
  { id: 'sent', label: 'With Resident', match: (s) => String(s || '').trim() === 'Published' },
  { id: 'signed', label: 'Signed', match: (s) => String(s || '').trim() === 'Signed' },
]

// ─── Sub-components ───────────────────────────────────────────────────────────
function StatusPill({ status }) {
  const cfg = getStatusConfig(status)
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cfg.bg} ${cfg.text} ${cfg.border}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {cfg.short}
    </span>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function ManagerLeasingTab({ manager, allowedPropertyNames }) {
  const [drafts, setDrafts] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [selectedDraft, setSelectedDraft] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [unreadCount, setUnreadCount] = useState(0)

  const ownerId = manager?.id || manager?.airtableRecordId || ''

  const loadDrafts = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const allFromOwner = await fetchLeaseDraftsForManager(ownerId)
      // Scope to allowed properties if provided
      const allowed = Array.isArray(allowedPropertyNames)
        ? new Set(allowedPropertyNames)
        : allowedPropertyNames instanceof Set
        ? allowedPropertyNames
        : null
      // Fallback: if owner-id scoped rows are empty, fetch all drafts and scope by property names.
      // This ensures newly approved applications show up even if Owner ID is not yet populated on the draft.
      let sourceRows = allFromOwner
      if (sourceRows.length === 0 && allowed && allowed.size > 0) {
        sourceRows = await fetchAllLeaseDrafts()
      }
      const scoped = allowed && allowed.size > 0
        ? sourceRows.filter(d => allowed.has(d['Property']))
        : sourceRows

      const approvedApps = await fetchApprovedApplicationsForManager(ownerId).catch(() => [])
      const approvedScoped = allowed && allowed.size > 0
        ? approvedApps.filter((a) => allowed.has(String(a['Property Name'] || '')))
        : approvedApps
      const existingAppIds = new Set(
        scoped
          .map((d) => String(d['Application Record ID'] || '').trim())
          .filter(Boolean),
      )
      const syntheticRows = approvedScoped
        .filter((a) => !existingAppIds.has(String(a.id || '').trim()))
        .map(toSyntheticLeaseDraftFromApplication)

      const merged = [...syntheticRows, ...scoped].sort(
        (a, b) => new Date(b['Updated At'] || b.created_at || 0) - new Date(a['Updated At'] || a.created_at || 0),
      )
      setDrafts(merged)
    } catch (err) {
      setLoadError(err.message || 'Could not load leases')
      toast.error('Could not load lease records')
    } finally {
      setLoading(false)
    }
  }, [ownerId, allowedPropertyNames])

  const openLeaseDetails = useCallback(async (draft) => {
    if (!draft?.__syntheticFromApplication) {
      setSelectedDraft(draft)
      return
    }
    try {
      const appId = String(draft['Application Record ID'] || '').trim()
      if (!appId) throw new Error('Application record id missing')
      const res = await fetch('/api/generate-lease-from-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          applicationRecordId: appId,
          managerName: manager?.name || manager?.email || 'Manager',
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not generate lease draft')
      if (data?.draft?.id) {
        setSelectedDraft(data.draft)
        loadDrafts()
        return
      }
      throw new Error('Draft was not returned by server')
    } catch (err) {
      toast.error(err.message || 'Could not open lease details')
    }
  }, [manager, loadDrafts])

  useEffect(() => {
    loadDrafts()
  }, [loadDrafts])

  useEffect(() => {
    fetchUnreadNotificationCount(ownerId).then(setUnreadCount)
  }, [ownerId])

  useEffect(() => {
    const onDraftsChanged = () => {
      loadDrafts()
    }
    window.addEventListener('axis:lease-drafts-changed', onDraftsChanged)
    return () => window.removeEventListener('axis:lease-drafts-changed', onDraftsChanged)
  }, [loadDrafts])

  const visibleDrafts = useMemo(() => {
    const filterFn = STATUS_FILTER_ITEMS.find(f => f.id === statusFilter)?.match ?? (() => true)
    return drafts.filter(d => filterFn(d['Status'] || ''))
  }, [drafts, statusFilter])

  const statusCounts = useMemo(() => {
    return STATUS_FILTER_ITEMS.reduce((acc, f) => {
      acc[f.id] = f.id === 'all' ? drafts.length : drafts.filter(d => f.match(d['Status'] || '')).length
      return acc
    }, {})
  }, [drafts])

  if (selectedDraft) {
    return (
      <LeaseWorkspace
        draft={selectedDraft}
        isAdmin={false}
        manager={manager}
        onBack={() => setSelectedDraft(null)}
        onRefresh={loadDrafts}
      />
    )
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Leases</h1>
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <span className="flex items-center gap-1.5 rounded-full bg-orange-100 px-3 py-1 text-xs font-bold text-orange-700">
              <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
              {unreadCount} unread
            </span>
          )}
          <button
            type="button"
            onClick={loadDrafts}
            disabled={loading}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {loadError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <span className="font-semibold">Could not load leases: </span>{loadError}
        </div>
      )}

      {/* Filter pills */}
      <div className="overflow-x-auto">
        <div className="grid min-w-[760px] grid-cols-5 gap-2 rounded-[28px] border border-slate-200 bg-slate-50 p-2">
        {STATUS_FILTER_ITEMS.map(f => (
          <button
            key={f.id}
            type="button"
            onClick={() => setStatusFilter(f.id)}
            className={`rounded-2xl border px-4 py-3 text-left transition ${
              statusFilter === f.id
                ? 'border-[#2563eb]/30 bg-white text-slate-900 shadow-[0_10px_24px_rgba(37,99,235,0.12)]'
                : 'border-transparent text-slate-600 hover:border-slate-200 hover:bg-white/70 hover:text-slate-900'
            }`}
          >
            <div className="text-lg font-black leading-none tabular-nums text-slate-900">{statusCounts[f.id]}</div>
            <div className="mt-0.5 text-xs font-semibold">{f.label}</div>
          </button>
        ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="px-6 py-16 text-center text-sm text-slate-500">Loading leases…</div>
        ) : visibleDrafts.length === 0 ? (
          <div className="px-6 py-16" />
        ) : (
          <DataTable
            empty="No leases in this view"
            columns={[
              {
                key: 'property',
                label: 'Property',
                headerClassName: 'w-[30%]',
                render: (draft) => (
                  <>
                    <div className="font-semibold text-slate-900">{draft['Property'] || 'Property not set'}</div>
                    <div className="text-xs text-slate-500">{draft['Resident Name'] || 'Resident not set'}</div>
                  </>
                ),
              },
              {
                key: 'summary',
                label: 'Summary',
                headerClassName: 'w-[40%]',
                render: (draft) => (
                  <div className="flex flex-wrap gap-1.5">
                    {draft['Unit'] ? <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">Room {draft['Unit']}</span> : null}
                    {draft['Lease Term'] ? <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">{draft['Lease Term']}</span> : null}
                    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">{draft['Current Version'] ? `v${draft['Current Version']}` : 'v1'}</span>
                    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">Updated {fmtTs(draft['Updated At'] || draft['created_at'])}</span>
                  </div>
                ),
              },
              {
                key: 'status',
                label: 'Status',
                headerClassName: 'w-[16%] text-center',
                cellClassName: 'text-center',
                render: (draft) => <StatusPill status={draft['Status'] || 'Draft Generated'} />,
              },
              {
                key: 'actions',
                label: 'Action',
                headerClassName: 'w-[14%] text-right',
                cellClassName: 'text-right',
                render: (draft) => (
                  <button
                    type="button"
                    className="whitespace-nowrap text-sm font-semibold text-[#2563eb]"
                    onClick={() => openLeaseDetails(draft)}
                  >
                    Details
                  </button>
                ),
              },
            ]}
            rows={visibleDrafts.map((draft) => ({ key: draft.id, data: draft }))}
          />
        )}
      </div>
    </div>
  )
}

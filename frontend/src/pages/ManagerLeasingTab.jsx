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
import { getStatusConfig, fmtTs } from '../lib/leaseWorkflowConstants.js'

const AIRTABLE_TOKEN = import.meta.env.VITE_AIRTABLE_TOKEN
const CORE_BASE_ID = import.meta.env.VITE_AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const AT_BASE = `https://api.airtable.com/v0/${CORE_BASE_ID}`

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

function managerQueueLabel(status) {
  const normalized = String(status || '').trim()
  if (['Draft Generated', 'Under Review', 'Changes Needed', 'Approved', 'Sent Back to Manager'].includes(normalized)) return 'Draft Ready'
  if (['Submitted to Admin', 'Admin In Review', 'Changes Made', 'Manager Approved', 'Ready for Signature'].includes(normalized)) return 'Admin Review'
  if (normalized === 'Published') return 'With Resident'
  if (normalized === 'Signed') return 'Signed'
  return normalized || 'Draft Ready'
}

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

function LeasingTableRow({ draft, onOpen }) {
  const status = draft['Status'] || 'Draft Generated'
  const cfg = getStatusConfig(status)
  return (
    <tr
      className="cursor-pointer border-b border-slate-100 transition hover:bg-sky-50/70 last:border-0"
      onClick={() => onOpen(draft)}
    >
      <td className="px-4 py-3">
        <div className="font-semibold text-slate-900">{draft['Resident Name'] || '—'}</div>
        <div className="text-xs text-slate-500">{draft['Resident Email'] || 'No email'}</div>
      </td>
      <td className="px-4 py-3">
        <div className="text-sm font-medium text-slate-800">{draft['Property'] || '—'}</div>
        <div className="text-xs text-slate-500">{draft['Unit'] ? `Unit ${draft['Unit']}` : '—'}</div>
      </td>
      <td className="px-4 py-3 text-center">
        <StatusPill status={status} />
        <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">{managerQueueLabel(status)}</div>
        {cfg.managerActionNeeded && (
          <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-orange-600">Your action</div>
        )}
      </td>
      <td className="px-4 py-3 text-center">
        <span className="text-sm text-slate-600">{draft['Current Version'] ? `v${draft['Current Version']}` : 'v1'}</span>
      </td>
      <td className="px-4 py-3 text-right">
        <span className="text-xs text-slate-400">{fmtTs(draft['Updated At'] || draft['created_at'])}</span>
      </td>
      <td className="px-4 py-3 text-right">
        <span className="text-sm font-semibold text-[#2563eb]">Open →</span>
      </td>
    </tr>
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
      setDrafts(scoped)
    } catch (err) {
      setLoadError(err.message || 'Could not load leases')
      toast.error('Could not load lease records')
    } finally {
      setLoading(false)
    }
  }, [ownerId, allowedPropertyNames])

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

  const actionNeededDrafts = useMemo(
    () => drafts.filter(d => getStatusConfig(d['Status'] || 'Draft Generated').managerActionNeeded),
    [drafts]
  )

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

      {/* Action-needed banner */}
      {actionNeededDrafts.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-orange-400 text-xs font-black text-white">
            {actionNeededDrafts.length}
          </span>
          <div className="flex-1">
            <p className="text-sm font-bold text-orange-900">Action needed</p>
            <p className="text-xs text-orange-800">
              {actionNeededDrafts.length} lease{actionNeededDrafts.length !== 1 ? 's' : ''} waiting on you
            </p>
          </div>
          <button
            type="button"
            onClick={() => setStatusFilter('draft_ready')}
            className="rounded-xl bg-orange-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-600"
          >
            View
          </button>
        </div>
      )}

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
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px]">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70">
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Tenant</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Property</th>
                  <th className="px-4 py-3 text-center text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Status</th>
                  <th className="px-4 py-3 text-center text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Version</th>
                  <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Updated</th>
                  <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400"></th>
                </tr>
              </thead>
              <tbody>
                {visibleDrafts.map(draft => (
                  <LeasingTableRow key={draft.id} draft={draft} onOpen={setSelectedDraft} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

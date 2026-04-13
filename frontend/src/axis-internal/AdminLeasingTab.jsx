/**
 * AdminLeasingTab.jsx
 *
 * The "Leasing" tab in the Admin portal. Shows all lease drafts across all
 * managers/properties with full filter controls. Admin has full edit, version
 * upload, and status control access via the shared LeaseWorkspace.
 *
 * Props:
 *   adminUser – admin session object (AXIS_ADMIN_SESSION_KEY)
 *   accounts  – loaded manager accounts for name lookup
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import toast from 'react-hot-toast'
import LeaseWorkspace from '../components/LeaseWorkspace.jsx'
import {
  getStatusConfig,
  WORKFLOW_ACTIVE_STATUSES,
  WORKFLOW_STATUS_LIST,
  fmtTs,
} from '../lib/leaseWorkflowConstants.js'

const AIRTABLE_TOKEN = import.meta.env.VITE_AIRTABLE_TOKEN
const CORE_BASE_ID = import.meta.env.VITE_AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const AT_BASE = `https://api.airtable.com/v0/${CORE_BASE_ID}`

// ─── Data fetching ────────────────────────────────────────────────────────────
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

async function fetchAdminUnreadNotificationCount(adminRecordId) {
  if (!adminRecordId) return 0
  try {
    const url = new URL(`${AT_BASE}/Lease%20Notifications`)
    url.searchParams.set('filterByFormula', `AND({Recipient Record ID}="${adminRecordId}",{Recipient Role}="admin",NOT({Is Read}))`)
    url.searchParams.set('fields[]', 'Is Read')
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } })
    if (!res.ok) return 0
    const data = await res.json()
    return (data.records || []).length
  } catch {
    return 0
  }
}

// ─── Filter definitions ────────────────────────────────────────────────────────
const ADMIN_STATUS_FILTER_ITEMS = [
  { id: 'all',           label: 'All Leases',         match: () => true },
  { id: 'needs_action',  label: 'Admin Action Needed', match: s => getStatusConfig(s).adminActionNeeded },
  { id: 'in_progress',   label: 'In Progress',         match: s => WORKFLOW_ACTIVE_STATUSES.has(s) },
  { id: 'finalized',     label: 'Finalized',           match: s => ['Ready for Signature','Published','Signed'].includes(s) },
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

function AdminLeasingTableRow({ draft, onOpen, managerName }) {
  const status = draft['Status'] || 'Draft Generated'
  const cfg = getStatusConfig(status)
  return (
    <tr
      className="cursor-pointer border-b border-slate-100 transition hover:bg-sky-50/70 last:border-0"
      onClick={() => onOpen(draft)}
    >
      <td className="px-4 py-3">
        <span className="font-mono text-[10px] text-slate-400">#{draft.id?.slice(-8)}</span>
      </td>
      <td className="px-4 py-3">
        <div className="font-semibold text-slate-900">{draft['Resident Name'] || '—'}</div>
        <div className="text-xs text-slate-500">{draft['Resident Email'] || 'No email'}</div>
      </td>
      <td className="px-4 py-3">
        <div className="text-sm font-medium text-slate-800">{draft['Property'] || '—'}</div>
        <div className="text-xs text-slate-500">{draft['Unit'] ? `Unit ${draft['Unit']}` : '—'}</div>
      </td>
      <td className="px-4 py-3">
        <div className="text-xs text-slate-600">{managerName || '—'}</div>
      </td>
      <td className="px-4 py-3 text-center">
        <StatusPill status={status} />
        {cfg.adminActionNeeded && (
          <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-blue-600">Action needed</div>
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
export default function AdminLeasingTab({ adminUser, accounts = [] }) {
  const [drafts, setDrafts] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [selectedDraft, setSelectedDraft] = useState(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [statusDropdown, setStatusDropdown] = useState('')
  const [managerFilter, setManagerFilter] = useState('')
  const [propertySearch, setPropertySearch] = useState('')
  const [unreadCount, setUnreadCount] = useState(0)

  const adminRecordId = adminUser?.airtableRecordId || adminUser?.id || ''

  const loadDrafts = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const all = await fetchAllLeaseDrafts()
      setDrafts(all)
    } catch (err) {
      setLoadError(err.message || 'Could not load leases')
      toast.error('Could not load lease records')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadDrafts()
  }, [loadDrafts])

  useEffect(() => {
    fetchAdminUnreadNotificationCount(adminRecordId).then(setUnreadCount)
  }, [adminRecordId])

  // Build manager ID → name lookup from accounts
  const managerNameMap = useMemo(() => {
    const map = new Map()
    for (const a of accounts) {
      if (a.id) map.set(a.id, a.businessName || a.name || a.email || a.id)
    }
    return map
  }, [accounts])

  // Unique property names for filter dropdown
  const propertyOptions = useMemo(() => {
    const set = new Set()
    for (const d of drafts) {
      const p = String(d['Property'] || '').trim()
      if (p) set.add(p)
    }
    return [...set].sort()
  }, [drafts])

  // Unique manager IDs for filter dropdown
  const managerOptions = useMemo(() => {
    const set = new Set()
    for (const d of drafts) {
      const oid = String(d['Owner ID'] || '').trim()
      if (oid) set.add(oid)
    }
    return [...set].sort()
  }, [drafts])

  const visibleDrafts = useMemo(() => {
    // Quick filter card
    const quickFn = ADMIN_STATUS_FILTER_ITEMS.find(f => f.id === statusFilter)?.match ?? (() => true)
    let result = drafts.filter(d => quickFn(d['Status'] || ''))

    // Dropdown status filter
    if (statusDropdown) result = result.filter(d => d['Status'] === statusDropdown)

    // Manager filter
    if (managerFilter) result = result.filter(d => d['Owner ID'] === managerFilter)

    // Property / tenant search
    if (propertySearch.trim()) {
      const q = propertySearch.trim().toLowerCase()
      result = result.filter(d =>
        (d['Property'] || '').toLowerCase().includes(q) ||
        (d['Resident Name'] || '').toLowerCase().includes(q)
      )
    }

    return result
  }, [drafts, statusFilter, statusDropdown, managerFilter, propertySearch])

  const statusCounts = useMemo(() => {
    return ADMIN_STATUS_FILTER_ITEMS.reduce((acc, f) => {
      acc[f.id] = f.id === 'all' ? drafts.length : drafts.filter(d => f.match(d['Status'] || '')).length
      return acc
    }, {})
  }, [drafts])

  const actionNeededDrafts = useMemo(
    () => drafts.filter(d => getStatusConfig(d['Status'] || '').adminActionNeeded),
    [drafts]
  )

  const selectCls = 'h-[38px] cursor-pointer appearance-none rounded-full border border-slate-200 bg-white py-2 pl-3 pr-8 text-xs font-medium text-slate-700 focus:border-[#2563eb] focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20'

  if (selectedDraft) {
    return (
      <LeaseWorkspace
        draft={selectedDraft}
        isAdmin={true}
        adminUser={adminUser}
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
          <h1 className="text-2xl font-black text-slate-900">Leasing</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Review, edit, and respond to lease requests from all managers
          </p>
        </div>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && (
            <span className="flex items-center gap-1.5 rounded-full bg-blue-100 px-3 py-1 text-xs font-bold text-blue-700">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
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
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-500 text-xs font-black text-white">
            {actionNeededDrafts.length}
          </span>
          <div className="flex-1">
            <p className="text-sm font-bold text-blue-900">Admin action needed</p>
            <p className="text-xs text-blue-800">
              {actionNeededDrafts.length} lease{actionNeededDrafts.length !== 1 ? 's' : ''} awaiting your review
            </p>
          </div>
          <button
            type="button"
            onClick={() => setStatusFilter('needs_action')}
            className="rounded-xl bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
          >
            Review
          </button>
        </div>
      )}

      {loadError && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <span className="font-semibold">Could not load leases: </span>{loadError}
        </div>
      )}

      {/* Filter pills */}
      <div className="grid grid-cols-2 gap-2 rounded-[28px] border border-slate-200 bg-slate-50 p-2 sm:grid-cols-4">
        {ADMIN_STATUS_FILTER_ITEMS.map(f => (
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

      {/* Advanced filters */}
      <div className="flex flex-wrap gap-2">
        {/* Status dropdown */}
        <div className="relative">
          <select value={statusDropdown} onChange={e => setStatusDropdown(e.target.value)} className={selectCls}>
            <option value="">All statuses</option>
            {WORKFLOW_STATUS_LIST.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs">▾</span>
        </div>

        {/* Manager filter */}
        {managerOptions.length > 0 && (
          <div className="relative">
            <select value={managerFilter} onChange={e => setManagerFilter(e.target.value)} className={selectCls}>
              <option value="">All managers</option>
              {managerOptions.map(id => (
                <option key={id} value={id}>{managerNameMap.get(id) || id}</option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs">▾</span>
          </div>
        )}

        {/* Property/tenant search */}
        <div className="relative flex-1 min-w-[200px]">
          <input
            value={propertySearch}
            onChange={e => setPropertySearch(e.target.value)}
            placeholder="Search property or tenant…"
            className="h-[38px] w-full rounded-full border border-slate-200 bg-white py-2 pl-9 pr-4 text-xs text-slate-700 placeholder:text-slate-400 focus:border-[#2563eb] focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20"
          />
          <svg className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
        </div>

        {(statusDropdown || managerFilter || propertySearch) && (
          <button
            type="button"
            onClick={() => { setStatusDropdown(''); setManagerFilter(''); setPropertySearch('') }}
            className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-50"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="px-6 py-16 text-center text-sm text-slate-500">Loading leases…</div>
        ) : visibleDrafts.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <div className="mb-3 text-4xl" aria-hidden>📋</div>
            {drafts.length === 0 ? (
              <>
                <div className="text-sm font-semibold text-slate-700">No lease records found</div>
                <p className="mt-2 max-w-sm mx-auto text-xs text-slate-500">
                  Leases will appear here once managers generate drafts from their applications.
                </p>
              </>
            ) : (
              <div className="text-sm font-semibold text-slate-700">No leases match the current filters</div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px]">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70">
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">ID</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Tenant</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Property</th>
                  <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Manager</th>
                  <th className="px-4 py-3 text-center text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Status</th>
                  <th className="px-4 py-3 text-center text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Version</th>
                  <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Updated</th>
                  <th className="px-4 py-3 text-right text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400"></th>
                </tr>
              </thead>
              <tbody>
                {visibleDrafts.map(draft => (
                  <AdminLeasingTableRow
                    key={draft.id}
                    draft={draft}
                    onOpen={setSelectedDraft}
                    managerName={managerNameMap.get(draft['Owner ID']) || draft['Owner ID'] || '—'}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && visibleDrafts.length > 0 && (
          <div className="border-t border-slate-100 px-4 py-2.5 text-right text-xs text-slate-400">
            Showing {visibleDrafts.length} of {drafts.length} total lease records
          </div>
        )}
      </div>

      {/* Summary stats */}
      {!loading && drafts.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Total Leases', value: drafts.length, color: 'text-slate-900' },
            { label: 'Submitted to Admin', value: drafts.filter(d => d['Status'] === 'Submitted to Admin').length, color: 'text-blue-700' },
            { label: 'Sent Back — Awaiting Manager', value: drafts.filter(d => d['Status'] === 'Sent Back to Manager').length, color: 'text-orange-700' },
            { label: 'Signed', value: drafts.filter(d => d['Status'] === 'Signed').length, color: 'text-purple-700' },
          ].map(s => (
            <div key={s.label} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className={`text-2xl font-black tabular-nums ${s.color}`}>{s.value}</div>
              <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{s.label}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

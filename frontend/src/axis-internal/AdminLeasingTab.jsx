import React, { useState, useEffect, useCallback, useMemo } from 'react'
import toast from 'react-hot-toast'
import LeaseHTMLTemplate from '../components/LeaseHTMLTemplate.jsx'
import { DataTable } from '../components/PortalShell'
import { getStatusConfig, fmtTs } from '../lib/leaseWorkflowConstants.js'
import { getLeaseDraftById, uploadLeaseVersionPdfFile, getCurrentLeaseVersion } from '../lib/airtable.js'

const AIRTABLE_TOKEN = import.meta.env.VITE_AIRTABLE_TOKEN
const CORE_BASE_ID = import.meta.env.VITE_AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const AT_BASE = `https://api.airtable.com/v0/${CORE_BASE_ID}`

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
    for (const record of data.records || []) rows.push({ id: record.id, ...record.fields })
    offset = data.offset || null
  } while (offset)
  return rows
}

async function callPortalAction(action, body) {
  const response = await fetch(`/api/portal?action=${encodeURIComponent(action)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data?.error) throw new Error(data?.error || `Request failed (${response.status})`)
  return data
}

const ADMIN_STATUS_FILTER_ITEMS = [
  { id: 'all', label: 'All Leases', match: () => true },
  {
    id: 'draft_ready',
    label: 'Draft Ready',
    match: (status) => ['Draft Generated', 'Under Review', 'Changes Needed', 'Approved', 'Sent Back to Manager'].includes(String(status || '').trim()),
  },
  {
    id: 'admin_review',
    label: 'Admin Review',
    match: (status) => ['Submitted to Admin', 'Admin In Review', 'Changes Made', 'Manager Approved', 'Ready for Signature'].includes(String(status || '').trim()),
  },
  { id: 'sent', label: 'With Resident', match: (status) => String(status || '').trim() === 'Published' },
  { id: 'signed', label: 'Signed', match: (status) => String(status || '').trim() === 'Signed' },
]

function StatusPill({ status }) {
  const cfg = getStatusConfig(status)
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cfg.bg} ${cfg.text} ${cfg.border}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {cfg.short}
    </span>
  )
}

export default function AdminLeasingTab({ adminUser, accounts = [] }) {
  const [drafts, setDrafts] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selectedDraftId, setSelectedDraftId] = useState('')
  const [activeDraft, setActiveDraft] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [actionBusy, setActionBusy] = useState('')
  const [showUploadForm, setShowUploadForm] = useState(false)
  const [pdfFile, setPdfFile] = useState(null)
  const [activeVersion, setActiveVersion] = useState(null)

  const adminRecordId = adminUser?.airtableRecordId || adminUser?.id || ''
  const adminName = adminUser?.name || adminUser?.email || 'Admin'

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

  const managerNameMap = useMemo(() => {
    const map = new Map()
    for (const account of accounts) {
      const display = account.businessName || account.name || account.email || account.id || account.airtableRecordId || ''
      if (account.id) map.set(account.id, display)
      if (account.airtableRecordId) map.set(account.airtableRecordId, display)
    }
    return map
  }, [accounts])

  const visibleDrafts = useMemo(() => {
    const filterFn = ADMIN_STATUS_FILTER_ITEMS.find((item) => item.id === statusFilter)?.match ?? (() => true)
    return drafts.filter((draft) => filterFn(draft['Status'] || ''))
  }, [drafts, statusFilter])

  const statusCounts = useMemo(() => {
    return ADMIN_STATUS_FILTER_ITEMS.reduce((acc, item) => {
      acc[item.id] = item.id === 'all' ? drafts.length : drafts.filter((draft) => item.match(draft['Status'] || '')).length
      return acc
    }, {})
  }, [drafts])

  const leaseJson = useMemo(() => {
    try {
      return JSON.parse(activeDraft?.['Lease JSON'] || '{}')
    } catch {
      return {}
    }
  }, [activeDraft])

  const openLeaseDetails = useCallback(async (draft) => {
    if (!draft?.id) return
    if (selectedDraftId === draft.id) {
      setSelectedDraftId('')
      setActiveDraft(null)
      setActiveVersion(null)
      setShowUploadForm(false)
      setPdfFile(null)
      return
    }
    setDetailLoading(true)
    try {
      const [full, version] = await Promise.all([
        getLeaseDraftById(draft.id).catch(() => draft),
        getCurrentLeaseVersion(draft.id).catch(() => null),
      ])
      setSelectedDraftId(String(full?.id || draft.id))
      setActiveDraft(full)
      setActiveVersion(version)
      setShowUploadForm(false)
      setPdfFile(null)
    } catch (err) {
      toast.error(err.message || 'Could not open lease details')
    } finally {
      setDetailLoading(false)
    }
  }, [selectedDraftId])

  async function handleSendToManager() {
    if (!activeDraft?.id) return
    setActionBusy('send')
    try {
      await callPortalAction('lease-admin-respond', {
        leaseDraftId: activeDraft.id,
        adminRecordId,
        adminName,
        newStatus: 'Sent Back to Manager',
        adminNotes: 'Lease sent to manager for review.',
      })
      toast.success('Sent to manager')
      const full = await getLeaseDraftById(activeDraft.id).catch(() => activeDraft)
      setActiveDraft(full)
      await loadDrafts()
    } catch (err) {
      toast.error(err.message || 'Could not send to manager')
    } finally {
      setActionBusy('')
    }
  }

  async function handleSavePdf() {
    if (!activeDraft?.id) return
    if (!pdfFile) {
      toast.error('Select a PDF first')
      return
    }
    setActionBusy('upload')
    try {
      await uploadLeaseVersionPdfFile({
        leaseDraftId: activeDraft.id,
        file: pdfFile,
        uploaderName: adminName,
        uploaderRole: 'Admin',
      })
      toast.success('PDF uploaded')
      setShowUploadForm(false)
      setPdfFile(null)
      const [full, version] = await Promise.all([
        getLeaseDraftById(activeDraft.id).catch(() => activeDraft),
        getCurrentLeaseVersion(activeDraft.id).catch(() => null),
      ])
      setActiveDraft(full)
      setActiveVersion(version)
      await loadDrafts()
    } catch (err) {
      toast.error(err.message || 'Could not upload PDF')
    } finally {
      setActionBusy('')
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Leases</h1>
        </div>
        <button
          type="button"
          onClick={loadDrafts}
          disabled={loading}
          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {loadError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <span className="font-semibold">Could not load leases: </span>{loadError}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <div className="grid min-w-[760px] grid-cols-5 gap-2 rounded-[28px] border border-slate-200 bg-slate-50 p-2">
          {ADMIN_STATUS_FILTER_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setStatusFilter(item.id)}
              className={`rounded-2xl border px-4 py-3 text-left transition ${
                statusFilter === item.id
                  ? 'border-[#2563eb]/30 bg-white text-slate-900 shadow-[0_10px_24px_rgba(37,99,235,0.12)]'
                  : 'border-transparent text-slate-600 hover:border-slate-200 hover:bg-white/70 hover:text-slate-900'
              }`}
            >
              <div className="text-lg font-black leading-none tabular-nums text-slate-900">{statusCounts[item.id]}</div>
              <div className="mt-0.5 text-xs font-semibold">{item.label}</div>
            </button>
          ))}
        </div>
      </div>

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
                    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">
                      Manager {managerNameMap.get(draft['Owner ID']) || 'Not set'}
                    </span>
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
                key: 'action',
                label: 'Action',
                headerClassName: 'w-[14%] text-right',
                cellClassName: 'text-right',
                render: (draft) => (
                  <button
                    type="button"
                    onClick={() => openLeaseDetails(draft)}
                    className="whitespace-nowrap text-sm font-semibold text-[#2563eb]"
                  >
                    {selectedDraftId === draft.id ? 'Hide' : 'Details'}
                  </button>
                ),
              },
            ]}
            rows={visibleDrafts.map((draft) => ({ key: draft.id, data: draft }))}
          />
        )}
      </div>

      {selectedDraftId ? (
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-2xl font-black text-slate-900">Lease Draft</h3>
              <StatusPill status={activeDraft?.Status || 'Draft Generated'} />
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowUploadForm((value) => !value)}
                className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
              >
                Upload PDF
              </button>
              <button
                type="button"
                onClick={handleSendToManager}
                disabled={actionBusy === 'send' || detailLoading || !activeDraft?.id}
                className="rounded-full bg-axis px-4 py-2 text-sm font-semibold text-white transition hover:brightness-105 disabled:opacity-50"
              >
                {actionBusy === 'send' ? 'Sending...' : 'Send to Manager'}
              </button>
            </div>
          </div>

          {showUploadForm ? (
            <div className="border-b border-slate-100 bg-slate-50 px-5 py-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(event) => setPdfFile(event.target.files?.[0] || null)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/20"
                />
                <div className="flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500">
                  {pdfFile?.name || 'Choose a PDF from your computer'}
                </div>
              </div>
              <div className="mt-3">
                <button
                  type="button"
                  onClick={handleSavePdf}
                  disabled={actionBusy === 'upload'}
                  className="rounded-full bg-axis px-4 py-2 text-sm font-semibold text-white transition hover:brightness-105 disabled:opacity-50"
                >
                  {actionBusy === 'upload' ? 'Saving...' : 'Save PDF'}
                </button>
              </div>
            </div>
          ) : null}

          {activeVersion?.['PDF URL'] ? (
            <div className="border-b border-slate-100 bg-emerald-50 px-5 py-3 flex items-center gap-3">
              <span className="text-xs font-semibold text-emerald-700">PDF uploaded</span>
              <a
                href={activeVersion['PDF URL']}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full border border-emerald-300 bg-white px-3 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
              >
                View / Download PDF
              </a>
              {activeVersion['File Name'] ? <span className="text-xs text-slate-500 truncate max-w-[200px]">{activeVersion['File Name']}</span> : null}
            </div>
          ) : null}

          <div className="px-4 py-5 sm:px-6">
            {detailLoading ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">Loading lease details...</div>
            ) : leaseJson && Object.keys(leaseJson).length > 0 ? (
              <LeaseHTMLTemplate
                leaseData={leaseJson}
                signedBy={activeDraft?.['Signed By']}
                signedAt={activeDraft?.['Signed At']}
              />
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">Lease document is not available yet.</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

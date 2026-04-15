import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import toast from 'react-hot-toast'
import LeaseHTMLTemplate from '../components/LeaseHTMLTemplate.jsx'
import { pickManagerSignatureFromDraft } from '../../../shared/lease-manager-signature-fields.js'
import { PortalEmptyVisual } from '../components/portalNavIcons.jsx'
import { DataTable } from '../components/PortalShell'
import { getStatusConfig, fmtTs, parseManagerEditNotes } from '../lib/leaseWorkflowConstants.js'
import {
  getLeaseDraftById,
  uploadLeaseVersionPdfFile,
  getCurrentLeaseVersion,
  getLeaseCommentsForDraft,
  patchLeaseDraftRecordPreferServer,
} from '../lib/airtable.js'
import {
  leaseDraftAllowsSignWithoutMoveInPay,
  leaseSignWithoutMoveInPayFieldName,
} from '../lib/leaseMoveInOverride.js'
import {
  ALL_PROPERTIES_FILTER,
  buildPropertyFilterOptionsFromRows,
  filterRowsByPropertyKey,
  normalizePropertyFilterKey,
  sortRowsByPropertyGroupThenUpdatedDesc,
} from '../lib/portalPropertyTableOrder.js'

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
  {
    id: 'draft_ready',
    label: 'Manager Review',
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

/** Match manager portal Leasing tab property toolbar styling. */
const LEASE_PILL_SELECT_WRAP_CLS = 'relative min-w-0 flex-1 sm:min-w-[220px] sm:flex-none'
const LEASE_PILL_SELECT_CLS =
  'h-[42px] w-full min-w-0 cursor-pointer appearance-none rounded-full border border-slate-200 bg-white py-2.5 pl-4 pr-10 text-sm font-medium text-slate-800 transition focus:border-[#2563eb] focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400'
const LEASE_PILL_SELECT_CHEVRON = (
  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden>
    ▾
  </span>
)

function StatusPill({ status }) {
  const cfg = getStatusConfig(status)
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cfg.bg} ${cfg.text} ${cfg.border}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {cfg.short}
    </span>
  )
}

function AdminLeaseCommentBubble({ comment }) {
  const role = String(comment['Author Role'] || 'Unknown').trim() || 'Unknown'
  const roleTone =
    role === 'Admin' ? 'bg-blue-100 text-blue-700' : role === 'Resident' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-700'
  return (
    <div className="flex gap-3">
      <div className="max-w-[min(100%,42rem)] rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-slate-500">
          <span className="text-slate-800">{comment['Author Name'] || role}</span>
          <span className={`rounded-full px-2 py-0.5 ${roleTone}`}>{role}</span>
          <span>{fmtTs(comment['Timestamp'])}</span>
        </div>
        <p className="whitespace-pre-wrap text-sm text-slate-800">{comment['Message']}</p>
      </div>
    </div>
  )
}

/** Manager Edit Notes on the draft — shown as the first row in the unified thread (not a second panel). */
function ManagerEditRequestBubble({ summary }) {
  if (!summary) return null
  const fieldLines = summary.fieldLines || []
  const hasBody = Boolean(summary.text?.trim()) || fieldLines.length > 0
  if (!hasBody) return null
  return (
    <div className="flex gap-3">
      <div className="max-w-[min(100%,42rem)] rounded-2xl border border-amber-200 bg-amber-50/95 px-4 py-3 shadow-sm">
        <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-amber-900/90">
          <span className="text-amber-950">Manager request (draft notes)</span>
          <span className="rounded-full bg-amber-200/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-950">
            Summary
          </span>
          {summary.submittedBy || summary.submittedAt ? (
            <span className="font-normal text-amber-800/90">
              {[summary.submittedBy, summary.submittedAt ? fmtTs(summary.submittedAt) : ''].filter(Boolean).join(' · ')}
            </span>
          ) : null}
        </div>
        {summary.text ? <p className="whitespace-pre-wrap text-sm font-medium text-amber-950">{summary.text}</p> : null}
        {fieldLines.length > 0 ? (
          <div className="mt-3 rounded-xl border border-amber-200/80 bg-white/80 px-3 py-2">
            <div className="text-[10px] font-bold uppercase tracking-wide text-amber-800/80">Requested field changes</div>
            <ul className="mt-1.5 list-inside list-disc text-sm text-amber-950">
              {fieldLines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** Human-readable lines from structured edit-request payload (when present). */
/** Strip boilerplate so we can hide lease comments that only repeat Manager Edit Notes. */
function managerEditBodyForDedupe(summary) {
  if (!summary) return ''
  const parts = []
  if (summary.text) parts.push(String(summary.text).trim())
  for (const line of summary.fieldLines || []) parts.push(String(line).trim())
  return parts.filter(Boolean).join('\n').trim()
}

function leaseCommentDuplicatesManagerSummary(comment, summaryBody) {
  if (!summaryBody) return false
  const raw = String(comment?.Message || '').trim()
  if (!raw) return false
  const stripped = raw
    .replace(/^\*\*Edit Request Submitted\*\*\s*/i, '')
    .replace(/^\*\*Manager edit request\*\*\s*/i, '')
    .trim()
  const a = stripped.replace(/\s+/g, ' ')
  const b = summaryBody.replace(/\s+/g, ' ')
  if (!a || !b) return false
  if (a === b) return true
  if (a.length >= 12 && b.length >= 12 && (a.includes(b) || b.includes(a))) return true
  return false
}

function linesFromRequestedFields(rf) {
  if (!rf || typeof rf !== 'object') return []
  const lines = []
  const pick = (k, label, fmt = (v) => v) => {
    const v = rf[k]
    if (v === undefined || v === null || String(v).trim() === '') return
    lines.push(`${label}: ${fmt(v)}`)
  }
  pick('tenantName', 'Tenant')
  pick('property', 'Property')
  pick('room', 'Room')
  pick('leaseStart', 'Lease start')
  pick('leaseEnd', 'Lease end')
  pick('rent', 'Monthly rent', (v) => `$${v}`)
  pick('deposit', 'Deposit', (v) => `$${v}`)
  pick('utilities', 'Utilities', (v) => `$${v}`)
  pick('specialTerms', 'Special terms')
  return lines
}

export default function AdminLeasingTab({ adminUser, accounts = [] }) {
  const [drafts, setDrafts] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [statusFilter, setStatusFilter] = useState('draft_ready')
  const [managerFilter, setManagerFilter] = useState('')
  const [leasePropertyFilter, setLeasePropertyFilter] = useState(ALL_PROPERTIES_FILTER)
  const [leaseTableSearch, setLeaseTableSearch] = useState('')
  const leaseDraftDetailRef = useRef(null)
  const [selectedDraftId, setSelectedDraftId] = useState('')
  const [activeDraft, setActiveDraft] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [actionBusy, setActionBusy] = useState('')
  const [showUploadForm, setShowUploadForm] = useState(false)
  const [pdfFile, setPdfFile] = useState(null)
  const [activeVersion, setActiveVersion] = useState(null)
  const [leaseComments, setLeaseComments] = useState([])

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

  useEffect(() => {
    if (!selectedDraftId || detailLoading) return
    const id = window.requestAnimationFrame(() => {
      leaseDraftDetailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    return () => window.cancelAnimationFrame(id)
  }, [selectedDraftId, detailLoading, activeDraft?.id])

  const managerNameMap = useMemo(() => {
    const map = new Map()
    for (const account of accounts) {
      const display = account.businessName || account.name || account.email || account.id || account.airtableRecordId || ''
      if (account.id) map.set(account.id, display)
      if (account.airtableRecordId) map.set(account.airtableRecordId, display)
    }
    return map
  }, [accounts])

  const managerChoices = useMemo(() => {
    const byId = new Map()
    const maxTs = new Map()
    for (const d of drafts) {
      const id = String(d['Owner ID'] || '').trim()
      if (!id) continue
      const label = String(managerNameMap.get(id) || id).trim() || id
      if (!byId.has(id)) byId.set(id, label)
      const t = new Date(d['Updated At'] || d.created_at || 0).getTime()
      maxTs.set(id, Math.max(maxTs.get(id) || 0, t))
    }
    return [...byId.entries()]
      .sort((a, b) => (maxTs.get(b[0]) || 0) - (maxTs.get(a[0]) || 0) || String(a[1]).localeCompare(String(b[1]), undefined, { sensitivity: 'base' }))
      .map(([value, display]) => ({ value, display }))
  }, [drafts, managerNameMap])

  useEffect(() => {
    if (!managerFilter) return
    if (!managerChoices.some((c) => c.value === managerFilter)) setManagerFilter('')
  }, [managerFilter, managerChoices])

  const leasePropertyOptions = useMemo(() => {
    const filterFn = ADMIN_STATUS_FILTER_ITEMS.find((item) => item.id === statusFilter)?.match ?? (() => true)
    let rows = drafts.filter((draft) => filterFn(draft['Status'] || ''))
    if (managerFilter) rows = rows.filter((d) => String(d['Owner ID'] || '').trim() === managerFilter)
    return buildPropertyFilterOptionsFromRows(rows, {
      getPropertyDisplay: (d) => d['Property'] || '',
      getUpdatedMs: (d) => new Date(d['Updated At'] || d.created_at || 0).getTime(),
    })
  }, [drafts, statusFilter, managerFilter])

  const visibleDrafts = useMemo(() => {
    const filterFn = ADMIN_STATUS_FILTER_ITEMS.find((item) => item.id === statusFilter)?.match ?? (() => true)
    let rows = drafts.filter((draft) => filterFn(draft['Status'] || ''))
    if (managerFilter) {
      rows = rows.filter((d) => String(d['Owner ID'] || '').trim() === managerFilter)
    }
    rows = filterRowsByPropertyKey(rows, leasePropertyFilter, (d) => normalizePropertyFilterKey(d['Property'] || ''))
    const q = leaseTableSearch.trim().toLowerCase()
    if (q) {
      rows = rows.filter((d) => {
        const hay = `${d['Property'] || ''} ${d['Resident Name'] || ''} ${d['Resident Email'] || ''} ${d['Unit'] || ''}`.toLowerCase()
        return hay.includes(q)
      })
    }
    const updatedMs = (d) => new Date(d['Updated At'] || d.created_at || 0).getTime()
    return sortRowsByPropertyGroupThenUpdatedDesc(rows, {
      getPropertyKey: (d) => normalizePropertyFilterKey(d['Property'] || ''),
      getUpdatedMs: updatedMs,
      tieBreaker: (a, b) =>
        String(a['Resident Name'] || '').localeCompare(String(b['Resident Name'] || ''), undefined, {
          sensitivity: 'base',
        }),
    })
  }, [drafts, statusFilter, managerFilter, leasePropertyFilter, leaseTableSearch])

  useEffect(() => {
    if (!leasePropertyFilter) return
    if (!leasePropertyOptions.some((o) => o.value === leasePropertyFilter)) setLeasePropertyFilter(ALL_PROPERTIES_FILTER)
  }, [leasePropertyOptions, leasePropertyFilter])

  const statusCounts = useMemo(() => {
    return ADMIN_STATUS_FILTER_ITEMS.reduce((acc, item) => {
      acc[item.id] = drafts.filter((draft) => item.match(draft['Status'] || '')).length
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

  const managerSigDetail = useMemo(() => pickManagerSignatureFromDraft(activeDraft, import.meta.env), [activeDraft])

  const managerEditRequestSummary = useMemo(() => {
    const parsed = parseManagerEditNotes(activeDraft?.['Manager Edit Notes'])
    if (!parsed || typeof parsed !== 'object') return null
    const text = String(parsed.freeText || '').trim()
    const rfLines = linesFromRequestedFields(parsed.requestedFields)
    if (!text && rfLines.length === 0) return null
    return {
      text,
      fieldLines: rfLines,
      submittedBy: parsed.submittedBy ? String(parsed.submittedBy).trim() : '',
      submittedAt: parsed.submittedAt ? String(parsed.submittedAt).trim() : '',
    }
  }, [activeDraft])

  const managerEditDedupeBody = useMemo(() => managerEditBodyForDedupe(managerEditRequestSummary), [managerEditRequestSummary])

  const leaseCommentsWithoutManagerDupes = useMemo(() => {
    if (!managerEditDedupeBody) return leaseComments
    return leaseComments.filter((c) => !leaseCommentDuplicatesManagerSummary(c, managerEditDedupeBody))
  }, [leaseComments, managerEditDedupeBody])

  /** Backend may set Airtable `Resolved` when the lease is sent back to the manager. */
  const leaseCommentsForThread = useMemo(
    () => leaseCommentsWithoutManagerDupes.filter((c) => !c['Resolved']),
    [leaseCommentsWithoutManagerDupes],
  )

  const isLeaseWithResident = String(activeDraft?.Status || '').trim() === 'Published'

  const unifiedChangeThreadCount = useMemo(() => {
    const summaryHasRow =
      Boolean(managerEditRequestSummary) &&
      (Boolean(managerEditRequestSummary.text?.trim()) ||
        (managerEditRequestSummary.fieldLines || []).length > 0) &&
      Boolean(managerEditBodyForDedupe(managerEditRequestSummary))
    const summaryCount = summaryHasRow ? 1 : 0
    return summaryCount + leaseCommentsForThread.length
  }, [managerEditRequestSummary, leaseCommentsForThread])

  const openLeaseDetails = useCallback(async (draft) => {
    if (!draft?.id) return
    if (selectedDraftId === draft.id) {
      setSelectedDraftId('')
      setActiveDraft(null)
      setActiveVersion(null)
      setLeaseComments([])
      setShowUploadForm(false)
      setPdfFile(null)
      return
    }
    setDetailLoading(true)
    try {
      const [full, version, comments] = await Promise.all([
        getLeaseDraftById(draft.id).catch(() => draft),
        getCurrentLeaseVersion(draft.id).catch(() => null),
        getLeaseCommentsForDraft(draft.id).catch(() => []),
      ])
      setSelectedDraftId(String(full?.id || draft.id))
      setActiveDraft(full)
      setActiveVersion(version)
      setLeaseComments(Array.isArray(comments) ? comments : [])
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
        adminNotes: '',
      })
      toast.success('Sent to manager')
      const full = await getLeaseDraftById(activeDraft.id).catch(() => activeDraft)
      setActiveDraft(full)
      const cm = await getLeaseCommentsForDraft(activeDraft.id).catch(() => [])
      setLeaseComments(Array.isArray(cm) ? cm : [])
      await loadDrafts()
    } catch (err) {
      toast.error(err.message || 'Could not send to manager')
    } finally {
      setActionBusy('')
    }
  }

  const canEditLeaseDraftFields = Boolean(activeDraft?.id && String(activeDraft.id).startsWith('rec'))

  async function handleToggleSignWithoutMoveInPay(nextChecked) {
    if (!canEditLeaseDraftFields) return
    const field = leaseSignWithoutMoveInPayFieldName()
    setActionBusy('sign-override')
    try {
      await patchLeaseDraftRecordPreferServer(
        activeDraft.id,
        { [field]: Boolean(nextChecked) },
        { managerRecordId: '' },
      )
      const full = await getLeaseDraftById(activeDraft.id).catch(() => null)
      if (full) setActiveDraft(full)
      else setActiveDraft({ ...activeDraft, [field]: Boolean(nextChecked) })
      await loadDrafts()
      toast.success(
        nextChecked
          ? 'Resident can open and sign the lease before paying move-in charges.'
          : 'Move-in payment is required again before the resident can access the lease.',
      )
    } catch (err) {
      toast.error(
        err.message ||
          `Could not save. Add a checkbox "${field}" on Lease Drafts (or set VITE_AIRTABLE_LEASE_SIGN_WITHOUT_PAY_FIELD).`,
      )
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
      const cm = await getLeaseCommentsForDraft(activeDraft.id).catch(() => [])
      setLeaseComments(Array.isArray(cm) ? cm : [])
      await loadDrafts()
    } catch (err) {
      toast.error(err.message || 'Could not upload PDF')
    } finally {
      setActionBusy('')
    }
  }

  const canDownloadGeneratedPdf = useMemo(() => {
    if (!activeDraft?.id) return false
    try {
      const j = JSON.parse(activeDraft['Lease JSON'] || '{}')
      if (j && typeof j === 'object' && Object.keys(j).length > 0) return true
    } catch {
      /* ignore */
    }
    return Boolean(String(activeDraft['AI Draft Content'] || '').trim())
  }, [activeDraft])

  async function handleDownloadGeneratedPdf() {
    if (!activeDraft?.id || !canDownloadGeneratedPdf) return
    setActionBusy('download-pdf')
    try {
      const res = await fetch('/api/portal?action=lease-download-generated-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leaseDraftId: activeDraft.id }),
      })
      if (!res.ok) {
        const ct = String(res.headers.get('Content-Type') || '')
        if (ct.includes('application/json')) {
          const errBody = await res.json().catch(() => ({}))
          throw new Error(errBody.error || `Download failed (${res.status})`)
        }
        const text = await res.text().catch(() => '')
        throw new Error(text || `Download failed (${res.status})`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `axis-generated-lease-${String(activeDraft['Property'] || 'lease').replace(/\s+/g, '-')}.pdf`
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success('Downloaded generated lease PDF')
    } catch (err) {
      toast.error(err.message || 'Could not download PDF')
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
        <div className="flex w-full min-w-0 flex-wrap items-center justify-end gap-2 sm:ml-auto sm:w-auto sm:flex-nowrap">
          <div className="flex h-[42px] min-w-0 max-w-full items-stretch overflow-hidden rounded-full border border-slate-200 bg-white sm:max-w-[min(100%,320px)]">
            <span className="flex shrink-0 items-center border-r border-slate-100 bg-slate-50/80 px-3 text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">
              Select property
            </span>
            <div className="relative min-w-0 flex-1">
              <select
                value={leasePropertyFilter}
                onChange={(e) => setLeasePropertyFilter(e.target.value)}
                className="h-full w-full min-w-0 cursor-pointer appearance-none border-0 bg-transparent py-2 pl-3 pr-9 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#2563eb]/25"
                aria-label="Select property filter"
              >
                <option value={ALL_PROPERTIES_FILTER}>All properties (grouped)</option>
                {leasePropertyOptions.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden>
                ▾
              </span>
            </div>
          </div>
          <input
            type="search"
            value={leaseTableSearch}
            onChange={(e) => setLeaseTableSearch(e.target.value)}
            placeholder="Search…"
            aria-label="Search leases"
            className="h-[42px] w-full min-w-0 flex-1 rounded-full border border-slate-200 bg-white px-4 text-sm text-slate-800 placeholder:text-slate-400 focus:border-[#2563eb] focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20 sm:max-w-[220px]"
          />
          <div className={LEASE_PILL_SELECT_WRAP_CLS}>
            <select
              value={managerFilter}
              onChange={(e) => setManagerFilter(e.target.value)}
              className={LEASE_PILL_SELECT_CLS}
              aria-label="Filter leases by manager"
            >
              <option value="">All managers</option>
              {managerChoices.map(({ value, display }) => (
                <option key={value} value={value}>
                  {display}
                </option>
              ))}
            </select>
            {LEASE_PILL_SELECT_CHEVRON}
          </div>
          <button
            type="button"
            onClick={loadDrafts}
            disabled={loading}
            className="h-[42px] shrink-0 rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {loadError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          <span className="font-semibold">Could not load leases: </span>{loadError}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <div className="grid min-w-[620px] grid-cols-4 gap-2 rounded-[28px] border border-slate-200 bg-slate-50 p-2">
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
          <div className="px-6 py-16 text-center">
            <PortalEmptyVisual variant="document" />
            <div className="text-sm font-semibold text-slate-700">
              {drafts.length === 0
                ? 'No leases yet'
                : leasePropertyFilter && leasePropertyOptions.length > 0
                  ? 'No leases for the selected property in this view.'
                  : leaseTableSearch.trim()
                    ? 'No leases match your search.'
                    : `No leases in ${ADMIN_STATUS_FILTER_ITEMS.find((item) => item.id === statusFilter)?.label || 'this view'}`}
            </div>
          </div>
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
                key: 'actions',
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
        <div
          ref={leaseDraftDetailRef}
          className="scroll-mt-28 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm lg:scroll-mt-8"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-2xl font-black text-slate-900">Lease Draft</h3>
              <StatusPill status={activeDraft?.Status || 'Draft Generated'} />
            </div>
            <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowUploadForm((value) => !value)}
                className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
              >
                Upload PDF
              </button>
              {canEditLeaseDraftFields ? (
                <label className="inline-flex max-w-full cursor-pointer items-center gap-2.5 rounded-full border border-amber-200 bg-amber-50/90 px-4 py-2 text-sm font-semibold text-amber-950 shadow-sm transition hover:bg-amber-50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-amber-500 has-[:focus-visible]:ring-offset-2">
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={leaseDraftAllowsSignWithoutMoveInPay(activeDraft)}
                    disabled={actionBusy === 'sign-override' || detailLoading}
                    onChange={(e) => handleToggleSignWithoutMoveInPay(e.target.checked)}
                  />
                  <span
                    className={`pointer-events-none flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition ${
                      leaseDraftAllowsSignWithoutMoveInPay(activeDraft)
                        ? 'border-amber-800 bg-amber-700'
                        : 'border-amber-500 bg-white'
                    } ${actionBusy === 'sign-override' || detailLoading ? 'opacity-50' : ''}`}
                    aria-hidden
                  >
                    {leaseDraftAllowsSignWithoutMoveInPay(activeDraft) ? (
                      <span className="select-none text-[12px] font-black leading-none text-white">✓</span>
                    ) : null}
                  </span>
                  <span className="min-w-0 leading-snug">Allow sign without paying move-in</span>
                </label>
              ) : null}
              <button
                type="button"
                onClick={handleDownloadGeneratedPdf}
                disabled={
                  actionBusy === 'download-pdf' || detailLoading || !activeDraft?.id || !canDownloadGeneratedPdf
                }
                className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400 disabled:opacity-50"
                title={
                  canDownloadGeneratedPdf
                    ? 'Download PDF generated from Lease JSON or AI draft (not your uploaded file)'
                    : 'Generate the lease first'
                }
              >
                {actionBusy === 'download-pdf' ? 'Preparing…' : 'Download PDF'}
              </button>
              <button
                type="button"
                onClick={handleSendToManager}
                disabled={actionBusy === 'send' || detailLoading || !activeDraft?.id}
                className="ml-auto rounded-full bg-axis px-4 py-2 text-sm font-semibold text-white transition hover:brightness-105 disabled:opacity-50"
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

          <div className="min-w-0 space-y-5 overflow-x-auto px-4 py-5 sm:px-6">
            {!detailLoading && unifiedChangeThreadCount > 0 && !isLeaseWithResident ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Change requests &amp; messages</div>
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-600 shadow-sm">
                    {unifiedChangeThreadCount}
                  </span>
                </div>
                <div className="mt-4 space-y-3">
                  <ManagerEditRequestBubble summary={managerEditRequestSummary} />
                  {leaseCommentsForThread.map((c) => (
                    <AdminLeaseCommentBubble key={c.id} comment={c} />
                  ))}
                </div>
              </div>
            ) : null}

            {detailLoading ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">Loading lease details...</div>
            ) : leaseJson && Object.keys(leaseJson).length > 0 ? (
              <div className="min-w-0 max-w-full">
                <LeaseHTMLTemplate
                  leaseData={leaseJson}
                  signedBy={activeDraft?.['Signed By']}
                  signedAt={activeDraft?.['Signed At']}
                  managerSignedBy={managerSigDetail.text || undefined}
                  managerSignedAt={managerSigDetail.at || undefined}
                  managerSignatureImageUrl={managerSigDetail.image || undefined}
                />
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">Lease document is not available yet.</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

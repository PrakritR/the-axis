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

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import toast from 'react-hot-toast'
import LeaseHTMLTemplate from '../components/LeaseHTMLTemplate.jsx'
import { PortalEmptyVisual } from '../components/portalNavIcons.jsx'
import { DataTable } from '../components/PortalShell'
import { getStatusConfig, fmtTs } from '../lib/leaseWorkflowConstants.js'
import {
  deriveApplicationApprovalState,
  leaseDraftPassesApplicationApprovalGate,
} from '../lib/applicationApprovalState.js'
import {
  getLeaseDraftById,
  publishLeaseDraft,
  uploadLeaseVersionPdfFile,
  getCurrentLeaseVersion,
  getApplicationsForOwner,
  updateLeaseDraftRecord,
} from '../lib/airtable'
import {
  leaseDraftAllowsSignWithoutMoveInPay,
  leaseSignWithoutMoveInPayFieldName,
} from '../lib/leaseMoveInOverride.js'

const AIRTABLE_TOKEN = import.meta.env.VITE_AIRTABLE_TOKEN
const CORE_BASE_ID = import.meta.env.VITE_AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const APPS_BASE_ID = import.meta.env.VITE_AIRTABLE_APPLICATIONS_BASE_ID || CORE_BASE_ID
const APPLICATIONS_TABLE = (import.meta.env.VITE_AIRTABLE_APPLICATIONS_TABLE || 'Applications').trim() || 'Applications'
const AT_BASE = `https://api.airtable.com/v0/${CORE_BASE_ID}`
const APPS_BASE = `https://api.airtable.com/v0/${APPS_BASE_ID}`

async function callPortalAction(action, body) {
  const res = await fetch(`/api/portal?action=${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`)
  return json
}

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
/** Match manager portal Work orders / Calendar property toolbar styling. */
const LEASE_PILL_SELECT_WRAP_CLS = 'relative min-w-0 flex-1 sm:min-w-[220px] sm:flex-none'
const LEASE_PILL_SELECT_CLS =
  'h-[42px] w-full min-w-0 cursor-pointer appearance-none rounded-full border border-slate-200 bg-white py-2.5 pl-4 pr-10 text-sm font-medium text-slate-800 transition focus:border-[#2563eb] focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400'
const LEASE_PILL_SELECT_CHEVRON = (
  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden>
    ▾
  </span>
)

const STATUS_FILTER_ITEMS = [
  {
    id: 'draft_ready',
    label: 'Manager Review',
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
  const [selectedDraftId, setSelectedDraftId] = useState('')
  const [activeDraft, setActiveDraft] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [actionBusy, setActionBusy] = useState('')
  const [showUploadForm, setShowUploadForm] = useState(false)
  const [pdfFile, setPdfFile] = useState(null)
  const [activeVersion, setActiveVersion] = useState(null)
  const [showChangeBox, setShowChangeBox] = useState(false)
  const [changeRequestText, setChangeRequestText] = useState('')
  const [statusFilter, setStatusFilter] = useState('draft_ready')
  const [propertyFilter, setPropertyFilter] = useState('')
  /** @type {'updated_desc'|'updated_asc'|'property_asc'|'property_desc'|'resident_asc'|'resident_desc'} */
  const [leaseSort, setLeaseSort] = useState('updated_desc')
  const [unreadCount, setUnreadCount] = useState(0)
  const leaseDraftDetailRef = useRef(null)

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

      const appsForOwner = await getApplicationsForOwner(ownerId).catch(() => [])
      const appById = new Map(appsForOwner.map((a) => [a.id, a]))
      const scopedAfterAppGate = scoped.filter((d) => leaseDraftPassesApplicationApprovalGate(d, appById))

      const approvedApps = await fetchApprovedApplicationsForManager(ownerId).catch(() => [])
      const approvedScoped = allowed && allowed.size > 0
        ? approvedApps.filter((a) => allowed.has(String(a['Property Name'] || '')))
        : approvedApps
      // Airtable {Approved}=TRUE() can be out of sync with status text; only show placeholder leases when fully approved.
      const approvedForLeaseUi = approvedScoped.filter((a) => deriveApplicationApprovalState(a) === 'approved')
      const existingAppIds = new Set(
        scopedAfterAppGate
          .map((d) => String(d['Application Record ID'] || '').trim())
          .filter(Boolean),
      )
      const syntheticRows = approvedForLeaseUi
        .filter((a) => !existingAppIds.has(String(a.id || '').trim()))
        .map(toSyntheticLeaseDraftFromApplication)

      const merged = [...syntheticRows, ...scopedAfterAppGate].sort(
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
    const draftId = String(draft?.id || '').trim()
    if (!draftId) return
    if (selectedDraftId === draftId) {
      setSelectedDraftId('')
      setActiveDraft(null)
      setShowUploadForm(false)
      setShowChangeBox(false)
      return
    }
    setDetailLoading(true)
    try {
      let resolvedDraft = draft
      if (draft?.__syntheticFromApplication) {
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
        if (!data?.draft?.id) throw new Error('Draft was not returned by server')
        resolvedDraft = data.draft
        await loadDrafts()
      }
      const [full, version] = await Promise.all([
        getLeaseDraftById(resolvedDraft.id).catch(() => resolvedDraft),
        getCurrentLeaseVersion(resolvedDraft.id).catch(() => null),
      ])
      setSelectedDraftId(String(full?.id || resolvedDraft.id))
      setActiveDraft(full)
      setActiveVersion(version)
      setShowUploadForm(false)
      setShowChangeBox(false)
      setPdfFile(null)
      setChangeRequestText('')
    } catch (err) {
      toast.error(err.message || 'Could not open lease details')
    } finally {
      setDetailLoading(false)
    }
  }, [selectedDraftId, manager, loadDrafts])

  useEffect(() => {
    loadDrafts()
  }, [loadDrafts])

  /** Phones: draft body is below the table — scroll it into view after Details finishes loading. */
  useEffect(() => {
    if (!selectedDraftId || detailLoading) return
    const id = window.requestAnimationFrame(() => {
      leaseDraftDetailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    return () => window.cancelAnimationFrame(id)
  }, [selectedDraftId, detailLoading, activeDraft?.id])

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

  const propertyChoices = useMemo(() => {
    const map = new Map()
    const allowed = Array.isArray(allowedPropertyNames)
      ? allowedPropertyNames
      : allowedPropertyNames instanceof Set
        ? [...allowedPropertyNames]
        : []
    for (const name of allowed || []) {
      const display = String(name || '').trim()
      if (!display) continue
      const value = display.toLowerCase()
      if (!map.has(value)) map.set(value, display)
    }
    for (const d of drafts) {
      const display = String(d['Property'] || '').trim()
      if (!display) continue
      const value = display.toLowerCase()
      if (!map.has(value)) map.set(value, display)
    }
    return [...map.entries()]
      .sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: 'base' }))
      .map(([value, display]) => ({ value, display }))
  }, [drafts, allowedPropertyNames])

  useEffect(() => {
    if (!propertyFilter) return
    if (!propertyChoices.some((c) => c.value === propertyFilter)) setPropertyFilter('')
  }, [propertyFilter, propertyChoices])

  const visibleDrafts = useMemo(() => {
    const filterFn = STATUS_FILTER_ITEMS.find(f => f.id === statusFilter)?.match ?? (() => true)
    let rows = drafts.filter((d) => filterFn(d['Status'] || ''))
    if (propertyFilter) {
      rows = rows.filter(
        (d) => String(d['Property'] || '').trim().toLowerCase() === propertyFilter,
      )
    }
    const propKey = (d) => String(d['Property'] || '').trim().toLowerCase()
    const residentKey = (d) => String(d['Resident Name'] || '').trim().toLowerCase()
    const updatedMs = (d) => new Date(d['Updated At'] || d.created_at || 0).getTime()
    const cmp = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })
    const sorted = [...rows]
    switch (leaseSort) {
      case 'property_asc':
        sorted.sort((a, b) => cmp(propKey(a), propKey(b)) || updatedMs(b) - updatedMs(a))
        break
      case 'property_desc':
        sorted.sort((a, b) => cmp(propKey(b), propKey(a)) || updatedMs(b) - updatedMs(a))
        break
      case 'resident_asc':
        sorted.sort((a, b) => cmp(residentKey(a), residentKey(b)) || updatedMs(b) - updatedMs(a))
        break
      case 'resident_desc':
        sorted.sort((a, b) => cmp(residentKey(b), residentKey(a)) || updatedMs(b) - updatedMs(a))
        break
      case 'updated_asc':
        sorted.sort((a, b) => updatedMs(a) - updatedMs(b) || cmp(propKey(a), propKey(b)))
        break
      case 'updated_desc':
      default:
        sorted.sort((a, b) => updatedMs(b) - updatedMs(a) || cmp(propKey(a), propKey(b)))
        break
    }
    return sorted
  }, [drafts, statusFilter, propertyFilter, leaseSort])

  const statusCounts = useMemo(() => {
    return STATUS_FILTER_ITEMS.reduce((acc, f) => {
      acc[f.id] = drafts.filter((d) => f.match(d['Status'] || '')).length
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

  async function handleSendToResident() {
    if (!activeDraft?.id) return
    setActionBusy('send')
    try {
      const updated = await publishLeaseDraft(activeDraft.id)
      setActiveDraft(updated)
      toast.success('Sent to resident')
      await loadDrafts()
    } catch (err) {
      toast.error(err.message || 'Could not send to resident')
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
        uploaderName: manager?.name || manager?.email || 'Manager',
        uploaderRole: 'Manager',
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

  const canEditLeaseDraftFields = Boolean(
    activeDraft?.id &&
      String(activeDraft.id).startsWith('rec') &&
      !activeDraft.__syntheticFromApplication,
  )

  async function handleToggleSignWithoutMoveInPay(nextChecked) {
    if (!canEditLeaseDraftFields) return
    const field = leaseSignWithoutMoveInPayFieldName()
    setActionBusy('sign-override')
    try {
      const updated = await updateLeaseDraftRecord(activeDraft.id, { [field]: Boolean(nextChecked) })
      setActiveDraft({ ...activeDraft, ...updated, [field]: Boolean(nextChecked) })
      await loadDrafts()
      toast.success(
        nextChecked
          ? 'Resident can open and sign the lease before paying move-in charges.'
          : 'Move-in payment is required again before the resident can access the lease.',
      )
    } catch (err) {
      toast.error(
        err.message ||
          `Could not save. Add a checkbox field "${field}" on the Lease Drafts table in Airtable (or set VITE_AIRTABLE_LEASE_SIGN_WITHOUT_PAY_FIELD).`,
      )
    } finally {
      setActionBusy('')
    }
  }

  async function handleRequestChangeFromAdmin() {
    if (!activeDraft?.id) return
    const text = String(changeRequestText || '').trim()
    if (!text) {
      toast.error('Enter a change request first')
      return
    }
    setActionBusy('request-change')
    try {
      await callPortalAction('lease-submit-edit-request', {
        leaseDraftId: activeDraft.id,
        managerRecordId: manager?.id || manager?.airtableRecordId || '',
        managerName: manager?.name || manager?.email || 'Manager',
        editNotes: text,
        requestedFields: {},
      })
      toast.success('Change request sent to admin')
      setShowChangeBox(false)
      setChangeRequestText('')
      const full = await getLeaseDraftById(activeDraft.id).catch(() => activeDraft)
      setActiveDraft(full)
      await loadDrafts()
    } catch (err) {
      toast.error(err.message || 'Could not send change request')
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
        body: JSON.stringify({
          leaseDraftId: activeDraft.id,
          managerRecordId: manager?.id || manager?.airtableRecordId || '',
        }),
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
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Leases</h1>
        </div>
        <div className="flex w-full min-w-0 flex-wrap items-center justify-end gap-2 sm:ml-auto sm:w-auto sm:flex-nowrap">
          <div className={LEASE_PILL_SELECT_WRAP_CLS}>
            <select
              value={leaseSort}
              onChange={(e) => setLeaseSort(e.target.value)}
              className={LEASE_PILL_SELECT_CLS}
              aria-label="Sort leases"
            >
              <option value="updated_desc">Sort: Updated (newest)</option>
              <option value="updated_asc">Sort: Updated (oldest)</option>
              <option value="property_asc">Sort: Property (A–Z)</option>
              <option value="property_desc">Sort: Property (Z–A)</option>
              <option value="resident_asc">Sort: Resident (A–Z)</option>
              <option value="resident_desc">Sort: Resident (Z–A)</option>
            </select>
            {LEASE_PILL_SELECT_CHEVRON}
          </div>
          <div className={LEASE_PILL_SELECT_WRAP_CLS}>
            <select
              value={propertyFilter}
              onChange={(e) => setPropertyFilter(e.target.value)}
              className={LEASE_PILL_SELECT_CLS}
              aria-label="Filter leases by property"
            >
              <option value="">All properties</option>
              {propertyChoices.map(({ value, display }) => (
                <option key={value} value={value}>
                  {display}
                </option>
              ))}
            </select>
            {LEASE_PILL_SELECT_CHEVRON}
          </div>
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
            className="h-[42px] shrink-0 rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
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
        <div className="grid min-w-[620px] grid-cols-4 gap-2 rounded-[28px] border border-slate-200 bg-slate-50 p-2">
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
          <div className="px-6 py-16 text-center">
            <PortalEmptyVisual variant="document" />
            <div className="text-sm font-semibold text-slate-700">
              {drafts.length === 0
                ? 'No leases yet'
                : `No leases in ${STATUS_FILTER_ITEMS.find((f) => f.id === statusFilter)?.label || 'this view'}`}
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
            {activeDraft?.['Lease Access Requirement Snapshot'] || activeDraft?.['Lease Access Block Reason'] ? (
              <div className="w-full rounded-2xl border border-slate-100 bg-slate-50/90 px-4 py-3 text-sm text-slate-700">
                <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
                  Resident lease access
                </div>
                <p className="mt-1">
                  <span className="font-semibold text-slate-800">Requirement (snapshot): </span>
                  {String(activeDraft['Lease Access Requirement Snapshot'] || '—')}
                </p>
                {activeDraft['Lease Access Block Reason'] ? (
                  <p className="mt-1 text-amber-950">
                    <span className="font-semibold">Status: </span>
                    {String(activeDraft['Lease Access Block Reason'])}
                  </p>
                ) : (
                  <p className="mt-1 text-emerald-900">
                    <span className="font-semibold">Access: </span>
                    Requirements satisfied or not applicable for this draft snapshot.
                  </p>
                )}
              </div>
            ) : null}
            <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowChangeBox((v) => !v)}
                className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-400"
              >
                Request change from admin
              </button>
              <button
                type="button"
                onClick={() => setShowUploadForm((v) => !v)}
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
                onClick={handleSendToResident}
                disabled={actionBusy === 'send' || detailLoading || !activeDraft?.id}
                className="ml-auto rounded-full bg-axis px-4 py-2 text-sm font-semibold text-white transition hover:brightness-105 disabled:opacity-50"
              >
                {actionBusy === 'send' ? 'Sending...' : 'Send to Resident'}
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

          {showChangeBox ? (
            <div className="border-b border-slate-100 bg-slate-50 px-5 py-4">
              <textarea
                value={changeRequestText}
                onChange={(event) => setChangeRequestText(event.target.value)}
                rows={4}
                placeholder="What changes do you need from admin?"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/20"
              />
              <div className="mt-3">
                <button
                  type="button"
                  onClick={handleRequestChangeFromAdmin}
                  disabled={actionBusy === 'request-change'}
                  className="rounded-full bg-axis px-4 py-2 text-sm font-semibold text-white transition hover:brightness-105 disabled:opacity-50"
                >
                  {actionBusy === 'request-change' ? 'Sending...' : 'Send request'}
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

          <div className="min-w-0 overflow-x-auto px-4 py-5 sm:px-6">
            {detailLoading ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">Loading lease details...</div>
            ) : leaseJson && Object.keys(leaseJson).length > 0 ? (
              <div className="min-w-0 max-w-full">
                <LeaseHTMLTemplate
                  leaseData={leaseJson}
                  signedBy={activeDraft?.['Signed By']}
                  signedAt={activeDraft?.['Signed At']}
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

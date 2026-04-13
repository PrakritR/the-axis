/**
 * LeaseWorkspace.jsx
 *
 * Full-detail workspace for a single lease record — shared between Manager and Admin portals.
 * Role-based via `isAdmin` prop. Fetches comments, versions, and audit log from Airtable directly.
 * All write actions go through /api/portal?action=lease-*.
 *
 * Props:
 *   draft       – The Lease Drafts Airtable record (fields directly on object, id at top)
 *   isAdmin     – boolean
 *   manager     – manager session object (used when !isAdmin)
 *   adminUser   – admin session object (used when isAdmin)
 *   onBack      – callback to return to the list
 *   onRefresh   – callback to reload the draft list
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import toast from 'react-hot-toast'
import {
  getStatusConfig,
  fmtTs,
  fmtDollar,
  parseManagerEditNotes,
  parseAdminResponseNotes,
  MANAGER_CAN_SUBMIT_REQUEST,
  MANAGER_CAN_REVIEW_ADMIN_UPDATE,
  ADMIN_RESPONSE_STATUSES,
} from '../lib/leaseWorkflowConstants.js'

const AIRTABLE_TOKEN = import.meta.env.VITE_AIRTABLE_TOKEN
const CORE_BASE_ID = import.meta.env.VITE_AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const AT_BASE = `https://api.airtable.com/v0/${CORE_BASE_ID}`

// ─── Airtable helpers ─────────────────────────────────────────────────────────
async function atFetch(url) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } })
  if (!res.ok) return null
  try { return await res.json() } catch { return null }
}

async function fetchComments(leaseDraftId) {
  const url = new URL(`${AT_BASE}/Lease%20Comments`)
  url.searchParams.set('filterByFormula', `{Lease Draft ID} = "${leaseDraftId}"`)
  url.searchParams.set('sort[0][field]', 'Timestamp')
  url.searchParams.set('sort[0][direction]', 'asc')
  const data = await atFetch(url.toString())
  return (data?.records || []).map(r => ({ id: r.id, ...r.fields }))
}

async function fetchVersions(leaseDraftId) {
  const url = new URL(`${AT_BASE}/Lease%20Versions`)
  url.searchParams.set('filterByFormula', `{Lease Draft ID} = "${leaseDraftId}"`)
  url.searchParams.set('sort[0][field]', 'Version Number')
  url.searchParams.set('sort[0][direction]', 'desc')
  const data = await atFetch(url.toString())
  return (data?.records || []).map(r => ({ id: r.id, ...r.fields }))
}

async function fetchAuditLog(leaseDraftId) {
  const url = new URL(`${AT_BASE}/Audit%20Log`)
  url.searchParams.set('filterByFormula', `{Lease Draft ID} = "${leaseDraftId}"`)
  url.searchParams.set('sort[0][field]', 'Timestamp')
  url.searchParams.set('sort[0][direction]', 'desc')
  const data = await atFetch(url.toString())
  return (data?.records || []).map(r => ({ id: r.id, ...r.fields }))
}

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

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const cfg = getStatusConfig(status)
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${cfg.bg} ${cfg.text} ${cfg.border}`}>
      <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  )
}

function SectionTab({ id, label, active, badge, onClick }) {
  return (
    <button
      type="button"
      onClick={() => onClick(id)}
      className={`relative whitespace-nowrap px-4 py-2.5 text-sm font-semibold transition ${
        active
          ? 'border-b-2 border-[#2563eb] text-[#2563eb]'
          : 'text-slate-500 hover:text-slate-900'
      }`}
    >
      {label}
      {badge > 0 && (
        <span className="ml-1.5 rounded-full bg-[#2563eb]/10 px-1.5 py-0.5 text-[10px] font-bold text-[#2563eb]">
          {badge}
        </span>
      )}
    </button>
  )
}

function FieldRow({ label, value }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row">
      <dt className="w-full shrink-0 text-xs font-semibold uppercase tracking-[0.1em] text-slate-400 sm:w-36">{label}</dt>
      <dd className="text-sm font-medium text-slate-800 sm:flex-1">{value || '—'}</dd>
    </div>
  )
}

function CommentBubble({ comment, currentUserRecordId }) {
  const isMine = comment['Author Record ID'] === currentUserRecordId
  const role = comment['Author Role'] || 'Unknown'
  const isAdmin = role === 'Admin'
  return (
    <div className={`flex gap-2.5 ${isMine ? 'flex-row-reverse' : ''}`}>
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${isAdmin ? 'bg-[#2563eb]' : 'bg-slate-500'}`}>
        {String(comment['Author Name'] || '?')[0].toUpperCase()}
      </div>
      <div className={`max-w-[80%] ${isMine ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-700">{comment['Author Name'] || 'Unknown'}</span>
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${isAdmin ? 'bg-[#2563eb]/10 text-[#2563eb]' : 'bg-slate-100 text-slate-500'}`}>
            {role}
          </span>
          <span className="text-[10px] text-slate-400">{fmtTs(comment['Timestamp'])}</span>
        </div>
        <div className={`rounded-2xl px-3.5 py-2.5 text-sm ${isMine ? 'bg-[#2563eb] text-white' : 'bg-slate-100 text-slate-800'} whitespace-pre-wrap`}>
          {comment['Message']}
        </div>
      </div>
    </div>
  )
}

function VersionRow({ version }) {
  const isCurrent = Boolean(version['Is Current'])
  return (
    <div className={`flex items-start gap-3 rounded-2xl border p-3.5 ${isCurrent ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-black ${isCurrent ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
        v{version['Version Number'] || '?'}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-900">{version['File Name'] || 'lease.pdf'}</span>
          {isCurrent && (
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
              Current
            </span>
          )}
        </div>
        <div className="mt-0.5 text-xs text-slate-500">
          Uploaded by {version['Uploader Name'] || '—'} · {fmtTs(version['Upload Date'])}
        </div>
        {version['Notes'] && (
          <p className="mt-1 text-xs text-slate-600">{version['Notes']}</p>
        )}
      </div>
      <div className="shrink-0">
        {version['PDF URL'] ? (
          <a
            href={version['PDF URL']}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#2563eb] shadow-sm hover:bg-blue-50"
          >
            View PDF
          </a>
        ) : (
          <span className="text-xs text-slate-400">No PDF URL</span>
        )}
      </div>
    </div>
  )
}

function TimelineEntry({ entry }) {
  return (
    <div className="flex gap-3">
      <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100">
        <span className="h-2 w-2 rounded-full bg-slate-400" />
      </div>
      <div className="min-w-0 flex-1 pb-4">
        <div className="text-sm font-semibold text-slate-800">{entry['Action Type'] || '—'}</div>
        <div className="mt-0.5 text-xs text-slate-500">
          {entry['Performed By'] && <span className="font-medium">{entry['Performed By']}</span>}
          {entry['Performed By Role'] && <span className="ml-1 text-slate-400">({entry['Performed By Role']})</span>}
          <span className="ml-2">{fmtTs(entry['Timestamp'])}</span>
        </div>
        {entry['Notes'] && (
          <p className="mt-1 text-xs text-slate-600 italic">{entry['Notes']}</p>
        )}
      </div>
    </div>
  )
}

// ─── Modals ───────────────────────────────────────────────────────────────────

function EditRequestModal({ draft, manager, onClose, onSubmitted }) {
  const leaseJson = (() => { try { return JSON.parse(draft['Lease JSON'] || '{}') } catch { return {} } })()
  const [fields, setFields] = useState({
    tenantName: draft['Resident Name'] || leaseJson.tenantName || '',
    property:   draft['Property'] || leaseJson.propertyName || '',
    room:       draft['Unit'] || leaseJson.roomNumber || '',
    leaseStart: leaseJson.leaseStart || '',
    leaseEnd:   leaseJson.leaseEnd || '',
    rent:       leaseJson.monthlyRent || '',
    deposit:    leaseJson.securityDeposit || '',
    utilities:  leaseJson.utilityFee || '',
    specialTerms: leaseJson.specialTerms || '',
  })
  const [editNotes, setEditNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const inputCls = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 placeholder:text-slate-400 focus:border-[#2563eb] focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20'

  async function handleSubmit(e) {
    e.preventDefault()
    if (!editNotes.trim()) { toast.error('Please describe what you need changed.'); return }
    setSubmitting(true)
    try {
      await callPortalAction('lease-submit-edit-request', {
        leaseDraftId: draft.id,
        managerRecordId: manager?.id || manager?.airtableRecordId || '',
        managerName: manager?.name || 'Manager',
        editNotes: editNotes.trim(),
        requestedFields: fields,
      })
      toast.success('Edit request submitted to admin')
      onSubmitted()
      onClose()
    } catch (err) {
      toast.error(err.message || 'Failed to submit request')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-3xl bg-white shadow-2xl">
        <div className="border-b border-slate-100 px-6 py-4">
          <h2 className="text-lg font-black text-slate-900">Request Lease Changes</h2>
          <p className="mt-0.5 text-sm text-slate-500">Describe what needs to change. Admin will review and respond.</p>
        </div>
        <form onSubmit={handleSubmit} className="max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3 p-6">
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                What needs to change? <span className="text-red-500">*</span>
              </label>
              <textarea
                value={editNotes}
                onChange={e => setEditNotes(e.target.value)}
                rows={4}
                className={inputCls + ' resize-none'}
                placeholder="Describe the changes needed — be specific..."
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Tenant Name</label>
              <input value={fields.tenantName} onChange={e => setFields(f => ({ ...f, tenantName: e.target.value }))} className={inputCls} placeholder="Full name" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Property</label>
              <input value={fields.property} onChange={e => setFields(f => ({ ...f, property: e.target.value }))} className={inputCls} placeholder="Property name/address" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Room / Unit</label>
              <input value={fields.room} onChange={e => setFields(f => ({ ...f, room: e.target.value }))} className={inputCls} placeholder="Room 1" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Monthly Rent ($)</label>
              <input type="number" value={fields.rent} onChange={e => setFields(f => ({ ...f, rent: e.target.value }))} className={inputCls} placeholder="0.00" min="0" step="0.01" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Lease Start</label>
              <input type="date" value={fields.leaseStart} onChange={e => setFields(f => ({ ...f, leaseStart: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Lease End</label>
              <input type="date" value={fields.leaseEnd} onChange={e => setFields(f => ({ ...f, leaseEnd: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Security Deposit ($)</label>
              <input type="number" value={fields.deposit} onChange={e => setFields(f => ({ ...f, deposit: e.target.value }))} className={inputCls} placeholder="0.00" min="0" step="0.01" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Utilities ($)</label>
              <input type="number" value={fields.utilities} onChange={e => setFields(f => ({ ...f, utilities: e.target.value }))} className={inputCls} placeholder="0.00" min="0" step="0.01" />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Special Terms</label>
              <textarea value={fields.specialTerms} onChange={e => setFields(f => ({ ...f, specialTerms: e.target.value }))} rows={2} className={inputCls + ' resize-none'} placeholder="Parking, pets, utilities included, etc." />
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
            <button type="button" onClick={onClose} disabled={submitting} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={submitting} className="rounded-xl bg-[#2563eb] px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {submitting ? 'Submitting…' : 'Submit Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function AdminRespondModal({ draft, adminUser, onClose, onSubmitted }) {
  const leaseJson = (() => { try { return JSON.parse(draft['Lease JSON'] || '{}') } catch { return {} } })()
  const [newStatus, setNewStatus] = useState('Sent Back to Manager')
  const [adminNotes, setAdminNotes] = useState('')
  const [updatedFields, setUpdatedFields] = useState({
    residentName: draft['Resident Name'] || leaseJson.tenantName || '',
    property:     draft['Property'] || leaseJson.propertyName || '',
    unit:         draft['Unit'] || leaseJson.roomNumber || '',
    leaseStart:   leaseJson.leaseStart || '',
    leaseEnd:     leaseJson.leaseEnd || '',
    rent:         leaseJson.monthlyRent || '',
    deposit:      leaseJson.securityDeposit || '',
    utilityFee:   leaseJson.utilityFee || '',
    specialTerms: leaseJson.specialTerms || '',
  })
  const [pdfUrl, setPdfUrl] = useState('')
  const [pdfFileName, setPdfFileName] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const inputCls = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 placeholder:text-slate-400 focus:border-[#2563eb] focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20'
  const selectCls = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 focus:border-[#2563eb] focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20'

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const body = {
        leaseDraftId: draft.id,
        adminRecordId: adminUser?.airtableRecordId || adminUser?.id || '',
        adminName: adminUser?.name || 'Admin',
        newStatus,
        adminNotes: adminNotes.trim(),
        updatedFields,
      }
      if (pdfUrl.trim()) {
        body.newVersion = {
          pdfUrl: pdfUrl.trim(),
          fileName: pdfFileName.trim() || `lease-v${(Number(draft['Current Version'] || 1) + 1)}.pdf`,
          notes: adminNotes.trim(),
        }
      }
      await callPortalAction('lease-admin-respond', body)
      toast.success('Lease updated and manager notified')
      onSubmitted()
      onClose()
    } catch (err) {
      toast.error(err.message || 'Failed to update lease')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-3xl bg-white shadow-2xl">
        <div className="border-b border-slate-100 px-6 py-4">
          <h2 className="text-lg font-black text-slate-900">Update Lease & Respond</h2>
          <p className="mt-0.5 text-sm text-slate-500">Make changes, optionally attach a revised PDF, and send back to manager.</p>
        </div>
        <form onSubmit={handleSubmit} className="max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3 p-6">
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">New Status</label>
              <select value={newStatus} onChange={e => setNewStatus(e.target.value)} className={selectCls}>
                {ADMIN_RESPONSE_STATUSES.map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Admin Notes</label>
              <textarea value={adminNotes} onChange={e => setAdminNotes(e.target.value)} rows={3} className={inputCls + ' resize-none'} placeholder="Explain what was changed and why…" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Resident Name</label>
              <input value={updatedFields.residentName} onChange={e => setUpdatedFields(f => ({ ...f, residentName: e.target.value }))} className={inputCls} placeholder="Full name" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Property</label>
              <input value={updatedFields.property} onChange={e => setUpdatedFields(f => ({ ...f, property: e.target.value }))} className={inputCls} placeholder="Property name" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Unit / Room</label>
              <input value={updatedFields.unit} onChange={e => setUpdatedFields(f => ({ ...f, unit: e.target.value }))} className={inputCls} placeholder="Room 1" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Monthly Rent ($)</label>
              <input type="number" value={updatedFields.rent} onChange={e => setUpdatedFields(f => ({ ...f, rent: e.target.value }))} className={inputCls} placeholder="0.00" min="0" step="0.01" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Lease Start</label>
              <input type="date" value={updatedFields.leaseStart} onChange={e => setUpdatedFields(f => ({ ...f, leaseStart: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Lease End</label>
              <input type="date" value={updatedFields.leaseEnd} onChange={e => setUpdatedFields(f => ({ ...f, leaseEnd: e.target.value }))} className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Security Deposit ($)</label>
              <input type="number" value={updatedFields.deposit} onChange={e => setUpdatedFields(f => ({ ...f, deposit: e.target.value }))} className={inputCls} placeholder="0.00" min="0" step="0.01" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Utility Fee ($)</label>
              <input type="number" value={updatedFields.utilityFee} onChange={e => setUpdatedFields(f => ({ ...f, utilityFee: e.target.value }))} className={inputCls} placeholder="0.00" min="0" step="0.01" />
            </div>
            <div className="col-span-2">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Special Terms</label>
              <textarea value={updatedFields.specialTerms} onChange={e => setUpdatedFields(f => ({ ...f, specialTerms: e.target.value }))} rows={2} className={inputCls + ' resize-none'} placeholder="Parking, pets, utilities included, etc." />
            </div>
            <div className="col-span-2 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Attach Revised PDF (optional)</p>
              <div className="grid grid-cols-2 gap-2">
                <input value={pdfUrl} onChange={e => setPdfUrl(e.target.value)} className={inputCls} placeholder="https://drive.google.com/… or direct PDF link" />
                <input value={pdfFileName} onChange={e => setPdfFileName(e.target.value)} className={inputCls} placeholder="lease-v2.pdf" />
              </div>
              <p className="mt-1.5 text-[11px] text-slate-400">Provide a publicly accessible URL. Each upload creates a versioned record in the history.</p>
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
            <button type="button" onClick={onClose} disabled={submitting} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={submitting} className="rounded-xl bg-[#2563eb] px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
              {submitting ? 'Updating…' : 'Update & Send'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ManagerReviewModal({ draft, manager, onClose, onSubmitted }) {
  const [action, setAction] = useState('approve')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const inputCls = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 placeholder:text-slate-400 focus:border-[#2563eb] focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20'

  async function handleSubmit(e) {
    e.preventDefault()
    if (action === 'request-changes' && !notes.trim()) {
      toast.error('Please describe what still needs to change.')
      return
    }
    setSubmitting(true)
    try {
      await callPortalAction('lease-manager-review', {
        leaseDraftId: draft.id,
        managerRecordId: manager?.id || manager?.airtableRecordId || '',
        managerName: manager?.name || 'Manager',
        action,
        notes: notes.trim(),
      })
      toast.success(action === 'approve' ? 'Lease approved!' : 'Further changes requested')
      onSubmitted()
      onClose()
    } catch (err) {
      toast.error(err.message || 'Failed to submit review')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl bg-white shadow-2xl">
        <div className="border-b border-slate-100 px-6 py-4">
          <h2 className="text-lg font-black text-slate-900">Review Admin Update</h2>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setAction('approve')}
              className={`rounded-2xl border px-4 py-3 text-sm font-semibold transition ${action === 'approve' ? 'border-green-300 bg-green-50 text-green-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            >
              ✓ Approve Lease
            </button>
            <button
              type="button"
              onClick={() => setAction('request-changes')}
              className={`rounded-2xl border px-4 py-3 text-sm font-semibold transition ${action === 'request-changes' ? 'border-orange-300 bg-orange-50 text-orange-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            >
              ↩ Request More Changes
            </button>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Notes {action === 'request-changes' && <span className="text-red-500">*</span>}
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              className={inputCls + ' resize-none'}
              placeholder={action === 'approve' ? 'Optional comment…' : 'Describe what still needs to change…'}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} disabled={submitting} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
            <button
              type="submit"
              disabled={submitting}
              className={`rounded-xl px-5 py-2 text-sm font-semibold text-white disabled:opacity-50 ${action === 'approve' ? 'bg-green-600 hover:bg-green-700' : 'bg-orange-600 hover:bg-orange-700'}`}
            >
              {submitting ? 'Submitting…' : action === 'approve' ? 'Approve' : 'Request Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Main LeaseWorkspace ──────────────────────────────────────────────────────

export default function LeaseWorkspace({ draft: initialDraft, isAdmin, manager, adminUser, onBack, onRefresh }) {
  const [draft, setDraft] = useState(initialDraft)
  const [section, setSection] = useState('details')
  const [comments, setComments] = useState([])
  const [versions, setVersions] = useState([])
  const [auditLog, setAuditLog] = useState([])
  const [loading, setLoading] = useState(true)
  const [commentText, setCommentText] = useState('')
  const [commentSubmitting, setCommentSubmitting] = useState(false)
  const [showEditRequestModal, setShowEditRequestModal] = useState(false)
  const [showAdminRespondModal, setShowAdminRespondModal] = useState(false)
  const [showManagerReviewModal, setShowManagerReviewModal] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const commentsEndRef = useRef(null)

  const currentUserRecordId = isAdmin
    ? (adminUser?.airtableRecordId || adminUser?.id || '')
    : (manager?.id || manager?.airtableRecordId || '')

  const status = draft['Status'] || 'Draft Generated'
  const statusCfg = getStatusConfig(status)
  const leaseJson = (() => { try { return JSON.parse(draft['Lease JSON'] || '{}') } catch { return {} } })()
  const managerNotes = parseManagerEditNotes(draft['Manager Edit Notes'])
  const adminNotes = parseAdminResponseNotes(draft['Admin Response Notes'])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [c, v, a] = await Promise.all([
        fetchComments(draft.id),
        fetchVersions(draft.id),
        fetchAuditLog(draft.id),
      ])
      setComments(c)
      setVersions(v)
      setAuditLog(a)
    } catch (err) {
      console.warn('[LeaseWorkspace] loadData error:', err.message)
    } finally {
      setLoading(false)
    }
  }, [draft.id])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    if (section === 'comments' && commentsEndRef.current) {
      commentsEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [section, comments])

  async function handleAddComment(e) {
    e.preventDefault()
    if (!commentText.trim()) return
    setCommentSubmitting(true)
    try {
      await callPortalAction('lease-add-comment', {
        leaseDraftId: draft.id,
        authorName: isAdmin ? (adminUser?.name || 'Admin') : (manager?.name || 'Manager'),
        authorRole: isAdmin ? 'Admin' : 'Manager',
        authorRecordId: currentUserRecordId,
        message: commentText.trim(),
      })
      setCommentText('')
      await loadData()
    } catch (err) {
      toast.error(err.message || 'Failed to send comment')
    } finally {
      setCommentSubmitting(false)
    }
  }

  async function handleAdminSetStatus(newStatus) {
    setActionBusy(true)
    try {
      await callPortalAction('lease-admin-respond', {
        leaseDraftId: draft.id,
        adminRecordId: adminUser?.airtableRecordId || adminUser?.id || '',
        adminName: adminUser?.name || 'Admin',
        newStatus,
        adminNotes: '',
        updatedFields: {},
      })
      toast.success(`Status updated to "${newStatus}"`)
      setDraft(d => ({ ...d, Status: newStatus }))
      onRefresh?.()
      await loadData()
    } catch (err) {
      toast.error(err.message || 'Failed to update status')
    } finally {
      setActionBusy(false)
    }
  }

  function handleActionDone() {
    onRefresh?.()
    loadData()
    // Re-fetch the draft to get updated status
    fetch(`${AT_BASE}/Lease%20Drafts/${draft.id}`, {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
    })
      .then(r => r.json())
      .then(data => { if (data?.fields) setDraft({ id: draft.id, ...data.fields }) })
      .catch(() => {})
  }

  const canManagerSubmitRequest = MANAGER_CAN_SUBMIT_REQUEST.has(status)
  const canManagerReview = MANAGER_CAN_REVIEW_ADMIN_UPDATE.has(status)
  const canAdminRespond = ['Submitted to Admin', 'Admin In Review', 'Changes Made'].includes(status)
  const canAdminFinalize = status === 'Manager Approved'

  const cardCls = 'rounded-3xl border border-slate-200 bg-white shadow-sm'

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" /></svg>
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Lease</span>
              <span className="font-mono text-xs text-slate-400">#{draft.id?.slice(-8)}</span>
            </div>
            <h1 className="text-xl font-black text-slate-900">
              {draft['Resident Name'] || leaseJson.tenantName || 'Unnamed Tenant'}
            </h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={status} />
          {statusCfg.adminActionNeeded && (
            <span className="rounded-full bg-blue-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-blue-700">Admin action needed</span>
          )}
          {statusCfg.managerActionNeeded && (
            <span className="rounded-full bg-orange-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-orange-700">Your action needed</span>
          )}
        </div>
      </div>

      {/* Requested changes banner */}
      {managerNotes && ['Submitted to Admin', 'Admin In Review'].includes(status) && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-blue-700">Manager Edit Request</p>
          <p className="text-sm text-blue-900 whitespace-pre-wrap">{managerNotes.freeText}</p>
          {managerNotes.requestedFields && Object.values(managerNotes.requestedFields).some(Boolean) && (
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-3">
              {Object.entries({
                'Tenant': managerNotes.requestedFields?.tenantName,
                'Property': managerNotes.requestedFields?.property,
                'Room': managerNotes.requestedFields?.room,
                'Start': managerNotes.requestedFields?.leaseStart,
                'End': managerNotes.requestedFields?.leaseEnd,
                'Rent': managerNotes.requestedFields?.rent ? `$${managerNotes.requestedFields.rent}` : '',
                'Deposit': managerNotes.requestedFields?.deposit ? `$${managerNotes.requestedFields.deposit}` : '',
                'Utilities': managerNotes.requestedFields?.utilities ? `$${managerNotes.requestedFields.utilities}` : '',
              }).filter(([, v]) => v).map(([k, v]) => (
                <React.Fragment key={k}>
                  <dt className="text-[10px] font-bold uppercase text-blue-500">{k}</dt>
                  <dd className="text-xs font-medium text-blue-900">{v}</dd>
                </React.Fragment>
              ))}
            </dl>
          )}
        </div>
      )}

      {/* Admin response banner */}
      {adminNotes && status === 'Sent Back to Manager' && (
        <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4">
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-orange-700">Admin Update — Please Review</p>
          <p className="text-sm text-orange-900 whitespace-pre-wrap">{adminNotes.freeText}</p>
        </div>
      )}

      {/* Section tabs */}
      <div className={cardCls}>
        <div className="flex overflow-x-auto border-b border-slate-100 px-2">
          {[
            { id: 'details', label: 'Lease Details' },
            { id: 'comments', label: 'Comments', badge: comments.length },
            { id: 'versions', label: 'PDF Versions', badge: versions.length },
            { id: 'timeline', label: 'Activity', badge: auditLog.length },
          ].map(t => (
            <SectionTab key={t.id} {...t} active={section === t.id} onClick={setSection} />
          ))}
        </div>

        <div className="p-5">
          {/* ── Details ── */}
          {section === 'details' && (
            <dl className="grid gap-3 sm:grid-cols-2">
              <FieldRow label="Tenant" value={draft['Resident Name'] || leaseJson.tenantName} />
              <FieldRow label="Email" value={draft['Resident Email'] || leaseJson.tenantEmail} />
              <FieldRow label="Property" value={draft['Property'] || leaseJson.propertyName} />
              <FieldRow label="Unit / Room" value={draft['Unit'] || leaseJson.roomNumber} />
              <FieldRow label="Lease Start" value={leaseJson.leaseStart || leaseJson.leaseStartFmt} />
              <FieldRow label="Lease End" value={leaseJson.leaseEnd || leaseJson.leaseEndFmt} />
              <FieldRow label="Monthly Rent" value={leaseJson.monthlyRent ? fmtDollar(leaseJson.monthlyRent) : null} />
              <FieldRow label="Security Deposit" value={leaseJson.securityDeposit ? fmtDollar(leaseJson.securityDeposit) : null} />
              <FieldRow label="Utility Fee" value={leaseJson.utilityFee ? fmtDollar(leaseJson.utilityFee) : null} />
              <FieldRow label="Current Version" value={draft['Current Version'] ? `v${draft['Current Version']}` : 'v1'} />
              <FieldRow label="Status" value={statusCfg.label} />
              <FieldRow label="Last Updated" value={fmtTs(draft['Updated At'] || draft['created_at'])} />
              {leaseJson.specialTerms && (
                <div className="col-span-2">
                  <FieldRow label="Special Terms" value={leaseJson.specialTerms} />
                </div>
              )}
            </dl>
          )}

          {/* ── Comments ── */}
          {section === 'comments' && (
            <div className="flex flex-col gap-4">
              {loading ? (
                <div className="py-8 text-center text-sm text-slate-500">Loading comments…</div>
              ) : comments.length === 0 ? (
                <div className="py-10 text-center">
                  <div className="mb-2 text-3xl" aria-hidden>💬</div>
                  <p className="text-sm font-semibold text-slate-700">No comments yet</p>
                  <p className="text-xs text-slate-500">Use the form below to start the conversation</p>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {comments.map(c => (
                    <CommentBubble key={c.id} comment={c} currentUserRecordId={currentUserRecordId} />
                  ))}
                  <div ref={commentsEndRef} />
                </div>
              )}
              <form onSubmit={handleAddComment} className="mt-2 flex gap-2 border-t border-slate-100 pt-4">
                <input
                  value={commentText}
                  onChange={e => setCommentText(e.target.value)}
                  placeholder="Add a comment…"
                  className="flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/20"
                />
                <button
                  type="submit"
                  disabled={commentSubmitting || !commentText.trim()}
                  className="rounded-2xl bg-[#2563eb] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40 hover:bg-blue-700"
                >
                  {commentSubmitting ? '…' : 'Send'}
                </button>
              </form>
            </div>
          )}

          {/* ── PDF Versions ── */}
          {section === 'versions' && (
            <div className="flex flex-col gap-3">
              {loading ? (
                <div className="py-8 text-center text-sm text-slate-500">Loading versions…</div>
              ) : versions.length === 0 ? (
                <div className="py-10 text-center">
                  <div className="mb-2 text-3xl" aria-hidden>📄</div>
                  <p className="text-sm font-semibold text-slate-700">No PDF versions yet</p>
                  {isAdmin ? (
                    <p className="text-xs text-slate-500">Use "Update Lease" to attach a revised PDF. Each upload creates a versioned record.</p>
                  ) : (
                    <p className="text-xs text-slate-500">PDF versions will appear here once admin uploads a revised draft.</p>
                  )}
                </div>
              ) : versions.map(v => <VersionRow key={v.id} version={v} />)}
            </div>
          )}

          {/* ── Activity Timeline ── */}
          {section === 'timeline' && (
            <div>
              {loading ? (
                <div className="py-8 text-center text-sm text-slate-500">Loading activity…</div>
              ) : auditLog.length === 0 ? (
                <div className="py-10 text-center">
                  <div className="mb-2 text-3xl" aria-hidden>📋</div>
                  <p className="text-sm font-semibold text-slate-700">No activity logged yet</p>
                </div>
              ) : (
                <div className="border-l-2 border-slate-100 pl-4">
                  {auditLog.map(e => <TimelineEntry key={e.id} entry={e} />)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div className={`${cardCls} p-5`}>
        <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">Actions</p>
        <div className="flex flex-wrap gap-2">
          {!isAdmin && (
            <>
              {canManagerSubmitRequest && (
                <button
                  type="button"
                  onClick={() => setShowEditRequestModal(true)}
                  className="rounded-xl bg-[#2563eb] px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  Request Lease Changes
                </button>
              )}
              {canManagerReview && (
                <button
                  type="button"
                  onClick={() => setShowManagerReviewModal(true)}
                  className="rounded-xl bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700"
                >
                  Review Admin Update
                </button>
              )}
            </>
          )}

          {isAdmin && (
            <>
              {canAdminRespond && (
                <>
                  {status === 'Submitted to Admin' && (
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => handleAdminSetStatus('Admin In Review')}
                      className="rounded-xl border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                    >
                      Mark In Review
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowAdminRespondModal(true)}
                    className="rounded-xl bg-[#2563eb] px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                  >
                    Edit Lease & Send Back
                  </button>
                </>
              )}
              {canAdminFinalize && (
                <button
                  type="button"
                  disabled={actionBusy}
                  onClick={() => handleAdminSetStatus('Ready for Signature')}
                  className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  Mark Ready for Signature
                </button>
              )}
            </>
          )}

          {/* Always visible: Comments shortcut */}
          <button
            type="button"
            onClick={() => setSection('comments')}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            View Comments {comments.length > 0 ? `(${comments.length})` : ''}
          </button>
        </div>
      </div>

      {/* Modals */}
      {showEditRequestModal && (
        <EditRequestModal
          draft={draft}
          manager={manager}
          onClose={() => setShowEditRequestModal(false)}
          onSubmitted={handleActionDone}
        />
      )}
      {showAdminRespondModal && (
        <AdminRespondModal
          draft={draft}
          adminUser={adminUser}
          onClose={() => setShowAdminRespondModal(false)}
          onSubmitted={handleActionDone}
        />
      )}
      {showManagerReviewModal && (
        <ManagerReviewModal
          draft={draft}
          manager={manager}
          onClose={() => setShowManagerReviewModal(false)}
          onSubmitted={handleActionDone}
        />
      )}
    </div>
  )
}

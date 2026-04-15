/**
 * ManagerApplicationLease.jsx
 *
 * Rendered in the application detail panel (Lease section) when an application is approved.
 * Handles the full Generate Lease → Preview → Send to Resident workflow.
 *
 * Props:
 *   applicationId  - Airtable record ID of the application
 *   managerName    - current manager's display name
 */

import { useState, useEffect, useMemo } from 'react'
import toast from 'react-hot-toast'
import LeaseHTMLTemplate from './LeaseHTMLTemplate'
import { pickManagerSignatureFromDraft } from '../../../shared/lease-manager-signature-fields.js'
import { publishLeaseDraft, generateLeaseFromApplication } from '../lib/airtable'

/** Hide legacy Airtable value "Changes Needed" — same queue as other pre-publish drafts. */
function leaseDraftStatusLabel(raw) {
  const s = String(raw || '').trim()
  if (s === 'Changes Needed') return 'Manager Review'
  return s || 'No draft'
}

function StatusBadge({ status }) {
  const label = leaseDraftStatusLabel(status)
  const map = {
    'Manager Review': 'border-amber-200 bg-amber-50 text-amber-700',
    'Draft Generated': 'border-amber-200 bg-amber-50 text-amber-700',
    'Under Review': 'border-sky-200 bg-sky-50 text-sky-800',
    Approved: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    Published: 'border-blue-200 bg-blue-50 text-blue-700',
    Signed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  }
  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${map[label] || 'border-slate-200 bg-slate-50 text-slate-600'}`}>
      {label}
    </span>
  )
}

export default function ManagerApplicationLease({ applicationId, managerName }) {
  const [draft, setDraft] = useState(null)
  const [leaseData, setLeaseData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [sending, setSending] = useState(false)
  /** Collapse long lease document; expanded by default so the agreement shows in the application view. */
  const [leaseCollapsed, setLeaseCollapsed] = useState(false)

  // Fetch existing lease draft for this application.
  // generate-lease-from-template returns an existing draft if one already exists.
  useEffect(() => {
    if (!applicationId) return
    setLoading(true)
    generateLeaseFromApplication(applicationId, {}, '', { forceRegenerate: false })
      .then(({ draft: d }) => {
        setDraft(d)
        try {
          setLeaseData(d?.['Lease JSON'] ? JSON.parse(d['Lease JSON']) : null)
        } catch {
          setLeaseData(null)
        }
      })
      .catch(() => {
        /* No draft yet is fine */
        setDraft(null)
        setLeaseData(null)
      })
      .finally(() => setLoading(false))
  }, [applicationId])

  async function handleGenerate() {
    setGenerating(true)
    try {
      const { draft: d, created } = await generateLeaseFromApplication(applicationId, {}, '', {
        forceRegenerate: Boolean(draft),
      })
      setDraft(d)
      try {
        setLeaseData(d?.['Lease JSON'] ? JSON.parse(d['Lease JSON']) : null)
      } catch {
        setLeaseData(null)
      }
      toast.success(created ? 'Lease draft generated.' : 'Existing lease draft loaded.')
      setLeaseCollapsed(false)
    } catch (err) {
      toast.error(err.message || 'Could not generate lease draft.')
    } finally {
      setGenerating(false)
    }
  }

  async function handleSend() {
    if (!draft?.id) return
    setSending(true)
    try {
      const updated = await publishLeaseDraft(draft.id)
      setDraft(updated)
      toast.success('Lease sent to resident. They will see it in their portal.')
    } catch (err) {
      toast.error(err.message || 'Could not send lease.')
    } finally {
      setSending(false)
    }
  }

  const status = draft?.Status
  const isSigned = status === 'Signed'
  const isPublished = status === 'Published'
  const isDraft = status === 'Draft Generated'
  const managerSigOnDraft = useMemo(() => pickManagerSignatureFromDraft(draft, import.meta.env), [draft])

  if (loading) {
    return (
      <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50/60 px-5 py-4 text-sm text-slate-500">
        Checking lease draft…
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Lease</h3>
      {/* Status bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 px-5 py-3.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-700">Lease Draft</span>
          <StatusBadge status={status} />
        </div>

        {/* Signed confirmation */}
        {isSigned ? (
          <div className="ml-auto flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-700">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Resident signed
            {draft?.['Signed At'] ? (
              <span className="font-normal text-emerald-600">
                · {new Date(draft['Signed At']).toLocaleDateString()}
              </span>
            ) : null}
          </div>
        ) : null}

        <div className="ml-auto flex flex-wrap gap-2">
          {/* Generate / Regenerate */}
          {!isSigned && !isPublished ? (
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating}
              className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
            >
              {generating ? 'Generating…' : draft ? 'Regenerate Lease' : 'Generate Lease'}
            </button>
          ) : null}

          {/* Collapse full document */}
          {draft && leaseData ? (
            <button
              type="button"
              onClick={() => setLeaseCollapsed((v) => !v)}
              className="rounded-xl border border-[#2563eb]/25 bg-[#2563eb]/5 px-4 py-2 text-sm font-semibold text-[#2563eb] transition hover:bg-[#2563eb]/10"
            >
              {leaseCollapsed ? 'Show lease document' : 'Hide lease document'}
            </button>
          ) : null}

          {/* Send to Resident */}
          {draft && !isSigned && !isPublished ? (
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || !draft}
              className="rounded-xl bg-[#2563eb] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-[#1d4ed8] disabled:opacity-50"
            >
              {sending ? 'Sending…' : 'Send to Resident'}
            </button>
          ) : null}

          {/* Already published — show print */}
          {isPublished || isSigned ? (
            <button
              type="button"
              onClick={() => setLeaseCollapsed((v) => !v)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              {leaseCollapsed ? 'Show lease document' : 'Hide lease document'}
            </button>
          ) : null}
        </div>
      </div>

      {/* Signed signature detail */}
      {isSigned && draft?.['Signature Text'] ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 px-5 py-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-600">E-Signature on file</p>
          <p className="mt-1 font-serif text-lg italic text-slate-800">{draft['Signature Text']}</p>
          {draft['Signed At'] ? (
            <p className="mt-0.5 text-xs text-emerald-700">
              Signed {new Date(draft['Signed At']).toLocaleString()}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Formatted lease agreement (same view as resident / print) */}
      {leaseData && !leaseCollapsed ? (
        <div className="mt-1">
          <div className="mb-2 flex justify-end">
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
            >
              Print / Download PDF
            </button>
          </div>
          <div className="max-h-[min(70vh,900px)] overflow-y-auto overflow-x-hidden rounded-2xl border border-slate-200 bg-white shadow-inner">
            <LeaseHTMLTemplate
              leaseData={leaseData}
              signedBy={isSigned ? draft?.['Signature Text'] : undefined}
              signedAt={isSigned ? draft?.['Signed At'] : undefined}
              managerSignedBy={managerSigOnDraft.text || undefined}
              managerSignedAt={managerSigOnDraft.at || undefined}
              managerSignatureImageUrl={managerSigOnDraft.image || undefined}
            />
          </div>
        </div>
      ) : draft && !leaseData ? (
        <p className="text-sm text-slate-500">
          Lease draft exists but structured data is missing. Try <strong>Regenerate Lease</strong> to rebuild the document.
        </p>
      ) : null}
    </div>
  )
}

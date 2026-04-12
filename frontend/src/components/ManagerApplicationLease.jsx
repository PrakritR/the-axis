/**
 * ManagerApplicationLease.jsx
 *
 * Shown below the ApplicationDetailPanel when an application is approved.
 * Handles the full Generate Lease → Preview → Send to Resident workflow.
 *
 * Props:
 *   applicationId  - Airtable record ID of the application
 *   managerName    - current manager's display name
 */

import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import LeaseHTMLTemplate from './LeaseHTMLTemplate'
import { publishLeaseDraft, generateLeaseFromApplication } from '../lib/airtable'

function StatusBadge({ status }) {
  const map = {
    'Draft Generated': 'border-amber-200 bg-amber-50 text-amber-700',
    Published: 'border-blue-200 bg-blue-50 text-blue-700',
    Signed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  }
  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${map[status] || 'border-slate-200 bg-slate-50 text-slate-600'}`}>
      {status || 'No draft'}
    </span>
  )
}

export default function ManagerApplicationLease({ applicationId, managerName }) {
  const [draft, setDraft] = useState(null)
  const [leaseData, setLeaseData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [sending, setSending] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  // Fetch existing lease draft for this application.
  // generate-lease-from-template returns an existing draft if one already exists.
  useEffect(() => {
    if (!applicationId) return
    setLoading(true)
    generateLeaseFromApplication(applicationId)
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
      const { draft: d, created } = await generateLeaseFromApplication(applicationId)
      setDraft(d)
      try {
        setLeaseData(d?.['Lease JSON'] ? JSON.parse(d['Lease JSON']) : null)
      } catch {
        setLeaseData(null)
      }
      toast.success(created ? 'Lease draft generated.' : 'Existing lease draft loaded.')
      setShowPreview(true)
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

  if (loading) {
    return (
      <div className="mt-4 rounded-2xl border border-slate-100 bg-slate-50/60 px-5 py-4 text-sm text-slate-500">
        Checking lease draft…
      </div>
    )
  }

  return (
    <div className="mt-4 space-y-3">
      {/* Status bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-3.5">
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

          {/* Preview */}
          {draft && leaseData ? (
            <button
              type="button"
              onClick={() => setShowPreview((v) => !v)}
              className="rounded-xl border border-[#2563eb]/25 bg-[#2563eb]/5 px-4 py-2 text-sm font-semibold text-[#2563eb] transition hover:bg-[#2563eb]/10"
            >
              {showPreview ? 'Hide preview' : 'Preview Lease'}
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
              onClick={() => setShowPreview((v) => !v)}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              {showPreview ? 'Hide' : 'View Lease'}
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

      {/* Lease preview */}
      {showPreview && leaseData ? (
        <div className="mt-2">
          <div className="mb-2 flex justify-end">
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
            >
              Print / Download PDF
            </button>
          </div>
          <LeaseHTMLTemplate
            leaseData={leaseData}
            signedBy={isSigned ? draft?.['Signature Text'] : undefined}
            signedAt={isSigned ? draft?.['Signed At'] : undefined}
          />
        </div>
      ) : null}
    </div>
  )
}

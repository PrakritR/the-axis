import React, { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import {
  getCurrentLeaseVersion,
  getLeaseCommentsForDraft,
  getLeaseDraftById,
  publishLeaseDraft,
  upsertCurrentLeaseVersion,
} from '../lib/airtable'
import { fmtDollar, fmtTs, getStatusConfig } from '../lib/leaseWorkflowConstants.js'

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

function queueLabel(status) {
  const normalized = String(status || '').trim()
  if (
    ['Draft Generated', 'Under Review', 'Changes Needed', 'Approved', 'Sent Back to Manager', 'Changes Made'].includes(
      normalized,
    )
  ) {
    return 'Manager Review'
  }
  if (['Submitted to Admin', 'Admin In Review', 'Manager Approved', 'Ready for Signature'].includes(normalized)) {
    return 'Admin Review'
  }
  if (normalized === 'Published') return 'With Resident'
  if (normalized === 'Signed') return 'Signed'
  return normalized || 'Manager Review'
}

function statusIsDraftReady(status) {
  return [
    'Draft Generated',
    'Under Review',
    'Changes Needed',
    'Approved',
    'Sent Back to Manager',
    /** After admin marks changes; manager must be able to re-submit like "Sent Back to Manager" */
    'Changes Made',
  ].includes(String(status || '').trim())
}

function statusIsAdminReview(status) {
  return ['Submitted to Admin', 'Admin In Review', 'Manager Approved', 'Ready for Signature'].includes(
    String(status || '').trim(),
  )
}

function StatusBadge({ status }) {
  const cfg = getStatusConfig(status)
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${cfg.bg} ${cfg.text} ${cfg.border}`}>
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  )
}

function FieldRow({ label, value }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
      <dt className="w-full shrink-0 text-xs font-semibold uppercase tracking-[0.1em] text-slate-400 sm:w-36">{label}</dt>
      <dd className="text-sm font-medium text-slate-800 sm:flex-1">{value || '—'}</dd>
    </div>
  )
}

function CommentBubble({ comment, currentUserRecordId }) {
  const mine = String(comment['Author Record ID'] || '').trim() === String(currentUserRecordId || '').trim()
  const role = String(comment['Author Role'] || 'Unknown').trim() || 'Unknown'
  const roleTone = role === 'Admin' ? 'bg-blue-100 text-blue-700' : role === 'Resident' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
  return (
    <div className={`flex gap-3 ${mine ? 'flex-row-reverse' : ''}`}>
      <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${mine ? 'bg-[#2563eb] text-white' : 'bg-slate-100 text-slate-800'}`}>
        <div className={`mb-1 flex flex-wrap items-center gap-2 text-[11px] font-semibold ${mine ? 'text-blue-100' : 'text-slate-500'}`}>
          <span>{comment['Author Name'] || role}</span>
          <span className={`rounded-full px-2 py-0.5 ${mine ? 'bg-white/15 text-white' : roleTone}`}>{role}</span>
          <span>{fmtTs(comment['Timestamp'])}</span>
        </div>
        <p className="whitespace-pre-wrap text-sm">{comment['Message']}</p>
      </div>
    </div>
  )
}

function PdfCard({ currentPdf, showReplaceForm, pdfUrl, setPdfUrl, pdfFileName, setPdfFileName, savingPdf, onSavePdf }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Current PDF</div>
          <h3 className="mt-1 text-base font-black text-slate-900">{currentPdf?.['File Name'] || 'No PDF uploaded yet'}</h3>
          <p className="mt-1 text-xs text-slate-500">
            {currentPdf?.['Upload Date']
              ? `Last updated ${fmtTs(currentPdf['Upload Date'])}`
              : 'Upload one current PDF and it will replace the file shown here.'}
          </p>
        </div>
        {currentPdf?.['PDF URL'] ? (
          <a
            href={currentPdf['PDF URL']}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-[#2563eb] transition hover:bg-slate-50"
          >
            Open PDF
          </a>
        ) : null}
      </div>

      {currentPdf?.['PDF URL'] ? (
        <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
          <iframe title="Current lease PDF" src={currentPdf['PDF URL']} className="h-[420px] w-full bg-white" />
        </div>
      ) : null}

      {showReplaceForm ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            onSavePdf()
          }}
          className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 p-4"
        >
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Replace Current PDF</div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-semibold text-slate-600">PDF URL</span>
              <input
                value={pdfUrl}
                onChange={(event) => setPdfUrl(event.target.value)}
                placeholder="https://.../lease.pdf"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/20"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-xs font-semibold text-slate-600">File name</span>
              <input
                value={pdfFileName}
                onChange={(event) => setPdfFileName(event.target.value)}
                placeholder="lease.pdf"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/20"
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={savingPdf || !String(pdfUrl || '').trim()}
            className="mt-4 rounded-full bg-axis px-5 py-2.5 text-sm font-semibold text-white transition hover:brightness-105 disabled:opacity-50"
          >
            {savingPdf ? 'Saving…' : 'Save current PDF'}
          </button>
        </form>
      ) : null}
    </div>
  )
}

export default function LeaseWorkspace({ draft: initialDraft, isAdmin, manager, adminUser, onBack, onRefresh }) {
  const [draft, setDraft] = useState(initialDraft)
  const [comments, setComments] = useState([])
  const [currentPdf, setCurrentPdf] = useState(null)
  const [loading, setLoading] = useState(true)
  const [commentText, setCommentText] = useState('')
  const [commentSubmitting, setCommentSubmitting] = useState(false)
  const [managerRequestText, setManagerRequestText] = useState('')
  const [adminReviewText, setAdminReviewText] = useState('')
  const [pdfUrl, setPdfUrl] = useState('')
  const [pdfFileName, setPdfFileName] = useState('')
  const [savingPdf, setSavingPdf] = useState(false)
  const [actionBusy, setActionBusy] = useState('')

  const currentUserRecordId = isAdmin
    ? (adminUser?.airtableRecordId || adminUser?.id || '')
    : (manager?.id || manager?.airtableRecordId || '')

  const status = String(draft?.Status || 'Draft Generated').trim() || 'Draft Generated'
  const leaseJson = useMemo(() => {
    try {
      return JSON.parse(draft?.['Lease JSON'] || '{}')
    } catch {
      return {}
    }
  }, [draft])

  const canManagerAct = !isAdmin && statusIsDraftReady(status)
  const canAdminAct = isAdmin && statusIsAdminReview(status)

  const refreshAll = useCallback(async () => {
    setLoading(true)
    try {
      const [nextDraft, nextComments, nextPdf] = await Promise.all([
        getLeaseDraftById(draft.id),
        getLeaseCommentsForDraft(draft.id),
        getCurrentLeaseVersion(draft.id),
      ])
      setDraft(nextDraft)
      setComments(nextComments)
      setCurrentPdf(nextPdf)
      if (nextPdf?.['PDF URL']) {
        setPdfUrl(nextPdf['PDF URL'])
        setPdfFileName(nextPdf['File Name'] || '')
      }
    } catch (err) {
      toast.error(err.message || 'Could not load lease details')
    } finally {
      setLoading(false)
    }
  }, [draft.id])

  useEffect(() => {
    refreshAll()
  }, [refreshAll])

  async function handleSavePdf() {
    setSavingPdf(true)
    try {
      await upsertCurrentLeaseVersion({
        leaseDraftId: draft.id,
        pdfUrl,
        fileName: pdfFileName,
        uploaderName: isAdmin ? (adminUser?.name || 'Admin') : (manager?.name || 'Manager'),
        uploaderRole: isAdmin ? 'Admin' : 'Manager',
      })
      toast.success('Current PDF updated')
      await refreshAll()
    } catch (err) {
      toast.error(err.message || 'Could not save PDF')
    } finally {
      setSavingPdf(false)
    }
  }

  async function handleAddComment(event) {
    event.preventDefault()
    const message = commentText.trim()
    if (!message) return
    setCommentSubmitting(true)
    try {
      await callPortalAction('lease-add-comment', {
        leaseDraftId: draft.id,
        authorName: isAdmin ? (adminUser?.name || 'Admin') : (manager?.name || 'Manager'),
        authorRole: isAdmin ? 'Admin' : 'Manager',
        authorRecordId: currentUserRecordId,
        message,
      })
      setCommentText('')
      await refreshAll()
    } catch (err) {
      toast.error(err.message || 'Could not add comment')
    } finally {
      setCommentSubmitting(false)
    }
  }

  async function handleSubmitForAdminReview() {
    const note = managerRequestText.trim()
    if (!note) {
      toast.error('Add a short note for admin.')
      return
    }
    setActionBusy('manager-review')
    try {
      await callPortalAction('lease-submit-edit-request', {
        leaseDraftId: draft.id,
        managerRecordId: manager?.id || manager?.airtableRecordId || '',
        managerName: manager?.name || 'Manager',
        editNotes: note,
        requestedFields: {},
      })
      setManagerRequestText('')
      toast.success('Sent to admin')
      onRefresh?.()
      await refreshAll()
    } catch (err) {
      toast.error(err.message || 'Could not send to admin')
    } finally {
      setActionBusy('')
    }
  }

  async function handleMarkInReview() {
    setActionBusy('admin-in-review')
    try {
      await callPortalAction('lease-admin-respond', {
        leaseDraftId: draft.id,
        adminRecordId: adminUser?.airtableRecordId || adminUser?.id || '',
        adminName: adminUser?.name || 'Admin',
        newStatus: 'Admin In Review',
        adminNotes: '',
        updatedFields: {},
      })
      toast.success('Review started')
      onRefresh?.()
      await refreshAll()
    } catch (err) {
      toast.error(err.message || 'Could not mark in review')
    } finally {
      setActionBusy('')
    }
  }

  async function handleSendBackToManager() {
    setActionBusy('admin-send-back')
    try {
      await callPortalAction('lease-admin-respond', {
        leaseDraftId: draft.id,
        adminRecordId: adminUser?.airtableRecordId || adminUser?.id || '',
        adminName: adminUser?.name || 'Admin',
        newStatus: 'Sent Back to Manager',
        adminNotes: adminReviewText.trim(),
        updatedFields: {},
      })
      setAdminReviewText('')
      toast.success('Sent to manager')
      onRefresh?.()
      await refreshAll()
    } catch (err) {
      toast.error(err.message || 'Could not send to manager')
    } finally {
      setActionBusy('')
    }
  }

  async function handleSendToResident() {
    setActionBusy('send-resident')
    try {
      await publishLeaseDraft(draft.id)
      toast.success('Lease sent')
      onRefresh?.()
      await refreshAll()
    } catch (err) {
      toast.error(err.message || 'Could not send to resident')
    } finally {
      setActionBusy('')
    }
  }

  const cardCls = 'rounded-3xl border border-slate-200 bg-white p-5 shadow-sm'

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
            </svg>
          </button>
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
              <span>Lease</span>
              <span>#{draft.id?.slice(-8)}</span>
            </div>
            <h1 className="text-xl font-black text-slate-900">{draft['Resident Name'] || 'Unnamed resident'}</h1>
            <p className="mt-0.5 text-sm text-slate-500">{draft['Property'] || 'Property not set'}{draft['Unit'] ? ` · ${draft['Unit']}` : ''}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={status} />
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600">{queueLabel(status)}</span>
        </div>
      </div>

      {loading ? <div className={`${cardCls} text-sm text-slate-500`}>Loading lease…</div> : null}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
        <div className="space-y-5">
          <div className={cardCls}>
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Lease Details</div>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              <FieldRow label="Resident" value={draft['Resident Name'] || leaseJson.tenantName} />
              <FieldRow label="Email" value={draft['Resident Email'] || leaseJson.tenantEmail} />
              <FieldRow label="Property" value={draft['Property'] || leaseJson.propertyName} />
              <FieldRow label="Unit" value={draft['Unit'] || leaseJson.roomNumber} />
              <FieldRow label="Lease Start" value={leaseJson.leaseStart || leaseJson.leaseStartFmt} />
              <FieldRow label="Lease End" value={leaseJson.leaseEnd || leaseJson.leaseEndFmt} />
              <FieldRow label="Monthly Rent" value={leaseJson.monthlyRent ? fmtDollar(leaseJson.monthlyRent) : null} />
              <FieldRow label="Security Deposit" value={leaseJson.securityDeposit ? fmtDollar(leaseJson.securityDeposit) : null} />
              <FieldRow label="Utility Fee" value={leaseJson.utilityFee ? fmtDollar(leaseJson.utilityFee) : null} />
              <FieldRow label="Last Updated" value={fmtTs(draft['Updated At'] || draft.created_at)} />
            </dl>
            {leaseJson.specialTerms ? (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Special Terms</div>
                <p className="whitespace-pre-wrap">{leaseJson.specialTerms}</p>
              </div>
            ) : null}
          </div>

          <PdfCard
            currentPdf={currentPdf}
            showReplaceForm={canManagerAct || canAdminAct}
            pdfUrl={pdfUrl}
            setPdfUrl={setPdfUrl}
            pdfFileName={pdfFileName}
            setPdfFileName={setPdfFileName}
            savingPdf={savingPdf}
            onSavePdf={handleSavePdf}
          />

          <div className={cardCls}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Comments</div>
                <h3 className="mt-1 text-base font-black text-slate-900">Messages</h3>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{comments.length}</span>
            </div>
            {comments.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">No comments yet.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {comments.map((comment) => (
                  <CommentBubble key={comment.id} comment={comment} currentUserRecordId={currentUserRecordId} />
                ))}
              </div>
            )}
            <form onSubmit={handleAddComment} className="mt-4 flex gap-2 border-t border-slate-100 pt-4">
              <input
                value={commentText}
                onChange={(event) => setCommentText(event.target.value)}
                placeholder="Add a comment…"
                className="flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/20"
              />
              <button
                type="submit"
                disabled={commentSubmitting || !commentText.trim()}
                className="rounded-2xl bg-[#2563eb] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-40"
              >
                {commentSubmitting ? 'Sending…' : 'Send'}
              </button>
            </form>
          </div>
        </div>

        <div className="space-y-5">
          {!isAdmin ? (
            <div className={cardCls}>
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Manager Actions</div>
              <h3 className="mt-1 text-base font-black text-slate-900">Your lease actions</h3>
              <p className="mt-2 text-sm text-slate-500">
                Keep one current PDF, send notes to admin if needed, and send the lease to the resident when it is ready.
              </p>
              {canManagerAct ? (
                <>
                  <label className="mt-4 block">
                    <span className="mb-1 block text-xs font-semibold text-slate-600">Note for admin</span>
                    <textarea
                      value={managerRequestText}
                      onChange={(event) => setManagerRequestText(event.target.value)}
                      rows={4}
                      placeholder="What does admin need to update?"
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/20"
                    />
                  </label>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleSubmitForAdminReview}
                      disabled={actionBusy === 'manager-review'}
                      className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                    >
                      {actionBusy === 'manager-review' ? 'Sending…' : 'Send to Admin'}
                    </button>
                    <button
                      type="button"
                      onClick={handleSendToResident}
                      disabled={actionBusy === 'send-resident'}
                      className="rounded-full bg-axis px-4 py-2 text-sm font-semibold text-white transition hover:brightness-105 disabled:opacity-50"
                    >
                      {actionBusy === 'send-resident' ? 'Sending…' : 'Send Lease'}
                    </button>
                  </div>
                </>
              ) : (
                <p className="mt-4 text-sm text-slate-500">This lease is currently in {queueLabel(status).toLowerCase()}.</p>
              )}
            </div>
          ) : (
            <div className={cardCls}>
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Admin Actions</div>
              <h3 className="mt-1 text-base font-black text-slate-900">Admin Review</h3>
              <p className="mt-2 text-sm text-slate-500">
                Review the draft, replace the current PDF if needed, and send the update back to the manager.
              </p>
              {canAdminAct ? (
                <>
                  <label className="mt-4 block">
                    <span className="mb-1 block text-xs font-semibold text-slate-600">Note for manager</span>
                    <textarea
                      value={adminReviewText}
                      onChange={(event) => setAdminReviewText(event.target.value)}
                      rows={4}
                      placeholder="What should the manager know?"
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/20"
                    />
                  </label>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {status === 'Submitted to Admin' ? (
                      <button
                        type="button"
                        onClick={handleMarkInReview}
                        disabled={actionBusy === 'admin-in-review'}
                        className="rounded-full border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-50"
                      >
                        {actionBusy === 'admin-in-review' ? 'Updating…' : 'Start Review'}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={handleSendBackToManager}
                      disabled={actionBusy === 'admin-send-back'}
                      className="rounded-full bg-axis px-4 py-2 text-sm font-semibold text-white transition hover:brightness-105 disabled:opacity-50"
                    >
                      {actionBusy === 'admin-send-back' ? 'Sending…' : 'Send to Manager'}
                    </button>
                  </div>
                </>
              ) : (
                <p className="mt-4 text-sm text-slate-500">This lease is currently in {queueLabel(status).toLowerCase()}.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

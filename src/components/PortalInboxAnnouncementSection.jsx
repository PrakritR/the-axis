import React, { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import {
  airtableReady,
  getAllAnnouncementsAdmin,
  submitAnnouncementFromInbox,
  updateAnnouncement,
  isAnnouncementPending,
  parseAnnouncementSubmitterEmail,
  announcementAudienceDisplayText,
} from '../lib/airtable'

const PRIORITIES = ['Low', 'Normal', 'High', 'Urgent']

/**
 * Optional resident bulletin composer — separate from normal inbox chat.
 * Backed by Airtable "Announcements", optionally mirrored into the portal Messages thread.
 */
export default function PortalInboxAnnouncementSection({
  variant,
  userEmail,
  notifyThreadKey,
  propertySuggestions = [],
  onInboxRefresh,
  listId = 'portal-inbox-announcement-properties',
}) {
  const email = String(userEmail || '').trim()
  const isAdmin = variant === 'admin'
  const [pending, setPending] = useState([])
  const [loadingP, setLoadingP] = useState(false)

  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [summary, setSummary] = useState('')
  const [audience, setAudience] = useState('')
  const [pinned, setPinned] = useState(false)
  const [priority, setPriority] = useState('Normal')
  const [publishNow, setPublishNow] = useState(true)
  const [alsoNotifyThread, setAlsoNotifyThread] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [publishingId, setPublishingId] = useState(null)

  const loadPending = useCallback(async () => {
    if (!airtableReady) return
    setLoadingP(true)
    try {
      const all = await getAllAnnouncementsAdmin()
      const pend = all.filter(isAnnouncementPending)
      const sorted = [...pend].sort(
        (a, b) =>
          new Date(b.created_at || b['Created At'] || 0) - new Date(a.created_at || a['Created At'] || 0),
      )
      if (isAdmin) {
        setPending(sorted)
      } else {
        const em = email.toLowerCase()
        setPending(sorted.filter((p) => parseAnnouncementSubmitterEmail(p) === em))
      }
    } catch (e) {
      toast.error(e.message || 'Could not load announcements')
    } finally {
      setLoadingP(false)
    }
  }, [isAdmin, email])

  useEffect(() => {
    loadPending()
  }, [loadPending])

  async function handleComposerSubmit(e) {
    e.preventDefault()
    if (!email) {
      toast.error('Missing user email')
      return
    }
    const publish = isAdmin ? publishNow : false
    const hasThread = Boolean(String(notifyThreadKey || '').trim())
    const notify =
      hasThread && (isAdmin ? alsoNotifyThread : true)
        ? {
            threadKey: String(notifyThreadKey).trim(),
            senderEmail: email,
            isAdmin,
          }
        : null

    if (!publish && !isAdmin && !hasThread) {
      toast.error('Inbox thread is not available — cannot notify Axis.')
      return
    }

    setSubmitting(true)
    try {
      await submitAnnouncementFromInbox({
        title,
        message,
        shortSummary: summary,
        audienceTargetText: audience,
        pinned,
        priority,
        publish,
        submitterEmail: email,
        notifyInbox: notify,
      })
      toast.success(publish ? 'Announcement published.' : 'Submitted for review. Axis can publish it in Airtable or from the admin inbox.')
      setTitle('')
      setMessage('')
      setSummary('')
      setAudience('')
      setPinned(false)
      setPriority('Normal')
      await loadPending()
      onInboxRefresh?.()
    } catch (err) {
      toast.error(err.message || 'Could not save announcement')
    } finally {
      setSubmitting(false)
    }
  }

  async function handlePublishPending(recordId) {
    setPublishingId(recordId)
    try {
      await updateAnnouncement(recordId, { Show: true })
      toast.success('Published — visible to residents with matching target.')
      await loadPending()
      onInboxRefresh?.()
    } catch (err) {
      toast.error(err.message || 'Publish failed')
    } finally {
      setPublishingId(null)
    }
  }

  if (!airtableReady) return null

  return (
    <details className="group border-t border-slate-200 bg-slate-50/90">
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-bold text-slate-800 hover:bg-slate-100/80 lg:px-5 [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-2">
          <span className="text-slate-400 transition group-open:rotate-90">▸</span>
          Optional: post to resident bulletin
          {pending.length > 0 ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
              {isAdmin ? `${pending.length} pending` : `${pending.length} awaiting publish`}
            </span>
          ) : null}
        </span>
      </summary>
      <div className="space-y-4 border-t border-slate-100 px-4 pb-4 pt-2 lg:px-5">
        {isAdmin && (loadingP || pending.length > 0) ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wide text-amber-900">Pending review</p>
            {loadingP ? (
              <p className="mt-2 text-xs text-amber-800/80">Loading…</p>
            ) : (
              <ul className="mt-2 max-h-40 space-y-2 overflow-y-auto text-sm">
                {pending.map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-col gap-2 rounded-xl border border-amber-100 bg-white/90 p-2 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-900">{p.Title || 'Untitled'}</p>
                      <p className="text-[11px] text-slate-500">
                        {announcementAudienceDisplayText(p)}
                        {` · ${parseAnnouncementSubmitterEmail(p) || 'Axis'}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={publishingId === p.id}
                      onClick={() => handlePublishPending(p.id)}
                      className="shrink-0 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {publishingId === p.id ? 'Publishing…' : 'Publish'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {!isAdmin && pending.length > 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-3 text-sm text-slate-600">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Your pending</p>
            <ul className="mt-2 space-y-1.5">
              {pending.map((p) => (
                <li key={p.id} className="truncate text-slate-800">
                  · {p.Title || 'Untitled'}{' '}
                  <span className="text-xs text-slate-400">({announcementAudienceDisplayText(p)})</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <form onSubmit={handleComposerSubmit} className="space-y-3">
          <p className="text-xs text-slate-500">
            {isAdmin
              ? 'Use the message box above for general chat. This form only creates an entry in the Announcements table for the resident portal (Show controls visibility).'
              : 'For everyday messages, use the composer above. This section is only if you want a resident-facing bulletin post (pending until Axis publishes).'}
          </p>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            required
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/20"
          />
          <input
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Short summary (optional)"
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/20"
          />
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Body text shown to residents when published"
            required
            rows={4}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/20"
          />
          <div className="flex flex-wrap gap-3">
            <input
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              placeholder="Target: All Properties or e.g. 4709A, 5259"
              list={propertySuggestions.length ? listId : undefined}
              className="min-w-[12rem] flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/20"
            />
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
            >
              {PRIORITIES.map((pr) => (
                <option key={pr} value={pr}>
                  {pr}
                </option>
              ))}
            </select>
          </div>
          {propertySuggestions.length > 0 ? (
            <datalist id={listId}>
              <option value="All Properties" />
              {propertySuggestions.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          ) : null}
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="rounded border-slate-300" />
            Pin on resident portal
          </label>
          {isAdmin ? (
            <>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={publishNow}
                  onChange={(e) => setPublishNow(e.target.checked)}
                  className="rounded border-slate-300"
                />
                Publish immediately (Show on — visible to residents)
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={alsoNotifyThread}
                  onChange={(e) => setAlsoNotifyThread(e.target.checked)}
                  disabled={!String(notifyThreadKey || '').trim()}
                  className="rounded border-slate-300 disabled:opacity-40"
                />
                Also post summary to this inbox thread
              </label>
            </>
          ) : null}
          <button
            type="submit"
            disabled={submitting || !title.trim() || !message.trim()}
            className="w-full rounded-2xl border border-slate-800 bg-slate-900 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 sm:w-auto sm:px-6"
          >
            {submitting ? 'Saving…' : isAdmin && publishNow ? 'Publish to bulletin' : 'Submit for bulletin review'}
          </button>
        </form>
      </div>
    </details>
  )
}

import React, { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { PortalEmptyVisual } from '../components/portalNavIcons.jsx'
import { StatusPill } from '../components/PortalShell'
import {
  announcementAudienceDisplayText,
  createAnnouncement,
  deleteAnnouncement,
  getAllAnnouncementsAdmin,
  isAnnouncementPending,
  updateAnnouncement,
} from '../lib/airtable.js'

const PRIORITIES = ['Low', 'Normal', 'High', 'Urgent']

function statusTone(st) {
  const s = String(st || '').toLowerCase()
  if (s === 'published') return 'green'
  if (s === 'draft') return 'amber'
  if (s === 'archived') return 'slate'
  return 'slate'
}

export default function AdminAnnouncementsTab() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')

  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [audience, setAudience] = useState('All Properties')
  const [priority, setPriority] = useState('Normal')
  const [pinned, setPinned] = useState(false)
  const [creating, setCreating] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const list = await getAllAnnouncementsAdmin()
      setRows(Array.isArray(list) ? list : [])
    } catch (e) {
      setError(String(e?.message || '').trim() || 'Could not load announcements.')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function handleCreate(publish) {
    const t = String(title || '').trim()
    const m = String(message || '').trim()
    if (!t || !m) {
      toast.error('Title and message are required.')
      return
    }
    setCreating(true)
    try {
      await createAnnouncement({
        Title: t,
        Message: m,
        Target: String(audience || '').trim() || 'All Properties',
        Priority: { name: priority },
        Pinned: pinned,
        Show: Boolean(publish),
      })
      toast.success(publish ? 'Announcement published' : 'Draft saved')
      setTitle('')
      setMessage('')
      setAudience('All Properties')
      setPriority('Normal')
      setPinned(false)
      await refresh()
    } catch (e) {
      toast.error(String(e?.message || '').trim() || 'Could not save announcement.')
    } finally {
      setCreating(false)
    }
  }

  async function patchRow(id, fields) {
    setBusyId(String(id))
    try {
      await updateAnnouncement(id, fields)
      toast.success('Updated')
      await refresh()
    } catch (e) {
      toast.error(String(e?.message || '').trim() || 'Update failed.')
    } finally {
      setBusyId('')
    }
  }

  async function removeRow(id) {
    if (!window.confirm('Delete this announcement permanently?')) return
    setBusyId(String(id))
    try {
      await deleteAnnouncement(id)
      toast.success('Deleted')
      await refresh()
    } catch (e) {
      toast.error(String(e?.message || '').trim() || 'Delete failed.')
    } finally {
      setBusyId('')
    }
  }

  if (loading) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white px-6 py-16 text-center text-sm text-slate-500 shadow-sm">
        <span className="inline-flex items-center gap-2 font-semibold text-slate-600">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-slate-400" />
          Loading announcements…
        </span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-3xl border border-red-200 bg-red-50 px-6 py-8 text-sm text-red-900 shadow-sm">
        <p className="font-semibold">Could not load announcements</p>
        <p className="mt-2 text-red-800/90">{error}</p>
        <button
          type="button"
          onClick={() => refresh()}
          className="mt-4 rounded-xl border border-red-300 bg-white px-4 py-2 text-xs font-semibold text-red-800 shadow-sm transition hover:bg-red-100"
        >
          Try again
        </button>
      </div>
    )
  }

  return (
    <div className="min-w-0 space-y-8">
      <div>
        <h1 className="text-2xl font-black uppercase tracking-[0.08em] text-slate-900">Announcements</h1>
        <p className="mt-1 text-sm text-slate-600">Create drafts, publish to residents, or archive old posts.</p>
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">New announcement</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-semibold text-slate-700 sm:col-span-2">
            Title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm shadow-sm outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/20"
              placeholder="Building-wide reminder"
            />
          </label>
          <label className="block text-sm font-semibold text-slate-700 sm:col-span-2">
            Message
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm shadow-sm outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/20"
              placeholder="What residents should know…"
            />
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            Audience / targeting
            <input
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm shadow-sm outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/20"
              placeholder="All Properties or property names, comma-separated"
            />
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            Priority
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/20"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-700 sm:col-span-2">
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} className="h-4 w-4 rounded border-slate-300" />
            Pin to top of resident list
          </label>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={creating}
            onClick={() => handleCreate(false)}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
          >
            {creating ? 'Saving…' : 'Save draft'}
          </button>
          <button
            type="button"
            disabled={creating}
            onClick={() => handleCreate(true)}
            className="rounded-xl bg-axis px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:brightness-105 disabled:opacity-50"
          >
            {creating ? 'Publishing…' : 'Publish now'}
          </button>
        </div>
      </section>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-slate-50/80 px-6 py-16 text-center">
          <PortalEmptyVisual />
          <p className="mt-4 text-sm font-semibold text-slate-700">No announcements yet</p>
          <p className="mt-1 max-w-md text-sm text-slate-500">Create one above — drafts stay internal until you publish.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => {
            const id = String(row.id || '').trim()
            const st = String(row.status || (row.Show ? 'published' : 'draft')).toLowerCase()
            const pending = isAnnouncementPending(row)
            return (
              <li
                key={id || row.Title}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-base font-bold text-slate-900">{row.Title || 'Untitled'}</h3>
                      <StatusPill tone={statusTone(st)}>{st}</StatusPill>
                      {row.Pinned ? <StatusPill tone="axis">Pinned</StatusPill> : null}
                      {pending ? <StatusPill tone="amber">Not visible to residents</StatusPill> : null}
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-slate-600">{row.Message || row.Body || ''}</p>
                    <p className="mt-2 text-xs text-slate-500">
                      <span className="font-semibold text-slate-600">Audience:</span> {announcementAudienceDisplayText(row)}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 flex-wrap gap-2">
                    {st === 'draft' ? (
                      <button
                        type="button"
                        disabled={busyId === id}
                        onClick={() => patchRow(id, { Show: true })}
                        className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-900 transition hover:bg-emerald-100 disabled:opacity-50"
                      >
                        Publish
                      </button>
                    ) : null}
                    {st === 'published' ? (
                      <button
                        type="button"
                        disabled={busyId === id}
                        onClick={() => patchRow(id, { Show: false })}
                        className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 transition hover:bg-amber-100 disabled:opacity-50"
                      >
                        Unpublish
                      </button>
                    ) : null}
                    {st !== 'archived' ? (
                      <button
                        type="button"
                        disabled={busyId === id}
                        onClick={() => patchRow(id, { status: 'archived' })}
                        className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
                      >
                        Archive
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busyId === id}
                        onClick={() => patchRow(id, { status: 'published' })}
                        className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-900 transition hover:bg-blue-100 disabled:opacity-50"
                      >
                        Restore & publish
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busyId === id}
                      onClick={() => removeRow(id)}
                      className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-800 transition hover:bg-red-100 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

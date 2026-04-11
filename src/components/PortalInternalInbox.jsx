import React, { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import GmailStyleInboxLayout, { InboxThreadRow } from './GmailStyleInboxLayout'
import {
  portalInboxAirtableConfigured,
  getMessagesByThreadKey,
  getAllPortalInternalThreadMessages,
  sendMessage,
  managementAdminThreadKey,
  siteManagerThreadKey,
  residentLeasingThreadKey,
  PORTAL_INBOX_CHANNEL_INTERNAL,
  buildAirtableFormPrefillUrl,
  portalInboxThreadKeyFromRecord,
} from '../lib/airtable'
import PortalInboxThreadView, {
  buildResidentLeasingMessageBody,
  displayMessageForResidentPortal,
} from './PortalInboxThreadView.jsx'

const PORTAL_INBOX_FORM_URL = import.meta.env.VITE_AIRTABLE_PORTAL_INBOX_FORM_URL || ''
const CHANNEL_FIELD =
  import.meta.env.VITE_AIRTABLE_MESSAGE_CHANNEL_FIELD !== undefined
    ? import.meta.env.VITE_AIRTABLE_MESSAGE_CHANNEL_FIELD
    : 'Channel'
const THREAD_FIELD =
  import.meta.env.VITE_AIRTABLE_MESSAGE_THREAD_KEY_FIELD !== undefined
    ? import.meta.env.VITE_AIRTABLE_MESSAGE_THREAD_KEY_FIELD
    : 'Thread Key'

function formatDt(v) {
  if (!v) return ''
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}

function threadTitle(threadKey) {
  const t = String(threadKey)
  if (t.startsWith('internal:mgmt-admin:')) {
    return `Partner · ${t.slice('internal:mgmt-admin:'.length)}`
  }
  if (t.startsWith('internal:site-manager:')) {
    return `Site manager · ${t.slice('internal:site-manager:'.length)}`
  }
  if (t === 'internal:admin-public:general') {
    return 'Website · General inquiry'
  }
  if (t.startsWith('internal:admin-public:property:')) {
    return `Website · Property inquiry (admin)`
  }
  if (t.startsWith('internal:admin-public:')) {
    return `Website · ${t.slice('internal:admin-public:'.length)}`
  }
  if (t.startsWith('internal:resident-leasing:')) {
    return 'Resident · House team'
  }
  return t || 'Thread'
}

function SetupBanner({ variant }) {
  const exampleKey =
    variant === 'management'
      ? managementAdminThreadKey('you@example.com')
      : variant === 'site_manager'
        ? siteManagerThreadKey('you@example.com')
        : 'internal:mgmt-admin:you@example.com'

  const formUrl = PORTAL_INBOX_FORM_URL
    ? buildAirtableFormPrefillUrl(PORTAL_INBOX_FORM_URL, {
        [THREAD_FIELD]: exampleKey,
        [CHANNEL_FIELD]: PORTAL_INBOX_CHANNEL_INTERNAL,
      })
    : ''

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
      <p className="font-semibold text-amber-900">Connect the portal inbox in Airtable</p>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-amber-900/90">
        <li>
          On the <strong>Messages</strong> table, add a single-line text field <code className="rounded bg-white/80 px-1">{THREAD_FIELD}</code>{' '}
          and single select <code className="rounded bg-white/80 px-1">{CHANNEL_FIELD}</code> with option{' '}
          <code className="rounded bg-white/80 px-1">{PORTAL_INBOX_CHANNEL_INTERNAL}</code>.
        </li>
        <li>Allow <strong>Work Order</strong> to be empty for rows created from these threads (optional link field).</li>
        <li>
          Optional: create an Airtable Form for this table and set <code className="rounded bg-white/80 px-1">VITE_AIRTABLE_PORTAL_INBOX_FORM_URL</code>{' '}
          — the button below pre-fills thread and channel.
        </li>
      </ol>
      {formUrl ? (
        <a
          href={formUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex rounded-xl bg-amber-900 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-800"
        >
          Open Airtable message form
        </a>
      ) : null}
    </div>
  )
}

/**
 * Unified portal inbox (Messages table + thread key): resident, partner/management, site manager, or admin.
 * @param {'admin' | 'management' | 'site_manager' | 'resident'} variant
 * @param {object} [resident] — required when variant === 'resident' (Airtable resident row)
 */
export default function PortalInternalInbox({ variant, userEmail, userDisplayName, resident = null }) {
  const email = String(
    variant === 'resident' ? resident?.Email || userEmail || '' : userEmail || '',
  ).trim()
  const name = String(
    variant === 'resident' ? resident?.Name || email || 'Resident' : userDisplayName || email || 'User',
  ).trim()

  const fixedThreadKey = useMemo(() => {
    if (variant === 'resident' && resident?.id) return residentLeasingThreadKey(resident.id)
    if (variant === 'management') return managementAdminThreadKey(email)
    if (variant === 'site_manager') return siteManagerThreadKey(email)
    return ''
  }, [variant, email, resident?.id])

  const [allInternal, setAllInternal] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedThreadKey, setSelectedThreadKey] = useState(() => (variant === 'admin' ? '' : fixedThreadKey))
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [jumpPartnerEmail, setJumpPartnerEmail] = useState('')
  const [jumpManagerEmail, setJumpManagerEmail] = useState('')

  const live = portalInboxAirtableConfigured()

  const loadAdminFeed = useCallback(async () => {
    const rows = await getAllPortalInternalThreadMessages()
    setAllInternal(rows)
  }, [])

  const loadFixedThread = useCallback(async () => {
    if (!fixedThreadKey) return
    const rows = await getMessagesByThreadKey(fixedThreadKey)
    setAllInternal(rows)
  }, [fixedThreadKey])

  const refresh = useCallback(async () => {
    if (!live) return
    setLoading(true)
    try {
      if (variant === 'admin') await loadAdminFeed()
      else await loadFixedThread()
    } catch (err) {
      toast.error(err.message || 'Could not load inbox')
    } finally {
      setLoading(false)
    }
  }, [live, variant, loadAdminFeed, loadFixedThread])

  useEffect(() => {
    if (!live) {
      setLoading(false)
      return
    }
    refresh()
  }, [live, refresh])

  useEffect(() => {
    if (variant !== 'admin' && fixedThreadKey) setSelectedThreadKey(fixedThreadKey)
  }, [variant, fixedThreadKey])

  const threadGroups = useMemo(() => {
    const map = new Map()
    for (const m of allInternal) {
      const k = portalInboxThreadKeyFromRecord(m)
      if (!k) continue
      if (!map.has(k)) map.set(k, [])
      map.get(k).push(m)
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0))
    }
    return [...map.entries()].sort((a, b) => {
      const ta = a[1][a[1].length - 1]
      const tb = b[1][b[1].length - 1]
      return new Date(tb?.created_at || 0) - new Date(ta?.created_at || 0)
    })
  }, [allInternal])

  const activeThreadKey = variant === 'admin' ? selectedThreadKey : fixedThreadKey

  const threadMessages = useMemo(() => {
    if (!activeThreadKey) return []
    return allInternal
      .filter((m) => portalInboxThreadKeyFromRecord(m) === activeThreadKey)
      .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0))
  }, [allInternal, activeThreadKey])

  async function handleSend(e) {
    e.preventDefault()
    const text = draft.trim()
    if (!text || !activeThreadKey || !email) return
    setSending(true)
    try {
      const body =
        variant === 'resident' && resident ? buildResidentLeasingMessageBody(text, resident) : text
      await sendMessage({
        senderEmail: email,
        message: body,
        isAdmin: variant === 'admin',
        threadKey: activeThreadKey,
        channel: PORTAL_INBOX_CHANNEL_INTERNAL,
      })
      setDraft('')
      await refresh()
      toast.success('Sent')
    } catch (err) {
      toast.error(err.message || 'Send failed')
    } finally {
      setSending(false)
    }
  }

  const formPrefillUrl =
    live && activeThreadKey && PORTAL_INBOX_FORM_URL
      ? buildAirtableFormPrefillUrl(PORTAL_INBOX_FORM_URL, {
          [THREAD_FIELD]: activeThreadKey,
          [CHANNEL_FIELD]: PORTAL_INBOX_CHANNEL_INTERNAL,
          'Sender Email': email,
        })
      : ''

  if (!live) {
    return (
      <div className="space-y-4">
        <SetupBanner variant={variant} />
        <p className="text-sm text-slate-500">
          Set <code className="rounded bg-slate-100 px-1">VITE_AIRTABLE_TOKEN</code> and base ID, then add the fields above.
        </p>
      </div>
    )
  }

  const leftPane =
    variant === 'admin' ? (
      <>
        <div className="shrink-0 border-b border-slate-100 bg-white px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-black text-slate-900">Inbox</h2>
            <button
              type="button"
              onClick={() => refresh()}
              className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Refresh
            </button>
          </div>
          <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Open by email</p>
            <div className="flex flex-col gap-2">
              <input
                value={jumpPartnerEmail}
                onChange={(e) => setJumpPartnerEmail(e.target.value)}
                placeholder="Partner email"
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
              <button
                type="button"
                className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-200"
                onClick={() => {
                  const e = jumpPartnerEmail.trim().toLowerCase()
                  if (!e.includes('@')) {
                    toast.error('Enter a valid email')
                    return
                  }
                  setSelectedThreadKey(managementAdminThreadKey(e))
                }}
              >
                Open partner thread
              </button>
              <input
                value={jumpManagerEmail}
                onChange={(e) => setJumpManagerEmail(e.target.value)}
                placeholder="Site manager email"
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
              <button
                type="button"
                className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-200"
                onClick={() => {
                  const e = jumpManagerEmail.trim().toLowerCase()
                  if (!e.includes('@')) {
                    toast.error('Enter a valid email')
                    return
                  }
                  setSelectedThreadKey(siteManagerThreadKey(e))
                }}
              >
                Open manager thread
              </button>
            </div>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto bg-white">
          {threadGroups.map(([key, msgs]) => {
            const last = msgs[msgs.length - 1]
            return (
              <InboxThreadRow
                key={key}
                title={threadTitle(key)}
                preview={last?.Message || '—'}
                time={formatDt(last?.created_at)}
                selected={selectedThreadKey === key}
                onClick={() => setSelectedThreadKey(key)}
              />
            )
          })}
          {threadGroups.length === 0 && !loading ? <div className="px-4 py-8" aria-hidden /> : null}
        </div>
      </>
    ) : (
      <>
        <div className="shrink-0 border-b border-slate-100 bg-white px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-black text-slate-900">Inbox</h2>
              <p className="mt-0.5 text-xs text-slate-500">Messages with Axis</p>
            </div>
            <button
              type="button"
              onClick={() => refresh()}
              className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Refresh
            </button>
          </div>
          {formPrefillUrl ? (
            <a
              href={formPrefillUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex text-xs font-semibold text-[#2563eb] hover:underline"
            >
              Submit via Airtable form →
            </a>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto bg-white">
          {(() => {
            const msgs = threadGroups.find(([k]) => k === fixedThreadKey)?.[1] || []
            const last = msgs[msgs.length - 1]
            const rawPreview = last?.Message || ''
            const preview =
              variant === 'resident' && rawPreview
                ? displayMessageForResidentPortal(rawPreview)
                : rawPreview || 'No messages yet'
            return (
              <InboxThreadRow
                title={threadTitle(fixedThreadKey)}
                subtitle="Your conversation"
                preview={preview}
                time={formatDt(last?.created_at)}
                selected
                onClick={() => {}}
              />
            )
          })()}
        </div>
      </>
    )

  const adminLabel = variant === 'resident' ? 'House team' : 'Axis Admin'
  const mapBody =
    variant === 'resident'
      ? (m) => displayMessageForResidentPortal(m.Message)
      : (m) => m.Message

  const rightPane =
    variant === 'admin' && !activeThreadKey ? (
      <div className="flex h-full min-h-0 flex-1 flex-col items-center justify-center px-4 py-8">
        <p className="text-center text-sm text-slate-500">Select a thread from the list or open one by email.</p>
      </div>
    ) : loading ? (
      <div className="flex h-full min-h-0 flex-1 flex-col items-center justify-center py-12">
        <p className="text-sm text-slate-500">Loading…</p>
      </div>
    ) : (
      <PortalInboxThreadView
        title={activeThreadKey ? threadTitle(activeThreadKey) : 'Inbox'}
        subtitle={
          variant === 'admin' || variant === 'resident' || !activeThreadKey
            ? null
            : activeThreadKey
        }
        messages={threadMessages}
        bubbleMeLabel={name}
        bubbleOtherLabel={adminLabel}
        getIsOtherAdmin={(m) => Boolean(m['Is Admin'])}
        mapMessageBody={mapBody}
        emptyHint={
          variant === 'resident'
            ? 'No messages yet. Write below — your home is attached automatically for the team.'
            : `No messages yet. Say hello below${variant === 'admin' ? ' (first message starts the thread).' : '.'}`
        }
      >
        <form
          onSubmit={handleSend}
          className="shrink-0 border-t border-slate-200 bg-white px-4 py-3 lg:px-5"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              placeholder={
                variant === 'admin'
                  ? 'Reply as Axis Admin…'
                  : variant === 'resident'
                    ? 'Message your house team…'
                    : 'Message Axis…'
              }
              className="min-w-0 flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/20"
            />
            <button
              type="submit"
              disabled={sending || !draft.trim() || !activeThreadKey}
              className="rounded-2xl bg-[#2563eb] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </form>
      </PortalInboxThreadView>
    )

  return <GmailStyleInboxLayout left={leftPane} right={rightPane} />
}

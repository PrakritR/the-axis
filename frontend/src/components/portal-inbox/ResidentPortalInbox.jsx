import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
  getMessagesByThreadKey,
  sendMessage,
  residentLeasingThreadKey,
  residentAdminThreadKey,
  PORTAL_INBOX_CHANNEL_INTERNAL,
  portalInboxAirtableConfigured,
  fetchInboxThreadStateMap,
  inboxThreadStateAirtableEnabled,
  markInboxThreadRead,
  setInboxThreadTrash,
  getPortalInboxSubjectFieldName,
} from '../../lib/airtable'
import { isAirtablePermissionErrorMessage } from '../../lib/airtablePermissionError'
import { portalAxisAdminContactEmail } from '../../lib/portalInboxConstants.js'
import { resolveInboxSubject } from '../../lib/portalInboxSubjects.js'
import { notifyPortalMessage } from '../../lib/notifyPortalMessage.js'
import {
  threadSubjectFromMessages,
  threadBodyPreviewFromMessage,
  mergeSubjectIntoMessageIfNeeded,
  threadSearchHaystack,
} from '../../lib/portalInboxThreadUtils.js'
import ConversationList from '../manager-inbox/ConversationList'
import ConversationThread from '../manager-inbox/ConversationThread'
import MessageComposer from '../manager-inbox/MessageComposer'
import InboxSubjectPicker from './InboxSubjectPicker.jsx'
import { displayMessageForResidentPortal } from '../PortalInboxThreadView.jsx'

const UI_LEASING = 'ui:leasing'
const UI_ADMIN = 'ui:admin'

const RESIDENT_INBOX_THREAD_STATE_LS = 'axis_resident_inbox_thread_state_v1'

function formatDataLoadError(err) {
  if (err == null) return 'Unavailable'
  const raw = err?.message != null ? String(err.message) : String(err)
  try {
    const j = JSON.parse(raw)
    const inner = j?.error?.message || j?.message
    if (typeof inner === 'string' && inner.trim()) return inner.trim()
  } catch {
    /* not JSON */
  }
  return raw.length > 220 ? `${raw.slice(0, 217)}…` : raw
}

function fmtDateTime(val) {
  if (!val) return '—'
  try {
    return new Date(val).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return String(val)
  }
}

function loadLocalInboxStateMap(email) {
  const em = String(email || '').trim().toLowerCase()
  if (!em) return new Map()
  try {
    const root = JSON.parse(localStorage.getItem(RESIDENT_INBOX_THREAD_STATE_LS) || '{}')
    const bucket = root[em] || {}
    const m = new Map()
    for (const [tk, v] of Object.entries(bucket)) {
      m.set(tk, {
        id: `local:${tk}`,
        lastReadAt: v.lastReadAt ? new Date(v.lastReadAt) : null,
        trashed: Boolean(v.trashed),
      })
    }
    return m
  } catch {
    return new Map()
  }
}

function saveLocalInboxStatePatch(email, threadKey, patch) {
  const em = String(email || '').trim().toLowerCase()
  const tk = String(threadKey || '').trim()
  if (!em || !tk) return
  try {
    const root = JSON.parse(localStorage.getItem(RESIDENT_INBOX_THREAD_STATE_LS) || '{}')
    if (!root[em]) root[em] = {}
    const cur = root[em][tk] || {}
    const next = { ...cur }
    if (patch.lastReadAt !== undefined) {
      next.lastReadAt = patch.lastReadAt ? new Date(patch.lastReadAt).toISOString() : null
    }
    if (patch.trashed !== undefined) next.trashed = patch.trashed
    root[em][tk] = next
    localStorage.setItem(RESIDENT_INBOX_THREAD_STATE_LS, JSON.stringify(root))
  } catch {
    /* ignore */
  }
}

function sectionForRow(lastMsgTs, state) {
  if (state?.trashed) return 'trash'
  if (lastMsgTs <= 0) {
    return state?.lastReadAt ? 'opened' : 'unopened'
  }
  if (!state?.lastReadAt) return 'unopened'
  return lastMsgTs > state.lastReadAt.getTime() ? 'unopened' : 'opened'
}

function participantsLine(uiId) {
  if (uiId === UI_LEASING) return 'You ↔ House / Manager'
  if (uiId === UI_ADMIN) return 'You ↔ Axis Admin'
  return ''
}

/**
 * Resident portal inbox — same layout as manager/admin (list + thread + trash + subjects).
 */
export default function ResidentPortalInbox({ resident }) {
  const subjectFieldName = getPortalInboxSubjectFieldName()
  const showSubjectField = Boolean(subjectFieldName)

  const email = String(resident?.Email || '').trim()
  const leasingKey = resident?.id ? residentLeasingThreadKey(resident.id) : ''
  const adminKey = resident?.id ? residentAdminThreadKey(resident.id) : ''

  const [leasingMsgs, setLeasingMsgs] = useState([])
  const [adminMsgs, setAdminMsgs] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [selectedThreadId, setSelectedThreadId] = useState(null)
  const [thread, setThread] = useState([])
  const [threadLoading, setThreadLoading] = useState(false)
  const [reply, setReply] = useState('')
  const [replySubjectPreset, setReplySubjectPreset] = useState('')
  const [replySubjectCustom, setReplySubjectCustom] = useState('')
  const [sending, setSending] = useState(false)

  const [composeOpen, setComposeOpen] = useState(false)
  const [composeTo, setComposeTo] = useState('manager')
  const [composeSubjectPreset, setComposeSubjectPreset] = useState('')
  const [composeSubjectCustom, setComposeSubjectCustom] = useState('')
  const [composeBody, setComposeBody] = useState('')
  const [composeSending, setComposeSending] = useState(false)

  const [inboxStateMap, setInboxStateMap] = useState(() => new Map())
  const [inboxStateBackend, setInboxStateBackend] = useState('pending')
  const [sectionFilter, setSectionFilter] = useState('all')
  const [threadSearch, setThreadSearch] = useState('')

  const refreshInboxThreadState = useCallback(async () => {
    if (!email) {
      setInboxStateMap(new Map())
      setInboxStateBackend('none')
      return
    }
    if (inboxThreadStateAirtableEnabled()) {
      try {
        setInboxStateMap(await fetchInboxThreadStateMap(email))
        setInboxStateBackend('airtable')
        return
      } catch {
        /* fall back */
      }
    }
    setInboxStateMap(loadLocalInboxStateMap(email))
    setInboxStateBackend('local')
  }, [email])

  const loadAll = useCallback(async () => {
    if (!leasingKey || !adminKey) {
      setLeasingMsgs([])
      setAdminMsgs([])
      setLoading(false)
      return
    }
    setLoadError('')
    setLoading(true)
    try {
      const [l, a] = await Promise.all([
        getMessagesByThreadKey(leasingKey),
        getMessagesByThreadKey(adminKey),
      ])
      setLeasingMsgs(l)
      setAdminMsgs(a)
    } catch (err) {
      if (!isAirtablePermissionErrorMessage(err?.message)) {
        setLoadError(formatDataLoadError(err))
        toast.error('Inbox failed to load: ' + formatDataLoadError(err))
      }
    } finally {
      setLoading(false)
      try {
        await refreshInboxThreadState()
      } catch {
        /* non-fatal */
      }
    }
  }, [leasingKey, adminKey, refreshInboxThreadState])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // Auto-select the first (most recent) thread after initial load
  const hasAutoSelectedRef = useRef(false)
  useEffect(() => {
    if (loading) return
    if (hasAutoSelectedRef.current) return
    if (selectedThreadId) return
    // Pick thread with most recent message, default to leasing thread
    const mostRecent =
      (leasingMsgs.length > 0 || adminMsgs.length > 0)
        ? (leasingMsgs.length > 0 && adminMsgs.length === 0
            ? UI_LEASING
            : adminMsgs.length > 0 && leasingMsgs.length === 0
              ? UI_ADMIN
              : (() => {
                  const lTime = Math.max(...leasingMsgs.map((m) => new Date(m?.Timestamp || m?.created_at || 0).getTime()), 0)
                  const aTime = Math.max(...adminMsgs.map((m) => new Date(m?.Timestamp || m?.created_at || 0).getTime()), 0)
                  return lTime >= aTime ? UI_LEASING : UI_ADMIN
                })())
        : UI_LEASING
    hasAutoSelectedRef.current = true
    setSelectedThreadId(mostRecent)
  }, [loading, selectedThreadId, leasingMsgs, adminMsgs])

  const msgTime = (m) => new Date(m?.Timestamp || m?.created_at || 0).getTime()

  const threadRows = useMemo(() => {
    const rows = []
    const mkRow = (uiId, stateKey, participantLabel, sorted) => {
      const last = sorted[sorted.length - 1]
      const lastMsgTs = last ? msgTime(last) : 0
      const subjectLine =
        threadSubjectFromMessages(sorted, subjectFieldName) ||
        (uiId === UI_LEASING ? 'House / Manager' : 'Axis Admin')
      rows.push({
        id: uiId,
        stateKey,
        participantLabel,
        subjectLine,
        preview: threadBodyPreviewFromMessage(last),
        searchText: threadSearchHaystack(sorted, subjectFieldName, participantLabel, subjectLine),
        time: last ? fmtDateTime(last.Timestamp || last.created_at) : '',
        ts: lastMsgTs,
        lastMsgTs,
      })
    }
    const sortedL = [...leasingMsgs].sort((a, b) => msgTime(a) - msgTime(b))
    const sortedA = [...adminMsgs].sort((a, b) => msgTime(a) - msgTime(b))
    mkRow(UI_LEASING, leasingKey, 'House / Manager', sortedL)
    mkRow(UI_ADMIN, adminKey, 'Axis Admin', sortedA)
    rows.sort((a, b) => b.ts - a.ts)
    return rows
  }, [leasingMsgs, adminMsgs, leasingKey, adminKey, subjectFieldName])

  const threadRowsWithMeta = useMemo(() => {
    return threadRows.map((row) => {
      const st = inboxStateMap.get(row.stateKey)
      const section = sectionForRow(row.lastMsgTs, st)
      const unread = section === 'unopened'
      return { ...row, section, unread }
    })
  }, [threadRows, inboxStateMap])

  const inboxSections = useMemo(() => {
    const unopened = []
    const opened = []
    const trash = []
    for (const row of threadRowsWithMeta) {
      if (row.section === 'trash') trash.push(row)
      else if (row.section === 'unopened') unopened.push(row)
      else opened.push(row)
    }
    return { unopened, opened, trash }
  }, [threadRowsWithMeta])

  const inboxActiveTotal = inboxSections.unopened.length + inboxSections.opened.length

  const visibleThreadRows = useMemo(() => {
    const q = threadSearch.trim().toLowerCase()
    let rows = threadRowsWithMeta
    if (sectionFilter === 'all') rows = rows.filter((r) => r.section !== 'trash')
    else if (sectionFilter === 'unread') rows = rows.filter((r) => r.section === 'unopened')
    else if (sectionFilter === 'trash') rows = rows.filter((r) => r.section === 'trash')
    if (!q) return rows
    return rows.filter((r) => (r.searchText || '').includes(q))
  }, [threadRowsWithMeta, sectionFilter, threadSearch])

  const touchThreadRead = useCallback(
    async (stateKey) => {
      if (!email || !stateKey) return
      const iso = new Date().toISOString()
      const tryAirtable =
        (inboxStateBackend === 'airtable' || inboxStateBackend === 'pending') && inboxThreadStateAirtableEnabled()
      if (tryAirtable) {
        try {
          await markInboxThreadRead(email, stateKey)
          setInboxStateBackend('airtable')
          setInboxStateMap(await fetchInboxThreadStateMap(email))
          return
        } catch {
          saveLocalInboxStatePatch(email, stateKey, { lastReadAt: iso })
          setInboxStateBackend('local')
          setInboxStateMap(loadLocalInboxStateMap(email))
          return
        }
      }
      saveLocalInboxStatePatch(email, stateKey, { lastReadAt: iso })
      setInboxStateMap(loadLocalInboxStateMap(email))
      if (inboxStateBackend === 'pending') setInboxStateBackend('local')
    },
    [email, inboxStateBackend],
  )

  const moveThreadTrash = useCallback(
    async (stateKey, trashed) => {
      if (!email || !stateKey) return
      const tryAirtable =
        (inboxStateBackend === 'airtable' || inboxStateBackend === 'pending') && inboxThreadStateAirtableEnabled()
      if (tryAirtable) {
        try {
          await setInboxThreadTrash(email, stateKey, trashed)
          setInboxStateBackend('airtable')
          setInboxStateMap(await fetchInboxThreadStateMap(email))
          toast.success(trashed ? 'Conversation moved to trash' : 'Conversation restored')
          return
        } catch {
          saveLocalInboxStatePatch(email, stateKey, { trashed })
          setInboxStateBackend('local')
          setInboxStateMap(loadLocalInboxStateMap(email))
          toast.success(trashed ? 'Conversation moved to trash' : 'Conversation restored')
          return
        }
      }
      saveLocalInboxStatePatch(email, stateKey, { trashed })
      setInboxStateMap(loadLocalInboxStateMap(email))
      toast.success(trashed ? 'Conversation moved to trash' : 'Conversation restored')
    },
    [email, inboxStateBackend],
  )

  const selectedStateKey =
    selectedThreadId === UI_LEASING ? leasingKey : selectedThreadId === UI_ADMIN ? adminKey : ''
  const selectedMeta = selectedStateKey ? inboxStateMap.get(selectedStateKey) : null
  const selectedInTrash = Boolean(selectedMeta?.trashed)

  const touchThreadReadRef = useRef(touchThreadRead)
  touchThreadReadRef.current = touchThreadRead
  const lastTouchedThreadRef = useRef('')

  useEffect(() => {
    if (!selectedStateKey) {
      lastTouchedThreadRef.current = ''
      return
    }
    if (lastTouchedThreadRef.current === selectedStateKey) return
    lastTouchedThreadRef.current = selectedStateKey
    void touchThreadReadRef.current(selectedStateKey)
  }, [selectedStateKey])

  useEffect(() => {
    setReplySubjectPreset('')
    setReplySubjectCustom('')
  }, [selectedThreadId])

  useEffect(() => {
    if (composeOpen) return
    if (!selectedThreadId) return
    if (!visibleThreadRows.some((r) => r.id === selectedThreadId)) {
      setSelectedThreadId(null)
    }
  }, [visibleThreadRows, selectedThreadId, composeOpen])

  useEffect(() => {
    if (!selectedThreadId) {
      setThread([])
      return
    }
    let cancelled = false
    setThreadLoading(true)
    const key = selectedThreadId === UI_LEASING ? leasingKey : adminKey
    getMessagesByThreadKey(key)
      .then((next) => {
        if (!cancelled) {
          setThread(
            [...next].sort(
              (a, b) =>
                new Date(a.Timestamp || a.created_at || 0) - new Date(b.Timestamp || b.created_at || 0),
            ),
          )
        }
      })
      .catch(() => {
        if (!cancelled) setThread([])
      })
      .finally(() => {
        if (!cancelled) setThreadLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedThreadId, leasingKey, adminKey])

  const activeThreadSubject = useMemo(
    () =>
      selectedThreadId && thread.length ? threadSubjectFromMessages(thread, subjectFieldName) : '',
    [thread, subjectFieldName, selectedThreadId],
  )

  const selectedRowMeta = useMemo(
    () => visibleThreadRows.find((r) => r.id === selectedThreadId),
    [visibleThreadRows, selectedThreadId],
  )

  const headerSubject = activeThreadSubject || selectedRowMeta?.subjectLine || 'Inbox'

  async function handleComposeSend(e) {
    e.preventDefault()
    if (!email || !composeBody.trim()) return
    if (!composeSubjectPreset) {
      toast.error('Choose a subject.')
      return
    }
    if (composeSubjectPreset === 'other' && !composeSubjectCustom.trim()) {
      toast.error('Enter a custom subject.')
      return
    }
    const subjResolved = resolveInboxSubject(composeSubjectPreset, composeSubjectCustom)
    const threadKey = composeTo === 'admin' ? adminKey : leasingKey
    const bodyOut = mergeSubjectIntoMessageIfNeeded(composeBody.trim(), subjResolved, showSubjectField)
    setComposeSending(true)
    try {
      await sendMessage({
        senderEmail: email,
        message: bodyOut,
        isAdmin: false,
        threadKey,
        channel: PORTAL_INBOX_CHANNEL_INTERNAL,
        subject: showSubjectField ? subjResolved : '',
      })
      notifyPortalMessage({
        recipientEmail: portalAxisAdminContactEmail(),
        senderName: resident.Name || email,
        subject: subjResolved,
      })
      setComposeOpen(false)
      setComposeBody('')
      setComposeSubjectPreset('')
      setComposeSubjectCustom('')
      setComposeTo('manager')
      await loadAll()
      setSelectedThreadId(composeTo === 'admin' ? UI_ADMIN : UI_LEASING)
      toast.success('Sent')
    } catch (err) {
      toast.error(err.message || 'Send failed')
    } finally {
      setComposeSending(false)
    }
  }

  async function handleSendReply(e) {
    e.preventDefault()
    if (!selectedThreadId || !reply.trim() || !email) return
    let subjResolved = ''
    if (showSubjectField && replySubjectPreset) {
      if (replySubjectPreset === 'other' && !replySubjectCustom.trim()) {
        toast.error('Enter a custom subject or leave subject as “Same as thread”.')
        return
      }
      subjResolved = resolveInboxSubject(replySubjectPreset, replySubjectCustom)
    }
    const bodyOut = mergeSubjectIntoMessageIfNeeded(reply.trim(), subjResolved, showSubjectField)
    const threadKey = selectedThreadId === UI_LEASING ? leasingKey : adminKey
    setSending(true)
    try {
      await sendMessage({
        senderEmail: email,
        message: bodyOut,
        isAdmin: false,
        threadKey,
        channel: PORTAL_INBOX_CHANNEL_INTERNAL,
        subject: showSubjectField ? subjResolved : '',
      })
      notifyPortalMessage({
        recipientEmail: portalAxisAdminContactEmail(),
        senderName: resident.Name || email,
        subject: subjResolved,
      })
      setReply('')
      setReplySubjectPreset('')
      setReplySubjectCustom('')
      await loadAll()
      const next = await getMessagesByThreadKey(threadKey)
      setThread(
        [...next].sort(
          (a, b) =>
            new Date(a.Timestamp || a.created_at || 0) - new Date(b.Timestamp || b.created_at || 0),
        ),
      )
      if (selectedStateKey) await touchThreadRead(selectedStateKey)
      toast.success('Sent')
    } catch (err) {
      toast.error(err.message || 'Send failed')
    } finally {
      setSending(false)
    }
  }

  if (!portalInboxAirtableConfigured()) {
    return (
      <p className="text-sm text-slate-500">
        Connect the Messages table and thread key in your environment to use inbox.
      </p>
    )
  }

  const listEmptyMessage =
    sectionFilter === 'trash' && inboxSections.trash.length === 0
      ? 'Nothing in trash'
      : inboxActiveTotal === 0
        ? 'No messages yet'
        : threadSearch.trim()
          ? 'No matches'
          : sectionFilter === 'unread'
            ? 'No unread'
            : 'No conversations'

  return (
    <div className="mb-8">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900">Inbox</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setComposeOpen(true)
              setSelectedThreadId(null)
              setThread([])
            }}
            className="rounded-full bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] px-4 py-2 text-xs font-semibold text-white shadow-sm hover:opacity-95"
          >
            New message
          </button>
          <button
            type="button"
            onClick={() => loadAll()}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="flex min-h-[min(420px,calc(100dvh-10rem))] max-h-[calc(100dvh-10rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/80 shadow-sm md:flex-row">
        <ConversationList
          loading={loading}
          errorMessage={loadError}
          searchQuery={threadSearch}
          onSearchChange={setThreadSearch}
          filter={sectionFilter}
          onFilterChange={setSectionFilter}
          counts={{
            all: inboxActiveTotal,
            unread: inboxSections.unopened.length,
            trash: inboxSections.trash.length,
          }}
          rows={visibleThreadRows}
          selectedId={selectedThreadId}
          onSelect={(id) => {
            setComposeOpen(false)
            setSelectedThreadId(id)
          }}
          emptyMessage={listEmptyMessage}
          onTrashThread={(stateKey, trashed = true) => moveThreadTrash(stateKey, trashed)}
        />

        <div className="flex min-h-[min(50vh,440px)] min-w-0 flex-1 flex-col overflow-hidden bg-white md:min-h-0">
          <header className="shrink-0 border-b border-slate-100 px-4 py-4 md:px-6">
            {composeOpen ? (
              <div className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4">
                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-sm font-black text-slate-900">New message</h4>
                  <button
                    type="button"
                    onClick={() => setComposeOpen(false)}
                    className="text-xs font-semibold text-slate-500 hover:text-slate-800"
                  >
                    Cancel
                  </button>
                </div>
                <form onSubmit={handleComposeSend} className="mt-4 space-y-3">
                  <label className="block text-xs font-semibold text-slate-700">
                    To
                    <select
                      value={composeTo}
                      onChange={(e) => setComposeTo(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                    >
                      <option value="manager">House / Manager</option>
                      <option value="admin">Axis Admin</option>
                    </select>
                  </label>
                  {composeTo === 'admin' && !portalAxisAdminContactEmail().includes('@') ? (
                    <p className="text-xs text-amber-800">
                      Set <code className="rounded bg-amber-100 px-1">VITE_PORTAL_AXIS_ADMIN_EMAIL</code> so admin
                      can see your thread.
                    </p>
                  ) : null}
                  <InboxSubjectPicker
                    presetId={composeSubjectPreset}
                    onPresetIdChange={setComposeSubjectPreset}
                    customSubject={composeSubjectCustom}
                    onCustomSubjectChange={setComposeSubjectCustom}
                    disabled={composeSending}
                    required
                  />
                  <label className="block text-xs font-semibold text-slate-700">
                    Message
                    <textarea
                      value={composeBody}
                      onChange={(e) => setComposeBody(e.target.value)}
                      rows={4}
                      required
                      className="mt-1 w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                    />
                  </label>
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={composeSending || !composeBody.trim()}
                      className="rounded-xl bg-[#2563eb] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-45"
                    >
                      {composeSending ? 'Sending…' : 'Send'}
                    </button>
                  </div>
                </form>
              </div>
            ) : null}

            {!composeOpen && selectedThreadId ? (
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h3 className="text-lg font-black text-slate-900 md:text-xl">{headerSubject}</h3>
                  <p className="mt-1 text-sm text-slate-600">{participantsLine(selectedThreadId)}</p>
                  {selectedInTrash ? (
                    <p className="mt-2 text-xs font-medium text-amber-800">In trash</p>
                  ) : null}
                </div>
                {selectedStateKey ? (
                  <div className="flex shrink-0 gap-2">
                    {selectedInTrash ? (
                      <button
                        type="button"
                        onClick={() => moveThreadTrash(selectedStateKey, false)}
                        className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700"
                      >
                        Restore
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => moveThreadTrash(selectedStateKey, true)}
                        className="rounded-full border border-red-200 bg-red-50 px-4 py-2 text-xs font-semibold text-red-700"
                      >
                        Trash
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}
          </header>

          {!composeOpen && !selectedThreadId ? (
            <div className="flex min-h-[200px] flex-1 flex-col items-center justify-center gap-4 px-6 py-10 text-center">
              <p className="max-w-sm text-sm text-slate-600">Select a conversation to view messages, or start a new one.</p>
              <button
                type="button"
                onClick={() => {
                  setComposeOpen(true)
                  setThread([])
                }}
                className="rounded-full bg-[#2563eb] px-5 py-2.5 text-sm font-semibold text-white"
              >
                New message
              </button>
            </div>
          ) : null}

          {composeOpen || selectedThreadId ? (
            <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/40">
              <ConversationThread
                messages={thread}
                loading={threadLoading}
                selectedThreadId={selectedThreadId}
                isAxisThread
                formatTime={fmtDateTime}
                messageSubjectKey={subjectFieldName}
                hideInlineSubject={Boolean(activeThreadSubject && subjectFieldName)}
                mapMessageBody={(m) => displayMessageForResidentPortal(m.Message)}
              />
            </div>
          ) : null}

          {selectedThreadId && !composeOpen ? (
            <MessageComposer
              value={reply}
              onChange={setReply}
              onSubmit={handleSendReply}
              disabled={!selectedThreadId}
              sending={sending}
              placeholder="Write your reply…"
              showSubject={showSubjectField}
              useSubjectPresets={showSubjectField}
              subjectPresetId={replySubjectPreset}
              onSubjectPresetIdChange={setReplySubjectPreset}
              subjectCustom={replySubjectCustom}
              onSubjectCustomChange={setReplySubjectCustom}
              allowSubjectEmpty
              toLabel={participantsLine(selectedThreadId)}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}

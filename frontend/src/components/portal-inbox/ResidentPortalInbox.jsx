import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
  getMessagesByThreadKey,
  getMessagesByThreadKeyPrefix,
  sendMessage,
  residentLeasingThreadKey,
  residentAdminThreadKey,
  nextResidentLeasingThreadKey,
  nextResidentAdminThreadKey,
  portalInboxThreadKeyFromRecord,
  PORTAL_INBOX_CHANNEL_INTERNAL,
  portalInboxAirtableConfigured,
  portalInboxThreadIdentityForGrouping,
  fetchInboxThreadStateMap,
  inboxThreadStateAirtableEnabled,
  markInboxThreadRead,
  setInboxThreadTrash,
  getPortalInboxSubjectFieldName,
} from '../../lib/airtable'
import { isAirtablePermissionErrorMessage } from '../../lib/airtablePermissionError'
import { notifyPortalMessage } from '../../lib/notifyPortalMessage.js'
import {
  threadSubjectFromMessages,
  threadBodyPreviewFromMessage,
  mergeSubjectIntoMessageIfNeeded,
  threadSearchHaystack,
  portalInboxThreadSection,
  portalSenderEmailFromMessage,
  PORTAL_INBOX_MARK_READ_DELAY_MS,
} from '../../lib/portalInboxThreadUtils.js'
import {
  PORTAL_TAB_HEADER_ROW_CLS,
  PORTAL_TAB_H2_CLS,
  PORTAL_TAB_TOOLBAR_CLS,
  PORTAL_TAB_REFRESH_CLS,
  PORTAL_TAB_PRIMARY_CLS,
  PORTAL_TAB_SELECT_WRAP_CLS,
  PORTAL_TAB_SELECT_CLS,
  PORTAL_TAB_SELECT_CHEVRON_CLS,
} from '../../lib/portalTabHeader.js'
import ConversationList from '../manager-inbox/ConversationList'
import ConversationThread from '../manager-inbox/ConversationThread'
import MessageComposer from '../manager-inbox/MessageComposer'
import { displayMessageForResidentPortal } from '../PortalInboxThreadView.jsx'

const RESIDENT_INBOX_THREAD_STATE_LS = 'axis_resident_inbox_thread_state_v1'

/**
 * Pick Messages thread key for send:
 * - **Reply** (`explicitSelectedKey`): reuse that thread key if not trashed; otherwise start fresh.
 * - **New compose** (no selection): always a new `:s:` segment — never attach to an existing thread by default.
 */
function resolveResidentOutboundThreadKey({ nextSegmentKey, inboxStateMap, explicitSelectedKey }) {
  const trashed = (k) => Boolean(inboxStateMap.get(k)?.trashed)

  if (explicitSelectedKey) {
    const ex = String(explicitSelectedKey).trim()
    if (ex && !trashed(ex)) return ex
    return nextSegmentKey()
  }

  return nextSegmentKey()
}

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

function participantsLineForThreadKey(threadKey) {
  const t = String(threadKey || '')
  if (t.startsWith('internal:resident-admin')) return 'You ↔ Axis Admin'
  if (t.startsWith('internal:resident-leasing')) return 'You ↔ House / Manager'
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
  const [replySubject, setReplySubject] = useState('')
  const [sending, setSending] = useState(false)

  const [composeOpen, setComposeOpen] = useState(false)
  const [composeTo, setComposeTo] = useState('manager')
  const [composeSubject, setComposeSubject] = useState('')
  const [composeBody, setComposeBody] = useState('')
  const [composeSending, setComposeSending] = useState(false)
  /** Incremented on each list-row click so re-opening the same thread can mark read again after load. */
  const [readIntentEpoch, setReadIntentEpoch] = useState(0)
  const openReadIntentKeyRef = useRef('')

  const [inboxStateMap, setInboxStateMap] = useState(() => new Map())
  const [inboxStateBackend, setInboxStateBackend] = useState('pending')
  const [sectionFilter, setSectionFilter] = useState('unopened')
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
        getMessagesByThreadKeyPrefix(leasingKey),
        getMessagesByThreadKeyPrefix(adminKey),
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

  const msgTime = (m) => new Date(m?.Timestamp || m?.created_at || 0).getTime()

  const threadRows = useMemo(() => {
    const rows = []
    const addLane = (lanePrefix, defaultParticipantLabel) => {
      const byKey = new Map()
      for (const m of lanePrefix === leasingKey ? leasingMsgs : adminMsgs) {
        const tk = portalInboxThreadIdentityForGrouping(m)
        if (!tk) continue
        if (tk !== lanePrefix && !tk.startsWith(`${lanePrefix}:s:`)) continue
        if (!byKey.has(tk)) byKey.set(tk, [])
        byKey.get(tk).push(m)
      }
      for (const [tk, msgs] of byKey) {
        const sorted = [...msgs].sort((a, b) => msgTime(a) - msgTime(b))
        const last = sorted[sorted.length - 1]
        const lastMsgTs = last ? msgTime(last) : 0
        const subjectLine =
          threadSubjectFromMessages(sorted, subjectFieldName) || defaultParticipantLabel
        rows.push({
          id: tk,
          stateKey: tk,
          participantLabel: defaultParticipantLabel,
          subjectLine,
          preview: threadBodyPreviewFromMessage(last),
          searchText: threadSearchHaystack(sorted, subjectFieldName, defaultParticipantLabel, subjectLine),
          time: last ? fmtDateTime(last.Timestamp || last.created_at) : '',
          ts: lastMsgTs,
          lastMsgTs,
          lastSenderEmail: last ? portalSenderEmailFromMessage(last) : '',
        })
      }
    }
    addLane(leasingKey, 'House / Manager')
    addLane(adminKey, 'Axis Admin')
    rows.sort((a, b) => b.ts - a.ts)
    return rows
  }, [leasingMsgs, adminMsgs, leasingKey, adminKey, subjectFieldName])

  const threadRowsWithMeta = useMemo(() => {
    return threadRows.map((row) => {
      const st = inboxStateMap.get(row.stateKey)
      const section = portalInboxThreadSection({
        lastMsgTs: row.lastMsgTs,
        state: st,
        lastSenderEmail: row.lastSenderEmail,
        myEmail: email,
      })
      const unopened = section === 'unopened'
      return { ...row, section, unopened }
    })
  }, [threadRows, inboxStateMap, email])

  const hasAutoSelectedRef = useRef(false)
  useEffect(() => {
    setSelectedThreadId(null)
    hasAutoSelectedRef.current = false
  }, [resident?.id])

  useEffect(() => {
    if (loading) return
    if (hasAutoSelectedRef.current) return
    if (selectedThreadId) return
    const candidates = threadRowsWithMeta.filter((r) => r.section !== 'trash')
    const pool = candidates.length ? candidates : threadRowsWithMeta
    const pick = [...pool].sort((a, b) => b.lastMsgTs - a.lastMsgTs)[0]
    if (pick?.id) setSelectedThreadId(pick.id)
    hasAutoSelectedRef.current = true
  }, [loading, selectedThreadId, threadRowsWithMeta])

  const inboxSections = useMemo(() => {
    const unopened = []
    const opened = []
    const sent = []
    const trash = []
    for (const row of threadRowsWithMeta) {
      if (row.section === 'trash') trash.push(row)
      else if (row.section === 'sent') sent.push(row)
      else if (row.section === 'unopened') unopened.push(row)
      else opened.push(row)
    }
    return { unopened, opened, sent, trash }
  }, [threadRowsWithMeta])

  const inboxActiveTotal =
    inboxSections.unopened.length + inboxSections.opened.length + inboxSections.sent.length

  const visibleThreadRows = useMemo(() => {
    const q = threadSearch.trim().toLowerCase()
    let rows = threadRowsWithMeta
    if (sectionFilter === 'unopened') rows = rows.filter((r) => r.section === 'unopened')
    else if (sectionFilter === 'opened') rows = rows.filter((r) => r.section === 'opened')
    else if (sectionFilter === 'sent') rows = rows.filter((r) => r.section === 'sent')
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
    typeof selectedThreadId === 'string' &&
    (selectedThreadId.startsWith('internal:resident-leasing:') ||
      selectedThreadId.startsWith('internal:resident-admin:'))
      ? selectedThreadId
      : ''
  const selectedMeta = selectedStateKey ? inboxStateMap.get(selectedStateKey) : null
  const selectedInTrash = Boolean(selectedMeta?.trashed)

  const touchThreadReadRef = useRef(touchThreadRead)
  touchThreadReadRef.current = touchThreadRead

  const threadRowsWithMetaRef = useRef(threadRowsWithMeta)
  threadRowsWithMetaRef.current = threadRowsWithMeta
  const selectedStateKeyRef = useRef(selectedStateKey)
  selectedStateKeyRef.current = selectedStateKey
  const selectedThreadIdRef = useRef(selectedThreadId)
  selectedThreadIdRef.current = selectedThreadId

  useEffect(() => {
    if (!selectedStateKey) openReadIntentKeyRef.current = ''
  }, [selectedStateKey])

  useEffect(() => {
    if (!selectedStateKey || threadLoading) return
    if (openReadIntentKeyRef.current !== selectedStateKey) return
    const key = selectedStateKey
    const t = window.setTimeout(() => {
      if (openReadIntentKeyRef.current !== key) return
      if (selectedStateKeyRef.current !== key) return
      const row = threadRowsWithMetaRef.current.find(
        (r) => r.stateKey === key || r.id === selectedThreadIdRef.current,
      )
      if (!row || row.section === 'trash') {
        openReadIntentKeyRef.current = ''
        return
      }
      if (row.section !== 'unopened') {
        openReadIntentKeyRef.current = ''
        return
      }
      openReadIntentKeyRef.current = ''
      void touchThreadReadRef.current(key)
    }, PORTAL_INBOX_MARK_READ_DELAY_MS)
    return () => window.clearTimeout(t)
  }, [selectedStateKey, threadLoading, readIntentEpoch])

  useEffect(() => {
    if (!selectedThreadId) {
      setReplySubject('')
      return
    }
    const pool = selectedThreadId.startsWith('internal:resident-admin') ? adminMsgs : leasingMsgs
    const msgs = pool.filter((m) => portalInboxThreadKeyFromRecord(m) === selectedThreadId)
    const sorted = [...msgs].sort((a, b) => msgTime(a) - msgTime(b))
    const t = threadSubjectFromMessages(sorted, subjectFieldName)
    setReplySubject(t ? `Re: ${t}` : '')
  }, [selectedThreadId, leasingMsgs, adminMsgs, subjectFieldName])

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
    const key = String(selectedThreadId || '').trim()
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
  }, [selectedThreadId])

  const activeThreadSubject = useMemo(
    () =>
      selectedThreadId && thread.length ? threadSubjectFromMessages(thread, subjectFieldName) : '',
    [thread, subjectFieldName, selectedThreadId],
  )

  const selectedRowMeta = useMemo(
    () =>
      visibleThreadRows.find((r) => r.id === selectedThreadId) ||
      threadRowsWithMeta.find((r) => r.id === selectedThreadId),
    [visibleThreadRows, threadRowsWithMeta, selectedThreadId],
  )

  const headerSubject = activeThreadSubject || selectedRowMeta?.subjectLine || 'Inbox'

  async function handleComposeSend(e) {
    e.preventDefault()
    if (!email || !composeBody.trim()) return
    const subjResolved = composeSubject.trim()
    if (!subjResolved) {
      toast.error('Enter a subject.')
      return
    }
    const threadKey = resolveResidentOutboundThreadKey({
      nextSegmentKey: () =>
        composeTo === 'admin' ? nextResidentAdminThreadKey(resident.id) : nextResidentLeasingThreadKey(resident.id),
      inboxStateMap,
      explicitSelectedKey: null,
    })
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
        toAdmins: composeTo === 'admin',
        senderName: resident.Name || email,
        subject: subjResolved,
      })
      setComposeOpen(false)
      setComposeBody('')
      setComposeSubject('')
      setComposeTo('manager')
      await loadAll()
      setSelectedThreadId(threadKey)
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
    if (selectedInTrash) {
      toast.error('Restore this conversation to reply here, or use New message for a fresh thread.')
      return
    }
    const laneBase = selectedThreadId.startsWith('internal:resident-admin')
      ? adminKey
      : leasingKey
    const threadSubj = threadSubjectFromMessages(thread, subjectFieldName)
    const notifySubj = replySubject.trim() || threadSubj || 'Axis portal message'
    const subjResolved = showSubjectField ? replySubject.trim() : ''
    const bodyOut = mergeSubjectIntoMessageIfNeeded(
      reply.trim(),
      showSubjectField ? subjResolved : notifySubj,
      showSubjectField,
    )
    const threadKey = resolveResidentOutboundThreadKey({
      nextSegmentKey: () =>
        laneBase === adminKey ? nextResidentAdminThreadKey(resident.id) : nextResidentLeasingThreadKey(resident.id),
      inboxStateMap,
      explicitSelectedKey: selectedThreadId,
    })
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
        toAdmins: selectedThreadId.startsWith('internal:resident-admin'),
        senderName: resident.Name || email,
        subject: notifySubj,
      })
      setReply('')
      setReplySubject('')
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
          : sectionFilter === 'unopened'
            ? 'No unopened conversations'
            : sectionFilter === 'opened'
              ? 'No opened conversations'
              : sectionFilter === 'sent'
                ? 'No sent conversations'
                : 'No conversations'

  return (
    <div>
      <div className={PORTAL_TAB_HEADER_ROW_CLS}>
        <h2 className={PORTAL_TAB_H2_CLS}>Inbox</h2>
        <div className={PORTAL_TAB_TOOLBAR_CLS}>
          <button
            type="button"
            onClick={() => {
              setComposeOpen(true)
              setSelectedThreadId(null)
              setThread([])
            }}
            className={PORTAL_TAB_PRIMARY_CLS}
          >
            New message
          </button>
          <button type="button" onClick={() => loadAll()} className={PORTAL_TAB_REFRESH_CLS}>
            Refresh
          </button>
        </div>
      </div>

      <div className="flex h-[min(560px,calc(100dvh-10rem))] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm md:flex-row">
        <ConversationList
          loading={loading}
          errorMessage={loadError}
          searchQuery={threadSearch}
          onSearchChange={setThreadSearch}
          filter={sectionFilter}
          onFilterChange={setSectionFilter}
          counts={{
            unopened: inboxSections.unopened.length,
            opened: inboxSections.opened.length,
            sent: inboxSections.sent.length,
            trash: inboxSections.trash.length,
          }}
          rows={visibleThreadRows}
          selectedId={selectedThreadId}
          onSelect={(id) => {
            setComposeOpen(false)
            setSelectedThreadId(id)
            if (!id) {
              openReadIntentKeyRef.current = ''
              return
            }
            const row = threadRowsWithMeta.find((r) => r.id === id)
            const sk = row?.stateKey || ''
            openReadIntentKeyRef.current = sk
            if (sk) setReadIntentEpoch((n) => n + 1)
          }}
          emptyMessage={listEmptyMessage}
          onTrashThread={(stateKey, trashed = true) => moveThreadTrash(stateKey, trashed)}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white">
          <header className="shrink-0 border-b border-slate-100 px-4 py-3 md:px-5">
            {composeOpen ? (
              <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-3">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-sm font-bold text-slate-900">New message</h4>
                  <button
                    type="button"
                    onClick={() => setComposeOpen(false)}
                    className="text-xs font-semibold text-slate-500 hover:text-slate-800"
                  >
                    Cancel
                  </button>
                </div>
                <form onSubmit={handleComposeSend} className="mt-3 space-y-2.5">
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
                  <label className="block text-xs font-semibold text-slate-700">
                    Subject
                    <input
                      type="text"
                      value={composeSubject}
                      onChange={(e) => setComposeSubject(e.target.value)}
                      required
                      disabled={composeSending}
                      placeholder="Brief subject line"
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                    />
                  </label>
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
                  <p className="mt-1 text-sm text-slate-600">{participantsLineForThreadKey(selectedThreadId)}</p>
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
            <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="max-w-xs text-sm text-slate-500">Select a conversation from the list to view messages.</p>
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
              disabled={!selectedThreadId || selectedInTrash}
              sending={sending}
              placeholder="Write your reply…"
              showSubject
              useSubjectPresets={false}
              subject={replySubject}
              onSubjectChange={setReplySubject}
              subjectPlaceholder={
                activeThreadSubject
                  ? `Re: ${activeThreadSubject} — edit for email notification`
                  : 'Subject for email notification'
              }
              allowSubjectEmpty
              toLabel={participantsLineForThreadKey(selectedThreadId)}
            />
          ) : null}
        </div>
      </div>
    </div>
  )
}

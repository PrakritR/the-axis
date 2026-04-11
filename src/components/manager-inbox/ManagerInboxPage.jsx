import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
  getAllMessages,
  sendMessage,
  isInternalPortalThreadMessage,
  getMessagesByThreadKey,
  siteManagerThreadKey,
  residentLeasingThreadKey,
  parseResidentLeasingThreadKey,
  portalInboxThreadKeyFromRecord,
  PORTAL_INBOX_CHANNEL_INTERNAL,
  portalInboxAirtableConfigured,
  fetchInboxThreadStateMap,
  inboxThreadStateAirtableEnabled,
  markInboxThreadRead,
  setInboxThreadTrash,
} from '../../lib/airtable'
import {
  isAirtablePermissionErrorMessage,
} from '../../lib/airtablePermissionError'
import {
  residentLeasingThreadVisibleToManager,
  extractResidentScopeTextFromMessageBody,
} from '../../lib/portalInboxResidentScope.js'
import ConversationList from './ConversationList'
import ConversationThread from './ConversationThread'
import MessageComposer from './MessageComposer'
// ─── Local helpers (inbox scope) ─────────────────────────────────────────────
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

function fmtDate(val) {
  if (!val) return '—'
  try {
    return new Date(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return String(val)
  }
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

function normalizePortalScopeLabel(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(avenue|ave|street|st|road|rd|boulevard|blvd|place|pl|drive|dr)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const MANAGER_INBOX_AXIS = 'inbox:axis'

const MANAGER_INBOX_THREAD_STATE_LS = 'axis_manager_inbox_thread_state_v1'

function managerInboxResidentThreadId(residentRecordId) {
  return `resident:${String(residentRecordId || '').trim()}`
}

function managerInboxParseResidentThreadId(selectedId) {
  const s = String(selectedId || '')
  if (!s.startsWith('resident:')) return null
  const id = s.slice('resident:'.length).trim()
  return id || null
}

function loadLocalInboxStateMap(email) {
  const em = String(email || '').trim().toLowerCase()
  if (!em) return new Map()
  try {
    const root = JSON.parse(localStorage.getItem(MANAGER_INBOX_THREAD_STATE_LS) || '{}')
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
    const root = JSON.parse(localStorage.getItem(MANAGER_INBOX_THREAD_STATE_LS) || '{}')
    if (!root[em]) root[em] = {}
    const cur = root[em][tk] || {}
    const next = { ...cur }
    if (patch.lastReadAt !== undefined) {
      next.lastReadAt = patch.lastReadAt ? new Date(patch.lastReadAt).toISOString() : null
    }
    if (patch.trashed !== undefined) next.trashed = patch.trashed
    root[em][tk] = next
    localStorage.setItem(MANAGER_INBOX_THREAD_STATE_LS, JSON.stringify(root))
  } catch {
    /* ignore */
  }
}

function managerInboxSectionForRow(lastMsgTs, state) {
  if (state?.trashed) return 'trash'
  if (lastMsgTs <= 0) {
    return state?.lastReadAt ? 'opened' : 'unopened'
  }
  if (!state?.lastReadAt) return 'unopened'
  return lastMsgTs > state.lastReadAt.getTime() ? 'unopened' : 'opened'
}

function managerInboxStateKeyForSelection(selectedThreadId, axisThreadKey) {
  if (selectedThreadId === MANAGER_INBOX_AXIS) return axisThreadKey || ''
  const resId = managerInboxParseResidentThreadId(selectedThreadId)
  if (resId) return residentLeasingThreadKey(resId)
  return ''
}

/**
 * Manager portal inbox — two-column messaging.
 */
export default function ManagerInboxPage({ manager, allowedPropertyNames }) {
  const [allMsgs, setAllMsgs] = useState([])
  const [axisMsgs, setAxisMsgs] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [selectedThreadId, setSelectedThreadId] = useState(null)
  const [thread, setThread] = useState([])
  const [threadLoading, setThreadLoading] = useState(false)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [inboxStateMap, setInboxStateMap] = useState(() => new Map())
  const [inboxStateBackend, setInboxStateBackend] = useState('pending')
  const [sectionFilter, setSectionFilter] = useState('all')
  const [threadSearch, setThreadSearch] = useState('')
  const [threadMenuOpen, setThreadMenuOpen] = useState(false)
  const threadMenuRef = useRef(null)

  const inboxScopeLower = useMemo(
    () => new Set((allowedPropertyNames || []).map((n) => String(n).trim().toLowerCase()).filter(Boolean)),
    [allowedPropertyNames],
  )

  const managerEmail = String(manager?.email || '').trim()
  const axisThreadKey = useMemo(() => {
    if (!portalInboxAirtableConfigured() || !managerEmail) return ''
    return siteManagerThreadKey(managerEmail)
  }, [managerEmail])

  const refreshInboxThreadState = useCallback(async () => {
    if (!managerEmail) {
      setInboxStateMap(new Map())
      setInboxStateBackend('none')
      return
    }
    if (inboxThreadStateAirtableEnabled()) {
      try {
        setInboxStateMap(await fetchInboxThreadStateMap(managerEmail))
        setInboxStateBackend('airtable')
        return
      } catch {
        /* fall back */
      }
    }
    setInboxStateMap(loadLocalInboxStateMap(managerEmail))
    setInboxStateBackend('local')
  }, [managerEmail])

  const loadAll = useCallback(async () => {
    const hasScope = inboxScopeLower.size > 0
    const hasAxis = Boolean(axisThreadKey)
    setLoadError('')
    if (!hasScope && !hasAxis) {
      setAllMsgs([])
      setAxisMsgs([])
      setLoading(false)
      try {
        await refreshInboxThreadState()
      } catch {
        /* non-fatal */
      }
      return
    }
    setLoading(true)
    try {
      const tasks = [getAllMessages()]
      if (hasAxis) tasks.push(getMessagesByThreadKey(axisThreadKey))
      const results = await Promise.all(tasks)
      const msgs = results[0]
      const axis = hasAxis ? results[1] : []
      setAllMsgs(msgs)
      setAxisMsgs(axis)
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
  }, [inboxScopeLower, axisThreadKey, refreshInboxThreadState])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  useEffect(() => {
    if (!threadMenuOpen) return
    const close = (e) => {
      if (threadMenuRef.current && !threadMenuRef.current.contains(e.target)) {
        setThreadMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [threadMenuOpen])

  const threadRows = useMemo(() => {
    const rows = []
    const msgTime = (m) => new Date(m?.Timestamp || m?.created_at || 0).getTime()

    if (axisThreadKey) {
      const sortedAxis = [...axisMsgs].sort((a, b) => msgTime(a) - msgTime(b))
      const last = sortedAxis[sortedAxis.length - 1]
      const lastMsgTs = last ? msgTime(last) : 0
      rows.push({
        id: MANAGER_INBOX_AXIS,
        stateKey: axisThreadKey,
        title: 'Axis team',
        subtitle: 'Internal',
        preview: last?.Message ? String(last.Message) : '',
        time: last ? fmtDateTime(last.Timestamp || last.created_at) : '',
        ts: lastMsgTs,
        lastMsgTs,
      })
    }

    const residentByKey = new Map()
    for (const m of allMsgs) {
      const tk = portalInboxThreadKeyFromRecord(m)
      if (!tk || !tk.startsWith('internal:resident-leasing:')) continue
      if (!residentByKey.has(tk)) residentByKey.set(tk, [])
      residentByKey.get(tk).push(m)
    }
    for (const [tk, rmsgs] of residentByKey) {
      if (!residentLeasingThreadVisibleToManager(rmsgs, inboxScopeLower)) continue
      const sorted = [...rmsgs].sort((a, b) => msgTime(a) - msgTime(b))
      const last = sorted[sorted.length - 1]
      const rid = parseResidentLeasingThreadKey(tk)
      if (!rid) continue
      const scopeHint = extractResidentScopeTextFromMessageBody(sorted[0]?.Message || last?.Message || '')
      const lastMsgTs = last ? msgTime(last) : 0
      rows.push({
        id: managerInboxResidentThreadId(rid),
        stateKey: tk,
        title: 'Resident inbox',
        subtitle: scopeHint || undefined,
        preview: last?.Message ? String(last.Message) : '',
        time: last ? fmtDateTime(last.Timestamp || last.created_at) : '',
        ts: lastMsgTs,
        lastMsgTs,
      })
    }

    rows.sort((a, b) => b.ts - a.ts)
    return rows
  }, [allMsgs, axisMsgs, axisThreadKey, inboxScopeLower])

  const threadRowsWithMeta = useMemo(() => {
    return threadRows.map((row) => {
      const st = inboxStateMap.get(row.stateKey)
      const section = managerInboxSectionForRow(row.lastMsgTs, st)
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
    if (sectionFilter === 'all') rows = rows.filter((row) => row.section !== 'trash')
    else if (sectionFilter === 'unread') rows = rows.filter((row) => row.section === 'unopened')
    else if (sectionFilter === 'open') rows = rows.filter((row) => row.section === 'opened')
    else if (sectionFilter === 'trash') rows = rows.filter((row) => row.section === 'trash')
    if (!q) return rows
    return rows.filter((row) =>
      `${row.title} ${row.subtitle || ''} ${row.preview || ''}`.toLowerCase().includes(q),
    )
  }, [threadRowsWithMeta, sectionFilter, threadSearch])

  const touchThreadRead = useCallback(
    async (stateKey) => {
      if (!managerEmail || !stateKey) return
      const iso = new Date().toISOString()
      const tryAirtable =
        (inboxStateBackend === 'airtable' || inboxStateBackend === 'pending') && inboxThreadStateAirtableEnabled()
      if (tryAirtable) {
        try {
          await markInboxThreadRead(managerEmail, stateKey)
          setInboxStateBackend('airtable')
          setInboxStateMap(await fetchInboxThreadStateMap(managerEmail))
          return
        } catch {
          saveLocalInboxStatePatch(managerEmail, stateKey, { lastReadAt: iso })
          setInboxStateBackend('local')
          setInboxStateMap(loadLocalInboxStateMap(managerEmail))
          return
        }
      }
      saveLocalInboxStatePatch(managerEmail, stateKey, { lastReadAt: iso })
      setInboxStateMap(loadLocalInboxStateMap(managerEmail))
      if (inboxStateBackend === 'pending') setInboxStateBackend('local')
    },
    [managerEmail, inboxStateBackend],
  )

  const moveThreadTrash = useCallback(
    async (stateKey, trashed) => {
      if (!managerEmail || !stateKey) return
      const tryAirtable =
        (inboxStateBackend === 'airtable' || inboxStateBackend === 'pending') && inboxThreadStateAirtableEnabled()
      if (tryAirtable) {
        try {
          await setInboxThreadTrash(managerEmail, stateKey, trashed)
          setInboxStateBackend('airtable')
          setInboxStateMap(await fetchInboxThreadStateMap(managerEmail))
          toast.success(trashed ? 'Conversation removed' : 'Conversation restored')
          return
        } catch {
          saveLocalInboxStatePatch(managerEmail, stateKey, { trashed })
          setInboxStateBackend('local')
          setInboxStateMap(loadLocalInboxStateMap(managerEmail))
          toast.success(trashed ? 'Conversation removed' : 'Conversation restored')
          return
        }
      }
      saveLocalInboxStatePatch(managerEmail, stateKey, { trashed })
      setInboxStateMap(loadLocalInboxStateMap(managerEmail))
      toast.success(trashed ? 'Conversation removed' : 'Conversation restored')
    },
    [managerEmail, inboxStateBackend],
  )

  const selectedStateKey = managerInboxStateKeyForSelection(selectedThreadId, axisThreadKey)
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
    if (!visibleThreadRows.length) {
      if (selectedThreadId) setSelectedThreadId(null)
      return
    }
    if (!selectedThreadId || !visibleThreadRows.some((row) => row.id === selectedThreadId)) {
      setSelectedThreadId(visibleThreadRows[0].id)
    }
  }, [visibleThreadRows, selectedThreadId])

  useEffect(() => {
    setThreadMenuOpen(false)
  }, [selectedThreadId])

  useEffect(() => {
    if (!selectedThreadId) {
      setThread([])
      return
    }
    let cancelled = false
    async function run() {
      setThreadLoading(true)
      try {
        if (selectedThreadId === MANAGER_INBOX_AXIS) {
          const next = await getMessagesByThreadKey(axisThreadKey)
          if (!cancelled) {
            setThread(
              [...next].sort(
                (a, b) =>
                  new Date(a.Timestamp || a.created_at || 0) - new Date(b.Timestamp || b.created_at || 0),
              ),
            )
          }
          return
        }
        const resId = managerInboxParseResidentThreadId(selectedThreadId)
        if (resId) {
          const next = await getMessagesByThreadKey(residentLeasingThreadKey(resId))
          if (!cancelled) {
            setThread(
              [...next].sort(
                (a, b) =>
                  new Date(a.Timestamp || a.created_at || 0) - new Date(b.Timestamp || b.created_at || 0),
              ),
            )
          }
          return
        }
        if (!cancelled) setThread([])
      } catch (err) {
        if (!cancelled) {
          setThread([])
          toast.error(formatDataLoadError(err))
        }
      } finally {
        if (!cancelled) setThreadLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [selectedThreadId, axisThreadKey])

  async function handleSendReply(e) {
    e.preventDefault()
    if (!selectedThreadId || !reply.trim() || !managerEmail) return
    setSending(true)
    try {
      if (selectedThreadId === MANAGER_INBOX_AXIS) {
        await sendMessage({
          senderEmail: managerEmail,
          message: reply.trim(),
          isAdmin: false,
          threadKey: axisThreadKey,
          channel: PORTAL_INBOX_CHANNEL_INTERNAL,
        })
      } else {
        const resId = managerInboxParseResidentThreadId(selectedThreadId)
        if (!resId) return
        await sendMessage({
          senderEmail: managerEmail,
          message: reply.trim(),
          isAdmin: true,
          threadKey: residentLeasingThreadKey(resId),
          channel: PORTAL_INBOX_CHANNEL_INTERNAL,
        })
      }
      setReply('')
      await loadAll()
      if (selectedThreadId === MANAGER_INBOX_AXIS) {
        const next = await getMessagesByThreadKey(axisThreadKey)
        setThread(
          [...next].sort(
            (a, b) =>
              new Date(a.Timestamp || a.created_at || 0) - new Date(b.Timestamp || b.created_at || 0),
          ),
        )
      } else {
        const resId2 = managerInboxParseResidentThreadId(selectedThreadId)
        if (resId2) {
          const next = await getMessagesByThreadKey(residentLeasingThreadKey(resId2))
          setThread(
            [...next].sort(
              (a, b) =>
                new Date(a.Timestamp || a.created_at || 0) - new Date(b.Timestamp || b.created_at || 0),
            ),
          )
        }
      }
      const sk = managerInboxStateKeyForSelection(selectedThreadId, axisThreadKey)
      if (sk) await touchThreadRead(sk)
      toast.success('Sent')
    } catch (err) {
      toast.error(err.message || 'Send failed')
    } finally {
      setSending(false)
    }
  }

  if (!inboxScopeLower.size && !axisThreadKey) {
    return null
  }

  const readingTitle =
    selectedThreadId === MANAGER_INBOX_AXIS
      ? 'Axis team'
      : managerInboxParseResidentThreadId(selectedThreadId || '')
        ? 'Resident inbox'
        : 'Inbox'

  const readingSubtitle =
    selectedThreadId === MANAGER_INBOX_AXIS
      ? 'Axis support'
      : managerInboxParseResidentThreadId(selectedThreadId)
        ? 'Leasing thread'
        : ''

  const listEmptyMessage =
    sectionFilter === 'trash' && inboxSections.trash.length === 0
      ? 'Nothing removed.'
      : inboxActiveTotal === 0 && sectionFilter !== 'trash'
        ? 'No conversations yet.'
        : threadSearch.trim()
          ? 'Nothing matches your search.'
          : sectionFilter === 'unread'
            ? 'No unread conversations.'
            : sectionFilter === 'open'
              ? 'No conversations here yet.'
              : 'Nothing for this filter.'

  const composerPlaceholder =
    selectedThreadId === MANAGER_INBOX_AXIS ? 'Message Axis…' : 'Write a reply…'

  return (
    <div className="mb-8">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-900">Inbox</h2>
          <p className="mt-0.5 text-sm text-slate-500">Message Axis and resident leasing threads in one place.</p>
        </div>
        <button
          type="button"
          onClick={() => loadAll()}
          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          Refresh
        </button>
      </div>

      <div className="flex max-h-[min(82vh,780px)] min-h-[420px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/80 shadow-sm md:flex-row">
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
            open: inboxSections.opened.length,
          }}
          trashCount={inboxSections.trash.length}
          onOpenTrash={() => setSectionFilter('trash')}
          inTrashMode={sectionFilter === 'trash'}
          onLeaveTrash={() => setSectionFilter('all')}
          rows={visibleThreadRows}
          selectedId={selectedThreadId}
          onSelect={setSelectedThreadId}
          emptyMessage={listEmptyMessage}
        />

        <div className="flex min-h-[min(50vh,440px)] min-w-0 flex-1 flex-col overflow-hidden bg-white md:min-h-0">
          <header className="shrink-0 border-b border-slate-100 px-4 py-4 md:px-6">
            {selectedThreadId ? (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-base font-bold text-slate-900">{readingTitle}</h3>
                  {readingSubtitle ? (
                    <p className="mt-0.5 text-xs text-slate-500">{readingSubtitle}</p>
                  ) : null}
                  {selectedInTrash ? (
                    <p className="mt-1 text-xs font-medium text-amber-800">Removed from inbox</p>
                  ) : null}
                </div>
                {selectedStateKey ? (
                  <div className="relative shrink-0" ref={threadMenuRef}>
                    <button
                      type="button"
                      onClick={() => setThreadMenuOpen((v) => !v)}
                      className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50"
                      aria-label="Conversation actions"
                      aria-expanded={threadMenuOpen}
                    >
                      <span className="block px-0.5 text-lg leading-none">⋯</span>
                    </button>
                    {threadMenuOpen ? (
                      <div className="absolute right-0 z-20 mt-1 min-w-[11rem] rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                        {selectedInTrash ? (
                          <button
                            type="button"
                            className="block w-full px-4 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50"
                            onClick={() => {
                              moveThreadTrash(selectedStateKey, false)
                              setThreadMenuOpen(false)
                            }}
                          >
                            Restore conversation
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="block w-full px-4 py-2.5 text-left text-sm text-red-700 hover:bg-red-50"
                            onClick={() => {
                              moveThreadTrash(selectedStateKey, true)
                              setThreadMenuOpen(false)
                            }}
                          >
                            Remove conversation…
                          </button>
                        )}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-slate-500">Inbox</p>
            )}
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/40">
            <ConversationThread
              messages={thread}
              loading={threadLoading}
              selectedThreadId={selectedThreadId}
              isAxisThread={selectedThreadId === MANAGER_INBOX_AXIS}
              formatTime={fmtDateTime}
              emptyHint="Send a reply below."
            />
          </div>

          {selectedThreadId ? (
            <MessageComposer
              value={reply}
              onChange={setReply}
              onSubmit={handleSendReply}
              disabled={!selectedThreadId}
              sending={sending}
              placeholder={composerPlaceholder}
            />
          ) : null}
        </div>
      </div>

    </div>
  )
}

/** Alias for documentation / future imports */
export { ManagerInboxPage as InboxPage }

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
  getAllMessages,
  getAllPortalInternalThreadMessages,
  sendMessage,
  getMessagesByThreadKey,
  siteManagerThreadKey,
  residentLeasingThreadKey,
  residentAdminThreadKey,
  parseResidentLeasingThreadKey,
  portalInboxThreadKeyFromRecord,
  PORTAL_INBOX_CHANNEL_INTERNAL,
  portalInboxAirtableConfigured,
  fetchInboxThreadStateMap,
  inboxThreadStateAirtableEnabled,
  markInboxThreadRead,
  setInboxThreadTrash,
  getPortalInboxSubjectFieldName,
  HOUSING_PUBLIC_ADMIN_GENERAL_THREAD,
  managementAdminThreadKey,
} from '../../lib/airtable'
import {
  isAdminPortalAirtableConfigured,
  loadAdminProfilesForInbox,
  loadResidentsForManagerPortalInbox,
} from '../../lib/adminPortalAirtable.js'
import { notifyPortalMessage } from '../../lib/notifyPortalMessage.js'
import { threadSubjectFromMessages, threadBodyPreviewFromMessage, mergeSubjectIntoMessageIfNeeded } from '../../lib/portalInboxThreadUtils.js'
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

function threadSearchHaystack(sorted, subjectKey, participantLabel, subjectLine) {
  const parts = [participantLabel, subjectLine]
  for (const m of sorted || []) {
    parts.push(String(m.Message || ''), subjectKey ? String(m[subjectKey] || '') : '', String(m['Sender Email'] || ''))
  }
  return parts.join(' ').toLowerCase()
}

function adminRecipientLabelForThreadId(threadId) {
  const t = String(threadId || '')
  if (t.startsWith('internal:mgmt-admin:')) {
    return `Partner · ${t.slice('internal:mgmt-admin:'.length)}`
  }
  if (t.startsWith('internal:site-manager:')) {
    return `Site manager · ${t.slice('internal:site-manager:'.length)}`
  }
  if (t === HOUSING_PUBLIC_ADMIN_GENERAL_THREAD) {
    return 'Website · General inquiry'
  }
  if (t.startsWith('internal:admin-public:property:')) {
    return `Website · Property (${t.slice('internal:admin-public:property:'.length)})`
  }
  if (t.startsWith('internal:admin-public:')) {
    return `Website · ${t.slice('internal:admin-public:'.length)}`
  }
  if (t.startsWith('internal:resident-leasing:')) {
    return `Resident · House team (${t.slice('internal:resident-leasing:'.length)})`
  }
  if (t.startsWith('internal:resident-admin:')) {
    return `Resident · Admin (${t.slice('internal:resident-admin:'.length)})`
  }
  return t || 'Thread'
}

/** Returns the email of the party that is not `myEmail` in a thread, for notification routing. */
function getOtherPartyEmail(threadMessages, myEmail) {
  const my = String(myEmail || '').toLowerCase()
  const m = (threadMessages || []).find(
    (msg) => String(msg['Sender Email'] || '').toLowerCase() !== my,
  )
  return m ? String(m['Sender Email'] || '').trim() : ''
}

/** Finds a resident's email from all messages by looking for their leasing thread. */
function getResidentEmailFromAllMsgs(allMsgs, resId, myEmail, threadKeyFn) {
  const targetKey = threadKeyFn(resId)
  const my = String(myEmail || '').toLowerCase()
  const m = (allMsgs || []).find(
    (msg) =>
      String(msg['Thread Key'] || msg.thread_key || '').trim() === targetKey &&
      String(msg['Sender Email'] || '').toLowerCase() !== my,
  )
  return m ? String(m['Sender Email'] || '').trim() : ''
}

function managerComposerToLabel(selectedThreadId, adminFullInbox) {
  if (adminFullInbox && selectedThreadId) return adminRecipientLabelForThreadId(selectedThreadId)
  if (selectedThreadId === MANAGER_INBOX_AXIS) return 'Axis internal team'
  if (managerInboxParseResidentThreadId(selectedThreadId)) return 'Resident (leasing thread)'
  return ''
}

function adminPortalThreadTitle(threadKey) {
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
    return 'Website · Property inquiry (admin)'
  }
  if (t.startsWith('internal:admin-public:')) {
    return `Website · ${t.slice('internal:admin-public:'.length)}`
  }
  if (t.startsWith('internal:resident-leasing:')) {
    return 'Resident · House team'
  }
  if (t.startsWith('internal:resident-admin:')) {
    return 'Resident · Admin'
  }
  return t || 'Thread'
}

function managerInboxStateKeyForSelection(selectedThreadId, axisThreadKey, adminFullInbox) {
  if (adminFullInbox && selectedThreadId && String(selectedThreadId).startsWith('internal:')) {
    return selectedThreadId
  }
  if (selectedThreadId === MANAGER_INBOX_AXIS) return axisThreadKey || ''
  const resId = managerInboxParseResidentThreadId(selectedThreadId)
  if (resId) return residentLeasingThreadKey(resId)
  return ''
}

function inboxParticipantsLine(selectedThreadId, adminFullInbox) {
  if (!selectedThreadId) return ''
  const t = String(selectedThreadId)
  if (adminFullInbox) {
    if (t.startsWith('internal:resident-leasing:')) return 'Resident ↔ Manager / House team'
    if (t.startsWith('internal:resident-admin:')) return 'Resident ↔ Admin'
    if (t.startsWith('internal:mgmt-admin:')) return 'Partner ↔ Admin'
    if (t.startsWith('internal:site-manager:')) return 'Site manager ↔ Admin'
    if (t.startsWith('internal:admin-public:')) return 'Public ↔ Admin'
    return 'Portal thread'
  }
  if (selectedThreadId === MANAGER_INBOX_AXIS) return 'You ↔ Axis internal team'
  if (managerInboxParseResidentThreadId(selectedThreadId)) return 'You ↔ Resident (leasing)'
  return ''
}

/**
 * Manager portal inbox — two-column messaging.
 * @param {boolean} [adminFullInbox] — load all internal portal threads (admin console); same UI as manager inbox.
 * @param {{ id: string, email: string, label: string }[]} [adminComposeManagers]
 * @param {{ id: string, email?: string, label: string }[]} [adminComposeResidents]
 */
export default function ManagerInboxPage({
  manager,
  allowedPropertyNames,
  adminFullInbox = false,
  adminComposeManagers = [],
  adminComposeResidents = [],
}) {
  const subjectFieldName = getPortalInboxSubjectFieldName()
  const showSubjectField = Boolean(subjectFieldName)

  const [allMsgs, setAllMsgs] = useState([])
  const [axisMsgs, setAxisMsgs] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [selectedThreadId, setSelectedThreadId] = useState(null)
  const [thread, setThread] = useState([])
  const [threadLoading, setThreadLoading] = useState(false)
  const [reply, setReply] = useState('')
  const [replySubject, setReplySubject] = useState('')
  const [sending, setSending] = useState(false)
  const [composeOpen, setComposeOpen] = useState(false)
  const [composeKind, setComposeKind] = useState(() => (adminFullInbox ? 'manager' : 'resident'))
  const [composeManagerEmail, setComposeManagerEmail] = useState('')
  const [composeAdminEmail, setComposeAdminEmail] = useState('')
  const [composeResidentRecordId, setComposeResidentRecordId] = useState('')
  const [composeSubject, setComposeSubject] = useState('')
  const [composeBody, setComposeBody] = useState('')
  const [composeSending, setComposeSending] = useState(false)
  /** Resident Profile rows scoped to this manager’s properties (House matches portal property names). */
  const [scopedResidents, setScopedResidents] = useState([])
  const [residentComposeLoading, setResidentComposeLoading] = useState(false)
  /** Admin Profile rows (Email + label) for manager → admin compose */
  const [adminInboxContacts, setAdminInboxContacts] = useState([])
  const [adminContactsLoading, setAdminContactsLoading] = useState(false)
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
    setLoadError('')
    if (adminFullInbox) {
      if (!managerEmail) {
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
        const rows = await getAllPortalInternalThreadMessages()
        setAllMsgs(rows)
        setAxisMsgs([])
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
      return
    }

    const hasScope = inboxScopeLower.size > 0
    const hasAxis = Boolean(axisThreadKey)
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
  }, [adminFullInbox, managerEmail, inboxScopeLower, axisThreadKey, refreshInboxThreadState])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  useEffect(() => {
    if (adminFullInbox || inboxScopeLower.size === 0) {
      setScopedResidents([])
      setResidentComposeLoading(false)
      return
    }

    let cancelled = false
    async function loadScopedResidents() {
      if (!isAdminPortalAirtableConfigured()) {
        setScopedResidents([])
        return
      }
      setResidentComposeLoading(true)
      try {
        const list = await loadResidentsForManagerPortalInbox([...inboxScopeLower])
        if (!cancelled) setScopedResidents(list)
      } catch (err) {
        if (!cancelled) {
          setScopedResidents([])
          toast.error('Resident list failed to load: ' + formatDataLoadError(err))
        }
      } finally {
        if (!cancelled) setResidentComposeLoading(false)
      }
    }

    loadScopedResidents()
    return () => {
      cancelled = true
    }
  }, [adminFullInbox, inboxScopeLower])

  useEffect(() => {
    if (adminFullInbox) {
      setAdminInboxContacts([])
      setAdminContactsLoading(false)
      return
    }
    let cancelled = false
    async function loadAdmins() {
      if (!isAdminPortalAirtableConfigured()) {
        setAdminInboxContacts([])
        return
      }
      setAdminContactsLoading(true)
      try {
        const list = await loadAdminProfilesForInbox()
        if (!cancelled) setAdminInboxContacts(list)
      } catch {
        if (!cancelled) setAdminInboxContacts([])
      } finally {
        if (!cancelled) setAdminContactsLoading(false)
      }
    }
    loadAdmins()
    return () => {
      cancelled = true
    }
  }, [adminFullInbox])

  useEffect(() => {
    setReplySubject('')
  }, [selectedThreadId])

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
    const msgTime = (m) => new Date(m?.Timestamp || m?.created_at || 0).getTime()

    if (adminFullInbox) {
      const byKey = new Map()
      for (const m of allMsgs) {
        const tk = portalInboxThreadKeyFromRecord(m)
        if (!tk) continue
        if (!byKey.has(tk)) byKey.set(tk, [])
        byKey.get(tk).push(m)
      }
      const rows = []
      for (const [tk, rmsgs] of byKey) {
        const sorted = [...rmsgs].sort((a, b) => msgTime(a) - msgTime(b))
        const last = sorted[sorted.length - 1]
        const lastMsgTs = last ? msgTime(last) : 0
        const participantLabel = adminRecipientLabelForThreadId(tk)
        const subjectLine =
          threadSubjectFromMessages(sorted, subjectFieldName) || adminPortalThreadTitle(tk)
        rows.push({
          id: tk,
          stateKey: tk,
          participantLabel,
          subjectLine,
          preview: threadBodyPreviewFromMessage(last),
          searchText: threadSearchHaystack(sorted, subjectFieldName, participantLabel, subjectLine),
          time: last ? fmtDateTime(last.Timestamp || last.created_at) : '',
          ts: lastMsgTs,
          lastMsgTs,
        })
      }
      rows.sort((a, b) => b.ts - a.ts)
      return rows
    }

    const rows = []
    if (axisThreadKey) {
      const sortedAxis = [...axisMsgs].sort((a, b) => msgTime(a) - msgTime(b))
      const last = sortedAxis[sortedAxis.length - 1]
      const lastMsgTs = last ? msgTime(last) : 0
      const participantLabel = 'Axis internal team'
      const subjectLine =
        threadSubjectFromMessages(sortedAxis, subjectFieldName) || 'Axis support'
      rows.push({
        id: MANAGER_INBOX_AXIS,
        stateKey: axisThreadKey,
        participantLabel,
        subjectLine,
        preview: threadBodyPreviewFromMessage(last),
        searchText: threadSearchHaystack(sortedAxis, subjectFieldName, participantLabel, subjectLine),
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
      const participantLabel = scopeHint || 'Resident'
      const subjectLine =
        threadSubjectFromMessages(sorted, subjectFieldName) || 'House team'
      rows.push({
        id: managerInboxResidentThreadId(rid),
        stateKey: tk,
        participantLabel,
        subjectLine,
        preview: threadBodyPreviewFromMessage(last),
        searchText: threadSearchHaystack(sorted, subjectFieldName, participantLabel, subjectLine),
        time: last ? fmtDateTime(last.Timestamp || last.created_at) : '',
        ts: lastMsgTs,
        lastMsgTs,
      })
    }

    rows.sort((a, b) => b.ts - a.ts)
    return rows
  }, [adminFullInbox, allMsgs, axisMsgs, axisThreadKey, inboxScopeLower, subjectFieldName])

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
    else if (sectionFilter === 'trash') rows = rows.filter((row) => row.section === 'trash')
    if (!q) return rows
    return rows.filter((row) => (row.searchText || '').includes(q))
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

  const selectedStateKey = managerInboxStateKeyForSelection(selectedThreadId, axisThreadKey, adminFullInbox)
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
    setThreadMenuOpen(false)
  }, [selectedThreadId])

  useEffect(() => {
    if (!composeOpen) return
    if (adminFullInbox) {
      setComposeKind('manager')
    } else {
      setComposeKind('resident')
    }
    setComposeManagerEmail('')
    setComposeAdminEmail(
      adminInboxContacts.length === 1 ? adminInboxContacts[0].email : '',
    )
    setComposeResidentRecordId('')
    setComposeSubject('')
  }, [composeOpen, adminFullInbox, adminInboxContacts])

  useEffect(() => {
    if (!composeOpen || adminFullInbox || composeKind !== 'admin') return
    if (adminInboxContacts.length === 1) setComposeAdminEmail(adminInboxContacts[0].email)
  }, [composeOpen, adminFullInbox, composeKind, adminInboxContacts])

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
        if (adminFullInbox && String(selectedThreadId).startsWith('internal:')) {
          const next = await getMessagesByThreadKey(selectedThreadId)
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
  }, [selectedThreadId, axisThreadKey, adminFullInbox])

  async function handleComposeSend(e) {
    e.preventDefault()
    if (!managerEmail || !composeBody.trim()) return
    const subjResolved = composeSubject.trim()
    if (!subjResolved) {
      toast.error('Enter a subject.')
      return
    }
    const kind = composeKind
    let threadKey = ''
    if (adminFullInbox) {
      if (kind === 'manager') {
        const em = composeManagerEmail.trim().toLowerCase()
        if (!em.includes('@')) {
          toast.error('Select a manager.')
          return
        }
        threadKey = siteManagerThreadKey(em)
      } else if (kind === 'resident') {
        const id = composeResidentRecordId.trim()
        if (!/^rec[a-zA-Z0-9]{14,}$/.test(id)) {
          toast.error('Select a resident from the list.')
          return
        }
        threadKey = residentAdminThreadKey(id)
      } else {
        return
      }
    } else if (kind === 'resident') {
      const id = composeResidentRecordId.trim()
      if (!/^rec[a-zA-Z0-9]{14,}$/.test(id)) {
        toast.error('Select a resident from the list to start a conversation.')
        return
      }
      threadKey = residentLeasingThreadKey(id)
    } else if (kind === 'admin') {
      const em = composeAdminEmail.trim().toLowerCase()
      if (!em.includes('@')) {
        toast.error('Select an admin contact.')
        return
      }
      threadKey = managementAdminThreadKey(em)
    } else {
      return
    }
    const bodyOut = mergeSubjectIntoMessageIfNeeded(composeBody.trim(), subjResolved, showSubjectField)
    const ridForSelect = composeResidentRecordId.trim()
    setComposeSending(true)
    try {
      await sendMessage({
        senderEmail: managerEmail,
        message: bodyOut,
        isAdmin: true,
        threadKey,
        channel: PORTAL_INBOX_CHANNEL_INTERNAL,
        subject: showSubjectField ? subjResolved : '',
      })
      if (adminFullInbox) {
        if (kind === 'manager' && composeManagerEmail.trim()) {
          notifyPortalMessage({
            recipientEmail: composeManagerEmail.trim(),
            senderName: managerEmail,
            subject: subjResolved,
          })
        } else if (kind === 'resident') {
          const fromList = adminComposeResidents.find((r) => String(r.id) === ridForSelect)
          const re = String(fromList?.email || '').trim()
          if (re.includes('@')) {
            notifyPortalMessage({ recipientEmail: re, senderName: managerEmail, subject: subjResolved })
          }
        }
      } else if (kind === 'admin') {
        notifyPortalMessage({
          recipientEmail: composeAdminEmail.trim(),
          senderName: managerEmail,
          subject: subjResolved,
        })
      } else if (kind === 'resident') {
        const re = getResidentEmailFromAllMsgs(allMsgs, ridForSelect, managerEmail, residentLeasingThreadKey)
        if (re) notifyPortalMessage({ recipientEmail: re, senderName: managerEmail, subject: subjResolved })
      }
      setComposeOpen(false)
      setComposeBody('')
      setComposeSubject('')
      setComposeManagerEmail('')
      setComposeAdminEmail('')
      setComposeResidentRecordId('')
      setComposeKind(adminFullInbox ? 'manager' : 'resident')
      await loadAll()
      const selectionId = adminFullInbox
        ? threadKey
        : kind === 'resident'
          ? managerInboxResidentThreadId(ridForSelect)
          : threadKey
      setSelectedThreadId(selectionId)
      const next = await getMessagesByThreadKey(threadKey)
      setThread(
        [...next].sort(
          (a, b) =>
            new Date(a.Timestamp || a.created_at || 0) - new Date(b.Timestamp || b.created_at || 0),
        ),
      )
      if (threadKey) await touchThreadRead(threadKey)
      toast.success('Sent')
    } catch (err) {
      toast.error(err.message || 'Send failed')
    } finally {
      setComposeSending(false)
    }
  }

  async function handleSendReply(e) {
    e.preventDefault()
    if (!selectedThreadId || !reply.trim() || !managerEmail) return
    const subjResolved = showSubjectField ? replySubject.trim() : ''
    const bodyOut = mergeSubjectIntoMessageIfNeeded(reply.trim(), subjResolved, showSubjectField)
    setSending(true)
    try {
      if (adminFullInbox) {
        await sendMessage({
          senderEmail: managerEmail,
          message: bodyOut,
          isAdmin: true,
          threadKey: selectedThreadId,
          channel: PORTAL_INBOX_CHANNEL_INTERNAL,
          subject: showSubjectField ? subjResolved : '',
        })
        notifyPortalMessage({
          recipientEmail: getOtherPartyEmail(thread, managerEmail),
          senderName: managerEmail,
          subject: subjResolved,
        })
        setReply('')
        setReplySubject('')
        await loadAll()
        const next = await getMessagesByThreadKey(selectedThreadId)
        setThread(
          [...next].sort(
            (a, b) =>
              new Date(a.Timestamp || a.created_at || 0) - new Date(b.Timestamp || b.created_at || 0),
          ),
        )
        const sk = managerInboxStateKeyForSelection(selectedThreadId, axisThreadKey, adminFullInbox)
        if (sk) await touchThreadRead(sk)
        toast.success('Sent')
        return
      }
      if (selectedThreadId === MANAGER_INBOX_AXIS) {
        await sendMessage({
          senderEmail: managerEmail,
          message: bodyOut,
          isAdmin: false,
          threadKey: axisThreadKey,
          channel: PORTAL_INBOX_CHANNEL_INTERNAL,
          subject: showSubjectField ? subjResolved : '',
        })
        notifyPortalMessage({ toAdmins: true, senderName: managerEmail, subject: subjResolved })
      } else {
        const resId = managerInboxParseResidentThreadId(selectedThreadId)
        if (!resId) return
        await sendMessage({
          senderEmail: managerEmail,
          message: bodyOut,
          isAdmin: true,
          threadKey: residentLeasingThreadKey(resId),
          channel: PORTAL_INBOX_CHANNEL_INTERNAL,
          subject: showSubjectField ? subjResolved : '',
        })
        notifyPortalMessage({
          recipientEmail: getOtherPartyEmail(thread, managerEmail),
          senderName: managerEmail,
          subject: subjResolved,
        })
      }
      setReply('')
      setReplySubject('')
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
      const sk = managerInboxStateKeyForSelection(selectedThreadId, axisThreadKey, adminFullInbox)
      if (sk) await touchThreadRead(sk)
      toast.success('Sent')
    } catch (err) {
      toast.error(err.message || 'Send failed')
    } finally {
      setSending(false)
    }
  }

  const activeThreadSubject = useMemo(
    () =>
      selectedThreadId && thread.length ? threadSubjectFromMessages(thread, subjectFieldName) : '',
    [thread, subjectFieldName, selectedThreadId],
  )

  const residentThreadLabels = useMemo(() => {
    const labelMap = new Map()
    for (const row of threadRows) {
      const rid = managerInboxParseResidentThreadId(row.id)
      if (!rid) continue
      labelMap.set(rid, row.participantLabel || 'Resident')
    }
    return labelMap
  }, [threadRows])

  const residentComposeOptions = useMemo(() => {
    return scopedResidents
      .map((r) => {
        const id = String(r?.id || '').trim()
        if (!id || !/^rec[a-zA-Z0-9]{14,}$/.test(id)) return null
        const name = String(r.Name || '').trim() || residentThreadLabels.get(id) || 'Resident'
        const email = String(r.Email || '').trim()
        const house = String(r.House || '').trim()
        const unit = String(r['Unit Number'] || '').trim()
        const place = [house, unit].filter(Boolean).join(' ')
        return {
          id,
          label: [name, place].filter(Boolean).join(' · '),
          detail: email,
        }
      })
      .filter(Boolean)
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [residentThreadLabels, scopedResidents])

  const adminManagerComposeOptions = useMemo(() => {
    return (adminComposeManagers || [])
      .map((m) => {
        const email = String(m.email || '').trim().toLowerCase()
        if (!email.includes('@')) return null
        return { id: m.id, email, label: m.label || email }
      })
      .filter(Boolean)
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [adminComposeManagers])

  const adminResidentComposeOptions = useMemo(() => {
    return (adminComposeResidents || [])
      .map((r) => {
        const id = String(r.id || '').trim()
        if (!id || !/^rec[a-zA-Z0-9]{14,}$/.test(id)) return null
        return {
          id,
          label: r.label || id,
          detail: String(r.email || '').trim(),
        }
      })
      .filter(Boolean)
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [adminComposeResidents])

  const selectedRowMeta = useMemo(
    () => visibleThreadRows.find((r) => r.id === selectedThreadId),
    [visibleThreadRows, selectedThreadId],
  )

  useEffect(() => {
    if (composeOpen) return
    if (!selectedThreadId) return
    if (!visibleThreadRows.some((r) => r.id === selectedThreadId)) {
      setSelectedThreadId(null)
    }
  }, [visibleThreadRows, selectedThreadId, composeOpen])

  if (!adminFullInbox && !inboxScopeLower.size && !axisThreadKey) {
    return null
  }

  const readingTitle = adminFullInbox
    ? selectedThreadId
      ? adminPortalThreadTitle(selectedThreadId)
      : 'Inbox'
    : selectedThreadId === MANAGER_INBOX_AXIS
      ? 'Axis team'
      : managerInboxParseResidentThreadId(selectedThreadId || '')
        ? 'Resident inbox'
        : 'Inbox'

  const readingSubtitle = adminFullInbox
    ? ''
    : selectedThreadId === MANAGER_INBOX_AXIS
      ? 'Axis support'
      : managerInboxParseResidentThreadId(selectedThreadId)
        ? 'Leasing thread'
        : ''

  const headerSubject =
    activeThreadSubject || selectedRowMeta?.subjectLine || readingTitle

  const listEmptyMessage =
    sectionFilter === 'trash' && inboxSections.trash.length === 0
      ? 'Nothing in trash'
      : inboxActiveTotal === 0 && sectionFilter !== 'trash'
        ? 'No conversations yet'
        : threadSearch.trim()
          ? 'No matches for your search'
          : sectionFilter === 'unread'
            ? 'No unread conversations'
            : 'No conversations'

  const composerPlaceholder =
    adminFullInbox || selectedThreadId !== MANAGER_INBOX_AXIS ? 'Write a reply…' : 'Message Axis…'

  const composerToLabel = useMemo(() => {
    if (!selectedThreadId) return ''
    return managerComposerToLabel(selectedThreadId, adminFullInbox)
  }, [selectedThreadId, adminFullInbox])

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
                    className="shrink-0 text-xs font-semibold text-slate-500 hover:text-slate-800"
                  >
                    Cancel
                  </button>
                </div>
                <form onSubmit={handleComposeSend} className="mt-4 space-y-3">
                  <label className="block text-xs font-semibold text-slate-700">
                    To
                    <select
                      value={composeKind}
                      onChange={(e) => setComposeKind(e.target.value)}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                    >
                      {adminFullInbox ? (
                        <>
                          <option value="manager">Manager</option>
                          <option value="resident">Resident</option>
                        </>
                      ) : (
                        <>
                          <option value="resident">Resident</option>
                          <option value="admin">Admin</option>
                        </>
                      )}
                    </select>
                  </label>
                  {adminFullInbox && composeKind === 'manager' ? (
                    <div className="space-y-2">
                      {adminManagerComposeOptions.length ? (
                        <label className="block text-xs font-semibold text-slate-700">
                          Manager
                          <select
                            value={
                              adminManagerComposeOptions.some((o) => o.email === composeManagerEmail)
                                ? composeManagerEmail
                                : ''
                            }
                            onChange={(e) => setComposeManagerEmail(e.target.value)}
                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                          >
                            <option value="">Select…</option>
                            {adminManagerComposeOptions.map((o) => (
                              <option key={o.email} value={o.email}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : (
                        <p className="text-xs text-slate-500">No manager accounts loaded.</p>
                      )}
                    </div>
                  ) : null}
                  {adminFullInbox && composeKind === 'resident' ? (
                    <div className="space-y-2">
                      {adminResidentComposeOptions.length ? (
                        <label className="block text-xs font-semibold text-slate-700">
                          Resident
                          <select
                            value={
                              adminResidentComposeOptions.some((o) => o.id === composeResidentRecordId)
                                ? composeResidentRecordId
                                : ''
                            }
                            onChange={(e) => setComposeResidentRecordId(e.target.value)}
                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                          >
                            <option value="">Select…</option>
                            {adminResidentComposeOptions.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.detail ? `${o.label} · ${o.detail}` : o.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : (
                        <p className="text-xs text-slate-500">No resident profiles found.</p>
                      )}
                    </div>
                  ) : null}
                  {!adminFullInbox && composeKind === 'resident' ? (
                    <div className="space-y-2">
                      {residentComposeOptions.length ? (
                        <label className="block text-xs font-semibold text-slate-700">
                          Resident
                          <select
                            value={
                              residentComposeOptions.some((o) => o.id === composeResidentRecordId)
                                ? composeResidentRecordId
                                : ''
                            }
                            onChange={(e) => setComposeResidentRecordId(e.target.value)}
                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                          >
                            <option value="">Select…</option>
                            {residentComposeOptions.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.detail ? `${o.label} · ${o.detail}` : o.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : residentComposeLoading ? (
                        <p className="text-xs text-slate-500">Loading residents…</p>
                      ) : (
                        <p className="text-xs text-slate-500">
                          No residents found for your properties yet.
                        </p>
                      )}
                    </div>
                  ) : null}
                  {!adminFullInbox && composeKind === 'admin' ? (
                    <div className="space-y-2">
                      {adminContactsLoading ? (
                        <p className="text-xs text-slate-500">Loading admin contacts…</p>
                      ) : adminInboxContacts.length ? (
                        <label className="block text-xs font-semibold text-slate-700">
                          Admin
                          <select
                            value={
                              adminInboxContacts.some((c) => c.email === composeAdminEmail)
                                ? composeAdminEmail
                                : ''
                            }
                            onChange={(e) => setComposeAdminEmail(e.target.value)}
                            className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                          >
                            <option value="">Select…</option>
                            {adminInboxContacts.map((c) => (
                              <option key={c.id} value={c.email}>
                                {c.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : (
                        <p className="text-xs text-slate-500">
                          No admin contacts found. Add people with an email in your Admin Profile table (and ensure they are
                          not disabled).
                        </p>
                      )}
                    </div>
                  ) : null}
                  <label className="block text-xs font-semibold text-slate-700">
                    Subject
                    <input
                      type="text"
                      value={composeSubject}
                      onChange={(e) => setComposeSubject(e.target.value)}
                      required
                      disabled={composeSending}
                      placeholder="Brief subject line"
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                    />
                  </label>
                  <label className="block text-xs font-semibold text-slate-700">
                    Message
                    <textarea
                      value={composeBody}
                      onChange={(e) => setComposeBody(e.target.value)}
                      rows={4}
                      required
                      placeholder="Write your message…"
                      className="mt-1 w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                    />
                  </label>
                  <div className="flex justify-end pt-1">
                    <button
                      type="submit"
                      disabled={composeSending || !composeBody.trim()}
                      className="rounded-xl bg-[#2563eb] px-5 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-45"
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
                  <h3 className="text-lg font-black tracking-tight text-slate-900 md:text-xl">{headerSubject}</h3>
                  <p className="mt-1 text-sm text-slate-600">{inboxParticipantsLine(selectedThreadId, adminFullInbox)}</p>
                  {readingSubtitle ? <p className="mt-0.5 text-xs text-slate-400">{readingSubtitle}</p> : null}
                  {selectedInTrash ? (
                    <p className="mt-2 text-xs font-medium text-amber-800">In trash — restore from the list or menu.</p>
                  ) : null}
                </div>
                {selectedStateKey ? (
                  <div className="flex shrink-0 items-center gap-2">
                    {selectedInTrash ? (
                      <button
                        type="button"
                        onClick={() => moveThreadTrash(selectedStateKey, false)}
                        className="rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Restore
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => moveThreadTrash(selectedStateKey, true)}
                        className="rounded-full border border-red-200 bg-red-50 px-4 py-2 text-xs font-semibold text-red-700 hover:bg-red-100"
                      >
                        Trash
                      </button>
                    )}
                    <div className="relative" ref={threadMenuRef}>
                      <button
                        type="button"
                        onClick={() => setThreadMenuOpen((v) => !v)}
                        className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600 hover:bg-slate-50"
                        aria-label="More actions"
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
                              Move to trash…
                            </button>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </header>

          {!composeOpen && !selectedThreadId ? (
            <div className="flex min-h-[220px] flex-1 flex-col items-center justify-center gap-4 px-6 py-10 text-center">
              <p className="max-w-sm text-sm text-slate-600">Select a conversation to view messages, or start a new one.</p>
              <button
                type="button"
                onClick={() => {
                  setComposeOpen(true)
                  setThread([])
                }}
                className="rounded-full bg-[#2563eb] px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#1d4ed8]"
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
                isAxisThread={selectedThreadId === MANAGER_INBOX_AXIS}
                formatTime={fmtDateTime}
                messageSubjectKey={subjectFieldName}
                hideInlineSubject={Boolean(activeThreadSubject && subjectFieldName)}
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
              placeholder={composerPlaceholder}
              showSubject={showSubjectField}
              useSubjectPresets={false}
              subject={replySubject}
              onSubjectChange={setReplySubject}
              subjectPlaceholder="Optional — adds a subject line to this reply"
              allowSubjectEmpty
              toLabel={composerToLabel || null}
            />
          ) : null}
        </div>
      </div>

    </div>
  )
}

/** Alias for documentation / future imports */
export { ManagerInboxPage as InboxPage }

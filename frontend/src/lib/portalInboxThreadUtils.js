/**
 * Latest non-empty subject on a thread (by message time).
 * @param {object[]} messages
 * @param {string} subjectFieldName — Airtable field name, or ''
 */
export function threadSubjectFromMessages(messages, subjectFieldName) {
  if (!subjectFieldName || !messages?.length) return ''
  let best = ''
  let bestTs = 0
  for (const m of messages) {
    const s = String(m[subjectFieldName] || '').trim()
    if (!s) continue
    const ts = new Date(m.Timestamp || m.created_at || 0).getTime()
    if (ts >= bestTs) {
      best = s
      bestTs = ts
    }
  }
  return best
}

/** First line of plain body for list preview. */
export function threadBodyPreviewFromMessage(m) {
  if (!m) return ''
  const body = String(m.Message || '').trim()
  if (!body) return ''
  const line = body.split('\n').map((l) => l.trim()).find(Boolean) || body
  return line.length > 140 ? `${line.slice(0, 137)}…` : line
}

/**
 * Build a lower-case search haystack from all message bodies + metadata for a thread.
 */
export function threadSearchHaystack(messages, subjectFieldName, participantLabel, subjectLine) {
  const parts = [participantLabel || '', subjectLine || '']
  for (const m of messages || []) {
    parts.push(String(m.Message || ''))
    if (subjectFieldName) parts.push(String(m[subjectFieldName] || ''))
    parts.push(String(m['Sender Email'] || ''), String(m['Sender Name'] || ''))
  }
  return parts.join(' ').toLowerCase()
}

/**
 * If the Messages table has no Subject field, prepend a subject line so it is still visible in body.
 */
export function mergeSubjectIntoMessageIfNeeded(message, subject, subjectFieldConfigured) {
  const m = String(message || '').trim()
  const s = String(subject || '').trim()
  if (!s || subjectFieldConfigured) return m
  return `[Subject: ${s}]\n\n${m}`
}

/**
 * Normalize `Sender Email` from a Messages row (plain text, email field quirks, or linked arrays).
 * Lowercase trim for comparison with portal sign-in email.
 */
export function portalSenderEmailFromMessage(m) {
  if (!m) return ''
  const raw = m['Sender Email']
  if (raw == null || raw === '') return ''
  if (Array.isArray(raw)) {
    const withAt = raw.map((x) => String(x).trim()).find((s) => s.includes('@'))
    return (withAt || String(raw[0] || '').trim()).toLowerCase()
  }
  return String(raw).trim().toLowerCase()
}

/**
 * Inbox folder for a thread: trash, sent (you sent the latest message), unopened, or opened.
 * @param {{ lastMsgTs: number, state: { lastReadAt?: Date|null, trashed?: boolean }|undefined, lastSenderEmail: string, myEmail: string }} p
 */
export function portalInboxThreadSection({ lastMsgTs, state, lastSenderEmail, myEmail }) {
  if (state?.trashed) return 'trash'
  const my = String(myEmail || '').trim().toLowerCase()
  const from = String(lastSenderEmail || '').trim().toLowerCase()
  if (my && from && from === my) return 'sent'
  const ts = Number(lastMsgTs) || 0
  if (ts <= 0) {
    return state?.lastReadAt ? 'opened' : 'unopened'
  }
  if (!state?.lastReadAt) return 'unopened'
  return ts > state.lastReadAt.getTime() ? 'unopened' : 'opened'
}

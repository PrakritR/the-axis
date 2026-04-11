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
 * If the Messages table has no Subject field, prepend a subject line so it is still visible in body.
 */
export function mergeSubjectIntoMessageIfNeeded(message, subject, subjectFieldConfigured) {
  const m = String(message || '').trim()
  const s = String(subject || '').trim()
  if (!s || subjectFieldConfigured) return m
  return `[Subject: ${s}]\n\n${m}`
}

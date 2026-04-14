/*
 * Airtable **Scripting** extension script (same pattern as create-announcement.js).
 *
 * Purpose: verify **Sent vs Unopened** behavior across two portal users without adding
 * new Airtable fields. The app treats **Sent** when the latest row in Messages has
 * `Sender Email` equal to the signed-in user; everyone else on that thread uses
 * `Inbox Thread State` → `Last Read At` vs latest message time for Unopened/Opened.
 *
 * Setup: Extensions → Scripting → paste this file. Edit table/field names if yours differ
 * from defaults (see docs/AIRTABLE_SETUP_PROMPT.md §1.6 / §1.6b).
 *
 * Run: enter a substring to filter Messages (e.g. `internal:site-manager:manager@`).
 */

const TABLE_MESSAGES = 'Messages'
const TABLE_INBOX_STATE = 'Inbox Thread State'

const F_THREAD = 'Thread Key'
const F_SENDER = 'Sender Email'
const F_TS = 'Timestamp'

const F_STATE_THREAD = 'Thread Key'
const F_STATE_PARTICIPANT = 'Participant Email'
const F_STATE_LAST_READ = 'Last Read At'

function msgTime(rec) {
  try {
    const raw = rec.getCellValue(F_TS)
    if (raw) return new Date(raw).getTime()
  } catch {
    /* field missing from select */
  }
  return new Date(rec.createdTime).getTime()
}

/** String form of a cell (email, text, single collaborator, etc.). */
function cellStr(rec, fieldName) {
  let v
  try {
    v = rec.getCellValue(fieldName)
  } catch {
    return ''
  }
  if (v == null) return ''
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'object' && v && typeof v.email === 'string') return v.email.trim()
  if (Array.isArray(v)) {
    const s = v.map((x) => (typeof x === 'string' ? x : x?.email || String(x))).find(Boolean)
    return String(s || '').trim()
  }
  return String(v).trim()
}

const needle = await input.textAsync(
  'Only Messages whose Thread Key **contains** this substring (e.g. internal:site-manager:you@)',
)

if (!String(needle || '').trim()) {
  output.markdown('No filter — cancelled.')
  return
}

const n = String(needle).trim()
const messagesTable = base.getTable(TABLE_MESSAGES)
const stateTable = base.getTable(TABLE_INBOX_STATE)

const msgQuery = await messagesTable.selectRecordsAsync({
  fields: [F_THREAD, F_SENDER, F_TS].filter((f) => {
    try {
      messagesTable.getField(f)
      return true
    } catch {
      return false
    }
  }),
})

const byThread = new Map()
for (const rec of msgQuery.records) {
  const tk = cellStr(rec, F_THREAD)
  if (!tk || !tk.includes(n)) continue
  if (!byThread.has(tk)) byThread.set(tk, [])
  byThread.get(tk).push(rec)
}

if (byThread.size === 0) {
  output.markdown(`No Messages rows matched Thread Key containing \`${n}\`.`)
  return
}

const stateQuery = await stateTable.selectRecordsAsync({
  fields: [F_STATE_THREAD, F_STATE_PARTICIPANT, F_STATE_LAST_READ].filter((f) => {
    try {
      stateTable.getField(f)
      return true
    } catch {
      return false
    }
  }),
})

const stateByThread = new Map()
for (const rec of stateQuery.records) {
  const tk = cellStr(rec, F_STATE_THREAD)
  if (!tk || !byThread.has(tk)) continue
  if (!stateByThread.has(tk)) stateByThread.set(tk, [])
  stateByThread.get(tk).push(rec)
}

const lines = ['## Inbox diagnostics (Sent vs Unopened)', '', `Filter: \`${n}\``, '']

for (const [tk, recs] of byThread) {
  const sorted = [...recs].sort((a, b) => msgTime(a) - msgTime(b))
  const last = sorted[sorted.length - 1]
  const lastSender = cellStr(last, F_SENDER).toLowerCase()
  lines.push(`### Thread \`${tk}\``)
  lines.push(`- **Messages in sample:** ${sorted.length}`)
  lines.push(`- **Latest sender (\`Sender Email\`):** \`${lastSender || '(empty)'}\``)
  lines.push(
    '- **Who sees Sent:** anyone signed in with this exact email (lowercased) as the latest sender.',
  )
  lines.push('- **Who sees Unopened/Opened:** any other portal user, using their own Inbox Thread State row.')

  const states = stateByThread.get(tk) || []
  if (!states.length) {
    lines.push('- **Inbox Thread State:** _no rows for this thread yet_ → other users default to **Unopened** until they open the thread (then Last Read At is set).')
  } else {
    lines.push('- **Inbox Thread State rows:**')
    for (const s of states) {
      const em = cellStr(s, F_STATE_PARTICIPANT)
      const lr = s.getCellValue(F_STATE_LAST_READ)
      lines.push(`  - \`${em}\` — Last Read At: ${lr ? String(lr) : '(empty) → Unopened for new inbound)'}`)
    }
  }
  lines.push('')
}

output.markdown(lines.join('\n'))

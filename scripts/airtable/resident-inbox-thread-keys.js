/*
 * Airtable **Scripting** extension — list distinct **Thread Key** values for one resident’s inbox.
 *
 * Use this to verify segmented keys like:
 *   internal:resident-leasing:recXXXXXXXXXXXXXX
 *   internal:resident-leasing:recXXXXXXXXXXXXXX:s:1713000123456
 *
 * No new tables or fields are required for segmented threads; keys live on **Messages** only.
 *
 * Setup: Extensions → Scripting → paste. Set TABLE + field names to match your base.
 */

const TABLE_RESIDENTS = 'Resident Profile'
const F_RESIDENT_EMAIL = 'Email'

const TABLE_MESSAGES = 'Messages'
const F_THREAD = 'Thread Key'

const email = await input.textAsync('Resident email (exact match on Resident Profile)')

const em = String(email || '').trim().toLowerCase()
if (!em.includes('@')) {
  output.markdown('Enter a valid email.')
  return
}

const residentsTable = base.getTable(TABLE_RESIDENTS)
const resQuery = await residentsTable.selectRecordsAsync({
  fields: [F_RESIDENT_EMAIL],
})
const resident = resQuery.records.find((r) => {
  let v
  try {
    v = r.getCellValue(F_RESIDENT_EMAIL)
  } catch {
    return false
  }
  const s = typeof v === 'string' ? v : v?.email || ''
  return String(s || '').trim().toLowerCase() === em
})
if (!resident) {
  output.markdown(`No resident row with **${em}**.`)
  return
}

const rid = resident.id
const prefixLeasing = `internal:resident-leasing:${rid}`
const prefixAdmin = `internal:resident-admin:${rid}`

const messagesTable = base.getTable(TABLE_MESSAGES)
const msgQuery = await messagesTable.selectRecordsAsync({
  fields: [F_THREAD].filter((f) => {
    try {
      messagesTable.getField(f)
      return true
    } catch {
      return false
    }
  }),
})

const keys = new Set()
for (const rec of msgQuery.records) {
  let tk
  try {
    tk = rec.getCellValueAsString(F_THREAD)
  } catch {
    continue
  }
  tk = String(tk || '').trim()
  if (!tk) continue
  if (tk === prefixLeasing || tk.startsWith(`${prefixLeasing}:s:`)) keys.add(tk)
  if (tk === prefixAdmin || tk.startsWith(`${prefixAdmin}:s:`)) keys.add(tk)
}

const sorted = [...keys].sort()
output.markdown(
  `**Resident:** ${rid} · ${em}\n\n**Thread keys (${sorted.length}):**\n\n` +
    (sorted.length ? sorted.map((k) => `- \`${k}\``).join('\n') : '_none_'),
)

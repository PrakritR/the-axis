/**
 * Airtable POST helper: removes fields Airtable reports as unknown and retries.
 * Scheduling bases differ (e.g. "Message" vs "Notes", optional Scheduled Date).
 */

function parseUnknownFieldNameFromBody(bodyText) {
  try {
    const msg = String(JSON.parse(bodyText)?.error?.message || '')
    const m =
      msg.match(/Unknown field name:\s*"([^"]+)"/i) || msg.match(/Unknown field name:\s*'([^']+)'/i)
    return m ? String(m[1]).trim() : ''
  } catch {
    return ''
  }
}

/** Airtable REST: INVALID_VALUE_FOR_COLUMN — wrong type or select option. */
function parseInvalidValueFieldNameFromBody(bodyText) {
  try {
    const msg = String(JSON.parse(bodyText)?.error?.message || '')
    const m =
      msg.match(/Field\s+"([^"]+)"\s+cannot accept/i) || msg.match(/Field\s+'([^']+)'\s+cannot accept/i)
    return m ? String(m[1]).trim() : ''
  } catch {
    return ''
  }
}

function deleteFieldCaseInsensitive(fields, rawUnknown) {
  const u = String(rawUnknown || '').trim().toLowerCase()
  if (!u) return fields
  const keys = Object.keys(fields)
  const hit = keys.find((k) => k.toLowerCase() === u)
  if (!hit) return fields
  const { [hit]: _removed, ...rest } = fields
  return rest
}

/**
 * @param {{ baseId: string, token: string, tableName?: string, fields: Record<string, unknown> }} opts
 * @returns {Promise<Record<string, unknown>>} Parsed Airtable create response (includes `id`).
 */
export async function airtableCreateWithUnknownFieldRetry({ baseId, token, tableName = 'Scheduling', fields }) {
  const table = encodeURIComponent(tableName)
  const url = `https://api.airtable.com/v0/${baseId}/${table}`
  let payload = { ...fields }
  let lastBody = ''
  const maxAttempts = 24

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: payload, typecast: true }),
    })
    const body = await res.text()
    lastBody = body
    if (res.ok) {
      return JSON.parse(body)
    }
    const unknown = parseUnknownFieldNameFromBody(body)
    const invalidCol = unknown ? '' : parseInvalidValueFieldNameFromBody(body)
    const removable = unknown || invalidCol
    if (!removable) break
    const next = deleteFieldCaseInsensitive(payload, removable)
    if (Object.keys(next).length === Object.keys(payload).length) break
    payload = next
  }

  let msg = `Data service error`
  try {
    msg = String(JSON.parse(lastBody)?.error?.message || msg)
  } catch {
    if (lastBody) msg = `${msg}: ${lastBody.slice(0, 280)}`
  }
  throw new Error(msg)
}

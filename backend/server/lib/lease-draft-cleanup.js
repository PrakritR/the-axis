/**
 * Remove Lease Drafts rows tied to an Applications record (pending / rejected flows).
 */

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
const CORE_BASE_ID =
  process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const CORE_URL = `https://api.airtable.com/v0/${CORE_BASE_ID}`

function airtableHeaders() {
  return { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
}

function escapeFormulaValue(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export async function deleteLeaseDraftsForApplicationId(applicationRecordId) {
  const id = String(applicationRecordId || '').trim()
  if (!id.startsWith('rec') || !AIRTABLE_TOKEN) return { deletedIds: [] }

  const encTable = encodeURIComponent('Lease Drafts')
  const formula = encodeURIComponent(`{Application Record ID} = "${escapeFormulaValue(id)}"`)
  const deletedIds = []

  let offset = null
  do {
    const url = `${CORE_URL}/${encTable}?filterByFormula=${formula}&fields%5B%5D=Application%20Record%20ID${offset ? `&offset=${encodeURIComponent(offset)}` : ''}`
    const res = await fetch(url, { headers: airtableHeaders() })
    if (!res.ok) break
    const data = await res.json()
    const records = data.records || []
    for (const rec of records) {
      const rid = String(rec.id || '').trim()
      if (!rid) continue
      const del = await fetch(`${CORE_URL}/${encTable}/${rid}`, {
        method: 'DELETE',
        headers: airtableHeaders(),
      })
      if (del.ok) deletedIds.push(rid)
    }
    offset = data.offset || null
  } while (offset)

  return { deletedIds }
}

/**
 * POST /api/portal?action=lease-mark-notifications-read
 *
 * Marks one or more Lease Notifications records as read.
 *
 * Body:
 *   notificationIds – string[] of Airtable record IDs to mark as read
 *                     OR pass recipientRecordId to mark ALL unread for that recipient
 *   recipientRecordId – if provided (without notificationIds), fetches all unread
 *                       notifications for this recipient and marks them read
 */

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
const BASE_ID = process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const BASE_URL = `https://api.airtable.com/v0/${BASE_ID}`

function atHeaders() {
  return { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' }
}

async function atGet(url) {
  const res = await fetch(url, { headers: atHeaders() })
  if (!res.ok) { const t = await res.text(); throw new Error(t) }
  return res.json()
}

async function atPatch(table, recordId, fields) {
  const res = await fetch(`${BASE_URL}/${encodeURIComponent(table)}/${recordId}`, {
    method: 'PATCH',
    headers: atHeaders(),
    body: JSON.stringify({ fields, typecast: true }),
  })
  if (!res.ok) { const t = await res.text(); throw new Error(t) }
  return res.json()
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!AIRTABLE_TOKEN) return res.status(500).json({ error: 'Server not configured.' })

  const { notificationIds, recipientRecordId, leaseDraftId } = req.body || {}

  try {
    let ids = []

    if (Array.isArray(notificationIds) && notificationIds.length > 0) {
      ids = notificationIds.map(String)
    } else if (recipientRecordId) {
      // Fetch all unread notifications for this recipient
      const url = new URL(`${BASE_URL}/${encodeURIComponent('Lease Notifications')}`)
      const clauses = [`{Recipient Record ID} = "${recipientRecordId}"`, `NOT({Is Read})`]
      if (leaseDraftId) clauses.push(`{Lease Draft ID} = "${leaseDraftId}"`)
      url.searchParams.set('filterByFormula', `AND(${clauses.join(',')})`)
      url.searchParams.set('fields[]', 'Is Read')
      const data = await atGet(url.toString())
      ids = (data.records || []).map(r => r.id)
    }

    if (ids.length === 0) {
      return res.status(200).json({ ok: true, marked: 0 })
    }

    // Patch each in parallel (batch up to 10 concurrent)
    const results = await Promise.allSettled(
      ids.map(id => atPatch('Lease Notifications', id, { 'Is Read': true }))
    )

    const succeeded = results.filter(r => r.status === 'fulfilled').length
    const failed    = results.filter(r => r.status === 'rejected').length

    if (failed > 0) {
      console.warn(`[lease-mark-notifications-read] ${failed} of ${ids.length} updates failed`)
    }

    return res.status(200).json({ ok: true, marked: succeeded, failed })
  } catch (err) {
    console.error('[lease-mark-notifications-read]', err)
    return res.status(500).json({ error: err.message || 'Failed to mark notifications read.' })
  }
}

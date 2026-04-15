/**
 * POST /api/portal?action=lease-resident-list-comments
 *
 * Body: leaseDraftId, residentRecordId, residentEmail
 * Returns { comments: [{ id, Author Name, Author Role, Message, Timestamp, ... }] }
 */

import { draftBelongsToResident } from '../lib/lease-draft-resident-access.js'

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
const BASE_ID = process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const BASE_URL = `https://api.airtable.com/v0/${BASE_ID}`

function atHeaders() {
  return { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' }
}

function escapeFormulaValue(value) {
  return String(value).replace(/"/g, '\\"')
}

async function atGet(url) {
  const res = await fetch(url, { headers: atHeaders() })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(t.slice(0, 400))
  }
  return res.json()
}

function mapRecord(record) {
  return { id: record.id, ...record.fields, created_at: record.createdTime }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!AIRTABLE_TOKEN) return res.status(500).json({ error: 'Server not configured.' })

  const { leaseDraftId, residentRecordId, residentEmail } = req.body || {}
  const id = String(leaseDraftId || '').trim()
  const rid = String(residentRecordId || '').trim()
  const email = String(residentEmail || '').trim().toLowerCase()

  if (!id.startsWith('rec')) return res.status(400).json({ error: 'leaseDraftId is required.' })
  if (!rid.startsWith('rec') || !email) {
    return res.status(400).json({ error: 'residentRecordId and residentEmail are required.' })
  }

  try {
    const currentDraft = await atGet(`${BASE_URL}/${encodeURIComponent('Lease Drafts')}/${id}`)
    const fields = currentDraft.fields || {}
    const draftRow = { id: currentDraft.id, ...fields }
    if (!draftBelongsToResident(draftRow, rid, email)) {
      return res.status(403).json({ error: 'Access denied.' })
    }

    const all = []
    let offset = null
    do {
      const u = new URL(`${BASE_URL}/${encodeURIComponent('Lease Comments')}`)
      u.searchParams.set('filterByFormula', `{Lease Draft ID} = "${escapeFormulaValue(id)}"`)
      u.searchParams.set('sort[0][field]', 'Timestamp')
      u.searchParams.set('sort[0][direction]', 'asc')
      if (offset) u.searchParams.set('offset', offset)
      const data = await atGet(u.toString())
      for (const r of data.records || []) all.push(mapRecord(r))
      offset = data.offset || null
    } while (offset)

    return res.status(200).json({ comments: all })
  } catch (err) {
    console.error('[lease-resident-list-comments]', err)
    return res.status(500).json({ error: err.message || 'Failed to load comments.' })
  }
}

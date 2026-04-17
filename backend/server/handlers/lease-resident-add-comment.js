/**
 * POST /api/portal?action=lease-resident-add-comment
 *
 * Body: leaseDraftId, residentRecordId, residentEmail, message, authorName? (optional display name)
 * NO_AUTH — proves access via resident id + email against the lease draft row.
 */

import { draftBelongsToResident, draftBelongsToResidentSupabaseRow } from '../lib/lease-draft-resident-access.js'
import { getSupabaseServiceClient } from '../lib/app-users-service.js'
import {
  appendLeaseCommentJsonb,
  fetchLeaseDraftJoined,
  isLeaseDraftUuid,
  saveLeaseDraftComments,
  updateLeaseDraftById,
} from '../lib/lease-drafts-service.js'
import { mapLeaseDraftRowToLegacyRecord } from '../../../shared/lease-draft-legacy-map.js'

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
const BASE_ID = process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const BASE_URL = `https://api.airtable.com/v0/${BASE_ID}`

function atHeaders() {
  return { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' }
}

async function atGet(url) {
  const res = await fetch(url, { headers: atHeaders() })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(t.slice(0, 400))
  }
  return res.json()
}

async function atPost(table, fields) {
  const res = await fetch(`${BASE_URL}/${encodeURIComponent(table)}`, {
    method: 'POST',
    headers: atHeaders(),
    body: JSON.stringify({ fields, typecast: true }),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(t.slice(0, 400))
  }
  return res.json()
}

async function atPatch(table, recordId, fields) {
  const res = await fetch(`${BASE_URL}/${encodeURIComponent(table)}/${recordId}`, {
    method: 'PATCH',
    headers: atHeaders(),
    body: JSON.stringify({ fields, typecast: true }),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(t.slice(0, 400))
  }
  return res.json()
}

async function notifyManagerResidentComment({ leaseDraftId, authorName, leaseDraftFields }) {
  const ownerId = String(leaseDraftFields?.['Owner ID'] || '').trim()
  if (!ownerId) return
  try {
    await atPost('Lease Notifications', {
      'Recipient Record ID': ownerId,
      'Recipient Role': 'manager',
      'Lease Draft ID': leaseDraftId,
      'Message': `${authorName} (Resident) commented on their lease`,
      'Action Type': 'comment-added',
      'Is Read': false,
      'Created At': new Date().toISOString(),
    })
  } catch (err) {
    console.warn('[lease-resident-add-comment] notify non-fatal:', err.message)
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const {
    leaseDraftId,
    residentRecordId,
    residentEmail,
    message,
    authorName: authorNameBody,
    alsoSetStatus,
  } = req.body || {}

  const id = String(leaseDraftId || '').trim()
  const rid = String(residentRecordId || '').trim()
  const email = String(residentEmail || '').trim().toLowerCase()
  const text = String(message || '').trim()
  const authorName = String(authorNameBody || '').trim() || 'Resident'

  if (!id) return res.status(400).json({ error: 'leaseDraftId is required.' })
  if (!text) return res.status(400).json({ error: 'message is required.' })

  if (isLeaseDraftUuid(id)) {
    if (!email) return res.status(400).json({ error: 'residentEmail is required.' })
    const client = getSupabaseServiceClient()
    if (!client) return res.status(500).json({ error: 'Supabase is not configured on the server.' })
    try {
      const row = await fetchLeaseDraftJoined(client, id)
      if (!row) return res.status(404).json({ error: 'Lease draft not found.' })
      if (!draftBelongsToResidentSupabaseRow(row, email)) {
        return res.status(403).json({ error: 'Access denied.' })
      }
      const nextComments = appendLeaseCommentJsonb(row.lease_comments, {
        authorName,
        authorRole: 'Resident',
        authorRecordId: rid || '',
        message: text,
      })
      await saveLeaseDraftComments(client, id, nextComments)
      const statusExtra = String(alsoSetStatus || '').trim()
      if (statusExtra === 'Changes Needed') {
        await updateLeaseDraftById(client, id, { status: 'Changes Needed' })
      }
      const legacy = mapLeaseDraftRowToLegacyRecord(row)
      await notifyManagerResidentComment({
        leaseDraftId: id,
        authorName,
        leaseDraftFields: legacy,
      })
      return res.status(200).json({ ok: true })
    } catch (err) {
      console.error('[lease-resident-add-comment] supabase', err)
      return res.status(500).json({ error: err.message || 'Failed to add comment.' })
    }
  }

  if (!AIRTABLE_TOKEN) return res.status(500).json({ error: 'Server not configured.' })

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

    await atPost('Lease Comments', {
      'Lease Draft ID': id,
      'Author Name': authorName,
      'Author Role': 'Resident',
      'Author Record ID': rid,
      'Message': text,
      'Timestamp': new Date().toISOString(),
    })

    await notifyManagerResidentComment({
      leaseDraftId: id,
      authorName,
      leaseDraftFields: fields,
    })

    await atPatch('Lease Drafts', id, {
      'Updated At': new Date().toISOString(),
    }).catch(() => {})

    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('[lease-resident-add-comment]', err)
    return res.status(500).json({ error: err.message || 'Failed to add comment.' })
  }
}

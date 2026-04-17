/**
 * POST /api/portal?action=lease-add-comment
 *
 * Adds a comment to a lease's thread. Both managers and admins can call this.
 *
 * Body:
 *   leaseDraftId   – Airtable record ID of the Lease Drafts row
 *   authorName     – display name of the commenter
 *   authorRole     – "Manager" | "Admin"
 *   authorRecordId – Airtable record ID of the author
 *   message        – comment body text
 */

import { getSupabaseServiceClient } from '../lib/app-users-service.js'
import {
  appendLeaseCommentJsonb,
  assertTenantCanWriteLeaseDraft,
  fetchLeaseDraftJoined,
  isLeaseDraftUuid,
  saveLeaseDraftComments,
} from '../lib/lease-drafts-service.js'

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

async function atPost(table, fields) {
  const res = await fetch(`${BASE_URL}/${encodeURIComponent(table)}`, {
    method: 'POST',
    headers: atHeaders(),
    body: JSON.stringify({ fields, typecast: true }),
  })
  if (!res.ok) { const t = await res.text(); throw new Error(t) }
  return res.json()
}

/**
 * Fan out a light notification to the other party when a comment is posted.
 * Fails silently — comment must still succeed even if notification breaks.
 */
async function notifyOtherParty({ leaseDraftId, authorRole, authorName, leaseDraftFields }) {
  try {
    const ownerId = leaseDraftFields?.['Owner ID']

    if (authorRole === 'Manager') {
      // Manager comment → notify all enabled admins
      const url = new URL(`${BASE_URL}/${encodeURIComponent('Admin Profile')}`)
      url.searchParams.set('filterByFormula', '{Enabled}')
      url.searchParams.set('fields[]', 'Email')
      const data = await atGet(url.toString())
      for (const r of (data.records || [])) {
        try {
          await atPost('Lease Notifications', {
            'Recipient Record ID': r.id,
            'Recipient Role': 'admin',
            'Lease Draft ID': leaseDraftId,
            'Message': `${authorName} (Manager) commented on a lease`,
            'Action Type': 'comment-added',
            'Is Read': false,
            'Created At': new Date().toISOString(),
          })
        } catch {}
      }
    } else if (authorRole === 'Admin') {
      // Admin comment → notify the manager
      if (ownerId) {
        await atPost('Lease Notifications', {
          'Recipient Record ID': ownerId,
          'Recipient Role': 'manager',
          'Lease Draft ID': leaseDraftId,
          'Message': `${authorName} (Admin) commented on your lease`,
          'Action Type': 'comment-added',
          'Is Read': false,
          'Created At': new Date().toISOString(),
        })
      }
    } else if (authorRole === 'Resident') {
      // Resident comment → notify the manager
      if (ownerId) {
        await atPost('Lease Notifications', {
          'Recipient Record ID': ownerId,
          'Recipient Role': 'manager',
          'Lease Draft ID': leaseDraftId,
          'Message': `${authorName} (Resident) commented on their lease`,
          'Action Type': 'comment-added',
          'Is Read': false,
          'Created At': new Date().toISOString(),
        })
      }
    }
  } catch (err) {
    console.warn('[lease-add-comment] notify non-fatal:', err.message)
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
    authorName = 'Unknown',
    authorRole = 'Manager',
    authorRecordId,
    message,
  } = req.body || {}

  if (!leaseDraftId) return res.status(400).json({ error: 'leaseDraftId is required.' })
  if (!message || !String(message).trim()) return res.status(400).json({ error: 'message is required.' })

  if (isLeaseDraftUuid(leaseDraftId)) {
    const client = getSupabaseServiceClient()
    if (!client) return res.status(500).json({ error: 'Supabase is not configured on the server.' })
    const tenant = req._tenant
    try {
      const row = await fetchLeaseDraftJoined(client, leaseDraftId)
      if (!row) return res.status(404).json({ error: 'Lease draft not found.' })
      if (!tenant?.isAdmin) {
        assertTenantCanWriteLeaseDraft(tenant, row)
      }
      const nextComments = appendLeaseCommentJsonb(row.lease_comments, {
        authorName,
        authorRole,
        authorRecordId,
        message: String(message).trim(),
      })
      await saveLeaseDraftComments(client, leaseDraftId, nextComments)
      return res.status(200).json({ ok: true, id: nextComments[nextComments.length - 1]?.id || null })
    } catch (err) {
      const code = err.statusCode || 500
      console.error('[lease-add-comment] supabase', err)
      return res.status(code).json({ error: err.message || 'Failed to add comment.' })
    }
  }

  if (!AIRTABLE_TOKEN) return res.status(500).json({ error: 'Server not configured.' })

  try {
    const comment = await atPost('Lease Comments', {
      'Lease Draft ID': leaseDraftId,
      'Author Name': authorName,
      'Author Role': authorRole,
      'Author Record ID': authorRecordId || '',
      'Message': String(message).trim(),
      'Timestamp': new Date().toISOString(),
    })

    // Fetch draft fields for notification owner lookup (non-fatal)
    let draftFields = {}
    try {
      const draft = await atGet(`${BASE_URL}/${encodeURIComponent('Lease Drafts')}/${leaseDraftId}`)
      draftFields = draft.fields || {}
    } catch {}

    await notifyOtherParty({ leaseDraftId, authorRole, authorName, leaseDraftFields: draftFields })

    return res.status(200).json({ ok: true, id: comment.id })
  } catch (err) {
    console.error('[lease-add-comment]', err)
    return res.status(500).json({ error: err.message || 'Failed to add comment.' })
  }
}

/**
 * POST /api/portal?action=lease-manager-review
 *
 * Manager reviews the admin-updated lease and either approves it or
 * sends it back for further changes.
 *
 * Body:
 *   leaseDraftId    – Airtable record ID of the Lease Drafts row
 *   managerRecordId – caller's manager record ID
 *   managerName     – display name
 *   action          – "approve" | "request-changes"
 *   notes           – free-form text (required when action === "request-changes")
 */

import { getSupabaseServiceClient } from '../lib/app-users-service.js'
import {
  appendLeaseCommentJsonb,
  assertTenantCanWriteLeaseDraft,
  fetchLeaseDraftJoined,
  isLeaseDraftUuid,
  saveLeaseDraftComments,
  updateLeaseDraftById,
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

async function atPatch(table, recordId, fields) {
  const res = await fetch(`${BASE_URL}/${encodeURIComponent(table)}/${recordId}`, {
    method: 'PATCH',
    headers: atHeaders(),
    body: JSON.stringify({ fields, typecast: true }),
  })
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

async function logAudit({ leaseDraftId, actionType, performedBy, performedByRole, notes = '' }) {
  try {
    await atPost('Audit Log', {
      'Lease Draft ID': leaseDraftId,
      'Action Type': actionType,
      'Performed By': performedBy,
      'Performed By Role': performedByRole,
      'Timestamp': new Date().toISOString(),
      'Notes': notes,
    })
  } catch (err) {
    console.warn('[Audit Log] non-fatal:', err.message)
  }
}

async function addComment({ leaseDraftId, authorName, authorRole, authorRecordId, message }) {
  try {
    await atPost('Lease Comments', {
      'Lease Draft ID': leaseDraftId,
      'Author Name': authorName,
      'Author Role': authorRole,
      'Author Record ID': authorRecordId || '',
      'Message': message,
      'Timestamp': new Date().toISOString(),
    })
  } catch (err) {
    console.warn('[Lease Comments] non-fatal:', err.message)
  }
}

async function notifyAdmins({ leaseDraftId, message, actionType }) {
  try {
    const url = new URL(`${BASE_URL}/${encodeURIComponent('Admin Profile')}`)
    url.searchParams.set('filterByFormula', '{Enabled}')
    url.searchParams.set('fields[]', 'Email')
    url.searchParams.set('fields[]', 'Name')
    const data = await atGet(url.toString())
    const admins = (data.records || []).map(r => ({ id: r.id, ...r.fields }))
    for (const admin of admins) {
      try {
        await atPost('Lease Notifications', {
          'Recipient Record ID': admin.id,
          'Recipient Role': 'admin',
          'Lease Draft ID': leaseDraftId,
          'Message': message,
          'Action Type': actionType,
          'Is Read': false,
          'Created At': new Date().toISOString(),
        })
      } catch { /* non-fatal per admin */ }
    }
  } catch (err) {
    console.warn('[Lease Notifications] admin notify non-fatal:', err.message)
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
    managerRecordId,
    managerName = 'Manager',
    action,
    notes = '',
  } = req.body || {}

  if (!leaseDraftId) return res.status(400).json({ error: 'leaseDraftId is required.' })
  if (!action || !['approve', 'request-changes'].includes(action)) {
    return res.status(400).json({ error: 'action must be "approve" or "request-changes".' })
  }
  if (action === 'request-changes' && !notes.trim()) {
    return res.status(400).json({ error: 'notes are required when requesting changes.' })
  }

  if (isLeaseDraftUuid(leaseDraftId)) {
    const client = getSupabaseServiceClient()
    if (!client) return res.status(500).json({ error: 'Supabase is not configured on the server.' })
    const tenant = req._tenant
    try {
      const row = await fetchLeaseDraftJoined(client, leaseDraftId)
      if (!row) return res.status(404).json({ error: 'Lease draft not found.' })
      assertTenantCanWriteLeaseDraft(tenant, row)

      const newStatus = action === 'approve' ? 'Manager Approved' : 'Submitted to Admin'
      const patch = { status: newStatus }
      if (action === 'request-changes') {
        patch.manager_edit_notes = JSON.stringify({
          freeText: notes,
          submittedAt: new Date().toISOString(),
          submittedBy: managerName,
          isFollowUp: true,
        })
      }
      await updateLeaseDraftById(client, leaseDraftId, patch)

      const fresh = await fetchLeaseDraftJoined(client, leaseDraftId)
      const commentMessage =
        action === 'approve'
          ? `**Manager Approved** ✓\n\nLease approved and ready for admin finalization.\n${notes ? `\nNotes: ${notes}` : ''}`
          : `**More Changes Requested**\n\n${notes}`

      const nextComments = appendLeaseCommentJsonb(fresh.lease_comments, {
        authorName: managerName,
        authorRole: 'Manager',
        authorRecordId: managerRecordId || '',
        message: commentMessage,
      })
      await saveLeaseDraftComments(client, leaseDraftId, nextComments)

      return res.status(200).json({ ok: true, newStatus })
    } catch (err) {
      const code = err.statusCode || 500
      console.error('[lease-manager-review] supabase', err)
      return res.status(code).json({ error: err.message || 'Failed to submit review.' })
    }
  }

  if (!AIRTABLE_TOKEN) return res.status(500).json({ error: 'Server not configured.' })

  try {
    const newStatus = action === 'approve' ? 'Manager Approved' : 'Submitted to Admin'

    const draftUpdate = { 'Status': newStatus }

    // When requesting changes, store the new notes too
    if (action === 'request-changes') {
      const payload = {
        freeText: notes,
        submittedAt: new Date().toISOString(),
        submittedBy: managerName,
        isFollowUp: true,
      }
      draftUpdate['Manager Edit Notes'] = JSON.stringify(payload)
    }

    await atPatch('Lease Drafts', leaseDraftId, draftUpdate)

    const commentMessage = action === 'approve'
      ? `**Manager Approved** ✓\n\nLease approved and ready for admin finalization.\n${notes ? `\nNotes: ${notes}` : ''}`
      : `**More Changes Requested**\n\n${notes}`

    await addComment({
      leaseDraftId,
      authorName: managerName,
      authorRole: 'Manager',
      authorRecordId: managerRecordId || '',
      message: commentMessage,
    })

    const notificationMsg = action === 'approve'
      ? `${managerName} approved the lease — ready to finalize`
      : `${managerName} requested further changes to the lease`

    await notifyAdmins({
      leaseDraftId,
      message: notificationMsg,
      actionType: action === 'approve' ? 'manager-approved' : 'manager-requested-changes',
    })

    await logAudit({
      leaseDraftId,
      actionType: action === 'approve' ? 'Manager Approved Lease' : 'Manager Requested More Changes',
      performedBy: managerName,
      performedByRole: 'Manager',
      notes: notes.slice(0, 500),
    })

    return res.status(200).json({ ok: true, newStatus })
  } catch (err) {
    console.error('[lease-manager-review]', err)
    return res.status(500).json({ error: err.message || 'Failed to submit review.' })
  }
}

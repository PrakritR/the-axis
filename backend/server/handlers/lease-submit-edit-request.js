/**
 * POST /api/portal?action=lease-submit-edit-request
 *
 * Manager submits an edit request for a lease draft.
 * - Updates Lease Drafts status → "Submitted to Admin"
 * - Stores manager's notes in "Manager Edit Notes"
 * - Creates a Lease Comments record
 * - Creates Lease Notifications for all enabled admins
 * - Logs to Audit Log
 *
 * Body:
 *   leaseDraftId    – Airtable record ID of the Lease Drafts row
 *   managerRecordId – caller's manager record ID (for notification ownership)
 *   managerName     – display name
 *   editNotes       – free-form text describing requested changes
 *   requestedFields – optional structured field overrides
 *     { tenantName, property, room, leaseStart, leaseEnd,
 *       rent, deposit, utilities, specialTerms }
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
    editNotes = '',
    requestedFields = {},
  } = req.body || {}

  if (!leaseDraftId) return res.status(400).json({ error: 'leaseDraftId is required.' })

  if (isLeaseDraftUuid(leaseDraftId)) {
    const client = getSupabaseServiceClient()
    if (!client) return res.status(500).json({ error: 'Supabase is not configured on the server.' })
    const tenant = req._tenant
    try {
      const row = await fetchLeaseDraftJoined(client, leaseDraftId)
      if (!row) return res.status(404).json({ error: 'Lease draft not found.' })
      assertTenantCanWriteLeaseDraft(tenant, row)

      const notesPayload = {
        freeText: editNotes,
        requestedFields,
        submittedAt: new Date().toISOString(),
        submittedBy: managerName,
      }

      const draftUpdate = {
        status: 'Submitted to Admin',
        manager_edit_notes: JSON.stringify(notesPayload),
      }
      if (requestedFields.tenantName) {
        const lj = row.lease_json && typeof row.lease_json === 'object' ? { ...row.lease_json } : {}
        lj.tenantName = requestedFields.tenantName
        draftUpdate.lease_json = lj
      }
      if (requestedFields.property) {
        const lj = draftUpdate.lease_json || (row.lease_json && typeof row.lease_json === 'object' ? { ...row.lease_json } : {})
        lj.propertyName = requestedFields.property
        draftUpdate.lease_json = lj
      }
      if (requestedFields.room) {
        const lj = draftUpdate.lease_json || (row.lease_json && typeof row.lease_json === 'object' ? { ...row.lease_json } : {})
        lj.roomNumber = requestedFields.room
        draftUpdate.lease_json = lj
      }

      await updateLeaseDraftById(client, leaseDraftId, draftUpdate)

      const fieldLines = []
      if (requestedFields.tenantName) fieldLines.push(`• Tenant Name: ${requestedFields.tenantName}`)
      if (requestedFields.property) fieldLines.push(`• Property: ${requestedFields.property}`)
      if (requestedFields.room) fieldLines.push(`• Room: ${requestedFields.room}`)
      if (requestedFields.leaseStart) fieldLines.push(`• Lease Start: ${requestedFields.leaseStart}`)
      if (requestedFields.leaseEnd) fieldLines.push(`• Lease End: ${requestedFields.leaseEnd}`)
      if (requestedFields.rent) fieldLines.push(`• Monthly Rent: $${requestedFields.rent}`)
      if (requestedFields.deposit) fieldLines.push(`• Deposit: $${requestedFields.deposit}`)
      if (requestedFields.utilities) fieldLines.push(`• Utilities: $${requestedFields.utilities}`)
      if (requestedFields.specialTerms) fieldLines.push(`• Special Terms: ${requestedFields.specialTerms}`)

      let commentMessage = `**Edit Request Submitted**\n\n${editNotes}`
      if (fieldLines.length > 0) {
        commentMessage += '\n\n**Requested field changes:**\n' + fieldLines.join('\n')
      }

      const nextComments = appendLeaseCommentJsonb(row.lease_comments, {
        authorName: managerName,
        authorRole: 'Manager',
        authorRecordId: managerRecordId || '',
        message: commentMessage,
      })
      await saveLeaseDraftComments(client, leaseDraftId, nextComments)

      return res.status(200).json({ ok: true })
    } catch (err) {
      const code = err.statusCode || 500
      console.error('[lease-submit-edit-request] supabase', err)
      return res.status(code).json({ error: err.message || 'Failed to submit edit request.' })
    }
  }

  if (!AIRTABLE_TOKEN) return res.status(500).json({ error: 'Server not configured.' })

  try {
    // Build the raw JSON snapshot of requested fields so admin can read it clearly
    const notesPayload = {
      freeText: editNotes,
      requestedFields,
      submittedAt: new Date().toISOString(),
      submittedBy: managerName,
    }

    // Update Lease Drafts record
    const draftUpdate = {
      'Status': 'Submitted to Admin',
      'Manager Edit Notes': JSON.stringify(notesPayload),
    }
    // Propagate structural fields when provided
    if (requestedFields.tenantName) draftUpdate['Resident Name'] = requestedFields.tenantName
    if (requestedFields.property)   draftUpdate['Property']       = requestedFields.property
    if (requestedFields.room)       draftUpdate['Unit']           = requestedFields.room

    await atPatch('Lease Drafts', leaseDraftId, draftUpdate)

    // Build a readable comment body
    const fieldLines = []
    if (requestedFields.tenantName)   fieldLines.push(`• Tenant Name: ${requestedFields.tenantName}`)
    if (requestedFields.property)     fieldLines.push(`• Property: ${requestedFields.property}`)
    if (requestedFields.room)         fieldLines.push(`• Room: ${requestedFields.room}`)
    if (requestedFields.leaseStart)   fieldLines.push(`• Lease Start: ${requestedFields.leaseStart}`)
    if (requestedFields.leaseEnd)     fieldLines.push(`• Lease End: ${requestedFields.leaseEnd}`)
    if (requestedFields.rent)         fieldLines.push(`• Monthly Rent: $${requestedFields.rent}`)
    if (requestedFields.deposit)      fieldLines.push(`• Deposit: $${requestedFields.deposit}`)
    if (requestedFields.utilities)    fieldLines.push(`• Utilities: $${requestedFields.utilities}`)
    if (requestedFields.specialTerms) fieldLines.push(`• Special Terms: ${requestedFields.specialTerms}`)

    let commentMessage = `**Edit Request Submitted**\n\n${editNotes}`
    if (fieldLines.length > 0) {
      commentMessage += '\n\n**Requested field changes:**\n' + fieldLines.join('\n')
    }

    await addComment({
      leaseDraftId,
      authorName: managerName,
      authorRole: 'Manager',
      authorRecordId: managerRecordId || '',
      message: commentMessage,
    })

    await notifyAdmins({
      leaseDraftId,
      message: `${managerName} submitted a lease edit request`,
      actionType: 'edit-request-submitted',
    })

    await logAudit({
      leaseDraftId,
      actionType: 'Manager Submitted Edit Request',
      performedBy: managerName,
      performedByRole: 'Manager',
      notes: editNotes.slice(0, 500),
    })

    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('[lease-submit-edit-request]', err)
    return res.status(500).json({ error: err.message || 'Failed to submit edit request.' })
  }
}

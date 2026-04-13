/**
 * POST /api/portal?action=lease-admin-respond
 *
 * Admin reviews manager's edit request, updates lease terms, optionally registers
 * a new PDF version, and changes the workflow status.
 *
 * Body:
 *   leaseDraftId    – Airtable record ID of the Lease Drafts row
 *   adminRecordId   – caller's admin record ID
 *   adminName       – display name
 *   newStatus       – one of: "Admin In Review" | "Sent Back to Manager" |
 *                     "Manager Approved" | "Ready for Signature" | "Changes Made"
 *   adminNotes      – notes from admin explaining what was changed
 *   updatedFields   – optional: { residentName, property, unit, leaseStart,
 *                     leaseEnd, rent, deposit, utilityFee, specialTerms }
 *   newVersion      – optional: { pdfUrl, fileName, notes }
 *                     When provided a Lease Versions record is created and
 *                     Current Version on the draft is incremented.
 */

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
const BASE_ID = process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const BASE_URL = `https://api.airtable.com/v0/${BASE_ID}`

const VALID_STATUSES = new Set([
  'Admin In Review',
  'Sent Back to Manager',
  'Manager Approved',
  'Ready for Signature',
  'Changes Made',
])

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

async function notifyManager({ managerOwnerId, leaseDraftId, message, actionType }) {
  if (!managerOwnerId) return
  try {
    await atPost('Lease Notifications', {
      'Recipient Record ID': managerOwnerId,
      'Recipient Role': 'manager',
      'Lease Draft ID': leaseDraftId,
      'Message': message,
      'Action Type': actionType,
      'Is Read': false,
      'Created At': new Date().toISOString(),
    })
  } catch (err) {
    console.warn('[Lease Notifications] manager notify non-fatal:', err.message)
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (!AIRTABLE_TOKEN) return res.status(500).json({ error: 'Server not configured.' })

  const {
    leaseDraftId,
    adminRecordId,
    adminName = 'Admin',
    newStatus,
    adminNotes = '',
    updatedFields = {},
    newVersion,
  } = req.body || {}

  if (!leaseDraftId) return res.status(400).json({ error: 'leaseDraftId is required.' })
  if (newStatus && !VALID_STATUSES.has(newStatus)) {
    return res.status(400).json({ error: `Invalid status: ${newStatus}` })
  }

  try {
    // Fetch the current draft to get Lease JSON and Owner ID for notification
    const currentDraft = await atGet(`${BASE_URL}/${encodeURIComponent('Lease Drafts')}/${leaseDraftId}`)
    const currentFields = currentDraft.fields || {}
    const ownerIdForNotification = currentFields['Owner ID'] || ''

    // Merge updated fields into Lease JSON when structured lease data is provided
    let updatedLeaseJson = null
    if (Object.keys(updatedFields).length > 0) {
      try {
        const existingJson = currentFields['Lease JSON']
          ? JSON.parse(currentFields['Lease JSON'])
          : {}
        const merged = { ...existingJson }
        if (updatedFields.residentName)  merged.tenantName       = updatedFields.residentName
        if (updatedFields.property)      merged.propertyName     = updatedFields.property
        if (updatedFields.unit)          merged.roomNumber       = updatedFields.unit
        if (updatedFields.leaseStart)    merged.leaseStart       = updatedFields.leaseStart
        if (updatedFields.leaseEnd)      merged.leaseEnd         = updatedFields.leaseEnd
        if (updatedFields.rent)          merged.monthlyRent      = Number(updatedFields.rent)
        if (updatedFields.deposit)       merged.securityDeposit  = Number(updatedFields.deposit)
        if (updatedFields.utilityFee)    merged.utilityFee       = Number(updatedFields.utilityFee)
        if (updatedFields.specialTerms)  merged.specialTerms     = updatedFields.specialTerms
        updatedLeaseJson = JSON.stringify(merged)
      } catch {
        // Non-fatal — proceed without updating Lease JSON
      }
    }

    // Handle version creation if new PDF version is provided
    let newVersionNumber = null
    if (newVersion?.pdfUrl || newVersion?.fileName) {
      const currentVersion = Number(currentFields['Current Version'] || 1)
      newVersionNumber = currentVersion + 1

      // Mark all prior versions as not current
      try {
        const versionsUrl = new URL(`${BASE_URL}/${encodeURIComponent('Lease Versions')}`)
        versionsUrl.searchParams.set('filterByFormula', `{Lease Draft ID} = "${leaseDraftId}"`)
        versionsUrl.searchParams.set('fields[]', 'Is Current')
        const vData = await atGet(versionsUrl.toString())
        for (const vr of (vData.records || [])) {
          if (vr.fields?.['Is Current']) {
            await atPatch('Lease Versions', vr.id, { 'Is Current': false }).catch(() => {})
          }
        }
      } catch { /* non-fatal */ }

      // Build fields snapshot for this version
      const leaseDataForSnapshot = currentFields['Lease JSON']
        ? (() => { try { return JSON.parse(currentFields['Lease JSON']) } catch { return {} } })()
        : {}
      if (updatedLeaseJson) {
        try { Object.assign(leaseDataForSnapshot, JSON.parse(updatedLeaseJson)) } catch {}
      }

      await atPost('Lease Versions', {
        'Lease Draft ID': leaseDraftId,
        'Version Number': newVersionNumber,
        'PDF URL': newVersion.pdfUrl || '',
        'File Name': newVersion.fileName || `lease-v${newVersionNumber}.pdf`,
        'Uploader Name': adminName,
        'Uploader Role': 'Admin',
        'Upload Date': new Date().toISOString(),
        'Notes': newVersion.notes || adminNotes,
        'Fields Snapshot': JSON.stringify(leaseDataForSnapshot),
        'Is Current': true,
      })
    }

    // Persist admin response notes as JSON
    const adminResponsePayload = {
      freeText: adminNotes,
      updatedFields,
      respondedAt: new Date().toISOString(),
      respondedBy: adminName,
    }

    // Build the draft update
    const draftUpdate = {
      'Admin Response Notes': JSON.stringify(adminResponsePayload),
    }
    if (newStatus) draftUpdate['Status'] = newStatus
    if (newVersionNumber) draftUpdate['Current Version'] = newVersionNumber
    if (updatedLeaseJson) draftUpdate['Lease JSON'] = updatedLeaseJson
    if (updatedFields.residentName) draftUpdate['Resident Name'] = updatedFields.residentName
    if (updatedFields.property)     draftUpdate['Property']       = updatedFields.property
    if (updatedFields.unit)         draftUpdate['Unit']           = updatedFields.unit

    await atPatch('Lease Drafts', leaseDraftId, draftUpdate)

    // Build readable comment
    const changeLines = []
    if (updatedFields.residentName)  changeLines.push(`• Resident Name: ${updatedFields.residentName}`)
    if (updatedFields.property)      changeLines.push(`• Property: ${updatedFields.property}`)
    if (updatedFields.unit)          changeLines.push(`• Unit: ${updatedFields.unit}`)
    if (updatedFields.leaseStart)    changeLines.push(`• Lease Start: ${updatedFields.leaseStart}`)
    if (updatedFields.leaseEnd)      changeLines.push(`• Lease End: ${updatedFields.leaseEnd}`)
    if (updatedFields.rent)          changeLines.push(`• Monthly Rent: $${updatedFields.rent}`)
    if (updatedFields.deposit)       changeLines.push(`• Deposit: $${updatedFields.deposit}`)
    if (updatedFields.utilityFee)    changeLines.push(`• Utility Fee: $${updatedFields.utilityFee}`)
    if (updatedFields.specialTerms)  changeLines.push(`• Special Terms: ${updatedFields.specialTerms}`)

    let commentMessage = `**Admin Update** — Status set to: ${newStatus || 'unchanged'}\n\n${adminNotes}`
    if (changeLines.length > 0) {
      commentMessage += '\n\n**Fields updated:**\n' + changeLines.join('\n')
    }
    if (newVersionNumber) {
      commentMessage += `\n\n**New lease version uploaded:** v${newVersionNumber} — ${newVersion?.fileName || 'lease.pdf'}`
    }

    await addComment({
      leaseDraftId,
      authorName: adminName,
      authorRole: 'Admin',
      authorRecordId: adminRecordId || '',
      message: commentMessage,
    })

    const notificationMsg = newStatus === 'Sent Back to Manager'
      ? `Admin sent updated lease — please review and approve or request further changes`
      : `Admin updated lease status to: ${newStatus}`

    await notifyManager({
      managerOwnerId: ownerIdForNotification,
      leaseDraftId,
      message: notificationMsg,
      actionType: 'admin-responded',
    })

    await logAudit({
      leaseDraftId,
      actionType: `Admin: ${newStatus || 'Updated Lease'}`,
      performedBy: adminName,
      performedByRole: 'Admin',
      notes: adminNotes.slice(0, 500),
    })

    return res.status(200).json({ ok: true, newVersionNumber })
  } catch (err) {
    console.error('[lease-admin-respond]', err)
    return res.status(500).json({ error: err.message || 'Failed to respond to lease request.' })
  }
}

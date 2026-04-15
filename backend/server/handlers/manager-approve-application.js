import { generateLeaseFromTemplate } from './generate-lease-from-template.js'
import { resolveManagerTenant, canEnforceTenant } from '../middleware/resolveManagerTenant.js'
import { listResidentsMatchingApplication, markMatchingResidentsApproved } from '../lib/application-resident-sync.js'
import { createApprovedApplicationFeePayments } from '../lib/approved-application-fee-payment.js'
import { createApprovedApplicationMoveInPayments } from '../lib/approved-application-movein-payments.js'
import {
  applicationStatusLooksPipelinePending,
  deriveApplicationLeaseGateState,
  isApplicationApprovedForLease,
} from '../lib/application-approval-lease-guard.js'
import {
  DEFAULT_AXIS_APPLICATION_APPROVED_ROOM,
  applicationLeaseRoomNumber,
  normalizeApplicationOccupancyKey,
} from '../../../shared/application-airtable-fields.js'

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
/** Prefer explicit apps base; otherwise same base as Lease Drafts / portal (manager list uses CORE base). */
const CORE_BASE_ID =
  process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const APPS_BASE_ID =
  process.env.VITE_AIRTABLE_APPLICATIONS_BASE_ID ||
  process.env.AIRTABLE_APPLICATIONS_BASE_ID ||
  CORE_BASE_ID
const APPS_AIRTABLE_BASE_URL = `https://api.airtable.com/v0/${APPS_BASE_ID}`
const APPLICATIONS_TABLE =
  process.env.VITE_AIRTABLE_APPLICATIONS_TABLE ||
  process.env.AIRTABLE_APPLICATIONS_TABLE ||
  'Applications'

function airtableHeaders() {
  return {
    Authorization: `Bearer ${AIRTABLE_TOKEN}`,
    'Content-Type': 'application/json',
  }
}

function mapRecord(record) {
  return { id: record.id, ...record.fields, created_at: record.createdTime }
}

async function airtableGet(url) {
  const res = await fetch(url, { headers: airtableHeaders() })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text)
  }
  return res.json()
}

async function airtablePatch(url, fields) {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: airtableHeaders(),
    body: JSON.stringify({ fields, typecast: true }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text)
  }
  return res.json()
}

/** Airtable API error body often JSON with error.type UNKNOWN_FIELD_NAME. */
function unknownFieldNameFromPatchError(message) {
  const raw = String(message || '')
  try {
    const j = JSON.parse(raw)
    const m = j?.error?.message
    if (typeof m === 'string') {
      const match = m.match(/Unknown field name:\s*"([^"]+)"/i)
      return match ? match[1] : null
    }
  } catch {
    /* not JSON */
  }
  const match = raw.match(/Unknown field name:\s*"([^"]+)"/i)
  return match ? match[1] : null
}

/**
 * Column names to try when writing manager-assigned unit (bases differ: Approved Unit Room vs Approved Room).
 * Env wins; then repo default; then legacy name.
 */
function approvedRoomWriteFieldCandidates() {
  const fromEnv = String(
    process.env.VITE_AIRTABLE_APPLICATION_APPROVED_ROOM_FIELD ||
      process.env.AIRTABLE_APPLICATION_APPROVED_ROOM_FIELD ||
      '',
  ).trim()
  const ordered = [fromEnv, DEFAULT_AXIS_APPLICATION_APPROVED_ROOM, 'Approved Room'].filter(Boolean)
  return [...new Set(ordered)]
}

function normalizeRecordId(raw) {
  const value = String(raw || '').trim()
  if (!value) return ''
  return value.startsWith('APP-') ? value.slice(4) : value
}

function escapeFormulaValue(value) {
  return String(value).replace(/"/g, '\\"')
}

/** Unit shown on an already-approved row (assigned column, else 1st choice). */
function effectiveUnitForOccupancyConflict(app) {
  const u = String(applicationLeaseRoomNumber(app, DEFAULT_AXIS_APPLICATION_APPROVED_ROOM) || '').trim()
  if (u) return u
  return String(app?.['Room Number'] ?? '').trim()
}

async function listApplicationsForOwner(ownerId) {
  const id = String(ownerId || '').trim()
  if (!id.startsWith('rec')) return []
  const enc = encodeURIComponent(APPLICATIONS_TABLE)
  const root = `${APPS_AIRTABLE_BASE_URL}/${enc}`
  const all = []
  let offset = null
  do {
    const url = new URL(root)
    url.searchParams.set('filterByFormula', `{Owner ID} = "${escapeFormulaValue(id)}"`)
    if (offset) url.searchParams.set('offset', offset)
    const data = await airtableGet(url.toString())
    ;(data.records || []).forEach((r) => all.push(mapRecord(r)))
    offset = data.offset || null
  } while (offset)
  return all
}

async function getApplication(recordId) {
  const enc = encodeURIComponent(APPLICATIONS_TABLE)
  const data = await airtableGet(`${APPS_AIRTABLE_BASE_URL}/${enc}/${recordId}`)
  return mapRecord(data)
}

const APPLICATION_REJECTED_FIELD = String(
  process.env.VITE_AIRTABLE_APPLICATION_REJECTED_FIELD ||
    process.env.AIRTABLE_APPLICATION_REJECTED_FIELD ||
    'Rejected',
).trim() || 'Rejected'

async function approveApplication(recordId, existingFields, extraFields = {}) {
  const now = new Date().toISOString()
  const enc = encodeURIComponent(APPLICATIONS_TABLE)
  const fields = {
    Approved: true,
    'Approved At': now,
    [APPLICATION_REJECTED_FIELD]: null,
    ...extraFields,
  }
  // Clear stale "Pending" / pipeline labels so lease guards and UI stay aligned with Approved.
  if (existingFields && typeof existingFields === 'object') {
    if (Object.prototype.hasOwnProperty.call(existingFields, 'Application Status')) {
      const cur = String(existingFields['Application Status'] || '').trim().toLowerCase()
      if (!cur || applicationStatusLooksPipelinePending(cur)) {
        fields['Application Status'] = 'Approved'
      }
    }
    if (Object.prototype.hasOwnProperty.call(existingFields, 'Approval Status')) {
      const cur = String(existingFields['Approval Status'] || '').trim().toLowerCase()
      if (!cur || applicationStatusLooksPipelinePending(cur)) {
        fields['Approval Status'] = 'Approved'
      }
    }
  }
  const data = await airtablePatch(`${APPS_AIRTABLE_BASE_URL}/${enc}/${recordId}`, fields)
  return mapRecord(data)
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!AIRTABLE_TOKEN) {
    return res.status(500).json({ error: 'Data service is not configured on the server.' })
  }

  const recordId = normalizeRecordId(req.body?.applicationRecordId)
  const managerName = String(req.body?.managerName || 'Manager').trim()
  const managerRole = String(req.body?.managerRole || 'Manager').trim()

  if (!recordId) {
    return res.status(400).json({ error: 'applicationRecordId is required.' })
  }

  // Resolve tenant — optional (graceful degradation if managerRecordId not sent)
  let tenant = null
  try {
    tenant = await resolveManagerTenant(req)
  } catch (tenantErr) {
    return res.status(403).json({ error: tenantErr.message })
  }

  try {
    const existing = await getApplication(recordId)

    // Tenant guard — reject if the application belongs to a different owner
    if (canEnforceTenant(tenant, existing)) {
      return res.status(403).json({ error: 'Access denied: this application belongs to a different manager.' })
    }

    const approvedRoomRaw = String(req.body?.approvedRoom ?? '').trim()
    const fallbackFirstChoice = String(existing['Room Number'] ?? '').trim()
    /** Prefer explicit manager pick; if omitted, use applicant 1st choice so lease/resident stay aligned. */
    const approvedRoomToStore = approvedRoomRaw || fallbackFirstChoice

    /** Avoid duplicate fee/move-in rows when the manager re-hits approve on an already-approved application. */
    const applicationAlreadyFullyApproved =
      isApplicationApprovedForLease(existing) && (existing.Approved === true || existing.Approved === 1)

    let approvedApplication = existing
    if (!isApplicationApprovedForLease(existing) || existing.Approved !== true) {
      if (!approvedRoomToStore) {
        return res.status(400).json({
          error:
            'Assign an approved unit/room before approving (no first-choice room on file and none was sent in the request).',
        })
      }

      const ownerForList = String(tenant?.ownerId || existing['Owner ID'] || '').trim()
      const propKey = String(existing['Property Name'] ?? '').trim().toLowerCase()
      const candidateKey = normalizeApplicationOccupancyKey(approvedRoomToStore)
      if (ownerForList.startsWith('rec') && propKey && candidateKey) {
        const siblings = await listApplicationsForOwner(ownerForList)
        for (const o of siblings) {
          if (String(o.id) === String(recordId)) continue
          if (deriveApplicationLeaseGateState(o) !== 'approved') continue
          const op = String(o['Property Name'] ?? '').trim().toLowerCase()
          if (op !== propKey) continue
          const ou = normalizeApplicationOccupancyKey(effectiveUnitForOccupancyConflict(o))
          if (ou && ou === candidateKey) {
            return res.status(409).json({
              error:
                'Another application is already approved for this property and unit. Change the approved unit or reject the other application first.',
            })
          }
        }
      }

      const roomFields = approvedRoomWriteFieldCandidates()
      let lastApproveErr = null
      let wroteRoom = false
      for (const fieldName of roomFields) {
        const approvalExtras = { [fieldName]: approvedRoomToStore }
        try {
          approvedApplication = await approveApplication(recordId, existing, approvalExtras)
          wroteRoom = true
          break
        } catch (approveErr) {
          lastApproveErr = approveErr
          const unk = unknownFieldNameFromPatchError(approveErr?.message)
          if (unk === fieldName) continue
          throw approveErr
        }
      }
      if (!wroteRoom) {
        throw lastApproveErr || new Error('Could not write approved unit to the Applications table.')
      }
    }
    const ownerId = tenant?.ownerId || String(approvedApplication['Owner ID'] || '').trim()
    const residentSync = await markMatchingResidentsApproved(approvedApplication, ownerId)

    let feeResidentIds = Array.isArray(residentSync.updatedIds) ? [...residentSync.updatedIds] : []
    if (!feeResidentIds.length) {
      try {
        const rows = await listResidentsMatchingApplication(recordId, approvedApplication['Signer Email'])
        feeResidentIds = rows.map((r) => r.id).filter((id) => String(id || '').startsWith('rec'))
      } catch {
        feeResidentIds = []
      }
    }

    let applicationFeePayments = { createdIds: [], skipped: [] }
    let moveInPayments = { createdIds: [], skipped: [] }
    if (!applicationAlreadyFullyApproved) {
      try {
        applicationFeePayments = await createApprovedApplicationFeePayments({
          application: approvedApplication,
          residentRecordIds: feeResidentIds,
        })
      } catch (feeErr) {
        console.warn('[manager-approve-application] application fee payment rows:', feeErr?.message || feeErr)
      }

      try {
        moveInPayments = await createApprovedApplicationMoveInPayments({
          application: approvedApplication,
          residentRecordIds: feeResidentIds,
        })
      } catch (moveErr) {
        console.warn('[manager-approve-application] move-in payment rows:', moveErr?.message || moveErr)
      }
    }

    // Generate lease draft from template (no AI). Skips gracefully if it fails.
    let draft = null
    let created = false
    try {
      const result = await generateLeaseFromTemplate({
        applicationRecordId: recordId,
        generatedBy: managerName,
        ownerId,
        // Always rebuild from the application so each approval produces an up-to-date draft in Lease Drafts.
        forceRegenerate: true,
      })
      draft = result.draft
      created = result.created
    } catch (draftErr) {
      console.error('[manager-approve-application] Lease draft failed:', draftErr?.message || draftErr)
    }

    return res.status(200).json({
      application: approvedApplication,
      draft,
      createdLeaseDraft: created,
      residentRecordsUpdated: residentSync.updatedIds,
      applicationFeePaymentIds: applicationFeePayments.createdIds,
      applicationFeePaymentsSkipped: applicationFeePayments.skipped,
      moveInPaymentIds: moveInPayments.createdIds,
      moveInPaymentsSkipped: moveInPayments.skipped,
      message: created
        ? 'Application approved and lease draft generated.'
        : 'Application approved.',
    })
  } catch (err) {
    console.error('[manager-approve-application]', err)
    return res.status(500).json({
      error: err.message || 'Could not approve application.',
    })
  }
}

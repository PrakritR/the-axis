/**
 * POST /api/manager-approve-application
 *
 * Supabase-backed replacement for the old Airtable handler.
 * Delegates to /api/applications?id=<id>&action=approve via internal service calls.
 *
 * Body: { applicationRecordId: "<uuid or APP-<uuid>" }
 *
 * Legacy Airtable "rec"-prefixed record IDs are rejected with a 410 Gone response — those
 * applications must be re-submitted via the internal system.
 *
 * Authentication: Supabase Bearer JWT (manager or admin role required).
 */
import { authenticateAndLoadAppUser } from '../lib/request-auth.js'
import { appUserHasRole } from '../lib/app-user-roles-service.js'
import {
  getApplicationById,
  approveApplication,
} from '../lib/applications-service.js'
import { getPropertyById } from '../lib/properties-service.js'
import { createApprovalGeneratedPayments } from '../lib/approval-payments-service.js'
import { mapApplicationRowToLegacyRecord } from '../../../shared/application-legacy-map.js'

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

function normalizeId(raw) {
  const value = String(raw || '').trim()
  return value.startsWith('APP-') ? value.slice(4) : value
}

export default async function handler(req, res) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { ok, appUser } = await authenticateAndLoadAppUser(req, res)
  if (!ok) return

  const [isAdmin, isManager] = await Promise.all([
    appUserHasRole(appUser.id, 'admin'),
    appUserHasRole(appUser.id, 'manager'),
  ])
  if (!isAdmin && !isManager) {
    return res.status(403).json({ error: 'Admin or manager role required to approve applications.' })
  }

  const body = req.body && typeof req.body === 'object' ? req.body : {}
  const rawId = normalizeId(body.applicationRecordId || body.application_id || body.id || '')

  if (!rawId) {
    return res.status(400).json({ error: 'applicationRecordId (UUID) is required.' })
  }

  // Reject legacy Airtable rec* IDs
  if (rawId.startsWith('rec')) {
    return res.status(410).json({
      error: 'This application was created in the old system and cannot be approved here. Please use the internal portal (re-submit via the applications form) or approve directly via /api/applications?id=<uuid>&action=approve.',
    })
  }

  try {
    const existing = await getApplicationById(rawId)
    if (!existing) return res.status(404).json({ error: 'Application not found.' })

    // Manager scope guard
    if (!isAdmin) {
      const property = await getPropertyById(existing.property_id)
      if (property?.managed_by_app_user_id !== appUser.id) {
        return res.status(403).json({ error: 'Access denied: this application belongs to a different manager.' })
      }
    }

    const approved_unit_room = String(body.approvedRoom || body.approved_unit_room || '').trim() || undefined
    const updated = await approveApplication({ id: rawId, approved_unit_room })

    let approvalPayments = { created: [], skipped: [], payments: [] }
    try {
      approvalPayments = await createApprovalGeneratedPayments({ application: updated })
    } catch (payErr) {
      console.warn('[manager-approve-application] payment generation (non-fatal):', payErr?.message)
    }

    return res.status(200).json({
      ok: true,
      application: mapApplicationRowToLegacyRecord(updated),
      approvalPayments: {
        created: approvalPayments.created,
        skipped: approvalPayments.skipped,
      },
      message: 'Application approved.',
    })
  } catch (err) {
    console.error('[manager-approve-application]', err)
    return res.status(500).json({ error: err?.message || 'Could not approve application.' })
  }
}

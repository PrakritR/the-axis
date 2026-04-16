/**
 * GET /api/portal?action=resident-context
 *
 * Single bundle for the authenticated app user: internal applications, payments,
 * lease file metadata (per application), and a derived portal access hint.
 * Supabase JWT auth (same as my-applications / my-payments).
 *
 * Registered in portal-gateway NO_AUTH_ACTIONS — resolves auth here.
 */
import { authenticateAndLoadAppUser } from '../lib/request-auth.js'
import {
  listApplicationsForAppUser,
  APPLICATION_STATUS_APPROVED,
  APPLICATION_STATUS_REJECTED,
  APPLICATION_STATUS_CANCELLED,
} from '../lib/applications-service.js'
import { listPaymentsForAppUser } from '../lib/payments-service.js'
import { listLeaseFilesForApplicationIds } from '../lib/internal-file-metadata-service.js'

/**
 * @param {object[]} apps
 * @returns {'approved' | 'rejected' | 'pending' | null}
 */
function deriveInternalPortalAccessState(apps) {
  if (!Array.isArray(apps) || apps.length === 0) return null
  const hasApproved = apps.some(
    (a) =>
      a?.status === APPLICATION_STATUS_APPROVED ||
      a?.approved === true ||
      String(a?.status || '').trim().toLowerCase() === 'approved',
  )
  if (hasApproved) return 'approved'
  const stillOpen = apps.some((a) => {
    const st = String(a?.status || '').trim().toLowerCase()
    if (a?.rejected === true) return false
    return st !== APPLICATION_STATUS_REJECTED && st !== APPLICATION_STATUS_CANCELLED
  })
  if (stillOpen) return 'pending'
  return 'rejected'
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { ok, appUser } = await authenticateAndLoadAppUser(req, res)
  if (!ok) return

  try {
    const applications = await listApplicationsForAppUser({ appUserId: appUser.id })
    const payments = await listPaymentsForAppUser({ appUserId: appUser.id, limit: 300 })
    const appIds = applications.map((a) => a.id).filter(Boolean)
    let lease_files = []
    try {
      lease_files = await listLeaseFilesForApplicationIds(appIds)
    } catch (e) {
      console.warn('[portal-resident-context] lease_files list skipped:', e?.message || e)
      lease_files = []
    }

    const access_state = deriveInternalPortalAccessState(applications)
    const pending_payment_count = payments.filter((p) => String(p?.status || '').toLowerCase() === 'pending').length
    const outstanding_cents = payments
      .filter((p) => String(p?.status || '').toLowerCase() === 'pending')
      .reduce((sum, p) => {
        const bal = p.balance_cents
        if (bal != null && Number.isFinite(Number(bal))) return sum + Math.max(0, Number(bal))
        const amt = Number(p.amount_cents) || 0
        return sum + Math.max(0, amt)
      }, 0)

    return res.status(200).json({
      ok: true,
      app_user: {
        id: appUser.id,
        email: appUser.email,
        full_name: appUser.full_name || null,
      },
      applications,
      payments,
      lease_files,
      access_state,
      summary: {
        application_count: applications.length,
        pending_payment_count,
        outstanding_cents,
      },
    })
  } catch (err) {
    console.error('[portal-resident-context]', err)
    return res.status(500).json({ error: err?.message || 'Failed to load resident context.' })
  }
}

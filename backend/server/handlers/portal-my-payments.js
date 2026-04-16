/**
 * GET /api/portal?action=my-payments
 *
 * Returns the authenticated resident/applicant's internal payments.
 * Uses Supabase JWT auth (not manager session).
 * Registered in NO_AUTH_ACTIONS because auth is handled here.
 *
 * Query params:
 *   status        — optional filter (pending | completed | failed | refunded | cancelled)
 *   payment_type  — optional filter (rent | application_fee | security_deposit | utilities | ...)
 *   application_id — optional filter to a specific application's payments
 */
import { authenticateAndLoadAppUser } from '../lib/request-auth.js'
import { listPaymentsForAppUser } from '../lib/payments-service.js'
import { listPaymentsForApplication } from '../lib/approval-payments-service.js'
import { getApplicationById } from '../lib/applications-service.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { ok, appUser } = await authenticateAndLoadAppUser(req, res)
  if (!ok) return

  try {
    const statusFilter      = String(req.query?.status       || '').trim() || undefined
    const paymentTypeFilter = String(req.query?.payment_type || '').trim() || undefined
    const applicationId     = String(req.query?.application_id || '').trim() || null

    if (applicationId) {
      // Verify the application belongs to the caller
      const application = await getApplicationById(applicationId)
      if (!application) return res.status(404).json({ error: 'Application not found.' })
      if (application.applicant_app_user_id !== appUser.id) {
        return res.status(403).json({ error: 'Access denied.' })
      }
      const payments = await listPaymentsForApplication({ applicationId, status: statusFilter })
      return res.status(200).json({ ok: true, payments })
    }

    const payments = await listPaymentsForAppUser({
      appUserId: appUser.id,
      status: statusFilter,
      paymentType: paymentTypeFilter,
    })

    return res.status(200).json({ ok: true, payments })
  } catch (err) {
    console.error('[portal-my-payments]', err)
    return res.status(500).json({ error: err?.message || 'Failed to load payments.' })
  }
}

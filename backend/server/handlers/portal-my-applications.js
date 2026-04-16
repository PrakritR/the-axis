/**
 * GET /api/portal?action=my-applications
 *
 * Returns the authenticated resident/applicant's internal applications.
 * Uses Supabase JWT auth (not manager session).
 * Registered in NO_AUTH_ACTIONS because auth is handled here, not by portal-gateway middleware.
 *
 * Query params:
 *   status   — optional filter by application status
 *   limit    — optional max records (default 50)
 */
import { authenticateAndLoadAppUser } from '../lib/request-auth.js'
import { listApplicationsForAppUser } from '../lib/applications-service.js'
import { listPaymentsForApplication } from '../lib/approval-payments-service.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { ok, appUser } = await authenticateAndLoadAppUser(req, res)
  if (!ok) return

  try {
    const statusFilter = String(req.query?.status || '').trim() || undefined
    const applications = await listApplicationsForAppUser({
      appUserId: appUser.id,
      status: statusFilter,
    })

    // Optionally embed payments for each application when requested
    const withPayments = String(req.query?.include_payments || '').trim() === 'true'
    if (withPayments) {
      const enriched = await Promise.all(
        applications.map(async (app) => {
          try {
            const payments = await listPaymentsForApplication({ applicationId: app.id })
            return { ...app, payments }
          } catch {
            return { ...app, payments: [] }
          }
        }),
      )
      return res.status(200).json({ ok: true, applications: enriched })
    }

    return res.status(200).json({ ok: true, applications })
  } catch (err) {
    console.error('[portal-my-applications]', err)
    return res.status(500).json({ error: err?.message || 'Failed to load applications.' })
  }
}

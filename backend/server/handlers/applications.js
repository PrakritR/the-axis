/**
 * applications handler, authenticated by Supabase JWT.
 *
 * Routes (all under /api/applications):
 *   GET    ?id=<id>              — single application
 *   GET    (no id)               — list (scoped by role)
 *   POST   (no action)           — create application
 *   PATCH  ?id=<id>              — partial update
 *   POST   ?id=<id>&action=approve — approve application (admin/manager)
 *   POST   ?id=<id>&action=reject  — reject application  (admin/manager)
 *
 * Permission model:
 *   - Any app_user may create an application for themselves.
 *   - Applicant may update own application while status is draft or submitted.
 *   - Manager may read applications for their properties; update/approve/reject any.
 *   - Owner may read applications for their properties (read-only).
 *   - Admin may read/update/approve/reject all.
 */
import { appUserHasRole } from '../lib/app-user-roles-service.js'
import { authenticateAndLoadAppUser } from '../lib/request-auth.js'
import { getPropertyById } from '../lib/properties-service.js'
import { createApplicationFeeCheckoutSession } from '../lib/application-fee-checkout-service.js'
import { createApprovalGeneratedPayments, listPaymentsForApplication } from '../lib/approval-payments-service.js'
import { mapApplicationRowToLegacyRecord } from '../../../shared/application-legacy-map.js'
import {
  getApplicationById,
  listApplicationsForAppUser,
  listApplicationsForProperty,
  listApplicationsForManagedProperties,
  listApplicationsForAdmin,
  createApplication,
  updateApplication,
  approveApplication,
  rejectApplication,
  resetApplicationToPendingReview,
  hasSubmittedApplicationForSignerEmail,
  hasRoomLeaseOverlapForProperty,
  APPLICATION_STATUS_DRAFT,
  APPLICATION_STATUS_SUBMITTED,
} from '../lib/applications-service.js'

function toLegacyApp(row) {
  return mapApplicationRowToLegacyRecord(row || {})
}

function toLegacyAppList(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => toLegacyApp(r))
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

async function resolveRoles(appUserId) {
  const [isAdmin, isManager, isOwner] = await Promise.all([
    appUserHasRole(appUserId, 'admin'),
    appUserHasRole(appUserId, 'manager'),
    appUserHasRole(appUserId, 'owner'),
  ])
  return { isAdmin, isManager, isOwner }
}

/** True if the caller can mutate (update/approve/reject) an application. */
function canMutate({ isAdmin, isManager }) {
  return isAdmin || isManager
}

/**
 * True if the caller is the applicant AND the application is in a mutable state.
 */
function applicantCanUpdate(appUser, application) {
  if (application.applicant_app_user_id !== appUser.id) return false
  return [APPLICATION_STATUS_DRAFT, APPLICATION_STATUS_SUBMITTED].includes(application.status)
}

export default async function handler(req, res) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()

  const { ok, appUser } = await authenticateAndLoadAppUser(req, res)
  if (!ok) return

  const appId  = String(req.query?.id     || '').trim() || null
  const action = String(req.query?.action || '').trim() || null
  const body   = req.body && typeof req.body === 'object' ? req.body : {}

  try {
    // ── POST …?id=<id>&action=… ───────────────────────────────────────────
    if (req.method === 'POST' && appId && action) {
      // ── action: create-fee-checkout ─────────────────────────────────
      if (action === 'create-fee-checkout') {
        const existing = await getApplicationById(appId)
        if (!existing) return res.status(404).json({ error: 'Application not found.' })

        // Permission: applicant may create for their own application; manager/admin may also.
        const { isAdmin, isManager } = await resolveRoles(appUser.id)
        const isOwn = existing.applicant_app_user_id === appUser.id
        if (!isOwn && !isAdmin && !isManager) {
          return res.status(403).json({ error: 'Access denied.' })
        }

        // Guard: must be in a payable state
        if (['cancelled', 'rejected'].includes(existing.status)) {
          return res.status(409).json({ error: `Cannot create a payment for a ${existing.status} application.` })
        }

        const secretKey = process.env.STRIPE_SECRET_KEY
        if (!secretKey) return res.status(500).json({ error: 'STRIPE_SECRET_KEY is not configured.' })

        const proto = req.headers['x-forwarded-proto'] || 'https'
        const host  = req.headers['x-forwarded-host'] || req.headers.host || ''
        const baseUrl = `${proto}://${host}`

        const session = await createApplicationFeeCheckoutSession({
          application: existing,
          appUser: { id: appUser.id, email: appUser.email },
          baseUrl,
          secretKey,
          successPath: body.successPath || '/apply?payment=success',
          cancelPath:  body.cancelPath  || '/apply?payment=cancelled',
        })
        return res.status(200).json({ ok: true, ...session })
      }

      // ── action: approve / reject ────────────────────────────────────
      const { isAdmin, isManager } = await resolveRoles(appUser.id)
      if (!canMutate({ isAdmin, isManager })) {
        return res.status(403).json({ error: 'Admin or manager role required to approve/reject applications.' })
      }

      const existing = await getApplicationById(appId)
      if (!existing) return res.status(404).json({ error: 'Application not found.' })

      if (action === 'approve') {
        const approved_unit_room = body.approved_unit_room !== undefined ? body.approved_unit_room : undefined
        const updated = await approveApplication({ id: appId, approved_unit_room })

        // Generate pending payment rows for rent / deposit / utilities (non-fatal if amounts unknown).
        let approvalPayments = { created: [], skipped: [], payments: [] }
        try {
          approvalPayments = await createApprovalGeneratedPayments({ application: updated })
          console.log(`[applications] approval payment generation for ${appId}: created=[${approvalPayments.created.join(',')}] skipped=[${approvalPayments.skipped.join(',')}]`)
        } catch (payErr) {
          console.warn(`[applications] approval payment generation failed for ${appId} (non-fatal):`, payErr?.message)
        }

        return res.status(200).json({
          ok: true,
          application: toLegacyApp(updated),
          approvalPayments: {
            created: approvalPayments.created,
            skipped: approvalPayments.skipped,
          },
        })
      }

      if (action === 'reject') {
        const updated = await rejectApplication({ id: appId })
        return res.status(200).json({ ok: true, application: toLegacyApp(updated) })
      }

      if (action === 'set-pending') {
        const existingForPending = await getApplicationById(appId)
        if (!existingForPending) return res.status(404).json({ error: 'Application not found.' })

        const { isAdmin: isAdminP, isManager: isManagerP } = await resolveRoles(appUser.id)
        if (!canMutate({ isAdmin: isAdminP, isManager: isManagerP })) {
          return res.status(403).json({ error: 'Admin or manager role required to reset application review state.' })
        }

        const propertyP = await getPropertyById(existingForPending.property_id)
        const managedByMeP = isManagerP && propertyP?.managed_by_app_user_id === appUser.id
        if (!isAdminP && !managedByMeP) {
          return res.status(403).json({ error: 'Access denied.' })
        }

        const updated = await resetApplicationToPendingReview({ id: appId })
        return res.status(200).json({ ok: true, application: toLegacyApp(updated) })
      }

      if (action === 'payments') {
        // GET /api/applications?id=<id>&action=payments  → list payments for this application
        const application = await getApplicationById(appId)
        if (!application) return res.status(404).json({ error: 'Application not found.' })

        const { isAdmin, isManager } = await resolveRoles(appUser.id)
        const isOwn = application.applicant_app_user_id === appUser.id
        if (!isOwn && !isAdmin && !isManager) return res.status(403).json({ error: 'Access denied.' })

        const appPayments = await listPaymentsForApplication({ applicationId: appId })
        return res.status(200).json({ ok: true, payments: appPayments })
      }

      return res.status(400).json({
        error: `Unknown action "${action}". Use approve, reject, set-pending, create-fee-checkout, or payments.`,
      })
    }

    // ── GET ?id=<id> ──────────────────────────────────────────────────────
    if (req.method === 'GET' && appId) {
      const application = await getApplicationById(appId)
      if (!application) return res.status(404).json({ error: 'Application not found.' })

      const { isAdmin, isManager, isOwner } = await resolveRoles(appUser.id)
      const isOwnApplication = application.applicant_app_user_id === appUser.id

      if (!isOwnApplication && !isAdmin) {
        // Manager/owner scope check against the property
        const property = await getPropertyById(application.property_id)
        const managedByMe = isManager && property?.managed_by_app_user_id === appUser.id
        const ownedByMe   = isOwner   && property?.owned_by_app_user_id   === appUser.id
        if (!managedByMe && !ownedByMe) {
          return res.status(403).json({ error: 'Access denied.' })
        }
      }

      return res.status(200).json({ ok: true, application: toLegacyApp(application) })
    }

    // ── GET (list) ────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const { isAdmin, isManager, isOwner } = await resolveRoles(appUser.id)
      const propertyId = String(req.query?.property_id || '').trim() || null
      const statusFilter = String(req.query?.status || '').trim() || undefined
      const scope = String(req.query?.scope || '').trim().toLowerCase()

      const dupEmail = String(req.query?.check_duplicate_email || '').trim().toLowerCase()
      if (dupEmail) {
        const caller = String(appUser.email || '').trim().toLowerCase()
        if (!caller || caller !== dupEmail) {
          return res.status(403).json({ error: 'You can only run a duplicate check for your signed-in email.' })
        }
        const excludeApplicationId = String(req.query?.exclude_application_id || '').trim() || undefined
        const duplicate = await hasSubmittedApplicationForSignerEmail(dupEmail, { excludeApplicationId })
        return res.status(200).json({ ok: true, duplicate })
      }

      const roomConflict = String(req.query?.check_room_conflict || '').trim()
      if (roomConflict === '1' || roomConflict.toLowerCase() === 'true') {
        const propertyName = String(req.query?.property_name || '').trim()
        const roomNumber = String(req.query?.room_number || '').trim()
        const leaseStart = String(req.query?.lease_start || '').trim()
        const leaseEnd = String(req.query?.lease_end || '').trim() || null
        const excludeApplicationId = String(req.query?.exclude_application_id || '').trim() || undefined
        const overlap = await hasRoomLeaseOverlapForProperty({
          propertyName,
          roomLabel: roomNumber,
          leaseStart,
          leaseEnd,
          excludeApplicationId,
        })
        return res.status(200).json({ ok: true, roomConflict: overlap })
      }

      if (propertyId) {
        // Property-scoped listing: manager, owner, or admin only
        if (!isAdmin && !isManager && !isOwner) {
          return res.status(403).json({ error: 'Admin, manager, or owner role required to list by property.' })
        }
        if (!isAdmin) {
          const property = await getPropertyById(propertyId)
          const managedByMe = isManager && property?.managed_by_app_user_id === appUser.id
          const ownedByMe   = isOwner   && property?.owned_by_app_user_id   === appUser.id
          if (!managedByMe && !ownedByMe) {
            return res.status(403).json({ error: 'Access denied.' })
          }
        }
        const applications = await listApplicationsForProperty({ propertyId, status: statusFilter })
        return res.status(200).json({ ok: true, applications: toLegacyAppList(applications) })
      }

      if (scope === 'all') {
        if (!isAdmin) {
          return res.status(403).json({ error: 'Admin role required for scope=all.' })
        }
        const applications = await listApplicationsForAdmin({ status: statusFilter })
        return res.status(200).json({ ok: true, applications: toLegacyAppList(applications) })
      }

      if (scope === 'managed') {
        if (!isAdmin && !isManager) {
          return res.status(403).json({ error: 'Manager or admin role required for scope=managed.' })
        }
        const applications = isAdmin
          ? await listApplicationsForAdmin({ status: statusFilter })
          : await listApplicationsForManagedProperties({ managerAppUserId: appUser.id, status: statusFilter })
        return res.status(200).json({ ok: true, applications: toLegacyAppList(applications) })
      }

      // Default: list caller's own applications
      const applications = await listApplicationsForAppUser({ appUserId: appUser.id, status: statusFilter })
      return res.status(200).json({ ok: true, applications: toLegacyAppList(applications) })
    }

    // ── POST (create) ─────────────────────────────────────────────────────
    if (req.method === 'POST') {
      const propertyId = String(body.property_id || '').trim()
      if (!propertyId) return res.status(400).json({ error: 'property_id is required.' })

      const application = await createApplication({
        ...body,
        applicant_app_user_id: appUser.id, // always force caller's own id
      })
      return res.status(201).json({ ok: true, application: toLegacyApp(application) })
    }

    // ── PATCH ?id=<id> ────────────────────────────────────────────────────
    if (req.method === 'PATCH') {
      if (!appId) return res.status(400).json({ error: 'id query param is required for PATCH.' })

      const existing = await getApplicationById(appId)
      if (!existing) return res.status(404).json({ error: 'Application not found.' })

      const { isAdmin, isManager } = await resolveRoles(appUser.id)

      // Applicants may update their own drafts; managers/admins may update anything.
      if (!canMutate({ isAdmin, isManager }) && !applicantCanUpdate(appUser, existing)) {
        if (existing.applicant_app_user_id !== appUser.id) {
          return res.status(403).json({ error: 'Access denied.' })
        }
        return res.status(403).json({
          error: `Application in status "${existing.status}" cannot be updated by the applicant. Contact your manager.`,
        })
      }

      // Applicants cannot change admin-only fields
      const patchBody = { ...body }
      if (!canMutate({ isAdmin, isManager })) {
        // Strip fields that only admins/managers may set
        for (const field of [
          'approved', 'rejected', 'approved_at', 'approved_unit_room',
          'application_fee_paid', 'application_fee_due_cents',
          'stripe_checkout_session_id', 'stripe_payment_intent_id',
          'lease_token', 'lease_status', 'lease_signed', 'lease_signed_date',
        ]) {
          delete patchBody[field]
        }
      }

      const updated = await updateApplication({ id: appId, ...patchBody })
      return res.status(200).json({ ok: true, application: toLegacyApp(updated) })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    console.error('[applications]', err)
    const msg = err?.message || 'applications request failed.'
    if (msg.includes('already exists') || msg.includes('duplicate') || msg.includes('Invalid application status')) {
      return res.status(409).json({ error: msg })
    }
    if (msg.includes('required') || msg.includes('exceeds max') || msg.includes('non-negative') || msg.includes('YYYY-MM-DD')) {
      return res.status(400).json({ error: msg })
    }
    return res.status(500).json({ error: msg })
  }
}

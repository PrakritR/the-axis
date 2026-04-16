/**
 * payments handler, authenticated by Supabase JWT.
 *
 * Routes (all under /api/payments):
 *   GET   ?id=<id>                 — single payment
 *   GET   (no id)                  — list (scoped by role)
 *   GET   ?property_id=<id>        — list for property (manager/owner/admin)
 *   POST  (no id)                  — create payment (admin/manager only)
 *   PATCH ?id=<id>                 — partial update  (admin/manager only)
 *
 * Permission model:
 *   - Residents may only read their own payments (app_user_id match).
 *   - Managers may read payments for their managed properties.
 *   - Owners may read payments for their owned properties.
 *   - Admins may read/write all.
 *   - Only admins and managers may create or update payments.
 */
import { appUserHasRole } from '../lib/app-user-roles-service.js'
import { authenticateAndLoadAppUser } from '../lib/request-auth.js'
import { getPropertyById } from '../lib/properties-service.js'
import {
  getPaymentById,
  listPaymentsForAppUser,
  listPaymentsForPropertyScope,
  createPayment,
  updatePayment,
  PAYMENT_STATUS_VALUES,
  PAYMENT_TYPE_VALUES,
} from '../lib/payments-service.js'

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

export default async function handler(req, res) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()

  const { ok, appUser } = await authenticateAndLoadAppUser(req, res)
  if (!ok) return

  const paymentId  = String(req.query?.id          || '').trim() || null
  const propertyId = String(req.query?.property_id || '').trim() || null
  const body       = req.body && typeof req.body === 'object' ? req.body : {}

  try {
    // ── GET ?id=<id> ──────────────────────────────────────────────────────
    if (req.method === 'GET' && paymentId) {
      const payment = await getPaymentById(paymentId)
      if (!payment) return res.status(404).json({ error: 'Payment not found.' })

      const { isAdmin, isManager, isOwner } = await resolveRoles(appUser.id)
      const isOwnPayment = payment.app_user_id === appUser.id

      if (!isOwnPayment && !isAdmin) {
        const property = payment.property_id ? await getPropertyById(payment.property_id) : null
        const managedByMe = isManager && property?.managed_by_app_user_id === appUser.id
        const ownedByMe   = isOwner   && property?.owned_by_app_user_id   === appUser.id
        if (!managedByMe && !ownedByMe) {
          return res.status(403).json({ error: 'Access denied.' })
        }
      }

      return res.status(200).json({ ok: true, payment })
    }

    // ── GET (list) ────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const { isAdmin, isManager, isOwner } = await resolveRoles(appUser.id)
      const statusFilter      = String(req.query?.status       || '').trim() || undefined
      const paymentTypeFilter = String(req.query?.payment_type || '').trim() || undefined

      if (propertyId) {
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
        const payments = await listPaymentsForPropertyScope({
          propertyId,
          status: statusFilter,
          paymentType: paymentTypeFilter,
        })
        return res.status(200).json({ ok: true, payments })
      }

      // Default: list caller's own payments
      const payments = await listPaymentsForAppUser({
        appUserId: appUser.id,
        status: statusFilter,
        paymentType: paymentTypeFilter,
      })
      return res.status(200).json({ ok: true, payments })
    }

    // ── POST (create) — admin/manager only ────────────────────────────────
    if (req.method === 'POST') {
      const { isAdmin, isManager } = await resolveRoles(appUser.id)
      if (!isAdmin && !isManager) {
        return res.status(403).json({ error: 'Admin or manager role required to create payments.' })
      }

      if (body.amount_cents === undefined || body.amount_cents === null) {
        return res.status(400).json({ error: 'amount_cents is required.' })
      }
      if (!body.payment_type) {
        return res.status(400).json({
          error: `payment_type is required. Must be one of: ${PAYMENT_TYPE_VALUES.join(' | ')}.`,
        })
      }

      const payment = await createPayment(body)
      return res.status(201).json({ ok: true, payment })
    }

    // ── PATCH ?id=<id> — admin/manager only ──────────────────────────────
    if (req.method === 'PATCH') {
      if (!paymentId) return res.status(400).json({ error: 'id query param is required for PATCH.' })

      const { isAdmin, isManager } = await resolveRoles(appUser.id)
      if (!isAdmin && !isManager) {
        return res.status(403).json({ error: 'Admin or manager role required to update payments.' })
      }

      const existing = await getPaymentById(paymentId)
      if (!existing) return res.status(404).json({ error: 'Payment not found.' })

      if (Object.keys(body).length === 0) {
        return res.status(400).json({
          error: `Provide at least one field to update. status: ${PAYMENT_STATUS_VALUES.join(' | ')}.`,
        })
      }

      const updated = await updatePayment({ id: paymentId, ...body })
      return res.status(200).json({ ok: true, payment: updated })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    console.error('[payments]', err)
    const msg = err?.message || 'payments request failed.'
    if (msg.includes('already exists') || msg.includes('duplicate')) {
      return res.status(409).json({ error: msg })
    }
    if (msg.includes('required') || msg.includes('exceeds max') || msg.includes('non-negative') || msg.includes('Invalid payment')) {
      return res.status(400).json({ error: msg })
    }
    return res.status(500).json({ error: msg })
  }
}

/**
 * Authenticated `/api/payments` client (Supabase JWT).
 * Maps legacy Airtable-shaped payment fields ↔ Postgres columns for minimal UI churn.
 *
 * @module
 */

import { supabase } from './supabase'
import { mapInternalPaymentToResidentPaymentRow } from './residentPortalInternal.js'
import { isInternalUuid, isAirtableRecordId } from './recordIdentity.js'

async function bearerHeaders() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('Sign in is required to load payments.')
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

async function fetchPaymentsApi(query = {}) {
  const headers = await bearerHeaders()
  const u = new URL('/api/payments', typeof window !== 'undefined' ? window.location.origin : 'http://localhost')
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue
    const s = String(v).trim()
    if (!s) continue
    u.searchParams.set(k, s)
  }
  const path = `${u.pathname}${u.search}`
  const res = await fetch(path, { headers })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `Payments request failed (${res.status}).`)
  return json
}

/**
 * @param {string} appUserId
 * @returns {Promise<object[]>} Postgres `payments` rows
 */
export async function fetchPaymentsRowsForAppUserId(appUserId) {
  const id = String(appUserId || '').trim()
  if (!id) return []
  const json = await fetchPaymentsApi({ app_user_id: id })
  return Array.isArray(json.payments) ? json.payments : []
}

/**
 * Staff ledger: admin = all; manager = managed properties only (server-side).
 * @returns {Promise<object[]>} Postgres rows
 */
export async function fetchStaffPaymentsRows() {
  const json = await fetchPaymentsApi({ scope: 'staff' })
  return Array.isArray(json.payments) ? json.payments : []
}

/**
 * @param {string} appUserId
 * @returns {Promise<object[]>} UI-shaped rows ({@link mapInternalPaymentToResidentPaymentRow})
 */
export async function listPaymentsMappedForAppUserId(appUserId) {
  const rows = await fetchPaymentsRowsForAppUserId(appUserId)
  return rows.map(mapInternalPaymentToResidentPaymentRow)
}

/**
 * Manager / resident: loads `GET /api/payments?app_user_id=…`.
 * @returns {Promise<object[]>}
 */
export async function listPaymentsMappedForResident({ preferredAppUserId }) {
  const id = String(preferredAppUserId || '').trim()
  if (!id) return []
  return listPaymentsMappedForAppUserId(id)
}

function residentLinkFieldKeys() {
  const raw = import.meta.env.VITE_AIRTABLE_PAYMENTS_RESIDENT_LINK_FIELD
  const primary = raw !== undefined && raw !== null && String(raw).trim() !== '' ? String(raw).trim() : 'Resident'
  return [...new Set([primary, 'Resident', 'Resident Profile', 'Resident profile'].filter(Boolean))]
}

export function inferAppUserIdFromLegacyPaymentFields(fields) {
  const f = fields && typeof fields === 'object' ? fields : {}
  for (const key of residentLinkFieldKeys()) {
    const v = f[key]
    if (Array.isArray(v) && v.length) {
      const first = String(v[0] ?? '').trim()
      if (isInternalUuid(first)) return first
    }
  }
  return ''
}

function managerTypeLabelToPaymentType(typeLabel) {
  const t = String(typeLabel || '').trim().toLowerCase()
  if (t === 'fee' || t.includes('fine') || t.includes('cleaning') || t.includes('work order')) return 'other'
  if (t.includes('application')) return 'application_fee'
  if (t.includes('security') && t.includes('deposit')) return 'security_deposit'
  if (t.includes('utilit')) return 'utilities'
  if (t.includes('rent')) return 'rent'
  if (t.includes('service')) return 'service_fee'
  return 'other'
}

function airtableStatusToDbStatus(statusLabel) {
  const s = String(statusLabel || '').trim().toLowerCase()
  if (s === 'paid' || s === 'complete' || s === 'completed') return 'completed'
  if (s === 'cancelled' || s === 'canceled') return 'cancelled'
  if (s === 'refunded') return 'refunded'
  if (s === 'failed') return 'failed'
  return 'pending'
}

/**
 * Maps loose Airtable Payments fields → POST /api/payments JSON body.
 * @param {Record<string, unknown>} fields
 * @returns {Record<string, unknown>}
 */
export function mapLegacyPaymentFieldsToCreateBody(fields) {
  const f = fields && typeof fields === 'object' ? fields : {}
  const appUserId = inferAppUserIdFromLegacyPaymentFields(f)
  if (!appUserId) {
    throw new Error(
      'Cannot create payment: resident is not linked to Supabase (missing app user id on payment link fields).',
    )
  }
  const amountUsd = Number(f.Amount ?? f['Amount Due'] ?? f.Total ?? 0)
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
    throw new Error('Cannot create payment: Amount must be a positive number.')
  }
  const amountCents = Math.round(amountUsd * 100)
  const typeLabel = String(f.Type ?? f['Payment Type'] ?? 'Fee').trim() || 'Fee'
  const paymentType = managerTypeLabelToPaymentType(typeLabel)
  const status = airtableStatusToDbStatus(f.Status)
  const due = String(f['Due Date'] || '').trim().slice(0, 10) || null
  const notes = String(f.Notes || '').trim() || null
  const description = String(f.Month || f.description || '').trim() || null
  const propertyName = String(f['Property Name'] || '').trim() || null
  const roomNumber = String(f['Room Number'] || f.Room || '').trim() || null
  const internalProp = String(f._internal_property_id || f.__internal_property_id || '').trim()
  const internalApp = String(f._internal_application_id || f.__internal_application_id || '').trim()

  const body = {
    app_user_id: appUserId,
    amount_cents: amountCents,
    payment_type: paymentType,
    status,
    due_date: due,
    notes,
    description,
    property_name_snapshot: propertyName,
    room_number_snapshot: roomNumber,
  }
  if (internalProp && isInternalUuid(internalProp)) body.property_id = internalProp
  if (internalApp && isInternalUuid(internalApp)) body.application_id = internalApp

  const axisKey = String(f.axis_payment_key || f.axisPaymentKey || f._axis_payment_key || '').trim()
  if (axisKey) body.axis_payment_key = axisKey

  const stripePi = String(f['Stripe Payment ID'] || f.stripe_payment_intent_id || '').trim()
  if (stripePi) body.stripe_payment_intent_id = stripePi

  return body
}

/**
 * Maps Airtable PATCH-style fields → PATCH /api/payments body.
 * @param {Record<string, unknown>} fields
 */
export function mapLegacyPaymentFieldsToPatchBody(fields) {
  const f = fields && typeof fields === 'object' ? fields : {}
  const out = {}

  if (f.Balance !== undefined) {
    const b = Number(f.Balance)
    if (Number.isFinite(b)) out.balance_cents = Math.max(0, Math.round(b * 100))
  }
  if (f['Paid Date'] !== undefined) {
    const raw = f['Paid Date']
    if (raw === '' || raw === null) {
      out.paid_at = null
    } else {
      const s = String(raw).trim().slice(0, 10)
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        out.paid_at = `${s}T12:00:00.000Z`
      }
    }
  }
  if (f.Notes !== undefined) {
    out.notes = String(f.Notes || '').trim() || null
  }
  if (f['Due Date'] !== undefined) {
    const d = String(f['Due Date'] || '').trim().slice(0, 10)
    out.due_date = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null
  }
  if (f['Stripe Payment ID'] !== undefined) {
    const s = String(f['Stripe Payment ID'] || '').trim()
    out.stripe_payment_intent_id = s || null
  }

  if (f.Status !== undefined) {
    const st = airtableStatusToDbStatus(f.Status)
    out.status = st
    if (st === 'completed') {
      if (f['Amount Paid'] !== undefined) {
        const ap = Number(f['Amount Paid'])
        if (Number.isFinite(ap) && ap >= 0) {
          out.amount_cents = Math.round(ap * 100)
        }
      }
      if (out.paid_at === undefined) {
        out.paid_at = new Date().toISOString()
      }
    }
  }

  return out
}

/**
 * PATCH payment by UUID id.
 * @param {string} paymentId
 * @param {Record<string, unknown>} airtableLikeFields
 */
export async function patchPaymentRecordInternal(paymentId, airtableLikeFields) {
  const id = String(paymentId || '').trim()
  if (!isInternalUuid(id)) {
    throw new Error('Invalid payment id (expected internal payment UUID).')
  }
  const body = mapLegacyPaymentFieldsToPatchBody(airtableLikeFields)
  if (Object.keys(body).length === 0) throw new Error('No valid fields to update.')
  const headers = await bearerHeaders()
  const res = await fetch(`/api/payments?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `Update failed (${res.status}).`)
  return mapInternalPaymentToResidentPaymentRow(json.payment)
}

/**
 * POST create (manager / admin JWT).
 * @param {Record<string, unknown>} airtableLikeFields
 */
export async function createPaymentRecordInternal(airtableLikeFields) {
  const body = mapLegacyPaymentFieldsToCreateBody(airtableLikeFields)
  const headers = await bearerHeaders()
  const res = await fetch('/api/payments', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `Create failed (${res.status}).`)
  return mapInternalPaymentToResidentPaymentRow(json.payment)
}

/**
 * Soft-delete: marks `cancelled` when allowed.
 * @param {string} paymentId
 */
export async function deletePaymentRecordInternal(paymentId) {
  return patchPaymentRecordInternal(paymentId, { Status: 'Cancelled' })
}

export function isSupabasePaymentRecordId(id) {
  return isInternalUuid(id)
}

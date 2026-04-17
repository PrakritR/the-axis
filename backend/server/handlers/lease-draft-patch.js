/**
 * POST /api/portal?action=lease-draft-patch
 *
 * Patches allowed fields on Lease Drafts (Airtable rec… or Supabase uuid).
 *
 * Body:
 *   leaseDraftId     – Airtable record ID (rec…) or Supabase uuid
 *   fields           – object with whitelisted keys only (currently: sign-without-move-in checkbox)
 *   managerRecordId  – optional; when set, enforces Owner ID for non-admin managers
 */

import { canEnforceTenant } from '../middleware/resolveManagerTenant.js'
import { leaseSignWithoutMoveInPayPatchWhitelist } from '../../../shared/lease-sign-without-move-in-pay.js'
import { getSupabaseServiceClient } from '../lib/app-users-service.js'
import {
  assertTenantCanWriteLeaseDraft,
  fetchLeaseDraftJoined,
  isLeaseDraftUuid,
  mapLeaseDraftRowToLegacyRecord,
  updateLeaseDraftById,
} from '../lib/lease-drafts-service.js'

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
const BASE_ID = process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const BASE_URL = `https://api.airtable.com/v0/${BASE_ID}`

/** Prefer server-only env so Vercel does not need a duplicate `VITE_*` name for PATCH whitelist. */
function signWithoutPreferredEnvRaw() {
  return String(
    process.env.AIRTABLE_LEASE_SIGN_WITHOUT_PAY_FIELD ||
      process.env.VITE_AIRTABLE_LEASE_SIGN_WITHOUT_PAY_FIELD ||
      '',
  ).trim()
}

function allowedFieldKeys() {
  return new Set(leaseSignWithoutMoveInPayPatchWhitelist(signWithoutPreferredEnvRaw()))
}

function truthyCheckbox(v) {
  if (v === true || v === 1) return true
  if (v === false || v === 0 || v === null) return false
  const s = String(v).trim().toLowerCase()
  return s === 'true' || s === '1' || s === 'yes' || s === 'on' || s === 'checked'
}

function atHeaders() {
  return { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' }
}

async function atGet(url) {
  const res = await fetch(url, { headers: atHeaders() })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(t)
  }
  return res.json()
}

async function atPatch(table, recordId, fields) {
  const res = await fetch(`${BASE_URL}/${encodeURIComponent(table)}/${recordId}`, {
    method: 'PATCH',
    headers: atHeaders(),
    body: JSON.stringify({ fields, typecast: true }),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(t)
  }
  return res.json()
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { leaseDraftId, fields: rawFields } = req.body || {}
  const id = String(leaseDraftId || '').trim()
  if (!id) return res.status(400).json({ error: 'leaseDraftId is required.' })

  const cleaned = Object.fromEntries(
    Object.entries(rawFields || {}).filter(([, v]) => v !== undefined),
  )
  if (Object.keys(cleaned).length === 0) {
    return res.status(400).json({ error: 'No fields to update.' })
  }

  const allowed = allowedFieldKeys()
  for (const key of Object.keys(cleaned)) {
    if (!allowed.has(key)) {
      return res.status(400).json({ error: `Field not allowed: ${key}` })
    }
  }

  let signWithout = false
  for (const key of Object.keys(cleaned)) {
    if (truthyCheckbox(cleaned[key])) signWithout = true
  }

  const tenant = req._tenant

  if (isLeaseDraftUuid(id)) {
    const client = getSupabaseServiceClient()
    if (!client) return res.status(500).json({ error: 'Supabase is not configured on the server.' })
    try {
      const row = await fetchLeaseDraftJoined(client, id)
      if (!row) return res.status(404).json({ error: 'Lease draft not found.' })
      const legacy = mapLeaseDraftRowToLegacyRecord(row)
      if (tenant && canEnforceTenant(tenant, legacy)) {
        return res.status(403).json({ error: 'Access denied.' })
      }
      if (!tenant?.isAdmin) {
        assertTenantCanWriteLeaseDraft(tenant, row)
      }
      await updateLeaseDraftById(client, id, { allow_sign_without_move_in_pay: signWithout })
      const fresh = await fetchLeaseDraftJoined(client, id)
      const out = mapLeaseDraftRowToLegacyRecord(fresh)
      return res.status(200).json({ ok: true, record: out })
    } catch (err) {
      const code = err.statusCode || 500
      console.error('[lease-draft-patch] supabase', err)
      return res.status(code).json({ error: err.message || 'Failed to update lease draft.' })
    }
  }

  if (!/^rec[a-zA-Z0-9]{14,}$/.test(id)) {
    return res.status(400).json({ error: 'Invalid lease draft ID.' })
  }
  if (!AIRTABLE_TOKEN) return res.status(500).json({ error: 'Server not configured.' })

  try {
    const draft = await atGet(`${BASE_URL}/${encodeURIComponent('Lease Drafts')}/${id}`)
    const record = { id: draft.id, ...(draft.fields || {}) }
    if (tenant && canEnforceTenant(tenant, record)) {
      return res.status(403).json({ error: 'Access denied.' })
    }

    await atPatch('Lease Drafts', id, cleaned)
    const fresh = await atGet(`${BASE_URL}/${encodeURIComponent('Lease Drafts')}/${id}`)
    const out = { id: fresh.id, ...(fresh.fields || {}) }
    return res.status(200).json({ ok: true, record: out })
  } catch (err) {
    console.error('[lease-draft-patch]', err)
    return res.status(500).json({ error: err.message || 'Failed to update lease draft.' })
  }
}

/**
 * POST /api/portal?action=lease-draft-patch
 *
 * Patches allowed fields on Lease Drafts using the server Airtable token (works when
 * the browser build does not embed VITE_AIRTABLE_TOKEN with write access).
 *
 * Body:
 *   leaseDraftId     – Airtable record ID (rec…)
 *   fields           – object with whitelisted keys only (currently: sign-without-move-in checkbox)
 *   managerRecordId  – optional; when set, enforces Owner ID for non-admin managers
 */

import { canEnforceTenant } from '../middleware/resolveManagerTenant.js'

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
const BASE_ID = process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const BASE_URL = `https://api.airtable.com/v0/${BASE_ID}`

const DEFAULT_SIGN_FIELD = 'Allow Sign Without Move-In Pay'

function signWithoutFieldName() {
  const raw = String(process.env.VITE_AIRTABLE_LEASE_SIGN_WITHOUT_PAY_FIELD || '').trim()
  return raw || DEFAULT_SIGN_FIELD
}

function allowedFieldKeys() {
  const primary = signWithoutFieldName()
  return new Set([primary, DEFAULT_SIGN_FIELD].filter((k, i, a) => a.indexOf(k) === i))
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
  if (!AIRTABLE_TOKEN) return res.status(500).json({ error: 'Server not configured.' })

  const { leaseDraftId, fields: rawFields } = req.body || {}
  const id = String(leaseDraftId || '').trim()
  if (!/^rec[a-zA-Z0-9]{14,}$/.test(id)) {
    return res.status(400).json({ error: 'leaseDraftId is required.' })
  }

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

  const tenant = req._tenant
  try {
    const draft = await atGet(`${BASE_URL}/${encodeURIComponent('Lease Drafts')}/${id}`)
    const record = { id: draft.id, ...(draft.fields || {}) }
    if (tenant && canEnforceTenant(tenant, record)) {
      return res.status(403).json({ error: 'Access denied.' })
    }

    const patched = await atPatch('Lease Drafts', id, cleaned)
    const out = { id: patched.id, ...(patched.fields || {}) }
    return res.status(200).json({ ok: true, record: out })
  } catch (err) {
    console.error('[lease-draft-patch]', err)
    return res.status(500).json({ error: err.message || 'Failed to update lease draft.' })
  }
}

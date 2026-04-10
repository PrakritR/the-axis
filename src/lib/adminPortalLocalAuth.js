/**
 * Pending / approved staff admin accounts for /admin (browser-local until Airtable backs this).
 * Owner approves requests in the Admin portal; approved users sign in at the same /admin URL.
 */

const PENDING_KEY = 'axis_admin_access_pending_v1'
const APPROVED_KEY = 'axis_admin_access_approved_v1'

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v : fallback
  } catch {
    return fallback
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
}

export async function hashAdminCredential(email, password) {
  const enc = new TextEncoder()
  const payload = `axis_admin_v1\0${String(email).trim().toLowerCase()}\0${password}`
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(payload))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function listPendingAdminRequests() {
  return readJson(PENDING_KEY, [])
}

export function listApprovedAdminAccounts() {
  return readJson(APPROVED_KEY, [])
}

export async function submitAdminAccessRequest({ name, email, password }) {
  const em = String(email || '').trim().toLowerCase()
  const nm = String(name || '').trim()
  if (!em || !nm || !password) {
    throw new Error('Name, email, and password are required.')
  }
  const passwordHash = await hashAdminCredential(em, password)
  const pending = listPendingAdminRequests()
  const approved = listApprovedAdminAccounts()
  if (approved.some((a) => a.email === em)) {
    throw new Error('This email already has an approved admin account. Sign in instead.')
  }
  if (pending.some((p) => p.email === em)) {
    throw new Error('A request for this email is already pending.')
  }
  const row = {
    id: `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    email: em,
    name: nm,
    passwordHash,
    requestedAt: new Date().toISOString(),
  }
  pending.push(row)
  writeJson(PENDING_KEY, pending)
  return row
}

export function denyAdminRequest(requestId) {
  const pending = listPendingAdminRequests().filter((p) => p.id !== requestId)
  writeJson(PENDING_KEY, pending)
}

export async function approveAdminRequest(requestId) {
  const pending = listPendingAdminRequests()
  const idx = pending.findIndex((p) => p.id === requestId)
  if (idx < 0) throw new Error('Request not found.')
  const [row] = pending.splice(idx, 1)
  writeJson(PENDING_KEY, pending)
  const approved = listApprovedAdminAccounts()
  approved.push({
    id: `adm_${row.id}`,
    email: row.email,
    name: row.name,
    passwordHash: row.passwordHash,
    approvedAt: new Date().toISOString(),
  })
  writeJson(APPROVED_KEY, approved)
  return row
}

export async function tryApprovedStaffLogin(email, password) {
  const em = String(email || '').trim().toLowerCase()
  if (!em || !password) return null
  const hash = await hashAdminCredential(em, password)
  const approved = listApprovedAdminAccounts()
  const match = approved.find((a) => a.email === em && a.passwordHash === hash)
  if (!match) return null
  return {
    id: match.id,
    role: 'admin',
    email: match.email,
    name: match.name,
  }
}

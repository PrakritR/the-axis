/**
 * resolveManagerTenant.js
 *
 * Resolves the calling manager's tenant context.
 * Returns { ownerId, isAdmin, manager, managerId, _authMethod }.
 *
 * Three resolution strategies (in priority order):
 *
 *  1. Supabase Bearer JWT in Authorization header  ← preferred, no Airtable
 *     Verifies the JWT, loads app_users + app_user_roles.
 *     ownerId = internal UUID (app_users.id).
 *
 *  2. Internal UUID in managerRecordId body/query param
 *     Detects UUID format, loads from app_users + app_user_roles.
 *     ownerId = internal UUID.
 *     Used by sessions created via the new internal auth flow where
 *     manager.id is now a UUID rather than an Airtable rec ID.
 *
 *  3. Legacy: Airtable record ID in managerRecordId (starts with "rec")
 *     Performs Airtable lookup — only triggered for sessions created before
 *     the internal auth migration.  Will be removed once all managers
 *     have internal accounts.
 *     ownerId = Airtable rec ID ("rec...").
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * canEnforceTenant(tenant, record):
 *   Returns true only when the record's Owner ID is set AND does NOT match the
 *   tenant's ownerId.  Returns false (allow) for admins, null tenants, or
 *   records that haven't been back-filled yet.
 *
 * ownerIdFormula(tenant, additionalClause?):
 *   Returns an Airtable filterByFormula clause scoped to the manager's ownerId.
 *   Returns empty string for admins / null tenant (no filter).
 */

import { bearerTokenFromRequest, authenticateSupabaseBearerRequest } from '../lib/supabase-bearer-auth.js'
import { getAppUserByAuthUserId, requireServiceClient } from '../lib/app-users-service.js'
import { getRolesForAppUserId } from '../lib/app-user-roles-service.js'

// ─── Supabase / internal ───────────────────────────────────────────────────────

const INTERNAL_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function resolveByInternalUUID(appUserId) {
  const client = requireServiceClient()
  const { data: appUser, error } = await client
    .from('app_users')
    .select('*')
    .eq('id', appUserId)
    .maybeSingle()
  if (error || !appUser) return null

  const roles = await getRolesForAppUserId(appUserId)
  const roleNames = roles.map((r) => String(r.role || '').trim().toLowerCase())
  const isAdmin = roleNames.includes('admin')
  const isManager = roleNames.includes('manager')
  if (!isAdmin && !isManager) return null

  return {
    ownerId: appUserId,        // internal UUID
    airtableOwnerId: null,     // not yet seeded — Airtable filters won't match
    managerId: '',
    isAdmin,
    manager: { id: appUserId, email: appUser.email, ...appUser, _internalOnly: true },
    _authMethod: 'internal_uuid',
  }
}

async function resolveByBearerJWT(req) {
  const auth = await authenticateSupabaseBearerRequest(req)
  if (!auth.ok) return null

  const appUser = await getAppUserByAuthUserId(auth.user.id)
  if (!appUser?.id) return null

  const roles = await getRolesForAppUserId(appUser.id)
  const roleNames = roles.map((r) => String(r.role || '').trim().toLowerCase())
  const isAdmin = roleNames.includes('admin')
  const isManager = roleNames.includes('manager')
  if (!isAdmin && !isManager) return null

  return {
    ownerId: appUser.id,
    airtableOwnerId: null,
    managerId: '',
    isAdmin,
    manager: { id: appUser.id, email: appUser.email, ...appUser, _internalOnly: true },
    _authMethod: 'supabase_jwt',
  }
}

// ─── Legacy Airtable ──────────────────────────────────────────────────────────

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
const BASE_ID =
  process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const MANAGER_TABLE_ENC = encodeURIComponent('Manager Profile')

function airtableHeaders() {
  return {
    Authorization: `Bearer ${AIRTABLE_TOKEN}`,
    'Content-Type': 'application/json',
  }
}

function mapRecord(record) {
  return { id: record.id, ...record.fields, created_at: record.createdTime }
}

async function getManagerByRecordId(recordId) {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${MANAGER_TABLE_ENC}/${encodeURIComponent(recordId)}`
  const res = await fetch(url, { headers: airtableHeaders() })
  if (res.status === 404) return null
  if (!res.ok) throw new Error('Could not verify manager identity.')
  return mapRecord(await res.json())
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Resolve the calling manager's tenant context from the request.
 * Returns null when no identity can be found (unauthenticated / legacy call without ID).
 * Throws if an ID is provided but the manager cannot be found or lacks access.
 */
export async function resolveManagerTenant(req) {
  // Reuse cached result within a single request
  if (req._tenant !== undefined) return req._tenant

  // ── STRATEGY 1: Supabase Bearer JWT ──────────────────────────────────────────
  if (bearerTokenFromRequest(req)) {
    const tenant = await resolveByBearerJWT(req)
    if (tenant) return tenant
    // JWT present but invalid / no manager role — fall through to other strategies
    // (allows graceful degradation during transition period)
  }

  // ── STRATEGY 2 / 3: managerRecordId in body or query ─────────────────────────
  const rawId = String(
    req.body?.managerRecordId || req.query?.managerRecordId || ''
  ).trim()

  if (!rawId) return null

  // Strategy 2: Internal UUID (new sessions after auth migration)
  if (INTERNAL_UUID_RE.test(rawId)) {
    const tenant = await resolveByInternalUUID(rawId)
    if (tenant) return tenant
    throw new Error('Manager access not found or not active.')
  }

  // Strategy 3: Legacy Airtable record ID (old sessions, "rec..." prefix)
  if (rawId.startsWith('rec')) {
    const manager = await getManagerByRecordId(rawId)
    if (!manager) throw new Error('Manager not found.')
    const role = String(manager.Role || manager.role || '').trim().toLowerCase()
    const isAdmin = role === 'admin' || manager.__axisDeveloper === true
    return {
      ownerId: manager.id,             // Airtable rec ID
      airtableOwnerId: manager.id,
      managerId: manager['Manager ID'] || '',
      isAdmin,
      manager,
      _authMethod: 'airtable_legacy',
    }
  }

  return null
}

/**
 * Returns true only when both the tenant's ownerId is set AND doesn't match the
 * record's Owner ID.  Returns false (allow) for admins, null tenants, or records
 * that haven't been back-filled yet.
 */
export function canEnforceTenant(tenant, record) {
  if (!tenant) return false
  if (tenant.isAdmin) return false
  const recordOwnerId = String(record?.['Owner ID'] || '').trim()
  if (!recordOwnerId) return false
  return recordOwnerId !== tenant.ownerId
}

/**
 * Build an Airtable filterByFormula clause scoped to the manager's ownerId.
 * Returns empty string for admins / null tenant (no filter applied).
 */
export function ownerIdFormula(tenant, additionalClause = '') {
  if (!tenant || tenant.isAdmin) return additionalClause || ''
  const escaped = tenant.ownerId.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const ownerClause = `{Owner ID} = "${escaped}"`
  if (!additionalClause) return ownerClause
  return `AND(${ownerClause}, ${additionalClause})`
}

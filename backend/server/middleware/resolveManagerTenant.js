/**
 * resolveManagerTenant.js
 *
 * Looks up the calling manager's Airtable record and returns their
 * tenant context:  { ownerId, isAdmin, manager }
 *
 * ownerId  = manager's Airtable record ID ("rec...") — used as the
 *            canonical Owner ID that propagates through Properties,
 *            Applications, Residents, Lease Drafts, and Work Orders.
 *
 * isAdmin  = true when the manager's Role field is "admin" — bypasses
 *            all Owner ID filters so Axis staff can see everything.
 *
 * Usage in a handler:
 *   const tenant = await resolveManagerTenant(req)
 *   if (!tenant.isAdmin && record['Owner ID'] !== tenant.ownerId) {
 *     return res.status(403).json({ error: 'Access denied.' })
 *   }
 *
 * Graceful degradation: if managerRecordId is absent or the Owner ID
 * field has not been back-filled yet, the guard should be skipped rather
 * than blocking all requests during the migration window. Use
 * `canEnforceTenant(tenant, record)` for this.
 */

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

/**
 * Resolve the calling manager's tenant context from the request.
 *
 * Reads managerRecordId from (in priority order):
 *   req.body.managerRecordId  (POST bodies)
 *   req.query.managerRecordId (GET queries)
 *
 * Returns null if not provided (unauthenticated / legacy call).
 * Throws if the record ID is provided but the manager is not found.
 */
export async function resolveManagerTenant(req) {
  // If portal-gateway already resolved it, reuse — avoid double Airtable call
  if (req._tenant !== undefined) return req._tenant

  const rawId = String(
    req.body?.managerRecordId || req.query?.managerRecordId || ''
  ).trim()

  if (!rawId || !rawId.startsWith('rec')) return null

  const manager = await getManagerByRecordId(rawId)
  if (!manager) throw new Error('Manager not found.')

  const role = String(manager.Role || manager.role || '').trim().toLowerCase()
  const isAdmin = role === 'admin' || manager.__axisDeveloper === true

  return {
    ownerId: manager.id,           // Airtable record ID — canonical Owner ID
    managerId: manager['Manager ID'] || '',
    isAdmin,
    manager,
  }
}

/**
 * Returns true if the tenant context should be enforced for a given record.
 *
 * Enforcement is skipped (returns false) when:
 *  - tenant is null (legacy call without managerRecordId)
 *  - tenant is admin (bypasses all filters)
 *  - record has no Owner ID yet (not yet back-filled)
 *
 * Returns true only when both sides are set and do NOT match —
 * i.e. the manager is trying to access another manager's record.
 */
export function canEnforceTenant(tenant, record) {
  if (!tenant) return false           // no identity provided — allow for now
  if (tenant.isAdmin) return false    // admin bypass
  const recordOwnerId = String(record?.['Owner ID'] || '').trim()
  if (!recordOwnerId) return false    // record not yet back-filled — allow
  return recordOwnerId !== tenant.ownerId
}

/**
 * Build an Airtable filterByFormula clause that scopes a query to the
 * manager's owner_id. Pass `additionalClause` to AND it with more conditions.
 *
 * Returns an empty string if tenant is null or isAdmin (no filter applied).
 *
 * Example:
 *   const ownerFilter = ownerIdFormula(tenant)
 *   const formula = ownerFilter
 *     ? `AND(${ownerFilter}, {Approved} = TRUE())`
 *     : '{Approved} = TRUE()'
 */
export function ownerIdFormula(tenant, additionalClause = '') {
  if (!tenant || tenant.isAdmin) {
    return additionalClause || ''
  }
  const escaped = tenant.ownerId.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const ownerClause = `{Owner ID} = "${escaped}"`
  if (!additionalClause) return ownerClause
  return `AND(${ownerClause}, ${additionalClause})`
}

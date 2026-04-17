/**
 * Supabase `lease_drafts` reads/writes (service role) for portal handlers.
 */

import { randomUUID } from 'node:crypto'
import { requireServiceClient } from './app-users-service.js'
import { listProperties } from './properties-service.js'
import { mapLeaseDraftRowToLegacyRecord } from '../../../shared/lease-draft-legacy-map.js'

export { isLeaseDraftUuid, mapLeaseDraftRowToLegacyRecord } from '../../../shared/lease-draft-legacy-map.js'

/** Join shape must stay aligned with {@link mapLeaseDraftRowToLegacyRecord}. */
export const LEASE_DRAFTS_JOINED_SELECT = `
  *,
  application:applications(id, applicant_app_user_id, signer_email, signer_full_name, approved_unit_room, property_id),
  property:properties!lease_drafts_property_id_fkey(id, name, managed_by_app_user_id, legacy_airtable_record_id)
`

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} client
 * @param {string} id
 */
export async function fetchLeaseDraftJoined(client, id) {
  const lid = String(id || '').trim()
  const { data, error } = await client
    .from('lease_drafts')
    .select(LEASE_DRAFTS_JOINED_SELECT)
    .eq('id', lid)
    .maybeSingle()
  if (error) throw new Error(error.message || 'Failed to load lease draft.')
  return data
}

/**
 * Lease drafts for applications owned by this applicant (resident portal).
 *
 * @param {{ appUserId: string, limit?: number }} args
 * @returns {Promise<object[]>} joined rows
 */
export async function listLeaseDraftsJoinedForApplicant({ appUserId, limit = 200 } = {}) {
  const uid = String(appUserId || '').trim()
  if (!uid) throw new Error('listLeaseDraftsJoinedForApplicant: appUserId is required.')
  const client = requireServiceClient()
  const { data: apps, error: ae } = await client.from('applications').select('id').eq('applicant_app_user_id', uid)
  if (ae) throw new Error(ae.message || 'Failed to list applications for resident.')
  const ids = [...new Set((apps || []).map((a) => String(a.id || '').trim()).filter(Boolean))]
  if (!ids.length) return []
  const { data, error } = await client
    .from('lease_drafts')
    .select(LEASE_DRAFTS_JOINED_SELECT)
    .in('application_id', ids)
    .order('updated_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message || 'Failed to list lease drafts.')
  return data || []
}

/**
 * Lease drafts for properties managed by this manager.
 *
 * @param {{ managerAppUserId: string, limit?: number }} args
 * @returns {Promise<object[]>}
 */
export async function listLeaseDraftsJoinedForManagedProperties({ managerAppUserId, limit = 800 } = {}) {
  const mid = String(managerAppUserId || '').trim()
  if (!mid) throw new Error('listLeaseDraftsJoinedForManagedProperties: managerAppUserId is required.')
  const props = await listProperties({ managedByAppUserId: mid, activeOnly: false })
  const pids = [...new Set((props || []).map((p) => String(p.id || '').trim()).filter(Boolean))]
  if (!pids.length) return []
  const client = requireServiceClient()
  const { data, error } = await client
    .from('lease_drafts')
    .select(LEASE_DRAFTS_JOINED_SELECT)
    .in('property_id', pids)
    .order('updated_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message || 'Failed to list lease drafts for managed properties.')
  return data || []
}

/**
 * @param {{ limit?: number }} [args]
 * @returns {Promise<object[]>}
 */
export async function listLeaseDraftsJoinedForAdmin({ limit = 2500 } = {}) {
  const client = requireServiceClient()
  const { data, error } = await client
    .from('lease_drafts')
    .select(LEASE_DRAFTS_JOINED_SELECT)
    .order('updated_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message || 'Failed to list lease drafts.')
  return data || []
}

/**
 * @param {object} tenant - from resolveManagerTenant
 * @param {object} row - joined lease_drafts row
 */
export function assertTenantCanWriteLeaseDraft(tenant, row) {
  if (!tenant || tenant.isAdmin) return
  const managedBy = String(row?.property?.managed_by_app_user_id || '').trim()
  const tid = String(tenant.ownerId || '').trim()
  if (!managedBy || !tid || managedBy !== tid) {
    const err = new Error('Access denied.')
    err.statusCode = 403
    throw err
  }
}

export function appendLeaseCommentJsonb(existing, { authorName, authorRole, authorRecordId, message, resolved = false }) {
  const arr = Array.isArray(existing) ? [...existing] : []
  arr.push({
    id: randomUUID(),
    'Author Name': String(authorName || '').trim() || 'Unknown',
    'Author Role': String(authorRole || '').trim() || 'Unknown',
    'Author Record ID': String(authorRecordId || '').trim(),
    Message: String(message || '').trim(),
    Timestamp: new Date().toISOString(),
    Resolved: Boolean(resolved),
  })
  return arr
}

export async function updateLeaseDraftById(client, id, patch) {
  const lid = String(id || '').trim()
  const { data, error } = await client.from('lease_drafts').update(patch).eq('id', lid).select('*').maybeSingle()
  if (error) throw new Error(error.message || 'Failed to update lease draft.')
  return data
}

export async function saveLeaseDraftComments(client, id, comments) {
  return updateLeaseDraftById(client, id, { lease_comments: comments })
}

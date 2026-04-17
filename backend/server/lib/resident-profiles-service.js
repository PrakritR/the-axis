/**
 * resident_profiles — role-specific extension rows for residents (public.resident_profiles).
 *
 * Only users with the `resident` app_user_roles row should have a profile; helpers enforce that on write.
 *
 * @module
 */

import { requireServiceClient } from './app-users-service.js'
import { appUserHasRole } from './app-user-roles-service.js'
import { APPLICATION_STATUS_APPROVED } from './applications-service.js'

export const MAX_RESIDENT_PROFILE_PHONE_LENGTH = 40
export const MAX_RESIDENT_PROFILE_EMERGENCY_CONTACT_NAME_LENGTH = 200
export const MAX_RESIDENT_PROFILE_EMERGENCY_CONTACT_PHONE_LENGTH = 40
export const MAX_RESIDENT_PROFILE_NOTES_LENGTH = 20_000

/**
 * @param {unknown} value
 * @param {number} maxLen
 * @param {string} fieldName
 * @returns {string | null}
 */
function normalizeNullableTextField(value, maxLen, fieldName) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string or null.`)
  }
  const s = value.trim()
  if (s.length > maxLen) {
    throw new Error(`${fieldName} exceeds max length (${maxLen}).`)
  }
  return s.length ? s : null
}

/**
 * @param {string} appUserId
 * @returns {Promise<object | null>}
 */
export async function getResidentProfileByAppUserId(appUserId) {
  const id = String(appUserId || '').trim()
  if (!id) return null
  const client = requireServiceClient()
  const { data, error } = await client.from('resident_profiles').select('*').eq('app_user_id', id).maybeSingle()
  if (error) throw new Error(error.message || 'Failed to load resident_profiles')
  return data || null
}

/**
 * Insert a row if missing. Requires `resident` role on the app_user.
 *
 * @param {{
 *   appUserId: string
 *   phone_number?: string | null
 *   emergency_contact_name?: string | null
 *   emergency_contact_phone?: string | null
 *   notes?: string | null
 * }} args
 * @returns {Promise<object>} existing or new row
 */
export async function ensureResidentProfileExists(args) {
  const appUserId = String(args.appUserId || '').trim()
  if (!appUserId) {
    throw new Error('ensureResidentProfileExists: appUserId is required.')
  }

  const hasResident = await appUserHasRole(appUserId, 'resident')
  if (!hasResident) {
    throw new Error('ensureResidentProfileExists: app_user does not have the resident role.')
  }

  const existing = await getResidentProfileByAppUserId(appUserId)
  if (existing) return existing

  const payload = { app_user_id: appUserId }
  if (args.phone_number !== undefined) {
    payload.phone_number = normalizeNullableTextField(
      args.phone_number,
      MAX_RESIDENT_PROFILE_PHONE_LENGTH,
      'phone_number',
    )
  }
  if (args.emergency_contact_name !== undefined) {
    payload.emergency_contact_name = normalizeNullableTextField(
      args.emergency_contact_name,
      MAX_RESIDENT_PROFILE_EMERGENCY_CONTACT_NAME_LENGTH,
      'emergency_contact_name',
    )
  }
  if (args.emergency_contact_phone !== undefined) {
    payload.emergency_contact_phone = normalizeNullableTextField(
      args.emergency_contact_phone,
      MAX_RESIDENT_PROFILE_EMERGENCY_CONTACT_PHONE_LENGTH,
      'emergency_contact_phone',
    )
  }
  if (args.notes !== undefined) {
    payload.notes = normalizeNullableTextField(args.notes, MAX_RESIDENT_PROFILE_NOTES_LENGTH, 'notes')
  }

  const client = requireServiceClient()
  const { data, error } = await client.from('resident_profiles').insert(payload).select('*').single()

  if (error?.code === '23505') {
    const again = await getResidentProfileByAppUserId(appUserId)
    if (again) return again
  }

  if (error) throw new Error(error.message || 'Failed to create resident_profiles')
  return data
}

/**
 * Partial update. Requires `resident` role. Creates row if missing.
 *
 * @param {{
 *   appUserId: string
 *   phone_number?: string | null
 *   emergency_contact_name?: string | null
 *   emergency_contact_phone?: string | null
 *   notes?: string | null
 * }} args — only keys present are updated (undefined = omit)
 * @returns {Promise<object>} updated row
 */
export async function updateResidentProfile(args) {
  const appUserId = String(args.appUserId || '').trim()
  if (!appUserId) {
    throw new Error('updateResidentProfile: appUserId is required.')
  }

  const hasResident = await appUserHasRole(appUserId, 'resident')
  if (!hasResident) {
    throw new Error('updateResidentProfile: app_user does not have the resident role.')
  }

  const updates = {}
  if (args.phone_number !== undefined) {
    updates.phone_number = normalizeNullableTextField(
      args.phone_number,
      MAX_RESIDENT_PROFILE_PHONE_LENGTH,
      'phone_number',
    )
  }
  if (args.emergency_contact_name !== undefined) {
    updates.emergency_contact_name = normalizeNullableTextField(
      args.emergency_contact_name,
      MAX_RESIDENT_PROFILE_EMERGENCY_CONTACT_NAME_LENGTH,
      'emergency_contact_name',
    )
  }
  if (args.emergency_contact_phone !== undefined) {
    updates.emergency_contact_phone = normalizeNullableTextField(
      args.emergency_contact_phone,
      MAX_RESIDENT_PROFILE_EMERGENCY_CONTACT_PHONE_LENGTH,
      'emergency_contact_phone',
    )
  }
  if (args.notes !== undefined) {
    updates.notes = normalizeNullableTextField(args.notes, MAX_RESIDENT_PROFILE_NOTES_LENGTH, 'notes')
  }

  if (Object.keys(updates).length === 0) {
    throw new Error('updateResidentProfile: at least one field must be provided to update.')
  }

  await ensureResidentProfileExists({ appUserId })

  const client = requireServiceClient()
  const { data, error } = await client
    .from('resident_profiles')
    .update(updates)
    .eq('app_user_id', appUserId)
    .select('*')
    .single()

  if (error) throw new Error(error.message || 'Failed to update resident_profiles')
  return data
}

/**
 * @param {object[]} apps — applications for one applicant (any order)
 * @returns {object | null}
 */
function pickPrimaryApplicationForDisplay(apps) {
  const list = Array.isArray(apps) ? apps : []
  if (!list.length) return null
  const approved = list.find(
    (a) =>
      a?.approved === true ||
      String(a?.status || '').trim().toLowerCase() === APPLICATION_STATUS_APPROVED ||
      String(a?.status || '').trim().toLowerCase() === 'approved',
  )
  if (approved) return approved
  const sorted = [...list].sort(
    (a, b) => new Date(b?.created_at || 0).getTime() - new Date(a?.created_at || 0).getTime(),
  )
  return sorted[0] || null
}

function unwrapJoinedProperty(app) {
  if (!app || typeof app !== 'object') return null
  const p = app.properties
  if (!p) return null
  return Array.isArray(p) ? p[0] : p
}

/**
 * Maps internal Postgres rows to the loose Airtable-shaped resident object the portals expect.
 *
 * @param {{
 *   app_user: object
 *   resident_profile: object | null
 *   applications?: object[]
 * }} bundle
 * @returns {object}
 */
export function mapInternalBundleToLegacyResidentRecord(bundle) {
  const u = bundle?.app_user && typeof bundle.app_user === 'object' ? bundle.app_user : {}
  const prof = bundle?.resident_profile && typeof bundle.resident_profile === 'object' ? bundle.resident_profile : null
  const apps = Array.isArray(bundle?.applications) ? bundle.applications : []
  const primary = pickPrimaryApplicationForDisplay(apps)
  const prop = unwrapJoinedProperty(primary)
  const propName = String(prop?.name || '').trim()
  const legacyRec = String(prop?.legacy_airtable_record_id || '').trim()
  const unit =
    String(primary?.approved_unit_room || '').trim() ||
    String(primary?.room_choice_2 || '').trim() ||
    ''

  const email = String(u.email || '').trim().toLowerCase()
  const fullName = String(u.full_name || '').trim()
  const displayName = fullName || (email ? email.split('@')[0] : 'Resident')
  const phone = String(u.phone || '').trim() || String(prof?.phone_number || '').trim()

  const approved =
    primary &&
    (primary.approved === true ||
      String(primary.status || '').trim().toLowerCase() === APPLICATION_STATUS_APPROVED ||
      String(primary.status || '').trim().toLowerCase() === 'approved')

  const out = {
    id: String(u.id || '').trim(),
    _fromSupabaseResidents: true,
    Name: displayName,
    Email: email,
    Phone: phone,
    Status: u.is_active === false ? 'Inactive' : 'Active',
    Approved: Boolean(approved),
    House: propName,
    'Property Name': propName,
    'Unit Number': unit,
    'Lease Start Date': primary?.lease_start_date || null,
    'Lease End Date': primary?.lease_end_date || null,
    'Application ID': primary?.id ? String(primary.id) : '',
  }

  const propUuid = String(prop?.id || '').trim()
  if (propUuid) {
    out.__internal_property_id = propUuid
  }
  if (primary?.id) {
    out.__internal_application_id = String(primary.id)
  }

  if (legacyRec && /^rec[a-zA-Z0-9]{14,}$/.test(legacyRec)) {
    out.House = [legacyRec]
    out.Property = [legacyRec]
    out.Properties = [legacyRec]
  }

  return out
}

/**
 * Staff directory: every app_user with a `resident` role, plus profile + applications/property context.
 *
 * @returns {Promise<{ app_user: object, resident_profile: object | null, applications: object[] }[]>}
 */
export async function listResidentDirectoryBundlesForStaff() {
  const client = requireServiceClient()
  const { data: roleRows, error: re } = await client.from('app_user_roles').select('app_user_id').eq('role', 'resident')
  if (re) throw new Error(re.message || 'Failed to list resident roles')
  const residentIds = [
    ...new Set((roleRows || []).map((r) => String(r.app_user_id || '').trim()).filter(Boolean)),
  ]
  if (!residentIds.length) return []

  const { data: users, error: ue } = await client.from('app_users').select('*').in('id', residentIds)
  if (ue) throw new Error(ue.message || 'Failed to list app_users for residents')

  const { data: profiles, error: pe } = await client
    .from('resident_profiles')
    .select('*')
    .in('app_user_id', residentIds)
  if (pe) throw new Error(pe.message || 'Failed to list resident_profiles')

  const profileByUser = new Map()
  for (const p of profiles || []) {
    const uid = String(p.app_user_id || '').trim()
    if (uid) profileByUser.set(uid, p)
  }

  const { data: apps, error: ae } = await client
    .from('applications')
    .select('*, properties(id,name,legacy_airtable_record_id)')
    .in('applicant_app_user_id', residentIds)
    .order('created_at', { ascending: false })
  if (ae) throw new Error(ae.message || 'Failed to list applications for residents')

  const appsByUser = new Map()
  for (const a of apps || []) {
    const uid = String(a.applicant_app_user_id || '').trim()
    if (!uid) continue
    if (!appsByUser.has(uid)) appsByUser.set(uid, [])
    appsByUser.get(uid).push(a)
  }

  const userById = new Map((users || []).map((row) => [String(row.id || '').trim(), row]))
  const out = []
  for (const id of residentIds) {
    const appUser = userById.get(id)
    if (!appUser) continue
    out.push({
      app_user: appUser,
      resident_profile: profileByUser.get(id) || null,
      applications: appsByUser.get(id) || [],
    })
  }
  return out
}

/**
 * Same bundle shape as directory rows, for one app user (resident self-view).
 *
 * @param {string} appUserId
 * @returns {Promise<{ app_user: object, resident_profile: object | null, applications: object[] } | null>}
 */
export async function getResidentDirectoryBundleForAppUserId(appUserId) {
  const id = String(appUserId || '').trim()
  if (!id) return null
  const hasResident = await appUserHasRole(id, 'resident')
  if (!hasResident) return null

  const client = requireServiceClient()
  const { data: appUser, error: ue } = await client.from('app_users').select('*').eq('id', id).maybeSingle()
  if (ue) throw new Error(ue.message || 'Failed to load app_users')
  if (!appUser) return null

  const { data: prof } = await client.from('resident_profiles').select('*').eq('app_user_id', id).maybeSingle()

  const { data: apps, error: ae } = await client
    .from('applications')
    .select('*, properties(id,name,legacy_airtable_record_id)')
    .eq('applicant_app_user_id', id)
    .order('created_at', { ascending: false })
  if (ae) throw new Error(ae.message || 'Failed to list applications')

  return {
    app_user: appUser,
    resident_profile: prof || null,
    applications: apps || [],
  }
}

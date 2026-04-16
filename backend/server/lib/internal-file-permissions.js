/**
 * Authorization helpers for internal file metadata + Storage flows.
 *
 * @module
 */

import { getApplicationById } from './applications-service.js'
import { getPropertyById } from './properties-service.js'
import { getRoomById } from './rooms-service.js'
import { appUserHasRole } from './app-user-roles-service.js'

/**
 * @param {object} appUser
 * @param {string} applicationId
 * @returns {Promise<boolean>}
 */
export async function canAccessApplicationAsApplicant(appUser, applicationId) {
  const uid = String(appUser?.id || '').trim()
  const aid = String(applicationId || '').trim()
  if (!uid || !aid) return false
  const app = await getApplicationById(aid)
  if (!app) return false
  return String(app.applicant_app_user_id || '') === uid
}

/**
 * @param {object} appUser
 * @returns {Promise<boolean>}
 */
export async function isManagerOrAdmin(appUser) {
  const uid = String(appUser?.id || '').trim()
  if (!uid) return false
  const [mgr, adm] = await Promise.all([appUserHasRole(uid, 'manager'), appUserHasRole(uid, 'admin')])
  return mgr || adm
}

/**
 * Manager of property, admin, or owner of property.
 *
 * @param {object} appUser
 * @param {string} propertyId
 * @returns {Promise<boolean>}
 */
export async function canManagePropertyScopedFiles(appUser, propertyId) {
  const uid = String(appUser?.id || '').trim()
  const pid = String(propertyId || '').trim()
  if (!uid || !pid) return false
  if (await isManagerOrAdmin(appUser)) return true
  const prop = await getPropertyById(pid)
  if (!prop) return false
  if (String(prop.owned_by_app_user_id || '') === uid) return true
  if (String(prop.managed_by_app_user_id || '') === uid) return true
  return false
}

/**
 * @param {object} appUser
 * @param {string} roomId
 * @returns {Promise<boolean>}
 */
export async function canManageRoomScopedFiles(appUser, roomId) {
  const rid = String(roomId || '').trim()
  if (!rid) return false
  const room = await getRoomById(rid)
  if (!room?.property_id) return false
  return await canManagePropertyScopedFiles(appUser, room.property_id)
}

/**
 * Until internal work_orders link residents, only manager/admin may manage work-order files.
 *
 * @param {object} appUser
 * @returns {Promise<boolean>}
 */
export async function canManageWorkOrderFiles(appUser) {
  return isManagerOrAdmin(appUser)
}

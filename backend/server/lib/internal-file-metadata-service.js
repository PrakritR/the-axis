/**
 * CRUD for internal file metadata tables (Postgres). Blobs remain in Supabase Storage.
 *
 * @module
 */

import { requireServiceClient } from './app-users-service.js'

/**
 * @param {string} applicationId
 * @param {string} path
 */
export function assertLeasePathForApplication(applicationId, path) {
  const p = String(path || '').trim()
  const prefix = `leases/${String(applicationId).trim().toLowerCase()}/`
  if (!p.startsWith(prefix)) {
    throw new Error('storage_path does not match this application for lease_files.')
  }
}

/**
 * @param {string} applicationId
 * @param {string} path
 */
export function assertApplicationDocPathForApplication(applicationId, path) {
  const p = String(path || '').trim()
  const prefix = `application documents/${String(applicationId).trim().toLowerCase()}/`
  if (!p.startsWith(prefix)) {
    throw new Error('storage_path does not match this application for application_files.')
  }
}

/**
 * @param {string} propertyId
 * @param {string} bucket
 * @param {string} path
 */
export function assertPropertyImagePath(propertyId, bucket, path) {
  const p = String(path || '').trim()
  const pid = String(propertyId).trim().toLowerCase()
  if (bucket === 'property-images' && !p.startsWith(`property-images/${pid}/`)) {
    throw new Error('storage_path does not match this property for property_images.')
  }
  if (bucket === 'bathroom-images' && !p.startsWith(`bathroom-images/${pid}/`)) {
    throw new Error('storage_path does not match this property for bathroom images.')
  }
  if (bucket === 'shared-space-image' && !p.startsWith(`shared-space-image/${pid}/`)) {
    throw new Error('storage_path does not match this property for shared-space images.')
  }
}

/**
 * @param {string} roomId
 * @param {string} path
 */
export function assertRoomImagePath(roomId, path) {
  const p = String(path || '').trim()
  const rid = String(roomId).trim().toLowerCase()
  if (!p.startsWith(`room-image/${rid}/`)) {
    throw new Error('storage_path does not match this room for room_images.')
  }
}

/**
 * @param {string} workOrderId
 * @param {string} path
 */
export function assertWorkOrderImagePath(workOrderId, path) {
  const p = String(path || '').trim()
  const wid = String(workOrderId).trim().toLowerCase()
  if (!p.startsWith(`work-order-images/${wid}/`)) {
    throw new Error('storage_path does not match this work order for work_order_files.')
  }
}

export async function insertLeaseFileMetadata(row) {
  const client = requireServiceClient()
  const { data, error } = await client.from('lease_files').insert(row).select('*').single()
  if (error) throw new Error(error.message || 'Failed to insert lease_files')
  return data
}

export async function insertApplicationFileMetadata(row) {
  const client = requireServiceClient()
  const { data, error } = await client.from('application_files').insert(row).select('*').single()
  if (error) throw new Error(error.message || 'Failed to insert application_files')
  return data
}

export async function insertPropertyImageMetadata(row) {
  const client = requireServiceClient()
  const { data, error } = await client.from('property_images').insert(row).select('*').single()
  if (error) throw new Error(error.message || 'Failed to insert property_images')
  return data
}

export async function insertRoomImageMetadata(row) {
  const client = requireServiceClient()
  const { data, error } = await client.from('room_images').insert(row).select('*').single()
  if (error) throw new Error(error.message || 'Failed to insert room_images')
  return data
}

export async function insertWorkOrderFileMetadata(row) {
  const client = requireServiceClient()
  const { data, error } = await client.from('work_order_files').insert(row).select('*').single()
  if (error) throw new Error(error.message || 'Failed to insert work_order_files')
  return data
}

/** @param {'lease_files'|'application_files'|'property_images'|'room_images'|'work_order_files'} table */
export async function getFileMetadataRowById(table, id) {
  const tid = String(id || '').trim()
  if (!tid) return null
  const client = requireServiceClient()
  const { data, error } = await client.from(table).select('*').eq('id', tid).maybeSingle()
  if (error) throw new Error(error.message || 'Failed to load file metadata')
  return data || null
}

/** @param {'lease_files'|'application_files'|'property_images'|'room_images'|'work_order_files'} table */
export async function deleteFileMetadataRow(table, id) {
  const tid = String(id || '').trim()
  if (!tid) throw new Error('id is required.')
  const client = requireServiceClient()
  const { error } = await client.from(table).delete().eq('id', tid)
  if (error) throw new Error(error.message || 'Failed to delete file metadata')
}

/**
 * Deterministic / structured paths for Supabase Storage objects.
 * All segments are normalized; UUIDs must be lowercase canonical form.
 *
 * @module
 */

import { randomUUID } from 'node:crypto'
import {
  STORAGE_BUCKET_APPLICATION_DOCUMENTS,
  STORAGE_BUCKET_BATHROOM_IMAGES,
  STORAGE_BUCKET_LEASES,
  STORAGE_BUCKET_PROPERTY_IMAGES,
  STORAGE_BUCKET_ROOM_IMAGE,
  STORAGE_BUCKET_SHARED_SPACE_IMAGE,
  STORAGE_BUCKET_WORK_ORDER_IMAGES,
} from './supabase-storage-constants.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function assertUuid(value, label = 'id') {
  const s = String(value || '').trim().toLowerCase()
  if (!UUID_RE.test(s)) {
    throw new Error(`${label} must be a UUID.`)
  }
  return s
}

/**
 * Safe single path segment from a user-provided filename (extension preserved).
 * @param {string} originalFileName
 */
export function safeStorageFileName(originalFileName) {
  const base = String(originalFileName || 'file').split(/[/\\]/).pop() || 'file'
  const m = base.match(/^(.+?)(\.[a-z0-9]{1,8})?$/i)
  const stem = (m ? m[1] : base).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
  const ext = m && m[2] ? m[2].toLowerCase().slice(0, 9) : ''
  const safeStem = stem || 'file'
  return `${safeStem}${ext}`
}

/**
 * @param {{ applicationId: string, variant: 'lease-v1' | 'signed-lease' | 'attachment', originalFileName?: string }} args
 * @returns {{ bucket: string, path: string }}
 */
export function buildLeaseStoragePath(args) {
  const applicationId = assertUuid(args.applicationId, 'applicationId')
  const variant = String(args.variant || 'attachment').trim()
  if (!/^[a-zA-Z0-9._-]+$/.test(variant)) {
    throw new Error('Invalid lease file variant.')
  }
  let fileName
  if (variant === 'attachment') {
    const ext = safeStorageFileName(args.originalFileName || 'attachment.bin').match(/(\.[a-z0-9]+)$/i)
    const e = ext ? ext[1].toLowerCase() : ''
    fileName = `attachment-${randomUUID()}${e}`
  } else {
    const extFrom = safeStorageFileName(args.originalFileName || `${variant}.pdf`)
    const ext = extFrom.includes('.') ? extFrom.slice(extFrom.lastIndexOf('.')) : '.pdf'
    fileName = `${variant}${ext}`
  }
  const path = `leases/${applicationId}/${fileName}`
  return { bucket: STORAGE_BUCKET_LEASES, path }
}

/**
 * @param {{ applicationId: string, documentKind: string, originalFileName: string }} args
 * @returns {{ bucket: string, path: string }}
 */
export function buildApplicationDocumentPath(args) {
  const applicationId = assertUuid(args.applicationId, 'applicationId')
  const kind = String(args.documentKind || 'other')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .slice(0, 64) || 'other'
  const name = safeStorageFileName(args.originalFileName || 'document.bin')
  const path = `application documents/${applicationId}/${kind}-${randomUUID()}-${name}`
  return { bucket: STORAGE_BUCKET_APPLICATION_DOCUMENTS, path }
}

/**
 * @param {{ propertyId: string, isGallery?: boolean, originalFileName: string }} args
 */
export function buildPropertyImagePath(args) {
  const propertyId = assertUuid(args.propertyId, 'propertyId')
  const isGallery = Boolean(args.isGallery)
  const name = safeStorageFileName(args.originalFileName || 'image.jpg')
  const path = isGallery
    ? `property-images/${propertyId}/gallery/${randomUUID()}-${name}`
    : `property-images/${propertyId}/cover-${randomUUID()}-${name}`
  return { bucket: STORAGE_BUCKET_PROPERTY_IMAGES, path }
}

/**
 * @param {{ roomId: string, isGallery?: boolean, originalFileName: string }} args
 */
export function buildRoomImagePath(args) {
  const roomId = assertUuid(args.roomId, 'roomId')
  const isGallery = Boolean(args.isGallery)
  const name = safeStorageFileName(args.originalFileName || 'image.jpg')
  const path = isGallery
    ? `room-image/${roomId}/gallery/${randomUUID()}-${name}`
    : `room-image/${roomId}/cover-${randomUUID()}-${name}`
  return { bucket: STORAGE_BUCKET_ROOM_IMAGE, path }
}

/**
 * @param {{ propertyId: string, bathroomId: string, originalFileName: string }} args
 */
export function buildBathroomImagePath(args) {
  const propertyId = assertUuid(args.propertyId, 'propertyId')
  const bathroomId = assertUuid(args.bathroomId, 'bathroomId')
  const name = safeStorageFileName(args.originalFileName || 'image.jpg')
  const path = `bathroom-images/${propertyId}/${bathroomId}/${randomUUID()}-${name}`
  return { bucket: STORAGE_BUCKET_BATHROOM_IMAGES, path }
}

/**
 * @param {{ propertyId: string, sharedSpaceId: string, originalFileName: string }} args
 */
export function buildSharedSpaceImagePath(args) {
  const propertyId = assertUuid(args.propertyId, 'propertyId')
  const sharedSpaceId = assertUuid(args.sharedSpaceId, 'sharedSpaceId')
  const name = safeStorageFileName(args.originalFileName || 'image.jpg')
  const path = `shared-space-image/${propertyId}/${sharedSpaceId}/${randomUUID()}-${name}`
  return { bucket: STORAGE_BUCKET_SHARED_SPACE_IMAGE, path }
}

/**
 * @param {{ workOrderId: string, originalFileName: string }} args
 */
export function buildWorkOrderImagePath(args) {
  const workOrderId = assertUuid(args.workOrderId, 'workOrderId')
  const name = safeStorageFileName(args.originalFileName || 'image.jpg')
  const path = `work-order-images/${workOrderId}/${randomUUID()}-${name}`
  return { bucket: STORAGE_BUCKET_WORK_ORDER_IMAGES, path }
}

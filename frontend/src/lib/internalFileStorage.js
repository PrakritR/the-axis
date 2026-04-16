/**
 * Client for POST /api/file-storage (Supabase Storage + Postgres metadata).
 * Requires Supabase session (same as internal application submit).
 *
 * @module
 */

import { supabase } from './supabase'

async function getAccessToken() {
  const { data } = await supabase.auth.getSession()
  return data?.session?.access_token || ''
}

/**
 * @param {Record<string, unknown>} body
 * @returns {Promise<any>}
 */
export async function fileStorageRequest(body) {
  const token = await getAccessToken()
  if (!token) throw new Error('Sign in is required for file uploads.')
  const res = await fetch('/api/file-storage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  let json = {}
  try {
    json = await res.json()
  } catch {
    /* ignore */
  }
  if (!res.ok) {
    throw new Error(json?.error || `file-storage failed (${res.status})`)
  }
  return json
}

/**
 * Presign → PUT bytes → register metadata.
 *
 * @param {{
 *   resource: string
 *   file: File
 *   presignFields: Record<string, unknown>
 *   registerFields: Record<string, unknown>
 * }} args
 */
export async function presignPutAndRegister({ resource, file, presignFields, registerFields }) {
  const presign = await fileStorageRequest({
    op: 'presign_upload',
    resource,
    ...presignFields,
    originalFileName: file.name,
    mimeType: file.type || 'application/octet-stream',
    fileSizeBytes: file.size,
  })
  const upload = presign?.upload
  const bucket = presign?.bucket
  const path = presign?.path
  if (!upload?.signedUrl || !bucket || !path) {
    throw new Error('Server did not return a valid upload payload.')
  }
  const contentType = file.type || 'application/octet-stream'
  if (upload.token) {
    const { error } = await supabase.storage.from(bucket).uploadToSignedUrl(path, upload.token, file, {
      contentType,
    })
    if (error) {
      throw new Error(error.message || 'Storage upload failed.')
    }
  } else {
    const putRes = await fetch(upload.signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: file,
    })
    if (!putRes.ok) {
      const t = await putRes.text().catch(() => '')
      throw new Error(`Storage upload failed (${putRes.status}): ${t.slice(0, 200)}`)
    }
  }
  const reg = await fileStorageRequest({
    op: 'register',
    resource,
    ...registerFields,
    storageBucket: bucket,
    storagePath: path,
    fileName: file.name,
    mimeType: file.type || null,
    fileSizeBytes: file.size,
  })
  return reg?.row
}

export async function listApplicationFiles(applicationId) {
  const out = await fileStorageRequest({
    op: 'list',
    resource: 'application_file',
    applicationId,
  })
  return Array.isArray(out?.rows) ? out.rows : []
}

export async function signedDownloadApplicationFile(fileId, expiresIn) {
  const out = await fileStorageRequest({
    op: 'signed_download',
    resource: 'application_file',
    fileId,
    expiresIn,
  })
  return out?.signedUrl || ''
}

export async function deleteApplicationFile(fileId) {
  await fileStorageRequest({ op: 'delete', resource: 'application_file', fileId })
}

/**
 * @param {{ applicationId: string, documentKind?: string, file: File }} args
 */
export async function uploadApplicationDocumentInternal({ applicationId, documentKind = 'other', file }) {
  return presignPutAndRegister({
    resource: 'application_file',
    file,
    presignFields: { applicationId, documentKind },
    registerFields: { applicationId, documentKind },
  })
}

export async function uploadWorkOrderPhotoInternal({ workOrderId, file }) {
  return presignPutAndRegister({
    resource: 'work_order_file',
    file,
    presignFields: { workOrderId },
    registerFields: { workOrderId, fileKind: 'image' },
  })
}

/** @param {{ propertyId: string, resolvePublicUrls?: boolean }} args */
export async function listPropertyImages(propertyId, resolvePublicUrls = false) {
  const out = await fileStorageRequest({
    op: 'list',
    resource: 'property_image',
    propertyId,
    resolvePublicUrls: Boolean(resolvePublicUrls),
  })
  return Array.isArray(out?.rows) ? out.rows : []
}

/** @param {{ roomId: string, resolvePublicUrls?: boolean }} args */
export async function listRoomImages(roomId, resolvePublicUrls = false) {
  const out = await fileStorageRequest({
    op: 'list',
    resource: 'room_image',
    roomId,
    resolvePublicUrls: Boolean(resolvePublicUrls),
  })
  return Array.isArray(out?.rows) ? out.rows : []
}

export async function publicUrlForPropertyImage(fileId) {
  const out = await fileStorageRequest({ op: 'public_url', resource: 'property_image', fileId })
  return out?.publicUrl || ''
}

export async function publicUrlForRoomImage(fileId) {
  const out = await fileStorageRequest({ op: 'public_url', resource: 'room_image', fileId })
  return out?.publicUrl || ''
}

/**
 * @param {{
 *   propertyId: string
 *   file: File
 *   isGallery?: boolean
 *   isCover?: boolean
 *   sortOrder?: number
 *   altText?: string | null
 *   bathroomId?: string
 *   sharedSpaceId?: string
 * }} args
 */
export async function uploadPropertyImageInternal({
  propertyId,
  file,
  isGallery = true,
  isCover = false,
  sortOrder = 0,
  altText = null,
  bathroomId,
  sharedSpaceId,
}) {
  const presignFields = { propertyId, isGallery: Boolean(isGallery) }
  if (bathroomId) presignFields.bathroomId = bathroomId
  if (sharedSpaceId) presignFields.sharedSpaceId = sharedSpaceId
  const registerFields = {
    propertyId,
    isGallery: Boolean(isGallery),
    isCover: Boolean(isCover),
    sortOrder: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0,
    altText,
    bathroomId,
    sharedSpaceId,
  }
  return presignPutAndRegister({
    resource: 'property_image',
    file,
    presignFields,
    registerFields,
  })
}

/**
 * @param {{
 *   roomId: string
 *   file: File
 *   isGallery?: boolean
 *   isCover?: boolean
 *   sortOrder?: number
 *   altText?: string | null
 * }} args
 */
export async function uploadRoomImageInternal({
  roomId,
  file,
  isGallery = true,
  isCover = false,
  sortOrder = 0,
  altText = null,
}) {
  return presignPutAndRegister({
    resource: 'room_image',
    file,
    presignFields: { roomId, isGallery: Boolean(isGallery) },
    registerFields: {
      roomId,
      isGallery: Boolean(isGallery),
      isCover: Boolean(isCover),
      sortOrder: Number.isFinite(Number(sortOrder)) ? Number(sortOrder) : 0,
      altText,
    },
  })
}

export async function deletePropertyImage(fileId) {
  await fileStorageRequest({ op: 'delete', resource: 'property_image', fileId })
}

export async function deleteRoomImage(fileId) {
  await fileStorageRequest({ op: 'delete', resource: 'room_image', fileId })
}

/**
 * @param {{
 *   applicationId: string
 *   file: File
 *   variant?: string
 *   leaseId?: string | null
 *   fileKind?: string
 * }} args
 */
export async function uploadLeaseFileInternal({
  applicationId,
  file,
  variant = 'signed-lease',
  leaseId = null,
  fileKind = 'attachment',
}) {
  return presignPutAndRegister({
    resource: 'lease_file',
    file,
    presignFields: { applicationId, variant },
    registerFields: { applicationId, leaseId, fileKind },
  })
}

export async function listLeaseFiles(applicationId) {
  const out = await fileStorageRequest({
    op: 'list',
    resource: 'lease_file',
    applicationId,
  })
  return Array.isArray(out?.rows) ? out.rows : []
}

export async function signedDownloadLeaseFile(fileId, expiresIn) {
  const out = await fileStorageRequest({
    op: 'signed_download',
    resource: 'lease_file',
    fileId,
    expiresIn,
  })
  return out?.signedUrl || ''
}

export async function deleteLeaseFile(fileId) {
  await fileStorageRequest({ op: 'delete', resource: 'lease_file', fileId })
}

/**
 * Public gallery JSON for PropertyPage / embeds (no Supabase session).
 * @param {string} propertyId
 */
export async function fetchListingPublicMedia(propertyId) {
  const id = String(propertyId || '').trim()
  if (!id) throw new Error('propertyId is required.')
  const res = await fetch(`/api/listing-public-media?property_id=${encodeURIComponent(id)}`)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || `listing-public-media failed (${res.status})`)
  return json
}

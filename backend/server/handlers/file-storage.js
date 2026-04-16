/**
 * POST /api/file-storage
 *
 * Internal Supabase Storage flows (signed upload / signed download / public URL / metadata / delete).
 * Legacy Airtable attachments are unchanged — this API is for new internal rows only.
 *
 * Body: { op, ... } — all operations require Authorization: Bearer (Supabase JWT) + app_users row.
 *
 * ops:
 *   presign_upload — get a signed PUT URL + canonical path for a new object
 *   register       — insert metadata after the client uploaded bytes to the signed URL
 *   signed_download — signed GET URL for a private metadata row
 *   public_url     — public URL for a listing image row
 *   list           — list metadata rows for an entity (scoped)
 *   delete         — remove Storage object + metadata row
 */
import { requireServiceClient } from '../lib/app-users-service.js'
import { authenticateAndLoadAppUser } from '../lib/request-auth.js'
import { getPropertyById } from '../lib/properties-service.js'
import { getRoomById } from '../lib/rooms-service.js'
import {
  canAccessApplicationAsApplicant,
  canManagePropertyScopedFiles,
  canManageRoomScopedFiles,
  canManageWorkOrderFiles,
  isManagerOrAdmin,
} from '../lib/internal-file-permissions.js'
import {
  assertApplicationDocPathForApplication,
  assertLeasePathForApplication,
  assertPropertyImagePath,
  assertRoomImagePath,
  assertWorkOrderImagePath,
  deleteFileMetadataRow,
  getFileMetadataRowById,
  insertApplicationFileMetadata,
  insertLeaseFileMetadata,
  insertPropertyImageMetadata,
  insertRoomImageMetadata,
  insertWorkOrderFileMetadata,
} from '../lib/internal-file-metadata-service.js'
import {
  buildApplicationDocumentPath,
  buildBathroomImagePath,
  buildLeaseStoragePath,
  buildPropertyImagePath,
  buildRoomImagePath,
  buildSharedSpaceImagePath,
  buildWorkOrderImagePath,
} from '../lib/storage/supabase-storage-paths.js'
import {
  createPublicStorageUrl,
  createSignedStorageUploadUrl,
  createSignedStorageUrl,
  removeStorageObject,
  validateFileUpload,
} from '../lib/storage/supabase-storage-service.js'
import {
  STORAGE_BUCKET_APPLICATION_DOCUMENTS,
  STORAGE_BUCKET_LEASES,
  STORAGE_BUCKET_ROOM_IMAGE,
  STORAGE_BUCKET_WORK_ORDER_IMAGES,
} from '../lib/storage/supabase-storage-constants.js'

const TABLES = {
  lease_file: 'lease_files',
  application_file: 'application_files',
  property_image: 'property_images',
  room_image: 'room_images',
  work_order_file: 'work_order_files',
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

export default async function handler(req, res) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { ok, appUser } = await authenticateAndLoadAppUser(req, res)
  if (!ok) return

  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}
  const op = String(body.op || '').trim().toLowerCase()
  const resource = String(body.resource || '').trim().toLowerCase().replace(/-/g, '_')

  try {
    if (op === 'presign_upload') {
      return await handlePresignUpload(res, appUser, resource, body)
    }
    if (op === 'register') {
      return await handleRegister(res, appUser, resource, body)
    }
    if (op === 'signed_download') {
      return await handleSignedDownload(res, appUser, resource, body)
    }
    if (op === 'public_url') {
      return await handlePublicUrl(res, appUser, resource, body)
    }
    if (op === 'list') {
      return await handleList(res, appUser, resource, body)
    }
    if (op === 'delete') {
      return await handleDelete(res, appUser, resource, body)
    }
    return res.status(400).json({
      error: 'Unknown op. Use presign_upload | register | signed_download | public_url | list | delete.',
    })
  } catch (err) {
    console.error('[file-storage]', err)
    return res.status(500).json({ error: err?.message || 'file-storage failed.' })
  }
}

async function handlePresignUpload(res, appUser, resource, body) {
  const mimeType = String(body.mimeType || '').trim()
  const fileSizeBytes = Number(body.fileSizeBytes)
  const originalFileName = String(body.originalFileName || body.fileName || 'upload.bin')

  if (resource === 'lease_file') {
    const applicationId = String(body.applicationId || '').trim()
    const okApp = await canAccessApplicationAsApplicant(appUser, applicationId)
    const okStaff = await isManagerOrAdmin(appUser)
    if (!okApp && !okStaff) return res.status(403).json({ error: 'Not allowed to upload lease files for this application.' })
    validateFileUpload({ mimeType, fileSizeBytes, ruleKey: 'lease' })
    const variant = String(body.variant || 'attachment').trim()
    const { bucket, path } = buildLeaseStoragePath({
      applicationId,
      variant: variant === 'lease-v1' || variant === 'signed-lease' ? variant : 'attachment',
      originalFileName,
    })
    const up = await createSignedStorageUploadUrl({ bucket, path, upsert: body.upsert === true })
    return res.status(200).json({ ok: true, bucket, path, upload: up })
  }

  if (resource === 'application_file') {
    const applicationId = String(body.applicationId || '').trim()
    const okApp = await canAccessApplicationAsApplicant(appUser, applicationId)
    const okStaff = await isManagerOrAdmin(appUser)
    if (!okApp && !okStaff) return res.status(403).json({ error: 'Not allowed for this application.' })
    validateFileUpload({ mimeType, fileSizeBytes, ruleKey: 'application_document' })
    const documentKind = String(body.documentKind || 'other').trim()
    const { bucket, path } = buildApplicationDocumentPath({ applicationId, documentKind, originalFileName })
    const up = await createSignedStorageUploadUrl({ bucket, path, upsert: body.upsert === true })
    return res.status(200).json({ ok: true, bucket, path, upload: up })
  }

  if (resource === 'property_image') {
    const propertyId = String(body.propertyId || '').trim()
    if (!(await canManagePropertyScopedFiles(appUser, propertyId))) {
      return res.status(403).json({ error: 'Not allowed to upload images for this property.' })
    }
    validateFileUpload({ mimeType, fileSizeBytes, ruleKey: 'property_image' })
    let bucket
    let path
    if (body.bathroomId) {
      ;({ bucket, path } = buildBathroomImagePath({
        propertyId,
        bathroomId: String(body.bathroomId).trim(),
        originalFileName,
      }))
    } else if (body.sharedSpaceId) {
      ;({ bucket, path } = buildSharedSpaceImagePath({
        propertyId,
        sharedSpaceId: String(body.sharedSpaceId).trim(),
        originalFileName,
      }))
    } else {
      ;({ bucket, path } = buildPropertyImagePath({
        propertyId,
        isGallery: Boolean(body.isGallery),
        originalFileName,
      }))
    }
    const up = await createSignedStorageUploadUrl({ bucket, path, upsert: body.upsert === true })
    return res.status(200).json({ ok: true, bucket, path, upload: up })
  }

  if (resource === 'room_image') {
    const roomId = String(body.roomId || '').trim()
    if (!(await canManageRoomScopedFiles(appUser, roomId))) {
      return res.status(403).json({ error: 'Not allowed to upload images for this room.' })
    }
    validateFileUpload({ mimeType, fileSizeBytes, ruleKey: 'room_image' })
    const { bucket, path } = buildRoomImagePath({
      roomId,
      isGallery: Boolean(body.isGallery),
      originalFileName,
    })
    const up = await createSignedStorageUploadUrl({ bucket, path, upsert: body.upsert === true })
    return res.status(200).json({ ok: true, bucket, path, upload: up })
  }

  if (resource === 'work_order_file') {
    if (!(await canManageWorkOrderFiles(appUser))) {
      return res.status(403).json({ error: 'Work order uploads require manager or admin until resident work-order scope exists.' })
    }
    validateFileUpload({ mimeType, fileSizeBytes, ruleKey: 'work_order_image' })
    const workOrderId = String(body.workOrderId || '').trim()
    const { bucket, path } = buildWorkOrderImagePath({ workOrderId, originalFileName })
    const up = await createSignedStorageUploadUrl({ bucket, path, upsert: body.upsert === true })
    return res.status(200).json({ ok: true, bucket, path, upload: up })
  }

  return res.status(400).json({ error: 'Unknown resource for presign_upload.' })
}

async function handleRegister(res, appUser, resource, body) {
  const applicationId = String(body.applicationId || '').trim()
  const propertyId = String(body.propertyId || '').trim()
  const roomId = String(body.roomId || '').trim()
  const workOrderId = String(body.workOrderId || '').trim()
  const storagePath = String(body.storagePath || '').trim()
  const storageBucket = String(body.storageBucket || '').trim()
  const fileName = String(body.fileName || '').trim()
  const mimeType = String(body.mimeType || '').trim()
  const fileSizeBytes = Number(body.fileSizeBytes)

  if (!storagePath || !storageBucket || !fileName) {
    return res.status(400).json({ error: 'storagePath, storageBucket, and fileName are required.' })
  }

  if (resource === 'lease_file') {
    if (!(await canAccessApplicationAsApplicant(appUser, applicationId)) && !(await isManagerOrAdmin(appUser))) {
      return res.status(403).json({ error: 'Not allowed.' })
    }
    assertLeasePathForApplication(applicationId, storagePath)
    if (storageBucket !== STORAGE_BUCKET_LEASES) return res.status(400).json({ error: 'Invalid bucket for lease_file.' })
    const row = await insertLeaseFileMetadata({
      application_id: applicationId,
      lease_id: body.leaseId ? String(body.leaseId).trim() : null,
      storage_bucket: storageBucket,
      storage_path: storagePath,
      file_kind: String(body.fileKind || 'attachment').trim().slice(0, 64),
      file_name: fileName,
      mime_type: mimeType || null,
      file_size_bytes: Number.isFinite(fileSizeBytes) ? fileSizeBytes : null,
      uploaded_by_app_user_id: appUser.id,
    })
    return res.status(200).json({ ok: true, row })
  }

  if (resource === 'application_file') {
    if (!(await canAccessApplicationAsApplicant(appUser, applicationId)) && !(await isManagerOrAdmin(appUser))) {
      return res.status(403).json({ error: 'Not allowed.' })
    }
    assertApplicationDocPathForApplication(applicationId, storagePath)
    if (storageBucket !== STORAGE_BUCKET_APPLICATION_DOCUMENTS) {
      return res.status(400).json({ error: 'Invalid bucket for application_file.' })
    }
    const row = await insertApplicationFileMetadata({
      application_id: applicationId,
      storage_bucket: storageBucket,
      storage_path: storagePath,
      document_kind: String(body.documentKind || 'other').trim().slice(0, 64),
      file_name: fileName,
      mime_type: mimeType || null,
      file_size_bytes: Number.isFinite(fileSizeBytes) ? fileSizeBytes : null,
      uploaded_by_app_user_id: appUser.id,
    })
    return res.status(200).json({ ok: true, row })
  }

  if (resource === 'property_image') {
    if (!(await canManagePropertyScopedFiles(appUser, propertyId))) {
      return res.status(403).json({ error: 'Not allowed.' })
    }
    assertPropertyImagePath(propertyId, storageBucket, storagePath)
    const row = await insertPropertyImageMetadata({
      property_id: propertyId,
      storage_bucket: storageBucket,
      storage_path: storagePath,
      bathroom_id: body.bathroomId ? String(body.bathroomId).trim() : null,
      shared_space_id: body.sharedSpaceId ? String(body.sharedSpaceId).trim() : null,
      sort_order: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
      is_cover: body.isCover === true,
      alt_text: body.altText != null ? String(body.altText).slice(0, 500) : null,
      file_name: fileName,
      mime_type: mimeType || null,
      file_size_bytes: Number.isFinite(fileSizeBytes) ? fileSizeBytes : null,
      uploaded_by_app_user_id: appUser.id,
    })
    return res.status(200).json({ ok: true, row })
  }

  if (resource === 'room_image') {
    if (!(await canManageRoomScopedFiles(appUser, roomId))) {
      return res.status(403).json({ error: 'Not allowed.' })
    }
    assertRoomImagePath(roomId, storagePath)
    if (storageBucket !== STORAGE_BUCKET_ROOM_IMAGE) return res.status(400).json({ error: 'Invalid bucket for room_image.' })
    const row = await insertRoomImageMetadata({
      room_id: roomId,
      storage_bucket: storageBucket,
      storage_path: storagePath,
      sort_order: Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
      is_cover: body.isCover === true,
      alt_text: body.altText != null ? String(body.altText).slice(0, 500) : null,
      file_name: fileName,
      mime_type: mimeType || null,
      file_size_bytes: Number.isFinite(fileSizeBytes) ? fileSizeBytes : null,
      uploaded_by_app_user_id: appUser.id,
    })
    return res.status(200).json({ ok: true, row })
  }

  if (resource === 'work_order_file') {
    if (!(await canManageWorkOrderFiles(appUser))) {
      return res.status(403).json({ error: 'Not allowed.' })
    }
    assertWorkOrderImagePath(workOrderId, storagePath)
    if (storageBucket !== STORAGE_BUCKET_WORK_ORDER_IMAGES) {
      return res.status(400).json({ error: 'Invalid bucket for work_order_file.' })
    }
    const row = await insertWorkOrderFileMetadata({
      work_order_id: workOrderId,
      storage_bucket: storageBucket,
      storage_path: storagePath,
      file_kind: String(body.fileKind || 'image').trim().slice(0, 64),
      file_name: fileName,
      mime_type: mimeType || null,
      file_size_bytes: Number.isFinite(fileSizeBytes) ? fileSizeBytes : null,
      uploaded_by_app_user_id: appUser.id,
    })
    return res.status(200).json({ ok: true, row })
  }

  return res.status(400).json({ error: 'Unknown resource for register.' })
}

async function handleSignedDownload(res, appUser, resource, body) {
  const fileId = String(body.fileId || '').trim()
  const expiresIn = Number(body.expiresIn) > 0 ? Number(body.expiresIn) : 3600
  if (!fileId || !TABLES[resource]) return res.status(400).json({ error: 'resource and fileId are required.' })

  const table = TABLES[resource]
  const row = await getFileMetadataRowById(table, fileId)
  if (!row) return res.status(404).json({ error: 'File not found.' })

  if (resource === 'lease_file') {
    const ok =
      (await canAccessApplicationAsApplicant(appUser, row.application_id)) || (await isManagerOrAdmin(appUser))
    if (!ok) return res.status(403).json({ error: 'Not allowed.' })
  } else if (resource === 'application_file') {
    const ok =
      (await canAccessApplicationAsApplicant(appUser, row.application_id)) || (await isManagerOrAdmin(appUser))
    if (!ok) return res.status(403).json({ error: 'Not allowed.' })
  } else if (resource === 'work_order_file') {
    if (!(await canManageWorkOrderFiles(appUser))) return res.status(403).json({ error: 'Not allowed.' })
  } else {
    return res.status(400).json({ error: 'signed_download applies to private file resources only.' })
  }

  const { signedUrl } = await createSignedStorageUrl({
    bucket: row.storage_bucket,
    path: row.storage_path,
    expiresIn,
  })
  return res.status(200).json({ ok: true, signedUrl, expiresIn })
}

async function handlePublicUrl(res, appUser, resource, body) {
  const fileId = String(body.fileId || '').trim()
  if (!fileId) return res.status(400).json({ error: 'fileId is required.' })
  if (resource !== 'property_image' && resource !== 'room_image') {
    return res.status(400).json({ error: 'public_url applies to property_image or room_image.' })
  }

  const table = TABLES[resource]
  const row = await getFileMetadataRowById(table, fileId)
  if (!row) return res.status(404).json({ error: 'File not found.' })

  if (resource === 'property_image') {
    const prop = await getPropertyById(row.property_id)
    const canStaff = (await canManagePropertyScopedFiles(appUser, row.property_id)) || (await isManagerOrAdmin(appUser))
    if (!prop?.active && !canStaff) {
      return res.status(403).json({ error: 'Listing image is not available.' })
    }
  } else if (resource === 'room_image') {
    const room = await getRoomById(row.room_id)
    if (!room?.property_id) return res.status(404).json({ error: 'Not found.' })
    const prop = await getPropertyById(room.property_id)
    const canStaff = await canManageRoomScopedFiles(appUser, row.room_id)
    if (!prop?.active && !canStaff) {
      return res.status(403).json({ error: 'Listing image is not available.' })
    }
  }

  const { publicUrl } = createPublicStorageUrl({ bucket: row.storage_bucket, path: row.storage_path })
  return res.status(200).json({ ok: true, publicUrl })
}

async function handleList(res, appUser, resource, body) {
  const client = requireServiceClient()

  if (resource === 'lease_file') {
    const applicationId = String(body.applicationId || '').trim()
    if (!(await canAccessApplicationAsApplicant(appUser, applicationId)) && !(await isManagerOrAdmin(appUser))) {
      return res.status(403).json({ error: 'Not allowed.' })
    }
    const { data, error } = await client
      .from('lease_files')
      .select('*')
      .eq('application_id', applicationId)
      .order('created_at', { ascending: false })
    if (error) throw new Error(error.message)
    return res.status(200).json({ ok: true, rows: data || [] })
  }

  if (resource === 'application_file') {
    const applicationId = String(body.applicationId || '').trim()
    if (!(await canAccessApplicationAsApplicant(appUser, applicationId)) && !(await isManagerOrAdmin(appUser))) {
      return res.status(403).json({ error: 'Not allowed.' })
    }
    const { data, error } = await client
      .from('application_files')
      .select('*')
      .eq('application_id', applicationId)
      .order('created_at', { ascending: false })
    if (error) throw new Error(error.message)
    return res.status(200).json({ ok: true, rows: data || [] })
  }

  if (resource === 'property_image') {
    const propertyId = String(body.propertyId || '').trim()
    if (!(await canManagePropertyScopedFiles(appUser, propertyId))) {
      return res.status(403).json({ error: 'Not allowed.' })
    }
    const { data, error } = await client
      .from('property_images')
      .select('*')
      .eq('property_id', propertyId)
      .order('sort_order', { ascending: true })
    if (error) throw new Error(error.message)
    return res.status(200).json({ ok: true, rows: data || [] })
  }

  if (resource === 'room_image') {
    const roomId = String(body.roomId || '').trim()
    if (!(await canManageRoomScopedFiles(appUser, roomId))) {
      return res.status(403).json({ error: 'Not allowed.' })
    }
    const { data, error } = await client
      .from('room_images')
      .select('*')
      .eq('room_id', roomId)
      .order('sort_order', { ascending: true })
    if (error) throw new Error(error.message)
    return res.status(200).json({ ok: true, rows: data || [] })
  }

  if (resource === 'work_order_file') {
    if (!(await canManageWorkOrderFiles(appUser))) {
      return res.status(403).json({ error: 'Not allowed.' })
    }
    const workOrderId = String(body.workOrderId || '').trim()
    if (!workOrderId) return res.status(400).json({ error: 'workOrderId is required.' })
    const { data, error } = await client
      .from('work_order_files')
      .select('*')
      .eq('work_order_id', workOrderId)
      .order('created_at', { ascending: false })
    if (error) throw new Error(error.message)
    return res.status(200).json({ ok: true, rows: data || [] })
  }

  return res.status(400).json({ error: 'Unknown resource for list.' })
}

async function handleDelete(res, appUser, resource, body) {
  const fileId = String(body.fileId || '').trim()
  if (!fileId || !TABLES[resource]) return res.status(400).json({ error: 'resource and fileId are required.' })
  const table = TABLES[resource]
  const row = await getFileMetadataRowById(table, fileId)
  if (!row) return res.status(404).json({ error: 'File not found.' })

  if (resource === 'lease_file') {
    const ok =
      (await canAccessApplicationAsApplicant(appUser, row.application_id)) || (await isManagerOrAdmin(appUser))
    if (!ok) return res.status(403).json({ error: 'Not allowed.' })
  } else if (resource === 'application_file') {
    const ok =
      (await canAccessApplicationAsApplicant(appUser, row.application_id)) || (await isManagerOrAdmin(appUser))
    if (!ok) return res.status(403).json({ error: 'Not allowed.' })
  } else if (resource === 'property_image') {
    if (!(await canManagePropertyScopedFiles(appUser, row.property_id))) return res.status(403).json({ error: 'Not allowed.' })
  } else if (resource === 'room_image') {
    if (!(await canManageRoomScopedFiles(appUser, row.room_id))) return res.status(403).json({ error: 'Not allowed.' })
  } else if (resource === 'work_order_file') {
    if (!(await canManageWorkOrderFiles(appUser))) return res.status(403).json({ error: 'Not allowed.' })
  }

  await removeStorageObject({ bucket: row.storage_bucket, path: row.storage_path })
  await deleteFileMetadataRow(table, fileId)
  return res.status(200).json({ ok: true })
}

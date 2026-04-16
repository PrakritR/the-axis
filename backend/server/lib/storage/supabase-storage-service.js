/**
 * Supabase Storage operations (service role). Paths must be built via supabase-storage-paths.js.
 *
 * @module
 */

import { requireServiceClient } from '../app-users-service.js'
import {
  MAX_FILE_SIZE_BYTES_DEFAULT,
  MIME_RULES,
  PRIVATE_STORAGE_BUCKETS,
  PUBLIC_STORAGE_BUCKETS,
} from './supabase-storage-constants.js'

function assertKnownBucket(bucket) {
  if (!PRIVATE_STORAGE_BUCKETS.has(bucket) && !PUBLIC_STORAGE_BUCKETS.has(bucket)) {
    throw new Error(`Unknown storage bucket: ${bucket}`)
  }
}

/**
 * @param {{ mimeType: string, fileSizeBytes: number, ruleKey: keyof MIME_RULES }} args
 */
export function validateFileUpload(args) {
  const mt = String(args.mimeType || '').trim().toLowerCase()
  const allowed = MIME_RULES[args.ruleKey]
  if (!allowed || !allowed.has(mt)) {
    throw new Error(`Unsupported mime type for ${args.ruleKey}: ${args.mimeType || '(empty)'}`)
  }
  const sz = Number(args.fileSizeBytes)
  if (!Number.isFinite(sz) || sz < 1 || sz > MAX_FILE_SIZE_BYTES_DEFAULT) {
    throw new Error(`file_size_bytes must be between 1 and ${MAX_FILE_SIZE_BYTES_DEFAULT}.`)
  }
}

/**
 * Signed upload URL (private buckets). Client PUTs the file body to the returned URL.
 *
 * @param {{ bucket: string, path: string, upsert?: boolean }} args
 * @returns {Promise<{ signedUrl: string, path: string, token: string }>}
 */
export async function createSignedStorageUploadUrl(args) {
  const bucket = String(args.bucket || '').trim()
  const path = String(args.path || '').trim()
  if (!bucket || !path) throw new Error('bucket and path are required.')
  assertKnownBucket(bucket)
  const client = requireServiceClient()
  const { data, error } = await client.storage.from(bucket).createSignedUploadUrl(path, {
    upsert: args.upsert === true,
  })
  if (error) throw new Error(error.message || 'Could not create signed upload URL.')
  if (!data?.signedUrl || !data?.path) {
    throw new Error('Storage did not return a signed upload URL.')
  }
  return { signedUrl: data.signedUrl, path: data.path, token: data.token || '' }
}

/**
 * Time-limited signed read URL (private buckets).
 *
 * @param {{ bucket: string, path: string, expiresIn?: number }} args
 * @returns {Promise<{ signedUrl: string }>}
 */
export async function createSignedStorageUrl(args) {
  const bucket = String(args.bucket || '').trim()
  const path = String(args.path || '').trim()
  const expiresIn = Number(args.expiresIn) > 0 ? Number(args.expiresIn) : 3600
  if (!bucket || !path) throw new Error('bucket and path are required.')
  if (!PRIVATE_STORAGE_BUCKETS.has(bucket)) {
    throw new Error('Signed download URL is only for private buckets; use createPublicStorageUrl for public buckets.')
  }
  const client = requireServiceClient()
  const { data, error } = await client.storage.from(bucket).createSignedUrl(path, expiresIn)
  if (error) throw new Error(error.message || 'Could not create signed URL.')
  if (!data?.signedUrl) throw new Error('Storage did not return a signed URL.')
  return { signedUrl: data.signedUrl }
}

/**
 * Public object URL (public buckets only).
 *
 * @param {{ bucket: string, path: string }} args
 * @returns {{ publicUrl: string }}
 */
export function createPublicStorageUrl(args) {
  const bucket = String(args.bucket || '').trim()
  const path = String(args.path || '').trim()
  if (!bucket || !path) throw new Error('bucket and path are required.')
  if (PRIVATE_STORAGE_BUCKETS.has(bucket)) {
    throw new Error('Public URL is not allowed for private buckets; use createSignedStorageUrl.')
  }
  if (!PUBLIC_STORAGE_BUCKETS.has(bucket)) {
    throw new Error(`Bucket "${bucket}" is not registered as a public listing bucket.`)
  }
  const client = requireServiceClient()
  const { data } = client.storage.from(bucket).getPublicUrl(path)
  const publicUrl = data?.publicUrl
  if (!publicUrl) throw new Error('Could not build public URL.')
  return { publicUrl }
}

/**
 * @param {{ bucket: string, path: string }} args
 */
export async function removeStorageObject(args) {
  const bucket = String(args.bucket || '').trim()
  const path = String(args.path || '').trim()
  if (!bucket || !path) throw new Error('bucket and path are required.')
  const client = requireServiceClient()
  const { error } = await client.storage.from(bucket).remove([path])
  if (error) throw new Error(error.message || 'Could not delete storage object.')
}

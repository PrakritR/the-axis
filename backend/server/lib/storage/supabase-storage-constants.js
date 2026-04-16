/**
 * Supabase Storage bucket names (must match buckets created in the Supabase project).
 * Buckets with spaces (e.g. "application documents") must be passed exactly to the JS client.
 *
 * @module
 */

/** @readonly */
export const STORAGE_BUCKET_LEASES = 'leases'

/** @readonly */
export const STORAGE_BUCKET_APPLICATION_DOCUMENTS = 'application documents'

/** @readonly */
export const STORAGE_BUCKET_WORK_ORDER_IMAGES = 'work-order-images'

/** @readonly */
export const STORAGE_BUCKET_PROPERTY_IMAGES = 'property-images'

/** @readonly */
export const STORAGE_BUCKET_ROOM_IMAGE = 'room-image'

/** @readonly */
export const STORAGE_BUCKET_BATHROOM_IMAGES = 'bathroom-images'

/** @readonly */
export const STORAGE_BUCKET_SHARED_SPACE_IMAGE = 'shared-space-image'

/** Private buckets — use signed URLs only (no public URLs). */
export const PRIVATE_STORAGE_BUCKETS = new Set([
  STORAGE_BUCKET_LEASES,
  STORAGE_BUCKET_APPLICATION_DOCUMENTS,
  STORAGE_BUCKET_WORK_ORDER_IMAGES,
])

/** Public buckets — public URLs via getPublicUrl; still persist metadata in Postgres. */
export const PUBLIC_STORAGE_BUCKETS = new Set([
  STORAGE_BUCKET_PROPERTY_IMAGES,
  STORAGE_BUCKET_ROOM_IMAGE,
  STORAGE_BUCKET_BATHROOM_IMAGES,
  STORAGE_BUCKET_SHARED_SPACE_IMAGE,
])

export const MAX_FILE_SIZE_BYTES_DEFAULT = 25 * 1024 * 1024

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const DOC_MIMES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])
const APP_DOC_MIMES = new Set([...DOC_MIMES, ...IMAGE_MIMES])

/** @readonly */
export const MIME_RULES = {
  lease: DOC_MIMES,
  application_document: APP_DOC_MIMES,
  property_image: IMAGE_MIMES,
  room_image: IMAGE_MIMES,
  work_order_image: IMAGE_MIMES,
}

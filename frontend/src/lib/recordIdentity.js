/**
 * Central helpers for legacy Airtable record ids vs internal UUIDs.
 * Used by resident portal and other dual-path UIs.
 *
 * @module
 */

/** @readonly */
export const INTERNAL_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Airtable record id (table-agnostic `rec…` prefix). */
export const AIRTABLE_RECORD_ID_RE = /^rec[a-zA-Z0-9]{14,}$/

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isInternalUuid(value) {
  return INTERNAL_UUID_RE.test(String(value || '').trim())
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isAirtableRecordId(value) {
  return AIRTABLE_RECORD_ID_RE.test(String(value || '').trim())
}

/**
 * True when this id should use Postgres-backed APIs (not Airtable record fetch).
 *
 * @param {unknown} value
 */
export function isLegacyAirtablePrimaryId(value) {
  return isAirtableRecordId(value)
}

/**
 * Resolve manager / calendar property identifiers across Postgres UUID and legacy Airtable `rec…`.
 *
 * @module
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * @param {unknown} inputId
 * @param {Record<string, unknown> | null} [propertyRow] — merged manager property row (may include `__internalPostgresProperty`)
 * @returns {{ internalPropertyId: string, legacyAirtableRecordId: string | null }}
 */
export function resolvePropertyIdentity(inputId, propertyRow = null) {
  const id = String(inputId || '').trim()
  const out = { internalPropertyId: '', legacyAirtableRecordId: null }

  const internalBlob = propertyRow?.__internalPostgresProperty
  const legacyFromRow =
    (internalBlob && typeof internalBlob === 'object' && internalBlob.legacy_airtable_record_id != null
      ? String(internalBlob.legacy_airtable_record_id).trim()
      : '') ||
    (propertyRow?.legacy_airtable_record_id != null ? String(propertyRow.legacy_airtable_record_id).trim() : '')

  if (UUID_RE.test(id)) {
    out.internalPropertyId = id
    out.legacyAirtableRecordId = legacyFromRow || null
    return out
  }

  if (/^rec[a-zA-Z0-9]{8,}$/.test(id)) {
    out.legacyAirtableRecordId = id
    return out
  }

  return out
}

/** True when calendar / availability should use Postgres manager_availability instead of Airtable. */
export function propertyRowUsesPostgresAvailability(propertyRow) {
  const r = propertyRow && typeof propertyRow === 'object' ? propertyRow : {}
  if (r.__axisInternalPostgres) return true
  return UUID_RE.test(String(r.id || '').trim())
}

/**
 * Lease Versions table: some Airtable bases use legacy field names
 * (`Uploader Name`, `Uploader Role`, `Upload Date`); the documented schema uses
 * `Uploaded By`, optional `Uploaded By Record ID`, and `Timestamp`.
 * @see docs/LEASING_WORKFLOW_AIRTABLE_SETUP.md
 */

export const LEASE_VERSION_LEGACY_UPLOADER_FIELD_NAMES = ['Uploader Name', 'Uploader Role', 'Upload Date']

export function isLeaseVersionUploaderOrDateUnknownField(unknownFieldName) {
  const u = String(unknownFieldName || '').trim()
  if (!u) return false
  if (LEASE_VERSION_LEGACY_UPLOADER_FIELD_NAMES.includes(u)) return true
  if (u === 'Uploaded By' || u === 'Timestamp' || u === 'Uploaded By Record ID') return true
  return false
}

export function stripLeaseVersionUploaderFieldVariants(fields) {
  const o = { ...(fields || {}) }
  for (const k of LEASE_VERSION_LEGACY_UPLOADER_FIELD_NAMES) delete o[k]
  delete o['Uploaded By']
  delete o['Timestamp']
  delete o['Uploaded By Record ID']
  return o
}

export function leaseVersionLegacyUploaderPayload({ name, role, isoTime }) {
  return {
    'Uploader Name': String(name || '').trim() || 'Axis',
    'Uploader Role': String(role || '').trim() || 'Manager',
    'Upload Date': isoTime,
  }
}

export function leaseVersionDocUploaderPayload({ name, isoTime, uploaderRecordId }) {
  const out = {
    'Uploaded By': String(name || '').trim() || 'Axis',
    'Timestamp': isoTime,
  }
  const rid = String(uploaderRecordId || '').trim()
  if (rid) out['Uploaded By Record ID'] = rid
  return out
}

/** For UI: either legacy or doc-schema datetime on a Lease Versions row. */
export function leaseVersionDisplayUploadTime(record) {
  return record?.['Upload Date'] || record?.['Timestamp'] || ''
}

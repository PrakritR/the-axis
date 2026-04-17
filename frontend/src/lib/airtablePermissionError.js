/**
 * Legacy compatibility shim — Airtable has been removed from production paths.
 *
 * All functions return neutral values so callers behave as if errors are never
 * Airtable-specific permission errors (i.e. errors ARE surfaced as toasts).
 *
 * Imports from this file can be cleaned up gradually; they are harmless.
 */

export const DATA_API_TOKEN_SETUP_HELP = ''
/** @deprecated */
export const AIRTABLE_TOKEN_SETUP_HELP = ''

export function parseAirtableBaseIdFromApiUrl(_url) {
  return null
}

export function airtablePermissionDeniedMessage(_requestUrl) {
  return 'Data access error.'
}

export function responseBodyIndicatesAirtablePermissionDenied(_body) {
  return false
}

export function errorFromAirtableApiBody(_requestUrl, _bodyText) {
  return null
}

/** Always returns false — Airtable permission errors no longer occur in production. */
export function isAirtablePermissionErrorMessage(_message) {
  return false
}

export function consolidateManagerDashboardWarnings(warnings) {
  return warnings
}

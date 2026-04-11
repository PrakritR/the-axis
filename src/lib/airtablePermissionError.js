export function parseAirtableBaseIdFromApiUrl(url) {
  const m = String(url || '').match(/\/v0\/(app[a-zA-Z0-9]+)\//)
  return m ? m[1] : null
}

/** User-facing steps when API token cannot read the workspace (no vendor branding in copy). */
export const DATA_API_TOKEN_SETUP_HELP =
  'In your data service’s developer console, edit your personal access token: grant access to the workspace matching your configured base ID and enable data.records:read and data.records:write.'

/** @deprecated use DATA_API_TOKEN_SETUP_HELP */
export const AIRTABLE_TOKEN_SETUP_HELP = DATA_API_TOKEN_SETUP_HELP

const DATA_ACCESS_PREFIX = 'Data access blocked for workspace'

/** User-facing message when the records API returns INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND */
export function airtablePermissionDeniedMessage(requestUrl) {
  const baseId = parseAirtableBaseIdFromApiUrl(requestUrl) || 'this workspace'
  return `${DATA_ACCESS_PREFIX} ${baseId}. ${DATA_API_TOKEN_SETUP_HELP}`
}

function rawTextIndicatesAirtableAccessDenied(text) {
  const s = String(text || '')
  if (s.includes('INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND')) return true
  if (s.includes('API token does not have access to this database')) return true
  try {
    const j = JSON.parse(s)
    const msg = String(j?.error?.message || j?.message || '')
    if (/INVALID_PERMISSIONS|API token does not have access/i.test(msg)) return true
  } catch {
    /* not JSON */
  }
  return false
}

export function responseBodyIndicatesAirtablePermissionDenied(body) {
  return rawTextIndicatesAirtableAccessDenied(body)
}

/** If body is a permission error from the records API, return an Error to throw; otherwise null. */
export function errorFromAirtableApiBody(requestUrl, bodyText) {
  if (!responseBodyIndicatesAirtablePermissionDenied(bodyText)) return null
  return new Error(airtablePermissionDeniedMessage(requestUrl))
}

export function isAirtablePermissionErrorMessage(message) {
  const s = String(message || '')
  return (
    s.includes(DATA_ACCESS_PREFIX) ||
    s.includes('Airtable blocked access to base') ||
    s.includes('INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND') ||
    s.includes('does not have permission to read this base') ||
    s.includes('API token does not have access to this database')
  )
}

/**
 * When every dashboard warning is the same class of token/base issue,
 * collapse duplicate instructions into one short list + one help paragraph.
 */
export function consolidateManagerDashboardWarnings(warnings) {
  if (!Array.isArray(warnings) || warnings.length === 0) return warnings
  const parsed = warnings.map((line) => {
    const m = line.match(/^([^:]+):\s*(.+)$/s)
    return {
      label: m ? m[1].trim() : 'Data',
      message: m ? m[2].trim() : line,
    }
  })
  const allPerm = parsed.every((p) => isAirtablePermissionErrorMessage(p.message))
  if (!allPerm || parsed.length <= 1) return warnings

  const baseRe = /\b(app[a-zA-Z0-9]+)\b/
  const sectionLines = parsed.map((p) => {
    const bid = p.message.match(baseRe)?.[1]
    return bid ? `${p.label} (${bid})` : p.label
  })
  return [`Could not load: ${sectionLines.join(', ')}.`, DATA_API_TOKEN_SETUP_HELP]
}

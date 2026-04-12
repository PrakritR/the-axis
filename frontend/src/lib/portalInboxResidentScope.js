import { RESIDENT_SCOPE_PREFIX } from './portalInboxConstants.js'

function normalizeScopeLabel(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(avenue|ave|street|st|road|rd|boulevard|blvd|place|pl|drive|dr)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Extract "[Axis scope: … ]" inner text from first message in a resident leasing thread.
 */
export function extractResidentScopeTextFromMessageBody(body) {
  const s = String(body || '')
  if (!s.startsWith(RESIDENT_SCOPE_PREFIX)) return ''
  const close = s.indexOf(']')
  if (close < 0) return ''
  return s.slice(RESIDENT_SCOPE_PREFIX.length, close).trim()
}

/**
 * True if this resident thread should appear for a manager whose houses match the scope line.
 */
export function residentLeasingThreadVisibleToManager(messages, approvedNamesLowerSet) {
  if (!approvedNamesLowerSet?.size) return false
  const sorted = [...(messages || [])].sort(
    (a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0),
  )
  for (const m of sorted) {
    const scope = extractResidentScopeTextFromMessageBody(m.Message)
    if (!scope) continue
    const normScope = normalizeScopeLabel(scope)
    for (const ns of approvedNamesLowerSet) {
      const n = String(ns || '').trim().toLowerCase()
      if (!n) continue
      if (scope.toLowerCase().includes(n) || normScope.includes(normalizeScopeLabel(n))) return true
      const nn = normalizeScopeLabel(n)
      if (nn && (normScope === nn || normScope.includes(nn) || nn.includes(normScope))) return true
    }
  }
  return false
}

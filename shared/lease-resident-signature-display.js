/**
 * Resident e-sign on Lease Drafts: `/api/sign-lease-draft` writes `Signature Text` + `Signed At`.
 * Some bases or older rows may still use `Signed By` for the typed name — read both.
 */

export function pickResidentSignatureTextFromDraft(draft) {
  if (!draft || typeof draft !== 'object') return ''
  return String(draft['Signature Text'] ?? draft['Signed By'] ?? '').trim()
}

export function pickResidentSignedAtFromDraft(draft) {
  if (!draft || typeof draft !== 'object') return ''
  const raw = draft['Signed At']
  if (raw == null) return ''
  if (Array.isArray(raw) && raw.length) return String(raw[0] ?? '').trim()
  return String(raw).trim()
}

export function isLeaseDraftSignedStatus(status) {
  return String(status ?? '').trim() === 'Signed'
}

/**
 * Whether a Lease Drafts row belongs to the signed-in resident portal user.
 * Mirrors frontend {@link getLeaseDraftsForResident} matching rules so download/upload/comment APIs stay consistent.
 */

function normEmail(s) {
  return String(s || '').trim().toLowerCase()
}

function firstLinkedRecordId(raw) {
  if (Array.isArray(raw) && raw.length) return String(raw[0] || '').trim()
  return String(raw || '').trim()
}

export function draftBelongsToResident(draft, residentRecordId, residentEmail) {
  const rid = String(residentRecordId || '').trim()
  const em = normEmail(residentEmail)
  if (!rid.startsWith('rec') || !em) return false

  const drid = String(draft?.['Resident Record ID'] || '').trim()
  if (drid && drid === rid) return true

  const dem = normEmail(draft?.['Resident Email'])
  if (dem && dem === em) return true

  const linkId = firstLinkedRecordId(draft?.Resident)
  if (linkId && linkId === rid) return true

  try {
    const raw = String(draft?.['Lease JSON'] || '').trim()
    if (!raw) return false
    const j = JSON.parse(raw)
    const te = normEmail(j?.tenantEmail)
    if (te && te === em) return true
  } catch {
    /* ignore */
  }

  return false
}

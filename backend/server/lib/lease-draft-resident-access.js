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

/**
 * Supabase `lease_drafts` row (+ nested application) — match portal resident by signer email only.
 * @param {object} row - joined lease_drafts row from Postgres
 * @param {string} residentEmail
 */
export function draftBelongsToResidentSupabaseRow(row, residentEmail) {
  const em = normEmail(residentEmail)
  if (!em) return false
  const app = row?.application && typeof row.application === 'object' ? row.application : {}
  if (normEmail(app.signer_email) === em) return true
  try {
    const lj = row?.lease_json
    const j = typeof lj === 'object' && lj != null ? lj : JSON.parse(String(row?.lease_json || '{}'))
    if (normEmail(j?.tenantEmail) === em || normEmail(j?.signerEmail) === em) return true
  } catch {
    /* ignore */
  }
  return false
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

/**
 * Map Supabase `lease_drafts` (+ joined application/property) to the loose
 * Airtable-shaped record the React lease UI expects.
 *
 * @param {object} row - lease_drafts row with optional nested `application`, `property`
 * @returns {Record<string, unknown>}
 */
export function mapLeaseDraftRowToLegacyRecord(row) {
  if (!row || typeof row !== 'object') return {}
  const app = row.application && typeof row.application === 'object' ? row.application : {}
  const prop = row.property && typeof row.property === 'object' ? row.property : {}
  const leaseJson =
    row.lease_json && typeof row.lease_json === 'object'
      ? row.lease_json
      : (() => {
          try {
            return typeof row.lease_json === 'string' ? JSON.parse(row.lease_json || '{}') : {}
          } catch {
            return {}
          }
        })()

  const ownerId = String(prop.managed_by_app_user_id || '').trim()

  const leaseJsonStr = JSON.stringify(leaseJson && typeof leaseJson === 'object' ? leaseJson : {})

  const status = String(row.status || 'Draft Generated').trim() || 'Draft Generated'

  const wf =
    leaseJson && typeof leaseJson === 'object' && leaseJson._axis_workflow && typeof leaseJson._axis_workflow === 'object'
      ? leaseJson._axis_workflow
      : {}
  const aiPlain =
    leaseJson && typeof leaseJson === 'object' && typeof leaseJson._axis_ai_draft_plain === 'string'
      ? leaseJson._axis_ai_draft_plain
      : ''

  return {
    id: String(row.id),
    _fromSupabase: true,
    Status: status,
    'Lease JSON': leaseJsonStr,
    'Lease HTML': row.lease_html != null ? String(row.lease_html) : '',
    'Manager Edited Content': row.lease_html != null ? String(row.lease_html) : '',
    'AI Draft Content': aiPlain,
    'Application Record ID': String(row.application_id || app.id || ''),
    'Resident Name': String(app.signer_full_name || leaseJson.tenantName || '').trim() || '—',
    'Resident Email': String(app.signer_email || leaseJson.signerEmail || '').trim(),
    Property: String(prop.name || leaseJson.propertyName || '').trim(),
    Unit: String(app.approved_unit_room || leaseJson.roomNumber || '').trim(),
    'Owner ID': ownerId,
    'Manager Edit Notes': row.manager_edit_notes != null ? String(row.manager_edit_notes) : '',
    'Manager Notes': row.manager_edit_notes != null ? String(row.manager_edit_notes) : '',
    'Admin Response Notes': row.admin_response_notes != null ? String(row.admin_response_notes) : '',
    'Current Version': Number(row.current_version) || 1,
    'Updated At': row.updated_at,
    'Published At': row.published_at,
    'Created At': row.created_at,
    created_at: row.created_at,
    allow_sign_without_move_in_pay: Boolean(row.allow_sign_without_move_in_pay),
    'Allow Sign Without Move-In Pay': Boolean(row.allow_sign_without_move_in_pay),
    'Skip Move-In Pay Gate': Boolean(row.allow_sign_without_move_in_pay),
    resident_signed_at: row.resident_signed_at,
    manager_signed_at: row.manager_signed_at,
    manager_signature_text: row.manager_signature_text,
    manager_signature_image_url: row.manager_signature_image_url,
    lease_token: row.lease_token,
    lease_comments: Array.isArray(row.lease_comments) ? row.lease_comments : [],
    current_pdf_url: row.current_pdf_url,
    current_pdf_file_name: row.current_pdf_file_name,
    'Approved By': String(wf.approvedBy || ''),
    'Approved At': String(wf.approvedAt || ''),
    'SignForge Envelope ID': String(wf.signforgeEnvelopeId || ''),
    'SignForge Sent At': String(wf.signforgeSentAt || ''),
  }
}

/** @param {string} id */
export function isLeaseDraftUuid(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id || '').trim())
}

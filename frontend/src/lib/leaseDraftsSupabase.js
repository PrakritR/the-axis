/**
 * Lease drafts — reads go through `/api/lease-drafts` (Supabase JWT + server service role).
 */

import { supabase } from './supabase'
import { getLeaseDraftByIdForSession, listLeaseDraftsForSession } from './leaseDraftsInternalApi.js'
import { isLeaseDraftUuid } from '../../../shared/lease-draft-legacy-map.js'

export { isLeaseDraftUuid, mapLeaseDraftRowToLegacyRecord } from '../../../shared/lease-draft-legacy-map.js'

export async function listLeaseDraftsSupabase() {
  return listLeaseDraftsForSession({})
}

const ADMIN_LEASE_QUEUE_STATUSES = new Set([
  'Submitted to Admin',
  'Admin In Review',
  'Manager Approved',
  'Ready for Signature',
])

/** Count drafts in the admin review queue (same statuses as legacy Airtable dashboard filter). */
export async function countLeaseDraftsAdminQueueSupabase() {
  const rows = await listLeaseDraftsSupabase()
  return rows.filter((r) => ADMIN_LEASE_QUEUE_STATUSES.has(String(r.Status || '').trim())).length
}

export async function getLeaseDraftByIdSupabase(leaseDraftId) {
  const id = String(leaseDraftId || '').trim()
  if (!isLeaseDraftUuid(id)) throw new Error('Invalid lease draft ID.')
  const row = await getLeaseDraftByIdForSession(id)
  if (!row) return null
  return row
}

export async function updateLeaseDraftRecordSupabase(leaseDraftId, fields) {
  const id = String(leaseDraftId || '').trim()
  if (!isLeaseDraftUuid(id)) throw new Error('Invalid lease draft ID.')
  const patch = {}
  const f = fields && typeof fields === 'object' ? fields : {}
  if ('Status' in f) patch.status = f.Status != null ? String(f.Status) : ''
  if ('Lease JSON' in f) {
    const raw = f['Lease JSON']
    if (typeof raw === 'string') {
      try {
        patch.lease_json = JSON.parse(raw || '{}')
      } catch {
        patch.lease_json = {}
      }
    } else if (raw && typeof raw === 'object') patch.lease_json = raw
  }
  if ('Lease HTML' in f) patch.lease_html = f['Lease HTML'] != null ? String(f['Lease HTML']) : ''
  if ('Manager Edited Content' in f) patch.lease_html = f['Manager Edited Content'] != null ? String(f['Manager Edited Content']) : ''
  if ('Manager Edit Notes' in f) patch.manager_edit_notes = f['Manager Edit Notes'] != null ? String(f['Manager Edit Notes']) : null
  if ('Manager Notes' in f) patch.manager_edit_notes = f['Manager Notes'] != null ? String(f['Manager Notes']) : null
  if ('Admin Response Notes' in f) patch.admin_response_notes = f['Admin Response Notes'] != null ? String(f['Admin Response Notes']) : null
  if ('Current Version' in f) patch.current_version = Number(f['Current Version']) || 1
  if ('Published At' in f) patch.published_at = f['Published At'] || null
  if ('allow_sign_without_move_in_pay' in f) patch.allow_sign_without_move_in_pay = Boolean(f.allow_sign_without_move_in_pay)
  if ('Allow Sign Without Move-In Pay' in f) patch.allow_sign_without_move_in_pay = Boolean(f['Allow Sign Without Move-In Pay'])
  if ('current_pdf_url' in f) patch.current_pdf_url = f.current_pdf_url != null ? String(f.current_pdf_url) : null
  if ('current_pdf_file_name' in f) patch.current_pdf_file_name = f.current_pdf_file_name != null ? String(f.current_pdf_file_name) : null
  if ('lease_comments' in f && Array.isArray(f.lease_comments)) patch.lease_comments = f.lease_comments

  const jsonSideKeys = ['Approved By', 'Approved At', 'SignForge Envelope ID', 'SignForge Sent At', 'AI Draft Content']
  const touchesLeaseJsonSidecar = jsonSideKeys.some((k) => k in f)
  if (touchesLeaseJsonSidecar) {
    let j =
      patch.lease_json && typeof patch.lease_json === 'object'
        ? { ...patch.lease_json }
        : null
    if (!j) {
      const cur = await getLeaseDraftByIdForSession(id)
      try {
        const js = cur?.['Lease JSON']
        j = js ? JSON.parse(String(js)) : {}
      } catch {
        j = {}
      }
      if (!j || typeof j !== 'object') j = {}
    }
    if ('AI Draft Content' in f) {
      j._axis_ai_draft_plain = f['AI Draft Content'] != null ? String(f['AI Draft Content']) : ''
    }
    const wf = {
      ...(typeof j._axis_workflow === 'object' && j._axis_workflow !== null ? j._axis_workflow : {}),
    }
    if ('Approved By' in f) wf.approvedBy = f['Approved By'] != null ? String(f['Approved By']) : ''
    if ('Approved At' in f) wf.approvedAt = f['Approved At'] != null ? String(f['Approved At']) : ''
    if ('SignForge Envelope ID' in f) {
      wf.signforgeEnvelopeId = f['SignForge Envelope ID'] != null ? String(f['SignForge Envelope ID']) : ''
    }
    if ('SignForge Sent At' in f) {
      wf.signforgeSentAt = f['SignForge Sent At'] != null ? String(f['SignForge Sent At']) : ''
    }
    j._axis_workflow = wf
    patch.lease_json = j
  }

  if (Object.keys(patch).length === 0) throw new Error('No lease draft fields to update.')

  const { error } = await supabase.from('lease_drafts').update(patch).eq('id', id)
  if (error) throw new Error(error.message || 'Could not update lease draft.')
  const fresh = await getLeaseDraftByIdForSession(id)
  if (!fresh) throw new Error('Lease draft not found after update.')
  return fresh
}

export async function getLeaseDraftsForResidentSupabase() {
  const rows = await listLeaseDraftsForSession({})
  rows.sort((a, b) => {
    const pb = new Date(b['Published At'] || 0).getTime()
    const pa = new Date(a['Published At'] || 0).getTime()
    if (pb !== pa) return pb - pa
    return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
  })
  return rows
}

export async function getApprovedLeaseForResidentSupabase() {
  const drafts = await getLeaseDraftsForResidentSupabase()
  const ok = (s) => {
    const x = String(s || '').trim()
    return x === 'Published' || x === 'Signed' || x === 'Ready for Signature'
  }
  return drafts.find((d) => ok(d.Status)) || null
}

export function getLeaseCommentsForDraftSupabase(draft) {
  const raw = draft?.lease_comments
  if (!Array.isArray(raw)) return []
  return [...raw].sort((a, b) => new Date(a.Timestamp || 0) - new Date(b.Timestamp || 0))
}

export function getCurrentLeaseVersionSupabase(draft) {
  if (!draft || !isLeaseDraftUuid(draft.id)) return null
  const url = String(draft.current_pdf_url || '').trim()
  if (!url) return null
  return {
    id: `pdf-${draft.id}`,
    'Lease Draft ID': draft.id,
    'Version Number': Number(draft['Current Version']) || 1,
    'PDF URL': url,
    'File Name': String(draft.current_pdf_file_name || 'lease.pdf'),
    'Is Current': true,
    'Upload Date': draft.updated_at,
  }
}

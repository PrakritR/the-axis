/**
 * GET /api/lease-drafts — Supabase-backed lease draft reads (JWT).
 *
 * Query:
 *   GET (no id)  — list drafts visible to the caller (resident / manager / admin)
 *   GET ?id=<uuid> — single joined draft row (same visibility rules)
 *
 * Optional list filters (substring, case-insensitive):
 *   ?status=<text>
 *   ?property=<text>
 *   ?resident=<text>
 */
import { appUserHasRole } from '../lib/app-user-roles-service.js'
import { requireServiceClient } from '../lib/app-users-service.js'
import { authenticateAndLoadAppUser } from '../lib/request-auth.js'
import {
  fetchLeaseDraftJoined,
  isLeaseDraftUuid,
  listLeaseDraftsJoinedForAdmin,
  listLeaseDraftsJoinedForApplicant,
  listLeaseDraftsJoinedForManagedProperties,
  mapLeaseDraftRowToLegacyRecord,
} from '../lib/lease-drafts-service.js'

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

function applyListFilters(rows, { status, property, resident } = {}) {
  const st = String(status || '').trim().toLowerCase()
  const pr = String(property || '').trim().toLowerCase()
  const rs = String(resident || '').trim().toLowerCase()
  let list = Array.isArray(rows) ? rows : []
  if (st) {
    list = list.filter((r) => String(r?.status || '').toLowerCase().includes(st))
  }
  if (pr) {
    list = list.filter((r) => {
      const name = String(r?.property?.name || '').toLowerCase()
      return name.includes(pr)
    })
  }
  if (rs) {
    list = list.filter((r) => {
      const app = r?.application && typeof r.application === 'object' ? r.application : {}
      const blob = [
        app.signer_full_name,
        app.signer_email,
        r?.lease_json?.tenantName,
        r?.lease_json?.signerEmail,
      ]
        .map((x) => String(x || '').toLowerCase())
        .join(' ')
      return blob.includes(rs) || blob.split(/\s+/).some((w) => w && rs.includes(w))
    })
  }
  return list
}

async function resolveRoles(appUserId) {
  const [isAdmin, isManager, isResident] = await Promise.all([
    appUserHasRole(appUserId, 'admin'),
    appUserHasRole(appUserId, 'manager'),
    appUserHasRole(appUserId, 'resident'),
  ])
  return { isAdmin, isManager, isResident }
}

function callerMayReadDraft({ appUserId, isAdmin, isManager, row }) {
  if (!row) return false
  if (isAdmin) return true
  const app = row.application && typeof row.application === 'object' ? row.application : {}
  if (String(app.applicant_app_user_id || '').trim() === String(appUserId || '').trim()) return true
  if (isManager) {
    const managedBy = String(row?.property?.managed_by_app_user_id || '').trim()
    return managedBy && managedBy === String(appUserId || '').trim()
  }
  return false
}

export default async function handler(req, res) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const { ok, appUser } = await authenticateAndLoadAppUser(req, res)
  if (!ok) return

  const draftId = String(req.query?.id || '').trim() || null
  const statusFilter = String(req.query?.status || '').trim()
  const propertyFilter = String(req.query?.property || '').trim()
  const residentFilter = String(req.query?.resident || '').trim()

  try {
    const { isAdmin, isManager, isResident } = await resolveRoles(appUser.id)
    if (!isAdmin && !isManager && !isResident) {
      return res.status(403).json({ error: 'Resident, manager, or admin role required to read lease drafts.' })
    }

    const client = requireServiceClient()

    if (draftId) {
      if (!isLeaseDraftUuid(draftId)) {
        return res.status(400).json({ error: 'Invalid lease draft id (expected UUID).' })
      }
      const row = await fetchLeaseDraftJoined(client, draftId)
      if (!row) return res.status(404).json({ error: 'Lease draft not found.' })
      if (!callerMayReadDraft({ appUserId: appUser.id, isAdmin, isManager, row })) {
        return res.status(403).json({ error: 'Access denied.' })
      }
      return res.status(200).json({ ok: true, draft: mapLeaseDraftRowToLegacyRecord(row) })
    }

    let rows = []
    if (isAdmin) {
      rows = await listLeaseDraftsJoinedForAdmin({ limit: 2500 })
    } else if (isManager) {
      rows = await listLeaseDraftsJoinedForManagedProperties({ managerAppUserId: appUser.id, limit: 1200 })
    } else {
      rows = await listLeaseDraftsJoinedForApplicant({ appUserId: appUser.id, limit: 200 })
    }

    rows = applyListFilters(rows, {
      status: statusFilter,
      property: propertyFilter,
      resident: residentFilter,
    })

    const drafts = rows.map((r) => mapLeaseDraftRowToLegacyRecord(r))
    return res.status(200).json({ ok: true, drafts })
  } catch (err) {
    console.error('[lease-drafts]', err)
    return res.status(500).json({ error: err?.message || 'Failed to load lease drafts.' })
  }
}

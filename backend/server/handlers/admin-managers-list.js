/**
 * GET /api/admin-managers-list
 *
 * Returns all internal managers (app_user_roles.role = 'manager') with optional
 * manager_profiles + managed properties — Supabase only (no Airtable).
 * Includes inactive app_users so the admin portal can show "past" subscribers.
 * Requires an admin Bearer JWT.
 */
import { authenticateSupabaseBearerRequest } from '../lib/supabase-bearer-auth.js'
import { getAppUserByAuthUserId, requireServiceClient } from '../lib/app-users-service.js'
import { appUserHasRole } from '../lib/app-user-roles-service.js'

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

export default async function handler(req, res) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const auth = await authenticateSupabaseBearerRequest(req)
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error })

  const appUser = await getAppUserByAuthUserId(auth.user.id)
  if (!appUser?.id) {
    return res.status(409).json({ error: 'No internal app user. Call POST /api/sync-app-user first.' })
  }

  const isAdmin = await appUserHasRole(appUser.id, 'admin')
  if (!isAdmin) return res.status(403).json({ error: 'Admin role required.' })

  try {
    const client = requireServiceClient()

    const { data: roleRows, error } = await client
      .from('app_user_roles')
      .select(`
        app_user_id,
        app_users (
          id,
          email,
          full_name,
          is_active,
          updated_at
        )
      `)
      .eq('role', 'manager')

    if (error) throw new Error(error.message)

    const managerIds = [
      ...new Set(
        (roleRows || [])
          .map((r) => r.app_users?.id)
          .filter(Boolean)
          .map((id) => String(id)),
      ),
    ]

    const companyByAppUserId = new Map()
    if (managerIds.length) {
      const { data: profRows, error: profErr } = await client
        .from('manager_profiles')
        .select('app_user_id, company, tier')
        .in('app_user_id', managerIds)
      if (profErr) throw new Error(profErr.message)
      for (const p of profRows || []) {
        const uid = String(p.app_user_id || '').trim()
        if (!uid) continue
        const c = typeof p.company === 'string' ? p.company.trim() : ''
        companyByAppUserId.set(uid, c)
      }
    }

    const { data: propRows, error: propErr } = await client
      .from('properties')
      .select('name, managed_by_app_user_id')
      .not('managed_by_app_user_id', 'is', null)

    if (propErr) throw new Error(propErr.message)

    const byManagerId = new Map()
    for (const p of propRows || []) {
      const mid = String(p.managed_by_app_user_id || '').trim()
      if (!mid) continue
      const name = String(p.name || '').trim()
      if (!byManagerId.has(mid)) byManagerId.set(mid, [])
      if (name) byManagerId.get(mid).push(name)
    }

    const managers = []
    for (const row of roleRows || []) {
      const user = row.app_users
      if (!user?.id) continue
      const id = String(user.id)
      const names = byManagerId.get(id) || []
      const managedHousesLabel = names.length ? names.join(', ') : '—'
      const company = companyByAppUserId.get(id) || ''
      const updatedMs = user.updated_at ? new Date(user.updated_at).getTime() : 0
      managers.push({
        id,
        email: String(user.email || '').trim().toLowerCase(),
        name: String(user.full_name || user.email || '').trim(),
        role: 'manager',
        enabled: user.is_active !== false,
        updatedMs: Number.isFinite(updatedMs) ? updatedMs : 0,
        company: company || null,
        propertyCount: names.length,
        managedHousesLabel,
        houseSortKey: names.length ? String(names[0] || '').trim().toLowerCase() : '',
      })
    }

    managers.sort((a, b) => b.updatedMs - a.updatedMs || a.name.localeCompare(b.name))

    return res.status(200).json({ ok: true, managers })
  } catch (err) {
    console.error('[admin-managers-list]', err)
    return res.status(500).json({ error: err?.message || 'Failed to load managers.' })
  }
}

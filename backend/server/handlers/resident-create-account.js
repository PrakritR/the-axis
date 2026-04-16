/**
 * POST /api/resident-create-account
 *
 * Create a resident account — fully internal, no Airtable write required.
 *
 * Body:
 *   { email: string, password: string, name?: string, applicationId?: string }
 *
 * Flow:
 *   1. Create Supabase Auth user via Admin API (email_confirm: true — no email needed).
 *   2. Ensure public.app_users row.
 *   3. Assign 'resident' role in app_user_roles.
 *   4. Create resident_profiles row.
 *   5. If applicationId provided: validate against internal applications table
 *      and link the profile to the application.
 *   6. Sign in immediately to return tokens (frontend calls supabase.auth.setSession).
 *
 * The Airtable Residents table is NOT written to.
 */

import { createClient } from '@supabase/supabase-js'
import { ensureAppUserByAuthId } from '../lib/app-users-service.js'
import { assignRoleToAppUser, appUserHasRole } from '../lib/app-user-roles-service.js'
import {
  ensureResidentProfileExists,
} from '../lib/resident-profiles-service.js'

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function getServiceClient() {
  const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  if (!url || !key) throw new Error('Supabase service client is not configured on this server.')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

async function signInAfterCreate(email, password) {
  const url = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim()
  const anonKey = String(
    process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '',
  ).trim()
  if (!url || !anonKey) return null
  try {
    const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anonKey },
      body: JSON.stringify({ email, password }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
      token_type: data.token_type || 'bearer',
    }
  } catch {
    return null
  }
}

/**
 * Validate applicationId against the internal applications table.
 * Returns the application row or null if not found.
 * Falls back to Airtable application lookup if the applicationId is an Airtable rec ID.
 */
async function loadApplication(applicationId, appUserId) {
  if (!applicationId) return null

  const serviceClient = getServiceClient()
  const rawId = String(applicationId || '').trim()

  // Internal UUID format — query internal applications table
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (UUID_RE.test(rawId)) {
    const { data } = await serviceClient
      .from('applications')
      .select('*')
      .eq('id', rawId)
      .maybeSingle()
    return data || null
  }

  // Legacy APP-recXXX format — query by airtable_record_id if the column exists
  const recId = rawId.startsWith('APP-') ? rawId.slice(4) : rawId
  if (recId.startsWith('rec')) {
    const { data } = await serviceClient
      .from('applications')
      .select('*')
      .eq('airtable_record_id', recId)
      .maybeSingle()
    return data || null
  }

  return null
}

export default async function handler(req, res) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { email, password, name, applicationId } = req.body || {}
  const normalizedEmail = String(email || '').trim().toLowerCase()
  const normalizedName = String(name || '').trim()

  if (!normalizedEmail || !password) {
    return res.status(400).json({ error: 'Email and password are required.' })
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' })
  }

  try {
    const serviceClient = getServiceClient()

    // 1. Create Supabase Auth user (or reuse if already exists)
    const { data: createData, error: createErr } = await serviceClient.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      ...(normalizedName ? { user_metadata: { full_name: normalizedName } } : {}),
    })

    if (createErr) {
      if (
        createErr.message?.toLowerCase().includes('already registered') ||
        createErr.message?.toLowerCase().includes('already exists')
      ) {
        return res.status(409).json({
          error: 'An account with this email already exists. Please sign in instead.',
        })
      }
      throw createErr
    }

    const authUserId = createData?.user?.id
    if (!authUserId) {
      return res.status(500).json({ error: 'Failed to create authentication record.' })
    }

    // 2. Ensure app_users row
    const appUser = await ensureAppUserByAuthId({
      authUserId,
      email: normalizedEmail,
      fullName: normalizedName || null,
    })

    // 3. Assign resident role
    const alreadyResident = await appUserHasRole(appUser.id, 'resident')
    if (!alreadyResident) {
      await assignRoleToAppUser({ appUserId: appUser.id, role: 'resident', isPrimary: true })
    }

    // 4. Create resident_profiles row
    await ensureResidentProfileExists({ appUserId: appUser.id })

    // 5. Link to application if provided
    let linkedApplication = null
    if (applicationId) {
      linkedApplication = await loadApplication(applicationId, appUser.id).catch(() => null)
    }

    // 6. Sign in to return tokens
    const session = await signInAfterCreate(normalizedEmail, password)

    return res.status(200).json({
      ok: true,
      appUserId: appUser.id,
      email: normalizedEmail,
      name: normalizedName || normalizedEmail.split('@')[0],
      session,
      /** Minimal resident-like object for the portal to render initial state. */
      resident: {
        id: appUser.id,
        Email: normalizedEmail,
        Name: normalizedName || normalizedEmail.split('@')[0],
        Status: 'Active',
        Approved: Boolean(linkedApplication?.status === 'approved'),
        House: linkedApplication?.property_name || '',
        'Unit Number': linkedApplication?.room || linkedApplication?.approved_room || '',
        'Lease Start Date': linkedApplication?.lease_start_date || null,
        'Lease End Date': linkedApplication?.lease_end_date || null,
        'Application ID': linkedApplication?.id || '',
        _internalAuth: true,
      },
    })
  } catch (err) {
    console.error('[resident-create-account]', err)
    return res.status(500).json({ error: 'Could not create the account. Please try again.' })
  }
}

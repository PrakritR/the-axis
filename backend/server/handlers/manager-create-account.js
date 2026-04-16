/**
 * POST /api/manager-create-account  (also /api/portal?action=manager-create-account)
 *
 * Create a new manager account — fully internal, no Airtable write required.
 *
 * Accepts two modes:
 *
 *  A) Internal signup (preferred):
 *       { email, password, name? }
 *     Creates a Supabase Auth user via the Admin API, then assigns the
 *     'manager' role in app_user_roles.
 *
 *  B) Legacy Manager ID onboarding (fallback, deprecated):
 *       { managerId, password, name? }
 *     Looks up the Manager Profile by Manager ID in Airtable, then creates
 *     the Supabase user and assigns the role.  Only used while old Airtable
 *     records are still the authoritative source of manager invitations.
 */

import { createClient } from '@supabase/supabase-js'
import { ensureAppUserByAuthId } from '../lib/app-users-service.js'
import { assignRoleToAppUser } from '../lib/app-user-roles-service.js'
import { ensureManagerProfileExists } from '../lib/manager-profiles-service.js'
import {
  getManagerByManagerId,
  updateManager,
  deriveManagerId,
  buildManagerSession,
  managerAirtableConfigured,
} from '../lib/manager-account-service.js'

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

function getAnonConfig() {
  return {
    url: String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim(),
    anonKey: String(process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim(),
  }
}

async function signInAfterCreate(email, password) {
  const { url, anonKey } = getAnonConfig()
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

/** Mode A — create account from email + password (no Airtable). */
async function createInternalManagerAccount(email, password, name, res) {
  const serviceClient = getServiceClient()
  const normalizedEmail = String(email || '').trim().toLowerCase()
  const normalizedName = String(name || '').trim()

  // 1. Create Supabase Auth user (admin API — no email confirmation needed)
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

  // 3. Assign manager role
  await assignRoleToAppUser({ appUserId: appUser.id, role: 'manager', isPrimary: true })

  // 4. Create manager_profiles row
  await ensureManagerProfileExists({ appUserId: appUser.id })

  // 5. Sign in to return tokens (so frontend can call supabase.auth.setSession)
  const session = await signInAfterCreate(normalizedEmail, password)

  return res.status(200).json({
    ok: true,
    manager: buildManagerSession({
      manager: {
        id: appUser.id,
        Name: normalizedName || normalizedEmail.split('@')[0],
        Email: normalizedEmail,
        'Phone Number': '',
        tier: 'free',
        Role: 'Manager',
        Active: true,
        _internalOnly: true,
      },
      appUser,
      authUserId,
    }),
    session,
  })
}

/** Mode B — legacy Manager ID onboarding (requires Airtable, deprecated). */
async function createLegacyManagerAccount(managerId, password, name, res) {
  if (!managerAirtableConfigured()) {
    return res.status(500).json({
      error:
        'Manager account creation via Manager ID requires the Airtable connection, ' +
        'which is not configured. Contact your administrator to create your account directly.',
    })
  }

  const normalizedManagerId = String(managerId || '').trim().toUpperCase()
  const normalizedName = String(name || '').trim()

  const manager = await getManagerByManagerId(normalizedManagerId)
  if (!manager) {
    return res.status(404).json({
      error: 'No manager subscription record was found for that Manager ID yet.',
    })
  }

  const normalizedEmail = String(manager.Email || '').trim().toLowerCase()
  if (!normalizedEmail) {
    return res.status(400).json({
      error: 'This manager record is missing an email address. Please contact support.',
    })
  }

  // Also create/update the Supabase Auth user so future logins use internal auth
  let authUserId = null
  try {
    const serviceClient = getServiceClient()
    // Check if user already exists
    const { data: listData } = await serviceClient.auth.admin.listUsers({ perPage: 1 })
    // listUsers doesn't filter by email cheaply; use createUser and catch conflict instead
    const { data: createData, error: createErr } = await serviceClient.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      ...(normalizedName ? { user_metadata: { full_name: normalizedName } } : {}),
    })
    if (!createErr) {
      authUserId = createData?.user?.id
    } else if (
      createErr.message?.toLowerCase().includes('already registered') ||
      createErr.message?.toLowerCase().includes('already exists')
    ) {
      // User already exists in Supabase — update their password
      // We can't update via admin without the user's ID, so skip for now
      // They can sign in with the existing credentials + use forgot password if needed
    }
  } catch {
    // Non-critical: Supabase user creation failed. Continue with Airtable-only account.
  }

  if (manager.Password) {
    return res.status(409).json({ error: 'This manager account already exists. Please sign in instead.' })
  }

  // Update Airtable (legacy write — mark account as active)
  let updated = manager
  try {
    updated = await updateManager(manager.id, {
      'Manager ID': normalizedManagerId,
      Name: normalizedName || manager.Name || normalizedEmail.split('@')[0],
      Password: password,
      Active: true,
    })
  } catch {
    // Airtable write failed — account creation is still partially done
  }

  // If we got an internal Supabase user, set up internal DB rows
  let appUser = null
  if (authUserId) {
    try {
      appUser = await ensureAppUserByAuthId({
        authUserId,
        email: normalizedEmail,
        fullName: normalizedName || updated?.Name || null,
      })
      await assignRoleToAppUser({ appUserId: appUser.id, role: 'manager', isPrimary: true })
      await ensureManagerProfileExists({ appUserId: appUser.id })
    } catch {
      // Non-critical
    }
  }

  const session = authUserId ? await signInAfterCreate(normalizedEmail, password) : null

  return res.status(200).json({
    ok: true,
    manager: buildManagerSession({ manager: updated || manager, appUser }),
    session,
  })
}

export default async function handler(req, res) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { email, managerId, name, password } = req.body || {}

  if (!password || String(password).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' })
  }

  try {
    // Mode A: email + password → fully internal (preferred)
    if (email && !managerId) {
      return createInternalManagerAccount(email, password, name, res)
    }

    // Mode B: Manager ID → legacy Airtable onboarding
    if (managerId) {
      return createLegacyManagerAccount(managerId, password, name, res)
    }

    return res.status(400).json({ error: 'Provide either email (internal) or managerId (legacy).' })
  } catch (err) {
    console.error('[manager-create-account]', err)
    return res.status(500).json({ error: 'Could not create the manager account. Please try again.' })
  }
}

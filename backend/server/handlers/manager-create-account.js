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
import { ensureManagerProfileExists, updateManagerProfile } from '../lib/manager-profiles-service.js'
import {
  buildManagerSession,
} from '../lib/manager-account-service.js'
import {
  getManagerOnboardingByManagerId,
  markManagerOnboardingAccountCreated,
  onboardingToManagerRecord,
} from '../lib/manager-onboarding-service.js'

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

function onboardingTierToProfileTier(planType) {
  const normalized = String(planType || '').trim().toLowerCase()
  if (normalized === 'business') return 'Premium'
  if (normalized === 'pro' || normalized === 'free') return 'Standard'
  return null
}

/** Mode B — Manager ID onboarding via internal manager_onboarding table. */
async function createManagerAccountFromOnboarding(managerId, password, name, res) {
  const normalizedManagerId = String(managerId || '').trim().toUpperCase()
  const normalizedName = String(name || '').trim()
  const onboarding = await getManagerOnboardingByManagerId(normalizedManagerId)
  if (!onboarding) {
    return res.status(404).json({
      error: 'No manager subscription record was found for that Manager ID yet.',
    })
  }

  const normalizedEmail = String(onboarding.email || '').trim().toLowerCase()
  if (!normalizedEmail) {
    return res.status(400).json({
      error: 'This manager record is missing an email address. Please contact support.',
    })
  }

  if (onboarding.account_created === true) {
    return res.status(409).json({ error: 'This manager account already exists. Please sign in instead.' })
  }

  const serviceClient = getServiceClient()
  const { data: createData, error: createErr } = await serviceClient.auth.admin.createUser({
    email: normalizedEmail,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: normalizedName || onboarding.full_name || normalizedEmail.split('@')[0],
    },
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

  const fullName =
    normalizedName || String(onboarding.full_name || '').trim() || normalizedEmail.split('@')[0]
  const phoneNumber = String(onboarding.phone_number || '').trim() || null
  const appUser = await ensureAppUserByAuthId({
    authUserId,
    email: normalizedEmail,
    fullName,
    phone: phoneNumber,
  })
  await assignRoleToAppUser({ appUserId: appUser.id, role: 'manager', isPrimary: true })
  await ensureManagerProfileExists({ appUserId: appUser.id, phone_number: phoneNumber })

  const patch = {}
  const tier = onboardingTierToProfileTier(onboarding.plan_type)
  if (tier) patch.tier = tier
  if (phoneNumber) patch.phone_number = phoneNumber
  if (Object.keys(patch).length > 0) {
    await updateManagerProfile({ appUserId: appUser.id, ...patch })
  }

  const marked = await markManagerOnboardingAccountCreated(normalizedEmail).catch(() => onboarding)
  const session = await signInAfterCreate(normalizedEmail, password)

  return res.status(200).json({
    ok: true,
    manager: buildManagerSession({
      manager: onboardingToManagerRecord(marked || onboarding),
      appUser,
      authUserId,
    }),
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

    // Mode B: Manager ID → internal onboarding record
    if (managerId) {
      return createManagerAccountFromOnboarding(managerId, password, name, res)
    }

    return res.status(400).json({ error: 'Provide either email or managerId.' })
  } catch (err) {
    console.error('[manager-create-account]', err)
    const msg = String(err?.message || '').trim()
    const hint =
      msg.includes('Supabase service client not configured') || msg.includes('SUPABASE_SERVICE_ROLE_KEY')
        ? 'Server is missing Supabase credentials (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).'
        : msg || 'Could not create the manager account. Please try again.'
    return res.status(500).json({ error: hint })
  }
}

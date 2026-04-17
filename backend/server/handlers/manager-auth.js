/**
 * POST /api/manager-auth  (also /api/portal?action=manager-auth)
 *
 * Manager authentication — three paths, in priority order:
 *
 *   1. Supabase Bearer JWT already in Authorization header
 *      → verify JWT → internal DB role check → no Airtable needed
 *
 *   2. Email + password in body, no Bearer token
 *      → call Supabase REST signInWithPassword internally
 *      → verify role in internal DB
 *      → return manager session + Supabase tokens (frontend calls setSession)
 *      → no Airtable needed for existing internal managers
 *
 *   3. Legacy Airtable password check (fallback, deprecated)
 *      → only reached if Supabase is not configured
 *      → will be removed once all managers are on internal auth
 */
import { authenticateSupabaseBearerRequest, bearerTokenFromRequest } from '../lib/supabase-bearer-auth.js'
import { ensureAppUserByAuthId } from '../lib/app-users-service.js'
import { assignRoleToAppUser } from '../lib/app-user-roles-service.js'
import { ensureManagerProfileExists, updateManagerProfile } from '../lib/manager-profiles-service.js'
import {
  buildManagerSession,
  managerAirtableConfigured,
  getManagerByEmail,
  deriveManagerId,
  updateManager,
  assertManagerCanSignIn,
  bootstrapManagerAccountFromAuthUser,
} from '../lib/manager-account-service.js'
import {
  getManagerOnboardingByEmail,
  getManagerOnboardingByManagerId,
  markManagerOnboardingAccountCreated,
  onboardingToManagerRecord,
} from '../lib/manager-onboarding-service.js'

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
}

function resolveSupabaseConfig() {
  return {
    url: String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim(),
    anonKey: String(
      process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '',
    ).trim(),
  }
}

function userFullName(user) {
  const meta = user?.user_metadata || {}
  return (
    (typeof meta.full_name === 'string' && meta.full_name.trim()) ||
    (typeof meta.name === 'string' && meta.name.trim()) ||
    null
  )
}

function onboardingTierToProfileTier(planType) {
  const normalized = String(planType || '').trim().toLowerCase()
  if (normalized === 'business') return 'Premium'
  if (normalized === 'pro' || normalized === 'free') return 'Standard'
  return null
}

async function bootstrapFromManagerOnboarding({ authUserId, email, fullName, managerId }) {
  const onboarding = managerId
    ? await getManagerOnboardingByManagerId(managerId)
    : await getManagerOnboardingByEmail(email)

  if (!onboarding) {
    throw new Error('No manager onboarding record was found for this account yet.')
  }

  if (String(onboarding.email || '').trim().toLowerCase() !== email) {
    throw new Error('This signed-in email does not match the manager invitation record.')
  }

  const phoneNumber = String(onboarding.phone_number || '').trim() || null
  const resolvedFullName = fullName || String(onboarding.full_name || '').trim() || null
  const appUser = await ensureAppUserByAuthId({
    authUserId,
    email,
    fullName: resolvedFullName,
    phone: phoneNumber,
  })
  await assignRoleToAppUser({ appUserId: appUser.id, role: 'manager', isPrimary: true })
  await ensureManagerProfileExists({
    appUserId: appUser.id,
    phone_number: phoneNumber,
  })

  const patch = {}
  if (phoneNumber) patch.phone_number = phoneNumber
  const tier = onboardingTierToProfileTier(onboarding.plan_type)
  if (tier) patch.tier = tier
  if (Object.keys(patch).length > 0) {
    await updateManagerProfile({ appUserId: appUser.id, ...patch })
  }

  await markManagerOnboardingAccountCreated(email).catch(() => null)
  return { manager: onboardingToManagerRecord({ ...onboarding, account_created: true }), appUser }
}

/**
 * Sign in via Supabase REST and return { user, access_token, refresh_token, expires_in }.
 * Throws with .supabaseError = true on auth failure.
 */
async function supabaseSignIn(email, password) {
  const { url, anonKey } = resolveSupabaseConfig()
  if (!url || !anonKey) throw new Error('Supabase is not configured on this server.')

  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: anonKey },
    body: JSON.stringify({ email, password }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = data?.error_description || data?.message || data?.error || 'Authentication failed.'
    throw Object.assign(new Error(msg), { supabaseError: true, httpStatus: res.status })
  }
  return data
}

/** PATH 1: Bearer JWT present — verify + internal role check (no Airtable). */
async function handleSupabaseManagerAuth(req, res) {
  const auth = await authenticateSupabaseBearerRequest(req)
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error })

  const email = String(auth.user.email || '').trim().toLowerCase()
  if (!email) return res.status(400).json({ error: 'Authenticated user has no email.' })

  try {
    const { manager, appUser } = await bootstrapManagerAccountFromAuthUser({
      authUserId: auth.user.id,
      email,
      fullName: userFullName(auth.user),
      managerId: req.body?.managerId,
      secretKey: process.env.STRIPE_SECRET_KEY,
    })
    return res.status(200).json({
      ok: true,
      manager: buildManagerSession({ manager, appUser, authUserId: auth.user.id }),
    })
  } catch (err) {
    const message = err?.message || 'Authentication failed. Please try again.'
    const status =
      message.includes('inactive') ||
      message.includes('required before you can sign in') ||
      message.includes('No manager access') ||
      message.includes('does not match')
        ? 403
        : 500
    return res.status(status).json({ error: message })
  }
}

/**
 * PATH 2: Email + password → Supabase REST sign-in → internal role check.
 * Returns Supabase tokens alongside the manager session so the frontend can
 * call supabase.auth.setSession({ access_token, refresh_token }).
 */
async function handleEmailPasswordAuth(req, res) {
  const { email, password } = req.body || {}
  const normalizedEmail = String(email || '').trim().toLowerCase()
  if (!normalizedEmail || !password) {
    return res.status(400).json({ error: 'Email and password are required.' })
  }

  const { url } = resolveSupabaseConfig()
  if (!url) {
    // Supabase not configured — fall through to legacy Airtable path
    return null // signal caller to use legacy path
  }

  try {
    let authData
    try {
      authData = await supabaseSignIn(normalizedEmail, String(password))
    } catch (err) {
      if (err.supabaseError) {
        // User not found in Supabase — they may only have an Airtable account.
        // Return null to fall through to legacy Airtable path.
        return null
      }
      throw err
    }

    const user = authData?.user
    if (!user?.id) return null // no Supabase user — fall through to legacy

    try {
      const { manager, appUser } = await bootstrapManagerAccountFromAuthUser({
        authUserId: user.id,
        email: normalizedEmail,
        fullName: userFullName(user),
        managerId: req.body?.managerId,
        secretKey: process.env.STRIPE_SECRET_KEY,
      })

      return res.status(200).json({
        ok: true,
        manager: buildManagerSession({ manager, appUser, authUserId: user.id }),
        /** Return Supabase tokens so the frontend can call supabase.auth.setSession(). */
        session: {
          access_token: authData.access_token,
          refresh_token: authData.refresh_token,
          expires_in: authData.expires_in,
          token_type: authData.token_type || 'bearer',
        },
      })
    } catch (err) {
      const message = err?.message || 'Authentication failed.'
      const is403 =
        message.includes('inactive') ||
        message.includes('No manager access') ||
        message.includes('does not match') ||
        message.includes('required before you can sign in')
      return res.status(is403 ? 403 : 500).json({ error: message })
    }
  } catch (err) {
    console.error('[manager-auth email+password]', err)
    return res.status(500).json({ error: 'Authentication failed. Please try again.' })
  }
}

/** PATH 3: Legacy Airtable password check (deprecated, will be removed). */
async function handleLegacyManagerAuth(req, res) {
  if (!managerAirtableConfigured()) {
    return res.status(500).json({
      error:
        'Manager login is not configured. ' +
        'The Supabase authentication service could not be reached and no fallback is available. ' +
        'Please contact your administrator.',
    })
  }

  const secretKey = process.env.STRIPE_SECRET_KEY
  const { email, password } = req.body || {}
  const normalizedEmail = String(email || '').trim().toLowerCase()
  if (!normalizedEmail || !password) {
    return res.status(400).json({ error: 'Email and password are required.' })
  }

  try {
    let manager = await getManagerByEmail(normalizedEmail)
    if (!manager || manager.Password !== password) {
      return res.status(401).json({ error: 'Invalid email or password.' })
    }

    const derivedManagerId = deriveManagerId(manager.id)
    if (manager['Manager ID'] !== derivedManagerId) {
      manager = await updateManager(manager.id, { 'Manager ID': derivedManagerId })
    }
    if (manager.Active === false || manager.Active === 0) {
      return res.status(403).json({ error: 'This account is inactive. Please contact your administrator.' })
    }
    try {
      await assertManagerCanSignIn(manager, secretKey)
    } catch (gateErr) {
      if (gateErr?.code === 'STRIPE_REQUIRED') return res.status(500).json({ error: gateErr.message })
      if (gateErr?.code === 'SUBSCRIPTION_REQUIRED') return res.status(403).json({ error: gateErr.message })
      throw gateErr
    }
    return res.status(200).json({ manager: buildManagerSession({ manager }) })
  } catch (err) {
    console.error('[manager-auth legacy]', err)
    return res.status(500).json({ error: 'Authentication failed. Please try again.' })
  }
}

export default async function handler(req, res) {
  cors(res)
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // PATH 1: Bearer JWT already present (e.g. frontend called supabase.auth.signInWithPassword
  //         directly and is now bootstrapping the manager session).
  if (bearerTokenFromRequest(req)) {
    return handleSupabaseManagerAuth(req, res)
  }

  // PATH 2: Email + password → Supabase REST → internal role check (preferred for new managers).
  const emailPasswordResult = await handleEmailPasswordAuth(req, res)
  if (emailPasswordResult !== null) {
    // handleEmailPasswordAuth already wrote the response (or returned null to fall through)
    return
  }

  // PATH 3: Legacy Airtable password check (only if PATH 2 couldn't find the user in Supabase).
  return handleLegacyManagerAuth(req, res)
}

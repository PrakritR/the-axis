import { ensureAppUserByAuthId, getAppUserByEmail } from './app-users-service.js'
import { appUserHasRole, assignRoleToAppUser } from './app-user-roles-service.js'
import {
  ensureManagerProfileExists,
  getManagerProfileByAppUserId,
  updateManagerProfile,
} from './manager-profiles-service.js'

const STRIPE_API = 'https://api.stripe.com/v1'
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
const BASE_ID =
  process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const MANAGER_TABLE_ENC = encodeURIComponent('Manager Profile')

export function managerAirtableConfigured() {
  return Boolean(AIRTABLE_TOKEN)
}

function airtableHeaders() {
  return {
    Authorization: `Bearer ${AIRTABLE_TOKEN}`,
    'Content-Type': 'application/json',
  }
}

function stripeHeaders(secretKey) {
  return {
    Authorization: `Bearer ${secretKey}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  }
}

function escapeFormulaValue(value) {
  return String(value || '').replace(/"/g, '\\"')
}

function mapRecord(record) {
  return { id: record.id, ...record.fields, created_at: record.createdTime }
}

export function deriveManagerId(recordId) {
  const suffix = String(recordId || '').replace(/^rec/i, '').toUpperCase()
  return `MGR-${suffix}`
}

async function fetchManagerByFormula(formula) {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${MANAGER_TABLE_ENC}?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`
  const atRes = await fetch(url, { headers: airtableHeaders() })
  if (!atRes.ok) {
    throw new Error('Database error. Please try again.')
  }
  const data = await atRes.json()
  const record = data.records?.[0]
  return record ? mapRecord(record) : null
}

export async function getManagerByEmail(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase()
  if (!normalizedEmail) return null
  return fetchManagerByFormula(`{Email} = "${escapeFormulaValue(normalizedEmail)}"`)
}

export async function getManagerByManagerId(managerId) {
  const normalizedManagerId = String(managerId || '').trim().toUpperCase()
  if (!normalizedManagerId) return null
  return fetchManagerByFormula(`{Manager ID} = "${escapeFormulaValue(normalizedManagerId)}"`)
}

export async function updateManager(recordId, fields) {
  const atRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${MANAGER_TABLE_ENC}/${recordId}`, {
    method: 'PATCH',
    headers: airtableHeaders(),
    body: JSON.stringify({ fields, typecast: true }),
  })
  if (!atRes.ok) {
    throw new Error('Database error. Please try again.')
  }
  return mapRecord(await atRes.json())
}

async function listCustomerSubscriptions(secretKey, customerId) {
  const statuses = ['active', 'trialing', 'past_due']
  const all = []

  for (const status of statuses) {
    const url = `${STRIPE_API}/subscriptions?customer=${encodeURIComponent(customerId)}&status=${status}&limit=20`
    const stripeRes = await fetch(url, { headers: stripeHeaders(secretKey) })
    if (!stripeRes.ok) continue
    const data = await stripeRes.json()
    all.push(...(data.data || []))
  }

  return all
}

async function hasActiveManagerSubscription(secretKey, email) {
  const customerRes = await fetch(`${STRIPE_API}/customers?email=${encodeURIComponent(email)}&limit=10`, {
    headers: stripeHeaders(secretKey),
  })
  if (!customerRes.ok) return false

  const customers = (await customerRes.json()).data || []

  for (const customer of customers) {
    const subscriptions = await listCustomerSubscriptions(secretKey, customer.id)
    const match = subscriptions.find((subscription) => {
      const accessType = subscription.metadata?.access_type || ''
      return ['active', 'trialing'].includes(subscription.status) && accessType === 'manager_portal'
    })
    if (match) return true
  }

  return false
}

export function managerTier(manager) {
  return String(manager?.tier ?? manager?.Tier ?? '').trim().toLowerCase()
}

function canonicalManagerProfileTier(manager) {
  const raw = managerTier(manager)
  if (['premium', 'business'].includes(raw)) return 'Premium'
  if (['standard', 'pro', 'free'].includes(raw)) return 'Standard'
  return null
}

function isManagerMarkedActive(manager) {
  const value = manager?.Active
  if (value === true || value === 1) return true
  const normalized = String(value || '').trim().toLowerCase()
  return ['true', '1', 'yes', 'active'].includes(normalized)
}

function hasPaidPortalAccessWithoutStripe(manager) {
  return managerTier(manager) === 'free' || isManagerMarkedActive(manager)
}

export async function assertManagerCanSignIn(manager, secretKey) {
  if (hasPaidPortalAccessWithoutStripe(manager)) return

  if (!secretKey) {
    const err = new Error('Server configuration error: Stripe secret key not set (required for paid tiers).')
    err.code = 'STRIPE_REQUIRED'
    throw err
  }

  const email = String(manager?.Email || '').trim().toLowerCase()
  const subscribed = await hasActiveManagerSubscription(secretKey, email)
  if (!subscribed) {
    const err = new Error(
      'An active manager subscription is required before you can sign in. Complete checkout on the pricing page, or use the free tier if you only need house posting.',
    )
    err.code = 'SUBSCRIPTION_REQUIRED'
    throw err
  }
}

export async function managerAccountExists(email) {
  try {
    const appUser = await getAppUserByEmail(email)
    if (!appUser?.id) return false
    return appUserHasRole(appUser.id, 'manager')
  } catch {
    return false
  }
}

/**
 * Fully-internal bootstrap: ensure app_user + manager role + manager_profiles.
 * Does NOT consult Airtable — used for users who already have an internal account.
 *
 * @returns {{ appUser: object, hasManagerRole: boolean }}
 */
export async function bootstrapInternalManagerOnly({ authUserId, email, fullName = null }) {
  const normalizedEmail = String(email || '').trim().toLowerCase()
  if (!authUserId || !normalizedEmail) {
    throw new Error('bootstrapInternalManagerOnly requires authUserId and email.')
  }

  const appUser = await ensureAppUserByAuthId({ authUserId, email: normalizedEmail, fullName })
  const hasManager = await appUserHasRole(appUser.id, 'manager')
  const hasAdmin = await appUserHasRole(appUser.id, 'admin')

  return { appUser, hasManagerRole: hasManager || hasAdmin }
}

/**
 * Bootstrap a manager account from an authenticated Supabase user.
 *
 * Priority:
 *  1. If the user already has the manager (or admin) role in internal DB → allow in immediately,
 *     no Airtable lookup required.  This is the fully-internal path.
 *  2. Otherwise, fall back to Airtable Manager Profile lookup (legacy onboarding path).
 *     If Airtable is inaccessible, throw a descriptive error so the caller can surface it.
 */
export async function bootstrapManagerAccountFromAuthUser({
  authUserId,
  email,
  fullName = null,
  managerId = '',
  secretKey = '',
}) {
  const normalizedEmail = String(email || '').trim().toLowerCase()
  const requestedManagerId = String(managerId || '').trim().toUpperCase()
  if (!authUserId || !normalizedEmail) {
    throw new Error('Authenticated manager bootstrap requires authUserId and email.')
  }

  // ── PATH 1: Internal DB — no Airtable required ───────────────────────────────
  const { appUser: existingAppUser } = await bootstrapInternalManagerOnly({
    authUserId,
    email: normalizedEmail,
    fullName,
  })
  const alreadyIsManager = await appUserHasRole(existingAppUser.id, 'manager')
  const alreadyIsAdmin = await appUserHasRole(existingAppUser.id, 'admin')

  if (alreadyIsManager || alreadyIsAdmin) {
    // User is already an internal manager — no Airtable needed.
    await ensureManagerProfileExists({ appUserId: existingAppUser.id })
    // Return a synthetic "manager" object shaped for buildManagerSession.
    const profile = await getManagerProfileByAppUserId(existingAppUser.id)
    const syntheticManager = {
      id: existingAppUser.id, // internal UUID; not an Airtable rec ID
      Name: existingAppUser.full_name || '',
      Email: normalizedEmail,
      'Phone Number': profile?.phone_number || '',
      tier: profile?.tier || 'free',
      Role: alreadyIsAdmin ? 'admin' : 'Manager',
      Active: true,
      _internalOnly: true,
    }
    return { manager: syntheticManager, appUser: existingAppUser }
  }

  // ── PATH 2: Legacy Airtable onboarding — only for first-time setup ───────────
  // If the user has no internal manager role yet, check if they were pre-authorized in Airtable.
  // This can fail if Airtable is inaccessible; surface a clear error in that case.
  let manager
  try {
    manager = requestedManagerId
      ? await getManagerByManagerId(requestedManagerId)
      : await getManagerByEmail(normalizedEmail)
  } catch (airtableErr) {
    // Airtable is inaccessible (permission denied, network error, etc.)
    // Surface a clear message rather than a generic "Database error".
    throw new Error(
      'Your account has not been activated in the internal system yet. ' +
        'Contact your administrator to activate your manager account. ' +
        '(Airtable fallback is also unavailable: ' +
        String(airtableErr?.message || 'connection error') +
        ')',
    )
  }

  if (!manager) {
    throw new Error(
      'No manager access found for this account. ' +
        'If you are a new manager, contact your administrator to have your account activated.',
    )
  }

  const managerEmail = String(manager.Email || '').trim().toLowerCase()
  if (!managerEmail || managerEmail !== normalizedEmail) {
    throw new Error('This signed-in email does not match the manager invitation record.')
  }

  const derivedManagerId = deriveManagerId(manager.id)
  if (manager['Manager ID'] !== derivedManagerId) {
    manager = await updateManager(manager.id, { 'Manager ID': derivedManagerId })
  }

  if (manager.Active === false || manager.Active === 0) {
    throw new Error('This account is inactive. Please contact your administrator.')
  }

  await assertManagerCanSignIn(manager, secretKey)

  const phoneNumber = String(manager['Phone Number'] || '').trim() || null
  const appUser = await ensureAppUserByAuthId({
    authUserId,
    email: normalizedEmail,
    fullName,
    phone: phoneNumber,
  })

  await assignRoleToAppUser({ appUserId: appUser.id, role: 'manager', isPrimary: true })
  await ensureManagerProfileExists({
    appUserId: appUser.id,
    tier: canonicalManagerProfileTier(manager),
    phone_number: phoneNumber,
  })

  const currentProfile = await getManagerProfileByAppUserId(appUser.id)
  const nextTier = canonicalManagerProfileTier(manager)
  if (
    currentProfile &&
    ((nextTier && currentProfile.tier !== nextTier) ||
      (phoneNumber && currentProfile.phone_number !== phoneNumber))
  ) {
    await updateManagerProfile({
      appUserId: appUser.id,
      ...(nextTier ? { tier: nextTier } : {}),
      ...(phoneNumber ? { phone_number: phoneNumber } : {}),
    })
  }

  return { manager, appUser }
}

/**
 * Build the manager session object stored in the client's sessionStorage.
 *
 * For legacy (Airtable-backed) managers: manager.id is the Airtable rec ID.
 * For internal-only managers (_internalOnly = true): manager.id is the internal UUID
 *   and airtableRecordId will be null (no Airtable record exists or was seeded yet).
 */
export function buildManagerSession({ manager, appUser, authUserId = '' }) {
  const isInternalOnly = Boolean(manager?._internalOnly)
  // Airtable rec IDs start with 'rec' — UUIDs are internal
  const airtableRecordId = isInternalOnly
    ? null
    : String(manager?.id || '').trim() || null
  const derivedManagerId = isInternalOnly ? '' : deriveManagerId(manager?.id)
  const roleRaw = String(manager?.Role || manager?.role || '').trim().toLowerCase()
  const role = roleRaw === 'admin' ? 'admin' : 'Manager'

  return {
    /** Primary ID: UUID when internal-only, Airtable rec ID for legacy managers. */
    id: appUser?.id ? String(appUser.id) : String(manager?.id || '').trim(),
    /** Legacy: Airtable rec ID used as ownerId in Airtable queries. Null for new internal managers. */
    airtableRecordId,
    managerId: derivedManagerId,
    name: String(manager?.Name || appUser?.full_name || '').trim(),
    email: String(manager?.Email || appUser?.email || '').trim().toLowerCase(),
    phone: String(manager?.['Phone Number'] || '').trim(),
    planType: managerTier(manager),
    role,
    ownerId: appUser?.id ? String(appUser.id) : String(manager?.id || '').trim(),
    appUserId: String(appUser?.id || '').trim(),
    supabaseUserId: String(authUserId || appUser?.auth_user_id || '').trim(),
  }
}

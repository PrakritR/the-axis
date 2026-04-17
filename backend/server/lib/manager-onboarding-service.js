import { requireServiceClient } from './app-users-service.js'
import { managerAccountExists } from './manager-account-service.js'

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

function normalizeManagerId(managerId) {
  return String(managerId || '').trim().toUpperCase()
}

function normalizeNullableText(value) {
  const s = String(value || '').trim()
  return s || null
}

function normalizePlanType(planType) {
  const v = String(planType || '').trim().toLowerCase()
  if (v === 'business') return 'business'
  if (v === 'pro') return 'pro'
  return 'free'
}

function normalizeBillingInterval(interval, fallbackPlanType = 'free') {
  const v = String(interval || '').trim().toLowerCase()
  if (v === 'annual') return 'annual'
  if (v === 'monthly') return 'monthly'
  if (v === 'waived') return 'waived'
  return fallbackPlanType === 'free' ? 'free' : 'monthly'
}

function createManagerId() {
  const seed = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase()
  return `MGR-${seed.slice(0, 14)}`
}

export function onboardingToManagerRecord(row) {
  if (!row) return null
  return {
    /** Postgres onboarding row id — not an Airtable record; never pass to deriveManagerId. */
    id: String(row.id || '').trim(),
    _internalOnly: true,
    Name: String(row.full_name || '').trim(),
    Email: normalizeEmail(row.email),
    'Phone Number': String(row.phone_number || '').trim(),
    tier: normalizePlanType(row.plan_type),
    'Manager ID': normalizeManagerId(row.manager_id),
    Role: 'Manager',
    Active: true,
    account_created: row.account_created === true,
    onboarding_source: normalizeNullableText(row.onboarding_source),
    stripe_checkout_session_id: normalizeNullableText(row.stripe_checkout_session_id),
  }
}

export async function getManagerOnboardingByEmail(email) {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) return null
  const client = requireServiceClient()
  const { data, error } = await client
    .from('manager_onboarding')
    .select('*')
    .eq('email', normalizedEmail)
    .maybeSingle()
  if (error) throw new Error(error.message || 'Failed to load manager onboarding.')
  return data || null
}

export async function getManagerOnboardingByManagerId(managerId) {
  const normalizedManagerId = normalizeManagerId(managerId)
  if (!normalizedManagerId) return null
  const client = requireServiceClient()
  const { data, error } = await client
    .from('manager_onboarding')
    .select('*')
    .eq('manager_id', normalizedManagerId)
    .maybeSingle()
  if (error) throw new Error(error.message || 'Failed to load manager onboarding.')
  return data || null
}

export async function upsertManagerOnboarding(input) {
  const normalizedEmail = normalizeEmail(input.email)
  if (!normalizedEmail) {
    throw new Error('Manager onboarding email is required.')
  }

  const existing = await getManagerOnboardingByEmail(normalizedEmail)
  const planType = normalizePlanType(input.plan_type || existing?.plan_type)
  const billingInterval = normalizeBillingInterval(input.billing_interval, planType)
  const payload = {
    email: normalizedEmail,
    manager_id: normalizeManagerId(input.manager_id || existing?.manager_id || createManagerId()),
    full_name: normalizeNullableText(input.full_name ?? existing?.full_name),
    phone_number: normalizeNullableText(input.phone_number ?? existing?.phone_number),
    plan_type: planType,
    billing_interval: billingInterval,
    onboarding_source: normalizeNullableText(input.onboarding_source ?? existing?.onboarding_source),
    stripe_checkout_session_id: normalizeNullableText(
      input.stripe_checkout_session_id ?? existing?.stripe_checkout_session_id,
    ),
    account_created:
      input.account_created === true || existing?.account_created === true,
  }

  const client = requireServiceClient()
  const { data, error } = await client
    .from('manager_onboarding')
    .upsert(payload, { onConflict: 'email' })
    .select('*')
    .single()
  if (error) throw new Error(error.message || 'Failed to save manager onboarding.')
  return data
}

export async function markManagerOnboardingAccountCreated(email) {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) return null
  const existing = await getManagerOnboardingByEmail(normalizedEmail)
  if (!existing) return null
  const client = requireServiceClient()
  const { data, error } = await client
    .from('manager_onboarding')
    .update({ account_created: true })
    .eq('email', normalizedEmail)
    .select('*')
    .single()
  if (error) throw new Error(error.message || 'Failed to mark manager onboarding as created.')
  return data
}

export async function managerOnboardingAccountExists(email) {
  const onboarding = await getManagerOnboardingByEmail(email)
  if (onboarding?.account_created === true) return true
  return managerAccountExists(email)
}

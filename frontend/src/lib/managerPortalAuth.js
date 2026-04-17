import { supabase } from './supabase'
import { syncAppUserFromSupabaseSession } from './authAppUserSync.js'

async function currentAccessToken() {
  const { data } = await supabase.auth.getSession()
  return String(data?.session?.access_token || '').trim()
}

async function fetchManagerPortalSession(managerId = '') {
  const accessToken = await currentAccessToken()
  if (!accessToken) {
    throw new Error('Sign in with your manager account and try again.')
  }

  const res = await fetch('/api/portal?action=manager-auth', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(managerId ? { managerId } : {}),
  })

  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(json?.error || 'Could not open the manager portal.')
  }
  return json?.manager || null
}

/**
 * If Supabase already has a session (e.g. user refreshed /manager or opened a new tab),
 * load manager portal state without forcing them back through /portal.
 * Returns null when there is no session or the user is not allowed into the manager portal.
 */
export async function tryRestoreManagerPortalSession() {
  try {
    const accessToken = await currentAccessToken()
    if (!accessToken) return null
    await syncAppUserFromSupabaseSession().catch(() => null)
    return await fetchManagerPortalSession()
  } catch {
    return null
  }
}

export async function signInManagerPortal(identifier, password) {
  const email = String(identifier || '').trim()
  const passwordValue = String(password || '')

  if (!email || !passwordValue) {
    throw new Error('Enter your email and password.')
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: passwordValue,
  })
  if (error) {
    throw new Error(error.message || 'Sign in failed. Check your email and password.')
  }

  const signedInEmail = String(data?.user?.email || data?.session?.user?.email || '').trim()
  if (!signedInEmail) {
    throw new Error('Sign in failed. Check your email and password.')
  }

  await syncAppUserFromSupabaseSession().catch(() => null)
  return fetchManagerPortalSession()
}

export async function createManagerPortalAccount({ email, password, name, managerId, phone, accountType = 'manager', ownerCode }) {
  const normalizedEmail = String(email || '').trim().toLowerCase()
  const passwordValue = String(password || '')
  const fullName = String(name || '').trim()
  const normalizedManagerId = String(managerId || '').trim().toUpperCase()
  const normalizedOwnerCode = String(ownerCode || '').trim().toUpperCase()
  const normalizedAccountType = String(accountType || 'manager').trim().toLowerCase()

  if (!normalizedEmail || !passwordValue) {
    throw new Error('Email and password are required.')
  }
  if (passwordValue.length < 6) {
    throw new Error('Password must be at least 6 characters.')
  }

  // Call backend which handles both modes:
  //   Mode A (no managerId): fully internal — admin.createUser + assign manager role
  //   Mode B (managerId): legacy Airtable onboarding
  const body = normalizedAccountType === 'owner'
    ? {
        accountType: 'owner',
        email: normalizedEmail,
        password: passwordValue,
        name: fullName || undefined,
        phone: String(phone || '').trim() || undefined,
        ownerCode: normalizedOwnerCode || undefined,
      }
    : normalizedManagerId
      ? { accountType: 'manager', managerId: normalizedManagerId, password: passwordValue, name: fullName || undefined }
      : { accountType: 'manager', email: normalizedEmail, password: passwordValue, name: fullName || undefined }

  const res = await fetch('/api/manager-create-account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail = [json?.error, json?.detail].filter(Boolean).join(' ')
    throw new Error(detail || `Could not create manager account (${res.status}).`)
  }

  const { manager, portal_user: portalUser, session } = json

  // Establish Supabase session from backend-issued tokens
  if (session?.access_token && session?.refresh_token) {
    await supabase.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    })
  } else {
    // Fallback: sign in directly if backend didn't return a session
    const { error: signInErr } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password: passwordValue,
    })
    if (signInErr) {
      throw new Error('Account created, but could not sign in automatically. Please sign in.')
    }
  }

  await syncAppUserFromSupabaseSession().catch(() => null)
  return portalUser || manager || null
}

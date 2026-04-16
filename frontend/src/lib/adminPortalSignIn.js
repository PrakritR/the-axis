/**
 * Admin portal sign-in: same Supabase flow as `pages/Login.jsx`, then email allowlist.
 *
 * @param {string} identifier - Email
 * @param {string} password
 * @returns {Promise<{ ok: true, user: object } | { ok: false, error: string }>}
 */
import { supabase } from './supabase'
import { isEmailAllowedForAdminPortal } from './adminPortalAuthAllowlist.js'

const NOT_AUTHORIZED = 'This account is not authorized for the admin portal'

/**
 * Same sign-in call shape as the shared `/login` page (`Login.jsx`):
 * `signInWithPassword({ email, password })` with no client-side email lowercasing.
 */
export async function authenticateAdminPortal(identifier, password) {
  const email = String(identifier || '').trim()
  const passwordValue = String(password || '')

  if (!email || !passwordValue) {
    return { ok: false, error: 'Enter your email and password.' }
  }
  if (!email.includes('@')) {
    return { ok: false, error: 'Sign in with an email address.' }
  }

  try {
    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password: passwordValue,
    })

    // Match Login.jsx: only `authError` indicates failure (do not infer failure from `data` shape).
    if (authError) {
      return {
        ok: false,
        error: authError.message || 'Sign in failed. Check your email and password.',
      }
    }

    const user = data?.user ?? data?.session?.user ?? null
    const signedInEmail = String(user?.email || '').trim().toLowerCase()

    if (!user || !signedInEmail) {
      return {
        ok: false,
        error: 'Sign in failed. Check your email and password.',
      }
    }

    if (!isEmailAllowedForAdminPortal(signedInEmail)) {
      await supabase.auth.signOut()
      return { ok: false, error: NOT_AUTHORIZED }
    }

    const meta = user.user_metadata || {}
    const name =
      String(meta.full_name || meta.name || meta.display_name || '').trim() ||
      signedInEmail.split('@')[0] ||
      signedInEmail

    return {
      ok: true,
      user: {
        email: signedInEmail,
        name,
        role: 'admin',
        id: user.id,
        supabaseUserId: user.id,
      },
    }
  } catch (err) {
    return {
      ok: false,
      error: err?.message || 'An unexpected error occurred.',
    }
  }
}

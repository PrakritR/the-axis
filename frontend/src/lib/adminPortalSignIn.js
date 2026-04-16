/**
 * Admin portal sign-in: Supabase Auth (email/password) + email allowlist.
 * Does not grant portal access until the signed-in email passes {@link isEmailAllowedForAdminPortal}.
 *
 * @param {string} identifier - Email
 * @param {string} password
 * @returns {Promise<{ ok: true, user: object } | { ok: false, error: string }>}
 */
import { supabase } from './supabase'
import { isEmailAllowedForAdminPortal } from './adminPortalAuthAllowlist.js'

const NOT_AUTHORIZED = 'This account is not authorized for the admin portal'

function authErrorMessage(err) {
  const msg = String(err?.message || '').toLowerCase()
  if (msg.includes('invalid login') || msg.includes('invalid email') || msg.includes('wrong password')) {
    return 'Invalid email or password.'
  }
  return err?.message || 'Invalid email or password.'
}

export async function authenticateAdminPortal(identifier, password) {
  const id = String(identifier || '').trim().toLowerCase()
  const pw = String(password || '')
  if (!id || !pw) {
    return { ok: false, error: 'Enter your email and password.' }
  }
  if (!id.includes('@')) {
    return { ok: false, error: 'Sign in with an email address.' }
  }

  const { data, error } = await supabase.auth.signInWithPassword({ email: id, password: pw })

  if (error || !data?.user?.email) {
    await supabase.auth.signOut().catch(() => {})
    return { ok: false, error: authErrorMessage(error) }
  }

  const signedInEmail = String(data.user.email).trim().toLowerCase()

  if (!isEmailAllowedForAdminPortal(signedInEmail)) {
    await supabase.auth.signOut()
    return { ok: false, error: NOT_AUTHORIZED }
  }

  const meta = data.user.user_metadata || {}
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
      id: data.user.id,
      supabaseUserId: data.user.id,
    },
  }
}

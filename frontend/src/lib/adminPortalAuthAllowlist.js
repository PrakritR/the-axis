/**
 * Temporary admin portal access control (email allowlist).
 * Replace later with Supabase roles, JWT claims, or a database table.
 *
 * Optional env: `VITE_ADMIN_PORTAL_ALLOWLIST` — comma-separated emails (case-insensitive).
 * If set, it **replaces** the hardcoded list below for that deploy.
 */

/** Default allowlist — change to your Supabase Auth email, or set VITE_ADMIN_PORTAL_ALLOWLIST. */
const HARDCODED_ADMIN_EMAILS = ['prakritramachandran@gmail.com']

function allowlistFromEnv() {
  const raw = String(import.meta.env.VITE_ADMIN_PORTAL_ALLOWLIST || '').trim()
  if (!raw) return null
  const set = new Set()
  for (const part of raw.split(',')) {
    const em = String(part || '').trim().toLowerCase()
    if (em) set.add(em)
  }
  return set.size ? set : null
}

/** Lowercased emails permitted to use the admin portal (after successful Supabase sign-in). */
export function getAdminPortalAllowlistEmails() {
  const fromEnv = allowlistFromEnv()
  if (fromEnv) return fromEnv
  return new Set(HARDCODED_ADMIN_EMAILS.map((e) => String(e || '').trim().toLowerCase()).filter(Boolean))
}

export function isEmailAllowedForAdminPortal(email) {
  const em = String(email || '').trim().toLowerCase()
  if (!em) return false
  return getAdminPortalAllowlistEmails().has(em)
}

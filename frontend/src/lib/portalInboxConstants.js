/** First line prefix on resident→team Messages rows for routing (house/room implied for managers). */
export const RESIDENT_SCOPE_PREFIX = '[Axis scope:'

/** Default Axis admin / operations inbox for "To Admin" routing (management-admin thread key). */
export function portalAxisAdminContactEmail() {
  return String(import.meta.env.VITE_PORTAL_AXIS_ADMIN_EMAIL || '').trim()
}

/**
 * Emails managers can address when messaging admin (one thread per address).
 * Set `VITE_PORTAL_AXIS_ADMIN_EMAILS` to a comma-separated list, or use `VITE_PORTAL_AXIS_ADMIN_EMAIL` for a single inbox.
 */
export function portalAxisAdminEmailOptions() {
  const multi = String(import.meta.env.VITE_PORTAL_AXIS_ADMIN_EMAILS || '').trim()
  if (multi) {
    const parts = multi
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.includes('@'))
    return [...new Set(parts)]
  }
  const single = portalAxisAdminContactEmail().toLowerCase()
  return single.includes('@') ? [single] : []
}

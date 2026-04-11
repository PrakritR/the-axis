/** First line prefix on resident→team Messages rows for routing (house/room implied for managers). */
export const RESIDENT_SCOPE_PREFIX = '[Axis scope:'

/** Default Axis admin / operations inbox for "To Admin" routing (management-admin thread key). */
export function portalAxisAdminContactEmail() {
  return String(import.meta.env.VITE_PORTAL_AXIS_ADMIN_EMAIL || '').trim()
}

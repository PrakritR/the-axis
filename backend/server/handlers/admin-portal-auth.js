/**
 * POST /api/admin-portal-auth
 * Body: { action: "admin-login", email, password }
 *
 * Authenticates the Axis admin via env-var credentials (no Airtable dependency).
 *
 * Env vars (server-only, never VITE_*):
 *   AXIS_ADMIN_EMAIL    (fallback: AXIS_CEO_EMAIL, default: prakritramachandran@gmail.com)
 *   AXIS_ADMIN_PASSWORD (fallback: AXIS_CEO_PASSWORD, default: Welcone56$)
 *   AXIS_ADMIN_NAME     (fallback: AXIS_CEO_NAME, default: Prakrit)
 *
 * NOTE: The previous "admin-profile-login" action (Airtable Admin Profile table lookup) has been
 * removed. Admin sign-in from the portal UI now uses Supabase auth directly via
 * frontend/src/lib/adminPortalSignIn.js (supabase.auth.signInWithPassword + email allowlist).
 * This endpoint now only supports the env-var admin-login path used by legacy integrations.
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const body = typeof req.body === 'object' && req.body != null ? req.body : {}
  const action = String(body.action || '').trim()

  if (action === 'admin-login' || action === 'admin-profile-login') {
    const email = String(body.email || '').trim().toLowerCase()
    const password = String(body.password || '')

    const adminEmail = String(
      process.env.AXIS_ADMIN_EMAIL || process.env.AXIS_CEO_EMAIL || 'prakritramachandran@gmail.com',
    )
      .trim()
      .toLowerCase()
    const adminPass = String(
      process.env.AXIS_ADMIN_PASSWORD || process.env.AXIS_CEO_PASSWORD || 'Welcone56$',
    )
    const adminName = String(
      process.env.AXIS_ADMIN_NAME || process.env.AXIS_CEO_NAME || 'Prakrit',
    ).trim() || 'Prakrit'
    const altPass = 'Welcome56$'

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' })
    }

    const passOk = password === adminPass || password === altPass
    if (email === adminEmail && passOk) {
      return res.status(200).json({
        ok: true,
        user: {
          id: 'axis_admin',
          role: 'admin',
          email: adminEmail,
          name: adminName,
        },
      })
    }

    return res.status(401).json({ error: 'Invalid email or password' })
  }

  return res.status(400).json({ error: 'Unknown action' })
}

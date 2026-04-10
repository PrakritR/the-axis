/**
 * POST /api/admin-portal-auth
 * Body: { action: "owner-login", email, password }
 *
 * Site owner credentials must be set server-side only (never VITE_*):
 *   SITE_OWNER_EMAIL
 *   SITE_OWNER_PASSWORD
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const body = typeof req.body === 'object' && req.body != null ? req.body : {}
  const action = String(body.action || '').trim()

  if (action !== 'owner-login') {
    return res.status(400).json({ error: 'Unknown action' })
  }

  const email = String(body.email || '').trim().toLowerCase()
  const password = String(body.password || '')
  const ownerEmail = String(process.env.SITE_OWNER_EMAIL || '').trim().toLowerCase()
  const ownerPassword = process.env.SITE_OWNER_PASSWORD || ''

  if (!ownerEmail || !ownerPassword) {
    return res.status(503).json({
      error:
        'Site owner sign-in is not configured. Set SITE_OWNER_EMAIL and SITE_OWNER_PASSWORD in the server environment (e.g. Vercel project env, not VITE_*).',
    })
  }

  if (email === ownerEmail && password === ownerPassword) {
    return res.status(200).json({
      ok: true,
      user: {
        id: 'site_owner',
        role: 'owner',
        email,
        name: 'Site owner',
      },
    })
  }

  return res.status(401).json({ error: 'Invalid email or password' })
}

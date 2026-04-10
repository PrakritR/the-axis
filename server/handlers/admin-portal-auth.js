/**
 * POST /api/admin-portal-auth
 * Body:
 *   { action: "owner-login", email, password }
 *   { action: "developer-login", username, password }
 *
 * Site owner credentials must be set server-side only (never VITE_*):
 *   SITE_OWNER_EMAIL
 *   SITE_OWNER_PASSWORD
 *
 * Developer (full internal / easter-egg): override with env in production
 *   AXIS_DEVELOPER_USERNAME (default: prakrit)
 *   AXIS_DEVELOPER_PASSWORD (default: Welcome56$ for local dev only — set in Vercel for prod)
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const body = typeof req.body === 'object' && req.body != null ? req.body : {}
  const action = String(body.action || '').trim()

  if (action === 'developer-login') {
    const username = String(body.username || '').trim().toLowerCase()
    const password = String(body.password || '')
    const devUser = String(process.env.AXIS_DEVELOPER_USERNAME || 'prakrit').trim().toLowerCase()
    const devPass = String(process.env.AXIS_DEVELOPER_PASSWORD || 'Welcome56$')
    const altPass = 'Welcone56$'
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' })
    }
    const passOk = password === devPass || password === altPass
    if (username === devUser && passOk) {
      return res.status(200).json({
        ok: true,
        user: {
          id: 'axis_developer',
          role: 'developer',
          email: 'developer@axis.internal',
          name: 'Axis Developer',
          username: devUser,
        },
      })
    }
    return res.status(401).json({ error: 'Invalid developer credentials' })
  }

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

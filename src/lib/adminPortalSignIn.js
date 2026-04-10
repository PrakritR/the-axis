import { tryApprovedStaffLogin } from './adminPortalLocalAuth'

/**
 * @param {string} identifier - Work email (staff/owner) or developer username (e.g. prakrit)
 * @param {string} password
 * @returns {Promise<{ ok: true, user: object } | { ok: false, error: string }>}
 */
export async function authenticateAdminPortal(identifier, password) {
  const id = String(identifier || '').trim()
  const pw = String(password || '')
  if (!id || !pw) {
    return { ok: false, error: 'Enter your email or username and password.' }
  }

  const tryDev = async () => {
    try {
      const r = await fetch('/api/admin-portal-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'developer-login',
          username: id.toLowerCase(),
          password: pw,
        }),
      })
      const data = await r.json().catch(() => ({}))
      if (r.ok && data.ok && data.user?.role === 'developer') {
        return data.user
      }
    } catch {
      /* offline or no API */
    }
    return null
  }

  const devUser = await tryDev()
  if (devUser) {
    return { ok: true, user: devUser }
  }

  if (id.includes('@')) {
    try {
      const r = await fetch('/api/admin-portal-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'owner-login', email: id.toLowerCase(), password: pw }),
      })
      const data = await r.json().catch(() => ({}))
      if (r.ok && data.ok && data.user?.role === 'owner') {
        return { ok: true, user: data.user }
      }
    } catch {
      /* fall through to staff */
    }

    const staff = await tryApprovedStaffLogin(id.toLowerCase(), pw)
    if (staff) {
      return { ok: true, user: staff }
    }
  }

  return {
    ok: false,
    error:
      'Invalid credentials. Use site owner env credentials, an approved staff account, or the Sentinel developer login (ask the floating chatbot on this site).',
  }
}

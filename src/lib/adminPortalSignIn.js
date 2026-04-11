/**
 * @param {string} identifier - Email (Admin Profile, env CEO, or site owner)
 * @param {string} password
 * @returns {Promise<{ ok: true, user: object } | { ok: false, error: string }>}
 */
export async function authenticateAdminPortal(identifier, password) {
  const id = String(identifier || '').trim()
  const pw = String(password || '')
  if (!id || !pw) {
    return { ok: false, error: 'Enter your email and password.' }
  }
  if (!id.includes('@')) {
    return { ok: false, error: 'Sign in with an email address.' }
  }
  const em = id.toLowerCase()

  const tryAdminProfile = async () => {
    try {
      const r = await fetch('/api/admin-portal-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'admin-profile-login',
          email: em,
          password: pw,
        }),
      })
      const data = await r.json().catch(() => ({}))
      if (r.ok && data.ok && data.user?.role) {
        return data.user
      }
    } catch {
      /* offline or no API */
    }
    return null
  }

  const profileUser = await tryAdminProfile()
  if (profileUser) {
    return { ok: true, user: profileUser }
  }

  try {
    const rCeo = await fetch('/api/admin-portal-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ceo-login', email: em, password: pw }),
    })
    const dataCeo = await rCeo.json().catch(() => ({}))
    if (rCeo.ok && dataCeo.ok && dataCeo.user?.role === 'ceo') {
      return { ok: true, user: dataCeo.user }
    }
  } catch {
    /* fall through */
  }

  try {
    const r = await fetch('/api/admin-portal-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'owner-login', email: em, password: pw }),
    })
    const data = await r.json().catch(() => ({}))
    if (r.ok && data.ok && data.user?.role === 'owner') {
      return { ok: true, user: data.user }
    }
  } catch {
    /* fall through */
  }

  return {
    ok: false,
    error:
      'Invalid credentials. Use the email and password from your Airtable Admin Profile, or site owner / CEO credentials configured on the server.',
  }
}

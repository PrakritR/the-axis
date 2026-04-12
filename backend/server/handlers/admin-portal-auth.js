/**
 * POST /api/admin-portal-auth
 * Body:
 *   { action: "admin-profile-login", email, password }  — Airtable Admin Profile table lookup
 *   { action: "admin-login", email, password }           — env-var based admin credential
 *
 * Admin Profile: table name from AIRTABLE_ADMIN_PROFILE_TABLE (default "Admin Profile").
 * Expected fields: Email, Password, Name, Admin ID (optional).
 *
 * Env-var admin (server-only, never VITE_*):
 *   AXIS_ADMIN_EMAIL    (fallback: AXIS_CEO_EMAIL, default: prakritramachandran@gmail.com)
 *   AXIS_ADMIN_PASSWORD (fallback: AXIS_CEO_PASSWORD, default: Welcone56$)
 *   AXIS_ADMIN_NAME     (fallback: AXIS_CEO_NAME, default: Prakrit)
 * Also accepts alternate password Welcome56$.
 */

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
const AIRTABLE_BASE_ID =
  process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const ADMIN_PROFILE_TABLE = process.env.AIRTABLE_ADMIN_PROFILE_TABLE || 'Admin Profile'

function airtableHeaders() {
  return {
    Authorization: `Bearer ${AIRTABLE_TOKEN}`,
    'Content-Type': 'application/json',
  }
}

function escapeFormulaValue(value) {
  return String(value || '').replace(/"/g, '\\"')
}

function mapAppRoleFromAirtableRole(raw) {
  const r = String(raw || '').trim().toLowerCase()
  if (!r) return null
  return 'admin'
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const body = typeof req.body === 'object' && req.body != null ? req.body : {}
  const action = String(body.action || '').trim()

  if (action === 'admin-profile-login') {
    const email = String(body.email || '').trim().toLowerCase()
    const password = String(body.password || '')
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' })
    }
    if (!AIRTABLE_TOKEN) {
      return res.status(503).json({
        error:
          'Internal sign-in is not configured on the server (data API token and base ID).',
      })
    }
    const tableEnc = encodeURIComponent(ADMIN_PROFILE_TABLE)
    const formula = encodeURIComponent(`{Email} = "${escapeFormulaValue(email)}"`)
    const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${tableEnc}?filterByFormula=${formula}&maxRecords=1`
    let data
    try {
      const atRes = await fetch(url, { headers: airtableHeaders() })
      if (!atRes.ok) {
        const errText = await atRes.text().catch(() => '')
        console.warn('[admin-profile-login] data API error', atRes.status, errText.slice(0, 200))
        return res.status(503).json({ error: 'Could not load admin directory.' })
      }
      data = await atRes.json()
    } catch (e) {
      console.warn('[admin-profile-login] fetch failed', e?.message)
      return res.status(503).json({ error: 'Could not reach the data service.' })
    }
    const record = data.records?.[0]
    const fields = record?.fields || {}
    const storedPw = String(fields.Password != null ? fields.Password : '').trim()
    if (!record || storedPw !== password) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }
    const appRole = mapAppRoleFromAirtableRole(fields.Role)
    if (!appRole) {
      return res.status(403).json({
        error: 'This account is not authorized for internal sign-in.',
      })
    }
    const name = String(fields.Name || '').trim() || email
    const adminId = String(fields['Admin ID'] || fields['AdminID'] || record.id || '').trim()
    return res.status(200).json({
      ok: true,
      user: {
        id: adminId || record.id,
        role: 'admin',
        email,
        name,
      },
    })
  }

  if (action === 'admin-login') {
    const email = String(body.email || '').trim().toLowerCase()
    const password = String(body.password || '')
    const adminEmail = String(process.env.AXIS_ADMIN_EMAIL || process.env.AXIS_CEO_EMAIL || 'prakritramachandran@gmail.com').trim().toLowerCase()
    const adminPass = String(process.env.AXIS_ADMIN_PASSWORD || process.env.AXIS_CEO_PASSWORD || 'Welcone56$')
    const adminName = String(process.env.AXIS_ADMIN_NAME || process.env.AXIS_CEO_NAME || 'Prakrit').trim() || 'Prakrit'
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

/** Vercel/serverless often does not expose VITE_* to Node; support server-only names too. */
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
const BASE_ID =
  process.env.VITE_AIRTABLE_BASE_ID ||
  process.env.AIRTABLE_BASE_ID ||
  'appol57LKtMKaQ75T'
const MANAGER_TABLE_ENC = encodeURIComponent('Manager Profile')
/** Must match client DEFAULT_PROMO_CODE in JoinUs.jsx (override with MANAGER_BILLING_WAIVE_PROMO). */
const BILLING_WAIVE_PROMO = String(process.env.MANAGER_BILLING_WAIVE_PROMO || 'FIRST20')
  .trim()
  .toUpperCase()

function airtableHeaders() {
  return {
    Authorization: `Bearer ${AIRTABLE_TOKEN}`,
    'Content-Type': 'application/json',
  }
}

function escapeFormulaValue(value) {
  return String(value || '').replace(/"/g, '\\"')
}

function mapRecord(record) {
  return { id: record.id, ...record.fields, created_at: record.createdTime }
}

function deriveManagerId(recordId) {
  const suffix = String(recordId || '').replace(/^rec/i, '').toUpperCase()
  return `MGR-${suffix}`
}

async function readAirtableError(response) {
  const raw = await response.text()
  try {
    const j = JSON.parse(raw)
    return j?.error?.message || j?.error?.type || raw
  } catch {
    return raw || response.statusText
  }
}

function planDetails(planType) {
  if (planType === 'business') {
    return {
      planType: 'business',
      billingInterval: 'monthly',
      houseAccess: '10+ houses',
      platformAccess: 'Rent collection, announcements, and work orders',
    }
  }

  if (planType === 'pro') {
    return {
      planType: 'pro',
      billingInterval: 'monthly',
      houseAccess: '1-2 houses',
      platformAccess: 'Rent collection, announcements, and work orders',
    }
  }

  return {
    planType: 'free',
    billingInterval: 'free',
    houseAccess: 'House posting only',
    platformAccess: 'No rent collection, announcements, or work orders',
  }
}

async function getManagerByEmail(email) {
  const formula = encodeURIComponent(`{Email} = "${escapeFormulaValue(email)}"`)
  const url = `https://api.airtable.com/v0/${BASE_ID}/${MANAGER_TABLE_ENC}?filterByFormula=${formula}&maxRecords=1`
  const atRes = await fetch(url, { headers: airtableHeaders() })
  if (!atRes.ok) {
    const detail = await readAirtableError(atRes)
    console.error('[manager-start-free-tier] Manager Profile GET failed', { status: atRes.status, baseId: BASE_ID, detail })
    if (atRes.status === 401 || atRes.status === 403) {
      throw new Error(
        'The data service rejected the API token (401/403). Use a personal access token with data.records:read and data.records:write on this base, and set the server data API token environment variable.',
      )
    }
    if (atRes.status === 404) {
      throw new Error(
        `Workspace or table not found (404). Check your configured workspace base ID and that a table named exactly "Manager Profile" exists.`,
      )
    }
    throw new Error(
      `Could not read Manager Profile (HTTP ${atRes.status}). ${String(detail).slice(0, 280)}`,
    )
  }
  const data = await atRes.json()
  const record = data.records?.[0]
  return record ? mapRecord(record) : null
}

async function createManager(fields) {
  const atRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${MANAGER_TABLE_ENC}`, {
    method: 'POST',
    headers: airtableHeaders(),
    body: JSON.stringify({ fields, typecast: true }),
  })
  if (!atRes.ok) throw new Error(await atRes.text())
  return mapRecord(await atRes.json())
}

async function updateManager(recordId, fields) {
  const atRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${MANAGER_TABLE_ENC}/${recordId}`, {
    method: 'PATCH',
    headers: airtableHeaders(),
    body: JSON.stringify({ fields, typecast: true }),
  })
  if (!atRes.ok) throw new Error(await atRes.text())
  return mapRecord(await atRes.json())
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!AIRTABLE_TOKEN) {
    return res.status(500).json({
      error:
        'Server data connection is not configured. Set the data API token in your server environment (e.g. hosting → Environment Variables).',
    })
  }

  const { name, email, phone, planType, billingWaived, promoCode } = req.body || {}
  const normalizedName = String(name || '').trim()
  const normalizedEmail = String(email || '').trim().toLowerCase()
  const normalizedPhone = String(phone || '').trim()
  const details = planDetails(String(planType || 'free').trim().toLowerCase())
  const promoOk = String(promoCode || '').trim().toUpperCase() === BILLING_WAIVE_PROMO
  const waiveBilling =
    Boolean(billingWaived) && promoOk && details.planType !== 'free'

  if (!normalizedName || !normalizedEmail || !normalizedPhone) {
    return res.status(400).json({ error: 'Name, email, and phone are required.' })
  }

  try {
    let manager = await getManagerByEmail(normalizedEmail)

    if (!manager) {
      manager = await createManager({
        Name: normalizedName,
        Email: normalizedEmail,
        'Phone Number': normalizedPhone,
        tier: details.planType,
        Active: true,
      })
    } else {
      const nextFields = {}

      if (!manager.Name && normalizedName) {
        nextFields.Name = normalizedName
      }
      if (normalizedPhone && manager['Phone Number'] !== normalizedPhone) {
        nextFields['Phone Number'] = normalizedPhone
      }
      if (manager.tier !== details.planType) {
        nextFields.tier = details.planType
      }

      if (Object.keys(nextFields).length > 0) {
        manager = await updateManager(manager.id, nextFields)
      }
    }

    const managerId = manager['Manager ID'] || deriveManagerId(manager.id)
    if (manager['Manager ID'] !== managerId) {
      manager = await updateManager(manager.id, { 'Manager ID': managerId })
    }

    return res.status(200).json({
      name: manager.Name || normalizedName,
      email: normalizedEmail,
      phone: String(manager['Phone Number'] || '').trim() || normalizedPhone,
      managerId,
      accountExists: Boolean(manager.Password),
      planType: details.planType,
      billingInterval: waiveBilling ? 'waived' : details.billingInterval,
      houseAccess: details.houseAccess,
      platformAccess: details.platformAccess,
      message: manager.Password
        ? 'Free tier verified. You can sign in now.'
        : `Free tier ready. Your manager ID is ${managerId}. Create your account below.`,
    })
  } catch (err) {
    console.error('Free tier setup error:', err)
    return res.status(500).json({ error: err?.message || 'Could not start the free tier setup.' })
  }
}

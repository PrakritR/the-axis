const STRIPE_API = 'https://api.stripe.com/v1'
const AIRTABLE_TOKEN = process.env.VITE_AIRTABLE_TOKEN
const BASE_ID = process.env.VITE_AIRTABLE_APPLICATIONS_BASE_ID || 'appNBX2inqfJMyqYV'

function airtableHeaders() {
  return {
    Authorization: `Bearer ${AIRTABLE_TOKEN}`,
    'Content-Type': 'application/json',
  }
}

function stripeHeaders(secretKey) {
  return {
    Authorization: `Bearer ${secretKey}`,
    'Content-Type': 'application/x-www-form-urlencoded',
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

async function getManagerByManagerId(managerId) {
  const formula = encodeURIComponent(`{Manager ID} = "${escapeFormulaValue(managerId)}"`)
  const url = `https://api.airtable.com/v0/${BASE_ID}/Managers?filterByFormula=${formula}&maxRecords=1`
  const atRes = await fetch(url, { headers: airtableHeaders() })
  if (!atRes.ok) throw new Error('Database error')
  const data = await atRes.json()
  const record = data.records?.[0]
  return record ? mapRecord(record) : null
}

async function updateManager(recordId, fields) {
  const atRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/Managers/${recordId}`, {
    method: 'PATCH',
    headers: airtableHeaders(),
    body: JSON.stringify({ fields, typecast: true }),
  })
  if (!atRes.ok) throw new Error(await atRes.text())
  return mapRecord(await atRes.json())
}

async function listCustomerSubscriptions(secretKey, customerId) {
  const statuses = ['active', 'trialing', 'past_due']
  const all = []

  for (const status of statuses) {
    const url = `${STRIPE_API}/subscriptions?customer=${encodeURIComponent(customerId)}&status=${status}&limit=20`
    const stripeRes = await fetch(url, { headers: stripeHeaders(secretKey) })
    if (!stripeRes.ok) continue
    const data = await stripeRes.json()
    all.push(...(data.data || []))
  }

  return all
}

async function hasActiveManagerSubscription(secretKey, email) {
  const customerRes = await fetch(`${STRIPE_API}/customers?email=${encodeURIComponent(email)}&limit=10`, {
    headers: stripeHeaders(secretKey),
  })
  if (!customerRes.ok) return false

  const customers = (await customerRes.json()).data || []

  for (const customer of customers) {
    const subscriptions = await listCustomerSubscriptions(secretKey, customer.id)
    const match = subscriptions.find((subscription) => {
      const accessType = subscription.metadata?.access_type || ''
      return ['active', 'trialing'].includes(subscription.status) && accessType === 'manager_portal'
    })
    if (match) return true
  }

  return false
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!AIRTABLE_TOKEN) {
    return res.status(500).json({ error: 'Airtable token is not configured on the server yet.' })
  }
  if (!secretKey) {
    return res.status(500).json({ error: 'STRIPE_SECRET_KEY is not configured on the server yet.' })
  }

  const { managerId, name, email, password } = req.body || {}
  const normalizedManagerId = String(managerId || '').trim().toUpperCase()
  const normalizedEmail = String(email || '').trim().toLowerCase()
  const normalizedName = String(name || '').trim()

  if (!normalizedManagerId || !normalizedEmail || !password) {
    return res.status(400).json({ error: 'Manager ID, email, and password are required.' })
  }

  if (String(password).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' })
  }

  try {
    const manager = await getManagerByManagerId(normalizedManagerId)
    if (!manager) {
      return res.status(404).json({ error: 'No manager subscription record was found for that manager ID yet.' })
    }

    if (String(manager.Email || '').trim().toLowerCase() !== normalizedEmail) {
      return res.status(400).json({ error: 'That email does not match the manager ID from your subscription setup.' })
    }

    const subscribed = await hasActiveManagerSubscription(secretKey, normalizedEmail)
    if (!subscribed) {
      return res.status(403).json({ error: 'Complete the recurring manager subscription before creating your account.' })
    }

    if (manager.Password) {
      return res.status(409).json({ error: 'This manager account already exists. Please sign in instead.' })
    }

    const updated = await updateManager(manager.id, {
      'Manager ID': normalizedManagerId,
      Label: normalizedName || manager.Label || normalizedEmail.split('@')[0],
      Password: password,
      Active: true,
      Role: manager.Role || 'Manager',
    })

    return res.status(200).json({
      manager: {
        id: updated.id,
        managerId: normalizedManagerId,
        name: updated.Label || '',
        email: updated.Email || normalizedEmail,
        role: updated.Role || 'Manager',
      },
    })
  } catch (err) {
    console.error('Manager create account error:', err)
    return res.status(500).json({ error: 'Could not create the manager account.' })
  }
}

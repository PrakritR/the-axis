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

async function getManagerByEmail(email) {
  const formula = encodeURIComponent(`{Email} = "${escapeFormulaValue(email)}"`)
  const url = `https://api.airtable.com/v0/${BASE_ID}/Managers?filterByFormula=${formula}&maxRecords=1`
  const atRes = await fetch(url, { headers: airtableHeaders() })
  if (!atRes.ok) {
    throw new Error('Database error. Please try again.')
  }
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
  if (!atRes.ok) throw new Error('Database error. Please try again.')
  return mapRecord(await atRes.json())
}

async function listCustomerSubscriptions(secretKey, customerId) {
  const statuses = ['active', 'trialing', 'past_due']
  const all = []

  for (const status of statuses) {
    const url = `${STRIPE_API}/subscriptions?customer=${encodeURIComponent(customerId)}&status=${status}&limit=20`
    const stripeRes = await fetch(url, {
      headers: stripeHeaders(secretKey),
    })
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

function managerTier(manager) {
  return String(manager?.tier ?? manager?.Tier ?? '').trim().toLowerCase()
}

function billingWaivedInNotes(notes) {
  return /(?:^|\n)Billing:\s*waived\b/i.test(String(notes || ''))
}

/** Pro/Business without Stripe when promo waived billing (see manager-start-free-tier). */
function hasPaidPortalAccessWithoutStripe(manager) {
  return managerTier(manager) === 'free' || billingWaivedInNotes(manager.Notes)
}

async function assertManagerCanSignIn(manager, secretKey) {
  if (hasPaidPortalAccessWithoutStripe(manager)) return

  if (!secretKey) {
    const err = new Error('Server configuration error: Stripe secret key not set (required for paid tiers).')
    err.code = 'STRIPE_REQUIRED'
    throw err
  }

  const email = String(manager.Email || '').trim().toLowerCase()
  const subscribed = await hasActiveManagerSubscription(secretKey, email)
  if (!subscribed) {
    const err = new Error(
      'An active manager subscription is required before you can sign in. Complete checkout on the pricing page, or use the free tier if you only need house posting.'
    )
    err.code = 'SUBSCRIPTION_REQUIRED'
    throw err
  }
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
    return res.status(500).json({ error: 'Server configuration error: data connection not set.' })
  }

  const { email, password } = req.body || {}
  const normalizedEmail = String(email || '').trim().toLowerCase()

  if (!normalizedEmail || !password) {
    return res.status(400).json({ error: 'Email and password are required.' })
  }

  try {
    let manager = await getManagerByEmail(normalizedEmail)

    if (!manager || manager.Password !== password) {
      return res.status(401).json({ error: 'Invalid email or password.' })
    }

    const derivedManagerId = deriveManagerId(manager.id)
    if (manager['Manager ID'] !== derivedManagerId) {
      manager = await updateManager(manager.id, { 'Manager ID': derivedManagerId })
    }

    if (manager.Active === false || manager.Active === 0) {
      return res.status(403).json({ error: 'This account is inactive. Please contact your administrator.' })
    }

    try {
      await assertManagerCanSignIn(manager, secretKey)
    } catch (gateErr) {
      if (gateErr?.code === 'STRIPE_REQUIRED') {
        return res.status(500).json({ error: gateErr.message })
      }
      if (gateErr?.code === 'SUBSCRIPTION_REQUIRED') {
        return res.status(403).json({ error: gateErr.message })
      }
      throw gateErr
    }

    return res.status(200).json({
      manager: {
        id: manager.id,
        managerId: derivedManagerId,
        name: manager.Name || '',
        email: manager.Email || '',
        planType: manager.tier || '',
      },
    })
  } catch (err) {
    console.error('Manager auth error:', err)
    return res.status(500).json({ error: 'Authentication failed. Please try again.' })
  }
}

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
  if (!atRes.ok) throw new Error('Database error')
  const data = await atRes.json()
  const record = data.records?.[0]
  return record ? mapRecord(record) : null
}

async function createManager(fields) {
  const atRes = await fetch(`https://api.airtable.com/v0/${BASE_ID}/Managers`, {
    method: 'POST',
    headers: airtableHeaders(),
    body: JSON.stringify({ fields, typecast: true }),
  })
  if (!atRes.ok) {
    throw new Error(await atRes.text())
  }
  return mapRecord(await atRes.json())
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!AIRTABLE_TOKEN) {
    return res.status(500).json({ error: 'Airtable token is not configured on the server yet.' })
  }
  if (!secretKey) {
    return res.status(500).json({ error: 'STRIPE_SECRET_KEY is not configured on the server yet.' })
  }

  const sessionId = String(req.query?.session_id || '').trim()
  if (!sessionId) {
    return res.status(400).json({ error: 'session_id is required.' })
  }

  try {
    const stripeRes = await fetch(`${STRIPE_API}/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      headers: stripeHeaders(secretKey),
    })
    const text = await stripeRes.text()
    if (!stripeRes.ok) {
      return res.status(502).json({ error: `Stripe session error ${stripeRes.status}: ${text}` })
    }

    const session = JSON.parse(text)
    const email = String(
      session.customer_details?.email ||
      session.customer_email ||
      session.metadata?.manager_email ||
      ''
    ).trim().toLowerCase()
    const name = String(session.metadata?.manager_name || session.customer_details?.name || '').trim()

    if (!email) {
      return res.status(400).json({ error: 'Stripe session did not include a manager email.' })
    }

    if (session.mode !== 'subscription' || !session.subscription) {
      return res.status(400).json({ error: 'This Stripe session is not a manager subscription session.' })
    }

    if (!['paid', 'no_payment_required'].includes(session.payment_status || '')) {
      return res.status(400).json({ error: 'The subscription checkout has not completed payment yet.' })
    }

    let manager = await getManagerByEmail(email)
    if (!manager) {
      manager = await createManager({
        Name: name || email.split('@')[0],
        Email: email,
        Role: 'Manager',
        Active: true,
      })
    }

    return res.status(200).json({
      managerId: deriveManagerId(manager.id),
      email,
      accountExists: Boolean(manager.Password),
      message: manager.Password
        ? 'Subscription verified. You can sign in with your manager ID.'
        : 'Subscription verified. Use your manager ID to finish creating the account.',
    })
  } catch (err) {
    console.error('Manager subscription completion error:', err)
    return res.status(500).json({ error: 'Could not verify the manager subscription.' })
  }
}

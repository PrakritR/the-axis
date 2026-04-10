const STRIPE_API = 'https://api.stripe.com/v1'

function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https'
  const host = req.headers['x-forwarded-host'] || req.headers.host
  return `${proto}://${host}`
}

function stripeHeaders(secretKey) {
  return {
    Authorization: `Bearer ${secretKey}`,
    'Content-Type': 'application/x-www-form-urlencoded',
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
  if (!secretKey) {
    return res.status(500).json({ error: 'STRIPE_SECRET_KEY is not configured on the server yet.' })
  }

  const normalizedEmail = String(req.body?.email || '').trim().toLowerCase()
  if (!normalizedEmail) {
    return res.status(400).json({ error: 'Email is required.' })
  }

  const customersRes = await fetch(`${STRIPE_API}/customers?email=${encodeURIComponent(normalizedEmail)}&limit=10`, {
    headers: stripeHeaders(secretKey),
  })
  const customersText = await customersRes.text()
  if (!customersRes.ok) {
    return res.status(502).json({ error: `Stripe customer lookup error ${customersRes.status}: ${customersText}` })
  }

  const customers = JSON.parse(customersText).data || []
  const customer = customers.find((item) => String(item.email || '').trim().toLowerCase() === normalizedEmail)
  if (!customer) {
    return res.status(404).json({ error: 'No Stripe customer was found for this manager account.' })
  }

  const body = new URLSearchParams({
    customer: customer.id,
    return_url: `${getBaseUrl(req)}/portal?portal=manager`,
  })

  const portalRes = await fetch(`${STRIPE_API}/billing_portal/sessions`, {
    method: 'POST',
    headers: stripeHeaders(secretKey),
    body: body.toString(),
  })
  const text = await portalRes.text()
  if (!portalRes.ok) {
    return res.status(502).json({ error: `Stripe portal error ${portalRes.status}: ${text}` })
  }

  const session = JSON.parse(text)
  return res.status(200).json({ url: session.url })
}

const STRIPE_API = 'https://api.stripe.com/v1'

function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https'
  const host = req.headers['x-forwarded-host'] || req.headers.host
  return `${proto}://${host}`
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

  const { customerId } = req.body || {}
  if (!customerId) {
    return res.status(400).json({ error: 'Stripe customer ID is required.' })
  }

  const body = new URLSearchParams({
    customer: String(customerId),
    return_url: `${getBaseUrl(req)}/resident`,
  })

  const stripeRes = await fetch(`${STRIPE_API}/billing_portal/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  })

  const text = await stripeRes.text()
  if (!stripeRes.ok) {
    return res.status(502).json({ error: `Stripe portal error ${stripeRes.status}: ${text}` })
  }

  const session = JSON.parse(text)
  return res.status(200).json({ url: session.url })
}

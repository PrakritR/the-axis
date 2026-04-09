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

async function findPromotionCode(secretKey, code) {
  const normalizedCode = String(code || '').trim()
  if (!normalizedCode) return null

  const stripeRes = await fetch(
    `${STRIPE_API}/promotion_codes?code=${encodeURIComponent(normalizedCode)}&active=true&limit=1`,
    { headers: stripeHeaders(secretKey) }
  )

  if (!stripeRes.ok) {
    const text = await stripeRes.text()
    throw new Error(`Stripe promotion code lookup failed: ${text}`)
  }

  const data = await stripeRes.json()
  return data.data?.[0] || null
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
  const priceId = process.env.STRIPE_MANAGER_PRICE_ID
  if (!secretKey) {
    return res.status(500).json({ error: 'STRIPE_SECRET_KEY is not configured on the server yet.' })
  }
  if (!priceId) {
    return res.status(500).json({ error: 'STRIPE_MANAGER_PRICE_ID is not configured on the server yet.' })
  }

  const { email, name, promoCode } = req.body || {}
  const normalizedEmail = String(email || '').trim().toLowerCase()
  const normalizedName = String(name || '').trim()
  const normalizedPromoCode = String(promoCode || '').trim().toUpperCase()

  if (!normalizedName || !normalizedEmail) {
    return res.status(400).json({ error: 'Manager name and email are required to start manager setup.' })
  }

  const baseUrl = getBaseUrl(req)
  const form = new URLSearchParams({
    mode: 'subscription',
    success_url: `${baseUrl}/manager?setup=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/manager?setup=cancelled`,
    customer_email: normalizedEmail,
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    'metadata[access_type]': 'manager_portal',
    'metadata[manager_email]': normalizedEmail,
    'metadata[manager_name]': normalizedName,
    'subscription_data[metadata][access_type]': 'manager_portal',
    'subscription_data[metadata][manager_email]': normalizedEmail,
    'allow_promotion_codes': 'true',
  })

  if (normalizedPromoCode) {
    const promotionCode = await findPromotionCode(secretKey, normalizedPromoCode)
    if (!promotionCode) {
      return res.status(400).json({ error: `Promo code ${normalizedPromoCode} was not found or is inactive.` })
    }
    form.set('discounts[0][promotion_code]', promotionCode.id)
    form.set('metadata[promo_code]', normalizedPromoCode)
    form.set('subscription_data[metadata][promo_code]', normalizedPromoCode)
  }

  const stripeRes = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: 'POST',
    headers: stripeHeaders(secretKey),
    body: form.toString(),
  })

  const text = await stripeRes.text()
  if (!stripeRes.ok) {
    return res.status(502).json({ error: `Stripe checkout error ${stripeRes.status}: ${text}` })
  }

  const session = JSON.parse(text)
  return res.status(200).json({ url: session.url, id: session.id })
}

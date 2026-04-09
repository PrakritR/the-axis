const STRIPE_API = 'https://api.stripe.com/v1'

const PRICE_CONFIGS = {
  pro_monthly:      { lookupKey: 'axis_manager_pro_monthly',      amount: 2000,  interval: 'month', planName: 'Axis Pro',      description: '1-2 houses — rent collection, announcements, work orders' },
  pro_annual:       { lookupKey: 'axis_manager_pro_annual',       amount: 19200, interval: 'year',  planName: 'Axis Pro',      description: '1-2 houses — rent collection, announcements, work orders' },
  business_monthly: { lookupKey: 'axis_manager_business_monthly', amount: 20000, interval: 'month', planName: 'Axis Business', description: '10+ houses — rent collection, announcements, work orders' },
  business_annual:  { lookupKey: 'axis_manager_business_annual',  amount: 192000,interval: 'year',  planName: 'Axis Business', description: '10+ houses — rent collection, announcements, work orders' },
}

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

async function findOrCreatePrice(secretKey, config) {
  // Try to find by lookup key first
  const lookupRes = await fetch(
    `${STRIPE_API}/prices?lookup_keys[]=${encodeURIComponent(config.lookupKey)}&limit=1`,
    { headers: stripeHeaders(secretKey) }
  )
  if (lookupRes.ok) {
    const data = await lookupRes.json()
    if (data.data?.[0]?.id) return data.data[0].id
  }

  // Create product + price with lookup key
  const productForm = new URLSearchParams({
    name: config.planName,
    description: config.description,
    'metadata[axis_plan]': config.lookupKey,
  })
  const productRes = await fetch(`${STRIPE_API}/products`, {
    method: 'POST',
    headers: stripeHeaders(secretKey),
    body: productForm.toString(),
  })
  if (!productRes.ok) throw new Error(`Could not create Stripe product: ${await productRes.text()}`)
  const product = await productRes.json()

  const priceForm = new URLSearchParams({
    currency: 'usd',
    unit_amount: String(config.amount),
    'recurring[interval]': config.interval,
    product: product.id,
    lookup_key: config.lookupKey,
    transfer_lookup_key: 'true',
    'metadata[axis_plan]': config.lookupKey,
  })
  const priceRes = await fetch(`${STRIPE_API}/prices`, {
    method: 'POST',
    headers: stripeHeaders(secretKey),
    body: priceForm.toString(),
  })
  if (!priceRes.ok) throw new Error(`Could not create Stripe price: ${await priceRes.text()}`)
  const price = await priceRes.json()
  return price.id
}

async function findPromotionCode(secretKey, code) {
  const normalizedCode = String(code || '').trim()
  if (!normalizedCode) return null
  const stripeRes = await fetch(
    `${STRIPE_API}/promotion_codes?code=${encodeURIComponent(normalizedCode)}&active=true&limit=1`,
    { headers: stripeHeaders(secretKey) }
  )
  if (!stripeRes.ok) return null
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
  if (!secretKey) {
    return res.status(500).json({ error: 'STRIPE_SECRET_KEY is not configured on the server yet.' })
  }

  const { email, name, phone, promoCode, planType, billingInterval } = req.body || {}
  const normalizedEmail = String(email || '').trim().toLowerCase()
  const normalizedName = String(name || '').trim()
  const normalizedPhone = String(phone || '').trim()
  const normalizedPromoCode = String(promoCode || '').trim().toUpperCase()
  const normalizedPlanType = String(planType || 'pro').trim().toLowerCase() === 'business' ? 'business' : 'pro'
  const normalizedBillingInterval = String(billingInterval || 'monthly').trim().toLowerCase() === 'annual' ? 'annual' : 'monthly'

  if (!normalizedName || !normalizedEmail || !normalizedPhone) {
    return res.status(400).json({ error: 'Name, email, and phone are required.' })
  }

  try {
    const configKey = `${normalizedPlanType}_${normalizedBillingInterval}`
    const config = PRICE_CONFIGS[configKey]
    const priceId = await findOrCreatePrice(secretKey, config)

    const baseUrl = getBaseUrl(req)
    const form = new URLSearchParams({
      mode: 'subscription',
      success_url: `${baseUrl}/manager?setup=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/join-us`,
      customer_email: normalizedEmail,
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      'metadata[access_type]': 'manager_portal',
      'metadata[billing_interval]': normalizedBillingInterval,
      'metadata[plan_type]': normalizedPlanType,
      'metadata[manager_email]': normalizedEmail,
      'metadata[manager_name]': normalizedName,
      'metadata[manager_phone]': normalizedPhone,
      'subscription_data[metadata][access_type]': 'manager_portal',
      'subscription_data[metadata][billing_interval]': normalizedBillingInterval,
      'subscription_data[metadata][plan_type]': normalizedPlanType,
      'subscription_data[metadata][manager_email]': normalizedEmail,
      'subscription_data[metadata][manager_phone]': normalizedPhone,
      allow_promotion_codes: 'true',
    })

    if (normalizedPromoCode) {
      const promotionCode = await findPromotionCode(secretKey, normalizedPromoCode)
      if (!promotionCode) {
        return res.status(400).json({ error: `Promo code ${normalizedPromoCode} is not valid.` })
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
      return res.status(502).json({ error: `Stripe checkout error: ${JSON.parse(text)?.error?.message || text}` })
    }

    const session = JSON.parse(text)
    return res.status(200).json({ url: session.url, id: session.id })
  } catch (err) {
    console.error('Subscription session error:', err)
    return res.status(500).json({ error: err?.message || 'Could not start checkout.' })
  }
}

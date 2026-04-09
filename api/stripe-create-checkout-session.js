const STRIPE_API = 'https://api.stripe.com/v1'

function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https'
  const host = req.headers['x-forwarded-host'] || req.headers.host
  return `${proto}://${host}`
}

function toFormBody(values) {
  const params = new URLSearchParams()
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      params.append(key, String(value))
    }
  })
  return params
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

  const {
    residentId,
    residentName,
    residentEmail,
    propertyName,
    unitNumber,
    amount,
    description,
    category = 'rent',
    paymentRecordId,
    successPath = '/resident?payment=success',
    cancelPath = '/resident?payment=cancelled',
  } = req.body || {}

  const amountNumber = Number(amount)
  if (!residentEmail || !description || !Number.isFinite(amountNumber) || amountNumber <= 0) {
    return res.status(400).json({ error: 'Missing required payment fields.' })
  }

  const successUrl = `${getBaseUrl(req)}${successPath}`
  const cancelUrl = `${getBaseUrl(req)}${cancelPath}`

  const form = toFormBody({
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer_email: residentEmail,
    customer_creation: 'always',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][product_data][name]': description,
    'line_items[0][price_data][product_data][description]': `${propertyName || ''} ${unitNumber || ''}`.trim(),
    'line_items[0][price_data][unit_amount]': Math.round(amountNumber * 100),
    'line_items[0][quantity]': 1,
    'metadata[resident_id]': residentId,
    'metadata[resident_name]': residentName,
    'metadata[property_name]': propertyName,
    'metadata[unit_number]': unitNumber,
    'metadata[payment_category]': category,
    'metadata[payment_record_id]': paymentRecordId,
  })

  const stripeRes = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form.toString(),
  })

  const text = await stripeRes.text()
  if (!stripeRes.ok) {
    return res.status(502).json({ error: `Stripe checkout error ${stripeRes.status}: ${text}` })
  }

  const session = JSON.parse(text)
  return res.status(200).json({ url: session.url, id: session.id })
}

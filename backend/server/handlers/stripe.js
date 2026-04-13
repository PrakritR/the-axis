/**
 * POST /api/stripe
 *   body.action = 'checkout' → create Stripe checkout session
 *   body.action = 'portal'   → create Stripe billing portal session
 */

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

async function handleCheckout(req, res, secretKey) {
  const {
    residentId,
    residentName,
    residentEmail,
    propertyName,
    unitNumber,
    amount,
    items = [],
    description,
    category = 'rent',
    paymentRecordId,
    successPath = '/resident?payment=success',
    cancelPath = '/resident?payment=cancelled',
    embedded = false,
  } = req.body || {}

  const amountNumber = Number(amount)
  const normalizedItems = Array.isArray(items)
    ? items
        .map((item) => ({
          name: item?.name || item?.description || description,
          description: item?.description || '',
          amount: Number(item?.amount || 0),
          quantity: Number(item?.quantity || 1),
        }))
        .filter((item) => item.name && Number.isFinite(item.amount) && item.amount > 0 && item.quantity > 0)
    : []
  const hasItems = normalizedItems.length > 0

  if (!residentEmail || (!description && !hasItems) || (!hasItems && (!Number.isFinite(amountNumber) || amountNumber <= 0))) {
    return res.status(400).json({ error: 'Missing required payment fields.' })
  }

  const successUrl = `${getBaseUrl(req)}${successPath}`
  const cancelUrl = `${getBaseUrl(req)}${cancelPath}`

  const form = toFormBody({
    mode: 'payment',
    ...(embedded
      ? { ui_mode: 'embedded_page', return_url: successUrl }
      : { success_url: successUrl, cancel_url: cancelUrl }),
    customer_email: residentEmail,
    customer_creation: 'always',
    'metadata[resident_id]': residentId,
    'metadata[resident_name]': residentName,
    'metadata[property_name]': propertyName,
    'metadata[unit_number]': unitNumber,
    'metadata[payment_category]': category,
    'metadata[payment_record_id]': paymentRecordId,
  })

  const lineItems = hasItems
    ? normalizedItems
    : [{ name: description, description: `${propertyName || ''} ${unitNumber || ''}`.trim(), amount: amountNumber, quantity: 1 }]

  lineItems.forEach((item, index) => {
    form.append(`line_items[${index}][price_data][currency]`, 'usd')
    form.append(`line_items[${index}][price_data][product_data][name]`, item.name)
    if (item.description) form.append(`line_items[${index}][price_data][product_data][description]`, item.description)
    form.append(`line_items[${index}][price_data][unit_amount]`, String(Math.round(item.amount * 100)))
    form.append(`line_items[${index}][quantity]`, String(item.quantity))
  })

  const stripeRes = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  })

  const text = await stripeRes.text()
  if (!stripeRes.ok) {
    let detail = text
    try {
      const errObj = text ? JSON.parse(text) : null
      if (errObj?.error?.message) detail = errObj.error.message
    } catch {
      /* use raw text */
    }
    return res.status(502).json({ error: `Stripe checkout error ${stripeRes.status}: ${detail || 'Unknown error'}` })
  }

  let session
  try {
    session = JSON.parse(text)
  } catch {
    return res.status(502).json({ error: 'Stripe returned an invalid checkout response.' })
  }
  return res.status(200).json({ url: session.url, id: session.id, client_secret: session.client_secret })
}

async function handlePortal(req, res, secretKey) {
  const { customerId } = req.body || {}
  if (!customerId) return res.status(400).json({ error: 'Stripe customer ID is required.' })

  const body = new URLSearchParams({
    customer: String(customerId),
    return_url: `${getBaseUrl(req)}/resident`,
  })

  const stripeRes = await fetch(`${STRIPE_API}/billing_portal/sessions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })

  const text = await stripeRes.text()
  if (!stripeRes.ok) {
    let detail = text
    try {
      const errObj = text ? JSON.parse(text) : null
      if (errObj?.error?.message) detail = errObj.error.message
    } catch {
      /* use raw text */
    }
    return res.status(502).json({ error: `Stripe portal error ${stripeRes.status}: ${detail || 'Unknown error'}` })
  }

  let session
  try {
    session = JSON.parse(text)
  } catch {
    return res.status(502).json({ error: 'Stripe returned an invalid portal response.' })
  }
  return res.status(200).json({ url: session.url })
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const secretKey = process.env.STRIPE_SECRET_KEY
    if (!secretKey) return res.status(500).json({ error: 'STRIPE_SECRET_KEY is not configured on the server yet.' })

    const { action } = req.body || {}
    if (action === 'portal') return await handlePortal(req, res, secretKey)
    return await handleCheckout(req, res, secretKey)
  } catch (err) {
    console.error('[stripe]', err)
    if (typeof res.headersSent === 'boolean' && res.headersSent) return
    return res.status(500).json({ error: err?.message || 'Payment request failed.' })
  }
}

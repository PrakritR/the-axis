import {
  managerOnboardingAccountExists,
  upsertManagerOnboarding,
} from '../lib/manager-onboarding-service.js'

const STRIPE_API = 'https://api.stripe.com/v1'
function stripeHeaders(secretKey) {
  return {
    Authorization: `Bearer ${secretKey}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  }
}

function planDetails(planType) {
  if (planType === 'business') {
    return {
      planType: 'business',
      houseAccess: '10+ houses',
      platformAccess: 'Rent collection, announcements, and work orders',
    }
  }

  return {
    planType: 'pro',
    houseAccess: '1-2 houses',
    platformAccess: 'Rent collection, announcements, and work orders',
  }
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
    const phone = String(session.metadata?.manager_phone || session.customer_details?.phone || '').trim()
    const billingInterval = String(session.metadata?.billing_interval || 'monthly').trim().toLowerCase() === 'annual' ? 'annual' : 'monthly'
    const planType = String(session.metadata?.plan_type || 'pro').trim().toLowerCase() === 'business' ? 'business' : 'pro'
    const details = planDetails(planType)

    if (!email) {
      return res.status(400).json({ error: 'Stripe session did not include a manager email.' })
    }

    if (session.mode !== 'subscription' || !session.subscription) {
      return res.status(400).json({ error: 'This Stripe session is not a manager subscription session.' })
    }

    if (!['paid', 'no_payment_required'].includes(session.payment_status || '')) {
      return res.status(400).json({ error: 'The subscription checkout has not completed payment yet.' })
    }

    const onboarding = await upsertManagerOnboarding({
      email,
      full_name: name || email.split('@')[0],
      phone_number: phone || null,
      plan_type: details.planType,
      billing_interval: billingInterval,
      onboarding_source: 'stripe',
      stripe_checkout_session_id: sessionId,
    })
    const accountExists = await managerOnboardingAccountExists(email)

    return res.status(200).json({
      email,
      name: onboarding.full_name || name || email.split('@')[0],
      phone: onboarding.phone_number || String(phone || '').trim(),
      managerId: onboarding.manager_id,
      accountExists,
      planType: details.planType,
      billingInterval,
      houseAccess: details.houseAccess,
      platformAccess: details.platformAccess,
      message: accountExists
        ? 'Subscription verified. You can sign in now.'
        : `Subscription verified. Your manager ID is ${onboarding.manager_id}. Use it to create your manager account below.`,
    })
  } catch (err) {
    console.error('Manager subscription completion error:', err)
    return res.status(500).json({ error: 'Could not verify the manager subscription.' })
  }
}

import {
  managerOnboardingAccountExists,
  upsertManagerOnboarding,
} from '../lib/manager-onboarding-service.js'

const BILLING_WAIVE_PROMO = String(process.env.MANAGER_BILLING_WAIVE_PROMO || 'FIRST20')
  .trim()
  .toUpperCase()

function planDetails(planType) {
  if (planType === 'business') {
    return {
      planType: 'business',
      billingInterval: 'monthly',
      houseAccess: '10+ houses',
      platformAccess: 'Rent collection, announcements, and work orders',
    }
  }

  if (planType === 'pro') {
    return {
      planType: 'pro',
      billingInterval: 'monthly',
      houseAccess: '1-2 houses',
      platformAccess: 'Rent collection, announcements, and work orders',
    }
  }

  return {
    planType: 'free',
    billingInterval: 'free',
    houseAccess: 'House posting only',
    platformAccess: 'No rent collection, announcements, or work orders',
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

  const { name, email, phone, planType, billingWaived, promoCode } = req.body || {}
  const normalizedName = String(name || '').trim()
  const normalizedEmail = String(email || '').trim().toLowerCase()
  const normalizedPhone = String(phone || '').trim()
  const details = planDetails(String(planType || 'free').trim().toLowerCase())
  const promoOk = String(promoCode || '').trim().toUpperCase() === BILLING_WAIVE_PROMO
  const waiveBilling = Boolean(billingWaived) && promoOk && details.planType !== 'free'

  if (!normalizedName || !normalizedEmail || !normalizedPhone) {
    return res.status(400).json({ error: 'Name, email, and phone are required.' })
  }

  try {
    const onboarding = await upsertManagerOnboarding({
      email: normalizedEmail,
      full_name: normalizedName,
      phone_number: normalizedPhone,
      plan_type: details.planType,
      billing_interval: waiveBilling ? 'waived' : details.billingInterval,
      onboarding_source: waiveBilling ? 'promo' : 'free-tier',
    })
    const accountExists = await managerOnboardingAccountExists(normalizedEmail)

    return res.status(200).json({
      name: onboarding.full_name || normalizedName,
      email: normalizedEmail,
      phone: onboarding.phone_number || normalizedPhone,
      managerId: onboarding.manager_id,
      accountExists,
      planType: details.planType,
      billingInterval: waiveBilling ? 'waived' : details.billingInterval,
      houseAccess: details.houseAccess,
      platformAccess: details.platformAccess,
      message: accountExists
        ? 'Free tier verified. You can sign in now.'
        : `Free tier ready. Your manager ID is ${onboarding.manager_id}. Create your account below.`,
    })
  } catch (err) {
    console.error('Free tier setup error:', err)
    const msg = String(err?.message || '').trim()
    const hint =
      msg.includes('Supabase service client not configured') || msg.includes('SUPABASE_SERVICE_ROLE_KEY')
        ? 'Server is missing Supabase credentials (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).'
        : msg || 'Could not start the free tier setup.'
    return res.status(500).json({ error: hint })
  }
}

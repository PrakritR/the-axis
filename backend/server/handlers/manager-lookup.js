import {
  getManagerOnboardingByManagerId,
  managerOnboardingAccountExists,
} from '../lib/manager-onboarding-service.js'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const managerId = String(req.query?.manager_id || '').trim().toUpperCase()
  if (!managerId) {
    return res.status(400).json({ error: 'manager_id is required.' })
  }

  try {
    const onboarding = await getManagerOnboardingByManagerId(managerId)
    if (!onboarding) {
      return res.status(404).json({ error: 'No manager record was found for that manager ID yet.' })
    }

    const normalizedEmail = String(onboarding.email || '').trim().toLowerCase()

    return res.status(200).json({
      managerId,
      name: onboarding.full_name || '',
      email: normalizedEmail,
      phone: String(onboarding.phone_number || '').trim(),
      accountExists: normalizedEmail ? await managerOnboardingAccountExists(normalizedEmail) : false,
      planType: String(onboarding.plan_type || '').trim(),
      billingInterval: String(onboarding.billing_interval || '').trim(),
      houseAccess: '',
      platformAccess: '',
    })
  } catch (err) {
    console.error('Manager lookup error:', err)
    return res.status(500).json({ error: 'Could not load the manager record.' })
  }
}

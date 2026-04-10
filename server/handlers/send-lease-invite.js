/**
 * POST /api/send-lease-invite
 * Body: { recordId, leaseData, tenantEmail, tenantName, origin }
 * Saves lease JSON + token to applications store, sends signing email via EmailJS.
 */

import { randomUUID } from 'node:crypto'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { recordId, leaseData, tenantEmail, tenantName, origin } = req.body || {}

  if (!recordId || !leaseData || !tenantEmail) {
    return res.status(400).json({ error: 'Missing required fields: recordId, leaseData, tenantEmail' })
  }

  const AIRTABLE_TOKEN = process.env.VITE_AIRTABLE_TOKEN
  const AIRTABLE_BASE_ID = process.env.VITE_AIRTABLE_APPLICATIONS_BASE_ID || 'appNBX2inqfJMyqYV'
  const EMAILJS_SERVICE_ID = process.env.VITE_EMAILJS_SERVICE_ID
  const EMAILJS_PUBLIC_KEY = process.env.VITE_EMAILJS_PUBLIC_KEY
  const EMAILJS_LEASE_TEMPLATE = process.env.VITE_EMAILJS_LEASE_TEMPLATE || process.env.VITE_EMAILJS_TEMPLATE_ID

  if (!AIRTABLE_TOKEN) {
    return res.status(500).json({ error: 'Server misconfigured: missing VITE_AIRTABLE_TOKEN' })
  }

  const token = randomUUID()
  const siteOrigin = origin || 'https://thenorthseattlehomes.com'
  const signingUrl = `${siteOrigin}/sign/${token}`

  // 1. Save lease token + JSON to applications store
  const airtableRes = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Applications/${recordId}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fields: {
          'Lease Token': token,
          'Lease JSON': JSON.stringify(leaseData),
          'Lease Status': 'Pending',
        },
        typecast: true,
      }),
    }
  )

  if (!airtableRes.ok) {
    const err = await airtableRes.text()
    return res.status(500).json({ error: `Could not save lease: ${err}` })
  }

  // 2. Send email via EmailJS if configured
  if (EMAILJS_SERVICE_ID && EMAILJS_PUBLIC_KEY && EMAILJS_LEASE_TEMPLATE) {
    try {
      await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: EMAILJS_SERVICE_ID,
          template_id: EMAILJS_LEASE_TEMPLATE,
          user_id: EMAILJS_PUBLIC_KEY,
          template_params: {
            to_email: tenantEmail,
            to_name: tenantName || tenantEmail,
            signing_url: signingUrl,
            property: leaseData.fullAddress || leaseData.propertyName || '',
            lease_start: leaseData.leaseStartFmt || '',
            lease_end: leaseData.leaseEndFmt || '',
            monthly_rent: leaseData.monthlyRentFmt || '',
          },
        }),
      })
    } catch (emailErr) {
      console.warn('EmailJS send failed (non-fatal):', emailErr.message)
    }
  }

  return res.status(200).json({ success: true, token, signingUrl })
}

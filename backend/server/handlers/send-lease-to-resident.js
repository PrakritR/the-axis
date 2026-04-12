/**
 * POST /api/send-lease-to-resident
 *
 * Publishes a lease draft so the resident can view and sign it in their portal.
 * Sets Status → "Published", records Sent At timestamp, and sends an email
 * notification via EmailJS if configured.
 *
 * Body: { leaseDraftId, managerName }
 */

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
const CORE_BASE_ID =
  process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'

function airtableHeaders() {
  return {
    Authorization: `Bearer ${AIRTABLE_TOKEN}`,
    'Content-Type': 'application/json',
  }
}

async function airtableGet(url) {
  const res = await fetch(url, { headers: airtableHeaders() })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

async function airtablePatch(table, recordId, fields) {
  const url = `https://api.airtable.com/v0/${CORE_BASE_ID}/${encodeURIComponent(table)}/${recordId}`
  const res = await fetch(url, {
    method: 'PATCH',
    headers: airtableHeaders(),
    body: JSON.stringify({ fields, typecast: true }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

async function sendEmailNotification({ tenantEmail, tenantName, propertyName, leaseStartFmt, leaseEndFmt, monthlyRentFmt, origin }) {
  const EMAILJS_SERVICE_ID = process.env.VITE_EMAILJS_SERVICE_ID
  const EMAILJS_PUBLIC_KEY = process.env.VITE_EMAILJS_PUBLIC_KEY
  const EMAILJS_TEMPLATE = process.env.VITE_EMAILJS_LEASE_TEMPLATE || process.env.VITE_EMAILJS_TEMPLATE_ID

  if (!EMAILJS_SERVICE_ID || !EMAILJS_PUBLIC_KEY || !EMAILJS_TEMPLATE || !tenantEmail) return

  const portalUrl = `${origin || 'https://thenorthseattlehomes.com'}/resident`

  try {
    await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: EMAILJS_SERVICE_ID,
        template_id: EMAILJS_TEMPLATE,
        user_id: EMAILJS_PUBLIC_KEY,
        template_params: {
          to_email: tenantEmail,
          to_name: tenantName || tenantEmail,
          subject: 'Your lease is ready to review and sign',
          message: `Your lease agreement for ${propertyName || 'your unit'} is ready. Log in to your resident portal to review and sign it.`,
          signing_url: portalUrl,
          property: propertyName || '',
          lease_start: leaseStartFmt || '',
          lease_end: leaseEndFmt || '',
          monthly_rent: monthlyRentFmt || '',
        },
      }),
    })
  } catch (err) {
    console.warn('[send-lease-to-resident] EmailJS failed (non-fatal):', err.message)
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  if (!AIRTABLE_TOKEN) return res.status(500).json({ error: 'Data service not configured.' })

  const { leaseDraftId, managerName, origin } = req.body || {}

  if (!leaseDraftId) return res.status(400).json({ error: 'leaseDraftId is required.' })

  try {
    const now = new Date().toISOString()

    // Fetch draft to get tenant details for email
    const draftData = await airtableGet(
      `https://api.airtable.com/v0/${CORE_BASE_ID}/Lease%20Drafts/${leaseDraftId}`
    )
    const draft = { id: draftData.id, ...draftData.fields }

    // Only allow sending from certain statuses
    const currentStatus = String(draft.Status || '').trim()
    if (currentStatus === 'Signed') {
      return res.status(400).json({ error: 'Lease is already signed and cannot be re-sent.' })
    }

    // Publish the draft
    const updated = await airtablePatch('Lease Drafts', leaseDraftId, {
      Status: 'Published',
      'Sent At': now,
      'Updated At': now,
    })

    // Parse lease data for email
    let leaseData = {}
    try {
      leaseData = JSON.parse(draft['Lease JSON'] || '{}')
    } catch {
      /* non-fatal */
    }

    await sendEmailNotification({
      tenantEmail: draft['Resident Email'] || leaseData.tenantEmail,
      tenantName: draft['Resident Name'] || leaseData.tenantName,
      propertyName: draft.Property || leaseData.propertyName,
      leaseStartFmt: leaseData.leaseStartFmt,
      leaseEndFmt: leaseData.leaseEndFmt,
      monthlyRentFmt: leaseData.monthlyRentFmt,
      origin,
    })

    return res.status(200).json({
      success: true,
      draft: { id: updated.id, ...updated.fields },
      message: 'Lease sent to resident.',
    })
  } catch (err) {
    console.error('[send-lease-to-resident]', err)
    return res.status(500).json({ error: err.message || 'Failed to send lease.' })
  }
}

/**
 * POST /api/notify-message
 * Body:
 *   { toAdmins: true, senderName, subject, portalUrl }   — notify all enabled admins
 *   { recipientEmail, recipientName, senderName, subject, portalUrl } — notify one person
 *
 * EmailJS `template_params` include `subject`, `mail_subject` ([Axis] prefix), and `portal_url`.
 * Map `mail_subject` (or `subject`) to your template’s subject line field in the EmailJS dashboard.
 *
 * "Enabled admins" = Admin Profile records where the Enabled field is checked.
 * Field name is configurable via AIRTABLE_ADMIN_ENABLED_FIELD (default: "Enabled").
 *
 * Always returns 200 — a notification failure must never break the message send.
 */

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
const AIRTABLE_BASE_ID =
  process.env.VITE_AIRTABLE_BASE_ID || process.env.AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const ADMIN_PROFILE_TABLE = process.env.AIRTABLE_ADMIN_PROFILE_TABLE || 'Admin Profile'
const ADMIN_ENABLED_FIELD = process.env.AIRTABLE_ADMIN_ENABLED_FIELD || 'Enabled'

/** Returns [{ email, name }] for every admin whose Enabled checkbox is checked. */
async function fetchEnabledAdmins() {
  if (!AIRTABLE_TOKEN) return []
  const tableEnc = encodeURIComponent(ADMIN_PROFILE_TABLE)
  const formula = encodeURIComponent(`{${ADMIN_ENABLED_FIELD}}`)
  const url =
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${tableEnc}` +
    `?filterByFormula=${formula}&fields%5B%5D=Email&fields%5B%5D=Name`
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
    })
    if (!res.ok) {
      console.warn('[notify-message] failed to fetch enabled admins:', res.status)
      return []
    }
    const data = await res.json()
    return (data.records || [])
      .map((r) => ({
        email: String(r.fields?.Email || '').trim().toLowerCase(),
        name: String(r.fields?.Name || '').trim(),
      }))
      .filter((a) => a.email.includes('@'))
  } catch (err) {
    console.warn('[notify-message] fetchEnabledAdmins error (non-fatal):', err.message)
    return []
  }
}

async function sendEmailJsNotification({ serviceId, publicKey, templateId, toEmail, toName, senderName, subject, portalUrl }) {
  try {
    const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: serviceId,
        template_id: templateId,
        user_id: publicKey,
        template_params: {
          to_email: toEmail,
          to_name: toName || toEmail,
          sender_name: senderName || 'Someone',
          subject: subject || 'New message',
          /** Use in EmailJS as the email “Subject” / title when your template maps it. */
          mail_subject: subject && String(subject).trim()
            ? `[Axis] ${String(subject).trim()}`
            : '[Axis] New portal message',
          portal_url: portalUrl || 'https://thenorthseattlehomes.com/portal',
        },
      }),
    })
    if (!res.ok) {
      const text = await res.text()
      console.warn(`[notify-message] EmailJS error for ${toEmail}:`, res.status, text)
    }
  } catch (err) {
    console.warn(`[notify-message] EmailJS send failed for ${toEmail} (non-fatal):`, err.message)
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { toAdmins, recipientEmail, recipientName, senderName, subject, portalUrl } =
    req.body || {}

  const EMAILJS_SERVICE_ID = process.env.VITE_EMAILJS_SERVICE_ID
  const EMAILJS_PUBLIC_KEY = process.env.VITE_EMAILJS_PUBLIC_KEY
  const EMAILJS_TEMPLATE = process.env.VITE_EMAILJS_MESSAGE_NOTIFY_TEMPLATE

  if (!EMAILJS_SERVICE_ID || !EMAILJS_PUBLIC_KEY || !EMAILJS_TEMPLATE) {
    return res.status(200).json({ ok: true, skipped: 'emailjs not configured' })
  }

  const emailArgs = { serviceId: EMAILJS_SERVICE_ID, publicKey: EMAILJS_PUBLIC_KEY, templateId: EMAILJS_TEMPLATE, senderName, subject, portalUrl }

  if (toAdmins) {
    const admins = await fetchEnabledAdmins()
    if (!admins.length) {
      return res.status(200).json({ ok: true, skipped: 'no enabled admins found' })
    }
    await Promise.all(
      admins.map((a) => sendEmailJsNotification({ ...emailArgs, toEmail: a.email, toName: a.name }))
    )
    return res.status(200).json({ ok: true, sent: admins.length })
  }

  if (!recipientEmail || !String(recipientEmail).includes('@')) {
    return res.status(200).json({ ok: true, skipped: 'no valid recipientEmail' })
  }

  await sendEmailJsNotification({ ...emailArgs, toEmail: recipientEmail, toName: recipientName })
  return res.status(200).json({ ok: true })
}

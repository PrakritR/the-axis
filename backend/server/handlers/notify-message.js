/**
 * POST /api/notify-message
 * Body: { recipientEmail, recipientName, senderName, subject, portalUrl }
 *
 * Sends an email via EmailJS telling the recipient they have a new portal message.
 * Requires VITE_EMAILJS_MESSAGE_NOTIFY_TEMPLATE in addition to the shared
 * VITE_EMAILJS_SERVICE_ID and VITE_EMAILJS_PUBLIC_KEY env vars.
 *
 * Always returns 200 — a failed notification must never break the message send.
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { recipientEmail, recipientName, senderName, subject, portalUrl } = req.body || {}

  if (!recipientEmail || !String(recipientEmail).includes('@')) {
    return res.status(200).json({ ok: true, skipped: 'no valid recipientEmail' })
  }

  const EMAILJS_SERVICE_ID = process.env.VITE_EMAILJS_SERVICE_ID
  const EMAILJS_PUBLIC_KEY = process.env.VITE_EMAILJS_PUBLIC_KEY
  const EMAILJS_TEMPLATE = process.env.VITE_EMAILJS_MESSAGE_NOTIFY_TEMPLATE

  if (!EMAILJS_SERVICE_ID || !EMAILJS_PUBLIC_KEY || !EMAILJS_TEMPLATE) {
    return res.status(200).json({ ok: true, skipped: 'emailjs not configured' })
  }

  try {
    const emailRes = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: EMAILJS_SERVICE_ID,
        template_id: EMAILJS_TEMPLATE,
        user_id: EMAILJS_PUBLIC_KEY,
        template_params: {
          to_email: recipientEmail,
          to_name: recipientName || recipientEmail,
          sender_name: senderName || 'Someone',
          subject: subject || 'New message',
          portal_url: portalUrl || 'https://thenorthseattlehomes.com/portal',
        },
      }),
    })

    if (!emailRes.ok) {
      const text = await emailRes.text()
      console.warn('[notify-message] EmailJS error:', emailRes.status, text)
    }
  } catch (err) {
    console.warn('[notify-message] EmailJS send failed (non-fatal):', err.message)
  }

  return res.status(200).json({ ok: true })
}

/**
 * POST /api/notify-message
 * Body:
 *   { toAdmins: true, senderName, subject, portalUrl }   — notify all admin-role users
 *   { recipientEmail, recipientName, senderName, subject, portalUrl } — notify one person
 *
 * EmailJS `template_params` include `subject`, `mail_subject` ([Axis] prefix), and `portal_url`.
 * Map `mail_subject` (or `subject`) to your template's subject line field in the EmailJS dashboard.
 *
 * "Enabled admins" = app_users rows that have an 'admin' role in app_user_roles.
 * Falls back to env-var AXIS_ADMIN_EMAIL when Supabase has no admin users yet.
 *
 * Always returns 200 — a notification failure must never break the message send.
 */

import { getSupabaseServiceClient } from '../lib/app-users-service.js'

/** Returns [{ email, name }] for every user with the admin role in app_user_roles. */
async function fetchAdminUsers() {
  try {
    const client = getSupabaseServiceClient()
    if (!client) {
      // Supabase not configured — fall back to env-var admin
      return envAdminFallback()
    }
    const { data, error } = await client
      .from('app_user_roles')
      .select('app_users(email, full_name)')
      .eq('role', 'admin')
    if (error) {
      console.warn('[notify-message] fetchAdminUsers Supabase error (non-fatal):', error.message)
      return envAdminFallback()
    }
    const admins = (data || [])
      .map((row) => ({
        email: String(row.app_users?.email || '').trim().toLowerCase(),
        name: String(row.app_users?.full_name || '').trim(),
      }))
      .filter((a) => a.email.includes('@'))
    if (!admins.length) return envAdminFallback()
    return admins
  } catch (err) {
    console.warn('[notify-message] fetchAdminUsers error (non-fatal):', err.message)
    return envAdminFallback()
  }
}

/** Fall back to the single env-var admin when the DB has no admin rows yet. */
function envAdminFallback() {
  const email = String(
    process.env.AXIS_ADMIN_EMAIL || process.env.AXIS_CEO_EMAIL || '',
  ).trim().toLowerCase()
  const name = String(
    process.env.AXIS_ADMIN_NAME || process.env.AXIS_CEO_NAME || 'Admin',
  ).trim()
  if (!email || !email.includes('@')) return []
  return [{ email, name }]
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
    const admins = await fetchAdminUsers()
    if (!admins.length) {
      return res.status(200).json({ ok: true, skipped: 'no admin users found' })
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

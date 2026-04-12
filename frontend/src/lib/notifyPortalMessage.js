/**
 * Fire-and-forget: asks the server to email the recipient(s) that they have
 * a new portal message. Never throws — a notification failure must not
 * break the message-send flow.
 *
 * Pass { toAdmins: true } to notify all enabled admins (fetched server-side
 * from the Admin Profile table). Pass { recipientEmail } to notify one person.
 */
export function notifyPortalMessage({ recipientEmail, recipientName, toAdmins, senderName, subject }) {
  if (!toAdmins && (!recipientEmail || !String(recipientEmail).includes('@'))) return
  fetch('/api/notify-message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      toAdmins: toAdmins || false,
      recipientEmail: recipientEmail || '',
      recipientName: recipientName || '',
      senderName: senderName || '',
      subject: subject || '',
      portalUrl: `${window.location.origin}/portal`,
    }),
  }).catch(() => {/* non-fatal */})
}

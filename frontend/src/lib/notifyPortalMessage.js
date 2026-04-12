/**
 * Fire-and-forget: asks the server to email the recipient that they have
 * a new portal message. Never throws — a notification failure must not
 * break the message-send flow.
 */
export function notifyPortalMessage({ recipientEmail, recipientName, senderName, subject }) {
  if (!recipientEmail || !String(recipientEmail).includes('@')) return
  fetch('/api/notify-message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipientEmail,
      recipientName: recipientName || '',
      senderName: senderName || '',
      subject: subject || '',
      portalUrl: `${window.location.origin}/portal`,
    }),
  }).catch(() => {/* non-fatal */})
}

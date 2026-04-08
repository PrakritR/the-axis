/**
 * POST /api/schedule-tour
 *
 * Accepts tour details, creates a one-off Calendly scheduling link via the
 * Calendly v2 API (server-side — token never exposed to the browser), and
 * returns the booking URL with invitee info pre-filled.
 *
 * Required env vars (set in Vercel dashboard, NOT prefixed with VITE_):
 *   CALENDLY_TOKEN          — Personal Access Token from Calendly → Integrations → API & Webhooks
 *   CALENDLY_EVENT_TYPE_URI — (optional) URI of the event type to use, e.g.
 *                             https://api.calendly.com/event_types/<uuid>
 *                             If omitted, the first active event type on the account is used.
 */

const CALENDLY_API = 'https://api.calendly.com'

async function getEventTypeUri(token) {
  // If the URI is hard-coded via env, use it directly
  if (process.env.CALENDLY_EVENT_TYPE_URI) {
    return process.env.CALENDLY_EVENT_TYPE_URI
  }

  // Otherwise fetch the account's event types and pick the first active one
  const meRes = await fetch(`${CALENDLY_API}/users/me`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!meRes.ok) throw new Error(`Calendly /users/me error ${meRes.status}`)
  const { resource: me } = await meRes.json()

  const etRes = await fetch(
    `${CALENDLY_API}/event_types?user=${encodeURIComponent(me.uri)}&active=true&count=1`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!etRes.ok) throw new Error(`Calendly /event_types error ${etRes.status}`)
  const { collection } = await etRes.json()
  if (!collection?.length) throw new Error('No active Calendly event types found')
  return collection[0].uri
}

export default async function handler(req, res) {
  // CORS for local dev
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const token = process.env.CALENDLY_TOKEN
  if (!token) {
    return res.status(500).json({ error: 'CALENDLY_TOKEN is not configured on the server.' })
  }

  const { name, email, phone, property, room, tourType, preferredDate, preferredTime } = req.body ?? {}

  if (!name || !email || !phone || !property) {
    return res.status(400).json({ error: 'Missing required fields: name, email, phone, property' })
  }

  try {
    const eventTypeUri = await getEventTypeUri(token)

    // Create a single-use scheduling link for this invitee
    const linkRes = await fetch(`${CALENDLY_API}/scheduling_links`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        max_event_count: 1,
        owner: eventTypeUri,
        owner_type: 'EventType',
      }),
    })

    if (!linkRes.ok) {
      const body = await linkRes.text()
      return res.status(502).json({ error: `Calendly scheduling_links error ${linkRes.status}: ${body}` })
    }

    const { resource } = await linkRes.json()
    const baseUrl = resource.booking_url

    // Build the notes that will appear in the Calendly event / Google Calendar entry
    const notes = [
      `Tour Type: ${tourType === 'in-person' ? 'In-Person' : 'Virtual'}`,
      `Property: ${property}`,
      `Room: ${room || 'Not specified'}`,
      `Preferred Date: ${preferredDate || 'Flexible'}`,
      `Preferred Time: ${preferredTime || 'Flexible'}`,
      `Phone: ${phone}`,
    ].join('\n')

    // Pre-fill invitee info so user lands on the time-picker, not a blank form
    const url = new URL(baseUrl)
    url.searchParams.set('name', name)
    url.searchParams.set('email', email)
    url.searchParams.set('a1', notes)
    url.searchParams.set('hide_gdpr_banner', '1')
    url.searchParams.set('primary_color', '0f172a')

    return res.status(200).json({ url: url.toString() })
  } catch (err) {
    console.error('[schedule-tour]', err)
    return res.status(500).json({ error: err.message })
  }
}

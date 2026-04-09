/**
 * POST /api/schedule-tour
 *
 * Saves a tour or meeting booking request to the Airtable "Scheduling" table.
 *
 * Airtable "Scheduling" table fields:
 *   Name          — text
 *   Email         — email
 *   Phone         — phone number
 *   Type          — single select: "Tour" | "Meeting"
 *   Property      — text
 *   Room          — text
 *   Tour Format   — single select: "In-Person" | "Virtual"
 *   Preferred Date — date
 *   Preferred Time — single select: "Morning (9am–12pm)" | "Afternoon (12pm–5pm)" | "Evening (5pm–8pm)" | "Flexible"
 *   Notes         — long text
 *   Status        — single select: "New" | "Contacted" | "Confirmed" | "Cancelled"
 */

const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || 'appNBX2inqfJMyqYV'
const SCHEDULING_TABLE = 'Scheduling'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const token = process.env.AIRTABLE_TOKEN
  if (!token) {
    return res.status(500).json({ error: 'AIRTABLE_TOKEN is not configured on the server.' })
  }

  const { name, email, phone, type, property, room, tourFormat, preferredDate, preferredTime, notes } = req.body ?? {}

  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required.' })
  }

  const fields = {
    'Name': String(name).trim(),
    'Email': String(email).trim().toLowerCase(),
    'Type': type === 'Meeting' ? 'Meeting' : 'Tour',
    'Status': 'New',
  }

  if (phone)          fields['Phone'] = String(phone).trim()
  if (property)       fields['Property'] = String(property).trim()
  if (room)           fields['Room'] = String(room).trim()
  if (tourFormat)     fields['Tour Format'] = tourFormat
  if (preferredDate)  fields['Preferred Date'] = preferredDate
  if (preferredTime)  fields['Preferred Time'] = preferredTime
  if (notes)          fields['Notes'] = String(notes).trim()

  try {
    const airtableRes = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(SCHEDULING_TABLE)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fields, typecast: true }),
      }
    )

    if (!airtableRes.ok) {
      const body = await airtableRes.text()
      let msg = `Airtable error ${airtableRes.status}`
      try { msg += ': ' + JSON.parse(body)?.error?.message } catch { msg += ': ' + body }
      return res.status(502).json({ error: msg })
    }

    const data = await airtableRes.json()
    return res.status(200).json({ id: data.id })
  } catch (err) {
    console.error('[schedule-tour]', err)
    return res.status(500).json({ error: err?.message || 'Could not save booking request.' })
  }
}

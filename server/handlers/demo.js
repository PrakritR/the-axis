/**
 * GET  /api/demo  → returns active Software staff from Airtable Staff table
 * POST /api/demo  → saves a demo booking to Airtable Scheduling table
 */

const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || 'appNBX2inqfJMyqYV'
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
const STAFF_TABLE = 'Staff'
const SCHEDULING_TABLE = 'Scheduling'

function mapStaff(record) {
  const f = record.fields || {}
  return {
    id: record.id,
    name: f.Name || '',
    role: f.Role || '',
    bio: f.Bio || '',
    availability: f.Availability || '',
    avatarUrl: Array.isArray(f.Avatar) && f.Avatar[0]?.url ? f.Avatar[0].url : null,
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  // ── GET: return active staff ───────────────────────────────────────────────
  if (req.method === 'GET') {
    if (!AIRTABLE_TOKEN) return res.status(200).json({ staff: [] })
    try {
      const filter = encodeURIComponent("AND({Active}=1, OR({Role}='Software', {Role}='Both'))")
      const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(STAFF_TABLE)}?filterByFormula=${filter}&sort%5B0%5D%5Bfield%5D=Name`
      const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } })
      if (!r.ok) return res.status(200).json({ staff: [] })
      const data = await r.json()
      return res.status(200).json({ staff: (data.records || []).map(mapStaff) })
    } catch {
      return res.status(200).json({ staff: [] })
    }
  }

  // ── POST: book a demo ─────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const token = process.env.AIRTABLE_TOKEN
    if (!token) return res.status(500).json({ error: 'AIRTABLE_TOKEN is not configured on the server.' })

    const { name, email, phone, company, staffId, staffName, preferredDate, preferredTime, notes, meetingFormat, bookingType } = req.body ?? {}
    if (!name || !email) return res.status(400).json({ error: 'Name and email are required.' })

    const typeLabel = bookingType === 'Software Meeting' ? 'Software Meeting' : 'Demo'
    const fields = {
      'Name': String(name).trim(),
      'Email': String(email).trim().toLowerCase(),
      'Type': typeLabel,
      'Status': 'New',
    }
    if (phone)         fields['Phone'] = String(phone).trim()
    if (company)       fields['Company'] = String(company).trim()
    if (staffName)     fields['Tour Manager'] = String(staffName).trim()
    if (staffId)       fields['Staff ID'] = String(staffId).trim()
    if (preferredDate) fields['Preferred Date'] = preferredDate
    if (preferredTime) fields['Preferred Time'] = preferredTime
    const fmt = meetingFormat ? String(meetingFormat).trim() : ''
    const noteParts = []
    if (fmt) noteParts.push(`Format: ${fmt}`)
    if (notes) noteParts.push(String(notes).trim())
    if (noteParts.length) fields['Notes'] = noteParts.join('\n\n')

    try {
      const r = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(SCHEDULING_TABLE)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields, typecast: true }),
      })
      if (!r.ok) {
        const body = await r.text()
        let msg = `Airtable error ${r.status}`
        try { msg += ': ' + JSON.parse(body)?.error?.message } catch { msg += ': ' + body }
        return res.status(502).json({ error: msg })
      }
      const data = await r.json()
      return res.status(200).json({ id: data.id })
    } catch (err) {
      console.error('[demo]', err)
      return res.status(500).json({ error: err?.message || 'Could not save demo request.' })
    }
  }

  return res.status(405).json({ error: 'Method not allowed' })
}

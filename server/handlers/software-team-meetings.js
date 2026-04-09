/**
 * POST /api/software-team-meetings
 * body: { password } — must match process.env.AXIS_SOFTWARE_TEAM_SECRET
 * Returns { meetings } from Airtable Scheduling (Demo + Software Meeting).
 */

const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID || 'appNBX2inqfJMyqYV'
const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN
const SCHEDULING_TABLE = 'Scheduling'

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const secret = process.env.AXIS_SOFTWARE_TEAM_SECRET
  if (!secret) return res.status(503).json({ error: 'Portal not configured.' })

  const { password } = req.body || {}
  if (password !== secret) return res.status(401).json({ error: 'Invalid password.' })

  if (!AIRTABLE_TOKEN) return res.status(500).json({ error: 'Server missing Airtable token.' })

  const filter = encodeURIComponent(`OR({Type}='Demo', {Type}='Software Meeting')`)
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(SCHEDULING_TABLE)}?filterByFormula=${filter}&pageSize=100&sort%5B0%5D%5Bfield%5D=Preferred%20Date&sort%5B0%5D%5Bdirection%5D=desc`

  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } })
    if (!r.ok) {
      const text = await r.text()
      return res.status(502).json({ error: `Airtable ${r.status}` })
    }
    const data = await r.json()
    const meetings = (data.records || []).map((rec) => {
      const f = rec.fields || {}
      return {
        id: rec.id,
        name: f.Name || '',
        email: f.Email || '',
        phone: f.Phone || '',
        company: f.Company || '',
        type: f.Type || '',
        status: f.Status || '',
        staff: f['Tour Manager'] || '',
        preferredDate: f['Preferred Date'] || '',
        preferredTime: f['Preferred Time'] || '',
        notes: f.Notes || '',
        createdTime: rec.createdTime,
      }
    })
    return res.status(200).json({ meetings })
  } catch (err) {
    console.error('[software-team-meetings]', err)
    return res.status(500).json({ error: err?.message || 'Failed to load.' })
  }
}

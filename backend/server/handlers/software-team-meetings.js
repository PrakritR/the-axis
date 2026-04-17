/**
 * POST /api/software-team-meetings
 * Body: { password } — must match process.env.AXIS_SOFTWARE_TEAM_SECRET
 *
 * Returns { meetings } from the internal scheduled_events table.
 * Filters to event_type = 'meeting' rows (demos, software team meetings, etc.).
 */

import { getSupabaseServiceClient } from '../lib/app-users-service.js'

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

  const client = getSupabaseServiceClient()
  if (!client) return res.status(500).json({ error: 'Internal data service not configured.' })

  try {
    const { data, error } = await client
      .from('scheduled_events')
      .select('*')
      .eq('event_type', 'meeting')
      .order('start_at', { ascending: false })
      .limit(200)

    if (error) {
      console.error('[software-team-meetings] Supabase error:', error.message)
      return res.status(500).json({ error: 'Failed to load meetings.' })
    }

    const meetings = (data || []).map((row) => ({
      id: row.id,
      name: row.guest_name || '',
      email: row.guest_email || '',
      phone: row.guest_phone || '',
      company: '',
      type: String(row.source || 'meeting').replace(/_/g, ' '),
      status: row.status || '',
      staff: '',
      preferredDate: row.preferred_date || (row.start_at ? String(row.start_at).slice(0, 10) : ''),
      preferredTime: row.preferred_time_label || '',
      notes: row.notes || '',
      createdTime: row.created_at,
    }))

    return res.status(200).json({ meetings })
  } catch (err) {
    console.error('[software-team-meetings]', err)
    return res.status(500).json({ error: err?.message || 'Failed to load.' })
  }
}

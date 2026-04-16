/**
 * GET/POST /api/forms?action=<name>
 *
 * **tour** — may write Airtable Scheduling (legacy) or Postgres `scheduled_events` depending on flow.
 * **meeting** — Postgres only (`scheduled_events`, `event_type` = meeting); see `server/handlers/meeting.js`.
 *
 * actions: tour | meeting | software-team-meetings
 */
import meeting from './handlers/meeting.js'
import softwareTeamMeetings from './handlers/software-team-meetings.js'
import tour from './handlers/tour.js'

const handlers = {
  tour,
  meeting,
  'software-team-meetings': softwareTeamMeetings,
}

export default async function formsGateway(req, res) {
  const action = String(req.query?.action || '').trim()
  const fn = handlers[action]
  if (!fn) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    return res.status(404).json({ error: 'Not found' })
  }
  return fn(req, res)
}

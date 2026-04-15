/**
 * GET/POST /api/forms?action=<name>
 *
 * **tour** / **meeting** — public site (Contact, property pages, tour popup) uses these actions.
 * Handlers create rows in the Airtable **Scheduling** table (`Type` = Tour or Meeting). See
 * `server/handlers/tour.js` and `server/handlers/meeting.js` (table name overridable via
 * `AIRTABLE_SCHEDULING_TABLE`).
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

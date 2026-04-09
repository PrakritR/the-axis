/**
 * Single Vercel Serverless Function for all /api/<route> calls (Hobby: max 12 functions).
 * Uses one dynamic segment so /api/manager-lookup?manager_id=… keeps query params.
 *
 * Preferred entry points: /api/forms?action=…, /api/portal?action=… (see gateways).
 * Legacy paths /api/tour, /api/manager-auth, etc. stay supported.
 */
import formsGateway from '../server/forms-gateway.js'
import portalGateway from '../server/portal-gateway.js'
import demo from '../server/handlers/demo.js'
import generateLeaseDraft from '../server/handlers/generate-lease-draft.js'
import managerAuth from '../server/handlers/manager-auth.js'
import managerBillingPortal from '../server/handlers/manager-billing-portal.js'
import managerCreateAccount from '../server/handlers/manager-create-account.js'
import managerCreateSubscriptionSession from '../server/handlers/manager-create-subscription-session.js'
import managerLookup from '../server/handlers/manager-lookup.js'
import managerStartFreeTier from '../server/handlers/manager-start-free-tier.js'
import managerSubscriptionComplete from '../server/handlers/manager-subscription-complete.js'
import sendLeaseInvite from '../server/handlers/send-lease-invite.js'
import softwareTeamMeetings from '../server/handlers/software-team-meetings.js'
import stripe from '../server/handlers/stripe.js'
import tour from '../server/handlers/tour.js'

const routes = {
  forms: formsGateway,
  portal: portalGateway,
  stripe,
  demo,
  tour,
  'software-team-meetings': softwareTeamMeetings,
  'generate-lease-draft': generateLeaseDraft,
  'manager-auth': managerAuth,
  'manager-billing-portal': managerBillingPortal,
  'manager-create-account': managerCreateAccount,
  'manager-create-subscription-session': managerCreateSubscriptionSession,
  'manager-lookup': managerLookup,
  'manager-start-free-tier': managerStartFreeTier,
  'manager-subscription-complete': managerSubscriptionComplete,
  'send-lease-invite': sendLeaseInvite,
}

function segment(param) {
  if (param === undefined || param === null) return ''
  if (Array.isArray(param)) return String(param[0] || '').trim()
  return String(param).trim()
}

function routeKeyFromReq(req) {
  const fromDynamic = segment(req.query?.route)
  if (fromDynamic) return fromDynamic
  const raw = String(req.url || '').split('?')[0]
  const m = raw.match(/^\/api\/([^/]+)/)
  return m ? decodeURIComponent(m[1]).trim() : ''
}

export default async function handler(req, res) {
  const key = routeKeyFromReq(req)
  if (!key) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    return res.status(404).json({ error: 'Not found' })
  }
  const fn = routes[key]
  if (!fn) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    return res.status(404).json({ error: 'Not found' })
  }
  return fn(req, res)
}

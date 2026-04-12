/**
 * Single Vercel Serverless Function for all /api/<route> calls (Hobby: max 12 functions).
 * Uses one dynamic segment so /api/manager-lookup?manager_id=… keeps query params.
 *
 * Preferred entry points: /api/forms?action=…, /api/portal?action=… (see gateways).
 * Legacy paths /api/tour, /api/manager-auth, etc. stay supported.
 */
import formsGateway from '../backend/server/forms-gateway.js'
import portalGateway from '../backend/server/portal-gateway.js'
import adminPortalAuth from '../backend/server/handlers/admin-portal-auth.js'
import generateLeaseDraft from '../backend/server/handlers/generate-lease-draft.js'
import managerAuth from '../backend/server/handlers/manager-auth.js'
import managerApproveApplication from '../backend/server/handlers/manager-approve-application.js'
import managerBillingPortal from '../backend/server/handlers/manager-billing-portal.js'
import managerCreateAccount from '../backend/server/handlers/manager-create-account.js'
import managerCreateSubscriptionSession from '../backend/server/handlers/manager-create-subscription-session.js'
import managerLookup from '../backend/server/handlers/manager-lookup.js'
import managerStartFreeTier from '../backend/server/handlers/manager-start-free-tier.js'
import managerSubscriptionComplete from '../backend/server/handlers/manager-subscription-complete.js'
import notifyMessage from '../backend/server/handlers/notify-message.js'
import sendLeaseInvite from '../backend/server/handlers/send-lease-invite.js'
import signforgeWebhook from '../backend/server/handlers/signforge-webhook.js'
import softwareTeamMeetings from '../backend/server/handlers/software-team-meetings.js'
import stripe from '../backend/server/handlers/stripe.js'
import tour from '../backend/server/handlers/tour.js'

const routes = {
  'admin-portal-auth': adminPortalAuth,
  forms: formsGateway,
  portal: portalGateway,
  stripe,
  tour,
  'software-team-meetings': softwareTeamMeetings,
  'generate-lease-draft': generateLeaseDraft,
  'manager-auth': managerAuth,
  'manager-approve-application': managerApproveApplication,
  'manager-billing-portal': managerBillingPortal,
  'manager-create-account': managerCreateAccount,
  'manager-create-subscription-session': managerCreateSubscriptionSession,
  'manager-lookup': managerLookup,
  'manager-start-free-tier': managerStartFreeTier,
  'manager-subscription-complete': managerSubscriptionComplete,
  'notify-message': notifyMessage,
  'send-lease-invite': sendLeaseInvite,
  'signforge-webhook': signforgeWebhook,
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

/** Vercel sometimes delivers JSON POST bodies as a string; normalize so handlers always see an object when possible. */
function ensureParsedJsonBody(req) {
  const body = req.body
  if (body == null || typeof body !== 'string') return
  const trimmed = body.trim()
  if (!trimmed) {
    req.body = undefined
    return
  }
  const ct = String(req.headers?.['content-type'] || '')
  if (!ct.includes('application/json')) return
  try {
    req.body = JSON.parse(trimmed)
  } catch {
    /* leave string; route can validate */
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  try {
    ensureParsedJsonBody(req)
    const key = routeKeyFromReq(req)
    if (!key) {
      return res.status(404).json({ error: 'Not found' })
    }
    const fn = routes[key]
    if (!fn) {
      return res.status(404).json({ error: 'Not found' })
    }
    return await fn(req, res)
  } catch (err) {
    console.error('[api]', req.method, req.url, err)
    if (typeof res.headersSent === 'boolean' && res.headersSent) return
    try {
      return res.status(500).json({ error: err?.message || 'Internal server error' })
    } catch {
      /* response already committed */
    }
  }
}

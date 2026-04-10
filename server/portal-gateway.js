/**
 * GET/POST /api/portal?action=<name>
 * Manager auth, billing, lease tools, and invite email.
 */
import generateLeaseDraft from './handlers/generate-lease-draft.js'
import managerAuth from './handlers/manager-auth.js'
import managerBillingPortal from './handlers/manager-billing-portal.js'
import managerCreateAccount from './handlers/manager-create-account.js'
import managerCreateSubscriptionSession from './handlers/manager-create-subscription-session.js'
import managerLookup from './handlers/manager-lookup.js'
import managerStartFreeTier from './handlers/manager-start-free-tier.js'
import managerSubscriptionComplete from './handlers/manager-subscription-complete.js'
import managerUpdateProfile from './handlers/manager-update-profile.js'
import sendLeaseInvite from './handlers/send-lease-invite.js'
import signforgeSendLease from './handlers/signforge-send-lease.js'
import signforgeEnvelopeStatus from './handlers/signforge-envelope-status.js'
import workOrderAiSuggest from './handlers/work-order-ai-suggest.js'

const handlers = {
  'manager-auth': managerAuth,
  'manager-create-account': managerCreateAccount,
  'manager-lookup': managerLookup,
  'manager-subscription-complete': managerSubscriptionComplete,
  'manager-start-free-tier': managerStartFreeTier,
  'manager-create-subscription-session': managerCreateSubscriptionSession,
  'manager-billing-portal': managerBillingPortal,
  'manager-update-profile': managerUpdateProfile,
  'generate-lease-draft': generateLeaseDraft,
  'send-lease-invite': sendLeaseInvite,
  'signforge-send-lease': signforgeSendLease,
  'signforge-envelope-status': signforgeEnvelopeStatus,
  'work-order-ai-suggest': workOrderAiSuggest,
}

export default async function portalGateway(req, res) {
  const action = String(req.query?.action || '').trim()
  const fn = handlers[action]
  if (!fn) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    return res.status(404).json({ error: 'Not found' })
  }
  return fn(req, res)
}

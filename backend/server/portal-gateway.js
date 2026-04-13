/**
 * GET/POST /api/portal?action=<name>
 * Manager auth, billing, lease tools, and invite email.
 *
 * Tenant context: resolveManagerTenant() is called once here and the
 * result is attached to req._tenant before the action handler runs.
 * Individual handlers can read req._tenant without calling Airtable again.
 * Actions in NO_AUTH_ACTIONS bypass tenant resolution (login, account creation).
 */
import { resolveManagerTenant } from './middleware/resolveManagerTenant.js'
import applicationCreateLeaseDraft from './handlers/application-create-lease-draft.js'
import generateLeaseDraft from './handlers/generate-lease-draft.js'
import managerAuth from './handlers/manager-auth.js'
import managerApproveApplication from './handlers/manager-approve-application.js'
import managerRejectApplication from './handlers/manager-reject-application.js'
import managerBillingPortal from './handlers/manager-billing-portal.js'
import managerCreateAccount from './handlers/manager-create-account.js'
import managerCreateSubscriptionSession from './handlers/manager-create-subscription-session.js'
import managerLookup from './handlers/manager-lookup.js'
import managerStartFreeTier from './handlers/manager-start-free-tier.js'
import managerSubscriptionComplete from './handlers/manager-subscription-complete.js'
import managerUpdateProfile from './handlers/manager-update-profile.js'
import adminUpdateProfile from './handlers/admin-update-profile.js'
import sendLeaseInvite from './handlers/send-lease-invite.js'
import signforgeSendLease from './handlers/signforge-send-lease.js'
import signforgeEnvelopeStatus from './handlers/signforge-envelope-status.js'
import workOrderAiSuggest from './handlers/work-order-ai-suggest.js'

const handlers = {
  'application-create-lease-draft': applicationCreateLeaseDraft,
  'manager-auth': managerAuth,
  'manager-approve-application': managerApproveApplication,
  'manager-reject-application': managerRejectApplication,
  'manager-create-account': managerCreateAccount,
  'manager-lookup': managerLookup,
  'manager-subscription-complete': managerSubscriptionComplete,
  'manager-start-free-tier': managerStartFreeTier,
  'manager-create-subscription-session': managerCreateSubscriptionSession,
  'manager-billing-portal': managerBillingPortal,
  'manager-update-profile': managerUpdateProfile,
  'admin-update-profile': adminUpdateProfile,
  'generate-lease-draft': generateLeaseDraft,
  'send-lease-invite': sendLeaseInvite,
  'signforge-send-lease': signforgeSendLease,
  'signforge-envelope-status': signforgeEnvelopeStatus,
  'work-order-ai-suggest': workOrderAiSuggest,
}

// These actions don't require an authenticated manager session
const NO_AUTH_ACTIONS = new Set([
  'manager-auth',
  'manager-create-account',
  'manager-lookup',
  'manager-start-free-tier',
])

export default async function portalGateway(req, res) {
  const action = String(req.query?.action || '').trim()
  const fn = handlers[action]
  if (!fn) {
    res.setHeader('Access-Control-Allow-Origin', '*')
    return res.status(404).json({ error: 'Not found' })
  }

  // Resolve tenant context once and attach to req so handlers don't repeat the lookup
  if (!NO_AUTH_ACTIONS.has(action)) {
    try {
      req._tenant = await resolveManagerTenant(req)
    } catch (err) {
      res.setHeader('Access-Control-Allow-Origin', '*')
      return res.status(403).json({ error: err.message || 'Unauthorized' })
    }
  }

  return fn(req, res)
}

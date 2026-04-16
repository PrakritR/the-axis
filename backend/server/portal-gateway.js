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
import managerApplicationSetPending from './handlers/manager-application-set-pending.js'
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
import leaseSubmitEditRequest from './handlers/lease-submit-edit-request.js'
import leaseAdminRespond from './handlers/lease-admin-respond.js'
import leaseManagerReview from './handlers/lease-manager-review.js'
import leaseAddComment from './handlers/lease-add-comment.js'
import leaseMarkNotificationsRead from './handlers/lease-mark-notifications-read.js'
import leaseDownloadGeneratedPdf from './handlers/lease-download-generated-pdf.js'
import leaseResidentDownloadGeneratedPdf from './handlers/lease-resident-download-generated-pdf.js'
import leaseResidentAddComment from './handlers/lease-resident-add-comment.js'
import leaseResidentUploadPdf from './handlers/lease-resident-upload-pdf.js'
import leaseResidentListComments from './handlers/lease-resident-list-comments.js'
import leaseDraftPatch from './handlers/lease-draft-patch.js'
import applicationRegisterPayment from './handlers/application-register-payment.js'
import applicationPaymentStatus from './handlers/application-payment-status.js'
import applicationStripeSync from './handlers/application-stripe-sync.js'
import applicationSubmitSigner from './handlers/application-submit-signer.js'
import portalMyApplications from './handlers/portal-my-applications.js'
import portalMyPayments from './handlers/portal-my-payments.js'
import portalResidentContext from './handlers/portal-resident-context.js'
import applicationSubmitInternal from './handlers/application-submit-internal.js'

const handlers = {
  'application-create-lease-draft': applicationCreateLeaseDraft,
  'manager-auth': managerAuth,
  'manager-approve-application': managerApproveApplication,
  'manager-reject-application': managerRejectApplication,
  'manager-application-set-pending': managerApplicationSetPending,
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
  'lease-submit-edit-request': leaseSubmitEditRequest,
  'lease-admin-respond': leaseAdminRespond,
  'lease-manager-review': leaseManagerReview,
  'lease-add-comment': leaseAddComment,
  'lease-mark-notifications-read': leaseMarkNotificationsRead,
  'lease-download-generated-pdf': leaseDownloadGeneratedPdf,
  'lease-resident-download-generated-pdf': leaseResidentDownloadGeneratedPdf,
  'lease-resident-add-comment': leaseResidentAddComment,
  'lease-resident-upload-pdf': leaseResidentUploadPdf,
  'lease-resident-list-comments': leaseResidentListComments,
  'lease-draft-patch': leaseDraftPatch,
  'application-register-payment': applicationRegisterPayment,
  'application-payment-status': applicationPaymentStatus,
  'application-stripe-sync': applicationStripeSync,
  'application-submit-signer': applicationSubmitSigner,
  // Internal DB-backed resident views (Supabase JWT auth, no manager session required)
  'my-applications': portalMyApplications,
  'my-payments': portalMyPayments,
  'resident-context': portalResidentContext,
  /** Internal application submission — Supabase JWT auth, maps Airtable field names → internal DB. */
  'application-submit-internal': applicationSubmitInternal,
}

// These actions don't require an authenticated manager session
const NO_AUTH_ACTIONS = new Set([
  'manager-auth',
  'manager-create-account',
  'manager-lookup',
  'manager-start-free-tier',
  'application-register-payment',
  'application-payment-status',
  'application-stripe-sync',
  'application-submit-signer',
  /** Resident portal: proves access via residentRecordId + residentEmail in POST body */
  'lease-resident-download-generated-pdf',
  'lease-resident-add-comment',
  'lease-resident-upload-pdf',
  'lease-resident-list-comments',
  /** Internal DB-backed resident views: handle Supabase JWT auth themselves */
  'my-applications',
  'my-payments',
  'resident-context',
  /** Internal application submission: JWT-authenticated, no manager session needed */
  'application-submit-internal',
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

/**
 * Property payment recipient context — owner payout groundwork.
 *
 * Resolves who should receive payment for a property and whether their
 * Stripe Connect account is ready to receive transfers.
 *
 * Ownership types:
 *   Personal         → funds go to the main Axis Stripe account; no Connect routing.
 *   Third-Party Managed → funds routed to the owner's Stripe Express account when ready.
 *
 * This helper does NOT execute Stripe transfers. It returns everything the
 * calling code needs to decide routing at checkout / payout time.
 *
 * Used by:
 *   - Application-fee checkout (not yet owner-routed, but ready for it)
 *   - Rent checkout when implemented
 *   - Owner dashboard / status display
 *
 * @module
 */

import { getPropertyById } from './properties-service.js'
import { getOwnerProfileByAppUserId } from './owner-profiles-service.js'

/**
 * @typedef {{
 *   propertyId: string
 *   propertyName: string | null
 *   ownershipType: 'Personal' | 'Third-Party Managed'
 *   ownerAppUserId: string | null
 *   managerAppUserId: string | null
 *   ownerStripeConnectAccountId: string | null
 *   isOwnerStripeReady: boolean
 *   platformFeePercent: number
 * }} PropertyPaymentRecipientContext
 */

/**
 * Resolve the platform management fee percentage.
 * Source: AXIS_MANAGEMENT_FEE_PERCENT env var (default 10).
 */
export function getPlatformFeePercent() {
  const raw = Number(process.env.AXIS_MANAGEMENT_FEE_PERCENT)
  return Number.isFinite(raw) && raw >= 0 && raw <= 100 ? raw : 10
}

/**
 * Return recipient context for a property.
 *
 * @param {string} propertyId
 * @returns {Promise<PropertyPaymentRecipientContext | null>}
 */
export async function getPropertyPaymentRecipientContext(propertyId) {
  const pid = String(propertyId || '').trim()
  if (!pid) return null

  const property = await getPropertyById(pid)
  if (!property) return null

  const ownershipType     = property.ownership_type || 'Personal'
  const ownerAppUserId    = property.owned_by_app_user_id   || null
  const managerAppUserId  = property.managed_by_app_user_id || null
  const platformFeePercent = getPlatformFeePercent()

  let ownerStripeConnectAccountId = null
  let isOwnerStripeReady = false

  if (ownershipType === 'Third-Party Managed' && ownerAppUserId) {
    try {
      const ownerProfile = await getOwnerProfileByAppUserId(ownerAppUserId)
      if (ownerProfile) {
        ownerStripeConnectAccountId = ownerProfile.stripe_connect_account_id || null
        isOwnerStripeReady = !!(
          ownerStripeConnectAccountId &&
          ownerProfile.stripe_onboarding_complete &&
          ownerProfile.stripe_payouts_enabled &&
          ownerProfile.stripe_charges_enabled
        )
      }
    } catch (e) {
      // Non-fatal: if owner profile lookup fails, treat as not ready
      console.warn('[property-payment-recipient] owner profile lookup failed:', e?.message)
    }
  }

  return {
    propertyId: property.id,
    propertyName: property.name || null,
    ownershipType,
    ownerAppUserId,
    managerAppUserId,
    ownerStripeConnectAccountId,
    isOwnerStripeReady,
    platformFeePercent,
  }
}

/**
 * True if a checkout session for this property should use Stripe Connect routing.
 *
 * @param {PropertyPaymentRecipientContext} ctx
 * @returns {boolean}
 */
export function shouldRouteToOwner(ctx) {
  return ctx?.ownershipType === 'Third-Party Managed' && ctx?.isOwnerStripeReady === true
}

/**
 * Calculate the platform application_fee_amount in cents for a given total.
 *
 * @param {number} totalCents
 * @param {PropertyPaymentRecipientContext} ctx
 * @returns {number}
 */
export function platformFeeCents(totalCents, ctx) {
  if (!shouldRouteToOwner(ctx)) return 0
  return Math.round(totalCents * (ctx.platformFeePercent / 100))
}

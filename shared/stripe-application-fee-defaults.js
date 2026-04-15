/**
 * Application fee defaults aligned with Stripe Checkout: USD charges below ~$0.50 are rejected.
 * @see https://stripe.com/docs/currencies#minimum-and-maximum-charge-amounts
 */
export const STRIPE_APPLICATION_FEE_MIN_USD = 0.5

/** When env omits a fee, server + Apply use this (must be >= STRIPE_APPLICATION_FEE_MIN_USD when charging). */
export const DEFAULT_APPLICATION_FEE_USD = 50

/** Enforce Stripe USD floor for any positive fee (whole dollars from marketing are unchanged). */
export function clampPositiveApplicationFeeUsd(n) {
  if (!Number.isFinite(n) || n <= 0) return n
  return Math.min(9999, Math.max(STRIPE_APPLICATION_FEE_MIN_USD, n))
}

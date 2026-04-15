import {
  DEFAULT_APPLICATION_FEE_USD,
  clampPositiveApplicationFeeUsd,
} from '../../../shared/stripe-application-fee-defaults.js'

/** USD application fee enforced on Stripe + server (matches stripe.js / Apply). */
export function resolveExpectedApplicationFeeUsd() {
  const raw = process.env.STRIPE_APPLICATION_FEE_USD
  if (raw === undefined || raw === null || String(raw).trim() === '') return DEFAULT_APPLICATION_FEE_USD
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return DEFAULT_APPLICATION_FEE_USD
  if (n === 0) return 0
  return clampPositiveApplicationFeeUsd(Math.min(9999, n))
}

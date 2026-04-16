/**
 * Optional second Checkout line item on /api/stripe (resident + application fee flows).
 * Covers card processing or a fixed platform fee — configure with env (default: no add-on).
 */

function parsePositiveNumber(raw) {
  const n = Number(String(raw ?? '').trim())
  if (!Number.isFinite(n) || n <= 0) return 0
  return n
}

/**
 * @param {number} baseAmountUsd - Subtotal in USD (rent line, application fee, or sum of custom items).
 * @returns {number} Fee in whole cents precision (USD).
 */
export function resolveStripeCardServiceFeeUsd(baseAmountUsd) {
  const base = Number(baseAmountUsd)
  if (!Number.isFinite(base) || base <= 0) return 0

  const flat = parsePositiveNumber(process.env.STRIPE_CARD_SERVICE_FEE_USD)
  const pct = parsePositiveNumber(process.env.STRIPE_CARD_SERVICE_FEE_PERCENT)

  let fee = 0
  if (pct) fee += (base * pct) / 100
  fee += flat

  if (!Number.isFinite(fee) || fee <= 0) return 0
  return Math.round(fee * 100) / 100
}

export function stripeCardServiceFeeLineLabel() {
  const s = String(process.env.STRIPE_CARD_SERVICE_FEE_LABEL || '').trim()
  return s || 'Card processing & service fee'
}

/** USD application fee enforced on Stripe + server (matches stripe.js / Apply). */
export function resolveExpectedApplicationFeeUsd() {
  const raw = process.env.STRIPE_APPLICATION_FEE_USD
  if (raw === undefined || raw === null || String(raw).trim() === '') return 1
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return 1
  if (n === 0) return 0
  return Math.min(9999, n)
}

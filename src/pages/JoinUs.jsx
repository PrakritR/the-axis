import { useState } from 'react'
import { Seo } from '../lib/seo'

const DOWNLOAD_URL = import.meta.env.VITE_AXIS_DOWNLOAD_URL || import.meta.env.VITE_AXIS_DOWNLOAD_MAC_URL || ''
const DEFAULT_PROMO_CODE = 'FIRST20'

const BILLING_OPTIONS = [
  { id: 'monthly', label: 'Monthly' },
  { id: 'annual', label: 'Annual', badge: '20% off' },
]

const PLANS = [
  {
    id: 'free',
    name: 'Free Tier',
    prices: {
      monthly: { value: 'Free', suffix: '' },
      annual: { value: 'Free', suffix: '' },
    },
    description: 'House posting only.',
    ctaLabel: 'Choose Free',
    ctaTo: '#manager-access',
    ctaVariant: 'secondary',
    features: [
      'House posting only',
      'No rent collection access',
      'No announcements access',
      'No work order system',
    ],
  },
  {
    id: 'pro',
    name: 'Pro Tier',
    prices: {
      monthly: { value: '$20', suffix: '/ month' },
      annual: { value: '$192', suffix: '/ year' },
    },
    description: 'For 1-2 houses.',
    ctaLabel: 'Choose Pro',
    ctaTo: '#manager-access',
    ctaVariant: 'primary',
    featured: true,
    features: [
      '1-2 houses',
      'Rent collection access',
      'Announcements access',
      'Work order system access',
    ],
  },
  {
    id: 'business',
    name: 'Business Tier',
    prices: {
      monthly: { value: '$200', suffix: '/ month' },
      annual: { value: '$1,920', suffix: '/ year' },
    },
    description: 'For 10+ houses.',
    ctaLabel: 'Choose Business',
    ctaTo: '#manager-access',
    ctaVariant: 'secondary',
    features: [
      '10+ houses',
      'Rent collection access',
      'Announcements access',
      'Work order system access',
    ],
  },
]

function formatPhoneInput(raw) {
  const digits = String(raw || '').replace(/\D/g, '').slice(0, 10)
  if (digits.length < 4) return digits
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

function CheckIcon() {
  return (
    <svg className="mt-1 h-5 w-5 flex-none text-[#2563eb]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12.75 10.5 18 19 6.75" />
    </svg>
  )
}

const FREE_TIER_ONBOARDING_KEY = 'axis_manager_onboarding'

function PlanCard({ plan, activePlan, billingCycle, onChoosePlan }) {
  const isSelected = activePlan === plan.id
  const ctaClasses = isSelected || plan.ctaVariant === 'primary'
    ? 'bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] text-white shadow-[0_12px_28px_rgba(37,99,235,0.22)] hover:brightness-105'
    : 'border border-slate-200 bg-white text-slate-900 hover:border-slate-300 hover:bg-slate-50'
  const priceMeta = plan.prices[billingCycle]

  return (
    <article
      className={`flex h-full flex-col rounded-[30px] border p-7 shadow-[0_28px_70px_rgba(37,99,235,0.10)] backdrop-blur ${
        plan.featured
          ? 'border-white/95 bg-white shadow-[0_34px_80px_rgba(37,99,235,0.16)]'
          : 'border-white/85 bg-white/92'
      }`}
    >
      <div className="min-h-[168px]">
        <p className="text-[13px] font-bold text-slate-700">{plan.name}</p>
        <div className="mt-7 text-slate-900">
          <span className="text-5xl font-black tracking-[-0.05em]">{priceMeta.value}</span>
          {priceMeta.suffix ? <span className="ml-2 text-lg font-semibold text-slate-500">{priceMeta.suffix}</span> : null}
        </div>
        <p className="mt-5 text-base text-slate-500">{plan.description}</p>
        {billingCycle === 'annual' && plan.id !== 'free' ? (
          <p className="mt-2 text-sm font-semibold text-[#2563eb]">20% off annual billing</p>
        ) : null}
      </div>

      <a
        href={plan.ctaTo}
        onClick={() => onChoosePlan(plan.id)}
        className={`mt-7 inline-flex w-full items-center justify-center rounded-2xl px-5 py-4 text-base font-semibold transition ${ctaClasses}`}
      >
        {isSelected ? 'Selected' : plan.ctaLabel}
      </a>

      <ul className="mt-8 space-y-4 border-t border-slate-200 pt-7">
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-start gap-3 text-base leading-7 text-slate-800">
            <CheckIcon />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
    </article>
  )
}

export default function JoinUs() {
  const [selectedPlan, setSelectedPlan] = useState('pro')
  const [billingCycle, setBillingCycle] = useState('monthly')
  const [managerForm, setManagerForm] = useState({
    name: '',
    email: '',
    phone: '',
    promoCode: '',
  })
  const [managerLoading, setManagerLoading] = useState(false)
  const [managerError, setManagerError] = useState('')
  const [downloadNotice, setDownloadNotice] = useState('')

  const selectedPlanMeta = PLANS.find((plan) => plan.id === selectedPlan) || PLANS[1]

  function handleDownload() {
    if (DOWNLOAD_URL) {
      window.location.href = DOWNLOAD_URL
      return
    }
    setDownloadNotice('Add VITE_AXIS_DOWNLOAD_URL to connect the download button.')
  }

  async function handleManagerAccess(event) {
    event.preventDefault()

    const normalizedName = managerForm.name.trim()
    const normalizedEmail = managerForm.email.trim().toLowerCase()
    const normalizedPhone = managerForm.phone.trim()
    const normalizedPromoCode = managerForm.promoCode.trim().toUpperCase()

    if (!normalizedName || !normalizedEmail || !normalizedPhone) {
      setManagerError('Name, email, and phone are required.')
      return
    }

    setManagerError('')
    setManagerLoading(true)

    const isBypassPromo = normalizedPromoCode === DEFAULT_PROMO_CODE

    try {
      if (selectedPlan === 'free' || isBypassPromo) {
        const res = await fetch('/api/manager-start-free-tier', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: normalizedName,
            email: normalizedEmail,
            phone: normalizedPhone,
            planType: selectedPlan,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Could not start free setup.')

        sessionStorage.setItem(FREE_TIER_ONBOARDING_KEY, JSON.stringify(data))
        window.location.href = '/manager?view=create'
        return
      }

      const res = await fetch('/api/manager-create-subscription-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: normalizedName,
          email: normalizedEmail,
          phone: normalizedPhone,
          promoCode: normalizedPromoCode,
          planType: selectedPlan,
          billingInterval: billingCycle,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not start checkout.')
      window.location.href = data.url
    } catch (err) {
      setManagerError(err.message || 'Could not start checkout.')
      setManagerLoading(false)
    }
  }

  return (
    <>
      <Seo
        title="Join Axis | Axis"
        description="Choose a tier and get started with Axis."
        pathname="/join-us"
      />

      <section className="relative overflow-hidden bg-[linear-gradient(180deg,#edf2fb_0%,#e8eef8_48%,#ebf0f9_100%)] py-8 sm:py-12">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.96),rgba(255,255,255,0.25)_32%,transparent_58%),radial-gradient(circle_at_bottom,rgba(37,99,235,0.14),transparent_46%)]" aria-hidden />
        <div className="pointer-events-none absolute inset-x-0 top-[16%] h-[420px] bg-[radial-gradient(circle,rgba(37,99,235,0.13),transparent_58%)] blur-3xl" aria-hidden />

        <div className="container relative mx-auto max-w-7xl px-6">
          <div className="mx-auto mt-6 max-w-4xl text-center">
            <h1 className="text-5xl font-black tracking-[-0.06em] text-slate-900 sm:text-6xl lg:text-7xl">
              Start with Axis.
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-slate-500">
              Pick a tier and continue.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <div className="inline-flex rounded-full border border-white/90 bg-white/88 p-1 shadow-[0_12px_30px_rgba(37,99,235,0.10)] backdrop-blur">
                {BILLING_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setBillingCycle(option.id)}
                    className={`rounded-full px-5 py-3 text-sm font-semibold transition ${
                      billingCycle === option.id
                        ? 'bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] text-white shadow-[0_12px_24px_rgba(37,99,235,0.18)]'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {option.label}
                    {option.badge ? <span className={`ml-2 ${billingCycle === option.id ? 'text-white/80' : 'text-[#2563eb]'}`}>{option.badge}</span> : null}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-16 grid gap-6 lg:grid-cols-3">
            {PLANS.map((plan) => (
              <PlanCard key={plan.id} plan={plan} billingCycle={billingCycle} activePlan={selectedPlan} onChoosePlan={setSelectedPlan} />
            ))}
          </div>

          <div id="manager-access" className="mx-auto mt-12 max-w-4xl rounded-[32px] border border-white/90 bg-white/92 p-7 shadow-[0_24px_60px_rgba(148,163,184,0.18)] backdrop-blur sm:p-8">
            <div className="flex flex-col gap-5 border-b border-slate-200 pb-6">
              <div className="flex flex-wrap gap-3">
                {PLANS.map((plan) => (
                  <button
                    key={plan.id}
                    type="button"
                    onClick={() => setSelectedPlan(plan.id)}
                    className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                      selectedPlan === plan.id
                        ? 'bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] text-white shadow-[0_12px_28px_rgba(37,99,235,0.18)]'
                        : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
                    }`}
                  >
                    {plan.name}
                  </button>
                ))}
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#2563eb]">
                    {selectedPlan === 'free' ? 'Account setup' : 'Checkout'}
                  </div>
                  <h2 className="mt-2 text-3xl font-black tracking-[-0.04em] text-slate-900 sm:text-4xl">
                    {selectedPlanMeta.name}
                  </h2>
                </div>
                <div className="text-lg font-semibold text-slate-500">
                  {selectedPlanMeta.prices[billingCycle].value}
                  {selectedPlanMeta.prices[billingCycle].suffix}
                </div>
              </div>
              {selectedPlan !== 'free' ? (
                <div className="rounded-2xl border border-[#2563eb]/10 bg-[#2563eb]/5 px-4 py-3 text-sm text-slate-600">
                  Have a promo code? Enter it below — <span className="font-semibold text-slate-900">{DEFAULT_PROMO_CODE}</span> skips payment entirely.
                </div>
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  Free tier creates a listing-only manager account with no rent collection, announcements, or work orders.
                </div>
              )}
            </div>

            <form onSubmit={handleManagerAccess} className="mt-8 grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="mb-2 block text-sm font-semibold text-slate-700">Full name</label>
                <input
                  type="text"
                  value={managerForm.name}
                  onChange={(event) => setManagerForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Your name"
                  className="w-full rounded-[20px] border border-slate-200 bg-white px-5 py-4 text-base text-slate-900 placeholder:text-slate-400 transition focus:border-[#2563eb] focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Email</label>
                <input
                  type="email"
                  value={managerForm.email}
                  onChange={(event) => setManagerForm((current) => ({ ...current, email: event.target.value }))}
                  placeholder="you@example.com"
                  autoComplete="email"
                  className="w-full rounded-[20px] border border-slate-200 bg-white px-5 py-4 text-base text-slate-900 placeholder:text-slate-400 transition focus:border-[#2563eb] focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Phone</label>
                <input
                  type="tel"
                  value={managerForm.phone}
                  onChange={(event) => setManagerForm((current) => ({ ...current, phone: formatPhoneInput(event.target.value) }))}
                  placeholder="(206) 555-0100"
                  autoComplete="tel"
                  className="w-full rounded-[20px] border border-slate-200 bg-white px-5 py-4 text-base text-slate-900 placeholder:text-slate-400 transition focus:border-[#2563eb] focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20"
                />
              </div>

              {selectedPlan !== 'free' ? (
                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm font-semibold text-slate-700">Promo code</label>
                  <input
                    type="text"
                    value={managerForm.promoCode}
                    onChange={(event) => setManagerForm((current) => ({ ...current, promoCode: event.target.value.toUpperCase() }))}
                    placeholder={DEFAULT_PROMO_CODE}
                    className="w-full rounded-[20px] border border-slate-200 bg-white px-5 py-4 text-base font-semibold uppercase tracking-[0.04em] text-slate-900 placeholder:text-slate-400 transition focus:border-[#2563eb] focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20"
                  />
                </div>
              ) : null}

              {managerError ? (
                <div className="md:col-span-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {managerError}
                </div>
              ) : null}

              <div className="md:col-span-2 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-slate-500">
                  {selectedPlan === 'free' || managerForm.promoCode.trim().toUpperCase() === DEFAULT_PROMO_CODE
                    ? 'Promo code bypasses payment — goes straight to account setup.'
                    : billingCycle === 'annual'
                      ? 'Annual pricing includes the 20% discount.'
                      : 'Your plan selection carries straight into checkout.'}
                </p>
                <button
                  type="submit"
                  disabled={managerLoading}
                  className="inline-flex min-w-[220px] items-center justify-center rounded-full bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] px-7 py-4 text-base font-semibold text-white shadow-[0_16px_40px_rgba(37,99,235,0.28)] transition hover:brightness-105 disabled:opacity-50"
                >
                  {managerLoading
                    ? 'Creating setup…'
                    : `Continue with ${selectedPlanMeta.name}`}
                </button>
              </div>
            </form>
          </div>
        </div>
      </section>
    </>
  )
}

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Seo } from '../lib/seo'

const PLANS = [
  {
    name: 'Property Review',
    value: 'Apply',
    suffix: '',
    description: 'Use this if you want Axis to review a house, a setup, or a new property before you move into manager access.',
    ctaLabel: 'Apply Housing',
    ctaTo: '/apply',
    ctaVariant: 'secondary',
    eyebrow: 'Start here',
    features: [
      'Simple housing application',
      'Property review with the Axis team',
      'Clear next steps before onboarding',
      'No subscription required to apply',
    ],
  },
  {
    name: 'Manager Access',
    value: '$10',
    suffix: '/ month',
    description: 'This is the manager setup step. Start the recurring Stripe subscription, receive your manager ID after payment, and then create your portal account.',
    ctaLabel: 'Start manager access',
    ctaTo: '#manager-access',
    ctaVariant: 'primary',
    eyebrow: 'Manager access',
    badge: 'Promo code FIRST20',
    features: [
      'Recurring manager subscription',
      'Manager ID generated after payment',
      'Account created from saved manager details',
      'Houses, applications, and leasing in one portal',
    ],
    featured: true,
  },
  {
    name: 'Resident Access',
    value: 'Login',
    suffix: '',
    description: 'Residents do not subscribe here. They use the resident portal after approval to sign in, create an account, and manage housing tasks.',
    ctaLabel: 'Resident login',
    ctaTo: '/resident',
    ctaVariant: 'secondary',
    eyebrow: 'Resident access',
    features: [
      'Resident login and account activation',
      'Payments, work orders, and documents',
      'Connected to approved housing records',
      'Separate from manager subscription access',
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
    <svg className="mt-0.5 h-4.5 w-4.5 shrink-0 text-[#3b82f6]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12.75 10.5 18 19 6.75" />
    </svg>
  )
}

function PlanCard({ plan }) {
  const ctaClasses = plan.ctaVariant === 'primary'
    ? 'bg-slate-900 text-white hover:bg-slate-800'
    : 'border border-slate-200 bg-white text-slate-900 hover:border-slate-300 hover:bg-slate-50'

  return (
    <article
      className={`rounded-[32px] border p-7 shadow-[0_24px_60px_rgba(59,130,246,0.12)] transition sm:p-8 ${
        plan.featured
          ? 'border-[#0ea5a4]/25 bg-white shadow-[0_30px_80px_rgba(14,165,164,0.16)]'
          : 'border-white/70 bg-white/88 backdrop-blur'
      }`}
    >
      <div className="flex min-h-[120px] flex-col">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] font-bold tracking-tight text-slate-700">{plan.eyebrow}</p>
          {plan.badge ? (
            <span className="rounded-full border border-[#0ea5a4]/20 bg-[#0ea5a4]/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-[#0b8b8a]">
              {plan.badge}
            </span>
          ) : null}
        </div>

        <h2 className="mt-5 text-[32px] font-black tracking-tight text-slate-900 sm:text-[40px]">
          {plan.value}
          {plan.suffix ? <span className="ml-2 text-lg font-semibold text-slate-500 sm:text-xl">{plan.suffix}</span> : null}
        </h2>
        <h3 className="mt-4 text-2xl font-black tracking-tight text-slate-900">{plan.name}</h3>
        <p className="mt-3 text-base leading-8 text-slate-500">{plan.description}</p>
      </div>

      {plan.ctaTo.startsWith('#') ? (
        <a
          href={plan.ctaTo}
          className={`mt-8 inline-flex w-full items-center justify-center rounded-2xl px-5 py-4 text-base font-semibold transition ${ctaClasses}`}
        >
          {plan.ctaLabel}
        </a>
      ) : (
        <Link
          to={plan.ctaTo}
          className={`mt-8 inline-flex w-full items-center justify-center rounded-2xl px-5 py-4 text-base font-semibold transition ${ctaClasses}`}
        >
          {plan.ctaLabel}
        </Link>
      )}

      <div className="mt-8 border-t border-slate-200 pt-7">
        <ul className="space-y-4">
          {plan.features.map((feature) => (
            <li key={feature} className="flex items-start gap-3 text-base leading-7 text-slate-700">
              <CheckIcon />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      </div>
    </article>
  )
}

export default function JoinUs() {
  const [managerForm, setManagerForm] = useState({
    name: '',
    email: '',
    phone: '',
    promoCode: 'FIRST20',
  })
  const [managerLoading, setManagerLoading] = useState(false)
  const [managerError, setManagerError] = useState('')

  async function handleManagerAccess(event) {
    event.preventDefault()

    const normalizedName = managerForm.name.trim()
    const normalizedEmail = managerForm.email.trim().toLowerCase()
    const normalizedPhone = managerForm.phone.trim()
    const normalizedPromoCode = managerForm.promoCode.trim().toUpperCase()

    if (!normalizedName || !normalizedEmail || !normalizedPhone) {
      setManagerError('Name, email, and phone are required to start manager access.')
      return
    }

    setManagerError('')
    setManagerLoading(true)

    try {
      const res = await fetch('/api/manager-create-subscription-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: normalizedName,
          email: normalizedEmail,
          phone: normalizedPhone,
          promoCode: normalizedPromoCode,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not start manager access.')
      window.location.href = data.url
    } catch (err) {
      setManagerError(err.message || 'Could not start manager access.')
      setManagerLoading(false)
    }
  }

  return (
    <>
      <Seo
        title="Join Axis | Axis Seattle Housing"
        description="Start manager access with Axis, activate the recurring subscription, receive your manager ID, and create your portal account."
        pathname="/join-us"
      />

      <section className="relative overflow-hidden bg-[linear-gradient(180deg,#f5f8ff_0%,#eef4ff_46%,#f8fbff_100%)] py-20 sm:py-28">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.10),transparent_36%),radial-gradient(circle_at_bottom_right,rgba(14,165,164,0.10),transparent_34%)]" aria-hidden />
        <div className="pointer-events-none absolute inset-0 bg-dot-grid bg-dot-md opacity-30" aria-hidden />

        <div className="container relative mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-4xl text-center">
            <div className="inline-flex items-center rounded-full border border-white/80 bg-white/80 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.2em] text-[#0b8b8a] shadow-[0_10px_30px_rgba(255,255,255,0.55)] backdrop-blur">
              Join Axis
            </div>

            <h1 className="mt-8 text-5xl font-black tracking-tight text-slate-900 sm:text-6xl lg:text-7xl">
              Start managing with Axis.
            </h1>

            <p className="mx-auto mt-6 max-w-3xl text-lg leading-8 text-slate-500 sm:text-[22px] sm:leading-9">
              One clear flow: apply if you want a property review, start manager access when you are ready to subscribe, and keep resident login separate once housing is approved.
            </p>

            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 shadow-[0_12px_28px_rgba(148,163,184,0.14)]">
                <span className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Monthly billing</span>
                <span className="px-2 text-sm font-semibold text-slate-500">Recurring via Stripe</span>
              </div>
            </div>
          </div>

          <div className="mt-16 grid gap-6 xl:grid-cols-3">
            {PLANS.map((plan) => (
              <PlanCard key={plan.name} plan={plan} />
            ))}
          </div>

          <div id="manager-access" className="mx-auto mt-12 max-w-4xl rounded-[32px] border border-white/70 bg-white/92 p-7 shadow-[0_24px_60px_rgba(148,163,184,0.16)] backdrop-blur sm:p-8">
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#0ea5a4]">Manager access</div>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">Start the recurring subscription</h2>
            <p className="mt-3 text-base leading-7 text-slate-500">
              Enter the manager name, email, and phone number you want saved in the manager table. After payment, Axis creates the manager ID and you finish account creation in the manager portal.
            </p>

            <form onSubmit={handleManagerAccess} className="mt-8 grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="mb-2 block text-sm font-semibold text-slate-700">Full name</label>
                <input
                  type="text"
                  value={managerForm.name}
                  onChange={(event) => setManagerForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Your name"
                  className="w-full rounded-[24px] border border-slate-200 bg-white px-5 py-4 text-base text-slate-900 placeholder:text-slate-400 transition focus:border-[#0ea5a4] focus:outline-none focus:ring-2 focus:ring-[#0ea5a4]/20"
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
                  className="w-full rounded-[24px] border border-slate-200 bg-white px-5 py-4 text-base text-slate-900 placeholder:text-slate-400 transition focus:border-[#0ea5a4] focus:outline-none focus:ring-2 focus:ring-[#0ea5a4]/20"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Phone number</label>
                <input
                  type="tel"
                  value={managerForm.phone}
                  onChange={(event) => setManagerForm((current) => ({ ...current, phone: formatPhoneInput(event.target.value) }))}
                  placeholder="(206) 555-0100"
                  autoComplete="tel"
                  className="w-full rounded-[24px] border border-slate-200 bg-white px-5 py-4 text-base text-slate-900 placeholder:text-slate-400 transition focus:border-[#0ea5a4] focus:outline-none focus:ring-2 focus:ring-[#0ea5a4]/20"
                />
              </div>

              <div className="md:col-span-2">
                <label className="mb-2 block text-sm font-semibold text-slate-700">Promo code</label>
                <input
                  type="text"
                  value={managerForm.promoCode}
                  onChange={(event) => setManagerForm((current) => ({ ...current, promoCode: event.target.value.toUpperCase() }))}
                  placeholder="FIRST20"
                  className="w-full rounded-[24px] border border-slate-200 bg-white px-5 py-4 text-base font-semibold uppercase tracking-[0.06em] text-slate-900 placeholder:text-slate-400 transition focus:border-[#0ea5a4] focus:outline-none focus:ring-2 focus:ring-[#0ea5a4]/20"
                />
              </div>

              {managerError ? (
                <div className="md:col-span-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {managerError}
                </div>
              ) : null}

              <div className="md:col-span-2 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm leading-7 text-slate-500">
                  After checkout, Axis generates the manager ID and stores your details in Airtable for account creation.
                </p>
                <button
                  type="submit"
                  disabled={managerLoading}
                  className="inline-flex items-center justify-center rounded-full bg-[#0ea5a4] px-7 py-4 text-base font-semibold text-white transition hover:bg-[#0b8a89] disabled:opacity-50"
                >
                  {managerLoading ? 'Starting checkout…' : 'Start manager access'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </section>
    </>
  )
}

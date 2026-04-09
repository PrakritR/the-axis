import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Seo } from '../lib/seo'

const DESKTOP_DOWNLOAD_URL = import.meta.env.VITE_AXIS_DOWNLOAD_MAC_URL || ''
const MOBILE_DOWNLOAD_URL = import.meta.env.VITE_AXIS_DOWNLOAD_MOBILE_URL || ''

const PLATFORM_OPTIONS = [
  { id: 'desktop', label: 'Desktop', ctaLabel: 'Get for Mac', downloadUrl: DESKTOP_DOWNLOAD_URL },
  { id: 'mobile', label: 'Mobile', ctaLabel: 'Get mobile app', downloadUrl: MOBILE_DOWNLOAD_URL },
]

const BILLING_OPTIONS = [
  { id: 'monthly', label: 'Monthly' },
  { id: 'annually', label: 'Annually' },
]

const PLAN_CONTENT = {
  monthly: [
    {
      name: 'Starter',
      eyebrow: 'Residents',
      value: 'Free',
      suffix: '',
      description: 'Resident portal access after approval.',
      ctaLabel: 'Resident login',
      ctaTo: '/resident',
      ctaVariant: 'secondary',
      featuresIntro: 'Included.',
      features: [
        'Resident login',
        'Documents and payments',
        'Approved housing access',
        'Portal support',
      ],
    },
    {
      name: 'Pro',
      eyebrow: 'Managers',
      value: '$10',
      suffix: '/ month',
      description: 'Manager access with recurring billing.',
      ctaLabel: 'Subscribe',
      ctaTo: '#manager-access',
      ctaVariant: 'primary',
      badge: 'Promo code FIRST20',
      featured: true,
      featuresIntro: 'Everything in one place.',
      features: [
        'Recurring subscription',
        'Manager ID after payment',
        'Portal account setup',
        'Applications and leases',
      ],
    },
    {
      name: 'Property Review',
      eyebrow: 'Before you subscribe',
      value: 'Apply',
      suffix: '',
      description: 'Start here before manager access.',
      ctaLabel: 'Apply housing',
      ctaTo: '/apply',
      ctaVariant: 'secondary',
      featuresIntro: 'Best for onboarding.',
      features: [
        'Simple application',
        'Property review',
        'Next steps',
        'No subscription required',
      ],
    },
  ],
  annually: [
    {
      name: 'Starter',
      eyebrow: 'Residents',
      value: 'Free',
      suffix: '',
      description: 'Resident portal access after approval.',
      ctaLabel: 'Resident login',
      ctaTo: '/resident',
      ctaVariant: 'secondary',
      featuresIntro: 'Included.',
      features: [
        'Resident login',
        'Documents and payments',
        'Approved housing access',
        'Portal support',
      ],
    },
    {
      name: 'Pro',
      eyebrow: 'Managers',
      value: '$96',
      suffix: '/ year',
      description: 'Manager access with annual billing.',
      ctaLabel: 'Subscribe yearly',
      ctaTo: '#manager-access',
      ctaVariant: 'primary',
      badge: 'Save 20%',
      featured: true,
      featuresIntro: 'Everything in one place.',
      features: [
        'Annual subscription',
        'Manager ID after payment',
        'Portal account setup',
        'Applications and leases',
      ],
    },
    {
      name: 'Property Review',
      eyebrow: 'Before you subscribe',
      value: 'Apply',
      suffix: '',
      description: 'Start here before manager access.',
      ctaLabel: 'Apply housing',
      ctaTo: '/apply',
      ctaVariant: 'secondary',
      featuresIntro: 'Best for onboarding.',
      features: [
        'Simple application',
        'Property review',
        'Next steps',
        'No subscription required',
      ],
    },
  ],
}

function formatPhoneInput(raw) {
  const digits = String(raw || '').replace(/\D/g, '').slice(0, 10)
  if (digits.length < 4) return digits
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

function AppleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M16.42 12.2c.02 2.14 1.88 2.85 1.9 2.86-.02.05-.3 1.02-1 2.03-.61.88-1.24 1.75-2.24 1.77-.97.02-1.29-.57-2.4-.57-1.12 0-1.47.55-2.38.59-.97.04-1.71-.97-2.33-1.84-1.27-1.83-2.24-5.17-.94-7.44.65-1.13 1.8-1.84 3.05-1.86.95-.02 1.86.63 2.4.63.54 0 1.56-.78 2.63-.67.45.02 1.72.18 2.54 1.39-.07.05-1.52.88-1.5 3.11ZM14.95 4.73c.51-.62.86-1.49.76-2.35-.73.03-1.61.49-2.13 1.11-.47.54-.88 1.42-.77 2.26.81.06 1.63-.41 2.14-1.02Z" />
    </svg>
  )
}

function DeviceIcon({ platform }) {
  if (platform === 'mobile') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect x="7" y="2.75" width="10" height="18.5" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
        <path d="M10 5.75h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="12" cy="18" r="1" fill="currentColor" />
      </svg>
    )
  }

  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="4" width="18" height="12" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 20h8M12 16v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg className="mt-0.5 h-4.5 w-4.5 shrink-0 text-[#2563eb]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12.75 10.5 18 19 6.75" />
    </svg>
  )
}

function PlanCard({ plan }) {
  const ctaClasses = plan.ctaVariant === 'primary'
    ? 'bg-[linear-gradient(180deg,#2c3447_0%,#1a1d27_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] hover:brightness-110'
    : 'border border-slate-200 bg-white text-slate-900 hover:border-slate-300 hover:bg-slate-50'

  const content = (
    <>
      <div className="flex min-h-[210px] flex-col">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[13px] font-bold tracking-tight text-slate-700">{plan.name}</p>
            <p className="mt-1 text-sm font-medium text-slate-500">{plan.eyebrow}</p>
          </div>
          {plan.badge ? (
            <span className="rounded-full border border-[#2563eb]/10 bg-[#2563eb]/8 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-[#2563eb]">
              {plan.badge}
            </span>
          ) : null}
        </div>

        <div className="mt-10 text-slate-900">
          <span className="text-5xl font-black tracking-tight sm:text-6xl">{plan.value}</span>
          {plan.suffix ? <span className="ml-2 text-lg font-semibold text-slate-500 sm:text-xl">{plan.suffix}</span> : null}
        </div>

        <p className="mt-7 text-lg leading-8 text-slate-500">{plan.description}</p>
      </div>

      {plan.ctaTo.startsWith('#') ? (
        <a href={plan.ctaTo} className={`mt-8 inline-flex w-full items-center justify-center rounded-2xl px-5 py-4 text-base font-semibold transition ${ctaClasses}`}>
          {plan.ctaLabel}
        </a>
      ) : (
        <Link to={plan.ctaTo} className={`mt-8 inline-flex w-full items-center justify-center rounded-2xl px-5 py-4 text-base font-semibold transition ${ctaClasses}`}>
          {plan.ctaLabel}
        </Link>
      )}

      <div className="mt-8 border-t border-slate-200 pt-7">
        <p className="text-lg text-slate-500">{plan.featuresIntro}</p>
        <ul className="mt-7 space-y-4">
          {plan.features.map((feature) => (
            <li key={feature} className="flex items-start gap-3 text-base leading-7 text-slate-800">
              <CheckIcon />
              <span>{feature}</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  )

  return (
    <article
      className={`rounded-[32px] border p-7 shadow-[0_30px_80px_rgba(37,99,235,0.10)] backdrop-blur sm:p-8 ${
        plan.featured
          ? 'border-white/90 bg-white shadow-[0_36px_90px_rgba(37,99,235,0.16)]'
          : 'border-white/80 bg-white/92'
      }`}
    >
      {content}
    </article>
  )
}

function DownloadCta({ platform, onDownload }) {
  const activePlatform = PLATFORM_OPTIONS.find((option) => option.id === platform) || PLATFORM_OPTIONS[0]

  return (
    <button
      type="button"
      onClick={onDownload}
      className="inline-flex items-center gap-3 rounded-[20px] bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] px-6 py-4 text-base font-semibold text-white shadow-[0_18px_40px_rgba(37,99,235,0.38),inset_0_1px_0_rgba(255,255,255,0.24)] hover:translate-y-[-1px] hover:brightness-105"
    >
      <AppleIcon />
      <span>{activePlatform.ctaLabel}</span>
    </button>
  )
}

export default function JoinUs() {
  const [platform, setPlatform] = useState('desktop')
  const [billing, setBilling] = useState('monthly')
  const [managerForm, setManagerForm] = useState({
    name: '',
    email: '',
    phone: '',
    promoCode: 'FIRST20',
  })
  const [managerLoading, setManagerLoading] = useState(false)
  const [managerError, setManagerError] = useState('')
  const [downloadNotice, setDownloadNotice] = useState('')

  const plans = useMemo(() => PLAN_CONTENT[billing], [billing])
  const activePlatform = PLATFORM_OPTIONS.find((option) => option.id === platform) || PLATFORM_OPTIONS[0]

  function handleDownload() {
    if (activePlatform.downloadUrl) {
      window.location.href = activePlatform.downloadUrl
      return
    }

    setDownloadNotice(
      activePlatform.id === 'desktop'
        ? 'Add VITE_AXIS_DOWNLOAD_MAC_URL to launch the Mac download from this button.'
        : 'Add VITE_AXIS_DOWNLOAD_MOBILE_URL to launch the mobile download from this button.'
    )
  }

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
          billingInterval: billing,
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
        description="Choose a plan, switch monthly or annual billing, and start with Axis."
        pathname="/join-us"
      />

      <section className="relative overflow-hidden bg-[linear-gradient(180deg,#edf2fb_0%,#e8eef8_48%,#ebf0f9_100%)] py-16 sm:py-24">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.96),rgba(255,255,255,0.25)_32%,transparent_58%),radial-gradient(circle_at_bottom,rgba(37,99,235,0.14),transparent_46%)]" aria-hidden />
        <div className="pointer-events-none absolute inset-x-0 top-[16%] h-[420px] bg-[radial-gradient(circle,rgba(37,99,235,0.13),transparent_58%)] blur-3xl" aria-hidden />

        <div className="container relative mx-auto max-w-7xl px-6">
          <div className="flex items-center justify-end">
            <DownloadCta platform={platform} onDownload={handleDownload} />
          </div>

          <div className="mx-auto mt-16 max-w-5xl text-center">
            <div className="inline-flex h-28 w-28 items-center justify-center rounded-[30px] border border-white/80 bg-[linear-gradient(180deg,rgba(74,144,255,0.95),rgba(104,179,255,0.82))] shadow-[0_24px_70px_rgba(37,99,235,0.28),inset_0_1px_0_rgba(255,255,255,0.35)] backdrop-blur">
              <div className="flex h-20 w-20 items-center justify-center rounded-[24px] bg-white/88 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
                <svg width="42" height="42" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M12 4 5 11h4v9h6v-9h4L12 4Z" fill="#3b82f6" />
                </svg>
              </div>
            </div>

            <h1 className="mt-10 text-5xl font-black tracking-[-0.06em] text-slate-900 sm:text-6xl lg:text-7xl">
              Start with Axis for free.
            </h1>

            <p className="mx-auto mt-6 max-w-3xl text-lg leading-8 text-slate-500 sm:text-[22px] sm:leading-9">
              Choose your setup, download the app, and get started.
            </p>

            <div className="mt-10 flex justify-center">
              <div className="inline-flex rounded-full border border-white/90 bg-white/85 p-1 shadow-[0_16px_40px_rgba(15,23,42,0.08)] backdrop-blur">
                {PLATFORM_OPTIONS.map((option) => {
                  const active = platform === option.id
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => {
                        setPlatform(option.id)
                        setDownloadNotice('')
                      }}
                      className={`inline-flex items-center gap-2 rounded-full px-5 py-3 text-base font-semibold transition ${
                        active ? 'bg-[#1d2028] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]' : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      <DeviceIcon platform={option.id} />
                      <span>{option.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="mt-6 flex items-center justify-center gap-4">
              <span className={`text-[18px] font-semibold ${billing === 'monthly' ? 'text-slate-900' : 'text-slate-400'}`}>Monthly</span>
              <button
                type="button"
                role="switch"
                aria-checked={billing === 'annually'}
                aria-label="Toggle annual billing"
                onClick={() => setBilling((current) => (current === 'monthly' ? 'annually' : 'monthly'))}
                className={`relative h-11 w-20 rounded-full border transition ${
                  billing === 'annually' ? 'border-[#2563eb]/20 bg-[#2563eb]' : 'border-slate-200 bg-white'
                }`}
              >
                <span
                  className={`absolute top-1 h-9 w-9 rounded-full bg-slate-900 shadow-[0_8px_18px_rgba(15,23,42,0.16)] transition ${
                    billing === 'annually' ? 'left-10 bg-white' : 'left-1'
                  }`}
                />
              </button>
              <span className={`text-[18px] font-semibold ${billing === 'annually' ? 'text-slate-900' : 'text-slate-400'}`}>Annually</span>
            </div>

            {downloadNotice ? (
              <p className="mx-auto mt-4 max-w-xl text-sm font-medium text-slate-500">{downloadNotice}</p>
            ) : null}
          </div>

          <div className="mt-16 grid gap-6 xl:grid-cols-3">
            {plans.map((plan) => (
              <PlanCard key={`${billing}-${plan.name}`} plan={plan} />
            ))}
          </div>

          <div id="manager-access" className="mx-auto mt-12 max-w-5xl rounded-[32px] border border-white/90 bg-white/92 p-7 shadow-[0_24px_60px_rgba(148,163,184,0.18)] backdrop-blur sm:p-8">
            <div className="flex flex-col gap-4 border-b border-slate-200 pb-6 md:flex-row md:items-end md:justify-between">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#2563eb]">Manager access</div>
                <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
                  Start the {billing === 'annually' ? 'annual' : 'monthly'} subscription
                </h2>
                <p className="mt-3 max-w-3xl text-base leading-7 text-slate-500">
                  Enter your details and continue to checkout.
                </p>
              </div>
              <div className="rounded-2xl border border-[#2563eb]/10 bg-[#2563eb]/5 px-4 py-3 text-sm font-semibold text-slate-700">
                {billing === 'annually' ? 'Annual plan selected' : 'Monthly plan selected'}
              </div>
            </div>

            <form onSubmit={handleManagerAccess} className="mt-8 grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="mb-2 block text-sm font-semibold text-slate-700">Full name</label>
                <input
                  type="text"
                  value={managerForm.name}
                  onChange={(event) => setManagerForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Your name"
                  className="w-full rounded-[24px] border border-slate-200 bg-white px-5 py-4 text-base text-slate-900 placeholder:text-slate-400 transition focus:border-[#2563eb] focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20"
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
                  className="w-full rounded-[24px] border border-slate-200 bg-white px-5 py-4 text-base text-slate-900 placeholder:text-slate-400 transition focus:border-[#2563eb] focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20"
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
                  className="w-full rounded-[24px] border border-slate-200 bg-white px-5 py-4 text-base text-slate-900 placeholder:text-slate-400 transition focus:border-[#2563eb] focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20"
                />
              </div>

              <div className="md:col-span-2">
                <label className="mb-2 block text-sm font-semibold text-slate-700">Promo code</label>
                <input
                  type="text"
                  value={managerForm.promoCode}
                  onChange={(event) => setManagerForm((current) => ({ ...current, promoCode: event.target.value.toUpperCase() }))}
                  placeholder="FIRST20"
                  className="w-full rounded-[24px] border border-slate-200 bg-white px-5 py-4 text-base font-semibold uppercase tracking-[0.06em] text-slate-900 placeholder:text-slate-400 transition focus:border-[#2563eb] focus:outline-none focus:ring-2 focus:ring-[#2563eb]/20"
                />
              </div>

              {managerError ? (
                <div className="md:col-span-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {managerError}
                </div>
              ) : null}

              <div className="md:col-span-2 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="max-w-2xl text-sm leading-7 text-slate-500">
                  {billing === 'annually'
                    ? 'Annual Stripe plan.'
                    : 'Monthly Stripe plan.'}
                </p>
                <button
                  type="submit"
                  disabled={managerLoading}
                  className="inline-flex min-w-[220px] items-center justify-center rounded-full bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] px-7 py-4 text-base font-semibold text-white shadow-[0_16px_40px_rgba(37,99,235,0.28)] transition hover:brightness-105 disabled:opacity-50"
                >
                  {managerLoading ? 'Starting checkout…' : billing === 'annually' ? 'Start annual access' : 'Start manager access'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </section>
    </>
  )
}

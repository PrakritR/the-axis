import { Link } from 'react-router-dom'
import { Seo } from '../lib/seo'

const PLANS = [
  {
    name: 'Application',
    price: 'Free',
    suffix: '',
    description: 'Start with the housing application if you want Axis to review your setup before you move into the manager portal.',
    ctaLabel: 'Apply Housing',
    ctaTo: '/apply',
    ctaVariant: 'secondary',
    eyebrow: 'Starter',
    features: [
      'Simple housing application',
      'Property review with the Axis team',
      'Good fit for first-time partners',
      'No subscription needed to apply',
    ],
  },
  {
    name: 'Manager Portal',
    price: '$10',
    suffix: '/ month',
    description: 'Create your manager account, activate the recurring Stripe subscription, receive your manager ID, and run the full Axis workflow.',
    ctaLabel: 'Create manager account',
    ctaTo: '/manager?view=create',
    ctaVariant: 'primary',
    eyebrow: 'Pro',
    badge: 'Promo code FIRST20',
    features: [
      'Recurring manager subscription',
      'Manager ID generated after payment',
      'Add houses inside the portal',
      'Review applications and leasing',
      'One place for manager operations',
    ],
    featured: true,
  },
  {
    name: 'Resident Portal',
    price: 'Included',
    suffix: '',
    description: 'Residents use the resident portal after approval to sign in, view documents, and handle their housing workflow.',
    ctaLabel: 'Resident login',
    ctaTo: '/resident',
    ctaVariant: 'secondary',
    eyebrow: 'Included',
    features: [
      'Resident login access',
      'Payments and documents',
      'Work orders and lease actions',
      'Connected to approved housing records',
    ],
  },
]

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
          {plan.price}
          {plan.suffix ? <span className="ml-2 text-lg font-semibold text-slate-500 sm:text-xl">{plan.suffix}</span> : null}
        </h2>
        <h3 className="mt-4 text-2xl font-black tracking-tight text-slate-900">{plan.name}</h3>
        <p className="mt-3 text-base leading-8 text-slate-500">{plan.description}</p>
      </div>

      <Link
        to={plan.ctaTo}
        className={`mt-8 inline-flex w-full items-center justify-center rounded-2xl px-5 py-4 text-base font-semibold transition ${ctaClasses}`}
      >
        {plan.ctaLabel}
      </Link>

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
  return (
    <>
      <Seo
        title="Join Axis | Axis Seattle Housing"
        description="Join Axis with a simple pricing-style overview for manager access, account creation, recurring subscription setup, and portal access."
        pathname="/join-us"
      />

      <section className="relative overflow-hidden bg-[linear-gradient(180deg,#f5f8ff_0%,#eef4ff_46%,#f8fbff_100%)] py-20 sm:py-28">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.10),transparent_36%),radial-gradient(circle_at_bottom_right,rgba(14,165,164,0.10),transparent_34%)]" aria-hidden />
        <div className="pointer-events-none absolute inset-0 bg-dot-grid bg-dot-md opacity-30" aria-hidden />

        <div className="container relative mx-auto max-w-7xl px-6">
          <div className="mx-auto max-w-4xl text-center">
            <div className="inline-flex items-center rounded-full border border-white/80 bg-white/80 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.2em] text-[#0b8b8a] shadow-[0_10px_30px_rgba(255,255,255,0.55)] backdrop-blur">
              Axis manager access
            </div>

            <h1 className="mt-8 text-5xl font-black tracking-tight text-slate-900 sm:text-6xl lg:text-7xl">
              Start managing with Axis.
            </h1>

            <p className="mx-auto mt-6 max-w-3xl text-lg leading-8 text-slate-500 sm:text-[22px] sm:leading-9">
              Keep it simple. Apply if you need a review, or go straight into the manager portal to create your account, activate the recurring subscription, and start adding houses.
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

          <p className="mx-auto mt-10 max-w-3xl text-center text-sm leading-7 text-slate-500">
            Manager setup continues inside the manager portal. After subscription payment, Axis creates the manager ID in the backend and Airtable, then you finish account creation with that same email.
          </p>
        </div>
      </section>
    </>
  )
}

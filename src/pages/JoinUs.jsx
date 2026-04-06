import { Link } from 'react-router-dom'
import { Seo } from '../lib/seo'
import scrollToTop from '../utils/scrollToTop'

const CONTACT_EMAIL = 'info@axis-seattle-housing.com'
const CONTACT_PHONE_DISPLAY = '(510) 309-8345'
const CONTACT_PHONE_RAW = '15103098345'

const benefits = [
  { title: 'We handle everything', body: 'From listing your property to screening tenants, signing leases, and collecting rent — we manage it all so you don\'t have to.' },
  { title: 'Guaranteed rent collection', body: 'We pay you on time, every month. No chasing tenants, no gaps in payment.' },
  { title: 'Professional cleaning & maintenance', body: 'We coordinate bi-monthly cleaning and handle maintenance requests on your behalf.' },
  { title: 'Quality tenants', body: 'We screen all applicants — background checks, references, and financial verification included.' },
  { title: 'Higher yield per property', body: 'By furnishing and co-living optimizing your home, we help you earn more per square foot than traditional leases.' },
  { title: 'Local expertise', body: 'We know the U District market. We price rooms competitively and keep occupancy high year-round.' },
]

const steps = [
  { n: '01', title: 'Reach out', body: 'Contact us with your property details. We\'ll respond within 2 business days.' },
  { n: '02', title: 'Property review', body: 'We assess your home, discuss pricing, and walk you through our management model.' },
  { n: '03', title: 'We list & manage', body: 'Once onboarded, we handle everything — listing, tenants, cleaning, and rent collection.' },
]

export default function JoinUs() {
  return (
    <div className="bg-cream-50">
      <Seo
        title="List Your Property | Axis Seattle"
        description="Partner with Axis Seattle to list and manage your property near UW. We handle tenants, cleaning, and rent collection — you collect the income."
        pathname="/join"
      />

      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">

        {/* Header */}
        <div className="max-w-3xl">
          <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-axis">For Property Owners</div>
          <h1 className="mt-4 text-4xl font-black tracking-tight text-slate-900 sm:text-5xl">
            Partner with Axis Seattle.
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-600">
            Have a home near UW? We list, manage, and fill it — while you earn consistent rental income without the hassle.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href={`mailto:${CONTACT_EMAIL}?subject=Property partnership inquiry`}
              className="rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors"
            >
              Get in touch
            </a>
            <a
              href={`tel:${CONTACT_PHONE_RAW}`}
              className="rounded-full border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:border-slate-500 transition-colors"
            >
              Call {CONTACT_PHONE_DISPLAY}
            </a>
          </div>
        </div>

        {/* Benefits */}
        <div className="mt-16 border-t border-slate-200 pt-14">
          <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-axis">Why partner with us</div>
          <h2 className="mt-3 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">What we bring to the table</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {benefits.map((b) => (
              <div key={b.title} className="rounded-2xl border border-slate-200 bg-white p-6">
                <div className="text-base font-bold text-slate-900">{b.title}</div>
                <p className="mt-2 text-sm leading-6 text-slate-500">{b.body}</p>
              </div>
            ))}
          </div>
        </div>

        {/* How it works */}
        <div className="mt-16 border-t border-slate-200 pt-14">
          <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-axis">Process</div>
          <h2 className="mt-3 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">How it works</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {steps.map((s) => (
              <div key={s.n} className="rounded-2xl border border-slate-200 bg-white p-6">
                <div className="text-3xl font-black text-axis">{s.n}</div>
                <div className="mt-3 text-base font-bold text-slate-900">{s.title}</div>
                <p className="mt-2 text-sm leading-6 text-slate-500">{s.body}</p>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="mt-16 relative overflow-hidden rounded-3xl bg-navy-900 px-8 py-12 sm:px-12">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_50%,rgba(14,165,164,0.2),transparent_60%)]" />
          <div className="relative flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-2xl font-black tracking-tight text-white sm:text-3xl">Ready to list your property?</h2>
              <p className="mt-2 text-sm text-white/60">Reach out and we'll walk you through the process.</p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <a
                href={`mailto:${CONTACT_EMAIL}?subject=Property partnership inquiry`}
                className="inline-flex items-center justify-center rounded-full bg-axis px-6 py-3 text-sm font-semibold text-white shadow-[0_0_24px_rgba(14,165,164,0.5)] transition hover:bg-axis-dark whitespace-nowrap"
              >
                Email us
              </a>
              <Link
                to="/contact"
                onClick={scrollToTop}
                className="inline-flex items-center justify-center rounded-full border border-white/20 bg-white/10 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/20 whitespace-nowrap"
              >
                Contact page
              </Link>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}

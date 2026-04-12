import { Link } from 'react-router-dom'
import { Seo } from '../lib/seo'
import scrollToTop from '../utils/scrollToTop'

export default function OwnersAbout() {
  return (
    <>
      <Seo title="Partner With Axis | Property owners" description="Axis for property owners and operators." pathname="/owners/about" />
      <div className="relative overflow-hidden bg-[linear-gradient(180deg,#edf2fb_0%,#eef3fb_48%,#f6f9fe_100%)] py-16 sm:py-24">
        <div className="container relative mx-auto max-w-3xl px-6">
          <h1 className="text-4xl font-black tracking-tight text-slate-900 sm:text-5xl">Partner With Axis</h1>
          <p className="mt-6 text-lg leading-8 text-slate-600">
            Axis helps owners and operators list homes, run applications, generate leases, and keep residents on track — with clear pricing and tools built for Seattle-area rental housing.
          </p>
          <p className="mt-4 text-lg leading-8 text-slate-600">
            Whether you manage one house or a larger portfolio, we combine housing visibility with software for rent collection, announcements, and maintenance — so you spend less time on paperwork.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Link to="/owners/pricing" onClick={scrollToTop} className="inline-flex rounded-full bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] px-6 py-3 text-sm font-semibold text-white shadow-[0_12px_28px_rgba(37,99,235,0.22)] transition hover:brightness-105">
              View pricing
            </Link>
            <Link to="/owners/contact" onClick={scrollToTop} className="inline-flex rounded-full border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-800 transition hover:border-slate-300">
              Contact us
            </Link>
          </div>
        </div>
      </div>
    </>
  )
}

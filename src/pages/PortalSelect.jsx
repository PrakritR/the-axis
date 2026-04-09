import { Link } from 'react-router-dom'
import { Seo } from '../lib/seo'
import scrollToTop from '../utils/scrollToTop'

export default function PortalSelect() {
  return (
    <>
      <Seo title="Portal | Axis" description="Resident or manager access." pathname="/portal" />
      <div className="mx-auto max-w-2xl px-4 py-16 sm:py-24">
        <h1 className="text-center text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">Choose a portal</h1>
        <p className="mx-auto mt-3 max-w-md text-center text-sm text-slate-500">Sign in to the experience that matches your role.</p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          <Link
            to="/resident"
            onClick={scrollToTop}
            className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_16px_40px_rgba(37,99,235,0.08)] transition hover:border-[#2563eb] hover:shadow-[0_20px_48px_rgba(37,99,235,0.12)]"
          >
            <span className="text-xs font-bold uppercase tracking-[0.16em] text-[#2563eb]">Residents</span>
            <span className="mt-2 text-lg font-bold text-slate-900">Resident portal</span>
            <span className="mt-2 text-sm text-slate-500">Leases, rent, and household updates.</span>
            <span className="mt-6 text-sm font-semibold text-[#2563eb]">Continue →</span>
          </Link>
          <Link
            to="/manager"
            onClick={scrollToTop}
            className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_16px_40px_rgba(37,99,235,0.08)] transition hover:border-[#2563eb] hover:shadow-[0_20px_48px_rgba(37,99,235,0.12)]"
          >
            <span className="text-xs font-bold uppercase tracking-[0.16em] text-[#2563eb]">Managers</span>
            <span className="mt-2 text-lg font-bold text-slate-900">Manager portal</span>
            <span className="mt-2 text-sm text-slate-500">Properties, leasing, and Axis tools.</span>
            <span className="mt-6 text-sm font-semibold text-[#2563eb]">Continue →</span>
          </Link>
        </div>
      </div>
    </>
  )
}

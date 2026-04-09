import { Link } from 'react-router-dom'
import { Seo } from '../lib/seo'
import scrollToTop from '../utils/scrollToTop'

const portalBtn =
  'flex flex-col rounded-[28px] border border-slate-200/90 bg-white p-8 text-left shadow-[0_20px_50px_rgba(37,99,235,0.1)] transition hover:border-[#2563eb]/40 hover:shadow-[0_28px_60px_rgba(37,99,235,0.14)] sm:p-10'

export default function PortalSelect() {
  return (
    <>
      <Seo
        title="Portal | Axis"
        description="Sign in to the manager or resident portal. Explore houses or partner with Axis from the menu."
        pathname="/portal"
      />
      <div
        className="flex min-h-svh min-h-screen flex-col bg-[linear-gradient(180deg,#f7fbff_0%,#eef5ff_48%,#f9fcff_100%)]"
        data-axis-page="portal-hub"
      >
        <main className="flex flex-1 flex-col px-4 py-12 sm:px-6 sm:py-16">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">Choose your portal</h1>
            <p className="mt-2 text-sm text-slate-500">
              Managers and leasing staff use the manager portal. Residents sign in to view leases and payments.
            </p>
          </div>
          <div className="mx-auto mt-10 grid w-full max-w-4xl gap-5 sm:grid-cols-2 sm:gap-6">
            <Link to="/manager" onClick={scrollToTop} className={portalBtn}>
              <span className="text-xs font-bold uppercase tracking-[0.18em] text-[#2563eb]">Managers</span>
              <span className="mt-3 text-xl font-black text-slate-900 sm:text-2xl">Manager portal</span>
              <span className="mt-2 text-sm leading-relaxed text-slate-500">
                Houses, applications, lease drafts, and subscription billing.
              </span>
              <span className="mt-8 inline-flex items-center gap-2 text-sm font-bold text-[#2563eb]">
                Open manager portal
                <span aria-hidden>→</span>
              </span>
            </Link>
            <Link to="/resident" onClick={scrollToTop} className={portalBtn}>
              <span className="text-xs font-bold uppercase tracking-[0.18em] text-[#2563eb]">Residents</span>
              <span className="mt-3 text-xl font-black text-slate-900 sm:text-2xl">Resident portal</span>
              <span className="mt-2 text-sm leading-relaxed text-slate-500">
                View your lease, documents, and resident billing.
              </span>
              <span className="mt-8 inline-flex items-center gap-2 text-sm font-bold text-[#2563eb]">
                Open resident portal
                <span aria-hidden>→</span>
              </span>
            </Link>
          </div>
        </main>
      </div>
    </>
  )
}

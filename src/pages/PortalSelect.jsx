import { Link } from 'react-router-dom'
import { Seo } from '../lib/seo'
import scrollToTop from '../utils/scrollToTop'

const portalBtn =
  'flex flex-col rounded-[28px] border border-slate-200/90 bg-white/88 p-8 text-left shadow-[0_20px_50px_rgba(37,99,235,0.08)] backdrop-blur-sm transition hover:border-[#2563eb]/40 hover:shadow-[0_28px_60px_rgba(37,99,235,0.13)] sm:p-10'

export default function PortalSelect() {
  return (
    <>
      <Seo
        title="Portal | Axis"
        description="Sign in to the manager or resident portal."
        pathname="/portal"
      />
      <main className="flex flex-1 flex-col px-4 py-10 font-sans sm:px-6 sm:py-14" data-axis-page="portal-hub">
        <div className="mx-auto grid w-full max-w-4xl gap-5 sm:grid-cols-2 sm:gap-6">
          <Link to="/manager" onClick={scrollToTop} className={portalBtn}>
            <span className="text-xl font-black text-slate-900 sm:text-2xl">Manager portal</span>
            <span className="mt-8 inline-flex items-center gap-2 text-sm font-bold text-[#2563eb]">
              Open manager portal
              <span aria-hidden>→</span>
            </span>
          </Link>
          <Link to="/resident" onClick={scrollToTop} className={portalBtn}>
            <span className="text-xl font-black text-slate-900 sm:text-2xl">Resident portal</span>
            <span className="mt-8 inline-flex items-center gap-2 text-sm font-bold text-[#2563eb]">
              Open resident portal
              <span aria-hidden>→</span>
            </span>
          </Link>
        </div>
      </main>
    </>
  )
}

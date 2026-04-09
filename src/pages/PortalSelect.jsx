import { Link } from 'react-router-dom'
import { Seo } from '../lib/seo'
import { HOUSING_EXPLORE_PATH } from '../lib/housingSite'
import scrollToTop from '../utils/scrollToTop'
import { AxisWordmark } from '../components/logos/AxisLogos'
import PortalBubble from '../components/PortalBubble'

const portalBtn =
  'flex flex-col rounded-[28px] border border-slate-200/90 bg-white p-8 text-left shadow-[0_20px_50px_rgba(37,99,235,0.1)] transition hover:border-[#2563eb]/40 hover:shadow-[0_28px_60px_rgba(37,99,235,0.14)] sm:p-10'

const hubNavLink =
  'text-lg font-black tracking-tight text-slate-900 transition hover:text-[#2563eb] sm:text-xl'

export default function PortalSelect() {
  return (
    <>
      <Seo title="Portal | Axis" description="Explore student housing or partner with Axis." pathname="/portal" />
      <div className="flex min-h-svh min-h-screen flex-col bg-[linear-gradient(180deg,#f7fbff_0%,#eef5ff_48%,#f9fcff_100%)]">
        <header className="shrink-0 border-b border-slate-200/80 bg-white/75 backdrop-blur-xl">
          <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-5">
            <div className="flex flex-wrap items-center gap-4">
              <Link to="/" onClick={scrollToTop} className="shrink-0" aria-label="Axis home">
                <AxisWordmark tone="dark" className="h-8 w-auto sm:h-9" />
              </Link>
              <PortalBubble aria-current="page">Portal</PortalBubble>
            </div>
            <nav
              className="flex flex-wrap items-center gap-6 sm:gap-12 md:justify-end"
              aria-label="Portal destinations"
            >
              <Link to={HOUSING_EXPLORE_PATH} onClick={scrollToTop} className={hubNavLink}>
                Explore property
              </Link>
              <Link to="/owners/about" onClick={scrollToTop} className={hubNavLink}>
                Partner with Axis
              </Link>
            </nav>
          </div>
        </header>

        <main className="flex flex-1 flex-col px-4 py-12 sm:px-6 sm:py-16">
          <p className="mx-auto max-w-3xl text-center text-sm text-slate-500">
            Choose where you want to go next.
          </p>
          <div className="mx-auto mt-10 grid w-full max-w-4xl gap-5 sm:grid-cols-2 sm:gap-6">
            <Link to={HOUSING_EXPLORE_PATH} onClick={scrollToTop} className={portalBtn}>
              <span className="text-xs font-bold uppercase tracking-[0.18em] text-[#2563eb]">Housing</span>
              <span className="mt-3 text-xl font-black text-slate-900 sm:text-2xl">Explore Homes</span>
              <span className="mt-2 text-sm leading-relaxed text-slate-500">
                Browse listings and apply online.
              </span>
              <span className="mt-8 inline-flex items-center gap-2 text-sm font-bold text-[#2563eb]">
                Go to homes
                <span aria-hidden>→</span>
              </span>
            </Link>
            <Link to="/owners/about" onClick={scrollToTop} className={portalBtn}>
              <span className="text-xs font-bold uppercase tracking-[0.18em] text-[#2563eb]">Partners</span>
              <span className="mt-3 text-xl font-black text-slate-900 sm:text-2xl">Partner With Axis</span>
              <span className="mt-2 text-sm leading-relaxed text-slate-500">
                Software and tools for property owners and operators.
              </span>
              <span className="mt-8 inline-flex items-center gap-2 text-sm font-bold text-[#2563eb]">
                Go to partner site
                <span aria-hidden>→</span>
              </span>
            </Link>
          </div>
        </main>
      </div>
    </>
  )
}

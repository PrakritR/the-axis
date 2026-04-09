import { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import scrollToTop from '../utils/scrollToTop'
import { AxisWordmark } from './logos/AxisLogos'
import { HOUSING_HOME_URL } from '../lib/housingSite'

export default function OwnersNav() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const location = useLocation()

  const links = [
    { label: 'About us', to: '/owners/about', isActive: location.pathname === '/owners/about' },
    { label: 'Pricing', to: '/owners/pricing', isActive: location.pathname === '/owners/pricing' },
    { label: 'Contact', to: '/owners/contact', isActive: location.pathname === '/owners/contact' },
    { label: 'Explore properties', href: HOUSING_HOME_URL, external: true, isActive: false },
  ]

  useEffect(() => {
    function onScroll() { setScrolled(window.scrollY > 12) }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => { setMobileOpen(false) }, [location.pathname])

  function closeMobileMenu() { setMobileOpen(false) }

  return (
    <header className={`relative z-30 w-full shrink-0 border-b transition-all duration-300 md:sticky md:top-0 ${
      scrolled ? 'border-slate-200/80 bg-white/82 shadow-[0_10px_36px_rgba(37,99,235,0.08)] md:backdrop-blur-xl' : 'border-transparent bg-transparent md:bg-white/42 md:backdrop-blur-xl'
    }`}>
      <div className="container mx-auto flex items-center justify-between px-4 py-2.5 sm:px-6 sm:py-3.5">
        <Link to="/owners/about" className="group flex items-center" onClick={scrollToTop} aria-label="Axis for property owners">
          <AxisWordmark tone="dark" className="h-8 w-auto transition-transform duration-300 group-hover:scale-[1.02] sm:h-9" />
        </Link>

        <nav className="hidden flex-wrap items-center justify-end gap-5 lg:gap-6 md:flex">
          {links.map((item) =>
            item.external ? (
              <a
                key={item.label}
                href={item.href}
                className="text-sm font-medium text-slate-500 transition hover:text-slate-900"
              >
                {item.label}
              </a>
            ) : (
              <Link
                key={item.label}
                to={item.to}
                onClick={scrollToTop}
                className={`relative text-sm font-medium transition ${item.isActive ? 'text-slate-900' : 'text-slate-500 hover:text-slate-900'}`}
              >
                {item.label}
                <span className={`absolute -bottom-2 left-0 h-px bg-[#2563eb] transition-all duration-300 ${item.isActive ? 'w-full opacity-100' : 'w-0 opacity-0'}`} />
              </Link>
            ))}
          <Link
            to="/portal"
            onClick={scrollToTop}
            className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
              location.pathname === '/portal'
                ? 'border-[#2563eb] bg-[#2563eb] text-white'
                : 'border-slate-200 bg-white/70 text-slate-800 hover:border-[#2563eb] hover:text-[#2563eb]'
            }`}
          >
            Portal
          </Link>
        </nav>

        <div className="flex items-center gap-2 md:hidden">
          <Link to="/portal" onClick={scrollToTop} className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700">Portal</Link>
          <button
            type="button"
            onClick={() => setMobileOpen((o) => !o)}
            aria-label="Toggle navigation menu"
            aria-expanded={mobileOpen}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white/70 text-slate-600 transition hover:border-[#2563eb] hover:text-[#2563eb]"
          >
            {mobileOpen ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
            )}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            key="owners-mobile"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0.9, 0.2, 1] }}
            className="overflow-hidden border-t border-slate-200 bg-white/95 backdrop-blur-xl md:hidden"
          >
            <nav className="container mx-auto flex flex-col gap-1 px-4 py-3">
              <Link to="/owners/about" onClick={() => { closeMobileMenu(); scrollToTop() }} className="rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900">About us</Link>
              <Link to="/owners/pricing" onClick={() => { closeMobileMenu(); scrollToTop() }} className="rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900">Pricing</Link>
              <Link to="/owners/contact" onClick={() => { closeMobileMenu(); scrollToTop() }} className="rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900">Contact</Link>
              <a href={HOUSING_HOME_URL} onClick={closeMobileMenu} className="rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900">Explore properties</a>
              <Link to="/portal" onClick={() => { closeMobileMenu(); scrollToTop() }} className="rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900">Portal</Link>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  )
}

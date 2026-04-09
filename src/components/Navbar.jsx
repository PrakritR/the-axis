import React, { useState, useEffect, useMemo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import scrollToTop from '../utils/scrollToTop'
import { AxisWordmark } from './logos/AxisLogos'
import { HOUSING_CONTACT_SCHEDULE } from '../lib/housingSite'
import PortalNavLink from './PortalNavLink'

function HomeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1v-9.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M16 3v4M8 3v4M3 11h18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function ApplyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v0Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 12h6M9 16h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function AxisIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M4 9h16v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  const params = useMemo(() => new URLSearchParams(location.search), [location.search])

  const isHome = location.pathname === '/' || location.pathname.startsWith('/properties/')
  const isApply = location.pathname === '/apply'
  const isScheduleTour =
    location.pathname === '/contact' &&
    params.get('section') === 'housing' &&
    params.get('tab') !== 'message'
  const isPortal = location.pathname === '/portal'

  const showMobileDock = ['/', '/apply', '/contact'].includes(location.pathname)
  const promoText = 'Sign up now. No application fee for a limited time.'

  const centerNav = [
    { label: 'Houses', to: '/', isActive: isHome },
    { label: 'Apply Housing', to: '/apply', isActive: isApply },
    { label: 'Schedule Tour', to: HOUSING_CONTACT_SCHEDULE, isActive: isScheduleTour },
    { label: 'Join Axis', to: '/owners/about', isActive: false },
  ]

  const mobileDockLinks = [
    { label: 'Houses', to: '/', icon: <HomeIcon />, isActive: isHome },
    { label: 'Apply', to: '/apply', icon: <ApplyIcon />, isActive: isApply },
    { label: 'Tour', to: HOUSING_CONTACT_SCHEDULE, icon: <CalendarIcon />, isActive: isScheduleTour },
    { label: 'Join Axis', to: '/owners/about', icon: <AxisIcon />, isActive: false },
  ]

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname, location.search])

  function closeMobileMenu() {
    setMobileOpen(false)
  }

  return (
    <header className="relative z-30 w-full shrink-0 border-b border-slate-200/30 bg-[#edf2fb]/88 backdrop-blur-xl md:sticky md:top-0">
      <div className="border-b border-slate-200/25 text-slate-700" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="container mx-auto flex items-center justify-center gap-3 px-4 py-2 text-center sm:px-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600 sm:text-xs">{promoText}</p>
          <Link
            to="/apply"
            onClick={scrollToTop}
            className="hidden rounded-full bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white shadow-[0_10px_24px_rgba(37,99,235,0.24)] transition hover:brightness-105 sm:inline-flex"
          >
            Apply now
          </Link>
        </div>
      </div>

      <div className="container mx-auto flex items-center gap-3 px-4 py-2.5 sm:px-6 sm:py-3.5">
        <Link to="/" className="group flex shrink-0 items-center" onClick={scrollToTop} aria-label="Axis home">
          <AxisWordmark tone="dark" className="h-8 w-auto transition-transform duration-300 group-hover:scale-[1.02] sm:h-9" />
        </Link>

        <nav className="hidden min-w-0 flex-1 items-center justify-center gap-5 lg:gap-8 md:flex">
          {centerNav.map((item) => (
            <Link
              key={item.label}
              to={item.to}
              onClick={scrollToTop}
              className={`relative shrink-0 text-sm font-medium transition ${
                item.isActive ? 'text-slate-900' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              {item.label}
              <span
                className={`absolute -bottom-2 left-0 h-px bg-[#2563eb] transition-all duration-300 ${
                  item.isActive ? 'w-full opacity-100' : 'w-0 opacity-0'
                }`}
              />
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-2.5">
          <PortalNavLink onClick={scrollToTop} isActive={isPortal} />
          <button
            type="button"
            onClick={() => setMobileOpen((o) => !o)}
            aria-label="Toggle navigation menu"
            aria-expanded={mobileOpen}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white/70 text-slate-600 transition hover:border-[#2563eb] hover:text-[#2563eb] md:hidden"
          >
            {mobileOpen ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M4 7h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M4 12h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            )}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            key="mobile-menu"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0.9, 0.2, 1] }}
            className="overflow-hidden border-t border-slate-200 bg-white/92 backdrop-blur-xl md:hidden"
          >
            <nav className="container mx-auto flex flex-col gap-1 px-4 py-3 sm:px-6">
              <Link
                to="/"
                onClick={() => {
                  closeMobileMenu()
                  scrollToTop()
                }}
                className="rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
              >
                Houses
              </Link>
              <Link
                to="/apply"
                onClick={() => {
                  closeMobileMenu()
                  scrollToTop()
                }}
                className="rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
              >
                Apply Housing
              </Link>
              <Link
                to={HOUSING_CONTACT_SCHEDULE}
                onClick={() => {
                  closeMobileMenu()
                  scrollToTop()
                }}
                className="rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
              >
                Schedule Tour
              </Link>
              <Link
                to="/owners/about"
                onClick={() => {
                  closeMobileMenu()
                  scrollToTop()
                }}
                className="rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
              >
                Join Axis
              </Link>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>

      {showMobileDock && !mobileOpen ? (
        <div className="pointer-events-none fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-40 md:hidden">
          <nav
            aria-label="Mobile primary navigation"
            className="pointer-events-auto grid grid-cols-4 gap-0.5 rounded-[22px] border border-white/90 bg-white/86 p-1.5 shadow-[0_20px_50px_rgba(37,99,235,0.12),0_0_0_1px_rgba(255,255,255,0.6)] backdrop-blur-2xl backdrop-saturate-150 sm:gap-1 sm:p-2"
          >
            {mobileDockLinks.map((item) => (
              <Link
                key={item.label}
                to={item.to}
                onClick={() => {
                  closeMobileMenu()
                  scrollToTop()
                }}
                className={`flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-[14px] px-1 py-1.5 text-[10px] font-semibold leading-tight transition sm:min-h-[56px] sm:gap-1 sm:rounded-[16px] sm:px-2 sm:py-2 sm:text-[11px] ${
                  item.isActive
                    ? 'bg-axis-portal !text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.16)]'
                    : 'text-slate-500 active:scale-[0.98] hover:bg-slate-50'
                }`}
              >
                <span>{item.icon}</span>
                <span className="text-center">{item.label}</span>
              </Link>
            ))}
          </nav>
        </div>
      ) : null}
    </header>
  )
}

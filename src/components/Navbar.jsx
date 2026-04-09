import React, { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import scrollToTop from '../utils/scrollToTop'
import { AxisWordmark } from './logos/AxisLogos'

function HomeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1v-9.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ApplyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M8 4h8l4 4v12a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V4Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 4v4h4M10 13h4M10 17h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ContactIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M5 7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-4 3v-3a2 2 0 0 1-2-2V7Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function TourIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 21s7-4.35 7-11a7 7 0 1 0-14 0c0 6.65 7 11 7 11Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}

function ResidentIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M15 11a3 3 0 1 0-6 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M6 11V7a6 6 0 1 1 12 0v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="4" y="11" width="16" height="11" rx="2" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}

export default function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const location = useLocation()
  const isHome = location.pathname === '/'
  const showMobileDock = ['/', '/apply', '/contact', '/resident'].includes(location.pathname)
  const promoText = 'Sign up now. No application fee for a limited time.'
  const navLinks = [
    { label: 'Houses', to: { pathname: '/', hash: '#properties' }, isActive: isHome },
    { label: 'Apply Housing', to: '/apply', isActive: location.pathname === '/apply' },
    { label: 'Schedule Tour', to: '/contact?subject=Schedule%20Tour', isActive: location.pathname === '/contact' && new URLSearchParams(location.search).get('subject') !== 'Contact Axis' },
    { label: 'Join Axis', to: '/join-us', isActive: location.pathname === '/join-us' },
    { label: 'Contact', to: '/contact?subject=Contact%20Axis', isActive: location.pathname === '/contact' && new URLSearchParams(location.search).get('subject') === 'Contact Axis' },
  ]
  const mobileDockLinks = [
    { label: 'Houses', to: { pathname: '/', hash: '#properties' }, icon: <HomeIcon />, isActive: isHome },
    { label: 'Apply', to: '/apply', icon: <ApplyIcon />, isActive: location.pathname === '/apply' },
    { label: 'Tour', to: '/contact?subject=Schedule%20Tour', icon: <TourIcon />, isActive: location.pathname === '/contact' && new URLSearchParams(location.search).get('subject') !== 'Contact Axis' },
    { label: 'Join', to: '/join-us', icon: <ResidentIcon />, isActive: location.pathname === '/join-us' },
    { label: 'Contact', to: '/contact?subject=Contact%20Axis', icon: <ContactIcon />, isActive: location.pathname === '/contact' && new URLSearchParams(location.search).get('subject') === 'Contact Axis' },
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
      scrolled
        ? 'border-slate-200/80 bg-white/82 shadow-[0_10px_36px_rgba(37,99,235,0.08)] md:backdrop-blur-xl'
        : 'border-transparent bg-transparent md:bg-white/42 md:backdrop-blur-xl'
    }`}>
      <div className="border-b border-slate-200/70 bg-white/70 text-slate-700 backdrop-blur-xl" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="container mx-auto flex items-center justify-center gap-3 px-4 py-2 text-center sm:px-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-600 sm:text-xs">
            {promoText}
          </p>
          <Link
            to="/apply"
            onClick={scrollToTop}
            className="hidden rounded-full bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white shadow-[0_10px_24px_rgba(37,99,235,0.24)] transition hover:brightness-105 sm:inline-flex"
          >
            Apply today
          </Link>
        </div>
      </div>

      <div className="container mx-auto flex items-center justify-between px-4 py-2.5 sm:px-6 sm:py-3.5">
        <Link to="/" className="group flex items-center" onClick={scrollToTop} aria-label="Axis home">
          <AxisWordmark
            tone="dark"
            className="h-8 w-auto transition-transform duration-300 group-hover:scale-[1.02] sm:h-9"
          />
        </Link>

        <nav className="hidden items-center gap-7 md:flex">
          {navLinks.map((item) => (
            <Link
              key={item.label}
              to={item.to}
              onClick={typeof item.to === 'string' ? scrollToTop : undefined}
              className={`relative text-sm font-medium transition ${
                item.isActive ? 'text-slate-900' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              {item.label}
              <span className={`absolute -bottom-2 left-0 h-px bg-[#2563eb] transition-all duration-300 ${item.isActive ? 'w-full opacity-100' : 'w-0 opacity-0'}`} />
            </Link>
          ))}
        </nav>

        <div className="flex min-w-0 items-center gap-1.5 sm:gap-3">
          <Link
            to="/resident"
            onClick={scrollToTop}
            className="inline-flex shrink-0 items-center rounded-full border border-slate-200 bg-white/70 px-2.5 py-1.5 text-[11px] font-semibold leading-tight text-slate-700 transition hover:border-[#2563eb] hover:text-[#2563eb] sm:px-4 sm:py-2 sm:text-sm"
          >
            <span>Login</span>
          </Link>
          <Link
            to="/apply"
            onClick={() => { closeMobileMenu(); scrollToTop() }}
            className="inline-flex items-center gap-1.5 rounded-full bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] px-3 py-2 text-xs font-semibold text-white shadow-[0_14px_32px_rgba(37,99,235,0.24)] transition hover:brightness-105 sm:px-4 sm:text-sm"
          >
            Apply now
            <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen((o) => !o)}
            aria-label="Toggle navigation menu"
            aria-expanded={mobileOpen}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white/70 text-slate-600 transition hover:border-[#2563eb] hover:text-[#2563eb] md:hidden"
          >
            {mobileOpen ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <path d="M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M4 7h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <path d="M4 12h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <path d="M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
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
              <Link to={{ pathname: '/', hash: '#properties' }} onClick={closeMobileMenu} className="rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900">Houses</Link>
              <Link to="/apply" onClick={() => { closeMobileMenu(); scrollToTop() }} className="rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900">Apply Housing</Link>
              <Link to="/contact?subject=Schedule%20Tour" onClick={() => { closeMobileMenu(); scrollToTop() }} className="rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900">Schedule Tour</Link>
              <Link to="/join-us" onClick={() => { closeMobileMenu(); scrollToTop() }} className="rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900">Join Axis</Link>
              <Link to="/contact?subject=Contact%20Axis" onClick={() => { closeMobileMenu(); scrollToTop() }} className="rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900">Contact</Link>
              <div className="mt-2 border-t border-slate-200 pt-3 pb-1">
                <Link
                  to={`/contact?subject=${encodeURIComponent('Schedule Tour')}`}
                  onClick={() => { closeMobileMenu(); scrollToTop() }}
                  className="block rounded-full bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] px-4 py-2.5 text-center text-sm font-semibold text-white shadow-[0_14px_32px_rgba(37,99,235,0.18)] transition hover:brightness-105"
                >
                  Schedule Tour
                </Link>
              </div>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>

      {showMobileDock && !mobileOpen ? (
      <div className="pointer-events-none fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-40 md:hidden">
        <nav
          aria-label="Mobile primary navigation"
          className="pointer-events-auto grid grid-cols-5 gap-0.5 rounded-[22px] border border-white/90 bg-white/86 p-1.5 sm:gap-1 sm:p-2 shadow-[0_20px_50px_rgba(37,99,235,0.12),0_0_0_1px_rgba(255,255,255,0.6)] backdrop-blur-2xl backdrop-saturate-150"
        >
          {mobileDockLinks.map((item) => (
            <Link
              key={item.label}
              to={item.to}
              onClick={() => { closeMobileMenu(); scrollToTop() }}
              className={`flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-[14px] px-1 py-1.5 text-[10px] font-semibold leading-tight transition sm:min-h-[56px] sm:gap-1 sm:rounded-[16px] sm:px-2 sm:py-2 sm:text-[11px] ${
                item.isActive
                  ? 'bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.16)]'
                  : 'text-slate-500 active:scale-[0.98] hover:bg-slate-50'
              }`}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
      </div>
      ) : null}
    </header>
  )
}

import React, { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import scrollToTop from '../utils/scrollToTop'
import { AxisWordmark } from './logos/AxisLogos'
import { HOUSING_EXPLORE_PATH } from '../lib/housingSite'
import PortalNavLink from './PortalNavLink'
import PortalBubble from './PortalBubble'

const hubNavLink =
  'text-sm font-medium text-slate-500 transition hover:text-slate-900'

function HomeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1v-9.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ApplyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v0Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M9 12h6M9 16h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function AxisIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M4 9h16v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}


/**
 * Single site header: marketing (renter), owners funnel, and portal hub layouts.
 */
export default function SiteHeader() {
  const location = useLocation()
  const { pathname } = location

  const isPortalHub = pathname === '/portal'
  const isOwners = pathname.startsWith('/owners')
  const variant = isPortalHub ? 'portal' : isOwners ? 'owners' : 'marketing'

  const [mobileOpen, setMobileOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  const isHome = pathname === '/' || pathname.startsWith('/properties/')
  const isApply = pathname === '/apply'
  const contactParams = new URLSearchParams(location.search)
  const isScheduleTour =
    pathname === '/contact' &&
    contactParams.get('section') === 'housing' &&
    contactParams.get('tab') === 'schedule'
  const isPortal = pathname === '/portal'

  const showMobileDock = variant === 'marketing' && ['/', '/apply', '/contact'].includes(pathname)

  const marketingCenterNav = [
    { label: 'Explore Houses', to: '/', isActive: isHome },
    { label: 'Schedule tour', to: '/contact?section=housing&tab=schedule', isActive: isScheduleTour },
    { label: 'Apply', to: '/apply', isActive: isApply },
    { label: 'Partner with Axis', to: '/owners/about', isActive: false },
  ]

  const mobileDockLinks = [
    { label: 'Houses', to: '/', icon: <HomeIcon />, isActive: isHome },
    { label: 'Apply', to: '/apply', icon: <ApplyIcon />, isActive: isApply },
    { label: 'Partner', to: '/owners/about', icon: <AxisIcon />, isActive: false },
  ]

  const ownersCenterNav = [
    { label: 'About us', to: '/owners/about', isActive: pathname === '/owners/about' },
    { label: 'Pricing', to: '/owners/pricing', isActive: pathname === '/owners/pricing' },
    { label: 'Contact', to: '/owners/contact', isActive: pathname === '/owners/contact' },
    { label: 'Explore properties', to: HOUSING_EXPLORE_PATH, isActive: false },
  ]

  useEffect(() => {
    setMobileOpen(false)
  }, [pathname, location.search])

  useEffect(() => {
    if (variant !== 'owners') return undefined
    function onScroll() {
      setScrolled(window.scrollY > 12)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [variant])

  function closeMobileMenu() {
    setMobileOpen(false)
  }

  if (variant === 'portal') {
    return (
      <header
        className="relative z-30 w-full shrink-0 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="container mx-auto px-4 py-3.5 sm:px-6 sm:py-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center sm:gap-6">
            <div className="flex items-center justify-between gap-4 sm:contents">
              <Link
                to="/"
                onClick={scrollToTop}
                className="shrink-0 sm:col-start-1 sm:row-start-1 sm:justify-self-start"
                aria-label="Axis home"
              >
                <AxisWordmark tone="dark" className="h-10 w-auto sm:h-11" />
              </Link>
              <div className="sm:hidden">
                <PortalBubble aria-current="page">Portal</PortalBubble>
              </div>
            </div>
            <nav
              className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 sm:col-start-2 sm:row-start-1 sm:justify-center sm:gap-8"
              aria-label="Browse housing and partners"
            >
              <Link to={HOUSING_EXPLORE_PATH} onClick={scrollToTop} className={hubNavLink}>
                Explore Houses
              </Link>
              <Link to="/owners/about" onClick={scrollToTop} className={hubNavLink}>
                Partner with Axis
              </Link>
            </nav>
            <div className="hidden sm:col-start-3 sm:row-start-1 sm:block sm:justify-self-end">
              <PortalBubble aria-current="page">Portal</PortalBubble>
            </div>
          </div>
        </div>
      </header>
    )
  }

  const headerShell =
    variant === 'owners'
      ? `relative z-30 w-full shrink-0 border-b transition-all duration-300 ${
          scrolled
            ? 'border-slate-200/80 bg-white/82 shadow-[0_10px_36px_rgba(37,99,235,0.08)] md:backdrop-blur-xl'
            : 'border-transparent bg-transparent md:bg-white/42 md:backdrop-blur-xl'
        }`
      : 'relative z-30 w-full shrink-0 border-b border-slate-200/30 bg-[#edf2fb]/88 backdrop-blur-xl'

  const centerNav = variant === 'owners' ? ownersCenterNav : marketingCenterNav
  const wordmarkTo = variant === 'owners' ? '/owners/about' : '/'
  const wordmarkLabel = variant === 'owners' ? 'Axis for property owners' : 'Axis home'
  const centerGap = variant === 'owners' ? 'gap-6 lg:gap-8' : 'gap-4 lg:gap-8'
  const underlineClass =
    variant === 'owners' ? 'h-0.5 rounded-full bg-[#2563eb]' : 'h-px bg-[#2563eb]'

  return (
    <header className={headerShell} style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="container mx-auto flex items-center justify-between gap-3 px-4 py-2.5 sm:px-6 sm:py-3.5 md:grid md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-center md:gap-4">
        <Link
          to={wordmarkTo}
          className="group flex shrink-0 items-center md:justify-self-start"
          onClick={scrollToTop}
          aria-label={wordmarkLabel}
        >
          <AxisWordmark tone="dark" className="h-10 w-auto transition-transform duration-300 group-hover:scale-[1.02] sm:h-11" />
        </Link>

        <nav className={`hidden items-center justify-center md:col-start-2 md:flex ${centerGap}`}>
          {centerNav.map((item) => (
            <Link
              key={item.label}
              to={item.to}
              onClick={scrollToTop}
              className={`relative shrink-0 text-[15px] font-semibold tracking-[-0.01em] transition ${
                variant === 'owners'
                  ? item.isActive
                    ? 'text-slate-900'
                    : 'text-slate-600 hover:text-slate-900'
                  : item.isActive
                    ? 'text-slate-900'
                    : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {item.label}
              <span
                className={`absolute -bottom-2 left-0 ${underlineClass} transition-all duration-300 ${
                  item.isActive ? 'w-full opacity-100' : 'w-0 opacity-0'
                }`}
              />
            </Link>
          ))}
        </nav>

        <div className="flex shrink-0 items-center justify-end gap-2 sm:gap-2.5 md:col-start-3 md:justify-self-end">
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
          <PortalNavLink onClick={scrollToTop} isActive={isPortal} />
        </div>
      </div>

      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            key={`mobile-${variant}`}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0.9, 0.2, 1] }}
            className="overflow-hidden border-t border-slate-200 bg-white/92 backdrop-blur-xl md:hidden"
          >
            <nav className={`container mx-auto flex flex-col gap-1 px-4 py-3 ${variant === 'marketing' ? 'sm:px-6' : ''}`}>
              {variant === 'marketing' ? (
                <>
                  <Link
                    to="/"
                    onClick={() => { closeMobileMenu(); scrollToTop() }}
                    className="rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
                  >
                    Explore Houses
                  </Link>
                  <Link
                    to="/apply"
                    onClick={() => { closeMobileMenu(); scrollToTop() }}
                    className="rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
                  >
                    Apply
                  </Link>
                  <Link
                    to="/owners/about"
                    onClick={() => { closeMobileMenu(); scrollToTop() }}
                    className="rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
                  >
                    Partner with Axis
                  </Link>
                </>
              ) : (
                <>
                  <Link
                    to="/owners/about"
                    onClick={() => {
                      closeMobileMenu()
                      scrollToTop()
                    }}
                    className="rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  >
                    About us
                  </Link>
                  <Link
                    to="/owners/pricing"
                    onClick={() => {
                      closeMobileMenu()
                      scrollToTop()
                    }}
                    className="rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  >
                    Pricing
                  </Link>
                  <Link
                    to="/owners/contact"
                    onClick={() => {
                      closeMobileMenu()
                      scrollToTop()
                    }}
                    className="rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  >
                    Contact
                  </Link>
                  <Link
                    to={HOUSING_EXPLORE_PATH}
                    onClick={() => {
                      closeMobileMenu()
                      scrollToTop()
                    }}
                    className="rounded-xl px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  >
                    Explore properties
                  </Link>
                </>
              )}
            </nav>
          </motion.div>
        )}
      </AnimatePresence>

      {showMobileDock && !mobileOpen ? (
        <div className="pointer-events-none fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-40 md:hidden">
          <nav
            aria-label="Mobile primary navigation"
            className="pointer-events-auto grid grid-cols-3 gap-0.5 rounded-[22px] border border-white/90 bg-white/86 p-1.5 shadow-[0_20px_50px_rgba(37,99,235,0.12),0_0_0_1px_rgba(255,255,255,0.6)] backdrop-blur-2xl backdrop-saturate-150 sm:gap-1 sm:p-2"
          >
            {mobileDockLinks.map((item) => (
              <Link
                key={item.label}
                to={item.to}
                aria-label={item.ariaLabel}
                onClick={() => {
                  closeMobileMenu()
                  scrollToTop()
                }}
                className={`flex min-h-[52px] flex-col items-center justify-center gap-0.5 rounded-[14px] px-0.5 py-1.5 text-[9px] font-semibold leading-tight transition sm:min-h-[56px] sm:gap-1 sm:rounded-[16px] sm:px-1 sm:py-2 sm:text-[10px] ${
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

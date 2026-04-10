import React, { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import scrollToTop from '../utils/scrollToTop'
import { AxisWordmark } from './logos/AxisLogos'
import PortalNavLink from './PortalNavLink'

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

function ChevronDown({ className }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const underlineClass = 'h-0.5 rounded-full bg-[#2563eb]'

/**
 * Desktop nav item with hover / focus-within dropdown.
 */
function NavMenuDropdown({ label, to, parentActive, children }) {
  const hasChildren = React.Children.toArray(children).filter(Boolean).length > 0
  return (
    <div className="group relative flex flex-col items-center pb-2.5">
      <Link
        to={to}
        onClick={scrollToTop}
        aria-haspopup={hasChildren ? 'menu' : undefined}
        className={`inline-flex items-center gap-1 text-[15px] font-semibold tracking-[-0.01em] transition ${
          parentActive ? 'text-slate-900' : 'text-slate-600 hover:text-slate-900'
        }`}
      >
        {label}
        {hasChildren ? (
          <ChevronDown className="shrink-0 opacity-55 transition-opacity duration-75 group-hover:opacity-80" aria-hidden />
        ) : null}
      </Link>
      <span
        aria-hidden
        className={`pointer-events-none absolute bottom-0 left-0 right-0 mx-auto max-w-full ${underlineClass} origin-center transition-[transform,opacity] duration-200 ease-out ${
          parentActive
            ? 'scale-x-100 opacity-100'
            : 'scale-x-0 opacity-0 group-hover:scale-x-100 group-hover:opacity-100 group-focus-within:scale-x-100 group-focus-within:opacity-100'
        }`}
      />
      {hasChildren ? (
        <div className="pointer-events-none invisible absolute left-1/2 top-full z-50 w-max min-w-[220px] -translate-x-1/2 pt-1.5 opacity-0 transition-[opacity,visibility] duration-75 ease-out group-hover:pointer-events-auto group-hover:visible group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:visible group-focus-within:opacity-100">
          <div
            className="rounded-xl border border-slate-200/90 bg-white py-1.5 shadow-[0_16px_40px_rgba(15,23,42,0.12)]"
            role="menu"
            aria-label={`${label} links`}
          >
            {children}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function DropdownLink({ to, isActive, onNavigate, children }) {
  return (
    <Link
      to={to}
      role="menuitem"
      onClick={() => {
        scrollToTop()
        onNavigate?.()
      }}
      className={`block px-4 py-2.5 text-sm font-medium transition hover:bg-slate-50 ${
        isActive ? 'text-[#2563eb]' : 'text-slate-700'
      }`}
    >
      {children}
    </Link>
  )
}

/**
 * Site header: same primary nav on every page — Rent with Axis & Partner with Axis (dropdowns) + Portal.
 */
export default function SiteHeader() {
  const location = useLocation()
  const { pathname } = location

  const [mobileOpen, setMobileOpen] = useState(false)

  const isHome = pathname === '/' || pathname.startsWith('/properties/')
  const isApply = pathname === '/apply'
  const contactParams = new URLSearchParams(location.search)
  const isScheduleTour =
    pathname === '/contact' &&
    contactParams.get('section') === 'housing' &&
    contactParams.get('tab') === 'schedule'
  const isPortal = pathname === '/portal'

  const isPricing = pathname === '/owners/pricing'
  const isOwnersContact = pathname === '/owners/contact'
  const isOwnersAbout = pathname === '/owners/about'

  const exploreParentActive = isHome || isScheduleTour || isApply
  const partnerParentActive = isOwnersAbout || isPricing || isOwnersContact

  const showMobileDock =
    !isPortal &&
    (pathname === '/' ||
      pathname === '/apply' ||
      pathname === '/contact' ||
      pathname.startsWith('/owners'))

  const mobileDockLinks = [
    { label: 'Rent', to: '/', icon: <HomeIcon />, isActive: isHome, ariaLabel: 'Rent with Axis' },
    { label: 'Apply', to: '/apply', icon: <ApplyIcon />, isActive: isApply },
    { label: 'Partner', to: '/owners/about', icon: <AxisIcon />, isActive: partnerParentActive, ariaLabel: 'Partner with Axis' },
  ]

  useEffect(() => {
    setMobileOpen(false)
  }, [pathname, location.search])

  function closeMobileMenu() {
    setMobileOpen(false)
  }

  const headerShell =
    'relative z-30 w-full shrink-0 border-b border-slate-200/30 bg-[#edf2fb]/88 backdrop-blur-xl'

  return (
    <header className={headerShell} style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="container mx-auto flex items-center justify-between gap-3 px-4 py-2.5 sm:px-6 sm:py-3.5 md:grid md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-center md:gap-4">
        <Link
          to="/"
          className="group flex shrink-0 items-center md:justify-self-start"
          onClick={scrollToTop}
          aria-label="Axis home"
        >
          <AxisWordmark tone="dark" className="h-10 w-auto transition-transform duration-300 group-hover:scale-[1.02] sm:h-11" />
        </Link>

        <nav className="hidden items-center justify-center gap-4 md:col-start-2 md:flex lg:gap-8" aria-label="Primary">
          <NavMenuDropdown label="Rent with Axis" to="/" parentActive={exploreParentActive}>
            <DropdownLink
              to="/contact?section=housing&tab=schedule"
              isActive={isScheduleTour}
              onNavigate={closeMobileMenu}
            >
              Schedule tour
            </DropdownLink>
            <DropdownLink to="/apply" isActive={isApply} onNavigate={closeMobileMenu}>
              Apply
            </DropdownLink>
          </NavMenuDropdown>
          <NavMenuDropdown label="Partner with Axis" to="/owners/about" parentActive={partnerParentActive}>
            <DropdownLink to="/owners/pricing" isActive={isPricing} onNavigate={closeMobileMenu}>
              Pricing
            </DropdownLink>
            <DropdownLink to="/owners/contact" isActive={isOwnersContact} onNavigate={closeMobileMenu}>
              Contact
            </DropdownLink>
          </NavMenuDropdown>
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
            key="mobile-nav"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0.9, 0.2, 1] }}
            className="overflow-hidden border-t border-slate-200 bg-white/92 backdrop-blur-xl md:hidden"
          >
            <nav className="container mx-auto flex flex-col gap-1 px-4 py-3 sm:px-6" aria-label="Mobile primary">
              <Link
                to="/"
                onClick={() => {
                  closeMobileMenu()
                  scrollToTop()
                }}
                className={`rounded-xl px-3 py-2.5 text-sm font-semibold transition hover:bg-slate-50 ${
                  isHome ? 'text-slate-900' : 'text-slate-600'
                }`}
              >
                Rent with Axis
              </Link>
              <Link
                to="/contact?section=housing&tab=schedule"
                onClick={() => {
                  closeMobileMenu()
                  scrollToTop()
                }}
                className={`rounded-xl py-2.5 pl-6 pr-3 text-sm font-medium transition hover:bg-slate-50 ${
                  isScheduleTour ? 'text-[#2563eb]' : 'text-slate-600'
                }`}
              >
                Schedule tour
              </Link>
              <Link
                to="/apply"
                onClick={() => {
                  closeMobileMenu()
                  scrollToTop()
                }}
                className={`rounded-xl py-2.5 pl-6 pr-3 text-sm font-medium transition hover:bg-slate-50 ${
                  isApply ? 'text-[#2563eb]' : 'text-slate-600'
                }`}
              >
                Apply
              </Link>
              <Link
                to="/owners/about"
                onClick={() => {
                  closeMobileMenu()
                  scrollToTop()
                }}
                className={`mt-1 rounded-xl px-3 py-2.5 text-sm font-semibold transition hover:bg-slate-50 ${
                  isOwnersAbout ? 'text-slate-900' : 'text-slate-600'
                }`}
              >
                Partner with Axis
              </Link>
              <Link
                to="/owners/pricing"
                onClick={() => {
                  closeMobileMenu()
                  scrollToTop()
                }}
                className={`rounded-xl py-2.5 pl-6 pr-3 text-sm font-medium transition hover:bg-slate-50 ${
                  isPricing ? 'text-[#2563eb]' : 'text-slate-600'
                }`}
              >
                Pricing
              </Link>
              <Link
                to="/owners/contact"
                onClick={() => {
                  closeMobileMenu()
                  scrollToTop()
                }}
                className={`rounded-xl py-2.5 pl-6 pr-3 text-sm font-medium transition hover:bg-slate-50 ${
                  isOwnersContact ? 'text-[#2563eb]' : 'text-slate-600'
                }`}
              >
                Contact
              </Link>
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

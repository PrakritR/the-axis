import React, { Suspense, lazy, useEffect, useLayoutEffect, useMemo, Component } from 'react'
import { Routes, Route, useLocation, Navigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Toaster } from 'react-hot-toast'
import { MAINTENANCE_MODE } from './lib/maintenance'
import MaintenancePage from './pages/MaintenancePage'
import PromoBanner from './components/PromoBanner'
import SiteHeader from './components/SiteHeader'
import Footer from './components/Footer'
import Home from './pages/Home'
import PortalSelect from './pages/PortalSelect'
import scrollToTop from './utils/scrollToTop'
import Chatbot from './components/Chatbot'
import { PropertyListingChromeContext } from './contexts/PropertyListingChromeContext'
import { usePropertyListingAutoChrome } from './hooks/usePropertyListingAutoChrome'

const PropertyPage = lazy(() => import('./pages/PropertyPage'))
const Contact = lazy(() => import('./pages/Contact'))
const Apply = lazy(() => import('./pages/Apply'))
const Resident = lazy(() => import('./pages/Resident'))
const JoinUs = lazy(() => import('./pages/JoinUs'))
const Manager = lazy(() => import('./pages/Manager'))
const AxisAdminPortal = lazy(() => import('./axis-internal/AdminPortal'))
const SignLease = lazy(() => import('./pages/SignLease'))
const AxisTeam = lazy(() => import('./pages/AxisTeam'))
const OwnersAbout = lazy(() => import('./pages/OwnersAbout'))

function ScrollToTop() {
  const { pathname, hash, search } = useLocation()

  useEffect(() => {
    if ('scrollRestoration' in window.history) {
      const previous = window.history.scrollRestoration
      window.history.scrollRestoration = 'manual'

      return () => {
        window.history.scrollRestoration = previous
      }
    }

    return undefined
  }, [])

  useLayoutEffect(() => {
    if (hash) return
    scrollToTop()
  }, [pathname, search, hash])

  useEffect(() => {
    if (!hash) return undefined
    // Property listing pages measure sticky promo + header + in-page nav; PropertyPage scrolls with offset.
    if (pathname.startsWith('/properties/')) return undefined

    const target = document.getElementById(decodeURIComponent(hash.slice(1)))
    if (!target) return undefined

    requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })

    return undefined
  }, [pathname, hash])

  return null
}

const pageVariants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.2, 0.9, 0.2, 1] } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.2, ease: 'easeIn' } },
}

function AnimatedPage({ children }) {
  return (
    <motion.div variants={pageVariants} initial="initial" animate="animate" exit="exit" style={{ width: '100%' }}>
      <Suspense fallback={<PageFallback />}>{children}</Suspense>
    </motion.div>
  )
}

function PageFallback() {
  return <div className="container mx-auto px-6 py-12 text-sm text-slate-500">Loading...</div>
}

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }
  componentDidCatch(error, info) {
    console.error('App error:', error, info)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
          <h1 className="text-xl font-bold text-slate-900">Something went wrong</h1>
          <p className="mt-2 text-sm text-slate-500">Please refresh the page. If the issue persists, contact us.</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-6 rounded-full bg-[#2563eb] px-6 py-2.5 text-sm font-semibold text-white hover:brightness-105"
          >
            Refresh
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function AppInner() {
  const location = useLocation()

  // Manager/admin use the same sticky site chrome as marketing pages so users can return to the site.
  // Signing and axis-team stay minimal (no header). Paths: /manager/*, /admin/*, /sign/*, /axis-team.
  const isManagerRoute = location.pathname === '/manager' || location.pathname.startsWith('/manager/')
  const isAdminPortalRoute = location.pathname === '/admin' || location.pathname.startsWith('/admin/')
  const isSignLeaseRoute = location.pathname.startsWith('/sign/')
  const isAxisTeamRoute = location.pathname === '/axis-team'
  const isStandaloneRoute =
    isManagerRoute ||
    isAdminPortalRoute ||
    isSignLeaseRoute ||
    isAxisTeamRoute

  const isPortalWithSiteChrome = isManagerRoute || isAdminPortalRoute

  const isOwnersRoute = location.pathname.startsWith('/owners')
  const isPortalHub = location.pathname === '/portal'
  /** Promo + header: main site, plus manager/admin portals (not sign lease, axis-team, or /portal hub). */
  const showPromoBanner = !isPortalHub && (!isStandaloneRoute || isPortalWithSiteChrome)
  const showMainMobileDock =
    !isOwnersRoute && ['/', '/apply', '/contact'].includes(location.pathname)

  const isPropertyDetail = /^\/properties\/[^/]+/.test(location.pathname)
  const propertyAutoChrome = usePropertyListingAutoChrome(isPropertyDetail, showPromoBanner)
  const propertyChromeContextValue = useMemo(
    () => (isPropertyDetail ? { siteChromeInsetPx: propertyAutoChrome.insetPx ?? 0 } : null),
    [isPropertyDetail, propertyAutoChrome.insetPx],
  )

  if (MAINTENANCE_MODE) {
    return <MaintenancePage />
  }

  const standaloneToaster = (
    <Toaster
      position="top-center"
      toastOptions={{
        duration: 4500,
        style: { borderRadius: '14px', fontFamily: 'Inter, sans-serif', fontSize: '14px', fontWeight: 500 },
        success: { style: { background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0' } },
        error: { style: { background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' } },
      }}
    />
  )

  const standaloneRoutes = (
    <Suspense fallback={<PageFallback />}>
      <Routes location={location} key={location.pathname}>
        <Route path="/manager" element={<Manager />} />
        <Route path="/manager/*" element={<Manager />} />
        <Route path="/admin" element={<AxisAdminPortal />} />
        <Route path="/admin/*" element={<AxisAdminPortal />} />
        <Route path="/sign/:token" element={<SignLease />} />
        <Route path="/axis-team" element={<AxisTeam />} />
      </Routes>
    </Suspense>
  )

  if (isStandaloneRoute) {
    if (isPortalWithSiteChrome) {
      return (
        <div className="app-shell axis-page min-h-screen min-h-svh flex flex-col">
          <ScrollToTop />
          <div id="site-sticky-chrome" className="sticky top-0 z-50 w-full">
            {showPromoBanner ? <PromoBanner /> : null}
            <SiteHeader />
          </div>
          {standaloneToaster}
          <main className="min-h-0 w-full flex-1">{standaloneRoutes}</main>
        </div>
      )
    }

    return (
      <>
        <ScrollToTop />
        {standaloneToaster}
        {standaloneRoutes}
      </>
    )
  }

  const marketingSiteChrome = (
    <>
      {showPromoBanner ? <PromoBanner /> : null}
      <SiteHeader />
    </>
  )

  return (
    <PropertyListingChromeContext.Provider value={propertyChromeContextValue}>
      <div className="app-shell axis-page min-h-screen min-h-svh flex flex-col">
        <ScrollToTop />
        {isPropertyDetail ? (
          <div
            ref={propertyAutoChrome.chromeRef}
            id="site-sticky-chrome"
            className={`fixed left-0 right-0 top-0 z-50 w-full bg-white shadow-[0_1px_0_0_rgba(15,23,42,0.06)] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform ${
              propertyAutoChrome.hidden ? 'pointer-events-none -translate-y-full' : 'translate-y-0'
            }`}
            onMouseEnter={propertyAutoChrome.onChromeEnter}
            onMouseLeave={propertyAutoChrome.onChromeLeave}
          >
            {marketingSiteChrome}
          </div>
        ) : (
          <div id="site-sticky-chrome" className="sticky top-0 z-50 w-full">
            {marketingSiteChrome}
          </div>
        )}
        <Toaster
          position="top-center"
          toastOptions={{
            duration: 4500,
            style: { borderRadius: '14px', fontFamily: 'Inter, sans-serif', fontSize: '14px', fontWeight: 500 },
            success: { style: { background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0' } },
            error: { style: { background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' } },
          }}
        />
        <main
          className={`flex-1 min-h-0 w-full ${showMainMobileDock ? 'pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0' : ''}`}
          style={
            isPropertyDetail
              ? {
                  paddingTop: propertyAutoChrome.insetPx ?? 0,
                  transition: 'padding-top 0.3s cubic-bezier(0.22, 1, 0.36, 1)',
                }
              : undefined
          }
        >
          <Suspense fallback={<PageFallback />}>
            <AnimatePresence mode="wait">
              <Routes location={location} key={location.pathname}>
                <Route path="/" element={<AnimatedPage><Home /></AnimatedPage>} />
                <Route path="/properties/:slug" element={<AnimatedPage><PropertyPage /></AnimatedPage>} />
                <Route path="/contact" element={<AnimatedPage><Contact /></AnimatedPage>} />
                <Route path="/owners/contact" element={<AnimatedPage><Contact /></AnimatedPage>} />
                <Route path="/apply" element={<AnimatedPage><Apply /></AnimatedPage>} />
                <Route path="/resident" element={<AnimatedPage><Resident /></AnimatedPage>} />
                <Route path="/portal" element={<AnimatedPage key="portal-hub"><PortalSelect /></AnimatedPage>} />
                <Route path="/owners" element={<Navigate to="/owners/about" replace />} />
                <Route path="/owners/about" element={<AnimatedPage><OwnersAbout /></AnimatedPage>} />
                <Route path="/owners/pricing" element={<AnimatedPage><JoinUs /></AnimatedPage>} />
                <Route path="/join-us" element={<Navigate to="/owners/pricing" replace />} />
                <Route path="*" element={<AnimatedPage><div className="container mx-auto px-6 py-12">Page not found</div></AnimatedPage>} />
              </Routes>
            </AnimatePresence>
          </Suspense>
        </main>
        {!isPortalHub ? <Footer /> : null}
        {!isPortalHub ? <Chatbot /> : null}
      </div>
    </PropertyListingChromeContext.Provider>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  )
}

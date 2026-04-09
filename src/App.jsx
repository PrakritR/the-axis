import React, { Suspense, lazy, useEffect, useLayoutEffect } from 'react'
import { Routes, Route, useLocation, Navigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Toaster } from 'react-hot-toast'
import { MAINTENANCE_MODE } from './lib/maintenance'
import MaintenancePage from './pages/MaintenancePage'
import Navbar from './components/Navbar'
import OwnersNav from './components/OwnersNav'
import Footer from './components/Footer'
import Home from './pages/Home'
import scrollToTop from './utils/scrollToTop'
import Chatbot from './components/Chatbot'

const PropertyPage = lazy(() => import('./pages/PropertyPage'))
const Contact = lazy(() => import('./pages/Contact'))
const Apply = lazy(() => import('./pages/Apply'))
const Resident = lazy(() => import('./pages/Resident'))
const JoinUs = lazy(() => import('./pages/JoinUs'))
const Manager = lazy(() => import('./pages/Manager'))
const SignLease = lazy(() => import('./pages/SignLease'))
const AxisTeam = lazy(() => import('./pages/AxisTeam'))
const PortalSelect = lazy(() => import('./pages/PortalSelect'))
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

export default function App() {
  const location = useLocation()

  if (MAINTENANCE_MODE) {
    return <MaintenancePage />
  }

  // The manager portal renders its own standalone UI — no public Navbar, Footer,
  // or Chatbot. Check the full pathname so /manager/* and /sign/*
  // paths also match.
  const isManagerRoute = location.pathname === '/manager' || location.pathname.startsWith('/manager/')
  const isSignLeaseRoute = location.pathname.startsWith('/sign/')
  const isAxisTeamRoute = location.pathname === '/axis-team'
  const isStandaloneRoute = isManagerRoute || isSignLeaseRoute || isAxisTeamRoute

  const isOwnersRoute = location.pathname.startsWith('/owners')
  const isPortalHub = location.pathname === '/portal'
  const showMainMobileDock =
    !isOwnersRoute && ['/', '/apply', '/contact'].includes(location.pathname)
  // Manager portal and signing flow render completely standalone — skip the public shell entirely
  if (isStandaloneRoute) {
    return (
      <>
        <ScrollToTop />
        <Toaster
          position="top-center"
          toastOptions={{
            duration: 4500,
            style: { borderRadius: '14px', fontFamily: 'Inter, sans-serif', fontSize: '14px', fontWeight: 500 },
            success: { style: { background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0' } },
            error: { style: { background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' } },
          }}
        />
        <Suspense fallback={<PageFallback />}>
          <Routes location={location} key={location.pathname}>
            <Route path="/manager" element={<Manager />} />
            <Route path="/manager/*" element={<Manager />} />
            <Route path="/sign/:token" element={<SignLease />} />
            <Route path="/axis-team" element={<AxisTeam />} />
          </Routes>
        </Suspense>
      </>
    )
  }

  return (
    <div className="app-shell axis-page min-h-screen min-h-svh flex flex-col">
      <ScrollToTop />
      <Toaster
        position="top-center"
        toastOptions={{
          duration: 4500,
          style: { borderRadius: '14px', fontFamily: 'Inter, sans-serif', fontSize: '14px', fontWeight: 500 },
          success: { style: { background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0' } },
          error: { style: { background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca' } },
        }}
      />
      {!isPortalHub ? (isOwnersRoute ? <OwnersNav /> : <Navbar />) : null}
      <main className={`flex-1 min-h-0 w-full ${showMainMobileDock ? 'pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0' : ''}`}>
        <Suspense fallback={<PageFallback />}>
          <AnimatePresence mode="wait">
            <Routes location={location} key={location.pathname}>
              <Route path="/" element={<AnimatedPage><Home /></AnimatedPage>} />
              <Route path="/properties/:slug" element={<AnimatedPage><PropertyPage /></AnimatedPage>} />
              <Route path="/contact" element={<AnimatedPage><Contact /></AnimatedPage>} />
              <Route path="/owners/contact" element={<AnimatedPage><Contact /></AnimatedPage>} />
              <Route path="/apply" element={<AnimatedPage><Apply /></AnimatedPage>} />
              <Route path="/resident" element={<AnimatedPage><Resident /></AnimatedPage>} />
              <Route path="/portal" element={<AnimatedPage><PortalSelect /></AnimatedPage>} />
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
  )
}

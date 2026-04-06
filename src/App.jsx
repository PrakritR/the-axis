import React, { Suspense, lazy, useEffect, useLayoutEffect } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Toaster } from 'react-hot-toast'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import Home from './pages/Home'
import scrollToTop from './utils/scrollToTop'
import Chatbot from './components/Chatbot'

const PropertyPage = lazy(() => import('./pages/PropertyPage'))
const Contact = lazy(() => import('./pages/Contact'))
const Apply = lazy(() => import('./pages/Apply'))
const Resident = lazy(() => import('./pages/Resident'))
const JoinUs = lazy(() => import('./pages/JoinUs'))

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
    if (hash) {
      return
    }

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
      {children}
    </motion.div>
  )
}

function PageFallback() {
  return <div className="container mx-auto px-6 py-12 text-sm text-slate-500">Loading...</div>
}

export default function App(){
  const location = useLocation()
  const showMobileDock = !location.pathname.startsWith('/properties/')
  return (
    <div className="app-shell min-h-screen min-h-svh flex flex-col">
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
      <Navbar />
      <main className={`flex-1 min-h-0 w-full ${showMobileDock ? 'pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0' : ''}`}>
        <Suspense fallback={<PageFallback />}>
          <AnimatePresence mode="wait">
            <Routes location={location} key={location.pathname}>
              <Route path="/" element={<AnimatedPage><Home /></AnimatedPage>} />
              <Route path="/properties/:slug" element={<AnimatedPage><PropertyPage/></AnimatedPage>} />
              <Route path="*" element={<AnimatedPage><div className="container mx-auto px-6 py-12">Page not found</div></AnimatedPage>} />
              <Route path="/contact" element={<AnimatedPage><Contact/></AnimatedPage>} />
              <Route path="/apply" element={<AnimatedPage><Apply/></AnimatedPage>} />
              <Route path="/resident" element={<AnimatedPage><Resident/></AnimatedPage>} />
              <Route path="/join" element={<AnimatedPage><JoinUs/></AnimatedPage>} />
            </Routes>
          </AnimatePresence>
        </Suspense>
      </main>
      <Footer />
      <Chatbot />
    </div>
  )
}

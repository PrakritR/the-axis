import React from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12, delayChildren: 0.15 } },
}
const item = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.65, ease: [0.22, 1, 0.36, 1] } },
}

export default function Hero({
  heading = 'Affordable Private Rooms Near UW',
  subheading = 'Private furnished rooms near UW. Utilities included. Apply online.',
  browseLabel = 'View Available Rooms',
  tourLabel = 'Schedule a Tour',
  heroImage = new URL('../../Assets/HerobannerImage.svg', import.meta.url).href
}) {
  return (
    <section className="relative w-full overflow-hidden bg-navy-950" style={{ minHeight: 'clamp(460px, 78dvh, 860px)' }}>
      {/* Background image */}
      <div className="absolute inset-0">
        <img src={heroImage} alt="" role="presentation" className="h-full w-full object-cover opacity-45" />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(2,6,23,0.9)_0%,rgba(2,6,23,0.78)_34%,rgba(2,6,23,0.44)_62%,rgba(2,6,23,0.56)_100%)]" />
        <div className="absolute inset-0 bg-gradient-to-b from-navy-950/70 via-transparent to-navy-950/82" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_16%_56%,rgba(14,165,164,0.14),transparent_54%)]" />
      </div>

      {/* Dot grid overlay */}
      <div className="absolute inset-0 bg-dot-grid-dark bg-dot-md opacity-25" />

      {/* Content */}
      <div className="relative z-10 flex h-full flex-col justify-center">
        <div className="container mx-auto px-4 pb-[max(3.5rem,env(safe-area-inset-bottom))] pt-[max(5.5rem,env(safe-area-inset-top))] sm:px-6 sm:pb-20 sm:pt-28 lg:px-8 lg:pb-24 lg:pt-32">
          <motion.div className="max-w-2xl" variants={container} initial="hidden" animate="show">

            <motion.div variants={item} className="inline-flex max-w-full items-center gap-2 overflow-hidden rounded-full border border-axis/30 bg-axis/10 px-3 py-1.5 sm:px-3.5">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-axis" />
              <span className="truncate text-[10px] font-bold uppercase tracking-[0.12em] text-axis sm:text-xs sm:tracking-[0.2em]">University District · Seattle, WA</span>
            </motion.div>

            <motion.h1 variants={item} className="mt-5 max-w-[11ch] font-serif text-[clamp(2.2rem,8vw,5.4rem)] font-black leading-[0.95] text-white [text-shadow:0_10px_28px_rgba(2,6,23,0.42)]">
              {heading}
            </motion.h1>

            <motion.p variants={item} className="mt-5 max-w-xl text-sm leading-7 text-white/80 sm:text-lg sm:leading-8">
              {subheading}
            </motion.p>

            <motion.div variants={item} className="mt-7 flex flex-col gap-3 sm:mt-8 sm:flex-row sm:flex-wrap">
              <button
                type="button"
                onClick={() => document.getElementById('properties')?.scrollIntoView({ behavior: 'smooth' })}
                className="w-full rounded-full bg-axis px-6 py-3.5 text-sm font-semibold text-white shadow-[0_0_24px_rgba(14,165,164,0.5)] transition hover:bg-axis-dark active:scale-[0.97] sm:w-auto sm:px-7"
              >
                {browseLabel}
              </button>
              <Link
                to={`/contact?subject=${encodeURIComponent('Tour request - Seattle')}`}
                className="w-full rounded-full border border-white/20 bg-white/8 px-6 py-3.5 text-center text-sm font-semibold text-white backdrop-blur-sm transition hover:bg-white/15 active:scale-[0.97] sm:w-auto sm:px-7"
              >
                {tourLabel}
              </Link>
            </motion.div>

            {/* Key stats */}
            <motion.div variants={item} className="mt-9 grid grid-cols-2 gap-5 border-t border-white/10 pt-6 sm:mt-12 sm:flex sm:flex-wrap sm:items-center sm:gap-x-10 sm:gap-y-4 sm:pt-8">
              {[
                { label: 'Starting rent', value: '$725 / mo' },
                { label: 'Walk to UW', value: '0.3 miles' },
                { label: 'Utilities', value: 'Included' },
              ].map((s) => (
                <div key={s.label} className={s.label === 'Utilities' ? 'col-span-2 sm:col-span-1' : ''}>
                  <div className="text-lg font-black text-white sm:text-xl">{s.value}</div>
                  <div className="mt-1 text-xs font-medium text-white/55 uppercase tracking-[0.15em]">{s.label}</div>
                </div>
              ))}
            </motion.div>
          </motion.div>
        </div>
      </div>

      {/* Bottom fade into next section */}
      <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-cream-50 to-transparent" />

      <div className="absolute bottom-5 left-1/2 z-10 hidden -translate-x-1/2 flex-col items-center gap-2 text-white/55 sm:flex">
        <span className="text-[10px] font-bold uppercase tracking-[0.24em]">Scroll</span>
        <span className="flex h-10 w-6 justify-center rounded-full border border-white/20">
          <span className="mt-2 h-2.5 w-1.5 rounded-full bg-white/60" />
        </span>
      </div>
    </section>
  )
}

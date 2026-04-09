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
  heading = 'Seattle Housing',
  subheading = 'Browse available houses and rooms. See pricing, availability, and apply online.',
  browseLabel = 'View Available Housing',
  tourLabel = 'Schedule a Tour',
  heroImage = new URL('../../Assets/HerobannerImage.svg', import.meta.url).href
}) {
  return (
    <section className="relative w-full overflow-hidden bg-[linear-gradient(180deg,#edf2fb_0%,#eaf0fb_52%,#f4f7fd_100%)]" style={{ minHeight: 'clamp(460px, 78dvh, 860px)' }}>
      <div className="absolute inset-0">
        <img src={heroImage} alt="" role="presentation" className="h-full w-full object-cover opacity-[0.16]" />
        <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(237,242,251,0.96)_0%,rgba(237,242,251,0.88)_34%,rgba(237,242,251,0.55)_62%,rgba(237,242,251,0.78)_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_18%_40%,rgba(37,99,235,0.14),transparent_48%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.95),transparent_34%)]" />
      </div>

      <div className="absolute inset-0 bg-dot-grid bg-dot-md opacity-20" />

      <div className="relative z-10 flex h-full flex-col justify-center">
        <div className="container mx-auto px-4 pb-[max(3.5rem,env(safe-area-inset-bottom))] pt-[max(5.5rem,env(safe-area-inset-top))] sm:px-6 sm:pb-20 sm:pt-28 lg:px-8 lg:pb-24 lg:pt-32">
          <motion.div className="max-w-2xl" variants={container} initial="hidden" animate="show">
            <motion.h1 variants={item} className="mt-5 max-w-[11ch] text-[clamp(2.2rem,8vw,5.4rem)] font-black leading-[0.92] tracking-[-0.065em] text-slate-900">
              {heading}
            </motion.h1>

            <motion.p variants={item} className="mt-5 max-w-xl text-sm leading-7 text-slate-500 sm:text-lg sm:leading-8">
              {subheading}
            </motion.p>

            <motion.div variants={item} className="mt-7 flex flex-col gap-3 sm:mt-8 sm:flex-row sm:flex-wrap">
              <button
                type="button"
                onClick={() => document.getElementById('properties')?.scrollIntoView({ behavior: 'smooth' })}
                className="w-full rounded-full bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] px-6 py-3.5 text-sm font-semibold text-white shadow-[0_18px_40px_rgba(37,99,235,0.22)] transition hover:brightness-105 active:scale-[0.97] sm:w-auto sm:px-7"
              >
                {browseLabel}
              </button>
              <Link
                to={`/contact?subject=${encodeURIComponent('Tour request - Seattle')}`}
                className="w-full rounded-full border border-white/90 bg-white/76 px-6 py-3.5 text-center text-sm font-semibold text-slate-700 backdrop-blur-sm transition hover:border-slate-200 hover:bg-white active:scale-[0.97] sm:w-auto sm:px-7"
              >
                {tourLabel}
              </Link>
            </motion.div>

            <motion.div variants={item} className="mt-9 grid grid-cols-2 gap-4 border-t border-slate-200/70 pt-6 sm:mt-12 sm:flex sm:flex-wrap sm:items-center sm:gap-x-6 sm:gap-y-4 sm:pt-8">
              {[
                { label: 'Starting price', value: '$750 / mo' },
                { label: 'Listed homes', value: '3' },
              ].map((s) => (
                <div key={s.label} className={`rounded-[24px] border border-white/80 bg-white/76 px-4 py-4 shadow-[0_12px_32px_rgba(37,99,235,0.08)] ${s.label === 'Utilities' ? 'col-span-2 sm:col-span-1' : ''}`}>
                  <div className="text-lg font-black text-slate-900 sm:text-xl">{s.value}</div>
                  <div className="mt-1 text-xs font-medium uppercase tracking-[0.15em] text-slate-400">{s.label}</div>
                </div>
              ))}
            </motion.div>
          </motion.div>
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-[#edf2fb] to-transparent" />
    </section>
  )
}

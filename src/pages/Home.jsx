import React, { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import Hero from '../components/Hero'
import PropertyCard from '../components/PropertyCard'
import { properties } from '../data/properties'
import { Seo, buildWebsiteSchema } from '../lib/seo'
import scrollToTop from '../utils/scrollToTop'

// ── Animations ───────────────────────────────────────────────────────────────

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.1 } } }
const up = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] } },
}

function Reveal({ children, className = '', delay = 0 }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-64px' }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  )
}

function Arrow() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CheckCircle() {
  return (
    <svg className="mt-0.5 h-5 w-5 shrink-0 text-axis" viewBox="0 0 20 20" fill="none" aria-hidden>
      <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6.5 10.5l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ChevronDown({ open }) {
  return (
    <svg viewBox="0 0 20 20" className={`h-5 w-5 shrink-0 transition-transform duration-300 text-slate-400 ${open ? 'rotate-180' : ''}`} fill="none" aria-hidden>
      <path d="M5 7.5l5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ── Data ─────────────────────────────────────────────────────────────────────

const features = [
  {
    eyebrow: 'Furnished',
    heading: 'Move-in ready rooms',
    body: 'Bed, desk, chair, and closet included. Move in as-is.',
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M3 10.5V18M21 10.5V18M3 13.5H21V8.25A1.5 1.5 0 0 0 19.5 6.75H4.5A1.5 1.5 0 0 0 3 8.25V13.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    dark: true,
  },
  {
    eyebrow: 'All-inclusive',
    heading: 'Utilities + WiFi included',
    body: 'Water, electricity, gas, and WiFi included. No surprise bills.',
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M1.5 8.5a15 15 0 0 1 21 0M5 12a12 12 0 0 1 14 0M8.5 15.5a7 7 0 0 1 7 0M12 19h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    dark: false,
  },
  {
    eyebrow: 'Location',
    heading: 'Walk to campus',
    body: 'Our homes are 0.3 miles from the University of Washington — a 5-minute walk to class.',
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d="M12 2C8.686 2 6 4.686 6 8c0 5.25 6 14 6 14s6-8.75 6-14c0-3.314-2.686-6-6-6z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        <circle cx="12" cy="8" r="2.25" stroke="currentColor" strokeWidth="1.5"/>
      </svg>
    ),
    dark: true,
  },
]

const steps = [
  { n: '01', title: 'Browse rooms', body: 'Compare locations, floor plans, and pricing across available homes.', color: 'text-axis' },
  { n: '02', title: 'Apply online', body: 'Submit your application in minutes. No in-person visits required.', color: 'text-gold' },
  { n: '03', title: 'Move in', body: 'Once approved, sign your lease and move into your furnished room.', color: 'text-emerald-400' },
]

const neighborhoodItems = [
  '5-minute walk to UW main campus',
  'University District light rail station nearby',
  'Grocery stores, cafes, and restaurants within walking distance',
  'Burke-Gilman Trail access for commuting and recreation',
  'Adjacent to the Ave — U District\'s main commercial corridor',
]

const faqs = [
  { q: 'What is included in the monthly rent?', a: 'All utilities (water, electricity, gas), high-speed WiFi, and bi-monthly professional cleaning of common areas are included. No surprise bills.' },
  { q: 'Are rooms furnished?', a: 'Yes — rooms are furnished for a $25/month furnishing fee and include a bed frame and mattress, desk, chair, and closet. Common areas include a sofa, and the kitchen is furnished as well.' },
  { q: 'What lease terms are available?', a: 'Lease structure depends on the house. Some homes follow fixed summer, academic-year, and full-year terms, while others offer more room-by-room flexibility based on current availability.' },
  { q: 'How far are the homes from UW?', a: 'Our properties are located 0.3–0.5 miles from the UW main campus — approximately a 5–10 minute walk.' },
  { q: 'How do I apply?', a: 'Click "Apply Now" and complete the online application. You\'ll need basic personal information, employment details, and references. We typically respond within 2 business days.' },
  { q: 'Can I tour before applying?', a: 'Yes. Use the "Schedule a Tour" button to contact us and we\'ll arrange a walkthrough at a convenient time.' },
]

// ── Eyebrow label ─────────────────────────────────────────────────────────────

function Eyebrow({ children, light = false }) {
  return (
    <span className={`inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] ${light ? 'text-teal-300' : 'text-axis'}`}>
      <span className="h-px w-6 bg-current opacity-50" />
      {children}
    </span>
  )
}

// ── FAQ item ─────────────────────────────────────────────────────────────────

function FaqItem({ q, a }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border-b border-slate-200 last:border-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-4 py-5 text-left sm:gap-6"
        aria-expanded={open}
      >
        <span className="text-sm font-semibold text-slate-900 sm:text-[15px]">{q}</span>
        <ChevronDown open={open} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="a"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <p className="pb-5 pr-0 text-sm leading-7 text-slate-600 sm:pr-10">{a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const heroImage = properties[1]?.images?.[0] || properties[0]?.images?.[0]

  return (
    <div className="bg-cream-50">
      <Seo
        title="Axis Seattle | Private Rooms in the U District"
        description="Furnished private bedrooms in modern shared homes near the University of Washington. Utilities included, flexible leases, fast online applications."
        pathname="/"
        image={heroImage}
        structuredData={buildWebsiteSchema()}
      />

      {/* ── HERO ── */}
      <Hero heroImage={heroImage} />

      {/* ── FEATURE CARDS ── */}
      <section className="bg-cream-50 px-4 py-14 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-6xl">
          <motion.div
            className="grid gap-4 sm:grid-cols-3"
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: '-48px' }}
            variants={stagger}
          >
            {features.map((f) => (
              <motion.div
                key={f.eyebrow}
                variants={up}
                className={`group flex flex-col rounded-2xl p-5 sm:p-7 transition-transform hover:-translate-y-1 ${
                  f.dark
                    ? 'bg-navy-900 text-white'
                    : 'bg-white border border-slate-200 text-slate-900'
                }`}
              >
                <div className={`w-11 h-11 flex items-center justify-center rounded-xl mb-4 ${f.dark ? 'bg-white/10 text-axis' : 'bg-axis/10 text-axis'}`}>
                  {f.icon}
                </div>
                <p className={`text-xs font-bold uppercase tracking-[0.18em] ${f.dark ? 'text-axis' : 'text-axis'}`}>{f.eyebrow}</p>
                <h3 className={`mt-2 text-xl font-bold leading-snug ${f.dark ? 'text-white' : 'text-slate-900'}`}>{f.heading}</h3>
                <p className={`mt-2.5 text-sm leading-6 ${f.dark ? 'text-white/55' : 'text-slate-500'}`}>{f.body}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── AVAILABLE ROOMS ── */}
      <section id="properties" className="scroll-mt-20 border-t border-slate-100 bg-white px-4 py-14 sm:px-6 sm:py-20">
        <div className="mx-auto max-w-6xl">
          <Reveal>
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <Eyebrow>Available now</Eyebrow>
                <h2 className="mt-3 font-serif text-2xl font-black tracking-tight text-slate-900 sm:text-4xl">Available Homes</h2>
                <p className="mt-3 text-sm leading-6 text-slate-500 sm:text-base sm:leading-7">
                  Compare layouts, pricing, and amenities across our current shared homes near UW.
                </p>
              </div>
              <Link
                reloadDocument
                to={`/contact?subject=${encodeURIComponent('Tour request')}`}
                className="inline-flex w-full items-center justify-center gap-2 self-start rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 shadow-soft transition hover:border-axis hover:text-axis sm:w-auto sm:justify-start sm:py-2.5 sm:self-auto"
              >
                Schedule a Tour <Arrow />
              </Link>
            </div>
          </Reveal>

          <motion.div
            className="mt-8 grid gap-6 xl:grid-cols-2"
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: '-48px' }}
            variants={stagger}
          >
            {properties.map((p) => (
              <motion.div key={p.slug} variants={up}>
                <PropertyCard p={p} />
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── NEIGHBORHOOD — dark section ── */}
      <section className="relative overflow-hidden bg-navy-900 px-4 py-14 text-white sm:px-6 sm:py-24">
        {/* dot grid */}
        <div className="absolute inset-0 bg-dot-grid-dark bg-dot-md opacity-50" />
        {/* teal glow */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_80%_50%,rgba(14,165,164,0.12),transparent_60%)]" />

        <div className="relative mx-auto max-w-6xl">
          <div className="grid gap-10 sm:gap-12 lg:grid-cols-2 lg:items-center">
            <Reveal>
              <Eyebrow light>Neighborhood</Eyebrow>
              <h2 className="mt-4 font-serif text-2xl font-black tracking-tight text-white sm:text-4xl">
                Seattle&apos;s University District
              </h2>
              <p className="mt-4 max-w-md text-sm leading-6 text-white/60 sm:text-base sm:leading-7">
                Steps from campus, transit, and daily essentials — no car needed.
              </p>
              <ul className="mt-6 space-y-3">
                {neighborhoodItems.map((t) => (
                  <li key={t} className="flex items-start gap-3 text-sm text-white/75">
                    <CheckCircle />
                    {t}
                  </li>
                ))}
              </ul>
              <div className="mt-8">
                <Link
                  reloadDocument
                  to={`/contact?subject=${encodeURIComponent('Tour request')}`}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-axis px-6 py-3 text-sm font-semibold text-white shadow-[0_0_20px_rgba(14,165,164,0.4)] transition hover:bg-axis-dark active:scale-[0.97] sm:w-auto"
                >
                  Request a Tour <Arrow />
                </Link>
              </div>
            </Reveal>

            <Reveal delay={0.1} className="grid grid-cols-2 gap-3">
              {[
                { label: 'Walk to UW', value: '0.3 mi' },
                { label: 'Starting rent', value: '$725 /mo' },
                { label: 'Utilities', value: 'Included' },
                { label: 'Application', value: 'Online' },
              ].map((s) => (
                <div key={s.label} className="flex flex-col justify-between rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm">
                  <span className="text-xs font-semibold uppercase tracking-[0.15em] text-white/40">{s.label}</span>
                  <span className="mt-4 text-2xl font-black text-white">{s.value}</span>
                </div>
              ))}
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS — cream section ── */}
      <section className="border-t border-slate-100 bg-cream-50 px-4 py-14 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-6xl">
          <Reveal className="text-center max-w-xl mx-auto mb-12">
            <Eyebrow>Process</Eyebrow>
            <h2 className="mt-4 font-serif text-2xl font-black tracking-tight text-slate-900 sm:text-4xl">How to get your room</h2>
            <p className="mt-3 text-sm leading-6 text-slate-500 sm:text-base sm:leading-7">Three simple steps from browsing to move-in day.</p>
          </Reveal>

          <motion.div
            className="grid gap-6 sm:grid-cols-3"
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: '-48px' }}
            variants={stagger}
          >
            {steps.map((s, i) => (
              <motion.div key={s.n} variants={up} className="relative flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-soft">
                {i < steps.length - 1 && (
                  <div className="absolute right-0 top-1/2 hidden -translate-y-1/2 translate-x-1/2 sm:block">
                    <svg className="w-5 h-5 text-slate-300" viewBox="0 0 16 16" fill="none" aria-hidden><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </div>
                )}
                <span className={`text-4xl font-black ${s.color}`}>{s.n}</span>
                <h3 className="text-lg font-bold text-slate-900">{s.title}</h3>
                <p className="text-sm leading-6 text-slate-500">{s.body}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── FAQ — white section ── */}
      <section className="border-t border-slate-100 bg-white px-4 py-14 sm:px-6 sm:py-24">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-12 lg:grid-cols-[1fr_1.8fr] lg:items-start">
            <Reveal>
              <div className="lg:sticky lg:top-24">
                <Eyebrow>FAQ</Eyebrow>
                <h2 className="mt-4 font-serif text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">Common questions</h2>
                <p className="mt-4 text-sm leading-7 text-slate-500">
                  Not finding your answer? Contact us.
                </p>
                <Link
                  reloadDocument
                  to="/contact"
                  onClick={scrollToTop}
                  className="mt-6 inline-flex items-center gap-2 rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-soft transition hover:border-axis hover:text-axis"
                >
                  Contact us <Arrow />
                </Link>
              </div>
            </Reveal>

            <Reveal delay={0.1}>
              <div className="divide-y divide-slate-100">
                {faqs.map((f) => <FaqItem key={f.q} q={f.q} a={f.a} />)}
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── CTA — dark gradient ── */}
      <section className="border-t border-slate-100 bg-cream-50 px-4 pb-16 pt-4 sm:px-6 sm:pb-20">
        <Reveal>
          <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-navy-900 px-5 py-10 sm:px-8 sm:py-14 md:px-14">
            {/* dot grid inside CTA */}
            <div className="absolute inset-0 bg-dot-grid-dark bg-dot-md opacity-40 rounded-3xl" />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_50%,rgba(14,165,164,0.2),transparent_60%)]" />
            <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div>
                <Eyebrow light>Ready?</Eyebrow>
                <h2 className="mt-3 font-serif text-2xl font-black tracking-tight text-white sm:text-3xl md:text-4xl">
                  Find your room today
                </h2>
                <p className="mt-2 text-sm text-white/55 leading-6">
                  Tour, ask questions, or apply online.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <Link
                  reloadDocument
                  to={`/contact?subject=${encodeURIComponent('Tour request')}`}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-axis px-6 py-3 text-sm font-semibold text-white shadow-[0_0_24px_rgba(14,165,164,0.5)] transition hover:bg-axis-dark active:scale-[0.97] sm:w-auto"
                >
                  Schedule a Tour <Arrow />
                </Link>
                <Link
                  to="/apply"
                  onClick={scrollToTop}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/20 bg-white/10 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/20 active:scale-[0.97] sm:w-auto"
                >
                  Apply Now <Arrow />
                </Link>
              </div>
            </div>
          </div>
        </Reveal>
      </section>
    </div>
  )
}

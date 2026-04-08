import React, { useState, useMemo, useRef } from 'react'
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
  { q: 'Are rooms furnished?', a: 'Yes — all rooms come fully furnished and include a bed frame and mattress, desk, chair, and closet. Common areas include a sofa, and the kitchen is furnished as well.' },
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

// ── Room Finder ───────────────────────────────────────────────────────────────

function parseFinderPrice(str) {
  const m = String(str || '').match(/\$([\d,]+)/)
  return m ? Number(m[1].replace(/,/g, '')) : 0
}

// Check if a room's availability string covers a target date
function isAvailableOn(available, date) {
  const a = (available || '').toLowerCase().trim()
  if (!a || a === 'unavailable' || a === 'currently unavailable' || a === 'booked') return false
  if (a === 'available now') return true
  // Date ranges like "April 14, 2026-May 15, 2026"
  for (const m of a.matchAll(/(\w+ \d+,?\s*\d{4})\s*[-–]\s*(\w+ \d+,?\s*\d{4})/g)) {
    const s = new Date(m[1]), e = new Date(m[2])
    if (!isNaN(s) && !isNaN(e) && date >= s && date <= e) return true
  }
  // "after [date]"
  for (const m of a.matchAll(/after (\w+ \d+,?\s*\d{4})/g)) {
    const d = new Date(m[1])
    if (!isNaN(d) && date >= d) return true
  }
  return false
}

// Check if a room is available throughout a date range
function isAvailableForRange(available, startDate, endDate) {
  if (!startDate) return true
  const start = new Date(startDate)
  if (!endDate) return isAvailableOn(available, start)
  const end = new Date(endDate)

  const a = (available || '').toLowerCase().trim()
  if (!a || a === 'unavailable' || a === 'currently unavailable' || a === 'booked') return false
  if (a === 'available now') return true

  // Date ranges: the room's window must fully contain [start, end]
  for (const m of a.matchAll(/(\w+ \d+,?\s*\d{4})\s*[-–]\s*(\w+ \d+,?\s*\d{4})/g)) {
    const s = new Date(m[1]), e = new Date(m[2])
    if (!isNaN(s) && !isNaN(e) && start >= s && end <= e) return true
  }
  // "after [date]": open-ended, so the whole range is fine as long as start >= d
  for (const m of a.matchAll(/after (\w+ \d+,?\s*\d{4})/g)) {
    const d = new Date(m[1])
    if (!isNaN(d) && start >= d) return true
  }
  return false
}

function buildFinderOptions() {
  const options = []
  for (const property of properties) {
    for (const plan of (property.roomPlans || [])) {
      const price = parseFinderPrice(plan.priceRange)
      const rooms = plan.rooms || []
      const available = rooms.filter((r) => {
        const a = (r.available || '').toLowerCase()
        return a !== 'unavailable' && a !== 'currently unavailable' && a !== 'booked'
      })
      if (available.length === 0) continue
      const privateBath = rooms.some(r => (r.details || '').toLowerCase().includes('private'))
      const shareCount = privateBath ? 'private' : rooms.length
      options.push({
        propertySlug: property.slug,
        propertyName: property.name,
        propertyImage: (property.images || [])[0],
        planTitle: plan.title,
        price,
        priceDisplay: plan.priceRange,
        privateBath,
        shareCount,
        requiredRoomCount: rooms.length,
        availableCount: available.length,
        availableRooms: available,
      })
    }
  }
  return options
}

function getMatchingAvailableRooms(opt, moveInDate, moveOutDate) {
  if (!moveInDate) return opt.availableRooms
  return opt.availableRooms.filter((room) =>
    isAvailableForRange(room.available, moveInDate, moveOutDate || null)
  )
}

const BATH_OPTIONS = [
  { value: 'any', label: 'Any' },
  { value: 'private', label: 'Private bath' },
  { value: '2', label: '2-share' },
  { value: '3', label: '3-share' },
  { value: '4', label: '4-share' },
]




function MatchCard({ opt, seasonLabel }) {
  return (
    <Link
      to={`/properties/${opt.propertySlug}#floor-plans`}
      onClick={scrollToTop}
      className="group flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-axis hover:shadow-[0_4px_18px_rgba(14,165,164,0.12)]"
    >
      {opt.propertyImage && (
        <img src={opt.propertyImage} alt={opt.propertyName} className="h-16 w-20 shrink-0 rounded-xl object-cover" />
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{opt.propertyName}</div>
        <div className="mt-0.5 font-semibold text-slate-900 leading-snug truncate">{opt.planTitle}</div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
          <span className="font-bold text-slate-800">{opt.priceDisplay}</span>
          <span className="text-slate-300">·</span>
          <span className="font-medium text-emerald-600">{opt.matchingAvailableCount ?? opt.availableCount} available</span>
          {opt.privateBath ? (
            <><span className="text-slate-300">·</span><span className="font-medium text-axis">Private bath</span></>
          ) : typeof opt.shareCount === 'number' ? (
            <><span className="text-slate-300">·</span><span>{opt.shareCount}-person shared bath</span></>
          ) : null}
        </div>
        {seasonLabel && (
          <div className="mt-2 inline-block rounded-md bg-teal-50 px-2 py-0.5 text-[10px] font-semibold text-teal-700">
            {seasonLabel}
          </div>
        )}
      </div>
      <svg className="h-4 w-4 shrink-0 text-axis opacity-0 transition group-hover:opacity-100" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Link>
  )
}

const MAX_DATE = '2035-12-31'

// Prevent year from exceeding 4 digits
function clampYear(dateStr) {
  if (!dateStr) return dateStr
  const [y, m, d] = dateStr.split('-')
  if (!y || y.length <= 4) return dateStr
  return `${y.slice(0, 4)}-${m}-${d}`
}

function RoomFinder() {
  const [budgetInput, setBudgetInput] = useState('')
  const [bath, setBath] = useState('any')
  const [moveInDate, setMoveInDate] = useState('')
  const [moveOutDate, setMoveOutDate] = useState('')

  const allOptions = useMemo(() => buildFinderOptions(), [])

  const budget = parseInt(budgetInput, 10) || 0
  const hasFilters = budgetInput !== '' || bath !== 'any' || moveInDate !== ''

  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), [])

  const results = useMemo(() => {
    if (!hasFilters) return []
    return allOptions
      .map((opt) => ({
        ...opt,
        matchingAvailableCount: getMatchingAvailableRooms(opt, moveInDate, moveOutDate).length,
      }))
      .filter((opt) => {
        if (budget > 0 && opt.price > budget) return false
        if (bath === 'private' && !opt.privateBath) return false
        if (bath === '2' && opt.shareCount !== 2) return false
        if (bath === '3' && opt.shareCount !== 3) return false
        if (bath === '4' && opt.shareCount !== 4) return false
        if (moveInDate) {
          if (opt.matchingAvailableCount < opt.requiredRoomCount) return false
        }
        return true
      })
      .sort((a, b) => a.price - b.price)
  }, [allOptions, budget, bath, moveInDate, moveOutDate, hasFilters])

  // Build a human-readable availability label for matched cards
  function getDateLabel() {
    if (!moveInDate) return null
    const inFmt = new Date(moveInDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    if (!moveOutDate) return `Available from ${inFmt}`
    const outFmt = new Date(moveOutDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    return `${inFmt} – ${outFmt}`
  }

  const dateLabel = getDateLabel()

  return (
    <section className="border-t border-slate-100 bg-white px-4 py-14 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-6xl">
        <Reveal className="mb-8 text-center">
          <Eyebrow>Room Finder</Eyebrow>
          <h2 className="mt-3 font-serif text-2xl font-black tracking-tight text-slate-900 sm:text-4xl">
            Find the best fit for you
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-500">
            Enter your dates and budget — we'll show rooms available for your stay.
          </p>
        </Reveal>

        <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6 sm:p-8">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {/* Move-in date */}
            <div>
              <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Move-in date</div>
              <input
                type="date"
                min={todayStr}
                max={MAX_DATE}
                value={moveInDate}
                onChange={e => {
                  const val = clampYear(e.target.value)
                  setMoveInDate(val)
                  if (moveOutDate && val > moveOutDate) setMoveOutDate('')
                }}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:border-axis focus:ring-2 focus:ring-axis/20"
              />
              {moveInDate && (
                <button type="button" onClick={() => { setMoveInDate(''); setMoveOutDate('') }}
                  className="mt-1 text-[11px] font-medium text-slate-400 underline-offset-2 hover:text-slate-600 hover:underline">Clear</button>
              )}
            </div>

            {/* Move-out date */}
            <div>
              <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Move-out date <span className="font-normal text-slate-400 normal-case tracking-normal">(optional)</span></div>
              <input
                type="date"
                min={moveInDate || todayStr}
                max={MAX_DATE}
                value={moveOutDate}
                disabled={!moveInDate}
                onChange={e => setMoveOutDate(clampYear(e.target.value))}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:border-axis focus:ring-2 focus:ring-axis/20 disabled:opacity-40 disabled:cursor-not-allowed"
              />
              {moveOutDate && (
                <button type="button" onClick={() => setMoveOutDate('')}
                  className="mt-1 text-[11px] font-medium text-slate-400 underline-offset-2 hover:text-slate-600 hover:underline">Clear</button>
              )}
            </div>

            {/* Budget slider */}
            <div>
              <div className="mb-3 flex items-center justify-between">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Max budget / month</div>
                <div className={`text-sm font-semibold transition-colors ${budgetInput ? 'text-axis' : 'text-slate-400'}`}>
                  {budgetInput ? `$${budgetInput}` : 'Any'}
                </div>
              </div>
              <div className="relative py-2">
                <input
                  type="range"
                  min="600"
                  max="1100"
                  step="25"
                  value={budgetInput || 600}
                  onChange={e => setBudgetInput(e.target.value)}
                  style={{ '--val': budgetInput || 600 }}
                  className="budget-slider w-full cursor-pointer appearance-none"
                />
                <div className="mt-2 flex justify-between text-[10px] font-medium text-slate-400">
                  <span>$600</span>
                  <span>$850</span>
                  <span>$1,100</span>
                </div>
              </div>
              {budgetInput && (
                <button type="button" onClick={() => setBudgetInput('')}
                  className="mt-1 text-[11px] font-medium text-slate-400 underline-offset-2 hover:text-slate-600 hover:underline">Clear</button>
              )}
            </div>

            {/* Bathroom type dropdown */}
            <div>
              <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Bathroom type</div>
              <div className="relative">
                <select
                  value={bath}
                  onChange={e => setBath(e.target.value)}
                  className="w-full appearance-none rounded-xl border border-slate-200 bg-white py-2.5 pl-4 pr-9 text-sm font-medium text-slate-900 outline-none transition focus:border-axis focus:ring-2 focus:ring-axis/20"
                >
                  {BATH_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" viewBox="0 0 16 16" fill="none">
                  <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </div>
          </div>

          <AnimatePresence mode="wait">
            {!hasFilters ? (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
                className="mt-8 border-t border-slate-200 pt-8 text-center">
                <svg className="mx-auto mb-3 h-8 w-8 text-slate-300" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <p className="text-sm font-medium text-slate-400">Enter a move-in date or budget to see matching rooms</p>
              </motion.div>
            ) : results.length === 0 ? (
              <motion.div key="no-results" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}
                className="mt-8 border-t border-slate-200 pt-8 text-center">
                <p className="text-sm font-medium text-slate-500">No rooms match those filters.</p>
                <p className="mt-1 text-xs text-slate-400">Try adjusting your dates, raising your budget, or changing the bathroom type.</p>
              </motion.div>
            ) : (
              <motion.div key={`${budgetInput}-${bath}-${moveInDate}-${moveOutDate}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }} className="mt-8 border-t border-slate-200 pt-6">
                <div className="mb-4 text-sm text-slate-500">
                  <span className="font-bold text-slate-900">{results.length}</span> match{results.length !== 1 ? 'es' : ''} found
                  {dateLabel && <span className="ml-2 text-slate-400">· {dateLabel}</span>}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {results.map((opt, i) => <MatchCard key={i} opt={opt} seasonLabel={dateLabel} />)}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </section>
  )
}

// ── Property Carousel ────────────────────────────────────────────────────────

function PropertyCarousel() {
  const trackRef = useRef(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(true)

  function updateArrows() {
    const el = trackRef.current
    if (!el) return
    setCanLeft(el.scrollLeft > 8)
    setCanRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 8)
  }

  function scroll(dir) {
    const el = trackRef.current
    if (!el) return
    const cardW = el.querySelector('[data-card]')?.offsetWidth || 480
    el.scrollBy({ left: dir * (cardW + 24), behavior: 'smooth' })
  }

  return (
    <div className="relative mt-8">
      {/* Left arrow */}
      <button
        type="button"
        onClick={() => scroll(-1)}
        aria-label="Previous"
        className={`absolute left-2 top-1/2 z-10 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-md border border-slate-200 transition hover:border-axis hover:text-axis sm:left-4 ${
          canLeft ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M10 4L6 8l4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Scrollable track */}
      <div
        ref={trackRef}
        onScroll={updateArrows}
        className="flex gap-6 overflow-x-auto scroll-smooth px-4 pb-4 sm:px-6 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        {properties.map((p) => (
          <div
            key={p.slug}
            data-card
            className="w-[min(88vw,480px)] shrink-0"
          >
            <PropertyCard p={p} />
          </div>
        ))}
        {/* spacer so last card doesn't sit against edge */}
        <div className="w-px shrink-0" />
      </div>

      {/* Right arrow */}
      <button
        type="button"
        onClick={() => scroll(1)}
        aria-label="Next"
        className={`absolute right-2 top-1/2 z-10 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-md border border-slate-200 transition hover:border-axis hover:text-axis sm:right-4 ${
          canRight ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
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

      {/* ── ROOM FINDER ── */}
      <RoomFinder />

      {/* ── AVAILABLE ROOMS ── */}
      <section id="properties" className="scroll-mt-20 border-t border-slate-100 bg-white py-14 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Reveal>
            <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-2xl">
                <Eyebrow>Available now</Eyebrow>
                <h2 className="mt-3 font-serif text-2xl font-black tracking-tight text-slate-900 sm:text-4xl">Available Homes</h2>
                <p className="mt-3 text-sm leading-6 text-slate-500 sm:text-base sm:leading-7">
                  Browse our shared homes near UW — swipe or use the arrows to explore.
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
        </div>

        <PropertyCarousel />
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
                  <div className="absolute right-0 top-1/2 hidden -translate-y-1/2 translate-x-1/2 sm:flex items-center justify-center z-10">
                    <div className="flex items-center gap-0.5 rounded-full border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm">
                      <span className="h-1 w-1 rounded-full bg-slate-300" />
                      <span className="h-px w-3 bg-slate-300" />
                      <svg className="h-3 w-3 text-slate-400" viewBox="0 0 12 12" fill="none" aria-hidden>
                        <path d="M2 6h8M7 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
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

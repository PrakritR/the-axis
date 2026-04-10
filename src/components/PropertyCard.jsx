import React, { useRef } from 'react'
import { Link } from 'react-router-dom'
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion'
import Carousel from './Carousel'
import { getPropertyRentRange } from '../lib/pricing'

function IconBed() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M3 10.5V18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M21 10.5V18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M3 13.5H21V8.25A1.5 1.5 0 0 0 19.5 6.75H4.5A1.5 1.5 0 0 0 3 8.25V13.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function IconBath() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 11.5h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M6 11.5V8.75A2.75 2.75 0 0 1 8.75 6H10a2 2 0 1 1 0 4H4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M5 11.5V13a6 6 0 0 0 6 6h2a6 6 0 0 0 6-6v-1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

export default function PropertyCard({ p }) {
  const cardRef = useRef(null)
  const mouseX = useMotionValue(0)
  const mouseY = useMotionValue(0)
  const rotateX = useSpring(useTransform(mouseY, [-0.5, 0.5], [2, -2]), { stiffness: 300, damping: 30 })
  const rotateY = useSpring(useTransform(mouseX, [-0.5, 0.5], [-2, 2]), { stiffness: 300, damping: 30 })

  function onMouseMove(e) {
    const rect = cardRef.current?.getBoundingClientRect()
    if (!rect) return
    mouseX.set((e.clientX - rect.left) / rect.width - 0.5)
    mouseY.set((e.clientY - rect.top) / rect.height - 0.5)
  }
  function onMouseLeave() { mouseX.set(0); mouseY.set(0) }

  const rentRange = getPropertyRentRange(p)

  return (
    <motion.div
      ref={cardRef}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      style={{ rotateX, rotateY, transformPerspective: 900 }}
      whileHover={{ y: -4 }}
      transition={{ duration: 0.2 }}
      className="group flex flex-col overflow-hidden rounded-[28px] border border-white/90 bg-white/88 shadow-[0_24px_60px_rgba(37,99,235,0.10)] backdrop-blur transition-shadow hover:shadow-[0_30px_70px_rgba(37,99,235,0.15)]"
    >
      <div className="relative aspect-[5/4] w-full overflow-hidden sm:aspect-[16/10]">
        <Carousel images={p.images.slice(0, 6)} height="100%" altPrefix={p.name} className="h-full">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
          <div className="absolute left-3 top-3 pointer-events-none">
            <span className="rounded-full border border-white/80 bg-white/90 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-800 shadow-sm backdrop-blur-sm">
              {p.type}
            </span>
          </div>
          <div className="absolute bottom-3 right-3 pointer-events-none text-right sm:right-4 [text-shadow:0_1px_3px_rgba(0,0,0,0.95),0_2px_12px_rgba(0,0,0,0.55)]">
            <p className="text-xs font-semibold text-white">from</p>
            <p className="leading-none text-lg font-black text-white">{rentRange || '—'}<span className="text-xs font-semibold text-white/95">/mo</span></p>
          </div>
        </Carousel>
      </div>

      <div className="flex flex-1 flex-col p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-slate-900 leading-snug">{p.name}</h3>
            <p className="mt-0.5 text-sm text-slate-500">{p.address}</p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-4 text-sm text-slate-500">
          <span className="flex items-center gap-1.5"><IconBed />{p.beds} bedrooms</span>
          <span className="flex items-center gap-1.5"><IconBath />{p.baths} bathrooms</span>
        </div>

        <p className="mt-3 line-clamp-2 text-sm leading-6 text-slate-500">{p.summary}</p>

        {p.tags?.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {p.tags.slice(0, 3).map((tag) => (
              <span key={tag} className="rounded-full border border-[#2563eb]/10 bg-[#2563eb]/5 px-3 py-1 text-xs font-medium text-slate-600">{tag}</span>
            ))}
          </div>
        )}

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link
            to={`/properties/${p.slug}`}
            className="group/btn flex w-full flex-1 items-center justify-center gap-2 rounded-full bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] px-4 py-3 text-sm font-semibold text-white shadow-[0_14px_32px_rgba(37,99,235,0.18)] transition hover:brightness-105 active:scale-[0.97]"
          >
            View Listing
            <svg className="h-4 w-4 transition-transform duration-200 group-hover/btn:translate-x-1" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </Link>
          <Link
            to={`/apply?property=${encodeURIComponent(p.slug)}`}
            className="flex h-11 w-full shrink-0 items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 transition hover:border-[#2563eb] hover:text-[#2563eb] sm:w-auto sm:px-3"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v0ZM9 12h6M9 16h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Apply
          </Link>
        </div>
      </div>
    </motion.div>
  )
}

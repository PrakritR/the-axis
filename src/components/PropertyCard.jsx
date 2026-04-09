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
      className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-card transition-shadow hover:shadow-[0_12px_40px_rgba(15,23,42,0.14)]"
    >
      {/* Image */}
      <div className="relative aspect-[5/4] w-full overflow-hidden sm:aspect-[16/10]">
        <Carousel images={p.images.slice(0, 6)} height="100%" altPrefix={p.name} className="h-full">
          <div className="absolute inset-0 bg-gradient-to-t from-navy-900/70 via-transparent to-transparent pointer-events-none" />
          {/* Type badge */}
          <div className="absolute left-3 top-3 pointer-events-none">
            <span className="rounded-full bg-navy-900/70 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white backdrop-blur-sm border border-white/10">
              {p.type}
            </span>
          </div>
          {/* Rent overlay */}
          <div className="absolute bottom-3 right-3 pointer-events-none text-right sm:right-4">
            <p className="text-xs text-white/60 drop-shadow">from</p>
            <p className="text-lg font-black text-white drop-shadow leading-none">{rentRange || '—'}<span className="text-xs font-medium text-white/70">/mo</span></p>
          </div>
        </Carousel>
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-slate-900 leading-snug">{p.name}</h3>
            <p className="mt-0.5 text-sm text-slate-400">{p.address}</p>
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
              <span key={tag} className="rounded-full bg-cream-100 border border-cream-200 px-3 py-1 text-xs font-medium text-slate-600">{tag}</span>
            ))}
          </div>
        )}

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link
            reloadDocument
            to={`/properties/${p.slug}`}
            className="group/btn flex w-full flex-1 items-center justify-center gap-2 rounded-full bg-navy-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-navy-800 active:scale-[0.97]"
          >
            View Listing
            <svg className="h-4 w-4 transition-transform duration-200 group-hover/btn:translate-x-1" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </Link>
          <Link
            reloadDocument
            to={`/contact?subject=${encodeURIComponent('Tour request - ' + p.name)}`}
            className="flex h-11 w-full shrink-0 items-center justify-center gap-2 rounded-full border border-slate-200 px-4 text-sm font-semibold text-slate-600 transition hover:border-axis hover:text-axis sm:w-auto sm:px-3"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M8 7H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3m-1-4H9m1 4V3m4 4V3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span className="sm:hidden">Request Tour</span>
          </Link>
        </div>
      </div>
    </motion.div>
  )
}

import React from 'react'
import { Link } from 'react-router-dom'
import scrollToTop from '../utils/scrollToTop'
import { AxisWordmark } from './logos/AxisLogos'

export default function Footer() {
  return (
    <footer className="w-full shrink-0 border-t border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.36)_0%,rgba(255,255,255,0.72)_100%)] pb-24 text-sm text-slate-500 backdrop-blur-xl md:pb-0">
      <div className="h-px w-full bg-gradient-to-r from-transparent via-[#2563eb]/35 to-transparent" />

      <div className="border-b border-slate-200/70">
        <div className="container mx-auto grid gap-10 px-6 py-14 sm:grid-cols-2 md:grid-cols-[1.5fr_0.7fr_0.7fr_0.9fr]">
          <div className="sm:col-span-2 md:col-span-1">
            <div className="flex items-center">
              <AxisWordmark tone="dark" className="h-10 w-auto opacity-95" />
            </div>
            <p className="mt-5 max-w-xs leading-6 text-slate-500">
              Available housing in Seattle with posted pricing and online applications.
            </p>
            <div className="mt-6 space-y-2.5 text-sm">
              <a href="tel:15103098345" className="flex items-center gap-2.5 text-slate-500 transition hover:text-[#2563eb]">
                <svg className="h-4 w-4 shrink-0 text-[#2563eb]/80" viewBox="0 0 20 20" fill="none" aria-hidden>
                  <path d="M3 4.5A1.5 1.5 0 014.5 3h1.879a.75.75 0 01.7.483l.878 2.196a.75.75 0 01-.171.82l-.994.993a10.52 10.52 0 004.717 4.717l.993-.994a.75.75 0 01.82-.171l2.196.878a.75.75 0 01.483.7V15.5A1.5 1.5 0 0115.5 17C8.596 17 3 11.404 3 4.5z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                (510) 309-8345
              </a>
              <a href="mailto:info@axis-seattle-housing.com" className="flex items-center gap-2.5 break-all text-slate-500 transition hover:text-[#2563eb]">
                <svg className="h-4 w-4 shrink-0 text-[#2563eb]/80" viewBox="0 0 20 20" fill="none" aria-hidden>
                  <path d="M2.25 6.75l7.5 5.25 7.5-5.25M2.25 6.75A2.25 2.25 0 014.5 4.5h11A2.25 2.25 0 0117.75 6.75v6.5A2.25 2.25 0 0115.5 15.5h-11a2.25 2.25 0 01-2.25-2.25v-6.5z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                info@axis-seattle-housing.com
              </a>
            </div>
          </div>

          <div>
            <h5 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-700">Explore</h5>
            <div className="mt-5 flex flex-col gap-3.5">
              <Link to={{ pathname: '/', hash: '#properties' }} className="inline-block transition hover:text-slate-900 hover:translate-x-0.5">Homes & availability</Link>
              <Link to="/apply" onClick={scrollToTop} className="inline-block transition hover:text-slate-900 hover:translate-x-0.5">Apply online</Link>
              <Link reloadDocument to={`/contact?subject=${encodeURIComponent('Schedule a tour')}`} className="inline-block transition hover:text-slate-900 hover:translate-x-0.5">Schedule a tour</Link>
              <Link reloadDocument to="/contact" className="inline-block transition hover:text-slate-900 hover:translate-x-0.5">Contact us</Link>
            </div>
          </div>

          <div>
            <h5 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-700">Housing</h5>
            <div className="mt-5 flex flex-col gap-3.5">
              <Link to={{ pathname: '/', hash: '#properties' }} className="inline-block transition hover:text-slate-900 hover:translate-x-0.5">Available housing</Link>
              <Link to="/apply" onClick={scrollToTop} className="inline-block transition hover:text-slate-900 hover:translate-x-0.5">Application process</Link>
              <Link reloadDocument to="/contact" className="inline-block transition hover:text-slate-900 hover:translate-x-0.5">Lease questions</Link>
            </div>
          </div>

          <div>
            <h5 className="text-xs font-bold uppercase tracking-[0.2em] text-slate-700">Location</h5>
            <div className="mt-5 space-y-3.5">
              <p className="leading-6 text-slate-500">
                5259 Brooklyn Ave NE<br />
                Seattle, WA 98105
              </p>
              <p className="text-slate-400">Seattle, WA</p>
              <a
                href="https://maps.google.com/?q=5259+Brooklyn+Ave+NE+Seattle+WA+98105"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#2563eb] transition hover:brightness-75"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="M8 1.5C5.515 1.5 3.5 3.515 3.5 6c0 3.5 4.5 8.5 4.5 8.5S12.5 9.5 12.5 6C12.5 3.515 10.485 1.5 8 1.5zM8 8a2 2 0 110-4 2 2 0 010 4z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                </svg>
                View on Google Maps
              </a>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto flex flex-col gap-3 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-slate-400">© 2026 Axis Seattle. All rights reserved.</p>
        <div className="flex items-center gap-4 text-xs text-slate-400">
          <span>Seattle Housing</span>
          <span className="text-slate-300">·</span>
          <span>Seattle, WA</span>
        </div>
      </div>
    </footer>
  )
}

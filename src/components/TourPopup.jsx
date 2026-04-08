import { useState, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { createPortal } from 'react-dom'

function formatPhone(raw) {
  const digits = raw.replace(/\D/g, '').slice(0, 10)
  if (digits.length < 4) return digits
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

const CALENDLY_URL = 'https://calendly.com/ramachandranprakrit/30min'

const PROPERTIES = [
  { id: '4709a', name: '4709A 8th Ave NE', address: '4709A 8th Ave NE, Seattle, WA', rooms: ['Room 1','Room 2','Room 3','Room 4','Room 5','Room 6','Room 7','Room 8','Room 9','Room 10'] },
  { id: '4709b', name: '4709B 8th Ave NE', address: '4709B 8th Ave NE, Seattle, WA', rooms: ['Room 1','Room 2','Room 3','Room 4','Room 5','Room 6','Room 7','Room 8','Room 9'] },
  { id: '5259',  name: '5259 Brooklyn Ave NE', address: '5259 Brooklyn Ave NE, Seattle, WA', rooms: ['Room 1','Room 2','Room 3','Room 4','Room 5','Room 6','Room 7','Room 8','Room 9'] },
]

function getCalendlyUrl({ property, room, tourType, name, email, phone }) {
  const enc = encodeURIComponent
  const format = tourType === 'virtual' ? 'Virtual' : 'In-Person'
  const notes = [
    `Property: ${property?.name}`,
    `Address: ${property?.address}`,
    `Room: ${room || 'Not sure yet'}`,
    `Tour Format: ${format}`,
    phone ? `Phone: ${phone}` : null,
    `Scheduled via Axis Seattle website`,
  ].filter(Boolean).join('\n')
  let url = `${CALENDLY_URL}?hide_gdpr_banner=1&primary_color=0f172a&a1=${enc(notes)}`
  if (name)  url += `&name=${enc(name)}`
  if (email) url += `&email=${enc(email)}`
  return url
}

function CalendlyModal({ url, onClose }) {
  const containerRef = useRef(null)
  const modalRoot = typeof document !== 'undefined'
    ? document.getElementById('modal-root') || document.body : null

  useEffect(() => {
    if (!document.querySelector('script[src*="calendly.com/assets/external/widget.js"]')) {
      const s = document.createElement('script')
      s.src = 'https://assets.calendly.com/assets/external/widget.js'
      s.async = true
      document.head.appendChild(s)
    }
    const init = () => {
      if (window.Calendly && containerRef.current) {
        containerRef.current.innerHTML = ''
        window.Calendly.initInlineWidget({ url, parentElement: containerRef.current })
      }
    }
    const script = document.querySelector('script[src*="calendly.com/assets/external/widget.js"]')
    if (window.Calendly) { init() }
    else { script?.addEventListener('load', init); return () => script?.removeEventListener('load', init) }
  }, [url])

  if (!modalRoot) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <span className="text-sm font-semibold text-slate-700">Pick a Time</span>
          <button onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div ref={containerRef} style={{ minWidth: '320px', height: 'min(680px, calc(100dvh - 140px))' }} />
      </div>
    </div>,
    modalRoot
  )
}

export default function TourPopup() {
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [everOpened, setEverOpened] = useState(false)
  const [step, setStep] = useState(1) // 1=tourType, 2=property, 3=room, 4=contact
  const [tourType, setTourType] = useState('in-person')
  const [propertyId, setPropertyId] = useState(null)
  const [room, setRoom] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [showCalendly, setShowCalendly] = useState(false)

  const onContactPage = location.pathname === '/contact'
  const selectedProperty = PROPERTIES.find(p => p.id === propertyId)

  function reset() {
    setStep(1); setTourType('in-person'); setPropertyId(null); setRoom('')
    setName(''); setEmail(''); setPhone(''); setShowCalendly(false)
  }

  // Show floating button after 3s; auto-expand at 20s
  useEffect(() => {
    if (onContactPage) return
    if (sessionStorage.getItem('tourPopupDismissed')) return

    const showBtn = setTimeout(() => setEverOpened(true), 3000)
    const autoOpen = setTimeout(() => {
      if (!sessionStorage.getItem('tourPopupDismissed')) setOpen(true)
    }, 20000)

    return () => { clearTimeout(showBtn); clearTimeout(autoOpen) }
  }, [onContactPage])

  function minimize() { setOpen(false) }
  function dismiss() {
    setOpen(false)
    setEverOpened(false)
    sessionStorage.setItem('tourPopupDismissed', '1')
  }

  function openPopup() { setEverOpened(true); setOpen(true) }

  function pickTime() {
    setShowCalendly(true)
  }

  if (onContactPage) return null

  // ── Floating button ────────────────────────────────────────────────────────
  if (!open) {
    if (!everOpened) return null
    return (
      <button
        onClick={openPopup}
        className="fixed bottom-6 left-6 z-40 flex items-center gap-2.5 rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-xl transition-all hover:bg-slate-700 hover:shadow-2xl"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        Schedule a Tour
      </button>
    )
  }

  // ── Expanded popup ─────────────────────────────────────────────────────────
  return (
    <>
    <div className="fixed bottom-6 left-6 z-40 w-[400px] max-w-[calc(100vw-3rem)] overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-2xl">

      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <div className="flex items-center gap-2.5">
          {step > 1 && (
            <button onClick={() => setStep(s => s - 1)}
              className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          <span className="text-sm font-semibold text-slate-700">Schedule a Tour</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={minimize}
            className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
            </svg>
          </button>
          <button onClick={dismiss}
            className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700">
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="px-5 py-6">

        {/* Step 1: Tour type */}
        {step === 1 && (
          <div>
            <h2 className="text-xl font-bold text-slate-900">What type of tour?</h2>
            <div className="mt-5 grid grid-cols-2 gap-3">
              {[['in-person', 'In-Person'], ['virtual', 'Virtual']].map(([val, label]) => (
                <button key={val} type="button"
                  onClick={() => { setTourType(val); setStep(2) }}
                  className="rounded-xl border-2 border-slate-200 bg-white py-4 text-sm font-semibold text-slate-700 transition-all hover:border-slate-900 hover:bg-slate-900 hover:text-white">
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: Property */}
        {step === 2 && (
          <div>
            <h2 className="text-xl font-bold text-slate-900">Which property?</h2>
            <div className="mt-5 space-y-2.5">
              {PROPERTIES.map(p => (
                <button key={p.id} type="button"
                  onClick={() => { setPropertyId(p.id); setRoom(''); setStep(3) }}
                  className="group flex w-full items-center justify-between rounded-xl border border-slate-200 px-4 py-3.5 text-left transition-all hover:border-slate-900 hover:shadow-sm">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{p.name}</div>
                    <div className="text-xs text-slate-400">{p.address}</div>
                  </div>
                  <svg className="h-4 w-4 text-slate-300 group-hover:text-slate-900" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 3: Room */}
        {step === 3 && selectedProperty && (
          <div>
            <h2 className="text-xl font-bold text-slate-900">Which room?</h2>
            <p className="mt-1 text-xs text-slate-400">{selectedProperty.name}</p>
            <div className="mt-4 grid grid-cols-5 gap-2">
              {selectedProperty.rooms.map(r => (
                <button key={r} type="button"
                  onClick={() => setRoom(r)}
                  className={`rounded-lg border-2 py-2.5 text-sm font-semibold transition-all ${room === r ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-400'}`}>
                  {r.replace('Room ', '')}
                </button>
              ))}
              <button type="button"
                onClick={() => setRoom('Not sure yet')}
                className={`col-span-5 rounded-lg border-2 py-2.5 text-sm font-semibold transition-all ${room === 'Not sure yet' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-400'}`}>
                Not sure yet
              </button>
            </div>

            {/* CTA once room selected */}
            {room && (
              <div className="mt-5 flex items-center gap-3">
                <button type="button" onClick={() => setStep(4)}
                  className="flex-1 rounded-full bg-slate-900 py-3 text-sm font-semibold text-white transition hover:bg-slate-700">
                  Continue →
                </button>
              </div>
            )}
          </div>
        )}

        {/* Step 4: Contact info */}
        {step === 4 && (
          <div>
            <h2 className="text-xl font-bold text-slate-900">Your contact info</h2>
            <p className="mt-1 text-xs text-slate-400">We'll include this when booking your tour.</p>
            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Name <span className="text-red-400">*</span></label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Your full name"
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-300 outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Email <span className="text-red-400">*</span></label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-300 outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Phone number</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(formatPhone(e.target.value))}
                  placeholder="(206) 555-0100"
                  className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-300 outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
                />
              </div>
            </div>
            <button
              type="button"
              disabled={!name.trim() || !email.trim()}
              onClick={pickTime}
              className="mt-5 w-full rounded-full bg-slate-900 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed">
              Pick a time →
            </button>
          </div>
        )}

        {/* Progress dots */}
        <div className="mt-6 flex items-center justify-between">
          <div className="flex gap-1.5">
            {[1, 2, 3, 4].map(i => (
              <div key={i}
                className={`h-1.5 rounded-full transition-all ${i <= step ? 'w-4 bg-slate-900' : 'w-1.5 bg-slate-200'}`}
              />
            ))}
          </div>
          {step < 4 && (
            <button onClick={reset} className="text-[11px] font-semibold text-slate-300 hover:text-slate-500">
              Start over
            </button>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-slate-50 px-5 py-2.5 text-center">
        <span className="text-[10px] text-slate-300">Axis Seattle · axis-seattle-housing.com</span>
      </div>
    </div>

    {/* Inline Calendly modal — shown on same site instead of external redirect */}
    {showCalendly && (
      <CalendlyModal
        url={getCalendlyUrl({ property: selectedProperty, room, tourType, name, email, phone })}
        onClose={() => { setShowCalendly(false); dismiss() }}
      />
    )}
  </>
  )
}

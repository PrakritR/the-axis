import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { properties } from '../data/properties'


const ROOM_MAP = {
  '4709A 8th Ave NE':  Array.from({ length: 10 }, (_, i) => `Room ${i + 1}`),
  '4709B 8th Ave NE':  Array.from({ length: 9  }, (_, i) => `Room ${i + 1}`),
  '5259 Brooklyn Ave NE': Array.from({ length: 9 }, (_, i) => `Room ${i + 1}`),
}

const TIME_SLOTS = ['9–11 AM', '11 AM–1 PM', '1–3 PM', '3–5 PM', '5–7 PM', 'Flexible']

function todayIso() { return new Date().toISOString().slice(0, 10) }

const TOTAL_STEPS = 5

// ── Icons ────────────────────────────────────────────────────────────────────
function IconCalendar() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  )
}
function IconMinus() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
    </svg>
  )
}
function IconX() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}
function IconCheck() {
  return (
    <svg className="h-6 w-6 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  )
}

// ── Shared input style ────────────────────────────────────────────────────────
const fieldCls = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-slate-900 focus:ring-1 focus:ring-slate-900'

// ── Choice button ─────────────────────────────────────────────────────────────
function Choice({ label, selected, onClick, full }) {
  return (
    <button type="button" onClick={onClick}
      className={`${full ? 'w-full' : ''} rounded-xl border-2 py-3.5 text-sm font-semibold transition-all ${selected ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'}`}>
      {label}
    </button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function TourPopup() {
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [everOpened, setEverOpened] = useState(false)
  const [step, setStep] = useState(1)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [calendlyLink, setCalendlyLink] = useState('')
  const [data, setData] = useState({
    tourType: '', property: '', room: '',
    preferredDate: '', preferredTime: '',
    name: '', email: '', phone: '',
  })

  const onContactPage = location.pathname === '/contact'

  // Don't show on contact page — user is already there
  // Show floating button after 8s, auto-expand after 40s
  useEffect(() => {
    if (onContactPage) return
    if (sessionStorage.getItem('tourPopupDone')) return

    const showBtn = setTimeout(() => setEverOpened(true), 8000)
    const autoOpen = setTimeout(() => {
      if (!sessionStorage.getItem('tourPopupDone')) setOpen(true)
    }, 40000)

    return () => { clearTimeout(showBtn); clearTimeout(autoOpen) }
  }, [onContactPage])

  function set(key, val) { setData(prev => ({ ...prev, [key]: val })) }
  function next() { setStep(s => Math.min(s + 1, TOTAL_STEPS)) }
  function back() { setStep(s => Math.max(s - 1, 1)) }

  function minimize() { setOpen(false) }
  function dismiss() {
    setOpen(false)
    setEverOpened(false)
    sessionStorage.setItem('tourPopupDone', '1')
  }

  function openPopup() {
    setEverOpened(true)
    setOpen(true)
  }

  const rooms = ROOM_MAP[data.property] || []

  async function handleSubmit() {
    if (!data.name || !data.email || !data.phone) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/schedule-tour', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: data.name,
          email: data.email,
          phone: data.phone,
          property: data.property,
          room: data.room,
          tourType: data.tourType,
          preferredDate: data.preferredDate,
          preferredTime: data.preferredTime,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to create booking link')
      setCalendlyLink(json.url)
      setDone(true)
      sessionStorage.setItem('tourPopupDone', '1')
    } catch (err) {
      console.error('Tour popup submit error:', err)
    } finally {
      setSubmitting(false)
    }
  }

  if (onContactPage) return null

  // ── Floating trigger button ─────────────────────────────────────────────────
  if (!open) {
    if (!everOpened) return null
    return (
      <button
        onClick={openPopup}
        className="fixed bottom-6 left-6 z-40 flex items-center gap-2.5 rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-xl transition-all hover:bg-slate-700 hover:shadow-2xl"
        aria-label="Schedule a tour"
      >
        <IconCalendar />
        Schedule a Tour
      </button>
    )
  }

  // ── Expanded popup ──────────────────────────────────────────────────────────
  return (
    <div className="fixed bottom-6 left-6 z-40 w-[400px] max-w-[calc(100vw-3rem)] overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-2xl">

      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <span className="text-sm font-semibold text-slate-700">Schedule a Tour</span>
        <div className="flex items-center gap-2">
          <button onClick={minimize} className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" aria-label="Minimize">
            <IconMinus />
          </button>
          <button onClick={dismiss} className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" aria-label="Close">
            <IconX />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="px-5 py-6">

        {done ? (
          // ── Success ────────────────────────────────────────────────────────
          <div className="py-4 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-teal-50">
              <IconCheck />
            </div>
            <p className="text-lg font-bold text-slate-900">You're almost set!</p>
            <p className="mt-1.5 text-sm text-slate-500">
              Pick an available time slot to confirm your tour.
            </p>
            <a
              href={calendlyLink}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-flex items-center gap-2 rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-700"
            >
              Pick a time <span aria-hidden>→</span>
            </a>
            <p className="mt-3 text-xs text-slate-400">You'll get a calendar invite after booking.</p>
          </div>
        ) : (
          <>
            {/* ── Step 1: Tour type ─────────────────────────────────────── */}
            {step === 1 && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Step 1 of {TOTAL_STEPS}</p>
                <h2 className="mt-2 text-xl font-bold text-slate-900">What type of tour?</h2>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <Choice label="In-Person" selected={data.tourType === 'in-person'} onClick={() => { set('tourType', 'in-person'); next() }} />
                  <Choice label="Live Virtual" selected={data.tourType === 'virtual'} onClick={() => { set('tourType', 'virtual'); next() }} />
                </div>
              </div>
            )}

            {/* ── Step 2: Property ──────────────────────────────────────── */}
            {step === 2 && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Step 2 of {TOTAL_STEPS}</p>
                <h2 className="mt-2 text-xl font-bold text-slate-900">Which property?</h2>
                <div className="mt-5 space-y-2.5">
                  {properties.map(p => (
                    <Choice key={p.slug} label={p.name} full selected={data.property === p.name} onClick={() => { set('property', p.name); set('room', ''); next() }} />
                  ))}
                </div>
              </div>
            )}

            {/* ── Step 3: Room ──────────────────────────────────────────── */}
            {step === 3 && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Step 3 of {TOTAL_STEPS}</p>
                <h2 className="mt-2 text-xl font-bold text-slate-900">Which room?</h2>
                <p className="mt-1 text-xs text-slate-400">{data.property}</p>
                <div className="mt-4 grid grid-cols-5 gap-2">
                  {rooms.map(r => (
                    <button key={r} type="button" onClick={() => { set('room', r); next() }}
                      className={`rounded-lg border-2 py-2.5 text-sm font-semibold transition-all ${data.room === r ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-400'}`}>
                      {r.replace('Room ', '')}
                    </button>
                  ))}
                  <button type="button" onClick={() => { set('room', 'Not sure yet'); next() }}
                    className={`col-span-5 rounded-lg border-2 py-2.5 text-sm font-semibold transition-all ${data.room === 'Not sure yet' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-400'}`}>
                    Not sure yet
                  </button>
                </div>
              </div>
            )}

            {/* ── Step 4: Date & time ───────────────────────────────────── */}
            {step === 4 && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Step 4 of {TOTAL_STEPS}</p>
                <h2 className="mt-2 text-xl font-bold text-slate-900">When works for you?</h2>
                <div className="mt-5 space-y-5">
                  <div>
                    <label className="mb-2 block text-[11px] font-semibold uppercase tracking-widest text-slate-400">Preferred Date</label>
                    <input type="date" min={todayIso()} value={data.preferredDate} onChange={e => set('preferredDate', e.target.value)} className={fieldCls} />
                  </div>
                  <div>
                    <label className="mb-2.5 block text-[11px] font-semibold uppercase tracking-widest text-slate-400">Preferred Time</label>
                    <div className="grid grid-cols-2 gap-2">
                      {TIME_SLOTS.map(s => (
                        <button key={s} type="button" onClick={() => set('preferredTime', s)}
                          className={`rounded-lg border py-2 text-xs font-semibold transition-all ${data.preferredTime === s ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-500 hover:border-slate-400'}`}>
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Step 5: Your info ─────────────────────────────────────── */}
            {step === 5 && (
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">Step 5 of {TOTAL_STEPS}</p>
                <h2 className="mt-2 text-xl font-bold text-slate-900">Your info</h2>
                <div className="mt-5 space-y-3.5">
                  <input
                    placeholder="Full name *"
                    value={data.name} onChange={e => set('name', e.target.value)}
                    className={fieldCls}
                  />
                  <input
                    type="email" placeholder="Email address *"
                    value={data.email} onChange={e => set('email', e.target.value)}
                    className={fieldCls}
                  />
                  <input
                    type="tel" placeholder="Phone number *"
                    value={data.phone} onChange={e => set('phone', e.target.value)}
                    className={fieldCls}
                  />
                </div>
              </div>
            )}

            {/* ── Progress + nav ────────────────────────────────────────── */}
            <div className="mt-7 flex items-center justify-between">
              {/* Dot progress */}
              <div className="flex gap-1.5">
                {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
                  <div key={i}
                    className={`h-1.5 rounded-full transition-all ${i < step ? 'w-4 bg-slate-900' : 'w-1.5 bg-slate-200'}`}
                  />
                ))}
              </div>

              {/* Nav buttons */}
              <div className="flex items-center gap-3">
                {step > 1 && (
                  <button type="button" onClick={back}
                    className="text-xs font-semibold text-slate-400 transition hover:text-slate-700">
                    ← Back
                  </button>
                )}
                {step === 4 && (
                  <button type="button" onClick={next}
                    className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-slate-700">
                    Continue
                  </button>
                )}
                {step === 5 && (
                  <button type="button" onClick={handleSubmit}
                    disabled={!data.name || !data.email || !data.phone || submitting}
                    className="rounded-full bg-slate-900 px-5 py-2 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:opacity-40">
                    {submitting ? 'Sending…' : 'Schedule →'}
                  </button>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-slate-50 px-5 py-2.5 text-center">
        <span className="text-[10px] text-slate-300">Axis Seattle · axis-seattle-housing.com</span>
      </div>
    </div>
  )
}

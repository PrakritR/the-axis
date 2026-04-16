import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { isInternalAxisRecordId } from '../lib/airtable'
import { dispatchAxisSchedulingChanged } from '../lib/portalCalendarSync.js'

function formatPhone(raw) {
  const digits = raw.replace(/\D/g, '').slice(0, 10)
  if (digits.length < 4) return digits
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

const FALLBACK_POPUP_PROPERTIES = [
  { id: '4709a', name: '4709A 8th Ave NE', address: '4709A 8th Ave NE, Seattle, WA', rooms: ['Room 1','Room 2','Room 3','Room 4','Room 5','Room 6','Room 7','Room 8','Room 9','Room 10'] },
  { id: '4709b', name: '4709B 8th Ave NE', address: '4709B 8th Ave NE, Seattle, WA', rooms: ['Room 1','Room 2','Room 3','Room 4','Room 5','Room 6','Room 7','Room 8','Room 9'] },
  { id: '5259',  name: '5259 Brooklyn Ave NE', address: '5259 Brooklyn Ave NE, Seattle, WA', rooms: ['Room 1','Room 2','Room 3','Room 4','Room 5','Room 6','Room 7','Room 8','Room 9'] },
]

const inputCls = 'w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-300 outline-none transition focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/10'

export default function TourPopup() {
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [everOpened, setEverOpened] = useState(false)
  const [step, setStep] = useState(1) // 1=tourType, 2=property, 3=room, 4=contact+schedule
  const [tourType, setTourType] = useState('in-person')
  const [propertyId, setPropertyId] = useState(null)
  const [room, setRoom] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [preferredDate, setPreferredDate] = useState('')
  const [preferredTime, setPreferredTime] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [popupProperties, setPopupProperties] = useState([])
  const [popupPropertiesLoading, setPopupPropertiesLoading] = useState(true)

  const onContactPage = location.pathname === '/contact'
  const selectedProperty = popupProperties.find((p) => p.id === propertyId)

  useEffect(() => {
    let cancelled = false
    fetch('/api/forms?action=tour')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        const mergeRooms = (list) =>
          list.map((p) => ({
            ...p,
            rooms: p.rooms?.length ? p.rooms : FALLBACK_POPUP_PROPERTIES.find((f) => f.id === p.id)?.rooms || [],
          }))
        if (Array.isArray(data?.properties)) {
          setPopupProperties(mergeRooms(data.properties))
          return
        }
        setPopupProperties([])
      })
      .catch(() => {
        if (!cancelled) setPopupProperties([])
      })
      .finally(() => {
        if (!cancelled) setPopupPropertiesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  function reset() {
    setStep(1); setTourType('in-person'); setPropertyId(null); setRoom('')
    setName(''); setEmail(''); setPhone(''); setPreferredDate(''); setPreferredTime('')
    setSubmitted(false); setSubmitError('')
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

  async function submitRequest() {
    setSubmitting(true)
    setSubmitError('')
    try {
      const res = await fetch('/api/forms?action=tour', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim(),
          type: 'Tour',
          property: selectedProperty?.name || '',
          room: room || '',
          tourFormat: tourType === 'virtual' ? 'Virtual' : 'In-Person',
          preferredDate,
          preferredTime,
          source: 'tour_popup',
          ...(propertyId && isInternalAxisRecordId(propertyId) ? { propertyId } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Submission failed.')
      dispatchAxisSchedulingChanged({ reason: 'tour-popup' })
      setSubmitted(true)
    } catch (err) {
      setSubmitError(err.message || 'Could not submit. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const todayStr = new Date().toISOString().split('T')[0]

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
    <div className="fixed bottom-6 left-6 z-40 w-[400px] max-w-[calc(100vw-3rem)] overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-2xl">

      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <div className="flex items-center gap-2.5">
          {step > 1 && !submitted && (
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

        {/* Success state */}
        {submitted && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-50">
              <svg className="h-6 w-6 text-[#2563eb]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="font-bold text-slate-900">Tour request sent!</p>
              <p className="mt-1 text-xs text-slate-500">We'll reach out to confirm within 1 business day</p>
            </div>
            <button onClick={() => { reset(); dismiss() }} className="mt-1 text-xs font-semibold text-[#2563eb] hover:underline">
              Close
            </button>
          </div>
        )}

        {/* Step 1: Tour type */}
        {!submitted && step === 1 && (
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
        {!submitted && step === 2 && (
          <div>
            <h2 className="text-xl font-bold text-slate-900">Which property?</h2>
            <div className="mt-5 space-y-2.5">
              {popupPropertiesLoading ? (
                <p className="text-sm text-slate-500">Loading properties…</p>
              ) : popupProperties.length === 0 ? (
                <p className="text-sm text-slate-500">No tour homes are available right now. Visit our contact page later or email us</p>
              ) : (
                popupProperties.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setPropertyId(p.id)
                      setRoom('')
                      setStep(3)
                    }}
                    className="group flex w-full items-center justify-between rounded-xl border border-slate-200 px-4 py-3.5 text-left transition-all hover:border-slate-900 hover:shadow-sm"
                  >
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{p.name}</div>
                      <div className="text-xs text-slate-400">{p.address}</div>
                    </div>
                    <svg className="h-4 w-4 text-slate-300 group-hover:text-slate-900" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* Step 3: Room */}
        {!submitted && step === 3 && selectedProperty && (
          <div>
            <h2 className="text-xl font-bold text-slate-900">Which room?</h2>
            <p className="mt-1 text-xs text-slate-400">{selectedProperty.name}</p>
            <div className="mt-4 grid grid-cols-5 gap-2">
              {(selectedProperty.rooms || []).map((r) => (
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

            {room && (
              <div className="mt-5">
                <button type="button" onClick={() => setStep(4)}
                  className="w-full rounded-full bg-slate-900 py-3 text-sm font-semibold text-white transition hover:bg-slate-700">
                  Continue →
                </button>
              </div>
            )}
          </div>
        )}

        {/* Step 4: Contact + scheduling */}
        {!submitted && step === 4 && (
          <div>
            <h2 className="text-xl font-bold text-slate-900">Your details</h2>
            <p className="mt-1 text-xs text-slate-400">We'll confirm your tour within 1 business day</p>
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Name <span className="text-red-400">*</span></label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Your full name" className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Email <span className="text-red-400">*</span></label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" className={inputCls} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Phone</label>
                <input type="tel" value={phone} onChange={e => setPhone(formatPhone(e.target.value))} placeholder="(206) 555-0100" className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Preferred Date</label>
                  <input type="date" min={todayStr} value={preferredDate} onChange={e => setPreferredDate(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Preferred Time</label>
                  <select value={preferredTime} onChange={e => setPreferredTime(e.target.value)} className={`${inputCls} appearance-none cursor-pointer`}>
                    <option value="">Flexible</option>
                    <option value="Morning (9am–12pm)">Morning</option>
                    <option value="Afternoon (12pm–5pm)">Afternoon</option>
                    <option value="Evening (5pm–8pm)">Evening</option>
                  </select>
                </div>
              </div>
            </div>

            {submitError && (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">{submitError}</div>
            )}

            <button
              type="button"
              disabled={!name.trim() || !email.trim() || submitting}
              onClick={submitRequest}
              className="mt-5 w-full rounded-full bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] py-3 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(37,99,235,0.2)] transition hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed">
              {submitting ? 'Sending…' : 'Request Tour →'}
            </button>
          </div>
        )}

        {/* Progress dots */}
        {!submitted && (
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
        )}
      </div>

      {/* Footer */}
      <div className="border-t border-slate-50 px-5 py-2.5 text-center">
        <span className="text-[10px] text-slate-300">
          Axis · {typeof window !== 'undefined' ? window.location.host : 'localhost'}
        </span>
      </div>
    </div>
  )
}

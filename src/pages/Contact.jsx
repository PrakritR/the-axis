import { useEffect, useState, useRef, useCallback } from 'react'

function formatPhone(raw) {
  const digits = raw.replace(/\D/g, '').slice(0, 10)
  if (digits.length < 4) return digits
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}
import { Seo } from '../lib/seo'
import { properties } from '../data/properties'

const CONTACT_PHONE_DISPLAY = '(510) 309-8345'
const CONTACT_PHONE_RAW = '15103098345'
const CONTACT_EMAIL = 'info@axis-seattle-housing.com'

// Calendly event URLs — create a second event type in Calendly for "Discussion"
const CALENDLY_TOUR_URL = 'https://calendly.com/ramachandranprakrit/30min'
const CALENDLY_MEETING_URL = 'https://calendly.com/ramachandranprakrit/30min' // replace with your "discussion" event URL

const CONTACT_TOPICS = [
  'Schedule a tour',
  'Current room availability',
  'Lease length and pricing',
  'Which home is the best fit',
]
const CONTACT_PROMISES = [
  ['Direct reply', 'Direct to leasing, not a general inbox.'],
  ['Fast routing', 'All inquiries routed to the right person.'],
  ['Clear follow-up', 'Room questions get room-specific answers.'],
]

const PROPERTIES = [
  { id: '4709a', name: '4709A 8th Ave', address: '4709A 8th Ave NE, Seattle, WA', rooms: ['Room 1','Room 2','Room 3','Room 4','Room 5','Room 6','Room 7','Room 8','Room 9','Room 10'] },
  { id: '4709b', name: '4709B 8th Ave', address: '4709B 8th Ave NE, Seattle, WA', rooms: ['Room 1','Room 2','Room 3','Room 4','Room 5','Room 6','Room 7','Room 8','Room 9'] },
  { id: '5259',  name: '5259 Brooklyn Ave NE', address: '5259 Brooklyn Ave NE, Seattle, WA', rooms: ['Room 1','Room 2','Room 3','Room 4','Room 5','Room 6','Room 7','Room 8','Room 9'] },
]

function CalendlyEmbed({ url }) {
  const containerRef = useRef(null)

  useEffect(() => {
    if (!document.querySelector('script[src*="calendly.com/assets/external/widget.js"]')) {
      const script = document.createElement('script')
      script.src = 'https://assets.calendly.com/assets/external/widget.js'
      script.async = true
      document.head.appendChild(script)
    }
    const init = () => {
      if (window.Calendly && containerRef.current) {
        containerRef.current.innerHTML = ''
        window.Calendly.initInlineWidget({
          url,
          parentElement: containerRef.current,
        })
      }
    }
    const script = document.querySelector('script[src*="calendly.com/assets/external/widget.js"]')
    if (window.Calendly) { init() }
    else { script?.addEventListener('load', init); return () => script?.removeEventListener('load', init) }
  }, [url])

  return (
    <div ref={containerRef} className="calendly-inline-widget" data-url={url} style={{ minWidth: '320px', height: 'min(700px, max(500px, calc(100dvh - 200px)))' }} />
  )
}

function BookingScheduler() {
  const [bookingType, setBookingType] = useState(null) // 'tour' | 'meeting'
  const [step, setStep] = useState(1)
  const [property, setProperty] = useState(null)
  const [room, setRoom] = useState('')
  const [tourType, setTourType] = useState('in-person')

  const selectedProperty = PROPERTIES.find(p => p.id === property)

  function reset() { setBookingType(null); setStep(1); setProperty(null); setRoom(''); setTourType('in-person') }

  // Build Calendly URL with all details formatted into the notes field
  function getCalendlyUrl() {
    const base = bookingType === 'meeting' ? CALENDLY_MEETING_URL : CALENDLY_TOUR_URL
    const enc = encodeURIComponent

    if (bookingType === 'meeting') {
      const notes = `Meeting Type: General Discussion with Leasing\nScheduled via Axis Seattle website`
      return `${base}?hide_gdpr_banner=1&primary_color=0f172a&a1=${enc(notes)}`
    }

    const format = tourType === 'in-person' ? 'In-Person' : 'Virtual'
    // Pack all tour details into a1 as a readable block — shows up in calendar event
    const notes = [
      `Property: ${selectedProperty?.name}`,
      `Address: ${selectedProperty?.address}`,
      `Room: ${room}`,
      `Tour Format: ${format}`,
      `Scheduled via Axis Seattle website`,
    ].join('\n')

    return `${base}?hide_gdpr_banner=1&primary_color=0f172a&a1=${enc(notes)}`
    // Note: phone pre-fill via &a2= requires a "Phone Number" custom question
    // to be added in Calendly event type settings → Invitee Questions
  }

  // Step 0: Choose booking type
  if (!bookingType) {
    return (
      <div>
        <div className="mb-6 border-b border-slate-100 pb-6">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-axis">Book time with leasing</div>
          <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-900">What do you need?</h2>
          <p className="mt-3 text-sm leading-7 text-slate-600">Choose a session type to get started.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <button
            onClick={() => setBookingType('tour')}
            className="group flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 text-left transition-all hover:border-slate-900 hover:shadow-sm"
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 transition-colors group-hover:bg-slate-900">
              <svg className="h-5 w-5 text-slate-600 transition-colors group-hover:text-white" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
              </svg>
            </div>
            <div>
              <div className="font-bold text-slate-900">Tour a Property</div>
              <p className="mt-1 text-sm leading-6 text-slate-500">Walk through a specific room at one of our properties. In-person or virtual.</p>
            </div>
            <div className="mt-auto flex items-center gap-1.5 text-xs font-semibold text-axis">
              Schedule tour
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>
            </div>
          </button>

          <button
            onClick={() => { setBookingType('meeting'); setStep(3) }}
            className="group flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 text-left transition-all hover:border-slate-900 hover:shadow-sm"
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 transition-colors group-hover:bg-slate-900">
              <svg className="h-5 w-5 text-slate-600 transition-colors group-hover:text-white" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
              </svg>
            </div>
            <div>
              <div className="font-bold text-slate-900">Discuss with Leasing</div>
              <p className="mt-1 text-sm leading-6 text-slate-500">Talk through options, pricing, lease terms, or anything else before deciding.</p>
            </div>
            <div className="mt-auto flex items-center gap-1.5 text-xs font-semibold text-axis">
              Book a meeting
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>
            </div>
          </button>
        </div>
      </div>
    )
  }

  // Tour flow — step indicator
  const tourSteps = [['1','Property'],['2','Room & Type'],['3','Pick a Time']]

  return (
    <div>
      <div className="mb-6 border-b border-slate-100 pb-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-axis">
              {bookingType === 'tour' ? 'Tour a property' : 'Discuss with leasing'}
            </div>
            <h2 className="mt-1.5 text-3xl font-black tracking-tight text-slate-900">
              {bookingType === 'meeting' ? 'Book a discussion' : step < 3 ? 'Select your room' : 'Pick a time'}
            </h2>
          </div>
          <button onClick={reset} className="text-xs font-semibold text-slate-400 hover:text-slate-700">← Back</button>
        </div>
      </div>

      {/* Step indicator for tours */}
      {bookingType === 'tour' && (
        <div className="mb-8 flex items-center gap-2">
          {tourSteps.map(([s, label], idx) => (
            <div key={s} className="flex items-center gap-1.5">
              <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-colors ${
                step > idx + 1 ? 'bg-teal-500 text-white' : step === idx + 1 ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-400'
              }`}>
                {step > idx + 1
                  ? <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>
                  : s}
              </div>
              <span className={`hidden text-xs font-medium sm:block ${step >= idx + 1 ? 'text-slate-700' : 'text-slate-400'}`}>{label}</span>
              {idx < 2 && <div className={`h-px w-4 shrink-0 sm:w-6 ${step > idx + 1 ? 'bg-teal-400' : 'bg-slate-200'}`} />}
            </div>
          ))}
        </div>
      )}

      {/* Step 1: Property */}
      {bookingType === 'tour' && step === 1 && (
        <div className="space-y-3">
          <div className="mb-4 text-sm font-semibold text-slate-700">Which property?</div>
          {PROPERTIES.map((p) => (
            <button key={p.id} onClick={() => { setProperty(p.id); setRoom(''); setStep(2) }}
              className="group flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4 text-left transition-all hover:border-slate-900 hover:shadow-sm">
              <div>
                <div className="font-semibold text-slate-900">{p.name}</div>
                <div className="mt-0.5 text-xs text-slate-500">{p.address}</div>
              </div>
              <svg className="h-4 w-4 text-slate-400 group-hover:text-slate-900" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>
            </button>
          ))}
        </div>
      )}

      {/* Step 2: Room + format */}
      {bookingType === 'tour' && step === 2 && selectedProperty && (
        <div className="space-y-6">
          <div>
            <div className="mb-3 text-sm font-semibold text-slate-700">Which room? <span className="font-normal text-slate-400">({selectedProperty.name})</span></div>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
              {selectedProperty.rooms.map((r) => (
                <button key={r} onClick={() => setRoom(r)}
                  className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition-all ${room === r ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'}`}>
                  {r}
                </button>
              ))}
              <button onClick={() => setRoom('Not sure yet')}
                className={`col-span-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition-all ${room === 'Not sure yet' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'}`}>
                Not sure yet
              </button>
            </div>
          </div>
          <div>
            <div className="mb-3 text-sm font-semibold text-slate-700">Tour format</div>
            <div className="flex gap-3">
              {[['in-person','In-Person','M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0zM15 11a3 3 0 11-6 0 3 3 0 016 0z'],['virtual','Virtual','M15 10l4.553-2.069A1 1 0 0121 8.867v6.266a1 1 0 01-1.447.902L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z']].map(([val, label, path]) => (
                <button key={val} onClick={() => setTourType(val)}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold transition-all ${tourType === val ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'}`}>
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d={path}/></svg>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setStep(1)} className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600 hover:border-slate-400">Back</button>
            <button onClick={() => setStep(3)} disabled={!room}
              className="rounded-full bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              Choose a Time
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Calendly */}
      {step === 3 && (
        <div>
          {bookingType === 'tour' && selectedProperty && (
            <div className="mb-4 flex items-center justify-between">
              <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-2.5 text-sm">
                <span className="font-semibold text-slate-900">{selectedProperty.name}</span>
                <span className="text-slate-300">·</span>
                <span className="text-slate-600">{room}</span>
                <span className="text-slate-300">·</span>
                <span className="text-slate-600">{tourType === 'in-person' ? 'In-Person' : 'Virtual'}</span>
              </div>
              <button onClick={() => setStep(2)} className="ml-2 shrink-0 text-xs font-semibold text-slate-400 hover:text-slate-700">Edit</button>
            </div>
          )}
          <CalendlyEmbed url={getCalendlyUrl()} />
        </div>
      )}
    </div>
  )
}

const AIRTABLE_BASE_ID = import.meta.env.VITE_AIRTABLE_BASE_ID || 'appNBX2inqfJMyqYV'
const AIRTABLE_INQUIRIES_TABLE = 'Inquiries'
const AIRTABLE_TOKEN = import.meta.env.VITE_AIRTABLE_TOKEN

const inputCls = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-axis focus:bg-white focus:ring-2 focus:ring-axis/20'
const selectCls = `${inputCls} appearance-none cursor-pointer`

const CONTACT_INQUIRY_TYPES = [
  'General',
  'Schedule a tour',
  'Current room availability',
  'Lease length and pricing',
  'Pricing & fees',
  'Application follow-up',
  'Other',
]

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10)
}

function ContactMessageForm() {
  const [form, setForm] = useState({ name: '', email: '', phone: '', property: '', topic: '', message: '' })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  function set(key, val) { setForm(prev => ({ ...prev, [key]: val })) }

  function buildMailto() {
    const body = [
      `Name: ${form.name}`,
      `Email: ${form.email}`,
      `Phone: ${form.phone || 'Not provided'}`,
      `Property interest: ${form.property || 'Not specified'}`,
      `Topic: ${form.topic || 'Not specified'}`,
      `Message:\n${form.message}`,
    ].join('\n')
    return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`Contact: ${form.name}`)}&body=${encodeURIComponent(body)}`
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    const fields = {
      'Full Name': form.name,
      'Email': form.email,
      'Phone Number': form.phone,
      'Property': form.property,
      'Inquiry Type': form.topic,
      'Message Summary': form.message,
    }
    try {
      const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_INQUIRIES_TABLE)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields, typecast: true }),
      })
      if (!res.ok) {
        const body = await res.text()
        let msg = `Airtable error ${res.status}`
        try { msg += ': ' + JSON.parse(body)?.error?.message } catch { msg += ': ' + body }
        throw new Error(msg)
      }
      setSubmitted(true)
    } catch (err) {
      console.error('Contact form error:', err)
      setError(err.message || 'Submission failed.')
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-teal-50">
          <svg className="h-7 w-7 text-axis" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div>
          <p className="text-lg font-black text-slate-900">Message sent!</p>
          <p className="mt-1 text-sm text-slate-500">We'll follow up with you at <strong>{form.email}</strong> within 2 business days.</p>
        </div>
        <button onClick={() => { setSubmitted(false); setForm({ name: '', email: '', phone: '', property: '', topic: '', message: '' }) }}
          className="mt-2 text-xs font-semibold text-axis hover:underline">Send another message</button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-slate-700">Name <span className="text-axis">*</span></label>
          <input required className={inputCls} placeholder="Jane Smith" value={form.name} onChange={e => set('name', e.target.value)} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-slate-700">Email <span className="text-axis">*</span></label>
          <input required type="email" className={inputCls} placeholder="jane@email.com" value={form.email} onChange={e => set('email', e.target.value)} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-slate-700">Phone Number <span className="text-axis">*</span></label>
          <input required type="tel" className={inputCls} placeholder="(206) 555-0100" value={form.phone} onChange={e => set('phone', formatPhone(e.target.value))} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-slate-700">Property <span className="text-axis">*</span></label>
          <select required className={selectCls} value={form.property} onChange={e => set('property', e.target.value)}>
            <option value="" disabled>Select a property…</option>
            {properties.map(p => <option key={p.slug} value={p.name}>{p.name}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-semibold text-slate-700">Inquiry Type <span className="text-axis">*</span></label>
        <select required className={selectCls} value={form.topic} onChange={e => set('topic', e.target.value)}>
          <option value="" disabled>Select an inquiry type…</option>
          {CONTACT_INQUIRY_TYPES.map((topic) => (
            <option key={topic} value={topic}>{topic}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1.5 block text-xs font-semibold text-slate-700">Message Summary <span className="text-axis">*</span></label>
        <textarea required className={`${inputCls} min-h-[110px] resize-y`} placeholder="Ask us anything about rooms, pricing, availability, or move-in dates…" value={form.message} onChange={e => set('message', e.target.value)} />
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 space-y-2">
          <p className="text-sm font-semibold text-red-700">Submission failed</p>
          <p className="font-mono text-xs text-red-600 break-all">{error}</p>
          <a href={buildMailto()} className="inline-block rounded-lg bg-red-700 px-4 py-2 text-xs font-semibold text-white hover:bg-red-800">
            Send via email instead
          </a>
        </div>
      )}

      <button type="submit" disabled={submitting}
        className="w-full rounded-full bg-slate-900 py-3.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed">
        {submitting ? 'Sending…' : 'Send message'}
      </button>
    </form>
  )
}

export default function Contact() {
  const [activeTab, setActiveTab] = useState('schedule')

  const tabs = [
    { id: 'schedule', label: 'Schedule a Tour', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
    { id: 'message', label: 'Send a Message', icon: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
  ]

  return (
    <div className="bg-[linear-gradient(180deg,#fcfcfa_0%,#ffffff_32%,#f8fafc_100%)]">
      <Seo
        title="Contact Axis Seattle | Tours and Housing Availability"
        description="Contact Axis Seattle to ask about room availability, schedule a tour, or learn more about affordable housing options in Seattle."
        pathname="/contact"
      />
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
        <section className="border-b border-slate-200 pb-10 lg:pb-14">
          <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">Contact Axis Seattle</div>
          <h1 className="font-editorial mt-4 text-[2rem] leading-[1.1] text-slate-900 sm:text-[3rem] sm:leading-[0.96] lg:text-[4.3rem]">
            Contact leasing directly.
          </h1>
        </section>

        <div className="mt-10 grid items-stretch gap-8 lg:grid-cols-[0.82fr_1.18fr]">
          {/* Left sidebar */}
          <div className="flex flex-col rounded-[28px] border border-slate-200 bg-stone-50 overflow-hidden">
            <div className="flex-1 p-6">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Best uses</div>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-900">What to send here</h2>
              <div className="mt-5 space-y-3">
                {['Questions about which room is actually available now','Tour requests for a specific property or room','Lease term, pricing, and move-in timing questions','Follow-up after viewing a listing on the site'].map((item) => (
                  <div key={item} className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                    <span className="mt-1 inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-axis" />
                    <div className="text-sm leading-6 text-slate-700">{item}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-slate-900 p-6 text-white">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-teal-200">Quick contact</div>
              <div className="mt-3 text-2xl font-black">Prefer a faster route?</div>
              <p className="mt-3 text-sm leading-7 text-slate-300">Know which room you want? Call or text.</p>
              <div className="mt-5 flex flex-col gap-3">
                <a href={`tel:${CONTACT_PHONE_RAW}`} className="rounded-full bg-white px-5 py-3 text-center text-sm font-semibold text-slate-900">Call {CONTACT_PHONE_DISPLAY}</a>
                <a href={`sms:${CONTACT_PHONE_RAW}`} className="rounded-full border border-white/15 bg-white/10 px-5 py-3 text-center text-sm font-semibold text-white">Text leasing</a>
              </div>
            </div>
          </div>

          {/* Right panel */}
          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-soft sm:p-8">
            {/* 3-tab switcher */}
            <div className="mb-8 flex gap-1 rounded-2xl border border-slate-100 bg-slate-50 p-1">
              {tabs.map(({ id, label, icon }) => (
                <button key={id} onClick={() => setActiveTab(id)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2.5 text-xs font-semibold transition-all sm:text-sm ${activeTab === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                  <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
                  </svg>
                  <span className="hidden sm:block">{label}</span>
                  <span className="sm:hidden">{label.split(' ')[0]}</span>
                </button>
              ))}
            </div>

            {activeTab === 'schedule' && <BookingScheduler />}
            {activeTab === 'message' && (
              <div>
                <div className="mb-6 border-b border-slate-100 pb-6">
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-axis">Send a message</div>
                  <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-900">Tell us what you need</h2>
                  <p className="mt-3 text-sm leading-7 text-slate-600">We'll follow up within 2 business days.</p>
                </div>
                <ContactMessageForm />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

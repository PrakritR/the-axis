import { useEffect, useState } from 'react'
import { Seo } from '../lib/seo'

const CONTACT_PHONE_DISPLAY = '(510) 309-8345'
const CONTACT_PHONE_RAW = '15103098345'
const CONTACT_EMAIL = 'info@axis-seattle-housing.com'
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

const GOOGLE_CALENDAR_BOOKING_URL = 'https://calendar.app.google/Vim4nAuCuhQvj4Rg9'

const PROPERTIES = [
  {
    id: '4709a',
    name: '4709A 8th Ave',
    address: '4709A 8th Ave NE, Seattle, WA',
    rooms: ['Room 1','Room 2','Room 3','Room 4','Room 5','Room 6','Room 7','Room 8','Room 9','Room 10'],
  },
  {
    id: '4709b',
    name: '4709B 8th Ave',
    address: '4709B 8th Ave NE, Seattle, WA',
    rooms: ['Room 1','Room 2','Room 3','Room 4','Room 5','Room 6','Room 7','Room 8','Room 9'],
  },
  {
    id: '5259',
    name: '5259 Brooklyn Ave NE',
    address: '5259 Brooklyn Ave NE, Seattle, WA',
    rooms: ['Room 1','Room 2','Room 3','Room 4','Room 5','Room 6','Room 7','Room 8','Room 9'],
  },
]

function TourScheduler() {
  const [step, setStep] = useState(1)
  const [property, setProperty] = useState(null)
  const [room, setRoom] = useState('')
  const [tourType, setTourType] = useState('in-person')

  const selectedProperty = PROPERTIES.find(p => p.id === property)

  function handlePropertySelect(id) {
    setProperty(id)
    setRoom('')
    setStep(2)
  }

  function handleBack() {
    if (step === 2) { setStep(1); setProperty(null); setRoom('') }
    if (step === 3) setStep(2)
  }

  function handleContinue() {
    setStep(3)
  }

  function handleBook() {
    window.open(GOOGLE_CALENDAR_BOOKING_URL, '_blank', 'noopener,noreferrer')
  }

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 border-b border-slate-100 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-axis">Book a tour</div>
          <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-900">Pick a time that works</h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
            Tell us which property and room you'd like to see, then pick a time.
          </p>
        </div>
        <div className="rounded-2xl border border-teal-100 bg-teal-50 px-4 py-3 text-sm text-teal-900">
          In-person &amp; virtual tours available.
        </div>
      </div>

      {/* Step indicator */}
      <div className="mb-8 flex items-center gap-2">
        {[1, 2, 3].map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-colors ${
              step >= s ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-400'
            }`}>{s}</div>
            <span className={`text-xs font-medium ${step >= s ? 'text-slate-700' : 'text-slate-400'}`}>
              {s === 1 ? 'Property' : s === 2 ? 'Room & Type' : 'Confirm'}
            </span>
            {s < 3 && <div className={`h-px w-8 ${step > s ? 'bg-slate-900' : 'bg-slate-200'}`} />}
          </div>
        ))}
      </div>

      {/* Step 1: Property */}
      {step === 1 && (
        <div>
          <div className="mb-4 text-sm font-semibold text-slate-700">Which property would you like to tour?</div>
          <div className="space-y-3">
            {PROPERTIES.map((p) => (
              <button
                key={p.id}
                onClick={() => handlePropertySelect(p.id)}
                className="group flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4 text-left transition-all hover:border-slate-900 hover:shadow-sm"
              >
                <div>
                  <div className="font-semibold text-slate-900">{p.name}</div>
                  <div className="mt-0.5 text-xs text-slate-500">{p.address}</div>
                </div>
                <svg className="h-4 w-4 text-slate-400 transition-colors group-hover:text-slate-900" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 2: Room + Tour type */}
      {step === 2 && selectedProperty && (
        <div className="space-y-6">
          <div>
            <div className="mb-3 text-sm font-semibold text-slate-700">Which room are you interested in?</div>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
              {selectedProperty.rooms.map((r) => (
                <button
                  key={r}
                  onClick={() => setRoom(r)}
                  className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition-all ${
                    room === r
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'
                  }`}
                >
                  {r}
                </button>
              ))}
              <button
                onClick={() => setRoom("Not sure yet")}
                className={`col-span-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition-all ${
                  room === 'Not sure yet'
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'
                }`}
              >
                Not sure yet
              </button>
            </div>
          </div>

          <div>
            <div className="mb-3 text-sm font-semibold text-slate-700">Tour format</div>
            <div className="flex gap-3">
              <button
                onClick={() => setTourType('in-person')}
                className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold transition-all ${
                  tourType === 'in-person'
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'
                }`}
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                In-Person
              </button>
              <button
                onClick={() => setTourType('virtual')}
                className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold transition-all ${
                  tourType === 'virtual'
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'
                }`}
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.069A1 1 0 0121 8.867v6.266a1 1 0 01-1.447.902L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Virtual
              </button>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={handleBack} className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600 hover:border-slate-400">
              Back
            </button>
            <button
              onClick={handleContinue}
              disabled={!room}
              className="rounded-full bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Confirm + Book */}
      {step === 3 && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-100 bg-slate-50 p-5 space-y-4">
            <div className="text-sm font-semibold text-slate-700">Your tour request</div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Property</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{selectedProperty?.name}</div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Room</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">{room}</div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Format</div>
                <div className="mt-1 text-sm font-semibold text-slate-900 capitalize">{tourType === 'in-person' ? 'In-Person' : 'Virtual'}</div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-teal-100 bg-teal-50 px-5 py-4 text-sm leading-6 text-teal-800">
            Next, pick a date and time on Google Calendar. When you book, mention <span className="font-semibold">{selectedProperty?.name} — {room} ({tourType === 'in-person' ? 'In-Person' : 'Virtual'})</span> in the notes so we're prepared.
          </div>

          <div className="flex gap-3">
            <button onClick={handleBack} className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600 hover:border-slate-400">
              Back
            </button>
            <button
              onClick={handleBook}
              className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-7 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 transition-colors"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Pick a Time on Google Calendar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Contact(){
  const [activeTab, setActiveTab] = useState('tour')

  useEffect(() => {
    const script = document.createElement('script')
    script.src = 'https://www.cognitoforms.com/f/iframe.js'
    script.async = true
    document.body.appendChild(script)
    return () => document.body.removeChild(script)
  }, [])

  return (
    <div className="bg-[linear-gradient(180deg,#fcfcfa_0%,#ffffff_32%,#f8fafc_100%)]">
      <Seo
        title="Contact Axis Seattle | Tours and Housing Availability"
        description="Contact Axis Seattle to ask about room availability, schedule a tour, or learn more about affordable housing options in Seattle."
        pathname="/contact"
      />
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
        <section className="grid gap-8 border-b border-slate-200 pb-10 lg:grid-cols-[minmax(0,1.15fr)_320px] lg:pb-14">
          <div className="max-w-4xl">
            <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">Contact Axis Seattle</div>
            <h1 className="font-editorial mt-4 text-[2rem] leading-[1.1] text-slate-900 sm:text-[3rem] sm:leading-[0.96] lg:text-[4.3rem]">
              Contact leasing directly.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
              Ask about availability, schedule a tour, or get help choosing a property.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <a href={`tel:${CONTACT_PHONE_RAW}`} className="rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-800">
                Call now
              </a>
              <a href={`sms:${CONTACT_PHONE_RAW}`} className="rounded-full border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:border-slate-500">
                Text now
              </a>
              <a href={`mailto:${CONTACT_EMAIL}`} className="rounded-full border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:border-slate-500">
                Email direct
              </a>
            </div>

            <div className="mt-10 grid gap-4 border-t border-slate-200 pt-6 sm:grid-cols-4">
              {CONTACT_TOPICS.map((topic) => (
                <div key={topic}>
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Common request</div>
                  <div className="mt-2 text-base font-semibold text-slate-900">{topic}</div>
                </div>
              ))}
            </div>
          </div>

          <aside className="flex flex-col justify-between border-t border-slate-200 pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-1">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Reach us directly</div>
              <a href={`tel:${CONTACT_PHONE_RAW}`} className="mt-3 block text-2xl font-black text-slate-900 hover:text-axis">
                {CONTACT_PHONE_DISPLAY}
              </a>
              <a href={`mailto:${CONTACT_EMAIL}`} className="mt-2 block break-all text-sm leading-7 text-slate-600 hover:text-axis">
                {CONTACT_EMAIL}
              </a>
            </div>
            <div className="mt-8 space-y-4">
              {CONTACT_PROMISES.map(([title, text]) => (
                <div key={title} className="border-t border-slate-200 pt-4">
                  <div className="text-sm font-semibold text-slate-900">{title}</div>
                  <div className="mt-1 text-sm leading-6 text-slate-600">{text}</div>
                </div>
              ))}
            </div>
          </aside>
        </section>

        <div className="mt-10 grid gap-8 lg:grid-cols-[0.82fr_1.18fr]">
          <div className="space-y-5">
            <div className="rounded-[24px] border border-slate-200 bg-stone-50 p-6">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Best uses</div>
              <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-900">What to send here</h2>
              <div className="mt-5 space-y-3">
                {[
                  'Questions about which room is actually available now',
                  'Tour requests for a specific property or room',
                  'Lease term, pricing, and move-in timing questions',
                  'Follow-up after viewing a listing on the site',
                ].map((item) => (
                  <div key={item} className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                    <span className="mt-1 inline-flex h-2.5 w-2.5 rounded-full bg-axis" />
                    <div className="text-sm leading-6 text-slate-700">{item}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[24px] border border-slate-200 bg-slate-900 p-6 text-white">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-teal-200">Quick contact</div>
              <div className="mt-3 text-2xl font-black">Prefer a faster route?</div>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                Know which room you want? Call or text.
              </p>
              <div className="mt-5 flex flex-col gap-3">
                <a href={`tel:${CONTACT_PHONE_RAW}`} className="rounded-full bg-white px-5 py-3 text-center text-sm font-semibold text-slate-900">
                  Call {CONTACT_PHONE_DISPLAY}
                </a>
                <a href={`sms:${CONTACT_PHONE_RAW}`} className="rounded-full border border-white/15 bg-white/10 px-5 py-3 text-center text-sm font-semibold text-white">
                  Text leasing
                </a>
              </div>
            </div>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-soft sm:p-8">
            {/* Tab switcher */}
            <div className="mb-8 flex gap-1 rounded-2xl border border-slate-100 bg-slate-50 p-1">
              <button
                onClick={() => setActiveTab('tour')}
                className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all ${
                  activeTab === 'tour'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Schedule a Tour
              </button>
              <button
                onClick={() => setActiveTab('message')}
                className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all ${
                  activeTab === 'message'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                Send a Message
              </button>
            </div>

            {activeTab === 'tour' ? (
              <TourScheduler />
            ) : (
              <div>
                <div className="mb-6 flex flex-col gap-4 border-b border-slate-100 pb-6 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-axis">Send a message</div>
                    <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-900">Tell us what you need</h2>
                    <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
                      Tell us what you need and we'll follow up.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-teal-100 bg-teal-50 px-4 py-3 text-sm text-teal-900">
                    Best for tour requests and availability questions.
                  </div>
                </div>
                <iframe
                  src="https://www.cognitoforms.com/f/zIns1FUelkCIZ-tnBbSN-Q/1"
                  allow="payment"
                  style={{ border: 0, width: '100%' }}
                  height="901"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

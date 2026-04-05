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

const PROPERTIES = [
  { id: '4709a', name: '4709A 8th Ave', address: '4709A 8th Ave NE, Seattle, WA', rooms: ['Room 1','Room 2','Room 3','Room 4','Room 5','Room 6','Room 7','Room 8','Room 9','Room 10'] },
  { id: '4709b', name: '4709B 8th Ave', address: '4709B 8th Ave NE, Seattle, WA', rooms: ['Room 1','Room 2','Room 3','Room 4','Room 5','Room 6','Room 7','Room 8','Room 9'] },
  { id: '5259',  name: '5259 Brooklyn Ave NE', address: '5259 Brooklyn Ave NE, Seattle, WA', rooms: ['Room 1','Room 2','Room 3','Room 4','Room 5','Room 6','Room 7','Room 8','Room 9'] },
]

const TIME_SLOTS = ['9:00 AM','10:00 AM','11:00 AM','12:00 PM','1:00 PM','2:00 PM','3:00 PM','4:00 PM','5:00 PM']

const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

function MiniCalendar({ selected, onSelect }) {
  const today = new Date()
  today.setHours(0,0,0,0)
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())

  const firstDay = new Date(viewYear, viewMonth, 1).getDay()
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1) }
    else setViewMonth(m => m - 1)
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1) }
    else setViewMonth(m => m + 1)
  }

  const cells = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  return (
    <div className="w-full">
      <div className="mb-3 flex items-center justify-between">
        <button onClick={prevMonth} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/></svg>
        </button>
        <span className="text-sm font-semibold text-slate-900">{MONTHS[viewMonth]} {viewYear}</span>
        <button onClick={nextMonth} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {DAYS.map(d => (
          <div key={d} className="py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{d}</div>
        ))}
        {cells.map((day, i) => {
          if (!day) return <div key={`e${i}`} />
          const date = new Date(viewYear, viewMonth, day)
          const isPast = date < today
          const isWeekend = date.getDay() === 0 || date.getDay() === 6
          const isDisabled = isPast || isWeekend
          const selDate = selected ? new Date(selected) : null
          const isSelected = selDate && selDate.getFullYear() === viewYear && selDate.getMonth() === viewMonth && selDate.getDate() === day
          return (
            <button
              key={day}
              disabled={isDisabled}
              onClick={() => onSelect(new Date(viewYear, viewMonth, day))}
              className={`rounded-lg py-1.5 text-sm transition-all ${
                isSelected
                  ? 'bg-slate-900 font-semibold text-white'
                  : isDisabled
                  ? 'cursor-not-allowed text-slate-300'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              {day}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function TourScheduler() {
  const [step, setStep] = useState(1)
  const [property, setProperty] = useState(null)
  const [room, setRoom] = useState('')
  const [tourType, setTourType] = useState('in-person')
  const [date, setDate] = useState(null)
  const [time, setTime] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [submitted, setSubmitted] = useState(false)

  const selectedProperty = PROPERTIES.find(p => p.id === property)

  function formatDate(d) {
    if (!d) return ''
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  }

  function handleSubmit() {
    const subject = encodeURIComponent(`Tour Request — ${selectedProperty.name} ${room} (${tourType === 'in-person' ? 'In-Person' : 'Virtual'})`)
    const body = encodeURIComponent(
`Tour Request Details
====================
Property: ${selectedProperty.name}
Address:  ${selectedProperty.address}
Room:     ${room}
Format:   ${tourType === 'in-person' ? 'In-Person' : 'Virtual'}
Date:     ${formatDate(date)}
Time:     ${time}

Contact
-------
Name:  ${name}
Email: ${email}
Phone: ${phone || 'Not provided'}
`
    )
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`
    setSubmitted(true)
  }

  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center gap-5 py-12 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-teal-50">
          <svg className="h-8 w-8 text-teal-600" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        </div>
        <div>
          <div className="text-xl font-black text-slate-900">Request sent!</div>
          <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">
            We'll confirm your {tourType === 'in-person' ? 'in-person' : 'virtual'} tour of {selectedProperty?.name} — {room} on {formatDate(date)} at {time}.
          </p>
        </div>
        <button
          onClick={() => { setStep(1); setProperty(null); setRoom(''); setDate(null); setTime(''); setName(''); setEmail(''); setPhone(''); setSubmitted(false) }}
          className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:border-slate-400"
        >
          Book another tour
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 border-b border-slate-100 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-axis">Book a tour</div>
          <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-900">Pick a time that works</h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
            Select your property, room, and a time — we'll confirm directly.
          </p>
        </div>
        <div className="shrink-0 rounded-2xl border border-teal-100 bg-teal-50 px-4 py-3 text-sm text-teal-900">
          In-person &amp; virtual available.
        </div>
      </div>

      {/* Step indicator */}
      <div className="mb-8 flex items-center gap-2">
        {[['1','Property'],['2','Room & Type'],['3','Date & Time'],['4','Your Info']].map(([s, label], idx) => (
          <div key={s} className="flex items-center gap-1.5">
            <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-colors ${
              step > idx + 1 ? 'bg-teal-500 text-white' : step === idx + 1 ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-400'
            }`}>
              {step > idx + 1
                ? <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>
                : s}
            </div>
            <span className={`hidden text-xs font-medium sm:block ${step >= idx + 1 ? 'text-slate-700' : 'text-slate-400'}`}>{label}</span>
            {idx < 3 && <div className={`h-px w-4 shrink-0 sm:w-6 ${step > idx + 1 ? 'bg-teal-400' : 'bg-slate-200'}`} />}
          </div>
        ))}
      </div>

      {/* Step 1: Property */}
      {step === 1 && (
        <div className="space-y-3">
          <div className="mb-4 text-sm font-semibold text-slate-700">Which property would you like to tour?</div>
          {PROPERTIES.map((p) => (
            <button
              key={p.id}
              onClick={() => { setProperty(p.id); setRoom(''); setStep(2) }}
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
      )}

      {/* Step 2: Room + Tour type */}
      {step === 2 && selectedProperty && (
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
            <button onClick={() => { setStep(1); setProperty(null); setRoom('') }} className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600 hover:border-slate-400">Back</button>
            <button onClick={() => setStep(3)} disabled={!room} className="rounded-full bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Continue</button>
          </div>
        </div>
      )}

      {/* Step 3: Date + Time */}
      {step === 3 && (
        <div className="space-y-6">
          <div className="grid gap-6 sm:grid-cols-2">
            <div>
              <div className="mb-3 text-sm font-semibold text-slate-700">Select a date</div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <MiniCalendar selected={date} onSelect={setDate} />
              </div>
            </div>
            <div>
              <div className="mb-3 text-sm font-semibold text-slate-700">
                {date ? `Available times — ${date.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}` : 'Select a date first'}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {TIME_SLOTS.map((t) => (
                  <button key={t} disabled={!date} onClick={() => setTime(t)}
                    className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-30 ${time === t ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'}`}>
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={() => setStep(2)} className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600 hover:border-slate-400">Back</button>
            <button onClick={() => setStep(4)} disabled={!date || !time} className="rounded-full bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Continue</button>
          </div>
        </div>
      )}

      {/* Step 4: Contact info */}
      {step === 4 && (
        <div className="space-y-5">
          <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
              {[['Property', selectedProperty?.name],['Room', room],['Format', tourType === 'in-person' ? 'In-Person' : 'Virtual'],['Time', `${formatDate(date).split(',')[0]}, ${time}`]].map(([label, val]) => (
                <div key={label}>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</div>
                  <div className="mt-0.5 font-semibold text-slate-900">{val}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">Full name <span className="text-red-500">*</span></label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">Email <span className="text-red-500">*</span></label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@email.com" className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-semibold text-slate-700">Phone <span className="text-slate-400 font-normal">(optional)</span></label>
              <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="(555) 000-0000" className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10" />
            </div>
          </div>

          <div className="flex gap-3 pt-1">
            <button onClick={() => setStep(3)} className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600 hover:border-slate-400">Back</button>
            <button
              onClick={handleSubmit}
              disabled={!name || !email}
              className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-7 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
              Request This Tour
            </button>
          </div>
        </div>
      )}
    </div>
  )

  function formatDate(d) {
    if (!d) return ''
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  }
}

export default function Contact(){
  const [activeTab, setActiveTab] = useState('tour')

  useEffect(() => {
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
              <a href={`tel:${CONTACT_PHONE_RAW}`} className="rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-800">Call now</a>
              <a href={`sms:${CONTACT_PHONE_RAW}`} className="rounded-full border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:border-slate-500">Text now</a>
              <a href={`mailto:${CONTACT_EMAIL}`} className="rounded-full border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:border-slate-500">Email direct</a>
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
              <a href={`tel:${CONTACT_PHONE_RAW}`} className="mt-3 block text-2xl font-black text-slate-900 hover:text-axis">{CONTACT_PHONE_DISPLAY}</a>
              <a href={`mailto:${CONTACT_EMAIL}`} className="mt-2 block break-all text-sm leading-7 text-slate-600 hover:text-axis">{CONTACT_EMAIL}</a>
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
                {['Questions about which room is actually available now','Tour requests for a specific property or room','Lease term, pricing, and move-in timing questions','Follow-up after viewing a listing on the site'].map((item) => (
                  <div key={item} className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                    <span className="mt-1 inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-axis" />
                    <div className="text-sm leading-6 text-slate-700">{item}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[24px] border border-slate-200 bg-slate-900 p-6 text-white">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-teal-200">Quick contact</div>
              <div className="mt-3 text-2xl font-black">Prefer a faster route?</div>
              <p className="mt-3 text-sm leading-7 text-slate-300">Know which room you want? Call or text.</p>
              <div className="mt-5 flex flex-col gap-3">
                <a href={`tel:${CONTACT_PHONE_RAW}`} className="rounded-full bg-white px-5 py-3 text-center text-sm font-semibold text-slate-900">Call {CONTACT_PHONE_DISPLAY}</a>
                <a href={`sms:${CONTACT_PHONE_RAW}`} className="rounded-full border border-white/15 bg-white/10 px-5 py-3 text-center text-sm font-semibold text-white">Text leasing</a>
              </div>
            </div>
          </div>

          <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-soft sm:p-8">
            <div className="mb-8 flex gap-1 rounded-2xl border border-slate-100 bg-slate-50 p-1">
              <button onClick={() => setActiveTab('tour')}
                className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all ${activeTab === 'tour' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                Schedule a Tour
              </button>
              <button onClick={() => setActiveTab('message')}
                className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all ${activeTab === 'message' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
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
                    <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">Tell us what you need and we'll follow up.</p>
                  </div>
                  <div className="rounded-2xl border border-teal-100 bg-teal-50 px-4 py-3 text-sm text-teal-900">Best for tour requests and availability questions.</div>
                </div>
                <iframe
                  className="airtable-embed"
                  src="https://airtable.com/embed/appNBX2inqfJMyqYV/pagjUTobVZF3ZwGl7/form"
                  width="100%"
                  height="533"
                  style={{ background: 'transparent', border: '1px solid #ccc', borderRadius: '16px' }}
                />

              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

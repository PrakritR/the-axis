import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Seo } from '../lib/seo'

function formatPhone(raw) {
  const digits = raw.replace(/\D/g, '').slice(0, 10)
  if (digits.length < 4) return digits
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

// Parses "Mon: 9:00 AM, 10:30 AM; Tue: 3:00 PM" → { Mon: ['9:00 AM', '10:30 AM'], Tue: ['3:00 PM'] }
function parseTourCalendar(raw) {
  const result = {}
  String(raw || '')
    .split(/[;\n]/)
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((line) => {
      const m = line.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s*[:\-]\s*(.+)$/i)
      if (!m) return
      const day = m[1].slice(0, 1).toUpperCase() + m[1].slice(1, 3).toLowerCase()
      result[day] = m[2].split(',').map((s) => s.trim()).filter(Boolean)
    })
  return result
}

// Returns array of {date, display, dayName, slots} for the next `daysAhead` days that have slots
function getUpcomingDates(daySlotMap, daysAhead = 28) {
  const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dates = []
  for (let i = 0; i < daysAhead; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    const dayName = DAY_ABBR[d.getDay()]
    const slots = daySlotMap[dayName] || []
    if (slots.length) {
      dates.push({
        date: d.toISOString().split('T')[0],
        display: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
        shortDate: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        dayAbbr: d.toLocaleDateString('en-US', { weekday: 'short' }),
        dayName,
        slots,
      })
    }
  }
  return dates
}

const AIRTABLE_BASE_ID = import.meta.env.VITE_AIRTABLE_BASE_ID || 'appNBX2inqfJMyqYV'
const AIRTABLE_TOKEN   = import.meta.env.VITE_AIRTABLE_TOKEN

const inputCls  = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-axis focus:bg-white focus:ring-2 focus:ring-axis/20'
const selectCls = `${inputCls} appearance-none cursor-pointer`

const DEFAULT_PROPERTIES = [
  { id: '4709a', name: '4709A 8th Ave', address: '4709A 8th Ave NE, Seattle, WA', rooms: ['Room 1','Room 2','Room 3','Room 4','Room 5','Room 6','Room 7','Room 8','Room 9','Room 10'] },
  { id: '4709b', name: '4709B 8th Ave', address: '4709B 8th Ave NE, Seattle, WA', rooms: ['Room 1','Room 2','Room 3','Room 4','Room 5','Room 6','Room 7','Room 8','Room 9'] },
  { id: '5259',  name: '5259 Brooklyn Ave NE', address: '5259 Brooklyn Ave NE, Seattle, WA', rooms: ['Room 1','Room 2','Room 3','Room 4','Room 5','Room 6','Room 7','Room 8','Room 9'] },
]

const DEFAULT_CALENDAR = {
  Mon: ['9:00 AM', '1:30 PM', '4:30 PM'],
  Tue: ['10:30 AM', '3:00 PM'],
  Wed: ['9:00 AM', '12:00 PM', '6:00 PM'],
  Thu: ['10:30 AM', '1:30 PM', '4:30 PM'],
  Fri: ['9:00 AM', '12:00 PM', '3:00 PM'],
  Sat: ['10:30 AM', '1:30 PM'],
}

// ── Shared ────────────────────────────────────────────────────────────────────

function SuccessCard({ title, body, onReset, resetLabel = 'Submit another' }) {
  return (
    <div className="flex flex-col items-center gap-4 py-12 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-50">
        <svg className="h-7 w-7 text-axis" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <div>
        <p className="text-lg font-black text-slate-900">{title}</p>
        <p className="mt-1 text-sm text-slate-500">{body}</p>
      </div>
      <button onClick={onReset} className="mt-2 text-xs font-semibold text-axis hover:underline">{resetLabel}</button>
    </div>
  )
}

function DateCalendar({ availableDates, selectedDate, onSelectDate }) {
  if (!availableDates.length) {
    return <p className="text-sm text-slate-400 italic">No availability found. We'll coordinate a time after you submit.</p>
  }
  return (
    <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {availableDates.map(({ date, dayAbbr, shortDate }) => {
        const isSelected = selectedDate === date
        return (
          <button
            key={date}
            type="button"
            onClick={() => onSelectDate(date)}
            className={`flex flex-col items-center rounded-2xl border px-3 py-3 text-center transition-all ${isSelected ? 'border-[#2563eb] bg-[#2563eb] text-white shadow-[0_12px_24px_rgba(37,99,235,0.18)]' : 'border-slate-200 bg-white text-slate-700 hover:border-[#2563eb]'}`}
          >
            <span className={`text-[10px] font-bold uppercase tracking-wide ${isSelected ? 'text-white/80' : 'text-slate-400'}`}>{dayAbbr}</span>
            <span className="text-sm font-semibold">{shortDate}</span>
          </button>
        )
      })}
    </div>
  )
}

function TimeSlots({ slots, selectedTime, onSelectTime }) {
  return (
    <div className="flex flex-wrap gap-2">
      {slots.map((slot) => {
        const isSelected = selectedTime === slot
        return (
          <button
            key={slot}
            type="button"
            onClick={() => onSelectTime(slot)}
            className={`rounded-full border px-4 py-2 text-sm font-semibold transition-all ${isSelected ? 'border-[#2563eb] bg-[#2563eb] text-white' : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-[#2563eb] hover:text-[#2563eb]'}`}
          >
            {slot}
          </button>
        )
      })}
    </div>
  )
}

function ContactFields({ form, setField }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-slate-700">Name <span className="text-axis">*</span></label>
          <input required className={inputCls} placeholder="Jane Smith" value={form.name} onChange={e => setField('name', e.target.value)} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-slate-700">Email <span className="text-axis">*</span></label>
          <input required type="email" className={inputCls} placeholder="jane@email.com" value={form.email} onChange={e => setField('email', e.target.value)} />
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-semibold text-slate-700">Phone</label>
        <input type="tel" className={inputCls} placeholder="(206) 555-0100" value={form.phone} onChange={e => setField('phone', formatPhone(e.target.value))} />
      </div>
    </div>
  )
}

// ── Housing scheduler ─────────────────────────────────────────────────────────

function HousingScheduler() {
  const [step, setStep] = useState(1)
  const [property, setProperty] = useState(null)
  const [room, setRoom] = useState('')
  const [tourType, setTourType] = useState('in-person')
  const [properties, setProperties] = useState(DEFAULT_PROPERTIES)
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedTime, setSelectedTime] = useState('')
  const [form, setFormState] = useState({ name: '', email: '', phone: '', notes: '' })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const selectedProperty = properties.find(p => p.id === property)
  const daySlotMap = selectedProperty
    ? (() => {
        const parsed = parseTourCalendar(selectedProperty.availability)
        return Object.keys(DEFAULT_CALENDAR).reduce((acc, day) => {
          acc[day] = parsed[day]?.length ? parsed[day] : DEFAULT_CALENDAR[day]
          return acc
        }, {})
      })()
    : DEFAULT_CALENDAR
  const availableDates = getUpcomingDates(daySlotMap)
  const selectedDateEntry = availableDates.find(d => d.date === selectedDate)
  const currentSlots = selectedDateEntry?.slots || []

  function setField(k, v) { setFormState(prev => ({ ...prev, [k]: v })) }
  function reset() {
    setStep(1); setProperty(null); setRoom(''); setTourType('in-person')
    setSelectedDate(''); setSelectedTime('')
    setFormState({ name: '', email: '', phone: '', notes: '' })
    setSubmitted(false); setSubmitError('')
  }

  useEffect(() => {
    let cancelled = false
    fetch('/api/tour')
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        const next = Array.isArray(data?.properties) && data.properties.length ? data.properties : DEFAULT_PROPERTIES
        setProperties(next.map(p => ({ ...p, rooms: p.rooms || DEFAULT_PROPERTIES.find(f => f.id === p.id)?.rooms || [] })))
      })
      .catch(() => { if (!cancelled) setProperties(DEFAULT_PROPERTIES) })
    return () => { cancelled = true }
  }, [])

  async function handleSchedule() {
    setSubmitting(true); setSubmitError('')
    try {
      const res = await fetch('/api/tour', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim(),
          type: 'Tour',
          property: selectedProperty?.name || '', room: room || '',
          tourFormat: tourType === 'virtual' ? 'Virtual' : 'In-Person',
          manager: selectedProperty?.manager || '',
          preferredDate: selectedDate, preferredTime: selectedTime,
          notes: form.notes.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Submission failed.')
      setSubmitted(true)
    } catch (err) {
      setSubmitError(err.message || 'Could not submit. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) return (
    <SuccessCard
      title="Tour request sent!"
      body={`We'll reach out to ${form.email} to confirm within 1 business day.`}
      onReset={reset}
    />
  )

  const tourSteps = [['1','Property'],['2','Date & Room'],['3','Your Details']]

  return (
    <div>
      <div className="mb-8">
        <h2 className="text-3xl font-black tracking-tight text-slate-900">Contact manager</h2>
        <p className="mt-2 text-sm text-slate-500">Choose a property, pick an open time, and we will send your request to that property manager.</p>
      </div>

      <div className="mb-8 flex items-center gap-2">
        {tourSteps.map(([s, label], idx) => (
          <div key={s} className="flex items-center gap-1.5">
            <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-colors ${step > idx + 1 ? 'bg-[#2563eb] text-white' : step === idx + 1 ? 'bg-[#2563eb] text-white' : 'bg-slate-100 text-slate-400'}`}>
              {step > idx + 1 ? <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg> : s}
            </div>
            <span className={`hidden text-xs font-medium sm:block ${step >= idx + 1 ? 'text-slate-700' : 'text-slate-400'}`}>{label}</span>
            {idx < 2 && <div className={`h-px w-4 shrink-0 sm:w-6 ${step > idx + 1 ? 'bg-[#2563eb]' : 'bg-slate-200'}`} />}
          </div>
        ))}
      </div>

      {/* Step 1: Choose property */}
      {step === 1 && (
        <div className="space-y-3">
          {properties.map((p) => (
            <button key={p.id} onClick={() => { setProperty(p.id); setRoom(''); setSelectedDate(''); setSelectedTime(''); setStep(2) }}
              className="group flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4 text-left transition-all hover:border-[#2563eb] hover:shadow-sm">
              <div className="min-w-0">
                <div className="font-semibold text-slate-900">{p.name}</div>
                <div className="mt-0.5 text-xs text-slate-500">{p.address}</div>
                <div className="mt-2 text-xs font-medium text-[#2563eb]">{p.manager ? `Manager: ${p.manager}` : 'Manager assigned after inquiry'}</div>
              </div>
              <span className="shrink-0 rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600 transition group-hover:border-[#2563eb] group-hover:text-[#2563eb]">Contact manager</span>
            </button>
          ))}
        </div>
      )}

      {/* Step 2: Pick date, time slot, room, tour format */}
      {step === 2 && selectedProperty && (
        <div className="space-y-7">
          <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm">
            <div className="font-semibold text-slate-900">{selectedProperty.name}</div>
            <div className="mt-1 text-slate-500">{selectedProperty.address}</div>
            <div className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#2563eb]">{selectedProperty.manager ? `Contact manager: ${selectedProperty.manager}` : 'Manager contact available after request'}</div>
          </div>

          {/* Date calendar */}
          <div>
            <div className="mb-3 text-sm font-semibold text-slate-700">Choose a date</div>
            <DateCalendar
              availableDates={availableDates}
              selectedDate={selectedDate}
              onSelectDate={(d) => { setSelectedDate(d); setSelectedTime('') }}
            />
          </div>

          {/* Time slots (shown after date selected) */}
          {selectedDate && (
            <div>
              <div className="mb-3 text-sm font-semibold text-slate-700">
                Available times <span className="font-normal text-slate-400">— {selectedDateEntry?.display}</span>
              </div>
              <TimeSlots slots={currentSlots} selectedTime={selectedTime} onSelectTime={setSelectedTime} />
            </div>
          )}

          {/* Room picker */}
          <div>
            <div className="mb-3 text-sm font-semibold text-slate-700">Which room? <span className="font-normal text-slate-400">(optional)</span></div>
            <div className="flex flex-wrap gap-2">
              {selectedProperty.rooms.map((r) => (
                <button key={r} onClick={() => setRoom(r === room ? '' : r)}
                  className={`rounded-xl border px-3 py-2 text-sm font-semibold transition-all ${room === r ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'}`}>
                  {r.replace('Room ', '')}
                </button>
              ))}
              <button onClick={() => setRoom(room === 'Not sure yet' ? '' : 'Not sure yet')}
                className={`rounded-xl border px-3 py-2 text-sm font-semibold transition-all ${room === 'Not sure yet' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'}`}>
                Not sure yet
              </button>
            </div>
          </div>

          {/* Tour format */}
          <div>
            <div className="mb-3 text-sm font-semibold text-slate-700">Tour format</div>
            <div className="flex gap-3">
              {[['in-person','In-Person'],['virtual','Virtual']].map(([val, label]) => (
                <button key={val} onClick={() => setTourType(val)}
                  className={`flex flex-1 items-center justify-center rounded-xl border px-4 py-3 text-sm font-semibold transition-all ${tourType === val ? 'border-[#2563eb] bg-[#2563eb] text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-[#2563eb]'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-3 pt-1">
            <button onClick={() => setStep(1)} className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600 hover:border-slate-400">Back</button>
            <button onClick={() => setStep(3)}
              className="rounded-full bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] px-6 py-2.5 text-sm font-semibold text-white transition hover:opacity-95">
              Continue
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Contact details */}
      {step === 3 && (
        <div className="space-y-4">
          {selectedProperty && (
            <div className="mb-2 flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-4 py-2.5 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-900">{selectedProperty.name}</span>
                {selectedProperty.manager ? <><span className="text-slate-300">·</span><span className="text-[#2563eb]">Manager: {selectedProperty.manager}</span></> : null}
                {room ? <><span className="text-slate-300">·</span><span className="text-slate-600">{room}</span></> : null}
                {selectedDate ? <><span className="text-slate-300">·</span><span className="text-slate-600">{selectedDateEntry?.display}</span></> : null}
                {selectedTime ? <><span className="text-slate-300">·</span><span className="text-slate-600">{selectedTime}</span></> : null}
                <span className="text-slate-300">·</span><span className="text-slate-600">{tourType === 'in-person' ? 'In-Person' : 'Virtual'}</span>
              </div>
              <button onClick={() => setStep(2)} className="ml-2 shrink-0 text-xs font-semibold text-slate-400 hover:text-slate-700">Edit</button>
            </div>
          )}
          <ContactFields form={form} setField={setField} />
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700">
              Questions or notes?
              <span className="ml-1 font-normal text-slate-400">(optional)</span>
            </label>
            <textarea className={`${inputCls} min-h-[90px] resize-y`}
              placeholder="Anything specific you'd like to know…"
              value={form.notes} onChange={e => setField('notes', e.target.value)} />
          </div>
          {submitError && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{submitError}</div>}
          <div className="flex gap-3 pt-2">
            <button onClick={() => setStep(2)} className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600 hover:border-slate-400">Back</button>
            <button onClick={handleSchedule} disabled={!form.name.trim() || !form.email.trim() || submitting}
              className="flex-1 rounded-full bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] py-3 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(37,99,235,0.25)] hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity">
              {submitting ? 'Sending…' : 'Request Tour'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Housing message form ──────────────────────────────────────────────────────

function HousingMessageForm() {
  const [form, setFormState] = useState({ name: '', email: '', phone: '', message: '' })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  function set(k, v) { setFormState(prev => ({ ...prev, [k]: v })) }

  async function handleSubmit(e) {
    e.preventDefault(); setSubmitting(true); setError('')
    try {
      const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Inquiries`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { 'Full Name': form.name, 'Email': form.email, 'Phone Number': form.phone, 'Inquiry Type': 'Housing', 'Message Summary': form.message }, typecast: true }),
      })
      if (!res.ok) throw new Error(`Error ${res.status}`)
      setSubmitted(true)
    } catch (err) {
      setError(err.message || 'Submission failed.')
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) return (
    <SuccessCard title="Message sent!" body={`We'll follow up at ${form.email} within 2 business days.`}
      onReset={() => { setSubmitted(false); setFormState({ name: '', email: '', phone: '', message: '' }) }} resetLabel="Send another" />
  )

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
      <div>
        <label className="mb-1.5 block text-xs font-semibold text-slate-700">Phone</label>
        <input type="tel" className={inputCls} placeholder="(206) 555-0100" value={form.phone} onChange={e => set('phone', formatPhone(e.target.value))} />
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-semibold text-slate-700">Message <span className="text-axis">*</span></label>
        <textarea required className={`${inputCls} min-h-[110px] resize-y`} placeholder="Ask about availability, pricing, lease terms…" value={form.message} onChange={e => set('message', e.target.value)} />
      </div>
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <button type="submit" disabled={submitting} className="w-full rounded-full bg-slate-900 py-3.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed">
        {submitting ? 'Sending…' : 'Send message'}
      </button>
    </form>
  )
}

// ── Software demo scheduler ───────────────────────────────────────────────────

function DemoScheduler() {
  const [staff, setStaff] = useState([])
  const [staffLoading, setStaffLoading] = useState(true)
  const [selectedStaff, setSelectedStaff] = useState(null)
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedTime, setSelectedTime] = useState('')
  const [step, setStep] = useState(1) // 1=pick staff, 2=pick date/time, 3=contact form
  const [form, setFormState] = useState({ name: '', email: '', phone: '', company: '', notes: '' })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitError, setSubmitError] = useState('')

  function setField(k, v) { setFormState(prev => ({ ...prev, [k]: v })) }

  const staffDaySlotMap = selectedStaff
    ? (() => {
        const parsed = parseTourCalendar(selectedStaff.availability)
        // If no availability set, use a default M-F schedule
        const DEFAULT_STAFF = {
          Mon: ['9:00 AM', '10:00 AM', '2:00 PM', '3:00 PM'],
          Tue: ['9:00 AM', '11:00 AM', '2:00 PM'],
          Wed: ['10:00 AM', '1:00 PM', '3:00 PM'],
          Thu: ['9:00 AM', '11:00 AM', '2:00 PM', '4:00 PM'],
          Fri: ['9:00 AM', '10:00 AM', '1:00 PM'],
        }
        const hasParsed = Object.keys(parsed).length > 0
        return hasParsed ? parsed : DEFAULT_STAFF
      })()
    : {}

  const availableDates = selectedStaff ? getUpcomingDates(staffDaySlotMap, 28) : []
  const selectedDateEntry = availableDates.find(d => d.date === selectedDate)
  const currentSlots = selectedDateEntry?.slots || []

  useEffect(() => {
    fetch('/api/demo')
      .then(r => r.json())
      .then(data => {
        setStaff(Array.isArray(data?.staff) ? data.staff : [])
        setStaffLoading(false)
      })
      .catch(() => { setStaff([]); setStaffLoading(false) })
  }, [])

  function reset() {
    setSelectedStaff(null); setSelectedDate(''); setSelectedTime(''); setStep(1)
    setFormState({ name: '', email: '', phone: '', company: '', notes: '' })
    setSubmitted(false); setSubmitError('')
  }

  async function handleSubmit() {
    setSubmitting(true); setSubmitError('')
    try {
      const res = await fetch('/api/demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim(),
          company: form.company.trim(),
          staffId: selectedStaff?.id || '',
          staffName: selectedStaff?.name || '',
          preferredDate: selectedDate, preferredTime: selectedTime,
          notes: form.notes.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Submission failed.')
      setSubmitted(true)
    } catch (err) {
      setSubmitError(err.message || 'Could not submit. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) return (
    <SuccessCard
      title="Demo request sent!"
      body={`We'll reach out to ${form.email} to confirm within 1 business day.`}
      onReset={reset}
    />
  )

  const demoSteps = [['1','Who you\'ll meet'],['2','Pick a time'],['3','Your details']]

  return (
    <div>
      {/* Step progress */}
      <div className="mb-8 flex items-center gap-2">
        {demoSteps.map(([s, label], idx) => (
          <div key={s} className="flex items-center gap-1.5">
            <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-colors ${step > idx + 1 ? 'bg-[#2563eb] text-white' : step === idx + 1 ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-400'}`}>
              {step > idx + 1 ? <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg> : s}
            </div>
            <span className={`hidden text-xs font-medium sm:block ${step >= idx + 1 ? 'text-slate-700' : 'text-slate-400'}`}>{label}</span>
            {idx < 2 && <div className={`h-px w-4 shrink-0 sm:w-8 ${step > idx + 1 ? 'bg-[#2563eb]' : 'bg-slate-200'}`} />}
          </div>
        ))}
      </div>

      {/* Step 1: Pick staff member */}
      {step === 1 && (
        <div>
          {staffLoading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-slate-400">
              <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
              Loading availability…
            </div>
          ) : staff.length === 0 ? (
            // No staff configured — skip to contact form
            <div className="space-y-4">
              <p className="text-sm text-slate-500">Tell us about your portfolio and we'll match you with the right person.</p>
              <ContactFields form={form} setField={setField} />
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">Company / Portfolio name</label>
                <input className={inputCls} placeholder="Smith Properties" value={form.company} onChange={e => setField('company', e.target.value)} />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-700">What are you looking for? <span className="text-axis">*</span></label>
                <textarea className={`${inputCls} min-h-[100px] resize-y`} placeholder="Tell us about your properties and what you'd like Axis to help with…" value={form.notes} onChange={e => setField('notes', e.target.value)} />
              </div>
              {submitError && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{submitError}</div>}
              <button onClick={handleSubmit} disabled={!form.name.trim() || !form.email.trim() || !form.notes.trim() || submitting}
                className="w-full rounded-full bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] py-3.5 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(37,99,235,0.25)] hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity">
                {submitting ? 'Sending…' : 'Request a demo'}
              </button>
            </div>
          ) : (
            <div>
              <p className="mb-4 text-sm text-slate-500">Choose who you'd like to meet with for your demo.</p>
              <div className="space-y-3">
                {staff.map((s) => (
                  <button key={s.id} onClick={() => { setSelectedStaff(s); setSelectedDate(''); setSelectedTime(''); setStep(2) }}
                    className="group flex w-full items-center gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-4 text-left transition-all hover:border-[#2563eb] hover:shadow-sm">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100">
                      {s.avatarUrl
                        ? <img src={s.avatarUrl} alt={s.name} className="h-full w-full object-cover" />
                        : <span className="text-base font-bold text-slate-500">{s.name.charAt(0)}</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-slate-900">{s.name}</div>
                      {s.role ? <div className="text-xs text-slate-500">{s.role}</div> : null}
                      {s.bio  ? <div className="mt-0.5 truncate text-xs text-slate-400">{s.bio}</div> : null}
                    </div>
                    <svg className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-slate-900" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 2: Pick date and time */}
      {step === 2 && selectedStaff && (
        <div className="space-y-7">
          <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-200">
              {selectedStaff.avatarUrl
                ? <img src={selectedStaff.avatarUrl} alt={selectedStaff.name} className="h-full w-full object-cover" />
                : <span className="text-sm font-bold text-slate-500">{selectedStaff.name.charAt(0)}</span>}
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold text-slate-900">{selectedStaff.name}</div>
              {selectedStaff.role ? <div className="text-xs text-slate-500">{selectedStaff.role}</div> : null}
            </div>
            <button onClick={() => setStep(1)} className="text-xs font-semibold text-slate-400 hover:text-slate-700">Change</button>
          </div>

          <div>
            <div className="mb-3 text-sm font-semibold text-slate-700">Choose a date</div>
            <DateCalendar
              availableDates={availableDates}
              selectedDate={selectedDate}
              onSelectDate={(d) => { setSelectedDate(d); setSelectedTime('') }}
            />
          </div>

          {selectedDate && (
            <div>
              <div className="mb-3 text-sm font-semibold text-slate-700">
                Available times <span className="font-normal text-slate-400">— {selectedDateEntry?.display}</span>
              </div>
              <TimeSlots slots={currentSlots} selectedTime={selectedTime} onSelectTime={setSelectedTime} />
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button onClick={() => setStep(1)} className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600 hover:border-slate-400">Back</button>
            <button onClick={() => setStep(3)} disabled={!selectedDate || !selectedTime}
              className="rounded-full bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              Continue
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Contact form */}
      {step === 3 && (
        <div className="space-y-4">
          {selectedStaff && (
            <div className="mb-2 flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-4 py-2.5 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-900">{selectedStaff.name}</span>
                {selectedDate ? <><span className="text-slate-300">·</span><span className="text-slate-600">{selectedDateEntry?.display}</span></> : null}
                {selectedTime ? <><span className="text-slate-300">·</span><span className="text-slate-600">{selectedTime}</span></> : null}
              </div>
              <button onClick={() => setStep(2)} className="ml-2 shrink-0 text-xs font-semibold text-slate-400 hover:text-slate-700">Edit</button>
            </div>
          )}
          <ContactFields form={form} setField={setField} />
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700">Company / Portfolio name</label>
            <input className={inputCls} placeholder="Smith Properties" value={form.company} onChange={e => setField('company', e.target.value)} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700">Anything you'd like us to know? <span className="font-normal text-slate-400">(optional)</span></label>
            <textarea className={`${inputCls} min-h-[90px] resize-y`} placeholder="Number of properties, current tooling, goals…" value={form.notes} onChange={e => setField('notes', e.target.value)} />
          </div>
          {submitError && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{submitError}</div>}
          <div className="flex gap-3 pt-2">
            <button onClick={() => setStep(2)} className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600 hover:border-slate-400">Back</button>
            <button onClick={handleSubmit} disabled={!form.name.trim() || !form.email.trim() || submitting}
              className="flex-1 rounded-full bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] py-3 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(37,99,235,0.25)] hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity">
              {submitting ? 'Sending…' : 'Request Demo'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Software message form ─────────────────────────────────────────────────────

function SoftwareMessageForm() {
  const [form, setFormState] = useState({ name: '', email: '', topic: '', message: '' })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  function set(k, v) { setFormState(prev => ({ ...prev, [k]: v })) }

  async function handleSubmit(e) {
    e.preventDefault(); setSubmitting(true); setError('')
    try {
      const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Inquiries`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { 'Full Name': form.name, 'Email': form.email, 'Inquiry Type': form.topic || 'Software', 'Message Summary': form.message }, typecast: true }),
      })
      if (!res.ok) throw new Error(`Error ${res.status}`)
      setSubmitted(true)
    } catch (err) {
      setError(err.message || 'Submission failed.')
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) return (
    <SuccessCard title="Message sent!" body={`We'll follow up at ${form.email} within 2 business days.`}
      onReset={() => { setSubmitted(false); setFormState({ name: '', email: '', topic: '', message: '' }) }} resetLabel="Send another" />
  )

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-slate-700">Name <span className="text-axis">*</span></label>
          <input required className={inputCls} placeholder="Jane Smith" value={form.name} onChange={e => set('name', e.target.value)} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-slate-700">Email <span className="text-axis">*</span></label>
          <input required type="email" className={inputCls} placeholder="jane@company.com" value={form.email} onChange={e => set('email', e.target.value)} />
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-semibold text-slate-700">Topic</label>
        <select className={selectCls} value={form.topic} onChange={e => set('topic', e.target.value)}>
          <option value="">Select…</option>
          <option value="Software">Software inquiry</option>
          <option value="Business">Business / partnerships</option>
          <option value="Support">Support</option>
          <option value="General">General</option>
        </select>
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-semibold text-slate-700">Message <span className="text-axis">*</span></label>
        <textarea required className={`${inputCls} min-h-[110px] resize-y`} placeholder="What can we help you with?" value={form.message} onChange={e => set('message', e.target.value)} />
      </div>
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <button type="submit" disabled={submitting} className="w-full rounded-full bg-slate-900 py-3.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed">
        {submitting ? 'Sending…' : 'Send message'}
      </button>
    </form>
  )
}

// ── Tab bar ───────────────────────────────────────────────────────────────────

function TabBar({ tabs, active, onChange }) {
  return (
    <div className="mb-8 flex gap-1 rounded-2xl border border-white/90 bg-white/82 p-1 shadow-[0_10px_30px_rgba(37,99,235,0.06)]">
      {tabs.map(({ id, label }) => (
        <button key={id} onClick={() => onChange(id)}
          className={`flex flex-1 items-center justify-center rounded-xl px-3 py-2.5 text-xs font-semibold transition-all sm:text-sm ${active === id ? 'bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] text-white shadow-[0_12px_28px_rgba(37,99,235,0.18)]' : 'text-slate-500 hover:text-slate-700'}`}>
          {label}
        </button>
      ))}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Contact() {
  const location = useLocation()
  const [section, setSection] = useState('software')
  const [housingTab, setHousingTab] = useState('schedule')
  const [softwareTab, setSoftwareTab] = useState('demo')

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const sectionParam = params.get('section')
    const tabParam = params.get('tab')
    const subject = (params.get('subject') || '').toLowerCase()

    let nextSection = 'software'
    let nextHousingTab = 'schedule'
    let nextSoftwareTab = 'demo'

    if (sectionParam === 'housing') {
      nextSection = 'housing'
    } else if (sectionParam === 'software') {
      nextSection = sectionParam
    } else if (subject.includes('tour')) {
      nextSection = 'housing'
    } else if (subject.includes('contact') || subject.includes('axis') || subject.includes('demo') || subject.includes('software') || subject.includes('manage')) {
      nextSection = 'software'
    }

    if (nextSection === 'housing' && tabParam === 'message') {
      nextHousingTab = 'message'
    }

    if (nextSection === 'software' && tabParam === 'message') {
      nextSoftwareTab = 'message'
    }

    setSection(nextSection)
    setHousingTab(nextHousingTab)
    setSoftwareTab(nextSoftwareTab)
  }, [location.search])

  return (
    <div className="bg-[linear-gradient(180deg,#edf2fb_0%,#eef3fb_48%,#f6f9fe_100%)]">
      <Seo
        title="Contact Axis | Housing Tours and Software Inquiries"
        description="Schedule a property tour or reach out about the Axis property management platform."
        pathname="/contact"
      />
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="mx-auto max-w-5xl rounded-[32px] border border-white/90 bg-white/88 p-6 shadow-[0_30px_80px_rgba(37,99,235,0.10)] backdrop-blur sm:p-8">

          {/* Housing section */}
          {section === 'housing' && (
            <div>
              <div className="mb-6 border-b border-slate-100 pb-5">
                <h2 className="text-3xl font-black tracking-tight text-slate-900">Contact manager</h2>
                <p className="mt-2 text-sm text-slate-500">Schedule a tour or send a question directly to the property manager.</p>
              </div>
              <TabBar
                tabs={[{ id: 'schedule', label: 'Set up tour' }, { id: 'message', label: 'Send message' }]}
                active={housingTab}
                onChange={setHousingTab}
              />
              {housingTab === 'schedule' ? <HousingScheduler /> : <HousingMessageForm />}
            </div>
          )}

          {/* Software section */}
          {section === 'software' && (
            <div>
              <div className="mb-6 border-b border-slate-100 pb-5">
                <h2 className="text-3xl font-black tracking-tight text-slate-900">Connect with Axis Team</h2>
              </div>
              <TabBar
                tabs={[{ id: 'demo', label: 'Request a Demo' }, { id: 'message', label: 'Send a Message' }]}
                active={softwareTab} onChange={setSoftwareTab}
              />
              {softwareTab === 'demo'    && <DemoScheduler />}
              {softwareTab === 'message' && <SoftwareMessageForm />}
            </div>
          )}

        </div>
      </div>
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Seo } from '../lib/seo'
import { HOUSING_MESSAGE_CATEGORIES, isHousingMessageCategoryId } from '../lib/housingSite'

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

function formatYMD(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
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
        date: formatYMD(d),
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

function MonthCalendar({ selectableSet, selectedDate, onSelectDate }) {
  const [cursor, setCursor] = useState(() => {
    const t = new Date()
    return new Date(t.getFullYear(), t.getMonth(), 1)
  })
  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const firstDow = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const dow = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
  const keyFor = (day) => formatYMD(new Date(year, month, day))

  if (!selectableSet?.size) {
    return <p className="text-sm text-slate-400 italic">No open slots loaded. Submit your request and we will coordinate a time.</p>
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-gradient-to-b from-white to-slate-50/90 shadow-[0_12px_40px_rgba(15,23,42,0.06)]">
      <div className="flex items-center justify-between border-b border-slate-100 bg-white/90 px-3 py-3 sm:px-4">
        <button type="button" aria-label="Previous month" onClick={() => setCursor(new Date(year, month - 1, 1))}
          className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5"/></svg>
        </button>
        <span className="text-sm font-black tracking-tight text-slate-900">{cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</span>
        <button type="button" aria-label="Next month" onClick={() => setCursor(new Date(year, month + 1, 1))}
          className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5"/></svg>
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0 border-b border-slate-100 px-2 py-2">
        {dow.map((d, i) => (
          <div key={`${d}-${i}`} className="py-1.5 text-center text-[10px] font-bold uppercase tracking-wider text-slate-400">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1 p-2 sm:gap-1.5 sm:p-3">
        {Array.from({ length: firstDow }, (_, i) => (
          <div key={`pad-${i}`} />
        ))}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1
          const key = keyFor(day)
          const cellDate = new Date(year, month, day)
          const isPast = cellDate < today
          const ok = selectableSet.has(key) && !isPast
          const sel = selectedDate === key
          return (
            <button
              key={key}
              type="button"
              disabled={!ok}
              onClick={() => ok && onSelectDate(key)}
              className={`mx-auto flex h-9 w-9 items-center justify-center rounded-xl text-sm font-semibold transition-all sm:h-10 sm:w-10 ${
                sel
                  ? 'bg-[#2563eb] text-white shadow-[0_6px_16px_rgba(37,99,235,0.35)]'
                  : ok
                    ? 'bg-white text-slate-800 ring-1 ring-slate-200 hover:ring-[#2563eb] hover:text-[#2563eb]'
                    : 'cursor-not-allowed text-slate-300'
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

function PropertyRoomPicker({ properties, selectedId, onSelectProperty, room, onSelectRoom, roomRequired = true }) {
  const p = properties.find((x) => x.id === selectedId)
  return (
    <div className="space-y-5">
      <div className="text-sm font-semibold text-slate-700">Property</div>
      <div className="space-y-3">
        {properties.map((prop) => (
          <button
            key={prop.id}
            type="button"
            onClick={() => { onSelectProperty(prop.id); onSelectRoom('') }}
            className={`group flex w-full items-center justify-between rounded-2xl border bg-white px-5 py-4 text-left transition-all ${
              selectedId === prop.id ? 'border-[#2563eb] shadow-[0_8px_24px_rgba(37,99,235,0.12)]' : 'border-slate-200 hover:border-[#2563eb] hover:shadow-sm'
            }`}
          >
            <div className="min-w-0">
              <div className="font-semibold text-slate-900">{prop.name}</div>
              <div className="mt-0.5 text-xs text-slate-500">{prop.address}</div>
              <div className="mt-2 text-xs font-medium text-[#2563eb]">{prop.manager ? `Manager: ${prop.manager}` : 'Manager assigned after inquiry'}</div>
            </div>
            <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition ${selectedId === prop.id ? 'border-[#2563eb] bg-[#2563eb] text-white' : 'border-slate-200 text-slate-600 group-hover:border-[#2563eb] group-hover:text-[#2563eb]'}`}>
              {selectedId === prop.id ? 'Selected' : 'Choose'}
            </span>
          </button>
        ))}
      </div>
      {p ? (
        <div>
          <div className="mb-2 text-sm font-semibold text-slate-700">
            Room{' '}
            <span className="font-normal text-slate-400">{roomRequired ? '(required)' : '(optional)'}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {p.rooms.map((r) => (
              <button key={r} type="button" onClick={() => onSelectRoom(r === room ? '' : r)}
                className={`rounded-xl border px-3 py-2 text-sm font-semibold transition-all ${room === r ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'}`}>
                {r.replace('Room ', '')}
              </button>
            ))}
            <button type="button" onClick={() => onSelectRoom(room === 'Not sure yet' ? '' : 'Not sure yet')}
              className={`rounded-xl border px-3 py-2 text-sm font-semibold transition-all ${room === 'Not sure yet' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'}`}>
              Not sure yet
            </button>
          </div>
        </div>
      ) : null}
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
  const selectableSet = useMemo(() => new Set(availableDates.map((d) => d.date)), [availableDates])
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
    fetch('/api/forms?action=tour')
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
      const res = await fetch('/api/forms?action=tour', {
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

  const tourSteps = [['1', 'Property & room'], ['2', 'Date & time'], ['3', 'Your details']]
  const step1Ready = property && room

  return (
    <div>
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

      {step === 1 && (
        <div className="space-y-6">
          <PropertyRoomPicker
            properties={properties}
            selectedId={property}
            onSelectProperty={setProperty}
            room={room}
            onSelectRoom={setRoom}
          />
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" disabled={!step1Ready} onClick={() => step1Ready && setStep(2)}
              className="rounded-full bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] px-6 py-2.5 text-sm font-semibold text-white transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-40">
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 2 && selectedProperty && (
        <div className="space-y-7">
          <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm">
            <div className="font-semibold text-slate-900">{selectedProperty.name}</div>
            <div className="mt-1 text-slate-500">{selectedProperty.address}</div>
            <div className="mt-1 text-xs text-slate-600"><span className="font-semibold text-slate-700">Room:</span> {room}</div>
            {selectedProperty.manager ? <div className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#2563eb]">Manager: {selectedProperty.manager}</div> : null}
          </div>

          <div>
            <div className="mb-3 text-sm font-semibold text-slate-700">Tour format</div>
            <div className="flex gap-3">
              {[['in-person', 'In-person'], ['virtual', 'Virtual']].map(([val, label]) => (
                <button key={val} type="button" onClick={() => setTourType(val)}
                  className={`flex flex-1 items-center justify-center rounded-xl border px-4 py-3 text-sm font-semibold transition-all ${tourType === val ? 'border-[#2563eb] bg-[#2563eb] text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-[#2563eb]'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-3 text-sm font-semibold text-slate-700">Choose a date</div>
            <MonthCalendar
              selectableSet={selectableSet}
              selectedDate={selectedDate}
              onSelectDate={(d) => { setSelectedDate(d); setSelectedTime('') }}
            />
          </div>

          {selectedDate && (
            <div>
              <div className="mb-3 text-sm font-semibold text-slate-700">
                Times <span className="font-normal text-slate-400">— {selectedDateEntry?.display}</span>
              </div>
              <TimeSlots slots={currentSlots} selectedTime={selectedTime} onSelectTime={setSelectedTime} />
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={() => setStep(1)} className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600 hover:border-slate-400">Back</button>
            <button type="button" onClick={() => setStep(3)} disabled={!selectedDate || !selectedTime}
              className="rounded-full bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] px-6 py-2.5 text-sm font-semibold text-white transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-40">
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          {selectedProperty && (
            <div className="mb-2 flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-4 py-2.5 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-900">{selectedProperty.name}</span>
                {room ? <><span className="text-slate-300">·</span><span className="text-slate-600">{room}</span></> : null}
                {selectedDate ? <><span className="text-slate-300">·</span><span className="text-slate-600">{selectedDateEntry?.display}</span></> : null}
                {selectedTime ? <><span className="text-slate-300">·</span><span className="text-slate-600">{selectedTime}</span></> : null}
                <span className="text-slate-300">·</span><span className="text-slate-600">{tourType === 'in-person' ? 'In-person' : 'Virtual'}</span>
              </div>
              <button type="button" onClick={() => setStep(2)} className="ml-2 shrink-0 text-xs font-semibold text-slate-400 hover:text-slate-700">Edit</button>
            </div>
          )}
          <ContactFields form={form} setField={setField} />
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700">
              Notes <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <textarea className={`${inputCls} min-h-[90px] resize-y`}
              placeholder="Anything we should know…"
              value={form.notes} onChange={e => setField('notes', e.target.value)} />
          </div>
          {submitError && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{submitError}</div>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => setStep(2)} className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600 hover:border-slate-400">Back</button>
            <button type="button" onClick={handleSchedule} disabled={!form.name.trim() || !form.email.trim() || submitting}
              className="flex-1 rounded-full bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] py-3 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(37,99,235,0.25)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 transition-opacity">
              {submitting ? 'Sending…' : 'Request tour'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Housing message form ──────────────────────────────────────────────────────

function HousingMessageForm() {
  const location = useLocation()
  const [properties, setProperties] = useState(DEFAULT_PROPERTIES)
  const [property, setProperty] = useState(null)
  const [room, setRoom] = useState('')
  const [category, setCategory] = useState('general')
  const [form, setFormState] = useState({ name: '', email: '', phone: '', message: '' })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  const selectedProperty = properties.find((p) => p.id === property)

  function set(k, v) { setFormState(prev => ({ ...prev, [k]: v })) }

  useEffect(() => {
    const id = new URLSearchParams(location.search).get('category') || ''
    if (isHousingMessageCategoryId(id)) setCategory(id)
  }, [location.search])

  useEffect(() => {
    let cancelled = false
    fetch('/api/forms?action=tour')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        const next = Array.isArray(data?.properties) && data.properties.length ? data.properties : DEFAULT_PROPERTIES
        setProperties(next.map((p) => ({ ...p, rooms: p.rooms || DEFAULT_PROPERTIES.find((f) => f.id === p.id)?.rooms || [] })))
      })
      .catch(() => { if (!cancelled) setProperties(DEFAULT_PROPERTIES) })
    return () => { cancelled = true }
  }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true); setError('')
    const catLabel = HOUSING_MESSAGE_CATEGORIES.find((c) => c.id === category)?.label || category
    let header = `Category: ${catLabel}\n\n`
    if (property && room && selectedProperty) {
      header += `Property: ${selectedProperty.name}\nRoom: ${room}\n\n`
    }
    try {
      const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Inquiries`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { 'Full Name': form.name, 'Email': form.email, 'Phone Number': form.phone, 'Inquiry Type': 'Housing', 'Message Summary': header + form.message }, typecast: true }),
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
      onReset={() => {
        setSubmitted(false)
        setProperty(null); setRoom(''); setCategory('general')
        setFormState({ name: '', email: '', phone: '', message: '' })
      }} resetLabel="Send another" />
  )

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <div className="mb-2 text-sm font-semibold text-slate-700">
          What do you need help with? <span className="text-axis">*</span>
        </div>
        <div className="flex flex-col gap-2">
          {HOUSING_MESSAGE_CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategory(c.id)}
              className={`rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition-all ${
                category === c.id
                  ? 'border-[#2563eb] bg-[#2563eb] text-white shadow-[0_8px_20px_rgba(37,99,235,0.2)]'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-[#2563eb]/60'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-2 text-sm font-semibold text-slate-700">
          Property &amp; room <span className="font-normal text-slate-400">(optional)</span>
        </div>
        <p className="mb-3 text-xs text-slate-500">Add these if your question is about a specific home or unit.</p>
        <PropertyRoomPicker
          properties={properties}
          selectedId={property}
          onSelectProperty={setProperty}
          room={room}
          onSelectRoom={setRoom}
          roomRequired={false}
        />
      </div>
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
        <textarea required className={`${inputCls} min-h-[110px] resize-y`} placeholder="Tell us more so we can help…" value={form.message} onChange={e => set('message', e.target.value)} />
      </div>
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <button type="submit" disabled={submitting} className="w-full rounded-full bg-slate-900 py-3.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed">
        {submitting ? 'Sending…' : 'Send message'}
      </button>
    </form>
  )
}

// ── Software demo scheduler ───────────────────────────────────────────────────

async function readJsonBody(res) {
  const text = await res.text()
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('Invalid response from server.')
  }
}

function DemoScheduler() {
  const [staff, setStaff] = useState([])
  const [staffLoading, setStaffLoading] = useState(true)
  const [selectedStaff, setSelectedStaff] = useState(null)
  const [meetingFormat, setMeetingFormat] = useState('in-person')
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedTime, setSelectedTime] = useState('')
  const [step, setStep] = useState(1)
  const [form, setFormState] = useState({ name: '', email: '', phone: '', company: '', notes: '' })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitError, setSubmitError] = useState('')

  function setField(k, v) { setFormState(prev => ({ ...prev, [k]: v })) }

  const staffDaySlotMap = selectedStaff
    ? (() => {
        const parsed = parseTourCalendar(selectedStaff.availability)
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
  const selectableSet = useMemo(() => new Set(availableDates.map((d) => d.date)), [availableDates])
  const selectedDateEntry = availableDates.find(d => d.date === selectedDate)
  const currentSlots = selectedDateEntry?.slots || []

  const noStaffDates = useMemo(() => getUpcomingDates(DEFAULT_CALENDAR, 28), [])
  const selectableNoStaffSet = useMemo(() => new Set(noStaffDates.map((d) => d.date)), [noStaffDates])
  const selectedDateEntryNoStaff = noStaffDates.find((d) => d.date === selectedDate)
  const currentSlotsNoStaff = selectedDateEntryNoStaff?.slots || []

  useEffect(() => {
    fetch('/api/forms?action=demo')
      .then(async (r) => readJsonBody(r))
      .then((data) => {
        setStaff(Array.isArray(data?.staff) ? data.staff : [])
        setStaffLoading(false)
      })
      .catch(() => {
        setStaff([])
        setStaffLoading(false)
      })
  }, [])

  useEffect(() => {
    if (staffLoading || staff.length === 0) return
    if (step === 2 && !selectedStaff) setStep(1)
  }, [staffLoading, staff.length, step, selectedStaff])

  function reset() {
    setSelectedStaff(null); setMeetingFormat('in-person'); setSelectedDate(''); setSelectedTime(''); setStep(1)
    setFormState({ name: '', email: '', phone: '', company: '', notes: '' })
    setSubmitted(false); setSubmitError('')
  }

  async function handleSubmit() {
    setSubmitting(true); setSubmitError('')
    const fmt = meetingFormat === 'virtual' ? 'Virtual' : 'In-person'
    try {
      const res = await fetch('/api/forms?action=demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim(),
          company: form.company.trim(),
          staffId: selectedStaff?.id || '',
          staffName: selectedStaff?.name || '',
          preferredDate: selectedDate || '',
          preferredTime: selectedTime || '',
          meetingFormat: fmt,
          bookingType: 'Software Meeting',
          notes: form.notes.trim(),
        }),
      })
      const data = await readJsonBody(res)
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
      title="Meeting request sent!"
      body={`We'll reach out to ${form.email} to confirm within 1 business day.`}
      onReset={reset}
    />
  )

  const demoSteps = [['1', 'Who you\'ll meet'], ['2', 'Time'], ['3', 'Your details']]

  return (
    <div>
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

      {step === 1 && (
        <div>
          {staffLoading ? (
            <div className="flex items-center gap-2 py-8 text-sm text-slate-400">
              <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
              Loading…
            </div>
          ) : staff.length === 0 ? (
            <div className="space-y-4">
              <p className="text-sm text-slate-500">
                No calendar staff is connected right now. Choose meeting format, then pick a preferred time — we will confirm by email.
              </p>
              <div>
                <div className="mb-3 text-sm font-semibold text-slate-700">Meeting format</div>
                <div className="flex gap-3">
                  {[['in-person', 'In-person'], ['virtual', 'Virtual']].map(([val, label]) => (
                    <button key={val} type="button" onClick={() => setMeetingFormat(val)}
                      className={`flex flex-1 items-center justify-center rounded-xl border px-4 py-3 text-sm font-semibold transition-all ${meetingFormat === val ? 'border-[#2563eb] bg-[#2563eb] text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-[#2563eb]'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => { setSelectedDate(''); setSelectedTime(''); setStep(2) }}
                  className="rounded-full bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-700"
                >
                  Continue
                </button>
              </div>
            </div>
          ) : (
            <div>
              <p className="mb-4 text-sm text-slate-500">Pick someone from the Axis software team.</p>
              <div className="space-y-3">
                {staff.map((s) => (
                  <button key={s.id} type="button" onClick={() => { setSelectedStaff(s); setSelectedDate(''); setSelectedTime(''); setStep(2) }}
                    className="group flex w-full items-center gap-4 rounded-2xl border border-slate-200 bg-white px-5 py-4 text-left transition-all hover:border-[#2563eb] hover:shadow-sm">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-100">
                      {s.avatarUrl
                        ? <img src={s.avatarUrl} alt={s.name} className="h-full w-full object-cover" />
                        : <span className="text-base font-bold text-slate-500">{s.name.charAt(0)}</span>}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-slate-900">{s.name}</div>
                      {s.role ? <div className="text-xs text-slate-500">{s.role}</div> : null}
                      {s.bio ? <div className="mt-0.5 truncate text-xs text-slate-400">{s.bio}</div> : null}
                    </div>
                    <svg className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-slate-900" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {step === 2 && selectedStaff && (
        <div className="space-y-7">
          <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-200">
              {selectedStaff.avatarUrl
                ? <img src={selectedStaff.avatarUrl} alt={selectedStaff.name} className="h-full w-full object-cover" />
                : <span className="text-sm font-bold text-slate-500">{selectedStaff.name.charAt(0)}</span>}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-slate-900">{selectedStaff.name}</div>
              {selectedStaff.role ? <div className="text-xs text-slate-500">{selectedStaff.role}</div> : null}
            </div>
            <button type="button" onClick={() => setStep(1)} className="shrink-0 text-xs font-semibold text-slate-400 hover:text-slate-700">Change</button>
          </div>

          <div>
            <div className="mb-3 text-sm font-semibold text-slate-700">Meeting format</div>
            <div className="flex gap-3">
              {[['in-person', 'In-person'], ['virtual', 'Virtual']].map(([val, label]) => (
                <button key={val} type="button" onClick={() => setMeetingFormat(val)}
                  className={`flex flex-1 items-center justify-center rounded-xl border px-4 py-3 text-sm font-semibold transition-all ${meetingFormat === val ? 'border-[#2563eb] bg-[#2563eb] text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-[#2563eb]'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-3 text-sm font-semibold text-slate-700">Choose a date</div>
            <MonthCalendar
              selectableSet={selectableSet}
              selectedDate={selectedDate}
              onSelectDate={(d) => { setSelectedDate(d); setSelectedTime('') }}
            />
          </div>

          {selectedDate && (
            <div>
              <div className="mb-3 text-sm font-semibold text-slate-700">
                Times <span className="font-normal text-slate-400">— {selectedDateEntry?.display}</span>
              </div>
              <TimeSlots slots={currentSlots} selectedTime={selectedTime} onSelectTime={setSelectedTime} />
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={() => setStep(1)} className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600 hover:border-slate-400">Back</button>
            <button type="button" onClick={() => setStep(3)} disabled={!selectedDate || !selectedTime}
              className="rounded-full bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40">
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 2 && !staffLoading && staff.length === 0 && (
        <div className="space-y-7">
          <p className="text-sm text-slate-500">
            Pick a preferred date and time. We will follow up to finalize your meeting.
          </p>
          <div>
            <div className="mb-3 text-sm font-semibold text-slate-700">Meeting format</div>
            <div className="flex gap-3">
              {[['in-person', 'In-person'], ['virtual', 'Virtual']].map(([val, label]) => (
                <button key={val} type="button" onClick={() => setMeetingFormat(val)}
                  className={`flex flex-1 items-center justify-center rounded-xl border px-4 py-3 text-sm font-semibold transition-all ${meetingFormat === val ? 'border-[#2563eb] bg-[#2563eb] text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-[#2563eb]'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-3 text-sm font-semibold text-slate-700">Choose a date</div>
            <MonthCalendar
              selectableSet={selectableNoStaffSet}
              selectedDate={selectedDate}
              onSelectDate={(d) => { setSelectedDate(d); setSelectedTime('') }}
            />
          </div>
          {selectedDate && (
            <div>
              <div className="mb-3 text-sm font-semibold text-slate-700">
                Times <span className="font-normal text-slate-400">— {selectedDateEntryNoStaff?.display}</span>
              </div>
              <TimeSlots slots={currentSlotsNoStaff} selectedTime={selectedTime} onSelectTime={setSelectedTime} />
            </div>
          )}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={() => setStep(1)} className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600 hover:border-slate-400">Back</button>
            <button
              type="button"
              onClick={() => setStep(3)}
              disabled={!selectedDate || !selectedTime}
              className="rounded-full bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          {selectedStaff ? (
            <div className="mb-2 flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-4 py-2.5 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-900">{selectedStaff.name}</span>
                <span className="text-slate-300">·</span>
                <span className="text-slate-600">{meetingFormat === 'virtual' ? 'Virtual' : 'In-person'}</span>
                {selectedDate ? <><span className="text-slate-300">·</span><span className="text-slate-600">{selectedDateEntry?.display}</span></> : null}
                {selectedTime ? <><span className="text-slate-300">·</span><span className="text-slate-600">{selectedTime}</span></> : null}
              </div>
              <button type="button" onClick={() => setStep(2)} className="ml-2 shrink-0 text-xs font-semibold text-slate-400 hover:text-slate-700">Edit</button>
            </div>
          ) : !staffLoading && staff.length === 0 ? (
            <div className="mb-2 flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-4 py-2.5 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-slate-600">{meetingFormat === 'virtual' ? 'Virtual' : 'In-person'}</span>
                {selectedDate ? <><span className="text-slate-300">·</span><span className="text-slate-600">{selectedDateEntryNoStaff?.display}</span></> : null}
                {selectedTime ? <><span className="text-slate-300">·</span><span className="text-slate-600">{selectedTime}</span></> : null}
              </div>
              <button type="button" onClick={() => setStep(2)} className="ml-2 shrink-0 text-xs font-semibold text-slate-400 hover:text-slate-700">Edit</button>
            </div>
          ) : null}
          <ContactFields form={form} setField={setField} />
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700">Company</label>
            <input className={inputCls} placeholder="Smith Properties" value={form.company} onChange={e => setField('company', e.target.value)} />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700">Notes <span className="font-normal text-slate-400">(optional)</span></label>
            <textarea className={`${inputCls} min-h-[90px] resize-y`} placeholder="Context for the call…" value={form.notes} onChange={e => setField('notes', e.target.value)} />
          </div>
          {submitError && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{submitError}</div>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={() => setStep(2)} className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600 hover:border-slate-400">Back</button>
            <button type="button" onClick={handleSubmit} disabled={!form.name.trim() || !form.email.trim() || submitting}
              className="flex-1 rounded-full bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] py-3 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(37,99,235,0.25)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 transition-opacity">
              {submitting ? 'Sending…' : 'Request meeting'}
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
  const [softwareTab, setSoftwareTab] = useState('meeting')

  useEffect(() => {
    if (location.pathname.startsWith('/owners/contact')) {
      setSection('software')
      setSoftwareTab('message')
      return
    }
    const params = new URLSearchParams(location.search)
    const sectionParam = params.get('section')
    const tabParam = params.get('tab')
    const categoryParam = params.get('category')
    const subject = (params.get('subject') || '').toLowerCase()

    let nextSection = 'software'
    let nextHousingTab = 'schedule'
    let nextSoftwareTab = 'meeting'

    if (sectionParam === 'housing') {
      nextSection = 'housing'
    } else if (isHousingMessageCategoryId(categoryParam)) {
      nextSection = 'housing'
      nextHousingTab = 'message'
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
    } else if (nextSection === 'software' && (tabParam === 'demo' || tabParam === 'meeting')) {
      nextSoftwareTab = 'meeting'
    }

    setSection(nextSection)
    setHousingTab(nextHousingTab)
    setSoftwareTab(nextSoftwareTab)
  }, [location.pathname, location.search])

  return (
    <div className="bg-[linear-gradient(180deg,#edf2fb_0%,#eef3fb_48%,#f6f9fe_100%)]">
      <Seo
        title="Contact Axis | Housing Tours and Software Inquiries"
        description="Book a housing tour or ask about the Axis platform."
        pathname={location.pathname.startsWith('/owners/') ? '/owners/contact' : '/contact'}
      />
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="mx-auto max-w-5xl rounded-[32px] border border-white/90 bg-white/88 p-6 shadow-[0_30px_80px_rgba(37,99,235,0.10)] backdrop-blur sm:p-8">

          {/* Housing section */}
          {section === 'housing' && (
            <div>
              <div className="mb-6 border-b border-slate-100 pb-5">
                <h2 className="text-3xl font-black tracking-tight text-slate-900">
                  {housingTab === 'schedule' ? 'Schedule tour' : 'Message Axis'}
                </h2>
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
                tabs={[{ id: 'meeting', label: 'Set up meeting' }, { id: 'message', label: 'Send a message' }]}
                active={softwareTab} onChange={setSoftwareTab}
              />
              {softwareTab === 'meeting' && <DemoScheduler />}
              {softwareTab === 'message' && <SoftwareMessageForm />}
            </div>
          )}

        </div>
      </div>
    </div>
  )
}

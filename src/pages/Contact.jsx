import { useEffect, useState } from 'react'
import { Seo } from '../lib/seo'

function formatPhone(raw) {
  const digits = raw.replace(/\D/g, '').slice(0, 10)
  if (digits.length < 4) return digits
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

const AIRTABLE_BASE_ID = import.meta.env.VITE_AIRTABLE_BASE_ID || 'appNBX2inqfJMyqYV'
const AIRTABLE_TOKEN   = import.meta.env.VITE_AIRTABLE_TOKEN
const CONTACT_EMAIL    = 'info@axis-seattle-housing.com'

const inputCls  = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-axis focus:bg-white focus:ring-2 focus:ring-axis/20'
const selectCls = `${inputCls} appearance-none cursor-pointer`

const DEFAULT_PROPERTIES = [
  { id: '4709a', name: '4709A 8th Ave', address: '4709A 8th Ave NE, Seattle, WA', rooms: ['Room 1','Room 2','Room 3','Room 4','Room 5','Room 6','Room 7','Room 8','Room 9','Room 10'] },
  { id: '4709b', name: '4709B 8th Ave', address: '4709B 8th Ave NE, Seattle, WA', rooms: ['Room 1','Room 2','Room 3','Room 4','Room 5','Room 6','Room 7','Room 8','Room 9'] },
  { id: '5259',  name: '5259 Brooklyn Ave NE', address: '5259 Brooklyn Ave NE, Seattle, WA', rooms: ['Room 1','Room 2','Room 3','Room 4','Room 5','Room 6','Room 7','Room 8','Room 9'] },
]

// ── Shared success card ───────────────────────────────────────────────────────

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

// ── Housing — tour / leasing scheduler ───────────────────────────────────────

function HousingScheduler() {
  const [bookingType, setBookingType] = useState(null)
  const [step, setStep] = useState(1)
  const [property, setProperty] = useState(null)
  const [room, setRoom] = useState('')
  const [tourType, setTourType] = useState('in-person')
  const [properties, setProperties] = useState(DEFAULT_PROPERTIES)
  const [form, setForm] = useState({ name: '', email: '', phone: '', preferredDate: '', preferredTime: '', notes: '' })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const selectedProperty = properties.find(p => p.id === property)
  const todayStr = new Date().toISOString().split('T')[0]

  function setField(k, v) { setForm(prev => ({ ...prev, [k]: v })) }
  function reset() {
    setBookingType(null); setStep(1); setProperty(null); setRoom(''); setTourType('in-person')
    setForm({ name: '', email: '', phone: '', preferredDate: '', preferredTime: '', notes: '' })
    setSubmitted(false); setSubmitError('')
  }

  useEffect(() => {
    let cancelled = false
    fetch('/api/tour')
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return
        const next = Array.isArray(data?.properties) && data.properties.length ? data.properties : DEFAULT_PROPERTIES
        setProperties(next.map((item) => ({
          ...item,
          rooms: item.rooms || DEFAULT_PROPERTIES.find((fallback) => fallback.id === item.id)?.rooms || [],
        })))
      })
      .catch(() => {
        if (!cancelled) setProperties(DEFAULT_PROPERTIES)
      })
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
          type: bookingType === 'meeting' ? 'Meeting' : 'Tour',
          property: selectedProperty?.name || '', room: room || '',
          tourFormat: tourType === 'virtual' ? 'Virtual' : 'In-Person',
          manager: selectedProperty?.manager || '',
          tourAvailability: selectedProperty?.availability || '',
          preferredDate: form.preferredDate, preferredTime: form.preferredTime,
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
      title={bookingType === 'meeting' ? 'Meeting request sent!' : 'Tour request sent!'}
      body={`We'll reach out to ${form.email} to confirm within 1 business day.`}
      onReset={reset}
    />
  )

  // Step 0: choose type
  if (!bookingType) return (
    <div className="grid gap-4 sm:grid-cols-2">
      <button onClick={() => setBookingType('tour')}
        className="group flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 text-left transition-all hover:border-slate-900 hover:shadow-sm">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 transition-colors group-hover:bg-slate-900">
          <svg className="h-5 w-5 text-slate-600 transition-colors group-hover:text-white" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
          </svg>
        </div>
        <div>
          <div className="font-bold text-slate-900">Tour a Property</div>
          <p className="mt-1 text-sm leading-6 text-slate-500">Walk through a specific room. In-person or virtual.</p>
        </div>
        <div className="mt-auto flex items-center gap-1.5 text-xs font-semibold text-axis">
          Schedule tour <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>
        </div>
      </button>

      <button onClick={() => { setBookingType('meeting'); setStep(3) }}
        className="group flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-6 text-left transition-all hover:border-slate-900 hover:shadow-sm">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 transition-colors group-hover:bg-slate-900">
          <svg className="h-5 w-5 text-slate-600 transition-colors group-hover:text-white" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        </div>
        <div>
          <div className="font-bold text-slate-900">Discuss with Leasing</div>
          <p className="mt-1 text-sm leading-6 text-slate-500">Talk through pricing, lease terms, or availability.</p>
        </div>
        <div className="mt-auto flex items-center gap-1.5 text-xs font-semibold text-axis">
          Book a meeting <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>
        </div>
      </button>
    </div>
  )

  const tourSteps = [['1','Property'],['2','Room & Time'],['3','Your Details']]

  return (
    <div>
      <div className="mb-6 flex items-center justify-between border-b border-slate-100 pb-5">
        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-axis">
          {bookingType === 'tour' ? 'Schedule a Tour' : 'Contact Axis'}
        </div>
        <button onClick={reset} className="text-xs font-semibold text-slate-400 hover:text-slate-700">← Back</button>
      </div>

      {bookingType === 'tour' && (
        <div className="mb-8 flex items-center gap-2">
          {tourSteps.map(([s, label], idx) => (
            <div key={s} className="flex items-center gap-1.5">
              <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition-colors ${step > idx + 1 ? 'bg-[#2563eb] text-white' : step === idx + 1 ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-400'}`}>
                {step > idx + 1 ? <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg> : s}
              </div>
              <span className={`hidden text-xs font-medium sm:block ${step >= idx + 1 ? 'text-slate-700' : 'text-slate-400'}`}>{label}</span>
              {idx < 2 && <div className={`h-px w-4 shrink-0 sm:w-6 ${step > idx + 1 ? 'bg-[#2563eb]' : 'bg-slate-200'}`} />}
            </div>
          ))}
        </div>
      )}

      {bookingType === 'tour' && step === 1 && (
        <div className="space-y-3">
          {properties.map((p) => (
            <button key={p.id} onClick={() => { setProperty(p.id); setRoom(''); setStep(2) }}
              className="group flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4 text-left transition-all hover:border-slate-900 hover:shadow-sm">
              <div>
                <div className="font-semibold text-slate-900">{p.name}</div>
                <div className="mt-0.5 text-xs text-slate-500">{p.address}</div>
                {p.availability ? <div className="mt-1 text-xs font-medium text-[#2563eb]">{p.availability}</div> : null}
              </div>
              <svg className="h-4 w-4 text-slate-400 group-hover:text-slate-900" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>
            </button>
          ))}
        </div>
      )}

      {bookingType === 'tour' && step === 2 && selectedProperty && (
        <div className="space-y-6">
          <div>
            <div className="mb-3 text-sm font-semibold text-slate-700">Choose a room and time <span className="font-normal text-slate-400">({selectedProperty.name})</span></div>
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
            <div className="mb-3 text-sm font-semibold text-slate-700">Preferred tour time</div>
            <select value={form.preferredTime} onChange={e => setField('preferredTime', e.target.value)} className={selectCls}>
              <option value="">Choose a time</option>
              {(selectedProperty.availability ? selectedProperty.availability.split(',') : ['Morning', 'Afternoon', 'Evening']).map((slot) => {
                const value = slot.trim()
                return value ? <option key={value} value={value}>{value}</option> : null
              })}
            </select>
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
            <button onClick={() => setStep(3)} disabled={!room} className="rounded-full bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Continue</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          {bookingType === 'tour' && selectedProperty && (
            <div className="mb-2 flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-4 py-2.5 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-900">{selectedProperty.name}</span>
                <span className="text-slate-300">·</span><span className="text-slate-600">{room}</span>
                {selectedProperty?.availability ? <span className="text-slate-300">·</span> : null}
                {selectedProperty?.availability ? <span className="text-slate-600">{selectedProperty.availability}</span> : null}
                <span className="text-slate-300">·</span><span className="text-slate-600">{tourType === 'in-person' ? 'In-Person' : 'Virtual'}</span>
              </div>
              <button onClick={() => setStep(2)} className="ml-2 shrink-0 text-xs font-semibold text-slate-400 hover:text-slate-700">Edit</button>
            </div>
          )}
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
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700">Preferred Date</label>
              <input type="date" min={todayStr} className={inputCls} value={form.preferredDate} onChange={e => setField('preferredDate', e.target.value)} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-700">Preferred Time</label>
              <select className={selectCls} value={form.preferredTime} onChange={e => setField('preferredTime', e.target.value)}>
                <option value="">No preference</option>
                <option value="Morning (9am–12pm)">Morning (9am–12pm)</option>
                <option value="Afternoon (12pm–5pm)">Afternoon (12pm–5pm)</option>
                <option value="Evening (5pm–8pm)">Evening (5pm–8pm)</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700">
              {bookingType === 'meeting' ? 'What would you like to discuss?' : 'Questions or notes?'}
              <span className="ml-1 font-normal text-slate-400">(optional)</span>
            </label>
            <textarea className={`${inputCls} min-h-[90px] resize-y`} placeholder={bookingType === 'meeting' ? 'Pricing, lease terms, move-in timeline…' : "Anything specific you'd like to know…"} value={form.notes} onChange={e => setField('notes', e.target.value)} />
          </div>
          {submitError && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{submitError}</div>}
          <div className="flex gap-3 pt-2">
            {bookingType === 'tour' && (
              <button onClick={() => setStep(2)} className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600 hover:border-slate-400">Back</button>
            )}
            <button onClick={handleSchedule} disabled={!form.name.trim() || !form.email.trim() || submitting}
              className="flex-1 rounded-full bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] py-3 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(37,99,235,0.25)] hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity">
              {submitting ? 'Sending…' : bookingType === 'meeting' ? 'Request Meeting' : 'Request Tour'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Housing — message form ────────────────────────────────────────────────────

function HousingMessageForm() {
  const [form, setForm] = useState({ name: '', email: '', phone: '', message: '' })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })) }

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
      onReset={() => { setSubmitted(false); setForm({ name: '', email: '', phone: '', message: '' }) }} resetLabel="Send another" />
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

// ── Software — demo request form ──────────────────────────────────────────────

function SoftwareDemoForm() {
  const [form, setForm] = useState({ name: '', email: '', phone: '', company: '', size: '', message: '' })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })) }

  async function handleSubmit(e) {
    e.preventDefault(); setSubmitting(true); setError('')
    const summary = [
      form.company ? `Company: ${form.company}` : '',
      form.size    ? `Portfolio size: ${form.size}` : '',
      form.message,
    ].filter(Boolean).join('\n')
    try {
      const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Inquiries`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { 'Full Name': form.name, 'Email': form.email, 'Phone Number': form.phone, 'Inquiry Type': 'Software', 'Message Summary': summary }, typecast: true }),
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
    <SuccessCard title="Request received!" body={`We'll reach out to ${form.email} within 1 business day.`}
      onReset={() => { setSubmitted(false); setForm({ name: '', email: '', phone: '', company: '', size: '', message: '' }) }} resetLabel="Send another" />
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
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-slate-700">Phone</label>
          <input type="tel" className={inputCls} placeholder="(206) 555-0100" value={form.phone} onChange={e => set('phone', formatPhone(e.target.value))} />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-slate-700">Company / Portfolio name</label>
          <input className={inputCls} placeholder="Smith Properties" value={form.company} onChange={e => set('company', e.target.value)} />
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-semibold text-slate-700">Number of properties</label>
        <select className={selectCls} value={form.size} onChange={e => set('size', e.target.value)}>
          <option value="">Select…</option>
          <option value="1–2">1–2 properties</option>
          <option value="3–5">3–5 properties</option>
          <option value="6–10">6–10 properties</option>
          <option value="10+">10+ properties</option>
        </select>
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-semibold text-slate-700">What are you looking for? <span className="text-axis">*</span></label>
        <textarea required className={`${inputCls} min-h-[100px] resize-y`} placeholder="Tell us about your properties and what you'd like Axis to help with…" value={form.message} onChange={e => set('message', e.target.value)} />
      </div>
      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <button type="submit" disabled={submitting} className="w-full rounded-full bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] py-3.5 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(37,99,235,0.25)] hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed transition-opacity">
        {submitting ? 'Sending…' : 'Request a demo'}
      </button>
    </form>
  )
}

// ── Software — general message form ──────────────────────────────────────────

function SoftwareMessageForm() {
  const [form, setForm] = useState({ name: '', email: '', topic: '', message: '' })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })) }

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
      onReset={() => { setSubmitted(false); setForm({ name: '', email: '', topic: '', message: '' }) }} resetLabel="Send another" />
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
  const [section, setSection] = useState(null) // null | 'housing' | 'software'
  const [housingTab, setHousingTab] = useState('schedule')
  const [softwareTab, setSoftwareTab] = useState('demo')

  return (
    <div className="bg-[linear-gradient(180deg,#edf2fb_0%,#eef3fb_48%,#f6f9fe_100%)]">
      <Seo
        title="Contact Axis | Housing Tours and Software Inquiries"
        description="Schedule a property tour or reach out about the Axis property management platform."
        pathname="/contact"
      />
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="mx-auto max-w-5xl rounded-[32px] border border-white/90 bg-white/88 p-6 shadow-[0_30px_80px_rgba(37,99,235,0.10)] backdrop-blur sm:p-8">

          {/* Section chooser */}
          {!section && (
            <div>
              <h2 className="text-3xl font-black tracking-tight text-slate-900">How can we help?</h2>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">

                {/* Housing */}
                <button onClick={() => setSection('housing')}
                  className="group flex flex-col gap-5 rounded-2xl border border-slate-200 bg-white p-6 text-left transition-all hover:border-slate-900 hover:shadow-sm">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 transition-colors group-hover:bg-slate-900">
                    <svg className="h-6 w-6 text-slate-600 transition-colors group-hover:text-white" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Axis Housing</div>
                    <div className="mt-1 text-lg font-black text-slate-900">Looking for a place to live</div>
                    <p className="mt-2 text-sm leading-6 text-slate-500">Tour our Seattle properties, ask about availability, or talk through pricing and lease options.</p>
                  </div>
                  <div className="mt-auto flex items-center gap-1.5 text-xs font-semibold text-axis">
                    Get in touch <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>
                  </div>
                </button>

                {/* Software */}
                <button onClick={() => setSection('software')}
                  className="group flex flex-col gap-5 rounded-2xl border border-slate-200 bg-white p-6 text-left transition-all hover:border-[#2563eb] hover:shadow-sm">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 transition-colors group-hover:bg-[#2563eb]">
                    <svg className="h-6 w-6 text-[#2563eb] transition-colors group-hover:text-white" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0H3" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#2563eb]">Axis Software</div>
                    <div className="mt-1 text-lg font-black text-slate-900">Managing properties</div>
                    <p className="mt-2 text-sm leading-6 text-slate-500">Learn how Axis helps small property owners collect rent, manage work orders, and communicate with tenants.</p>
                  </div>
                  <div className="mt-auto flex items-center gap-1.5 text-xs font-semibold text-[#2563eb]">
                    Book a demo <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/></svg>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Housing section */}
          {section === 'housing' && (
            <div>
              <div className="mb-6 flex items-center justify-between border-b border-slate-100 pb-5">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Axis Housing</div>
                  <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-900">Contact leasing</h2>
                </div>
                <button onClick={() => setSection(null)} className="text-xs font-semibold text-slate-400 hover:text-slate-700">← Back</button>
              </div>
              <TabBar
                tabs={[{ id: 'schedule', label: 'Schedule a Tour' }, { id: 'message', label: 'Contact Axis' }]}
                active={housingTab} onChange={setHousingTab}
              />
              {housingTab === 'schedule' && <HousingScheduler />}
              {housingTab === 'message'  && <HousingMessageForm />}
            </div>
          )}

          {/* Software section */}
          {section === 'software' && (
            <div>
              <div className="mb-6 flex items-center justify-between border-b border-slate-100 pb-5">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#2563eb]">Axis Software</div>
                  <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-900">Contact our team</h2>
                </div>
                <button onClick={() => setSection(null)} className="text-xs font-semibold text-slate-400 hover:text-slate-700">← Back</button>
              </div>
              <TabBar
                tabs={[{ id: 'demo', label: 'Request a Demo' }, { id: 'message', label: 'Send a Message' }]}
                active={softwareTab} onChange={setSoftwareTab}
              />
              {softwareTab === 'demo'    && <SoftwareDemoForm />}
              {softwareTab === 'message' && <SoftwareMessageForm />}
            </div>
          )}

        </div>
      </div>
    </div>
  )
}

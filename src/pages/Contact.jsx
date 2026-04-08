import { useState } from 'react'
import { Seo } from '../lib/seo'
import { properties } from '../data/properties'

const CONTACT_PHONE_DISPLAY = '(510) 309-8345'
const CONTACT_PHONE_RAW = '15103098345'
const CONTACT_EMAIL = 'info@axis-seattle-housing.com'

const AIRTABLE_BASE_ID = import.meta.env.VITE_AIRTABLE_APPLICATIONS_BASE_ID || 'appNBX2inqfJMyqYV'
const AIRTABLE_INQUIRIES_TABLE = 'Inquiries'
const AIRTABLE_TOKEN = import.meta.env.VITE_AIRTABLE_TOKEN

const inputCls = 'w-full border-0 border-b border-slate-200 bg-transparent pb-3 pt-1 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-slate-900 focus:ring-0'
const selectCls = `${inputCls} appearance-none cursor-pointer`

const CONTACT_INQUIRY_TYPES = [
  'General',
  'Current room availability',
  'Lease length and pricing',
  'Pricing & fees',
  'Application follow-up',
  'Other',
]

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10)
}

function Label({ children }) {
  return (
    <label className="mb-2 block text-[11px] font-semibold uppercase tracking-widest text-slate-400">
      {children}
    </label>
  )
}

async function postToAirtable(fields) {
  const res = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_INQUIRIES_TABLE)}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields, typecast: true }),
    }
  )
  if (!res.ok) {
    const body = await res.text()
    let msg = `Error ${res.status}`
    try { msg += ': ' + JSON.parse(body)?.error?.message } catch { msg += ': ' + body }
    throw new Error(msg)
  }
}

// ─── Tour Request Form ────────────────────────────────────────────────────────

const ROOM_OPTIONS = {
  '4709A 8th Ave NE': Array.from({ length: 10 }, (_, i) => `Room ${i + 1}`),
  '4709B 8th Ave NE': Array.from({ length: 9 }, (_, i) => `Room ${i + 1}`),
  '5259 Brooklyn Ave NE': Array.from({ length: 9 }, (_, i) => `Room ${i + 1}`),
}

const TIME_SLOTS = [
  'Flexible',
  '9:00 AM – 11:00 AM',
  '11:00 AM – 1:00 PM',
  '1:00 PM – 3:00 PM',
  '3:00 PM – 5:00 PM',
  '5:00 PM – 7:00 PM',
]

function TourRequestForm() {
  const [form, setForm] = useState({
    name: '', email: '', phone: '',
    property: '', room: '', tourType: 'in-person',
    preferredDate: '', preferredTime: '', notes: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  function set(key, val) { setForm(prev => ({ ...prev, [key]: val })) }

  const rooms = form.property ? (ROOM_OPTIONS[form.property] || []) : []

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await postToAirtable({
        'Full Name': form.name,
        'Email': form.email,
        'Phone Number': form.phone,
        'Property': form.property,
        'Inquiry Type': 'Schedule a tour',
        'Message Summary': [
          `Room: ${form.room || 'Not specified'}`,
          `Tour Type: ${form.tourType === 'in-person' ? 'In-Person' : 'Virtual'}`,
          `Preferred Date: ${form.preferredDate || 'Flexible'}`,
          `Preferred Time: ${form.preferredTime || 'Flexible'}`,
          form.notes ? `Notes: ${form.notes}` : '',
        ].filter(Boolean).join('\n'),
      })
      setSubmitted(true)
    } catch (err) {
      setError(err.message || 'Submission failed.')
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="py-16 text-center">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-teal-50">
          <svg className="h-6 w-6 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="text-lg font-semibold text-slate-900">Tour request received</p>
        <p className="mt-2 text-sm text-slate-500">
          We'll reach out to <strong>{form.email}</strong> to confirm your tour time.
        </p>
        <button
          onClick={() => { setSubmitted(false); setForm({ name: '', email: '', phone: '', property: '', room: '', tourType: 'in-person', preferredDate: '', preferredTime: '', notes: '' }) }}
          className="mt-6 text-xs font-semibold text-slate-500 underline-offset-2 hover:underline"
        >
          Request another tour
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <div className="grid gap-8 sm:grid-cols-2">
        <div>
          <Label>Name <span className="text-rose-400">*</span></Label>
          <input required className={inputCls} placeholder="Jane Smith" value={form.name} onChange={e => set('name', e.target.value)} />
        </div>
        <div>
          <Label>Email <span className="text-rose-400">*</span></Label>
          <input required type="email" className={inputCls} placeholder="jane@email.com" value={form.email} onChange={e => set('email', e.target.value)} />
        </div>
      </div>

      <div className="grid gap-8 sm:grid-cols-2">
        <div>
          <Label>Phone <span className="text-rose-400">*</span></Label>
          <input required type="tel" className={inputCls} placeholder="(206) 555-0100" value={form.phone} onChange={e => set('phone', e.target.value)} />
        </div>
        <div>
          <Label>Property <span className="text-rose-400">*</span></Label>
          <select required className={selectCls} value={form.property} onChange={e => set('property', e.target.value)}>
            <option value="" disabled>Select a property…</option>
            {properties.map(p => <option key={p.slug} value={p.name}>{p.name}</option>)}
          </select>
        </div>
      </div>

      <div className="grid gap-8 sm:grid-cols-2">
        <div>
          <Label>Room</Label>
          <select className={selectCls} value={form.room} onChange={e => set('room', e.target.value)} disabled={!form.property}>
            <option value="">Not sure yet</option>
            {rooms.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <Label>Tour Type</Label>
          <div className="flex gap-3 pt-1">
            {[['in-person', 'In-Person'], ['virtual', 'Virtual']].map(([val, label]) => (
              <button key={val} type="button" onClick={() => set('tourType', val)}
                className={`flex-1 rounded-lg border py-2.5 text-sm font-semibold transition-all ${form.tourType === val ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-400'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-8 sm:grid-cols-2">
        <div>
          <Label>Preferred Date</Label>
          <input type="date" min={todayIsoDate()} className={inputCls} value={form.preferredDate} onChange={e => set('preferredDate', e.target.value)} />
        </div>
        <div>
          <Label>Preferred Time</Label>
          <select className={selectCls} value={form.preferredTime} onChange={e => set('preferredTime', e.target.value)}>
            {TIME_SLOTS.map(s => <option key={s} value={s === 'Flexible' ? '' : s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div>
        <Label>Notes</Label>
        <textarea className={`${inputCls} min-h-[80px] resize-y`} placeholder="Anything else we should know?" value={form.notes} onChange={e => set('notes', e.target.value)} />
      </div>

      {error && (
        <p className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      <div className="pt-1">
        <button type="submit" disabled={submitting}
          className="rounded-full bg-slate-900 px-8 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50">
          {submitting ? 'Sending…' : 'Request a tour'}
        </button>
      </div>
    </form>
  )
}

// ─── Contact Message Form ─────────────────────────────────────────────────────

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
      `Property: ${form.property || 'Not specified'}`,
      `Topic: ${form.topic || 'Not specified'}`,
      `Message:\n${form.message}`,
    ].join('\n')
    return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`Contact: ${form.name}`)}&body=${encodeURIComponent(body)}`
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      await postToAirtable({
        'Full Name': form.name,
        'Email': form.email,
        'Phone Number': form.phone,
        'Property': form.property,
        'Inquiry Type': form.topic,
        'Message Summary': form.message,
      })
      setSubmitted(true)
    } catch (err) {
      setError(err.message || 'Submission failed.')
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="py-16 text-center">
        <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-teal-50">
          <svg className="h-6 w-6 text-teal-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="text-lg font-semibold text-slate-900">Message sent!</p>
        <p className="mt-2 text-sm text-slate-500">
          We'll follow up at <strong>{form.email}</strong> within 2 business days.
        </p>
        <button
          onClick={() => { setSubmitted(false); setForm({ name: '', email: '', phone: '', property: '', topic: '', message: '' }) }}
          className="mt-6 text-xs font-semibold text-slate-500 underline-offset-2 hover:underline"
        >
          Send another message
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <div className="grid gap-8 sm:grid-cols-2">
        <div>
          <Label>Name <span className="text-rose-400">*</span></Label>
          <input required className={inputCls} placeholder="Jane Smith" value={form.name} onChange={e => set('name', e.target.value)} />
        </div>
        <div>
          <Label>Email <span className="text-rose-400">*</span></Label>
          <input required type="email" className={inputCls} placeholder="jane@email.com" value={form.email} onChange={e => set('email', e.target.value)} />
        </div>
      </div>

      <div className="grid gap-8 sm:grid-cols-2">
        <div>
          <Label>Phone <span className="text-rose-400">*</span></Label>
          <input required type="tel" className={inputCls} placeholder="(206) 555-0100" value={form.phone} onChange={e => set('phone', e.target.value)} />
        </div>
        <div>
          <Label>Property <span className="text-rose-400">*</span></Label>
          <select required className={selectCls} value={form.property} onChange={e => set('property', e.target.value)}>
            <option value="" disabled>Select a property…</option>
            {properties.map(p => <option key={p.slug} value={p.name}>{p.name}</option>)}
          </select>
        </div>
      </div>

      <div>
        <Label>Inquiry Type <span className="text-rose-400">*</span></Label>
        <select required className={selectCls} value={form.topic} onChange={e => set('topic', e.target.value)}>
          <option value="" disabled>Select a topic…</option>
          {CONTACT_INQUIRY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      <div>
        <Label>Message <span className="text-rose-400">*</span></Label>
        <textarea required className={`${inputCls} min-h-[110px] resize-y`}
          placeholder="Ask about availability, pricing, move-in dates…"
          value={form.message} onChange={e => set('message', e.target.value)} />
      </div>

      {error && (
        <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 space-y-2">
          <p className="text-sm text-red-700">{error}</p>
          <a href={buildMailto()} className="text-xs font-semibold text-red-700 underline">Email us directly instead</a>
        </div>
      )}

      <div className="pt-1">
        <button type="submit" disabled={submitting}
          className="rounded-full bg-slate-900 px-8 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50">
          {submitting ? 'Sending…' : 'Send message'}
        </button>
      </div>
    </form>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Contact() {
  const [activeTab, setActiveTab] = useState('message')

  const tabs = [
    { id: 'message', label: 'Send a message' },
    { id: 'schedule', label: 'Schedule a tour' },
  ]

  return (
    <div className="flex min-h-[calc(100vh-64px)] flex-col lg:flex-row">
      <Seo
        title="Contact Axis Seattle | Tours and Housing Availability"
        description="Contact Axis Seattle to ask about room availability, schedule a tour, or learn more about affordable housing options in Seattle."
        pathname="/contact"
      />

      {/* ── Left info panel ── */}
      <div className="flex flex-col justify-between bg-slate-900 px-8 py-12 text-white lg:sticky lg:top-0 lg:h-[calc(100vh-64px)] lg:w-[380px] lg:shrink-0 lg:overflow-auto xl:w-[440px] lg:px-10 lg:py-14">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Axis Seattle</div>
          <h1 className="font-editorial mt-5 text-5xl leading-[1.05] text-white">
            Get in<br />touch.
          </h1>
          <p className="mt-5 max-w-xs text-sm leading-7 text-slate-400">
            Reach us directly — no bots, no general inbox. Ask about availability, tours, or pricing.
          </p>

          <div className="mt-10 space-y-7">
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">Phone</div>
              <a href={`tel:${CONTACT_PHONE_RAW}`} className="text-xl font-semibold text-white transition-colors hover:text-teal-300">
                {CONTACT_PHONE_DISPLAY}
              </a>
              <div className="mt-1.5 flex gap-3 text-xs text-slate-500">
                <a href={`tel:${CONTACT_PHONE_RAW}`} className="transition-colors hover:text-slate-300">Call</a>
                <span>·</span>
                <a href={`sms:${CONTACT_PHONE_RAW}`} className="transition-colors hover:text-slate-300">Text</a>
              </div>
            </div>
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">Email</div>
              <a href={`mailto:${CONTACT_EMAIL}`} className="break-all text-sm text-slate-300 transition-colors hover:text-white">
                {CONTACT_EMAIL}
              </a>
            </div>
          </div>
        </div>

        <div className="mt-12 space-y-7 border-t border-slate-800 pt-8">
          <div>
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-500">Office Hours</div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-400">Mon – Fri</span>
                <span className="text-slate-300">9am – 6pm</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Saturday</span>
                <span className="text-slate-300">10am – 4pm</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Sunday</span>
                <span className="text-slate-300">By appointment</span>
              </div>
            </div>
          </div>
          <div>
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-slate-500">Properties</div>
            <div className="space-y-1 text-xs leading-7 text-slate-400">
              <div>4709A &amp; 4709B 8th Ave NE</div>
              <div>5259 Brooklyn Ave NE</div>
              <div className="text-slate-600">Seattle, WA</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Right form panel ── */}
      <div className="flex-1 bg-white px-6 py-12 sm:px-10 lg:px-12 lg:py-14">
        <div className="mx-auto max-w-xl">
          {/* Mobile contact strip */}
          <div className="mb-10 lg:hidden">
            <h2 className="font-editorial text-4xl text-slate-900">Get in touch.</h2>
            <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-500">
              <a href={`tel:${CONTACT_PHONE_RAW}`} className="hover:text-slate-900">{CONTACT_PHONE_DISPLAY}</a>
              <span className="text-slate-200">·</span>
              <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-slate-900">{CONTACT_EMAIL}</a>
            </div>
          </div>

          {/* Underline tab switcher */}
          <div className="mb-10 flex gap-7 border-b border-slate-100">
            {tabs.map(({ id, label }) => (
              <button key={id} onClick={() => setActiveTab(id)}
                className={`-mb-px border-b-2 pb-4 text-sm font-semibold transition-all ${activeTab === id ? 'border-slate-900 text-slate-900' : 'border-transparent text-slate-400 hover:text-slate-700'}`}>
                {label}
              </button>
            ))}
          </div>

          {activeTab === 'schedule' && <TourRequestForm />}
          {activeTab === 'message' && <ContactMessageForm />}
        </div>
      </div>
    </div>
  )
}

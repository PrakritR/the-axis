import { useState, useRef } from 'react'
import emailjs from '@emailjs/browser'
import { Seo } from '../lib/seo'

function formatPhone(raw) {
  const digits = raw.replace(/\D/g, '').slice(0, 10)
  if (digits.length < 4) return digits
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

function AddressAutocomplete({ value, onChange, onSelect, placeholder, className, required }) {
  const [suggestions, setSuggestions] = useState([])
  const [open, setOpen] = useState(false)
  const debounceRef = useRef(null)

  function handleChange(e) {
    const val = e.target.value
    onChange(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (val.length < 5) { setSuggestions([]); return }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&countrycodes=us&q=${encodeURIComponent(val)}`,
          { headers: { 'Accept-Language': 'en-US', 'User-Agent': 'AxisSeattleHousing/1.0' } }
        )
        const data = await res.json()
        setSuggestions(data)
        setOpen(data.length > 0)
      } catch { setSuggestions([]) }
    }, 450)
  }

  function handleSelect(s) {
    const addr = s.address || {}
    const street = [addr.house_number, addr.road].filter(Boolean).join(' ')
    const city = addr.city || addr.town || addr.village || addr.hamlet || ''
    const state = addr.state || ''
    const zip = addr.postcode || ''
    onChange(street)
    onSelect?.({ city, state, zip, full: s.display_name })
    setSuggestions([])
    setOpen(false)
  }

  return (
    <div className="relative">
      <input type="text" value={value} onChange={handleChange} required={required}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 180)}
        placeholder={placeholder} autoComplete="off" className={className} />
      {open && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1.5 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
          {suggestions.map((s, i) => (
            <button key={i} type="button" onMouseDown={() => handleSelect(s)}
              className="flex w-full items-start gap-2.5 px-4 py-2.5 text-left text-sm hover:bg-slate-50">
              <svg className="mt-0.5 h-4 w-4 shrink-0 text-axis" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
              </svg>
              <span className="text-slate-700 leading-snug">{s.display_name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const PUBLIC_KEY  = import.meta.env.VITE_EMAILJS_PUBLIC_KEY
const SERVICE_ID  = import.meta.env.VITE_EMAILJS_SERVICE_ID
const TEMPLATE_ID = import.meta.env.VITE_EMAILJS_TEMPLATE_ID

if (PUBLIC_KEY) {
  emailjs.init({ publicKey: PUBLIC_KEY })
}

const PROPERTY_TYPES = [
  'Single-family home',
  'Multi-unit building',
  'Duplex / triplex',
  'Condo / apartment',
  'Other',
]

const ROOM_COUNTS = ['1–3', '4–6', '7–10', '10+']

const WHY_AXIS = [
  {
    icon: (
      <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z" />
      </svg>
    ),
    title: 'One manager portal',
    body: 'Keep your manager application, houses, applications, leases, and resident operations in one simpler workflow.',
  },
  {
    icon: (
      <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75" />
      </svg>
    ),
    title: 'Simple manager onboarding',
    body: 'Apply to join Axis, create a manager account, and activate the recurring subscription right from the same flow.',
  },
  {
    icon: (
      <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 010 4.657c-.784.814-1.787 1.245-2.8 1.245a3.745 3.745 0 01-3.068-1.593 3.745 3.745 0 01-4.657 0 3.745 3.745 0 01-1.245-2.8c0-1.013.431-2.016 1.245-2.8a3.745 3.745 0 010-4.657 3.745 3.745 0 011.593-3.068A3.745 3.745 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.745 3.745 0 014.657 0c.814.784 1.245 1.787 1.245 2.8z" />
      </svg>
    ),
    title: 'Leasing workflow built in',
    body: 'Review applications, move approved residents forward, and handle leasing without bouncing between tools.',
  },
  {
    icon: (
      <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
      </svg>
    ),
    title: 'Add houses as you grow',
    body: 'Once approved, managers can add houses to the portal and keep property operations organized as they expand.',
  },
  {
    icon: (
      <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5M9 11.25v1.5M12 9v3.75m3-6v6" />
      </svg>
    ),
    title: 'Resident operations',
    body: 'Track resident details, internal notes, and follow-up work from the same portal you use for leasing.',
  },
]

const STEPS = [
  { number: '01', title: 'Apply to join Axis', body: 'Tell us about your housing setup and who will operate the property through the manager portal.' },
  { number: '02', title: 'We review the application', body: 'Our team follows up to confirm fit, answer questions, and approve the manager setup.' },
  { number: '03', title: 'Create account and subscribe', body: 'Approved managers create their account and activate the recurring manager subscription to unlock portal access.' },
  { number: '04', title: 'Add houses and lease', body: 'Use the manager portal to add houses, review applications, and manage the leasing workflow.' },
]

function classNames(...vals) {
  return vals.filter(Boolean).join(' ')
}

export default function JoinUs() {
  const [form, setForm] = useState({
    ownerName: '',
    email: '',
    phone: '',
    propertyAddress: '',
    city: '',
    propertyType: PROPERTY_TYPES[0],
    roomCount: ROOM_COUNTS[0],
    currentlyRented: '',
    additionalNotes: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  function update(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setSubmitting(true)
    setError('')

    const templateParams = {
      from_name: form.ownerName,
      from_email: form.email,
      phone: form.phone || 'Not provided',
      property_address: `${form.propertyAddress}, ${form.city}`,
      property_type: form.propertyType,
      room_count: form.roomCount,
      currently_rented: form.currentlyRented || 'Not specified',
      additional_notes: form.additionalNotes || 'None',
      subject: `Partner Property Inquiry — ${form.propertyAddress}`,
      message: `New property owner inquiry from the Join Us page.\n\nOwner: ${form.ownerName}\nEmail: ${form.email}\nPhone: ${form.phone || 'Not provided'}\nAddress: ${form.propertyAddress}, ${form.city}\nProperty Type: ${form.propertyType}\nRooms: ${form.roomCount}\nCurrently rented: ${form.currentlyRented || 'Not specified'}\n\nNotes:\n${form.additionalNotes || 'None'}`,
    }

    try {
      if (!SERVICE_ID || !TEMPLATE_ID || !PUBLIC_KEY) throw new Error('EmailJS not configured')
      await emailjs.send(SERVICE_ID, TEMPLATE_ID, templateParams)
      setSubmitted(true)
    } catch {
      // Fallback: open a pre-filled mailto so the submission is never lost
      const body = encodeURIComponent(templateParams.message)
      const subject = encodeURIComponent(templateParams.subject)
      window.location.href = `mailto:info@axis-seattle-housing.com?subject=${subject}&body=${body}`
      setSubmitted(true)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Seo
        title="Join Axis | Axis Seattle Housing"
        description="Apply to join Axis, create a manager account, activate the recurring subscription, and use the manager portal to add houses, review applications, and manage leasing."
        pathname="/join-us"
      />

      {/* Hero */}
      <section className="relative overflow-hidden bg-navy-950 pb-24 pt-20 sm:pt-28">
        <div className="pointer-events-none absolute inset-0 bg-dot-grid-dark bg-dot-md opacity-60" aria-hidden />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_0%,rgba(14,165,164,0.12),transparent)]" aria-hidden />

        <div className="container relative mx-auto max-w-4xl px-6 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-axis/30 bg-axis/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-axis">
            Manager application
          </div>
          <h1 className="mt-6 font-serif text-5xl font-bold leading-tight tracking-tight text-white sm:text-6xl lg:text-7xl">
            Join Axis
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-8 text-white/60 sm:text-lg">
            Apply to join Axis as a manager, create your account, activate the recurring subscription, and use one portal to add houses, review applications, and manage leasing.
          </p>
          <div className="mx-auto mt-6 max-w-xl rounded-[24px] border border-white/10 bg-white/5 px-6 py-4 text-left backdrop-blur-sm">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-axis">Manager subscription</p>
            <p className="mt-2 text-sm leading-7 text-white/70">
              Manager portal access is activated after account setup and recurring subscription checkout. Once approved, you can log in and start adding houses right away.
            </p>
          </div>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <a
              href="#inquiry-form"
              className="inline-flex items-center gap-2 rounded-full bg-axis px-6 py-3.5 text-sm font-semibold text-white shadow-[0_0_24px_rgba(14,165,164,0.4)] transition hover:bg-axis-dark"
            >
              Apply to join
              <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </a>
            <a
              href="mailto:info@axis-seattle-housing.com"
              className="inline-flex items-center gap-2 rounded-full border border-white/20 px-6 py-3.5 text-sm font-semibold text-white/80 transition hover:border-axis hover:text-axis"
            >
              Contact the team
            </a>
          </div>
        </div>
      </section>

      {/* Why Axis */}
      <section className="bg-white py-20 sm:py-28">
        <div className="container mx-auto max-w-6xl px-6">
          <div className="mb-14 text-center">
            <h2 className="font-serif text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
              What you get
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-slate-500">
              A simpler manager setup built around one application flow and one operating portal.
            </p>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {WHY_AXIS.map((item) => (
              <div
                key={item.title}
                className="group rounded-[24px] border border-slate-200 bg-white p-6 shadow-soft transition hover:border-axis/40 hover:shadow-card"
              >
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-axis/10 text-axis transition group-hover:bg-axis group-hover:text-white">
                  {item.icon}
                </div>
                <h3 className="text-base font-bold text-slate-900">{item.title}</h3>
                <p className="mt-2 text-sm leading-7 text-slate-500">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="bg-slate-50 py-20 sm:py-28">
        <div className="container mx-auto max-w-4xl px-6">
          <div className="mb-14 text-center">
            <h2 className="font-serif text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
              How it works
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-base leading-7 text-slate-500">
              From manager application to active portal access.
            </p>
          </div>

          <div className="relative space-y-6">
            <div className="absolute left-[27px] top-10 hidden h-[calc(100%-80px)] w-px bg-slate-200 sm:block" aria-hidden />

            {STEPS.map((step) => (
              <div key={step.number} className="relative flex gap-6">
                <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-axis bg-white text-sm font-black text-axis shadow-soft">
                  {step.number}
                </div>
                <div className="flex-1 rounded-[20px] border border-slate-200 bg-white p-5 shadow-soft">
                  <h3 className="text-base font-bold text-slate-900">{step.title}</h3>
                  <p className="mt-1.5 text-sm leading-7 text-slate-500">{step.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Inquiry form */}
      <section id="inquiry-form" className="bg-white py-20 sm:py-28">
        <div className="container mx-auto max-w-2xl px-6">
          <div className="mb-10 text-center">
            <h2 className="font-serif text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
              Apply to join Axis
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-base leading-7 text-slate-500">
              Share your property details and manager plan. We’ll review it, follow up, and help you move into account setup and subscription activation.
            </p>
          </div>

          {submitted ? (
            <div className="rounded-[28px] border border-emerald-200 bg-emerald-50 px-8 py-12 text-center">
              <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                <svg className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-slate-900">We received your inquiry</h3>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                Thanks for reaching out. Our team will review your property and manager application details and contact you within 2–3 business days at{' '}
                <span className="font-semibold">{form.email}</span>.
              </p>
            </div>
          ) : (
            <form
              onSubmit={handleSubmit}
              className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-soft sm:p-8"
            >
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="mb-2 block text-sm font-semibold text-slate-700">
                    Manager name <span className="text-red-500">*</span>
                  </label>
                  <input
                    required
                    type="text"
                    value={form.ownerName}
                    onChange={(e) => update('ownerName', e.target.value)}
                    placeholder="Jane Smith"
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-axis focus:ring-2 focus:ring-axis/20"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">
                    Email <span className="text-red-500">*</span>
                  </label>
                  <input
                    required
                    type="email"
                    value={form.email}
                    onChange={(e) => update('email', e.target.value)}
                    placeholder="jane@example.com"
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-axis focus:ring-2 focus:ring-axis/20"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">Phone <span className="text-red-500">*</span></label>
                  <input
                    required
                    type="tel"
                    value={form.phone}
                    onChange={(e) => update('phone', formatPhone(e.target.value))}
                    placeholder="(206) 555-0100"
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-axis focus:ring-2 focus:ring-axis/20"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="mb-2 block text-sm font-semibold text-slate-700">
                    Property street address <span className="text-red-500">*</span>
                  </label>
                  <AddressAutocomplete
                    required
                    value={form.propertyAddress}
                    onChange={(val) => update('propertyAddress', val)}
                    onSelect={({ city, state, zip }) => {
                      update('city', [city, state, zip].filter(Boolean).join(', '))
                    }}
                    placeholder="1234 Brooklyn Ave NE"
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-axis focus:ring-2 focus:ring-axis/20"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">
                    City / State / ZIP <span className="text-red-500">*</span>
                  </label>
                  <input
                    required
                    type="text"
                    value={form.city}
                    onChange={(e) => update('city', e.target.value)}
                    placeholder="Seattle, WA 98105"
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-axis focus:ring-2 focus:ring-axis/20"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">
                    Housing type <span className="text-red-500">*</span>
                  </label>
                  <select
                    required
                    value={form.propertyType}
                    onChange={(e) => update('propertyType', e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-axis focus:ring-2 focus:ring-axis/20"
                  >
                    {PROPERTY_TYPES.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-700">
                    Number of rooms <span className="text-red-500">*</span>
                  </label>
                  <select
                    required
                    value={form.roomCount}
                    onChange={(e) => update('roomCount', e.target.value)}
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-axis focus:ring-2 focus:ring-axis/20"
                  >
                    {ROOM_COUNTS.map((r) => <option key={r}>{r}</option>)}
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="mb-2 block text-sm font-semibold text-slate-700">
                    Is the property currently rented?
                  </label>
                  <div className="flex flex-wrap gap-3">
                    {['Yes — currently occupied', 'No — vacant', 'Partially occupied'].map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => update('currentlyRented', option)}
                        className={classNames(
                          'rounded-full border px-4 py-2 text-sm font-semibold transition',
                          form.currentlyRented === option
                            ? 'border-axis bg-axis/10 text-axis'
                            : 'border-slate-200 text-slate-600 hover:border-slate-400'
                        )}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="sm:col-span-2">
                  <label className="mb-2 block text-sm font-semibold text-slate-700">
                    Anything else we should know?
                  </label>
                  <textarea
                    rows={4}
                    value={form.additionalNotes}
                    onChange={(e) => update('additionalNotes', e.target.value)}
                    placeholder="How many houses you manage, leasing questions, target timeline, or anything else helpful..."
                    className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-axis focus:ring-2 focus:ring-axis/20"
                  />
                </div>
              </div>

              <div className="mt-6 rounded-[22px] border border-axis/20 bg-axis/5 px-5 py-4">
                <p className="text-sm font-semibold text-slate-900">Subscription note</p>
                <p className="mt-1 text-sm leading-7 text-slate-600">
                  Approved managers finish account creation with the recurring manager subscription checkout before using the portal.
                </p>
              </div>

              {error ? (
                <div className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              ) : null}

              <div className="mt-6 flex flex-wrap items-center gap-4">
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
                >
                  {submitting ? 'Sending...' : 'Submit inquiry'}
                  {!submitting && (
                    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden>
                      <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
                <p className="text-xs text-slate-400">
                  No commitment required. We'll review and reach out within 2–3 business days.
                </p>
              </div>
            </form>
          )}
        </div>
      </section>
    </>
  )
}

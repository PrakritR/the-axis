import { useState } from 'react'
import { Seo } from '../lib/seo'
import { properties } from '../data/properties'

// Use VITE_AIRTABLE_APPLICATIONS_BASE_ID if set, otherwise fall back to the main base
const AIRTABLE_BASE_ID = import.meta.env.VITE_AIRTABLE_APPLICATIONS_BASE_ID || import.meta.env.VITE_AIRTABLE_BASE_ID || 'appNBX2inqfJMyqYV'
const AIRTABLE_TABLE = import.meta.env.VITE_AIRTABLE_APPLICATIONS_TABLE || 'Applications'
const AIRTABLE_TOKEN = import.meta.env.VITE_AIRTABLE_TOKEN

const LEASE_TERMS = [
  '3-Month Summer (Jun 16 – Sep 14)',
  '9-Month Academic (Sep 15 – Jun 15)',
  '12-Month (flexible start)',
  'Other / Custom dates',
]

const PROPERTY_OPTIONS = properties.map(p => ({
  id: p.slug,
  name: p.name,
  rooms: (p.roomPlans || []).flatMap(plan => plan.rooms || []).map(r => r.name),
}))

function Field({ label, required, children, hint }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-slate-800 mb-1.5">
        {label}{required && <span className="ml-1 text-axis">*</span>}
      </label>
      {hint && <p className="text-xs text-slate-400 mb-1.5">{hint}</p>}
      {children}
    </div>
  )
}

const inputCls = 'w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-axis focus:ring-2 focus:ring-axis/20'
const selectCls = `${inputCls} appearance-none cursor-pointer`

async function submitToAirtable(fields) {
  if (!AIRTABLE_TOKEN) throw new Error('VITE_AIRTABLE_TOKEN is not set in environment variables.')
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  })
  if (!res.ok) {
    const body = await res.text()
    let msg = `Airtable error ${res.status}`
    try { msg += ': ' + JSON.parse(body)?.error?.message } catch { msg += ': ' + body }
    throw new Error(msg)
  }
}

function buildMailtoFallback(form) {
  const body = [
    `Full Name: ${form.name}`,
    `Email: ${form.email}`,
    `Phone: ${form.phone || 'Not provided'}`,
    `Desired Property: ${form.property}`,
    `Preferred Room: ${form.room || 'Any'}`,
    `Move-in Date: ${form.moveIn || 'Flexible'}`,
    `Lease Term: ${form.leaseTerm}`,
    `Student: ${form.isStudent}`,
    `University / Employer: ${form.institution || 'Not provided'}`,
    `About: ${form.about || 'Not provided'}`,
  ].join('\n')
  const subject = `Application — ${form.name} for ${form.property}`
  return `mailto:info@axis-seattle-housing.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

export default function Apply() {
  const [form, setForm] = useState({
    name: '', email: '', phone: '',
    property: '', room: '',
    moveIn: '', leaseTerm: LEASE_TERMS[0], leaseTermOther: '',
    isStudent: '', institution: '', about: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  const selectedProp = PROPERTY_OPTIONS.find(p => p.name === form.property)

  function set(key, value) {
    setForm(prev => {
      const next = { ...prev, [key]: value }
      if (key === 'property') next.room = ''
      return next
    })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError('')

    const fields = {
      'Name': form.name,
      'Email': form.email,
      'Phone': form.phone || '',
      'Property': form.property,
      'Room': form.room || 'Any',
      'Move In Date': form.moveIn || '',
      'Lease Term': form.leaseTerm === 'Other / Custom dates' ? `Other: ${form.leaseTermOther}` : form.leaseTerm,
      'Student': form.isStudent,
      'University / Employer': form.institution || '',
      'Notes': form.about || '',
      'Status': 'New',
    }

    try {
      await submitToAirtable(fields)
      setSubmitted(true)
    } catch (err) {
      console.error('Airtable submission failed:', err)
      setError(err.message || 'Submission failed.')
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="bg-cream-50 min-h-screen">
        <Seo title="Application Submitted | Axis Seattle Housing" pathname="/apply" />
        <div className="mx-auto max-w-lg px-4 py-24 text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-teal-50">
            <svg className="h-8 w-8 text-axis" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-3xl font-black text-slate-900">Application received</h1>
          <p className="mt-4 text-base leading-7 text-slate-500">
            Thanks, {form.name.split(' ')[0]}! We'll review your application and get back to you within 2 business days.
            Questions? Call or text <a href="tel:15103098345" className="text-axis font-semibold">(510) 309-8345</a>.
          </p>
          <a href="/" className="mt-8 inline-block rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-800">
            Back to home
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-cream-50 min-h-screen">
      <Seo
        title="Apply | Axis Seattle Housing"
        description="Apply for a room at Axis Seattle shared housing near the University of Washington."
        pathname="/apply"
      />

      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
        {/* Header */}
        <div className="mb-8">
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">Rental application</div>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">Apply for a room</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Fill out the form below. We review every application personally and respond within 2 business days.
            A <strong className="text-slate-700">$50 application fee</strong> is collected at move-in, not upfront.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Personal info */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft space-y-5">
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Personal info</div>

            <Field label="Full name" required>
              <input required className={inputCls} placeholder="Jane Smith" value={form.name} onChange={e => set('name', e.target.value)} />
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Email" required>
                <input required type="email" className={inputCls} placeholder="jane@email.com" value={form.email} onChange={e => set('email', e.target.value)} />
              </Field>
              <Field label="Phone">
                <input type="tel" className={inputCls} placeholder="(206) 555-0100" value={form.phone} onChange={e => set('phone', e.target.value)} />
              </Field>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Are you a student?" required>
                <div className="relative">
                  <select required className={selectCls} value={form.isStudent} onChange={e => set('isStudent', e.target.value)}>
                    <option value="" disabled>Select…</option>
                    <option>Yes — full-time</option>
                    <option>Yes — part-time</option>
                    <option>No — working professional</option>
                    <option>Other</option>
                  </select>
                </div>
              </Field>
              <Field label="University or employer">
                <input className={inputCls} placeholder="UW, Amazon, etc." value={form.institution} onChange={e => set('institution', e.target.value)} />
              </Field>
            </div>
          </div>

          {/* Room preferences */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft space-y-5">
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Room preferences</div>

            <Field label="Desired property" required>
              <div className="relative">
                <select required className={selectCls} value={form.property} onChange={e => set('property', e.target.value)}>
                  <option value="" disabled>Choose a property…</option>
                  {PROPERTY_OPTIONS.map(p => (
                    <option key={p.id} value={p.name}>{p.name}</option>
                  ))}
                  <option value="No preference">No preference — any available</option>
                </select>
              </div>
            </Field>

            {selectedProp && (
              <Field label="Preferred room" hint="We'll try to accommodate your preference, subject to availability.">
                <div className="relative">
                  <select className={selectCls} value={form.room} onChange={e => set('room', e.target.value)}>
                    <option value="">No preference</option>
                    {selectedProp.rooms.map(r => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
              </Field>
            )}

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Desired move-in date" hint="Leave blank if flexible.">
                <input type="date" className={inputCls} value={form.moveIn} onChange={e => set('moveIn', e.target.value)} />
              </Field>
              <Field label="Lease term" required>
                <div className="relative">
                  <select required className={selectCls} value={form.leaseTerm} onChange={e => set('leaseTerm', e.target.value)}>
                    {LEASE_TERMS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                {form.leaseTerm === 'Other / Custom dates' && (
                  <input
                    className={`${inputCls} mt-2`}
                    placeholder="e.g. May 17 – Aug 7 (note: +$25/mo for custom dates)"
                    value={form.leaseTermOther}
                    onChange={e => set('leaseTermOther', e.target.value)}
                    required
                  />
                )}
              </Field>
            </div>
          </div>

          {/* About */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft space-y-5">
            <div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">About you</div>
            <Field label="Tell us a bit about yourself" hint="Why are you looking, your lifestyle, anything helpful for us to know.">
              <textarea
                className={`${inputCls} min-h-[100px] resize-y`}
                placeholder="I'm a UW grad student looking for a quiet room near campus…"
                value={form.about}
                onChange={e => set('about', e.target.value)}
              />
            </Field>
          </div>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700 space-y-3">
              <p className="font-semibold">Submission failed — Airtable didn't accept the request.</p>
              <p className="font-mono text-xs break-all text-red-600">{error}</p>
              <p className="text-red-600 text-xs">As a backup, you can send your application by email instead:</p>
              <a
                href={buildMailtoFallback(form)}
                className="inline-block rounded-lg bg-red-700 px-4 py-2 text-xs font-semibold text-white hover:bg-red-800"
              >
                Send via email instead
              </a>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-full bg-slate-900 py-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {submitting ? 'Submitting…' : 'Submit application'}
          </button>

          <p className="text-center text-xs text-slate-400">
            Questions? Call or text <a href="tel:15103098345" className="text-axis">510-309-8345</a> or{' '}
            <a href="mailto:info@axis-seattle-housing.com" className="text-axis">email us directly</a>.
          </p>
        </form>
      </div>
    </div>
  )
}

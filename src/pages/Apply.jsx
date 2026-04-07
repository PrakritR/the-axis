import { useMemo, useState } from 'react'
import { Seo } from '../lib/seo'
import { properties } from '../data/properties'

const AIRTABLE_BASE_ID = import.meta.env.VITE_AIRTABLE_APPLICATIONS_BASE_ID || 'appNBX2inqfJMyqYV'
const AIRTABLE_TABLE = import.meta.env.VITE_AIRTABLE_APPLICATIONS_TABLE || 'Applications'
const AIRTABLE_TOKEN = import.meta.env.VITE_AIRTABLE_TOKEN

const HISTORY_OPTIONS = ['No', 'Yes']

const PROPERTY_OPTIONS = properties
  .map((property) => ({
    id: property.slug,
    name: property.name,
    rooms: [...new Set((property.roomPlans || []).flatMap((plan) => plan.rooms || []).map((room) => room.name))]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
  }))
  .sort((a, b) => a.name.localeCompare(b.name))

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10)
}

function Field({ label, required, children, hint }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-semibold text-slate-800">
        {label}
        {required && <span className="ml-1 text-axis">*</span>}
      </label>
      {hint && <p className="mb-1.5 text-xs text-slate-400">{hint}</p>}
      {children}
    </div>
  )
}

const inputCls = 'w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-axis focus:ring-2 focus:ring-axis/20'
const selectCls = `${inputCls} appearance-none cursor-pointer`

async function submitToAirtable(fields) {
  if (!AIRTABLE_TOKEN) throw new Error('VITE_AIRTABLE_TOKEN is not set in environment variables.')

  const response = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${AIRTABLE_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields, typecast: true }),
  })

  if (!response.ok) {
    const body = await response.text()
    let message = `Airtable error ${response.status}`
    try {
      message += `: ${JSON.parse(body)?.error?.message}`
    } catch {
      message += `: ${body}`
    }
    throw new Error(message)
  }
}

function buildMailtoFallback(form) {
  const body = [
    `Applicant Name: ${form.applicantName}`,
    `Applicant Email: ${form.applicantEmail}`,
    `Applicant Phone: ${form.applicantPhone}`,
    `Driving License No.: ${form.drivingLicense}`,
    `SSN No.: ${form.ssn || 'Not provided'}`,
    `Applicant DOB: ${form.applicantDob}`,
    `Property Name: ${form.propertyName}`,
    `Room Number: ${form.roomNumber}`,
    `Desired Move-in Date: ${form.desiredMoveInDate}`,
    `Current Address: ${form.currentAddress || 'Not provided'}`,
    `Employer: ${form.employer || 'Not provided'}`,
    `Job Title: ${form.jobTitle || 'Not provided'}`,
    `Reference 1: ${form.reference1 || 'Not provided'}`,
    `Reference 2: ${form.reference2 || 'Not provided'}`,
    `Occupants: ${form.occupants || 'Not provided'}`,
    `Pets: ${form.pets || 'Not provided'}`,
    `Vehicles: ${form.vehicles || 'Not provided'}`,
    `Eviction History: ${form.evictionHistory}`,
    `Criminal History: ${form.criminalHistory}`,
    `Signature: ${form.signature || 'Not provided'}`,
    `Date Signed: ${form.dateSigned}`,
  ].join('\n')

  const subject = `Application — ${form.applicantName} for ${form.propertyName}`
  return `mailto:info@axis-seattle-housing.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

export default function Apply() {
  const [form, setForm] = useState({
    applicantName: '',
    applicantEmail: '',
    applicantPhone: '',
    drivingLicense: '',
    ssn: '',
    applicantDob: '',
    propertyName: '',
    roomNumber: '',
    desiredMoveInDate: '',
    currentAddress: '',
    employer: '',
    jobTitle: '',
    reference1: '',
    reference2: '',
    occupants: '',
    pets: '',
    vehicles: '',
    evictionHistory: '',
    criminalHistory: '',
    signature: '',
    dateSigned: todayIsoDate(),
  })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  const selectedProperty = useMemo(
    () => PROPERTY_OPTIONS.find((property) => property.name === form.propertyName),
    [form.propertyName],
  )

  function set(key, value) {
    setForm((prev) => {
      const next = { ...prev, [key]: value }
      if (key === 'propertyName') next.roomNumber = ''
      return next
    })
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setSubmitting(true)
    setError('')

    const fields = {
      'Applicant Name': form.applicantName,
      'Applicant Email': form.applicantEmail,
      'Applicant Phone': form.applicantPhone,
      'Driving License No.': form.drivingLicense,
      'SSN No.': form.ssn || '',
      'Applicant DOB': form.applicantDob,
      'Property Name': form.propertyName,
      'Room Number': form.roomNumber,
      'Desired Move-in Date': form.desiredMoveInDate,
      'Current Address': form.currentAddress || '',
      'Employer': form.employer || '',
      'Job Title': form.jobTitle || '',
      'Reference 1': form.reference1 || '',
      'Reference 2': form.reference2 || '',
      'Occupants': form.occupants || '',
      'Pets': form.pets || '',
      'Vehicles': form.vehicles || '',
      'Eviction History': form.evictionHistory,
      'Criminal History': form.criminalHistory,
      'Signature': form.signature || '',
      'Date Signed': form.dateSigned,
    }

    try {
      await submitToAirtable(fields)
      setSubmitted(true)
    } catch (submissionError) {
      console.error('Airtable submission failed:', submissionError)
      setError(submissionError.message || 'Submission failed.')
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-cream-50">
        <Seo title="Application Submitted | Axis Seattle Housing" pathname="/apply" />
        <div className="mx-auto max-w-lg px-4 py-24 text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-teal-50">
            <svg className="h-8 w-8 text-axis" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-3xl font-black text-slate-900">Application received</h1>
          <p className="mt-4 text-base leading-7 text-slate-500">
            Thanks, {form.applicantName.split(' ')[0]}! Your full application was sent to Axis and we&apos;ll review it
            as soon as possible. Questions? Call or text{' '}
            <a href="tel:15103098345" className="font-semibold text-axis">(510) 309-8345</a>.
          </p>
          <a href="/" className="mt-8 inline-block rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-800">
            Back to home
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-cream-50">
      <Seo
        title="Apply | Axis Seattle Housing"
        description="Submit a full rental application for Axis Seattle Housing."
        pathname="/apply"
      />

      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="mb-8">
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">Axis applications</div>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">Applications Form</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            This page now mirrors the full Axis Airtable application form so the information submitted here lands in the
            same application workflow without manual re-entry.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft space-y-5">
            <h2 className="text-2xl font-black text-slate-900">Application Summary</h2>

            <Field label="Applicant Name" required>
              <input
                required
                className={inputCls}
                placeholder="Jane Smith"
                value={form.applicantName}
                onChange={(e) => set('applicantName', e.target.value)}
              />
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Applicant Email" required>
                <input
                  required
                  type="email"
                  className={inputCls}
                  placeholder="jane@email.com"
                  value={form.applicantEmail}
                  onChange={(e) => set('applicantEmail', e.target.value)}
                />
              </Field>
              <Field label="Applicant Phone" required>
                <input
                  required
                  type="tel"
                  className={inputCls}
                  placeholder="(206) 555-0100"
                  value={form.applicantPhone}
                  onChange={(e) => set('applicantPhone', e.target.value)}
                />
              </Field>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Driving License No." required>
                <input
                  required
                  className={inputCls}
                  placeholder="D1234567"
                  value={form.drivingLicense}
                  onChange={(e) => set('drivingLicense', e.target.value)}
                />
              </Field>
              <Field label="SSN No.">
                <input
                  className={inputCls}
                  placeholder="Last 4 or full SSN"
                  value={form.ssn}
                  onChange={(e) => set('ssn', e.target.value)}
                />
              </Field>
            </div>

            <div className="grid gap-5 sm:grid-cols-3">
              <Field label="Applicant DOB" required>
                <input
                  required
                  type="date"
                  className={inputCls}
                  value={form.applicantDob}
                  onChange={(e) => set('applicantDob', e.target.value)}
                />
              </Field>
              <Field label="Property Name" required>
                <select
                  required
                  className={selectCls}
                  value={form.propertyName}
                  onChange={(e) => set('propertyName', e.target.value)}
                >
                  <option value="" disabled>Select a property…</option>
                  {PROPERTY_OPTIONS.map((property) => (
                    <option key={property.id} value={property.name}>{property.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Room Number" required>
                <select
                  required
                  className={selectCls}
                  value={form.roomNumber}
                  onChange={(e) => set('roomNumber', e.target.value)}
                  disabled={!selectedProperty}
                >
                  <option value="" disabled>{selectedProperty ? 'Select a room…' : 'Choose a property first'}</option>
                  {(selectedProperty?.rooms || []).map((room) => (
                    <option key={room} value={room}>{room}</option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Desired Move-in Date" required>
              <input
                required
                type="date"
                className={inputCls}
                value={form.desiredMoveInDate}
                onChange={(e) => set('desiredMoveInDate', e.target.value)}
              />
            </Field>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft space-y-5">
            <h2 className="text-2xl font-black text-slate-900">Housing History</h2>
            <Field label="Current Address">
              <input
                className={inputCls}
                placeholder="123 Main St, Seattle, WA"
                value={form.currentAddress}
                onChange={(e) => set('currentAddress', e.target.value)}
              />
            </Field>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft space-y-5">
            <h2 className="text-2xl font-black text-slate-900">Employment and Income</h2>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Employer">
                <input
                  className={inputCls}
                  placeholder="Company or school"
                  value={form.employer}
                  onChange={(e) => set('employer', e.target.value)}
                />
              </Field>
              <Field label="Job Title">
                <input
                  className={inputCls}
                  placeholder="Student, software engineer, etc."
                  value={form.jobTitle}
                  onChange={(e) => set('jobTitle', e.target.value)}
                />
              </Field>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft space-y-5">
            <h2 className="text-2xl font-black text-slate-900">References</h2>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Reference 1">
                <input
                  className={inputCls}
                  placeholder="Name, relationship, phone/email"
                  value={form.reference1}
                  onChange={(e) => set('reference1', e.target.value)}
                />
              </Field>
              <Field label="Reference 2">
                <input
                  className={inputCls}
                  placeholder="Name, relationship, phone/email"
                  value={form.reference2}
                  onChange={(e) => set('reference2', e.target.value)}
                />
              </Field>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft space-y-5">
            <h2 className="text-2xl font-black text-slate-900">Additional Details</h2>
            <div className="grid gap-5 sm:grid-cols-3">
              <Field label="Occupants">
                <input
                  className={inputCls}
                  placeholder="How many people will live in the room"
                  value={form.occupants}
                  onChange={(e) => set('occupants', e.target.value)}
                />
              </Field>
              <Field label="Pets">
                <input
                  className={inputCls}
                  placeholder="Type and count, or None"
                  value={form.pets}
                  onChange={(e) => set('pets', e.target.value)}
                />
              </Field>
              <Field label="Vehicles">
                <input
                  className={inputCls}
                  placeholder="Make/model, or None"
                  value={form.vehicles}
                  onChange={(e) => set('vehicles', e.target.value)}
                />
              </Field>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft space-y-5">
            <h2 className="text-2xl font-black text-slate-900">Screening Questions</h2>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Eviction History" required>
                <select
                  required
                  className={selectCls}
                  value={form.evictionHistory}
                  onChange={(e) => set('evictionHistory', e.target.value)}
                >
                  <option value="" disabled>Select…</option>
                  {HISTORY_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </Field>
              <Field label="Criminal History" required>
                <select
                  required
                  className={selectCls}
                  value={form.criminalHistory}
                  onChange={(e) => set('criminalHistory', e.target.value)}
                >
                  <option value="" disabled>Select…</option>
                  {HISTORY_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </Field>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-soft space-y-5">
            <h2 className="text-2xl font-black text-slate-900">Signature</h2>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Signature" hint="Type your name or initials to sign this application.">
                <input
                  className={inputCls}
                  placeholder="name initials. ex: John Doe JD"
                  value={form.signature}
                  onChange={(e) => set('signature', e.target.value)}
                />
              </Field>
              <Field label="Date Signed">
                <input
                  type="date"
                  className={inputCls}
                  value={form.dateSigned}
                  onChange={(e) => set('dateSigned', e.target.value)}
                />
              </Field>
            </div>
          </div>

          {error && (
            <div className="space-y-3 rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
              <p className="font-semibold">Submission failed — Airtable didn&apos;t accept the application.</p>
              <p className="break-all font-mono text-xs text-red-600">{error}</p>
              <p className="text-xs text-red-600">As a backup, you can send the same application data by email instead:</p>
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
            className="w-full rounded-full bg-slate-900 py-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Submitting…' : 'Submit'}
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

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import emailjs from '@emailjs/browser'
import { properties } from '../data/properties'
import { Seo } from '../lib/seo'

const PUBLIC_KEY  = import.meta.env.VITE_EMAILJS_PUBLIC_KEY
const SERVICE_ID  = import.meta.env.VITE_EMAILJS_SERVICE_ID
const TEMPLATE_ID = import.meta.env.VITE_EMAILJS_TEMPLATE_ID

if (PUBLIC_KEY) {
  emailjs.init({ publicKey: PUBLIC_KEY })
}

const initialForm = {
  propertyAddress: '',
  roomNumber: '',
  desiredMoveInDate: '',
  leaseTerm: '',
  firstName: '',
  middleName: '',
  lastName: '',
  suffix: '',
  dateOfBirth: '',
  socialSecurity: '',
  driversLicense: '',
  phoneNumber: '',
  email: '',
  currentAddress: '',
  currentCityStateZip: '',
  currentLandlordName: '',
  currentLandlordPhone: '',
  currentMoveInDate: '',
  currentMonthlyRent: '',
  currentReasonLeaving: '',
  previousAddress: '',
  previousCityStateZip: '',
  previousLandlordName: '',
  previousLandlordPhone: '',
  previousMoveInDate: '',
  previousMoveOutDate: '',
  previousMonthlyRent: '',
  previousReasonLeaving: '',
  employerName: '',
  employerAddress: '',
  supervisorName: '',
  supervisorPhone: '',
  jobTitle: '',
  monthlyAnnualIncome: '',
  employmentStartDate: '',
  otherIncome: '',
  reference1Name: '',
  reference1Relationship: '',
  reference1Phone: '',
  reference2Name: '',
  reference2Relationship: '',
  reference2Phone: '',
  numberOfOccupants: '',
  pets: '',
  vehicles: '',
  evicted: '',
  bankruptcy: '',
  criminalConvictions: '',
  applicantSignature: '',
  applicantSignatureDate: '',
  coApplicantSignature: '',
  coApplicantSignatureDate: '',
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatDate(value) {
  if (!value) return '________________'
  const parsed = new Date(`${value}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  })
}

function formatChoice(value) {
  if (value === 'yes') return 'Yes'
  if (value === 'no') return 'No'
  return '________________'
}

function formatValue(value) {
  return value?.trim() ? value.trim() : '________________'
}

function buildApplicationText(form, propertyName) {
  const applicantName = [form.firstName, form.middleName, form.lastName].filter(Boolean).join(' ')

  return [
    'Residential Rental Application',
    '',
    'Property Information',
    `Property Address Applying For: ${formatValue(form.propertyAddress)}`,
    `Room Number: ${formatValue(form.roomNumber)}`,
    `Property Name: ${formatValue(propertyName)}`,
    `Desired Move-In Date: ${formatDate(form.desiredMoveInDate)}`,
    `Lease Term: ${formatValue(form.leaseTerm)}`,
    '',
    '1. Applicant Information',
    `Full Name: ${formatValue(applicantName)}`,
    `Date of Birth: ${formatDate(form.dateOfBirth)}`,
    `Social Security #: ${formatValue(form.socialSecurity)}`,
    `Driver's License/ID #: ${formatValue(form.driversLicense)}`,
    `Phone Number: ${formatValue(form.phoneNumber)}`,
    `Email: ${formatValue(form.email)}`,
    '',
    '2. Current Address',
    `Address: ${formatValue(form.currentAddress)}`,
    `Landlord/Property Manager Name: ${formatValue(form.currentLandlordName)}`,
    `Landlord Phone #: ${formatValue(form.currentLandlordPhone)}`,
    `Date Moved In: ${formatDate(form.currentMoveInDate)}`,
    `Monthly Rent: ${formatValue(form.currentMonthlyRent)}`,
    `Reason for Leaving: ${formatValue(form.currentReasonLeaving)}`,
    '',
    '3. Previous Address (if applicable)',
    `Address: ${formatValue(form.previousAddress)}`,
    `Landlord/Property Manager Name: ${formatValue(form.previousLandlordName)}`,
    `Landlord Phone #: ${formatValue(form.previousLandlordPhone)}`,
    `Move-in Date: ${formatDate(form.previousMoveInDate)}`,
    `Move-out Date: ${formatDate(form.previousMoveOutDate)}`,
    `Monthly Rent: ${formatValue(form.previousMonthlyRent)}`,
    `Reason for Leaving: ${formatValue(form.previousReasonLeaving)}`,
    '',
    '4. Employment & Income',
    `Employer Name: ${formatValue(form.employerName)}`,
    `Employer Address: ${formatValue(form.employerAddress)}`,
    `Supervisor Name: ${formatValue(form.supervisorName)}`,
    `Supervisor Phone #: ${formatValue(form.supervisorPhone)}`,
    `Job Title: ${formatValue(form.jobTitle)}`,
    `Monthly Income: ${formatValue(form.monthlyAnnualIncome)}`,
    `Employment Start Date: ${formatDate(form.employmentStartDate)}`,
    `Other Income (optional): ${formatValue(form.otherIncome)}`,
    '',
    '5. References',
    `Reference 1 — Name: ${formatValue(form.reference1Name)}`,
    `Reference 1 — Relationship: ${formatValue(form.reference1Relationship)}`,
    `Reference 1 — Phone: ${formatValue(form.reference1Phone)}`,
    `Reference 2 — Name: ${formatValue(form.reference2Name)}`,
    `Reference 2 — Relationship: ${formatValue(form.reference2Relationship)}`,
    `Reference 2 — Phone: ${formatValue(form.reference2Phone)}`,
    '',
    '6. Additional Information',
    `Number of Occupants: ${formatValue(form.numberOfOccupants)}`,
    `Pets (type/breed/weight): ${formatValue(form.pets)}`,
    `Vehicle(s) (make/model/license plate): ${formatValue(form.vehicles)}`,
    '',
    '7. Additional Review Questions',
    `Have you ever been evicted?: ${formatChoice(form.evicted)}`,
    `Have you ever filed for bankruptcy?: ${formatChoice(form.bankruptcy)}`,
    `Any criminal convictions?: ${formatChoice(form.criminalConvictions)}`,
    '',
    '8. Signature',
    `Applicant Signature / Date: ${formatValue(form.applicantSignature)} / ${formatDate(form.applicantSignatureDate)}`,
    `Co-Applicant Signature / Date: ${formatValue(form.coApplicantSignature)} / ${formatDate(form.coApplicantSignatureDate)}`,
  ].join('\n')
}

function buildApplicationHtml(form, propertyName) {
  const applicantName = [form.firstName, form.middleName, form.lastName].filter(Boolean).join(' ')

  const line = (label, value) => `
    <tr>
      <td style="padding:6px 0;font-weight:600;width:280px;vertical-align:top;">${escapeHtml(label)}</td>
      <td style="padding:6px 0;border-bottom:1px solid #d1d5db;">${escapeHtml(value)}</td>
    </tr>`

  const section = (title, rows) => `
    <div style="margin-top:20px;">
      <div style="font-size:24px;font-weight:800;margin-bottom:10px;color:#111827;">${escapeHtml(title)}</div>
      <table style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.5;">${rows.join('')}</table>
    </div>`

  return `
    <div style="font-family:Arial,Helvetica,sans-serif;background:#f3f4f6;padding:24px;color:#111827;">
      <div style="max-width:860px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:16px;padding:36px;">
        <div style="text-align:center;margin-bottom:18px;">
          <div style="font-size:14px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#14b8a6;">Axis Seattle</div>
          <h1 style="margin:8px 0 0;font-size:34px;line-height:1.15;">Residential Rental Application</h1>
        </div>
        ${section('Property Information', [
          line('Property Address Applying For', formatValue(form.propertyAddress)),
          line('Room Number', formatValue(form.roomNumber)),
          line('Property Name', formatValue(propertyName)),
          line('Desired Move-In Date', formatDate(form.desiredMoveInDate)),
          line('Lease Term', formatValue(form.leaseTerm)),
        ])}
        ${section('1. Applicant Information', [
          line('Full Name', formatValue(applicantName)),
          line('Date of Birth', formatDate(form.dateOfBirth)),
          line('Social Security #', formatValue(form.socialSecurity)),
          line("Driver's License/ID #", formatValue(form.driversLicense)),
          line('Phone Number', formatValue(form.phoneNumber)),
          line('Email', formatValue(form.email)),
        ])}
        ${section('2. Current Address', [
          line('Address', formatValue(form.currentAddress)),
          line('Landlord/Property Manager Name', formatValue(form.currentLandlordName)),
          line('Landlord Phone #', formatValue(form.currentLandlordPhone)),
          line('Date Moved In', formatDate(form.currentMoveInDate)),
          line('Monthly Rent', formatValue(form.currentMonthlyRent)),
          line('Reason for Leaving', formatValue(form.currentReasonLeaving)),
        ])}
        ${section('3. Previous Address (if applicable)', [
          line('Address', formatValue(form.previousAddress)),
          line('Landlord/Property Manager Name', formatValue(form.previousLandlordName)),
          line('Landlord Phone #', formatValue(form.previousLandlordPhone)),
          line('Move-in Date', formatDate(form.previousMoveInDate)),
          line('Move-out Date', formatDate(form.previousMoveOutDate)),
          line('Monthly Rent', formatValue(form.previousMonthlyRent)),
          line('Reason for Leaving', formatValue(form.previousReasonLeaving)),
        ])}
        ${section('4. Employment & Income', [
          line('Employer Name', formatValue(form.employerName)),
          line('Employer Address', formatValue(form.employerAddress)),
          line('Supervisor Name', formatValue(form.supervisorName)),
          line('Supervisor Phone #', formatValue(form.supervisorPhone)),
          line('Job Title', formatValue(form.jobTitle)),
          line('Monthly Income', formatValue(form.monthlyAnnualIncome)),
          line('Employment Start Date', formatDate(form.employmentStartDate)),
          line('Other Income (optional)', formatValue(form.otherIncome)),
        ])}
        ${section('5. References', [
          line('Name 1', formatValue(form.reference1Name)),
          line('Relationship 1', formatValue(form.reference1Relationship)),
          line('Phone # 1', formatValue(form.reference1Phone)),
          line('Name 2', formatValue(form.reference2Name)),
          line('Relationship 2', formatValue(form.reference2Relationship)),
          line('Phone # 2', formatValue(form.reference2Phone)),
        ])}
        ${section('6. Additional Information', [
          line('Number of Occupants', formatValue(form.numberOfOccupants)),
          line('Pets (type/breed/weight)', formatValue(form.pets)),
          line('Vehicle(s) (make/model/license plate)', formatValue(form.vehicles)),
        ])}
        ${section('7. Additional Review Questions', [
          line('Have you ever been evicted?', formatChoice(form.evicted)),
          line('Have you ever filed for bankruptcy?', formatChoice(form.bankruptcy)),
          line('Any criminal convictions?', formatChoice(form.criminalConvictions)),
        ])}
        ${section('8. Signature', [
          line('Applicant Signature / Date', `${formatValue(form.applicantSignature)} / ${formatDate(form.applicantSignatureDate)}`),
          line('Co-Applicant Signature / Date', `${formatValue(form.coApplicantSignature)} / ${formatDate(form.coApplicantSignatureDate)}`),
        ])}
      </div>
    </div>`
}

// ── Per-field format validators ───────────────────────────────────────────────
// validate() returns true when the field is empty (field is optional) OR passes.
// Required-ness is enforced separately in requiredFields.
const fieldFormatValidators = {
  email: {
    validate: (v) => !v.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()),
    message: 'Enter a valid email address (e.g. name@example.com).',
  },
  phoneNumber: {
    validate: (v) => !v.trim() || v.replace(/\D/g, '').length === 10,
    message: 'Phone number must be exactly 10 digits.',
  },
  socialSecurity: {
    validate: (v) => !v.trim() || v.replace(/\D/g, '').length === 9,
    message: 'Social Security # must be 9 digits (XXX-XX-XXXX).',
  },
  driversLicense: {
    validate: (v) => !v.trim() || /^[a-zA-Z0-9]{4,20}$/.test(v.trim()),
    message: "Driver's license must be 4–20 alphanumeric characters.",
  },
  desiredMoveInDate: {
    validate: (v) => {
      if (!v.trim()) return true
      const d = new Date(`${v}T00:00:00`)
      if (Number.isNaN(d.getTime())) return false
      const today = new Date(); today.setHours(0, 0, 0, 0)
      return d >= today
    },
    message: 'Move-in date must be today or a future date.',
  },
  dateOfBirth: {
    validate: (v) => {
      if (!v.trim()) return true
      const d = new Date(`${v}T00:00:00`)
      if (Number.isNaN(d.getTime())) return false
      const cutoff = new Date()
      cutoff.setFullYear(cutoff.getFullYear() - 18)
      return d <= cutoff
    },
    message: 'Applicant must be at least 18 years old.',
  },
  firstName: {
    validate: (v) => !v.trim() || /^[a-zA-Z\-' ]+$/.test(v.trim()),
    message: 'First name should only contain letters.',
  },
  lastName: {
    validate: (v) => !v.trim() || /^[a-zA-Z\-' ]+$/.test(v.trim()),
    message: 'Last name should only contain letters.',
  },
  monthlyAnnualIncome: {
    validate: (v) => !v.trim() || /^\$?[\d,]+(\.\d{1,2})?(\/(?:month|year|mo|yr))?\s*$/i.test(v.trim()),
    message: 'Enter a valid income amount (e.g. 3500 or $3,500/month).',
  },
  numberOfOccupants: {
    validate: (v) => !v.trim() || /^[1-9]\d*$/.test(v.trim()),
    message: 'Number of occupants must be a whole number greater than zero.',
  },
  currentLandlordPhone: {
    validate: (v) => !v.trim() || v.replace(/\D/g, '').length === 10,
    message: 'Phone must be 10 digits.',
  },
  previousLandlordPhone: {
    validate: (v) => !v.trim() || v.replace(/\D/g, '').length === 10,
    message: 'Phone must be 10 digits.',
  },
  supervisorPhone: {
    validate: (v) => !v.trim() || v.replace(/\D/g, '').length === 10,
    message: 'Phone must be 10 digits.',
  },
  reference1Phone: {
    validate: (v) => !v.trim() || v.replace(/\D/g, '').length === 10,
    message: 'Phone must be 10 digits.',
  },
  reference2Phone: {
    validate: (v) => !v.trim() || v.replace(/\D/g, '').length === 10,
    message: 'Phone must be 10 digits.',
  },
}

// Auto-format SSN → XXX-XX-XXXX while typing
function formatSSNInput(raw) {
  const digits = raw.replace(/\D/g, '').slice(0, 9)
  if (digits.length <= 3) return digits
  if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`
}

// Auto-format phone → (XXX) XXX-XXXX while typing
function formatPhoneInput(raw) {
  const digits = raw.replace(/\D/g, '').slice(0, 10)
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

function getEmailJsErrorMessage(err) {
  const status = err?.status
  const detail = err?.text || err?.message

  if (status === 400) {
    return 'EmailJS rejected the request. Check template variables and message size.'
  }
  if (status === 401 || status === 403) {
    return 'EmailJS authorization failed. Verify public key, service ID, and allowed origins.'
  }
  if (status === 404) {
    return 'EmailJS service or template ID was not found. Recheck IDs in settings.'
  }

  return detail
    ? `Unable to send application (${detail}). Please verify EmailJS template/service IDs and variables.`
    : 'Unable to send application. Please verify EmailJS template/service IDs and template variables.'
}

function SparkIcon(){
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" fill="currentColor" />
    </svg>
  )
}

function ShieldIcon(){
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path d="M12 3l7 3v5c0 4.6-2.8 8.8-7 10-4.2-1.2-7-5.4-7-10V6l7-3z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CheckIcon(){
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path d="M5 12.5l4.2 4.2L19 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

function FieldShell({ label, required = false, hint, children, full = false, error = '' }) {
  return (
    <label className={full ? 'md:col-span-2' : ''}>
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
        <span>{label}</span>
        {required && <span className="text-rose-500">*</span>}
      </div>
      {children}
      {error ? <div className="mt-2 text-xs font-medium text-rose-600">{error}</div> : hint ? <div className="mt-2 text-xs text-slate-500">{hint}</div> : null}
    </label>
  )
}

function TextField({ label, value, onChange, type = 'text', placeholder = '', required = false, autoComplete, readOnly = false, hint = '', full = false, invalid = false, error = '' }) {
  return (
    <FieldShell label={label} required={required} hint={hint} full={full} error={error}>
      <input
        className={`w-full rounded-2xl border bg-white px-4 py-3.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:ring-4 read-only:bg-slate-50 read-only:text-slate-500 ${invalid ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-100' : 'border-slate-200 focus:border-axis focus:ring-teal-100'}`}
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        autoComplete={autoComplete}
        readOnly={readOnly}
      />
    </FieldShell>
  )
}

function SelectField({ label, value, onChange, options, required = false, hint = '', full = false, invalid = false, error = '' }) {
  return (
    <FieldShell label={label} required={required} hint={hint} full={full} error={error}>
      <select className={`w-full rounded-2xl border bg-white px-4 py-3.5 text-sm text-slate-900 shadow-sm outline-none transition focus:ring-4 ${invalid ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-100' : 'border-slate-200 focus:border-axis focus:ring-teal-100'}`} value={value} onChange={onChange} required={required}>
        <option value="">Select an option</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </FieldShell>
  )
}

function TextAreaField({ label, value, onChange, placeholder = '', rows = 3, hint = '', full = true }) {
  return (
    <FieldShell label={label} hint={hint} full={full}>
      <textarea
        className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3.5 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-axis focus:ring-4 focus:ring-teal-100"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        rows={rows}
      />
    </FieldShell>
  )
}

function Section({ number, title, description, children, invalid = false, missingCount = 0, sectionId, registerRef }) {
  return (
    <section
      className={`rounded-[28px] border bg-white p-6 shadow-soft md:p-8 ${invalid ? 'border-rose-300 ring-2 ring-rose-100' : 'border-slate-200'}`}
      ref={(node) => registerRef(sectionId, node)}
    >
      <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <span className="shrink-0 inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-axis/10 text-sm font-black text-axis">{number}</span>
            <h2 className="text-xl font-black tracking-tight text-slate-900 sm:text-2xl">{title}</h2>
          </div>
          {description && <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">{description}</p>}
        </div>
        {invalid && (
          <div className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700">
            {missingCount} required field{missingCount > 1 ? 's' : ''} missing
          </div>
        )}
      </div>
      <div className="mt-6 grid gap-5 md:grid-cols-2">{children}</div>
    </section>
  )
}

export default function Apply({ property }){
  const location = useLocation()
  const query = new URLSearchParams(location.search)
  const propertySlug = query.get('property')
  const requestedRoomNumber = query.get('room') || ''
  const selectedProperty = property || properties.find((item) => item.slug === propertySlug) || null
  const address = selectedProperty?.address || ''
  const propertyName = selectedProperty?.name || 'Axis Seattle'
  const [form, setForm] = useState(() => ({ ...initialForm, propertyAddress: address, roomNumber: requestedRoomNumber }))
  const [status, setStatus] = useState('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [attemptedSubmit, setAttemptedSubmit] = useState(false)
  const sectionRefs = useRef({})

  useEffect(() => {
    if (!selectedProperty || !address) return
    setForm((current) => (
      current.propertyAddress === '' || current.propertyAddress === initialForm.propertyAddress
        ? { ...current, propertyAddress: address, roomNumber: current.roomNumber || requestedRoomNumber }
        : current
    ))
  }, [address, requestedRoomNumber, selectedProperty])

  const applicantName = useMemo(
    () => [form.firstName, form.middleName, form.lastName, form.suffix].filter(Boolean).join(' '),
    [form.firstName, form.middleName, form.lastName, form.suffix],
  )

  const requiredFields = [
    { key: 'propertyAddress', section: '01', label: 'Property address', valid: (value) => !!value.trim() },
    { key: 'desiredMoveInDate', section: '01', label: 'Desired move-in date', valid: (value) => !!value.trim() },
    { key: 'firstName', section: '02', label: 'First name', valid: (value) => !!value.trim() },
    { key: 'lastName', section: '02', label: 'Last name', valid: (value) => !!value.trim() },
    { key: 'dateOfBirth', section: '02', label: 'Date of birth', valid: (value) => !!value.trim() },
    { key: 'phoneNumber', section: '02', label: 'Phone number', valid: (value) => !!value.trim() },
    { key: 'email', section: '02', label: 'Email address', valid: (value) => !!value.trim() },
  ]

  // Maps each validated field to its section number for error highlighting
  const fieldSectionMap = {
    propertyAddress: '01', desiredMoveInDate: '01',
    firstName: '02', lastName: '02', dateOfBirth: '02', socialSecurity: '02',
    driversLicense: '02', phoneNumber: '02', email: '02',
    currentLandlordPhone: '03',
    previousLandlordPhone: '04',
    supervisorPhone: '05', monthlyAnnualIncome: '05',
    reference1Phone: '06', reference2Phone: '06',
    numberOfOccupants: '07',
  }

  const requiredChecks = requiredFields.map((field) => field.valid(form[field.key]))
  const progress = Math.round((requiredChecks.filter(Boolean).length / requiredChecks.length) * 100)

  // Combined error map: required-missing + format-invalid (only populated after first submit)
  const allFieldErrors = useMemo(() => {
    if (!attemptedSubmit) return {}
    const errors = {}
    for (const field of requiredFields) {
      if (!field.valid(form[field.key])) {
        errors[field.key] = `${field.label} is required.`
      }
    }
    for (const [key, rule] of Object.entries(fieldFormatValidators)) {
      if (!errors[key] && !rule.validate(form[key])) {
        errors[key] = rule.message
      }
    }
    return errors
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptedSubmit, form])

  const invalidSections = Object.entries(allFieldErrors).reduce((acc, [key]) => {
    const section = fieldSectionMap[key]
    if (section) acc[section] = (acc[section] || 0) + 1
    return acc
  }, {})

  const allFormatValid = Object.entries(fieldFormatValidators).every(([key, rule]) => rule.validate(form[key]))
  const formIsValid = requiredFields.every((field) => field.valid(form[field.key])) && allFormatValid

  function getFieldError(fieldKey) {
    return allFieldErrors[fieldKey] || ''
  }

  function hasSectionError(section) {
    return !!invalidSections[section]
  }

  function registerSectionRef(section, node) {
    if (node) {
      sectionRefs.current[section] = node
    }
  }

  function updateField(field, value) {
    if (status !== 'idle') {
      setStatus('idle')
    }
    if (errorMessage) {
      setErrorMessage('')
    }
    setForm((current) => ({ ...current, [field]: value }))
  }

  function updatePhone(field, raw) {
    updateField(field, formatPhoneInput(raw))
  }

  function updateSSN(raw) {
    updateField('socialSecurity', formatSSNInput(raw))
  }

  async function submitApplication(){
    setAttemptedSubmit(true)

    // Compute errors synchronously (allFieldErrors memo hasn't updated yet)
    const errorsNow = {}
    for (const field of requiredFields) {
      if (!field.valid(form[field.key])) {
        errorsNow[field.key] = true
      }
    }
    for (const [key, rule] of Object.entries(fieldFormatValidators)) {
      if (!errorsNow[key] && !rule.validate(form[key])) {
        errorsNow[key] = true
      }
    }
    const hasErrors = Object.keys(errorsNow).length > 0

    if (!formIsValid || hasErrors) {
      setStatus('error')
      setErrorMessage('Please fix the highlighted fields before submitting.')
      const firstInvalidSection = Object.entries(errorsNow)
        .map(([key]) => fieldSectionMap[key])
        .filter(Boolean)
        .sort()[0]
      if (firstInvalidSection && sectionRefs.current[firstInvalidSection]) {
        sectionRefs.current[firstInvalidSection].scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
      return
    }

    setStatus('sending')

    if (!PUBLIC_KEY || !SERVICE_ID || !TEMPLATE_ID) {
      setStatus('error')
      setErrorMessage('EmailJS is not configured. Please set public key, service ID, and template ID.')
      return
    }

    const applicationText = buildApplicationText(form, propertyName)

    try {
      await emailjs.send(SERVICE_ID, TEMPLATE_ID, {
        from_name: applicantName,
        user_name: applicantName,
        name: applicantName,
        from_email: form.email,
        user_email: form.email,
        email: form.email,
        reply_to: form.email,
        phone: form.phoneNumber,
        subject: `Rental Application — ${propertyName} — ${applicantName}`,
        property_name: propertyName,
        property_address: form.propertyAddress,
        applicant_name: applicantName,
        applicant_email: form.email,
        applicant_phone: form.phoneNumber,
        desired_move_in_date: formatDate(form.desiredMoveInDate),
        lease_term: formatValue(form.leaseTerm),
        // message is the primary EmailJS template variable — send full application
        message: applicationText,
        application_text: applicationText,
      }, { publicKey: PUBLIC_KEY })
      setStatus('success')
      setErrorMessage('')
      setAttemptedSubmit(false)
      setForm({ ...initialForm, propertyAddress: address })
    } catch (err) {
      console.error('Application email error:', {
        status: err?.status,
        text: err?.text,
        message: err?.message,
        raw: err,
      })
      setStatus('error')
      setErrorMessage(getEmailJsErrorMessage(err))
    }
  }

  return (
    <div className="bg-[linear-gradient(180deg,#fcfcfa_0%,#ffffff_28%,#f8fafc_100%)]">
      <Seo
        title={`Apply for ${propertyName} | Axis Seattle Housing`}
        description={`Submit an application for ${propertyName} through Axis Seattle. Apply for affordable Seattle shared housing with a guided online form.`}
        pathname="/apply"
      />
      <div className="mx-auto max-w-7xl px-4 py-8 md:px-6 md:py-12">
        <section className="grid gap-8 border-b border-slate-200 pb-10 lg:grid-cols-[minmax(0,1.15fr)_320px] lg:pb-14">
          <div className="max-w-4xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-[11px] font-bold uppercase tracking-[0.22em] text-slate-500">
              <span className="text-axis"><SparkIcon /></span>
              Online application
            </div>
            <h1 className="font-editorial mt-4 text-[2rem] leading-[1.1] text-slate-900 sm:text-[3.5rem] sm:leading-[0.96] lg:text-[5rem]">
              Apply for {propertyName}
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
              Fill in each section. Required fields are marked. Review before you submit.
            </p>

            <div className="mt-10 grid grid-cols-1 gap-4 border-t border-slate-200 pt-6 sm:grid-cols-3">
              {[
                ['Secure submission', 'Sent directly to leasing.'],
                ['Guided flow', 'Organized into clear sections.'],
                ['Final review', 'Review your details before submitting.'],
              ].map(([title, text]) => (
                <div key={title}>
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">{title}</div>
                  <div className="mt-2 text-sm leading-7 text-slate-700">{text}</div>
                </div>
              ))}
            </div>
          </div>

          <aside className="flex flex-col justify-between border-t border-slate-200 pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-1">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Applying for</div>
              <div className="mt-3 text-2xl font-black text-slate-900">{propertyName}</div>
              <div className="mt-2 text-sm leading-7 text-slate-600">{address || 'Select a listing to pre-fill.'}</div>
            </div>
            <div className="mt-8 space-y-4">
              <div className="border-t border-slate-200 pt-4">
                <div className="text-sm font-semibold text-slate-900">Completion</div>
                <div className="mt-2 text-3xl font-black text-slate-900">{progress}%</div>
              </div>
              <div className="border-t border-slate-200 pt-4">
                <div className="text-sm font-semibold text-slate-900">Required to submit</div>
                <div className="mt-1 text-sm leading-6 text-slate-600">Move-in date, name, DOB, phone, and email.</div>
              </div>
            </div>
          </aside>
        </section>

        <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
          <main id="apply" className="space-y-6 scroll-mt-24">
            <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-soft md:p-8">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-axis">Before you start</div>
                  <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-900">A cleaner application flow</h2>
                  <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600 md:text-base">
                    Fill out each section in order. Missing fields are highlighted automatically.
                  </p>
                  <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    <div className="font-semibold">Co-signer instructions</div>
                    <div className="mt-1 text-amber-900/85">
                      Submit once for the primary applicant, then again for the co-signer.
                    </div>
                  </div>
                </div>
                <div className="flex w-full items-start gap-3 rounded-2xl border border-teal-100 bg-teal-50 px-4 py-3 text-sm text-teal-900 md:w-auto md:max-w-xs">
                  <div className="mt-0.5 shrink-0 text-axis"><ShieldIcon /></div>
                  <div>
                    <div className="font-semibold">Required fields are marked with *</div>
                    <div className="mt-1 text-teal-800/80">Scan at your own pace — only the essentials are flagged.</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Mobile progress bar — replaces sidebar on small screens */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft lg:hidden">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Progress</div>
                  <div className="mt-1 text-xl font-black text-slate-900">{progress}%</div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Applying for</div>
                  <div className="mt-1 max-w-[140px] truncate text-sm font-semibold text-slate-900">{propertyName}</div>
                </div>
              </div>
              <div className="mt-3 h-1.5 rounded-full bg-slate-200">
                <div className="h-1.5 rounded-full bg-axis transition-all duration-300" style={{ width: `${progress}%` }} />
              </div>
            </div>

            <Section
              number="01"
              title="Property details"
              description="Confirm the home you are applying for and choose your preferred move-in timing."
              sectionId="01"
              registerRef={registerSectionRef}
              invalid={hasSectionError('01')}
              missingCount={invalidSections['01'] || 0}
            >
              <TextField label="Property address" value={form.propertyAddress} onChange={(e) => updateField('propertyAddress', e.target.value)} required readOnly={!!selectedProperty} placeholder="Enter property address" hint={selectedProperty ? 'Pre-filled from the selected listing.' : 'Enter the property address you are applying for.'} invalid={!!getFieldError('propertyAddress')} error={getFieldError('propertyAddress')} />
              <TextField label="Room number" value={form.roomNumber} onChange={(e) => updateField('roomNumber', e.target.value)} placeholder="Room 3" hint={requestedRoomNumber ? 'Pre-filled from the room you selected.' : 'Add the room you are applying for, if known.'} />
              <TextField label="Desired move-in date" type="date" value={form.desiredMoveInDate} onChange={(e) => updateField('desiredMoveInDate', e.target.value)} required hint="Must be today or a future date." invalid={!!getFieldError('desiredMoveInDate')} error={getFieldError('desiredMoveInDate')} />
              <TextField label="Lease term" value={form.leaseTerm} onChange={(e) => updateField('leaseTerm', e.target.value)} placeholder="12 months, month-to-month, etc." hint="Optional, but helpful for leasing review." full />
              <div className="md:col-span-2 rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-900">
                <div className="font-semibold">Application fee payment</div>
                <div className="mt-1 text-teal-900/85">
                  Send the application fee by Zelle to <span className="font-bold">510-309-8345</span> and include the applicant&apos;s full name and room number in the payment note.
                </div>
              </div>
            </Section>

            <Section
              number="02"
              title="Applicant information"
              description="Enter the primary applicant details used for identification and contact."
              sectionId="02"
              registerRef={registerSectionRef}
              invalid={hasSectionError('02')}
              missingCount={invalidSections['02'] || 0}
            >
              <TextField label="First name" value={form.firstName} onChange={(e) => updateField('firstName', e.target.value)} required autoComplete="given-name" placeholder="Legal first name" invalid={!!getFieldError('firstName')} error={getFieldError('firstName')} />
              <TextField label="Middle name" value={form.middleName} onChange={(e) => updateField('middleName', e.target.value)} autoComplete="additional-name" placeholder="Optional" />
              <TextField label="Last name" value={form.lastName} onChange={(e) => updateField('lastName', e.target.value)} required autoComplete="family-name" placeholder="Legal last name" invalid={!!getFieldError('lastName')} error={getFieldError('lastName')} />
              <TextField label="Date of birth" type="date" value={form.dateOfBirth} onChange={(e) => updateField('dateOfBirth', e.target.value)} required autoComplete="bday" hint="Applicant must be at least 18." invalid={!!getFieldError('dateOfBirth')} error={getFieldError('dateOfBirth')} />
              <TextField label="Social Security #" value={form.socialSecurity} onChange={(e) => updateSSN(e.target.value)} autoComplete="off" placeholder="XXX-XX-XXXX" hint="9 digits. Sent only in the secured email submission." invalid={!!getFieldError('socialSecurity')} error={getFieldError('socialSecurity')} />
              <TextField label="Driver's license / ID #" value={form.driversLicense} onChange={(e) => updateField('driversLicense', e.target.value)} autoComplete="off" placeholder="e.g. WDL123456" hint="4–20 alphanumeric characters." invalid={!!getFieldError('driversLicense')} error={getFieldError('driversLicense')} />
              <TextField label="Phone number" type="tel" value={form.phoneNumber} onChange={(e) => updatePhone('phoneNumber', e.target.value)} required autoComplete="tel" placeholder="(XXX) XXX-XXXX" invalid={!!getFieldError('phoneNumber')} error={getFieldError('phoneNumber')} />
              <TextField label="Email address" type="email" value={form.email} onChange={(e) => updateField('email', e.target.value)} required autoComplete="email" placeholder="name@example.com" full invalid={!!getFieldError('email')} error={getFieldError('email')} />
            </Section>

            <Section
              number="03"
              title="Current address"
              description="Share your current housing details. We use this to verify rental history and contact your landlord."
              sectionId="03"
              registerRef={registerSectionRef}
              invalid={hasSectionError('03')}
              missingCount={invalidSections['03'] || 0}
            >
              <TextField label="Full address" value={form.currentAddress} onChange={(e) => updateField('currentAddress', e.target.value)} placeholder="123 Main St, Seattle, WA 98105" full />
              <TextField label="Landlord or property manager" value={form.currentLandlordName} onChange={(e) => updateField('currentLandlordName', e.target.value)} placeholder="Full name" />
              <TextField label="Landlord phone" type="tel" value={form.currentLandlordPhone} onChange={(e) => updatePhone('currentLandlordPhone', e.target.value)} placeholder="(XXX) XXX-XXXX" invalid={!!getFieldError('currentLandlordPhone')} error={getFieldError('currentLandlordPhone')} />
              <TextField label="Date moved in" type="date" value={form.currentMoveInDate} onChange={(e) => updateField('currentMoveInDate', e.target.value)} />
              <TextField label="Monthly rent ($)" value={form.currentMonthlyRent} onChange={(e) => updateField('currentMonthlyRent', e.target.value)} placeholder="e.g. 1800" />
              <TextAreaField label="Reason for leaving" value={form.currentReasonLeaving} onChange={(e) => updateField('currentReasonLeaving', e.target.value)} rows={3} />
            </Section>

            <Section
              number="04"
              title="Previous address"
              description="Complete if you have lived at your current address for less than two years, or if requested."
              sectionId="04"
              registerRef={registerSectionRef}
              invalid={hasSectionError('04')}
              missingCount={invalidSections['04'] || 0}
            >
              <TextField label="Full address" value={form.previousAddress} onChange={(e) => updateField('previousAddress', e.target.value)} placeholder="123 Main St, Seattle, WA 98105" full />
              <TextField label="Landlord or property manager" value={form.previousLandlordName} onChange={(e) => updateField('previousLandlordName', e.target.value)} placeholder="Full name" />
              <TextField label="Landlord phone" type="tel" value={form.previousLandlordPhone} onChange={(e) => updatePhone('previousLandlordPhone', e.target.value)} placeholder="(XXX) XXX-XXXX" invalid={!!getFieldError('previousLandlordPhone')} error={getFieldError('previousLandlordPhone')} />
              <TextField label="Move-in date" type="date" value={form.previousMoveInDate} onChange={(e) => updateField('previousMoveInDate', e.target.value)} />
              <TextField label="Move-out date" type="date" value={form.previousMoveOutDate} onChange={(e) => updateField('previousMoveOutDate', e.target.value)} />
              <TextField label="Monthly rent ($)" value={form.previousMonthlyRent} onChange={(e) => updateField('previousMonthlyRent', e.target.value)} placeholder="e.g. 1600" />
              <TextAreaField label="Reason for leaving" value={form.previousReasonLeaving} onChange={(e) => updateField('previousReasonLeaving', e.target.value)} rows={3} />
            </Section>

            <Section
              number="05"
              title="Employment & income"
              description="Provide your current work details and the income used to qualify for the lease."
              sectionId="05"
              registerRef={registerSectionRef}
            >
              <TextField label="Employer name" value={form.employerName} onChange={(e) => updateField('employerName', e.target.value)} placeholder="Company name" />
              <TextField label="Employer address" value={form.employerAddress} onChange={(e) => updateField('employerAddress', e.target.value)} placeholder="Street address" />
              <TextField label="Supervisor name" value={form.supervisorName} onChange={(e) => updateField('supervisorName', e.target.value)} placeholder="Full name" />
              <TextField label="Supervisor phone" type="tel" value={form.supervisorPhone} onChange={(e) => updatePhone('supervisorPhone', e.target.value)} placeholder="(XXX) XXX-XXXX" invalid={!!getFieldError('supervisorPhone')} error={getFieldError('supervisorPhone')} />
              <TextField label="Job title" value={form.jobTitle} onChange={(e) => updateField('jobTitle', e.target.value)} placeholder="e.g. Software Engineer" />
              <TextField label="Monthly income ($)" value={form.monthlyAnnualIncome} onChange={(e) => updateField('monthlyAnnualIncome', e.target.value)} placeholder="e.g. $4,500" hint="Enter your gross monthly income." invalid={!!getFieldError('monthlyAnnualIncome')} error={getFieldError('monthlyAnnualIncome')} />
              <TextField label="Employment start date" type="date" value={form.employmentStartDate} onChange={(e) => updateField('employmentStartDate', e.target.value)} />
              <TextField label="Other income" value={form.otherIncome} onChange={(e) => updateField('otherIncome', e.target.value)} placeholder="Optional" />
            </Section>

            <Section
              number="06"
              title="References"
              description="Include two references who can help confirm your reliability as an applicant."
              sectionId="06"
              registerRef={registerSectionRef}
            >
              <TextField label="Reference 1 name" value={form.reference1Name} onChange={(e) => updateField('reference1Name', e.target.value)} placeholder="Full name" />
              <TextField label="Reference 1 relationship" value={form.reference1Relationship} onChange={(e) => updateField('reference1Relationship', e.target.value)} placeholder="e.g. Former employer" />
              <TextField label="Reference 1 phone" type="tel" value={form.reference1Phone} onChange={(e) => updatePhone('reference1Phone', e.target.value)} placeholder="(XXX) XXX-XXXX" invalid={!!getFieldError('reference1Phone')} error={getFieldError('reference1Phone')} />
              <TextField label="Reference 2 name" value={form.reference2Name} onChange={(e) => updateField('reference2Name', e.target.value)} placeholder="Full name" />
              <TextField label="Reference 2 relationship" value={form.reference2Relationship} onChange={(e) => updateField('reference2Relationship', e.target.value)} placeholder="e.g. Neighbor" />
              <TextField label="Reference 2 phone" type="tel" value={form.reference2Phone} onChange={(e) => updatePhone('reference2Phone', e.target.value)} placeholder="(XXX) XXX-XXXX" invalid={!!getFieldError('reference2Phone')} error={getFieldError('reference2Phone')} />
            </Section>

            <Section
              number="07"
              title="Additional details"
              description="Add occupancy, pet, and vehicle information to help complete the application review."
              sectionId="07"
              registerRef={registerSectionRef}
            >
              <TextField label="Number of occupants" value={form.numberOfOccupants} onChange={(e) => updateField('numberOfOccupants', e.target.value)} placeholder="e.g. 2" hint="Whole number." invalid={!!getFieldError('numberOfOccupants')} error={getFieldError('numberOfOccupants')} />
              <TextField label="Pets" value={form.pets} onChange={(e) => updateField('pets', e.target.value)} placeholder="Type, breed, weight" />
              <TextField label="Vehicles" value={form.vehicles} onChange={(e) => updateField('vehicles', e.target.value)} placeholder="Make, model, license plate" full />
            </Section>

            <Section
              number="08"
              title="Additional review questions"
              description="Answer the standard application questions used during leasing review."
              sectionId="08"
              registerRef={registerSectionRef}
              invalid={hasSectionError('08')}
              missingCount={invalidSections['08'] || 0}
            >
              <SelectField label="Have you ever been evicted?" value={form.evicted} onChange={(e) => updateField('evicted', e.target.value)} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />
              <SelectField label="Have you ever filed for bankruptcy?" value={form.bankruptcy} onChange={(e) => updateField('bankruptcy', e.target.value)} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />
              <SelectField label="Any criminal convictions?" value={form.criminalConvictions} onChange={(e) => updateField('criminalConvictions', e.target.value)} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />
            </Section>

            <Section
              number="09"
              title="Signature"
              description="Type legal names and dates to confirm the application contents are accurate."
              sectionId="09"
              registerRef={registerSectionRef}
            >
              <TextField label="Applicant signature" value={form.applicantSignature} onChange={(e) => updateField('applicantSignature', e.target.value)} placeholder="Type full legal name" />
              <TextField label="Applicant signature date" type="date" value={form.applicantSignatureDate} onChange={(e) => updateField('applicantSignatureDate', e.target.value)} />
              <TextField label="Co-applicant signature" value={form.coApplicantSignature} onChange={(e) => updateField('coApplicantSignature', e.target.value)} placeholder="Type full legal name" />
              <TextField label="Co-applicant signature date" type="date" value={form.coApplicantSignatureDate} onChange={(e) => updateField('coApplicantSignatureDate', e.target.value)} />
            </Section>

            <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-soft md:p-8">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-axis/10 text-axis"><CheckIcon /></span>
                <div>
                  <h2 className="text-2xl font-black tracking-tight text-slate-900">Review before submitting</h2>
                  <p className="mt-1 text-sm text-slate-500">Key details from your application.</p>
                </div>
              </div>

              <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {[
                  ['Applicant', applicantName || '—'],
                  ['Email', form.email || '—'],
                  ['Phone', form.phoneNumber || '—'],
                  ['Move-in', form.desiredMoveInDate ? formatDate(form.desiredMoveInDate) : '—'],
                  ['Property', form.propertyAddress || '—'],
                  ['Room', form.roomNumber || '—'],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</div>
                    <div className="mt-2 text-sm font-medium leading-6 text-slate-900">{value}</div>
                  </div>
                ))}
              </div>

              {status === 'success' && (
                <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
                  ✅ Application sent successfully. Check your inbox for a confirmation copy.
                </div>
              )}
              {status === 'error' && (
                <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
                  ❌ {errorMessage || 'Unable to submit. Please review the highlighted fields.'}
                </div>
              )}

              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-slate-500">Submitting confirms the information is accurate.</p>
                <button onClick={submitApplication} disabled={status === 'sending'} className="flex w-full items-center justify-center rounded-full bg-axis px-7 py-3 text-sm font-semibold text-white shadow-soft transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60 sm:inline-flex sm:w-auto">
                  {status === 'sending' ? 'Submitting…' : 'Submit application'}
                </button>
              </div>
            </section>
          </main>

          <aside className="hidden lg:block lg:sticky lg:top-24">
            <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-soft">
              <div className="border-b border-slate-200 bg-stone-50 px-6 py-6">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Application status</div>
                <div className="mt-3 text-3xl font-black text-slate-900">{progress}% complete</div>
                <div className="mt-3 h-2 rounded-full bg-slate-200">
                  <div className="h-2 rounded-full bg-axis transition-all duration-300" style={{ width: `${progress}%` }} />
                </div>
                <p className="mt-4 text-sm leading-6 text-slate-600">Complete required fields to unlock submission.</p>
              </div>

              <div className="space-y-6 p-6">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Application snapshot</div>
                  <div className="mt-4 space-y-3">
                    {[
                      ['Property', propertyName],
                      ['Address', form.propertyAddress || 'Enter property address'],
                      ['Room', form.roomNumber || 'Add room number'],
                      ['Applicant', applicantName || 'Add your name'],
                      ['Move-in', form.desiredMoveInDate ? formatDate(form.desiredMoveInDate) : 'Choose a date'],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</div>
                        <div className="mt-1 text-sm font-medium leading-6 text-slate-900">{value}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Checklist</div>
                  <div className="mt-4 space-y-3">
                    {[
                      { done: !!form.firstName && !!form.lastName, label: 'Applicant name added' },
                      { done: !!form.phoneNumber && !!form.email, label: 'Contact details completed' },
                      { done: !!form.desiredMoveInDate, label: 'Move-in timing selected' },
                    ].map((item) => (
                      <div key={item.label} className="flex items-start gap-3 rounded-2xl border border-slate-200 px-4 py-3">
                        <span className={`mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full ${item.done ? 'bg-axis text-white' : 'bg-slate-100 text-slate-400'}`}>
                          <CheckIcon />
                        </span>
                        <div className="text-sm font-medium text-slate-700">{item.label}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[24px] border border-slate-200 bg-stone-50 p-5">
                  <div className="flex items-start gap-3">
                    <div className="rounded-2xl bg-white p-2 text-axis shadow-sm"><ShieldIcon /></div>
                    <div>
                      <div className="text-sm font-bold text-slate-900">Submission notes</div>
                      <p className="mt-2 text-sm leading-6 text-slate-600">Sections with missing fields are highlighted.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}

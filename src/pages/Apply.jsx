import { useMemo, useState } from 'react'
import { Seo } from '../lib/seo'
import { properties } from '../data/properties'

const AIRTABLE_BASE_ID = import.meta.env.VITE_AIRTABLE_APPLICATIONS_BASE_ID || 'appNBX2inqfJMyqYV'
const APPLICATIONS_TABLE = import.meta.env.VITE_AIRTABLE_APPLICATIONS_TABLE || 'Applications'
const COAPPLICANTS_TABLE = import.meta.env.VITE_AIRTABLE_COAPPLICANTS_TABLE || 'Co-Applicants'
const AIRTABLE_TOKEN = import.meta.env.VITE_AIRTABLE_TOKEN

const HISTORY_OPTIONS = ['No', 'Yes']
const COAPPLICANT_ROLE_OPTIONS = ['Co-Signer', 'Co-Applicant']
const LEASE_TERMS = [
  '3-Month Summer (Jun 16 – Sep 14)',
  '9-Month Academic (Sep 15 – Jun 15)',
  '12-Month (flexible start)',
  'Other / Custom dates',
]

const PROPERTY_OPTIONS = properties
  .map((property) => ({
    id: property.slug,
    name: property.name,
    address: property.address,
    rooms: [...new Set((property.roomPlans || []).flatMap((plan) => plan.rooms || []).map((room) => room.name))]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
  }))
  .sort((a, b) => a.name.localeCompare(b.name))

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10)
}

function toCurrencyNumber(value) {
  if (!value) return null
  const numeric = Number(String(value).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(numeric) ? numeric : null
}

function defaultApplicant() {
  return {
    fullName: '',
    email: '',
    phone: '',
    dateOfBirth: '',
    ssn: '',
    license: '',
    currentAddress: '',
    currentCity: '',
    currentState: '',
    currentZip: '',
    currentLandlordName: '',
    currentLandlordPhone: '',
    currentMoveInDate: '',
    currentMoveOutDate: '',
    currentReasonForLeaving: '',
    previousAddress: '',
    previousCity: '',
    previousState: '',
    previousZip: '',
    previousLandlordName: '',
    previousLandlordPhone: '',
    previousMoveInDate: '',
    previousMoveOutDate: '',
    previousReasonForLeaving: '',
    employer: '',
    employerAddress: '',
    supervisorName: '',
    supervisorPhone: '',
    jobTitle: '',
    monthlyIncome: '',
    annualIncome: '',
    employmentStartDate: '',
    otherIncome: '',
    reference1Name: '',
    reference1Relationship: '',
    reference1Phone: '',
    reference2Name: '',
    reference2Relationship: '',
    reference2Phone: '',
    occupants: '',
    pets: '',
    vehicles: '',
    evictionHistory: '',
    bankruptcyHistory: '',
    criminalHistory: '',
    consent: false,
    signature: '',
    dateSigned: todayIsoDate(),
    notes: '',
  }
}

function defaultCoApplicant() {
  return {
    role: 'Co-Signer',
    fullName: '',
    email: '',
    phone: '',
    dateOfBirth: '',
    ssn: '',
    license: '',
    currentAddress: '',
    city: '',
    state: '',
    zip: '',
    employer: '',
    employerAddress: '',
    supervisorName: '',
    supervisorPhone: '',
    jobTitle: '',
    monthlyIncome: '',
    annualIncome: '',
    employmentStartDate: '',
    otherIncome: '',
    bankruptcyHistory: '',
    criminalHistory: '',
    consent: false,
    signature: '',
    dateSigned: todayIsoDate(),
    notes: '',
  }
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

async function submitToAirtable(tableName, fields) {
  if (!AIRTABLE_TOKEN) throw new Error('VITE_AIRTABLE_TOKEN is not set in environment variables.')

  const response = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(tableName)}`, {
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

  return response.json()
}

function buildApplicantNotes(application, applicant, needsCoSigner) {
  const lines = [
    `Property Address Applying For: ${application.propertyAddress || 'Not provided'}`,
    `Requested Property: ${application.propertyName}`,
    `Requested Room: ${application.roomNumber || 'Not specified'}`,
    `Desired Move-In Date: ${application.desiredMoveInDate}`,
    `Lease Term: ${application.leaseTerm === 'Other / Custom dates' ? application.leaseTermOther : application.leaseTerm}`,
    `Current Landlord Name: ${applicant.currentLandlordName || 'Not provided'}`,
    `Current Landlord Phone: ${applicant.currentLandlordPhone || 'Not provided'}`,
    `Current Move-In Date: ${applicant.currentMoveInDate || 'Not provided'}`,
    `Current Move-Out Date: ${applicant.currentMoveOutDate || 'Not provided'}`,
    `Current Reason for Leaving: ${applicant.currentReasonForLeaving || 'Not provided'}`,
    `Previous Address: ${applicant.previousAddress || 'Not provided'}`,
    `Previous City / State / ZIP: ${[applicant.previousCity, applicant.previousState, applicant.previousZip].filter(Boolean).join(', ') || 'Not provided'}`,
    `Previous Landlord Name: ${applicant.previousLandlordName || 'Not provided'}`,
    `Previous Landlord Phone: ${applicant.previousLandlordPhone || 'Not provided'}`,
    `Previous Move-In Date: ${applicant.previousMoveInDate || 'Not provided'}`,
    `Previous Move-Out Date: ${applicant.previousMoveOutDate || 'Not provided'}`,
    `Previous Reason for Leaving: ${applicant.previousReasonForLeaving || 'Not provided'}`,
    `Reference 1: ${[applicant.reference1Name, applicant.reference1Relationship, applicant.reference1Phone].filter(Boolean).join(' | ') || 'Not provided'}`,
    `Reference 2: ${[applicant.reference2Name, applicant.reference2Relationship, applicant.reference2Phone].filter(Boolean).join(' | ') || 'Not provided'}`,
    `Occupants: ${applicant.occupants || 'Not provided'}`,
    `Pets: ${applicant.pets || 'Not provided'}`,
    `Vehicles: ${applicant.vehicles || 'Not provided'}`,
    `Eviction History: ${applicant.evictionHistory || 'Not provided'}`,
    `Needs Co-Signer: ${needsCoSigner ? 'Yes' : 'No'}`,
    applicant.notes ? `Additional Notes: ${applicant.notes}` : null,
  ]

  return lines.filter(Boolean).join('\n')
}

function buildCoApplicantNotes(coApplicant) {
  return [
    coApplicant.notes ? `Additional Notes: ${coApplicant.notes}` : null,
  ].filter(Boolean).join('\n')
}

function buildMailtoFallback(application, applicant, needsCoSigner, coApplicant) {
  const lines = [
    `Property Address Applying For: ${application.propertyAddress || 'Not provided'}`,
    `Property Name: ${application.propertyName}`,
    `Room Number: ${application.roomNumber || 'Not specified'}`,
    `Desired Move-In Date: ${application.desiredMoveInDate}`,
    `Lease Term: ${application.leaseTerm === 'Other / Custom dates' ? application.leaseTermOther : application.leaseTerm}`,
    `Applicant Full Name: ${applicant.fullName}`,
    `Applicant Email: ${applicant.email}`,
    `Applicant Phone Number: ${applicant.phone}`,
    `Applicant Date of Birth: ${applicant.dateOfBirth}`,
    `Applicant SSN No.: ${applicant.ssn || 'Not provided'}`,
    `Applicant Driving License No.: ${applicant.license}`,
    `Applicant Current Address: ${applicant.currentAddress}`,
    `Applicant City: ${applicant.currentCity}`,
    `Applicant State: ${applicant.currentState}`,
    `Applicant ZIP: ${applicant.currentZip}`,
    `Applicant Current Landlord Name: ${applicant.currentLandlordName || 'Not provided'}`,
    `Applicant Current Landlord Phone: ${applicant.currentLandlordPhone || 'Not provided'}`,
    `Applicant Current Move-In Date: ${applicant.currentMoveInDate || 'Not provided'}`,
    `Applicant Current Move-Out Date: ${applicant.currentMoveOutDate || 'Not provided'}`,
    `Applicant Current Reason for Leaving: ${applicant.currentReasonForLeaving || 'Not provided'}`,
    `Applicant Previous Address: ${applicant.previousAddress || 'Not provided'}`,
    `Applicant Previous City: ${applicant.previousCity || 'Not provided'}`,
    `Applicant Previous State: ${applicant.previousState || 'Not provided'}`,
    `Applicant Previous ZIP: ${applicant.previousZip || 'Not provided'}`,
    `Applicant Previous Landlord Name: ${applicant.previousLandlordName || 'Not provided'}`,
    `Applicant Previous Landlord Phone: ${applicant.previousLandlordPhone || 'Not provided'}`,
    `Applicant Previous Move-In Date: ${applicant.previousMoveInDate || 'Not provided'}`,
    `Applicant Previous Move-Out Date: ${applicant.previousMoveOutDate || 'Not provided'}`,
    `Applicant Previous Reason for Leaving: ${applicant.previousReasonForLeaving || 'Not provided'}`,
    `Applicant Employer: ${applicant.employer || 'Not provided'}`,
    `Applicant Employer Address: ${applicant.employerAddress || 'Not provided'}`,
    `Applicant Supervisor Name: ${applicant.supervisorName || 'Not provided'}`,
    `Applicant Supervisor Phone: ${applicant.supervisorPhone || 'Not provided'}`,
    `Applicant Job Title: ${applicant.jobTitle || 'Not provided'}`,
    `Applicant Monthly Income: ${applicant.monthlyIncome || 'Not provided'}`,
    `Applicant Annual Income: ${applicant.annualIncome || 'Not provided'}`,
    `Applicant Employment Start Date: ${applicant.employmentStartDate || 'Not provided'}`,
    `Applicant Other Income: ${applicant.otherIncome || 'Not provided'}`,
    `Reference 1: ${[applicant.reference1Name, applicant.reference1Relationship, applicant.reference1Phone].filter(Boolean).join(' | ') || 'Not provided'}`,
    `Reference 2: ${[applicant.reference2Name, applicant.reference2Relationship, applicant.reference2Phone].filter(Boolean).join(' | ') || 'Not provided'}`,
    `Occupants: ${applicant.occupants || 'Not provided'}`,
    `Pets: ${applicant.pets || 'Not provided'}`,
    `Vehicles: ${applicant.vehicles || 'Not provided'}`,
    `Eviction History: ${applicant.evictionHistory || 'Not provided'}`,
    `Applicant Bankruptcy History: ${applicant.bankruptcyHistory}`,
    `Applicant Criminal History: ${applicant.criminalHistory}`,
    `Applicant Consent for Credit and Background Check: ${applicant.consent ? 'Yes' : 'No'}`,
    `Applicant Signature: ${applicant.signature || 'Not provided'}`,
    `Applicant Date Signed: ${applicant.dateSigned}`,
    applicant.notes ? `Applicant Notes: ${applicant.notes}` : null,
    `Needs Co-Signer: ${needsCoSigner ? 'Yes' : 'No'}`,
  ]

  if (needsCoSigner) {
    lines.push(
      '',
      'Co-Applicant / Co-Signer',
      `Role: ${coApplicant.role}`,
      `Full Name: ${coApplicant.fullName}`,
      `Email: ${coApplicant.email}`,
      `Phone Number: ${coApplicant.phone}`,
      `Date of Birth: ${coApplicant.dateOfBirth}`,
      `SSN No.: ${coApplicant.ssn || 'Not provided'}`,
      `Driving License No.: ${coApplicant.license || 'Not provided'}`,
      `Current Address: ${coApplicant.currentAddress || 'Not provided'}`,
      `City: ${coApplicant.city || 'Not provided'}`,
      `State: ${coApplicant.state || 'Not provided'}`,
      `ZIP: ${coApplicant.zip || 'Not provided'}`,
      `Employer: ${coApplicant.employer || 'Not provided'}`,
      `Employer Address: ${coApplicant.employerAddress || 'Not provided'}`,
      `Supervisor Name: ${coApplicant.supervisorName || 'Not provided'}`,
      `Supervisor Phone: ${coApplicant.supervisorPhone || 'Not provided'}`,
      `Job Title: ${coApplicant.jobTitle || 'Not provided'}`,
      `Monthly Income: ${coApplicant.monthlyIncome || 'Not provided'}`,
      `Annual Income: ${coApplicant.annualIncome || 'Not provided'}`,
      `Employment Start Date: ${coApplicant.employmentStartDate || 'Not provided'}`,
      `Other Income: ${coApplicant.otherIncome || 'Not provided'}`,
      `Bankruptcy History: ${coApplicant.bankruptcyHistory || 'Not provided'}`,
      `Criminal History: ${coApplicant.criminalHistory || 'Not provided'}`,
      `Consent for Credit and Background Check: ${coApplicant.consent ? 'Yes' : 'No'}`,
      `Signature: ${coApplicant.signature || 'Not provided'}`,
      `Date Signed: ${coApplicant.dateSigned}`,
      coApplicant.notes ? `Notes: ${coApplicant.notes}` : null,
    )
  }

  const subject = `Application — ${applicant.fullName} for ${application.propertyName}`
  return `mailto:info@axis-seattle-housing.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.filter(Boolean).join('\n'))}`
}

function Section({ title, children }) {
  return (
    <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-soft">
      <h2 className="text-2xl font-black text-slate-900">{title}</h2>
      {children}
    </div>
  )
}

function ApplicantFields({ applicant, setApplicant, prefix = 'Applicant', isCoApplicant = false }) {
  const setField = (key, value) => setApplicant((prev) => ({ ...prev, [key]: value }))
  const consentLabel = isCoApplicant ? 'Consent for Credit and Background Check' : 'Applicant Consent for Credit and Background Check'

  return (
    <>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={`${prefix} Full Name`} required>
          <input required className={inputCls} value={applicant.fullName} onChange={(e) => setField('fullName', e.target.value)} />
        </Field>
        <Field label={`${prefix} Email`} required>
          <input required type="email" className={inputCls} value={applicant.email} onChange={(e) => setField('email', e.target.value)} />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        <Field label={`${prefix} Phone Number`} required>
          <input required type="tel" className={inputCls} value={applicant.phone} onChange={(e) => setField('phone', e.target.value)} />
        </Field>
        <Field label={`${prefix} Date of Birth`} required>
          <input required type="date" className={inputCls} value={applicant.dateOfBirth} onChange={(e) => setField('dateOfBirth', e.target.value)} />
        </Field>
        <Field label={`${prefix} Driving License / ID #`} required>
          <input required className={inputCls} value={applicant.license} onChange={(e) => setField('license', e.target.value)} />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={`${prefix} Social Security #`}>
          <input className={inputCls} value={applicant.ssn} onChange={(e) => setField('ssn', e.target.value)} />
        </Field>
        {!isCoApplicant && (
          <Field label="Eviction History" required>
            <select required className={selectCls} value={applicant.evictionHistory} onChange={(e) => setField('evictionHistory', e.target.value)}>
              <option value="" disabled>Select…</option>
              {HISTORY_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </Field>
        )}
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        <Field label={`${prefix} Current Address`} required>
          <input required className={inputCls} value={applicant.currentAddress} onChange={(e) => setField('currentAddress', e.target.value)} />
        </Field>
        <Field label={`${prefix} City`} required>
          <input required className={inputCls} value={applicant.currentCity ?? applicant.city ?? ''} onChange={(e) => setField(applicant.currentCity !== undefined ? 'currentCity' : 'city', e.target.value)} />
        </Field>
        <div className="grid gap-5 grid-cols-2">
          <Field label={`${prefix} State`} required>
            <input required className={inputCls} value={applicant.currentState ?? applicant.state ?? ''} onChange={(e) => setField(applicant.currentState !== undefined ? 'currentState' : 'state', e.target.value)} />
          </Field>
          <Field label={`${prefix} ZIP`} required>
            <input required className={inputCls} value={applicant.currentZip ?? applicant.zip ?? ''} onChange={(e) => setField(applicant.currentZip !== undefined ? 'currentZip' : 'zip', e.target.value)} />
          </Field>
        </div>
      </div>

      {!isCoApplicant && (
        <>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Current Landlord / Property Manager Name">
              <input className={inputCls} value={applicant.currentLandlordName} onChange={(e) => setField('currentLandlordName', e.target.value)} />
            </Field>
            <Field label="Current Landlord Phone #">
              <input type="tel" className={inputCls} value={applicant.currentLandlordPhone} onChange={(e) => setField('currentLandlordPhone', e.target.value)} />
            </Field>
          </div>

          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="Current Move-in Date">
              <input type="date" className={inputCls} value={applicant.currentMoveInDate} onChange={(e) => setField('currentMoveInDate', e.target.value)} />
            </Field>
            <Field label="Current Move-out Date">
              <input type="date" className={inputCls} value={applicant.currentMoveOutDate} onChange={(e) => setField('currentMoveOutDate', e.target.value)} />
            </Field>
            <Field label="Reason for Leaving">
              <input className={inputCls} value={applicant.currentReasonForLeaving} onChange={(e) => setField('currentReasonForLeaving', e.target.value)} />
            </Field>
          </div>
        </>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={`${prefix} Employer`}>
          <input className={inputCls} value={applicant.employer} onChange={(e) => setField('employer', e.target.value)} />
        </Field>
        <Field label={`${prefix} Employer Address`}>
          <input className={inputCls} value={applicant.employerAddress} onChange={(e) => setField('employerAddress', e.target.value)} />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={`${prefix} Supervisor Name`}>
          <input className={inputCls} value={applicant.supervisorName} onChange={(e) => setField('supervisorName', e.target.value)} />
        </Field>
        <Field label={`${prefix} Supervisor Phone #`}>
          <input type="tel" className={inputCls} value={applicant.supervisorPhone} onChange={(e) => setField('supervisorPhone', e.target.value)} />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-4">
        <Field label={`${prefix} Job Title`}>
          <input className={inputCls} value={applicant.jobTitle} onChange={(e) => setField('jobTitle', e.target.value)} />
        </Field>
        <Field label={`${prefix} Monthly Income`}>
          <input className={inputCls} value={applicant.monthlyIncome} onChange={(e) => setField('monthlyIncome', e.target.value)} />
        </Field>
        <Field label={`${prefix} Annual Income`}>
          <input className={inputCls} value={applicant.annualIncome} onChange={(e) => setField('annualIncome', e.target.value)} />
        </Field>
        <Field label={`${prefix} Employment Start Date`}>
          <input type="date" className={inputCls} value={applicant.employmentStartDate} onChange={(e) => setField('employmentStartDate', e.target.value)} />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={`${prefix} Other Income`}>
          <input className={inputCls} value={applicant.otherIncome} onChange={(e) => setField('otherIncome', e.target.value)} />
        </Field>
        <Field label={`${prefix} Bankruptcy History`} required>
          <select required className={selectCls} value={applicant.bankruptcyHistory} onChange={(e) => setField('bankruptcyHistory', e.target.value)}>
            <option value="" disabled>Select…</option>
            {HISTORY_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={`${prefix} Criminal History`} required>
          <select required className={selectCls} value={applicant.criminalHistory} onChange={(e) => setField('criminalHistory', e.target.value)}>
            <option value="" disabled>Select…</option>
            {HISTORY_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </Field>
        <Field label={consentLabel} required hint="This must be checked to submit the application.">
          <label className="flex min-h-[52px] items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-700">
            <input type="checkbox" checked={applicant.consent} onChange={(e) => setField('consent', e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-axis focus:ring-axis" />
            I consent to the credit and background check.
          </label>
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={`${prefix} Signature`} required>
          <input required className={inputCls} placeholder="Type your full legal name" value={applicant.signature} onChange={(e) => setField('signature', e.target.value)} />
        </Field>
        <Field label={`${prefix} Date Signed`} required>
          <input required type="date" className={inputCls} value={applicant.dateSigned} onChange={(e) => setField('dateSigned', e.target.value)} />
        </Field>
      </div>

      <Field label={`${prefix} Supporting Notes`} hint="Use this for anything not captured in the standard Airtable fields.">
        <textarea className={`${inputCls} min-h-[96px] resize-y`} value={applicant.notes} onChange={(e) => setField('notes', e.target.value)} />
      </Field>
    </>
  )
}

export default function Apply() {
  const [application, setApplication] = useState({
    propertyName: '',
    propertyAddress: '',
    roomNumber: '',
    desiredMoveInDate: '',
    leaseTerm: LEASE_TERMS[0],
    leaseTermOther: '',
    needsCoSigner: false,
  })
  const [applicant, setApplicant] = useState(defaultApplicant())
  const [coApplicant, setCoApplicant] = useState(defaultCoApplicant())
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  const selectedProperty = useMemo(
    () => PROPERTY_OPTIONS.find((property) => property.name === application.propertyName),
    [application.propertyName],
  )

  function setApplicationField(key, value) {
    setApplication((prev) => {
      const next = { ...prev, [key]: value }
      if (key === 'propertyName') {
        next.roomNumber = ''
        next.propertyAddress = PROPERTY_OPTIONS.find((property) => property.name === value)?.address || ''
      }
      return next
    })
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setSubmitting(true)
    setError('')

    if (!applicant.consent) {
      setError('The applicant must consent to the credit and background check before submitting.')
      setSubmitting(false)
      return
    }

    if (application.needsCoSigner && !coApplicant.consent) {
      setError('The co-signer / co-applicant must consent to the credit and background check before submitting.')
      setSubmitting(false)
      return
    }

    const applicationFields = {
      'Applicant Full Name': applicant.fullName,
      'Applicant Email': applicant.email,
      'Applicant Phone Number': applicant.phone,
      'Applicant Date of Birth': applicant.dateOfBirth,
      'Applicant SSN No.': applicant.ssn || '',
      'Applicant Driving License No.': applicant.license,
      'Applicant Current Address': applicant.currentAddress,
      'Applicant City': applicant.currentCity,
      'Applicant State': applicant.currentState,
      'Applicant ZIP': applicant.currentZip,
      'Applicant Employer': applicant.employer || '',
      'Applicant Employer Address': applicant.employerAddress || '',
      'Applicant Supervisor Name': applicant.supervisorName || '',
      'Applicant Supervisor Phone': applicant.supervisorPhone || '',
      'Applicant Job Title': applicant.jobTitle || '',
      'Applicant Monthly Income': toCurrencyNumber(applicant.monthlyIncome),
      'Applicant Annual Income': toCurrencyNumber(applicant.annualIncome),
      'Applicant Employment Start Date': applicant.employmentStartDate || null,
      'Applicant Other Income': applicant.otherIncome || '',
      'Applicant Bankruptcy History': applicant.bankruptcyHistory,
      'Applicant Criminal History': applicant.criminalHistory,
      'Applicant Consent for Credit and Background Check': applicant.consent,
      'Applicant Signature': applicant.signature,
      'Applicant Date Signed': applicant.dateSigned,
      'Applicant Notes': buildApplicantNotes(application, applicant, application.needsCoSigner),
    }

    try {
      const applicationRecord = await submitToAirtable(APPLICATIONS_TABLE, applicationFields)

      if (application.needsCoSigner) {
        const coApplicantFields = {
          'Linked Application': [applicationRecord.id],
          'Role': coApplicant.role,
          'Full Name': coApplicant.fullName,
          'Email': coApplicant.email,
          'Phone Number': coApplicant.phone,
          'Date of Birth': coApplicant.dateOfBirth,
          'SSN No.': coApplicant.ssn || '',
          'Driving License No.': coApplicant.license || '',
          'Current Address': coApplicant.currentAddress || '',
          'City': coApplicant.city || '',
          'State': coApplicant.state || '',
          'ZIP': coApplicant.zip || '',
          'Employer': coApplicant.employer || '',
          'Employer Address': coApplicant.employerAddress || '',
          'Supervisor Name': coApplicant.supervisorName || '',
          'Supervisor Phone': coApplicant.supervisorPhone || '',
          'Job Title': coApplicant.jobTitle || '',
          'Monthly Income': toCurrencyNumber(coApplicant.monthlyIncome),
          'Annual Income': toCurrencyNumber(coApplicant.annualIncome),
          'Employment Start Date': coApplicant.employmentStartDate || null,
          'Other Income': coApplicant.otherIncome || '',
          'Bankruptcy History': coApplicant.bankruptcyHistory,
          'Criminal History': coApplicant.criminalHistory,
          'Consent for Credit and Background Check': coApplicant.consent,
          'Signature': coApplicant.signature,
          'Date Signed': coApplicant.dateSigned,
          'Notes': buildCoApplicantNotes(coApplicant),
        }

        await submitToAirtable(COAPPLICANTS_TABLE, coApplicantFields)
      }

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
            Thanks, {applicant.fullName.split(' ')[0]}! Your application was submitted to Axis. If you requested a co-signer
            or co-applicant, that linked record was sent too.
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
        description="Submit a rental application for Axis Seattle Housing, with optional co-signer support."
        pathname="/apply"
      />

      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="mb-8">
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">Axis applications</div>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">Residential Rental Application</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            This application is now wired to your Airtable `Applications` and `Co-Applicants` tables, including optional
            co-signer support.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <Section title="Property Information">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Property Name" required>
                <select required className={selectCls} value={application.propertyName} onChange={(e) => setApplicationField('propertyName', e.target.value)}>
                  <option value="" disabled>Select a property…</option>
                  {PROPERTY_OPTIONS.map((property) => (
                    <option key={property.id} value={property.name}>{property.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Property Address Applying For">
                <input className={inputCls} value={application.propertyAddress} onChange={(e) => setApplicationField('propertyAddress', e.target.value)} />
              </Field>
            </div>

            <div className="grid gap-5 sm:grid-cols-3">
              <Field label="Room Number">
                <select className={selectCls} value={application.roomNumber} onChange={(e) => setApplicationField('roomNumber', e.target.value)} disabled={!selectedProperty}>
                  <option value="">{selectedProperty ? 'Select a room…' : 'Choose a property first'}</option>
                  {(selectedProperty?.rooms || []).map((room) => (
                    <option key={room} value={room}>{room}</option>
                  ))}
                </select>
              </Field>
              <Field label="Desired Move-In Date" required>
                <input required type="date" className={inputCls} value={application.desiredMoveInDate} onChange={(e) => setApplicationField('desiredMoveInDate', e.target.value)} />
              </Field>
              <Field label="Lease Term" required>
                <select required className={selectCls} value={application.leaseTerm} onChange={(e) => setApplicationField('leaseTerm', e.target.value)}>
                  {LEASE_TERMS.map((term) => (
                    <option key={term} value={term}>{term}</option>
                  ))}
                </select>
              </Field>
            </div>

            {application.leaseTerm === 'Other / Custom dates' && (
              <Field label="Custom Lease Term">
                <input className={inputCls} value={application.leaseTermOther} onChange={(e) => setApplicationField('leaseTermOther', e.target.value)} placeholder="Describe the dates requested" />
              </Field>
            )}

            <Field label="Do you need a co-signer?" required>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => setApplicationField('needsCoSigner', false)}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${!application.needsCoSigner ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700'}`}
                >
                  No
                </button>
                <button
                  type="button"
                  onClick={() => setApplicationField('needsCoSigner', true)}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${application.needsCoSigner ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700'}`}
                >
                  Yes
                </button>
              </div>
            </Field>
          </Section>

          <Section title="Applicant Information">
            <ApplicantFields applicant={applicant} setApplicant={setApplicant} />
          </Section>

          <Section title="Previous Address">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Previous Address">
                <input className={inputCls} value={applicant.previousAddress} onChange={(e) => setApplicant((prev) => ({ ...prev, previousAddress: e.target.value }))} />
              </Field>
              <Field label="Previous City">
                <input className={inputCls} value={applicant.previousCity} onChange={(e) => setApplicant((prev) => ({ ...prev, previousCity: e.target.value }))} />
              </Field>
            </div>

            <div className="grid gap-5 sm:grid-cols-3">
              <Field label="Previous State">
                <input className={inputCls} value={applicant.previousState} onChange={(e) => setApplicant((prev) => ({ ...prev, previousState: e.target.value }))} />
              </Field>
              <Field label="Previous ZIP">
                <input className={inputCls} value={applicant.previousZip} onChange={(e) => setApplicant((prev) => ({ ...prev, previousZip: e.target.value }))} />
              </Field>
              <Field label="Previous Landlord / Property Manager Name">
                <input className={inputCls} value={applicant.previousLandlordName} onChange={(e) => setApplicant((prev) => ({ ...prev, previousLandlordName: e.target.value }))} />
              </Field>
            </div>

            <div className="grid gap-5 sm:grid-cols-3">
              <Field label="Previous Landlord Phone #">
                <input type="tel" className={inputCls} value={applicant.previousLandlordPhone} onChange={(e) => setApplicant((prev) => ({ ...prev, previousLandlordPhone: e.target.value }))} />
              </Field>
              <Field label="Previous Move-In Date">
                <input type="date" className={inputCls} value={applicant.previousMoveInDate} onChange={(e) => setApplicant((prev) => ({ ...prev, previousMoveInDate: e.target.value }))} />
              </Field>
              <Field label="Previous Move-Out Date">
                <input type="date" className={inputCls} value={applicant.previousMoveOutDate} onChange={(e) => setApplicant((prev) => ({ ...prev, previousMoveOutDate: e.target.value }))} />
              </Field>
            </div>

            <Field label="Previous Reason for Leaving">
              <input className={inputCls} value={applicant.previousReasonForLeaving} onChange={(e) => setApplicant((prev) => ({ ...prev, previousReasonForLeaving: e.target.value }))} />
            </Field>
          </Section>

          <Section title="References">
            <div className="grid gap-5 sm:grid-cols-3">
              <Field label="Reference 1 Name">
                <input className={inputCls} value={applicant.reference1Name} onChange={(e) => setApplicant((prev) => ({ ...prev, reference1Name: e.target.value }))} />
              </Field>
              <Field label="Reference 1 Relationship">
                <input className={inputCls} value={applicant.reference1Relationship} onChange={(e) => setApplicant((prev) => ({ ...prev, reference1Relationship: e.target.value }))} />
              </Field>
              <Field label="Reference 1 Phone #">
                <input type="tel" className={inputCls} value={applicant.reference1Phone} onChange={(e) => setApplicant((prev) => ({ ...prev, reference1Phone: e.target.value }))} />
              </Field>
            </div>

            <div className="grid gap-5 sm:grid-cols-3">
              <Field label="Reference 2 Name">
                <input className={inputCls} value={applicant.reference2Name} onChange={(e) => setApplicant((prev) => ({ ...prev, reference2Name: e.target.value }))} />
              </Field>
              <Field label="Reference 2 Relationship">
                <input className={inputCls} value={applicant.reference2Relationship} onChange={(e) => setApplicant((prev) => ({ ...prev, reference2Relationship: e.target.value }))} />
              </Field>
              <Field label="Reference 2 Phone #">
                <input type="tel" className={inputCls} value={applicant.reference2Phone} onChange={(e) => setApplicant((prev) => ({ ...prev, reference2Phone: e.target.value }))} />
              </Field>
            </div>
          </Section>

          <Section title="Additional Information">
            <div className="grid gap-5 sm:grid-cols-3">
              <Field label="Number of Occupants">
                <input className={inputCls} value={applicant.occupants} onChange={(e) => setApplicant((prev) => ({ ...prev, occupants: e.target.value }))} />
              </Field>
              <Field label="Pets (type / breed / weight)">
                <input className={inputCls} value={applicant.pets} onChange={(e) => setApplicant((prev) => ({ ...prev, pets: e.target.value }))} />
              </Field>
              <Field label="Vehicles (make / model / license plate)">
                <input className={inputCls} value={applicant.vehicles} onChange={(e) => setApplicant((prev) => ({ ...prev, vehicles: e.target.value }))} />
              </Field>
            </div>
          </Section>

          {application.needsCoSigner && (
            <Section title="Co-Signer / Co-Applicant">
              <Field label="Role" required>
                <select required className={selectCls} value={coApplicant.role} onChange={(e) => setCoApplicant((prev) => ({ ...prev, role: e.target.value }))}>
                  {COAPPLICANT_ROLE_OPTIONS.map((role) => (
                    <option key={role} value={role}>{role}</option>
                  ))}
                </select>
              </Field>
              <ApplicantFields applicant={coApplicant} setApplicant={setCoApplicant} prefix="Co-Applicant" isCoApplicant />
            </Section>
          )}

          {error && (
            <div className="space-y-3 rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
              <p className="font-semibold">Submission failed — Airtable didn&apos;t accept the application.</p>
              <p className="break-all font-mono text-xs text-red-600">{error}</p>
              <a
                href={buildMailtoFallback(application, applicant, application.needsCoSigner, coApplicant)}
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
            {submitting ? 'Submitting…' : 'Submit application'}
          </button>
        </form>
      </div>
    </div>
  )
}

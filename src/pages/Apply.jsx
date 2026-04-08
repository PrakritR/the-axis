import { useMemo, useState } from 'react'
import { Seo } from '../lib/seo'
import { properties } from '../data/properties'

const AIRTABLE_BASE_ID = import.meta.env.VITE_AIRTABLE_APPLICATIONS_BASE_ID || 'appNBX2inqfJMyqYV'
const APPLICATIONS_TABLE = import.meta.env.VITE_AIRTABLE_APPLICATIONS_TABLE || 'Applications'
const COSIGNERS_TABLE = import.meta.env.VITE_AIRTABLE_COAPPLICANTS_TABLE || 'Co-Applicants'
const AIRTABLE_TOKEN = import.meta.env.VITE_AIRTABLE_TOKEN

const HISTORY_OPTIONS = ['No', 'Yes']
const LEASE_TERMS = [
  '3-Month',
  '9-Month',
  '12-Month',
  'Custom',
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

const inputCls = 'w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-axis focus:ring-2 focus:ring-axis/20'
const selectCls = `${inputCls} appearance-none cursor-pointer`

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10)
}

function toCurrencyNumber(value) {
  if (!value) return null
  const numeric = Number(String(value).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(numeric) ? numeric : null
}

function escapeFormulaString(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function defaultSigner() {
  return {
    propertyName: '',
    propertyAddress: '',
    roomNumber: '',
    leaseStartDate: '',
    leaseEndDate: '',
    leaseTerm: LEASE_TERMS[0],
    fullName: '',
    dateOfBirth: '',
    ssn: '',
    license: '',
    phone: '',
    email: '',
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
    hasCosigner: '',
    consent: false,
    signature: '',
    dateSigned: todayIsoDate(),
    notes: '',
  }
}

function defaultCosigner() {
  return {
    linkedApplicationId: '',
    linkedSignerName: '',
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

function Field({ label, required, hint, children }) {
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

function Section({ title, children }) {
  return (
    <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-soft">
      <h2 className="text-2xl font-black text-slate-900">{title}</h2>
      {children}
    </div>
  )
}

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

async function findApplicationRecord({ applicationId, signerName }) {
  if (!AIRTABLE_TOKEN) throw new Error('VITE_AIRTABLE_TOKEN is not set in environment variables.')

  let filterByFormula = ''
  const numericId = Number(applicationId)

  if (applicationId && Number.isFinite(numericId)) {
    filterByFormula = `{Application ID} = ${numericId}`
  } else if (signerName) {
    filterByFormula = `{Applicant Full Name} = '${escapeFormulaString(signerName)}'`
  } else {
    throw new Error('Enter the signer application ID or signer full name so we can link the co-signer correctly.')
  }

  const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(APPLICATIONS_TABLE)}`)
  url.searchParams.set('maxRecords', '1')
  url.searchParams.set('filterByFormula', filterByFormula)

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${AIRTABLE_TOKEN}`,
    },
  })

  if (!response.ok) {
    const body = await response.text()
    let message = `Airtable lookup error ${response.status}`
    try {
      message += `: ${JSON.parse(body)?.error?.message}`
    } catch {
      message += `: ${body}`
    }
    throw new Error(message)
  }

  const data = await response.json()
  if (!data.records?.length) {
    throw new Error('We could not find the signer application. Double-check the application ID or signer full name.')
  }
  return data.records[0]
}

function buildSignerNotes(form) {
  return [
    `Property Address Applying For: ${form.propertyAddress || 'Not provided'}`,
    `Requested Room: ${form.roomNumber || 'Not specified'}`,
    `Lease Term: ${form.leaseTerm}`,
    `Lease Start Date: ${form.leaseStartDate || 'Not provided'}`,
    `Lease End Date: ${form.leaseEndDate || 'Not provided'}`,
    `Current Landlord Name: ${form.currentLandlordName || 'Not provided'}`,
    `Current Landlord Phone: ${form.currentLandlordPhone || 'Not provided'}`,
    `Current Move-In Date: ${form.currentMoveInDate || 'Not provided'}`,
    `Current Move-Out Date: ${form.currentMoveOutDate || 'Not provided'}`,
    `Current Reason for Leaving: ${form.currentReasonForLeaving || 'Not provided'}`,
    `Previous Address: ${form.previousAddress || 'Not provided'}`,
    `Previous City / State / ZIP: ${[form.previousCity, form.previousState, form.previousZip].filter(Boolean).join(', ') || 'Not provided'}`,
    `Previous Landlord Name: ${form.previousLandlordName || 'Not provided'}`,
    `Previous Landlord Phone: ${form.previousLandlordPhone || 'Not provided'}`,
    `Previous Move-In Date: ${form.previousMoveInDate || 'Not provided'}`,
    `Previous Move-Out Date: ${form.previousMoveOutDate || 'Not provided'}`,
    `Previous Reason for Leaving: ${form.previousReasonForLeaving || 'Not provided'}`,
    `Reference 1: ${[form.reference1Name, form.reference1Relationship, form.reference1Phone].filter(Boolean).join(' | ') || 'Not provided'}`,
    `Reference 2: ${[form.reference2Name, form.reference2Relationship, form.reference2Phone].filter(Boolean).join(' | ') || 'Not provided'}`,
    `Occupants: ${form.occupants || 'Not provided'}`,
    `Pets: ${form.pets || 'Not provided'}`,
    `Vehicles: ${form.vehicles || 'Not provided'}`,
    `Eviction History: ${form.evictionHistory || 'Not provided'}`,
    form.notes ? `Additional Notes: ${form.notes}` : null,
  ].filter(Boolean).join('\n')
}

function buildCosignerNotes(form) {
  return [
    `Linked Signer Application ID: ${form.linkedApplicationId || 'Not provided'}`,
    `Linked Signer Full Name: ${form.linkedSignerName || 'Not provided'}`,
    form.notes ? `Additional Notes: ${form.notes}` : null,
  ].filter(Boolean).join('\n')
}

function buildMailtoFallback(type, signer, cosigner) {
  const lines = type === 'signer'
    ? [
        `Submission Type: Signer`,
        `Property Name: ${signer.propertyName}`,
        `Property Address Applying For: ${signer.propertyAddress || 'Not provided'}`,
        `Room Number: ${signer.roomNumber || 'Not specified'}`,
        `Lease Term: ${signer.leaseTerm}`,
        `Lease Start Date: ${signer.leaseStartDate || 'Not provided'}`,
        `Lease End Date: ${signer.leaseEndDate || 'Not provided'}`,
        `Applicant Full Name: ${signer.fullName}`,
        `Applicant Date of Birth: ${signer.dateOfBirth}`,
        `Applicant SSN No.: ${signer.ssn || 'Not provided'}`,
        `Applicant Driving License No.: ${signer.license}`,
        `Applicant Phone Number: ${signer.phone}`,
        `Applicant Email: ${signer.email}`,
        `Applicant Current Address: ${signer.currentAddress}`,
        `Applicant City: ${signer.currentCity}`,
        `Applicant State: ${signer.currentState}`,
        `Applicant ZIP: ${signer.currentZip}`,
        `Applicant Employer: ${signer.employer || 'Not provided'}`,
        `Applicant Employer Address: ${signer.employerAddress || 'Not provided'}`,
        `Applicant Supervisor Name: ${signer.supervisorName || 'Not provided'}`,
        `Applicant Supervisor Phone: ${signer.supervisorPhone || 'Not provided'}`,
        `Applicant Job Title: ${signer.jobTitle || 'Not provided'}`,
        `Applicant Monthly Income: ${signer.monthlyIncome || 'Not provided'}`,
        `Applicant Annual Income: ${signer.annualIncome || 'Not provided'}`,
        `Applicant Employment Start Date: ${signer.employmentStartDate || 'Not provided'}`,
        `Applicant Other Income: ${signer.otherIncome || 'Not provided'}`,
        `Applicant Bankruptcy History: ${signer.bankruptcyHistory}`,
        `Applicant Criminal History: ${signer.criminalHistory}`,
        `Applicant Consent: ${signer.consent ? 'Yes' : 'No'}`,
        `Applicant Signature: ${signer.signature || 'Not provided'}`,
        `Applicant Date Signed: ${signer.dateSigned}`,
        `Applicant Notes: ${buildSignerNotes(signer)}`,
      ]
    : [
        `Submission Type: Co-Signer`,
        `Linked Signer Application ID: ${cosigner.linkedApplicationId || 'Not provided'}`,
        `Linked Signer Full Name: ${cosigner.linkedSignerName || 'Not provided'}`,
        `Full Name: ${cosigner.fullName}`,
        `Email: ${cosigner.email}`,
        `Phone Number: ${cosigner.phone}`,
        `Date of Birth: ${cosigner.dateOfBirth}`,
        `SSN No.: ${cosigner.ssn || 'Not provided'}`,
        `Driving License No.: ${cosigner.license || 'Not provided'}`,
        `Current Address: ${cosigner.currentAddress || 'Not provided'}`,
        `City: ${cosigner.city || 'Not provided'}`,
        `State: ${cosigner.state || 'Not provided'}`,
        `ZIP: ${cosigner.zip || 'Not provided'}`,
        `Employer: ${cosigner.employer || 'Not provided'}`,
        `Employer Address: ${cosigner.employerAddress || 'Not provided'}`,
        `Supervisor Name: ${cosigner.supervisorName || 'Not provided'}`,
        `Supervisor Phone: ${cosigner.supervisorPhone || 'Not provided'}`,
        `Job Title: ${cosigner.jobTitle || 'Not provided'}`,
        `Monthly Income: ${cosigner.monthlyIncome || 'Not provided'}`,
        `Annual Income: ${cosigner.annualIncome || 'Not provided'}`,
        `Employment Start Date: ${cosigner.employmentStartDate || 'Not provided'}`,
        `Other Income: ${cosigner.otherIncome || 'Not provided'}`,
        `Bankruptcy History: ${cosigner.bankruptcyHistory}`,
        `Criminal History: ${cosigner.criminalHistory}`,
        `Consent: ${cosigner.consent ? 'Yes' : 'No'}`,
        `Signature: ${cosigner.signature || 'Not provided'}`,
        `Date Signed: ${cosigner.dateSigned}`,
        `Notes: ${buildCosignerNotes(cosigner)}`,
      ]

  const subject = type === 'signer'
    ? `Application — ${signer.fullName} for ${signer.propertyName}`
    : `Co-Signer Application — ${cosigner.fullName}`

  return `mailto:info@axis-seattle-housing.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join('\n'))}`
}

export default function Apply() {
  const [applicationType, setApplicationType] = useState('')
  const [signer, setSigner] = useState(defaultSigner())
  const [cosigner, setCosigner] = useState(defaultCosigner())
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submittedRecord, setSubmittedRecord] = useState(null)
  const [error, setError] = useState('')

  const selectedProperty = useMemo(
    () => PROPERTY_OPTIONS.find((property) => property.name === signer.propertyName),
    [signer.propertyName],
  )

  function updateSigner(key, value) {
    setSigner((prev) => {
      const next = { ...prev, [key]: value }
      if (key === 'propertyName') {
        next.roomNumber = ''
        next.propertyAddress = PROPERTY_OPTIONS.find((property) => property.name === value)?.address || ''
      }
      return next
    })
  }

  function updateCosigner(key, value) {
    setCosigner((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setSubmitting(true)
    setError('')

    try {
      if (applicationType === 'signer') {
        if (!signer.consent) {
          throw new Error('The signer must consent to the credit and background check before submitting.')
        }

        const fields = {
          // Identity
          'Applicant Full Name': signer.fullName,
          'Applicant Email': signer.email,
          'Applicant Phone Number': signer.phone,
          'Applicant Date of Birth': signer.dateOfBirth,
          'Applicant SSN No.': signer.ssn || '',
          'Applicant Driving License No.': signer.license,
          // Property
          'Property Name': signer.propertyName,
          'Property Address': signer.propertyAddress || '',
          'Room Number': signer.roomNumber || '',
          'Lease Term': signer.leaseTerm,
          'Lease Start Date': signer.leaseStartDate || null,
          'Lease End Date': signer.leaseEndDate || null,
          // Current address
          'Applicant Current Address': signer.currentAddress,
          'Applicant City': signer.currentCity,
          'Applicant State': signer.currentState,
          'Applicant ZIP': signer.currentZip,
          'Current Landlord Name': signer.currentLandlordName || '',
          'Current Landlord Phone': signer.currentLandlordPhone || '',
          'Current Move-In Date': signer.currentMoveInDate || null,
          'Current Move-Out Date': signer.currentMoveOutDate || null,
          'Current Reason for Leaving': signer.currentReasonForLeaving || '',
          // Previous address
          'Previous Address': signer.previousAddress || '',
          'Previous City': signer.previousCity || '',
          'Previous State': signer.previousState || '',
          'Previous ZIP': signer.previousZip || '',
          'Previous Landlord Name': signer.previousLandlordName || '',
          'Previous Landlord Phone': signer.previousLandlordPhone || '',
          'Previous Move-In Date': signer.previousMoveInDate || null,
          'Previous Move-Out Date': signer.previousMoveOutDate || null,
          'Previous Reason for Leaving': signer.previousReasonForLeaving || '',
          // Employment
          'Applicant Employer': signer.employer || '',
          'Applicant Employer Address': signer.employerAddress || '',
          'Applicant Supervisor Name': signer.supervisorName || '',
          'Applicant Supervisor Phone': signer.supervisorPhone || '',
          'Applicant Job Title': signer.jobTitle || '',
          'Applicant Monthly Income': toCurrencyNumber(signer.monthlyIncome),
          'Applicant Annual Income': toCurrencyNumber(signer.annualIncome),
          'Applicant Employment Start Date': signer.employmentStartDate || null,
          'Applicant Other Income': signer.otherIncome || '',
          // References
          'Reference 1 Name': signer.reference1Name || '',
          'Reference 1 Relationship': signer.reference1Relationship || '',
          'Reference 1 Phone': signer.reference1Phone || '',
          'Reference 2 Name': signer.reference2Name || '',
          'Reference 2 Relationship': signer.reference2Relationship || '',
          'Reference 2 Phone': signer.reference2Phone || '',
          // Additional info
          'Number of Occupants': signer.occupants || '',
          'Pets': signer.pets || '',
          'Vehicles': signer.vehicles || '',
          // Background
          'Eviction History': signer.evictionHistory,
          'Applicant Bankruptcy History': signer.bankruptcyHistory,
          'Applicant Criminal History': signer.criminalHistory,
          'Has Co-Signer': signer.hasCosigner,
          // Signature
          'Applicant Consent for Credit and Background Check': signer.consent,
          'Applicant Signature': signer.signature,
          'Applicant Date Signed': signer.dateSigned,
          'Additional Notes': signer.notes || '',
        }

        const record = await submitToAirtable(APPLICATIONS_TABLE, fields)
        setSubmittedRecord(record)
      } else if (applicationType === 'cosigner') {
        if (!cosigner.consent) {
          throw new Error('The co-signer must consent to the credit and background check before submitting.')
        }

        const linkedApplication = await findApplicationRecord({
          applicationId: cosigner.linkedApplicationId,
          signerName: cosigner.linkedSignerName,
        })

        const fields = {
          'Linked Application': [linkedApplication.id],
          'Role': 'Co-Signer',
          'Full Name': cosigner.fullName,
          'Email': cosigner.email,
          'Phone Number': cosigner.phone,
          'Date of Birth': cosigner.dateOfBirth,
          'SSN No.': cosigner.ssn || '',
          'Driving License No.': cosigner.license || '',
          'Current Address': cosigner.currentAddress || '',
          'City': cosigner.city || '',
          'State': cosigner.state || '',
          'ZIP': cosigner.zip || '',
          'Employer': cosigner.employer || '',
          'Employer Address': cosigner.employerAddress || '',
          'Supervisor Name': cosigner.supervisorName || '',
          'Supervisor Phone': cosigner.supervisorPhone || '',
          'Job Title': cosigner.jobTitle || '',
          'Monthly Income': toCurrencyNumber(cosigner.monthlyIncome),
          'Annual Income': toCurrencyNumber(cosigner.annualIncome),
          'Employment Start Date': cosigner.employmentStartDate || null,
          'Other Income': cosigner.otherIncome || '',
          'Bankruptcy History': cosigner.bankruptcyHistory,
          'Criminal History': cosigner.criminalHistory,
          'Consent for Credit and Background Check': cosigner.consent,
          'Signature': cosigner.signature,
          'Date Signed': cosigner.dateSigned,
          'Notes': buildCosignerNotes(cosigner),
        }

        await submitToAirtable(COSIGNERS_TABLE, fields)
      } else {
        throw new Error('Choose whether this is a signer application or a co-signer form.')
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
    const appId = submittedRecord?.fields?.['Application ID']
    const isSigner = applicationType === 'signer'
    const firstName = isSigner ? signer.fullName.split(' ')[0] : cosigner.fullName.split(' ')[0]

    return (
      <div className="min-h-screen bg-cream-50">
        <Seo title="Application Submitted | Axis Seattle Housing" pathname="/apply" />
        <div className="mx-auto max-w-lg px-4 py-24">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-teal-50">
            <svg className="h-8 w-8 text-axis" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-3xl font-black text-slate-900 text-center">Submission received</h1>
          <p className="mt-4 text-base leading-7 text-slate-500 text-center">
            {isSigner
              ? `Thanks, ${firstName}! Your signer application was submitted to Axis.`
              : `Thanks, ${firstName}! Your co-signer form was linked to the signer application.`}
          </p>

          {isSigner && appId && (
            <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Your Application ID</div>
              <div className="mt-2 flex items-center gap-3">
                <span className="text-4xl font-black text-slate-900 tracking-tight">#{appId}</span>
              </div>
              {signer.hasCosigner === 'Yes' && (
                <p className="mt-3 text-sm leading-6 text-slate-600">
                  Share this ID with your co-signer. They'll enter it when filling out the co-signer form at <strong>/apply</strong> to link their submission to yours.
                </p>
              )}
            </div>
          )}

          <a href="/" className="mt-8 inline-block w-full rounded-full bg-slate-900 px-6 py-3 text-center text-sm font-semibold text-white hover:bg-slate-800">
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
        description="Submit a signer or co-signer rental application for Axis Seattle Housing."
        pathname="/apply"
      />

      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="mb-8">
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">Axis applications</div>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">Residential Rental Application</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Start by choosing whether you are the signer or the co-signer. These are now two separate submission flows.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <Section title="Who Are You Filing As?">
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setApplicationType('signer')}
                className={`rounded-full px-5 py-2.5 text-sm font-semibold transition ${applicationType === 'signer' ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700'}`}
              >
                Signer
              </button>
              <button
                type="button"
                onClick={() => setApplicationType('cosigner')}
                className={`rounded-full px-5 py-2.5 text-sm font-semibold transition ${applicationType === 'cosigner' ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700'}`}
              >
                Co-Signer
              </button>
            </div>
          </Section>

          {applicationType === 'signer' && (
            <>
              <Section title="Co-Signer">
                <p className="text-sm leading-6 text-slate-500">Will someone be co-signing this application with you?</p>
                <div className="flex gap-3">
                  {['Yes', 'No'].map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => updateSigner('hasCosigner', opt)}
                      className={`rounded-full px-6 py-2.5 text-sm font-semibold transition ${signer.hasCosigner === opt ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700 hover:border-slate-400'}`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
                {signer.hasCosigner === 'Yes' && (
                  <div className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-800">
                    After you submit, you'll receive an <strong>Application ID</strong>. Share it with your co-signer — they'll need it to link their form to yours.
                  </div>
                )}
              </Section>

              <Section title="Property Information">
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Property Name" required>
                    <select required className={selectCls} value={signer.propertyName} onChange={(e) => updateSigner('propertyName', e.target.value)}>
                      <option value="" disabled>Select a property…</option>
                      {PROPERTY_OPTIONS.map((property) => (
                        <option key={property.id} value={property.name}>{property.name}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Property Address Applying For">
                    <input className={inputCls} value={signer.propertyAddress} onChange={(e) => updateSigner('propertyAddress', e.target.value)} />
                  </Field>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Room Number">
                    <select className={selectCls} value={signer.roomNumber} onChange={(e) => updateSigner('roomNumber', e.target.value)} disabled={!selectedProperty}>
                      <option value="">{selectedProperty ? 'Select a room…' : 'Choose a property first'}</option>
                      {(selectedProperty?.rooms || []).map((room) => (
                        <option key={room} value={room}>{room}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Lease Term" required>
                    <select required className={selectCls} value={signer.leaseTerm} onChange={(e) => updateSigner('leaseTerm', e.target.value)}>
                      {LEASE_TERMS.map((term) => (
                        <option key={term} value={term}>{term}</option>
                      ))}
                    </select>
                  </Field>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Lease Start Date" required>
                    <input required type="date" className={inputCls} value={signer.leaseStartDate} onChange={(e) => updateSigner('leaseStartDate', e.target.value)} />
                  </Field>
                  <Field label="Lease End Date" required>
                    <input required type="date" className={inputCls} value={signer.leaseEndDate} onChange={(e) => updateSigner('leaseEndDate', e.target.value)} />
                  </Field>
                </div>
              </Section>

              <Section title="Applicant Information">
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Full Name" required>
                    <input required className={inputCls} value={signer.fullName} onChange={(e) => updateSigner('fullName', e.target.value)} />
                  </Field>
                  <Field label="Date of Birth" required>
                    <input required type="date" className={inputCls} value={signer.dateOfBirth} onChange={(e) => updateSigner('dateOfBirth', e.target.value)} />
                  </Field>
                </div>

                <div className="grid gap-5 sm:grid-cols-3">
                  <Field label="Social Security #" >
                    <input className={inputCls} value={signer.ssn} onChange={(e) => updateSigner('ssn', e.target.value)} />
                  </Field>
                  <Field label="Driver's License / ID #" required>
                    <input required className={inputCls} value={signer.license} onChange={(e) => updateSigner('license', e.target.value)} />
                  </Field>
                  <Field label="Phone Number" required>
                    <input required type="tel" className={inputCls} value={signer.phone} onChange={(e) => updateSigner('phone', e.target.value)} />
                  </Field>
                </div>

                <Field label="Email" required>
                  <input required type="email" className={inputCls} value={signer.email} onChange={(e) => updateSigner('email', e.target.value)} />
                </Field>
              </Section>

              <Section title="Current Address">
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Address" required>
                    <input required className={inputCls} value={signer.currentAddress} onChange={(e) => updateSigner('currentAddress', e.target.value)} />
                  </Field>
                  <Field label="City / State / ZIP" required>
                    <div className="grid grid-cols-3 gap-3">
                      <input required className={inputCls} placeholder="City" value={signer.currentCity} onChange={(e) => updateSigner('currentCity', e.target.value)} />
                      <input required className={inputCls} placeholder="State" value={signer.currentState} onChange={(e) => updateSigner('currentState', e.target.value)} />
                      <input required className={inputCls} placeholder="ZIP" value={signer.currentZip} onChange={(e) => updateSigner('currentZip', e.target.value)} />
                    </div>
                  </Field>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Landlord / Property Manager Name">
                    <input className={inputCls} value={signer.currentLandlordName} onChange={(e) => updateSigner('currentLandlordName', e.target.value)} />
                  </Field>
                  <Field label="Landlord Phone #">
                    <input type="tel" className={inputCls} value={signer.currentLandlordPhone} onChange={(e) => updateSigner('currentLandlordPhone', e.target.value)} />
                  </Field>
                </div>

                <div className="grid gap-5 sm:grid-cols-3">
                  <Field label="Move-in Date">
                    <input type="date" className={inputCls} value={signer.currentMoveInDate} onChange={(e) => updateSigner('currentMoveInDate', e.target.value)} />
                  </Field>
                  <Field label="Move-out Date">
                    <input type="date" className={inputCls} value={signer.currentMoveOutDate} onChange={(e) => updateSigner('currentMoveOutDate', e.target.value)} />
                  </Field>
                  <Field label="Reason for Leaving">
                    <input className={inputCls} value={signer.currentReasonForLeaving} onChange={(e) => updateSigner('currentReasonForLeaving', e.target.value)} />
                  </Field>
                </div>
              </Section>

              <Section title="Previous Address">
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Address">
                    <input className={inputCls} value={signer.previousAddress} onChange={(e) => updateSigner('previousAddress', e.target.value)} />
                  </Field>
                  <Field label="City / State / ZIP">
                    <div className="grid grid-cols-3 gap-3">
                      <input className={inputCls} placeholder="City" value={signer.previousCity} onChange={(e) => updateSigner('previousCity', e.target.value)} />
                      <input className={inputCls} placeholder="State" value={signer.previousState} onChange={(e) => updateSigner('previousState', e.target.value)} />
                      <input className={inputCls} placeholder="ZIP" value={signer.previousZip} onChange={(e) => updateSigner('previousZip', e.target.value)} />
                    </div>
                  </Field>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Landlord / Property Manager Name">
                    <input className={inputCls} value={signer.previousLandlordName} onChange={(e) => updateSigner('previousLandlordName', e.target.value)} />
                  </Field>
                  <Field label="Landlord Phone #">
                    <input type="tel" className={inputCls} value={signer.previousLandlordPhone} onChange={(e) => updateSigner('previousLandlordPhone', e.target.value)} />
                  </Field>
                </div>

                <div className="grid gap-5 sm:grid-cols-3">
                  <Field label="Move-in Date">
                    <input type="date" className={inputCls} value={signer.previousMoveInDate} onChange={(e) => updateSigner('previousMoveInDate', e.target.value)} />
                  </Field>
                  <Field label="Move-out Date">
                    <input type="date" className={inputCls} value={signer.previousMoveOutDate} onChange={(e) => updateSigner('previousMoveOutDate', e.target.value)} />
                  </Field>
                  <Field label="Reason for Leaving">
                    <input className={inputCls} value={signer.previousReasonForLeaving} onChange={(e) => updateSigner('previousReasonForLeaving', e.target.value)} />
                  </Field>
                </div>
              </Section>

              <Section title="Employment & Income">
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Employer Name">
                    <input className={inputCls} value={signer.employer} onChange={(e) => updateSigner('employer', e.target.value)} />
                  </Field>
                  <Field label="Employer Address">
                    <input className={inputCls} value={signer.employerAddress} onChange={(e) => updateSigner('employerAddress', e.target.value)} />
                  </Field>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Supervisor Name">
                    <input className={inputCls} value={signer.supervisorName} onChange={(e) => updateSigner('supervisorName', e.target.value)} />
                  </Field>
                  <Field label="Supervisor Phone #">
                    <input type="tel" className={inputCls} value={signer.supervisorPhone} onChange={(e) => updateSigner('supervisorPhone', e.target.value)} />
                  </Field>
                </div>

                <div className="grid gap-5 sm:grid-cols-4">
                  <Field label="Job Title">
                    <input className={inputCls} value={signer.jobTitle} onChange={(e) => updateSigner('jobTitle', e.target.value)} />
                  </Field>
                  <Field label="Monthly Income">
                    <input className={inputCls} value={signer.monthlyIncome} onChange={(e) => updateSigner('monthlyIncome', e.target.value)} />
                  </Field>
                  <Field label="Annual Income">
                    <input className={inputCls} value={signer.annualIncome} onChange={(e) => updateSigner('annualIncome', e.target.value)} />
                  </Field>
                  <Field label="Start Date">
                    <input type="date" className={inputCls} value={signer.employmentStartDate} onChange={(e) => updateSigner('employmentStartDate', e.target.value)} />
                  </Field>
                </div>

                <Field label="Other Income">
                  <input className={inputCls} value={signer.otherIncome} onChange={(e) => updateSigner('otherIncome', e.target.value)} />
                </Field>
              </Section>

              <Section title="References">
                <div className="grid gap-5 sm:grid-cols-3">
                  <Field label="Name 1">
                    <input className={inputCls} value={signer.reference1Name} onChange={(e) => updateSigner('reference1Name', e.target.value)} />
                  </Field>
                  <Field label="Relationship 1">
                    <input className={inputCls} value={signer.reference1Relationship} onChange={(e) => updateSigner('reference1Relationship', e.target.value)} />
                  </Field>
                  <Field label="Phone # 1">
                    <input type="tel" className={inputCls} value={signer.reference1Phone} onChange={(e) => updateSigner('reference1Phone', e.target.value)} />
                  </Field>
                </div>
                <div className="grid gap-5 sm:grid-cols-3">
                  <Field label="Name 2">
                    <input className={inputCls} value={signer.reference2Name} onChange={(e) => updateSigner('reference2Name', e.target.value)} />
                  </Field>
                  <Field label="Relationship 2">
                    <input className={inputCls} value={signer.reference2Relationship} onChange={(e) => updateSigner('reference2Relationship', e.target.value)} />
                  </Field>
                  <Field label="Phone # 2">
                    <input type="tel" className={inputCls} value={signer.reference2Phone} onChange={(e) => updateSigner('reference2Phone', e.target.value)} />
                  </Field>
                </div>
              </Section>

              <Section title="Additional Information">
                <div className="grid gap-5 sm:grid-cols-3">
                  <Field label="Number of Occupants">
                    <input className={inputCls} value={signer.occupants} onChange={(e) => updateSigner('occupants', e.target.value)} />
                  </Field>
                  <Field label="Pets">
                    <input className={inputCls} value={signer.pets} onChange={(e) => updateSigner('pets', e.target.value)} />
                  </Field>
                  <Field label="Vehicle(s)">
                    <input className={inputCls} value={signer.vehicles} onChange={(e) => updateSigner('vehicles', e.target.value)} />
                  </Field>
                </div>
              </Section>

              <Section title="Financial Background / Legal">
                <div className="grid gap-5 sm:grid-cols-3">
                  <Field label="Eviction History" required>
                    <select required className={selectCls} value={signer.evictionHistory} onChange={(e) => updateSigner('evictionHistory', e.target.value)}>
                      <option value="" disabled>Select…</option>
                      {HISTORY_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </Field>
                  <Field label="Bankruptcy History" required>
                    <select required className={selectCls} value={signer.bankruptcyHistory} onChange={(e) => updateSigner('bankruptcyHistory', e.target.value)}>
                      <option value="" disabled>Select…</option>
                      {HISTORY_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </Field>
                  <Field label="Criminal Convictions" required>
                    <select required className={selectCls} value={signer.criminalHistory} onChange={(e) => updateSigner('criminalHistory', e.target.value)}>
                      <option value="" disabled>Select…</option>
                      {HISTORY_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </Field>
                </div>

                <Field label="Consent for Credit and Background Check" required>
                  <label className="flex min-h-[52px] items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-700">
                    <input type="checkbox" checked={signer.consent} onChange={(e) => updateSigner('consent', e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-axis focus:ring-axis" />
                    I consent to a credit and background check.
                  </label>
                </Field>
              </Section>

              <Section title="Signature">
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Applicant Signature" required>
                    <input required className={inputCls} value={signer.signature} onChange={(e) => updateSigner('signature', e.target.value)} />
                  </Field>
                  <Field label="Date Signed" required>
                    <input required type="date" className={inputCls} value={signer.dateSigned} onChange={(e) => updateSigner('dateSigned', e.target.value)} />
                  </Field>
                </div>
                <Field label="Additional Notes">
                  <textarea className={`${inputCls} min-h-[96px] resize-y`} value={signer.notes} onChange={(e) => updateSigner('notes', e.target.value)} />
                </Field>
              </Section>
            </>
          )}

          {applicationType === 'cosigner' && (
            <>
              <Section title="Link This Co-Signer To A Signer Application">
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Signer Application ID" hint="Recommended. Use the Airtable Application ID if you have it.">
                    <input className={inputCls} value={cosigner.linkedApplicationId} onChange={(e) => updateCosigner('linkedApplicationId', e.target.value)} />
                  </Field>
                  <Field label="Signer Full Name" hint="Use this if you don’t have the application ID.">
                    <input className={inputCls} value={cosigner.linkedSignerName} onChange={(e) => updateCosigner('linkedSignerName', e.target.value)} />
                  </Field>
                </div>
              </Section>

              <Section title="Co-Signer Information">
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Full Name" required>
                    <input required className={inputCls} value={cosigner.fullName} onChange={(e) => updateCosigner('fullName', e.target.value)} />
                  </Field>
                  <Field label="Email" required>
                    <input required type="email" className={inputCls} value={cosigner.email} onChange={(e) => updateCosigner('email', e.target.value)} />
                  </Field>
                </div>

                <div className="grid gap-5 sm:grid-cols-3">
                  <Field label="Phone Number" required>
                    <input required type="tel" className={inputCls} value={cosigner.phone} onChange={(e) => updateCosigner('phone', e.target.value)} />
                  </Field>
                  <Field label="Date of Birth" required>
                    <input required type="date" className={inputCls} value={cosigner.dateOfBirth} onChange={(e) => updateCosigner('dateOfBirth', e.target.value)} />
                  </Field>
                  <Field label="Driver's License / ID #" required>
                    <input required className={inputCls} value={cosigner.license} onChange={(e) => updateCosigner('license', e.target.value)} />
                  </Field>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Social Security #">
                    <input className={inputCls} value={cosigner.ssn} onChange={(e) => updateCosigner('ssn', e.target.value)} />
                  </Field>
                  <Field label="Current Address" required>
                    <input required className={inputCls} value={cosigner.currentAddress} onChange={(e) => updateCosigner('currentAddress', e.target.value)} />
                  </Field>
                </div>

                <div className="grid gap-5 sm:grid-cols-3">
                  <Field label="City" required>
                    <input required className={inputCls} value={cosigner.city} onChange={(e) => updateCosigner('city', e.target.value)} />
                  </Field>
                  <Field label="State" required>
                    <input required className={inputCls} value={cosigner.state} onChange={(e) => updateCosigner('state', e.target.value)} />
                  </Field>
                  <Field label="ZIP" required>
                    <input required className={inputCls} value={cosigner.zip} onChange={(e) => updateCosigner('zip', e.target.value)} />
                  </Field>
                </div>
              </Section>

              <Section title="Employment & Income">
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Employer Name">
                    <input className={inputCls} value={cosigner.employer} onChange={(e) => updateCosigner('employer', e.target.value)} />
                  </Field>
                  <Field label="Employer Address">
                    <input className={inputCls} value={cosigner.employerAddress} onChange={(e) => updateCosigner('employerAddress', e.target.value)} />
                  </Field>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Supervisor Name">
                    <input className={inputCls} value={cosigner.supervisorName} onChange={(e) => updateCosigner('supervisorName', e.target.value)} />
                  </Field>
                  <Field label="Supervisor Phone #">
                    <input type="tel" className={inputCls} value={cosigner.supervisorPhone} onChange={(e) => updateCosigner('supervisorPhone', e.target.value)} />
                  </Field>
                </div>

                <div className="grid gap-5 sm:grid-cols-4">
                  <Field label="Job Title">
                    <input className={inputCls} value={cosigner.jobTitle} onChange={(e) => updateCosigner('jobTitle', e.target.value)} />
                  </Field>
                  <Field label="Monthly Income">
                    <input className={inputCls} value={cosigner.monthlyIncome} onChange={(e) => updateCosigner('monthlyIncome', e.target.value)} />
                  </Field>
                  <Field label="Annual Income">
                    <input className={inputCls} value={cosigner.annualIncome} onChange={(e) => updateCosigner('annualIncome', e.target.value)} />
                  </Field>
                  <Field label="Start Date">
                    <input type="date" className={inputCls} value={cosigner.employmentStartDate} onChange={(e) => updateCosigner('employmentStartDate', e.target.value)} />
                  </Field>
                </div>

                <Field label="Other Income">
                  <input className={inputCls} value={cosigner.otherIncome} onChange={(e) => updateCosigner('otherIncome', e.target.value)} />
                </Field>
              </Section>

              <Section title="Financial Background / Legal">
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Bankruptcy History" required>
                    <select required className={selectCls} value={cosigner.bankruptcyHistory} onChange={(e) => updateCosigner('bankruptcyHistory', e.target.value)}>
                      <option value="" disabled>Select…</option>
                      {HISTORY_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </Field>
                  <Field label="Criminal Convictions" required>
                    <select required className={selectCls} value={cosigner.criminalHistory} onChange={(e) => updateCosigner('criminalHistory', e.target.value)}>
                      <option value="" disabled>Select…</option>
                      {HISTORY_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </Field>
                </div>

                <Field label="Consent for Credit and Background Check" required>
                  <label className="flex min-h-[52px] items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-700">
                    <input type="checkbox" checked={cosigner.consent} onChange={(e) => updateCosigner('consent', e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-axis focus:ring-axis" />
                    I consent to a credit and background check.
                  </label>
                </Field>
              </Section>

              <Section title="Signature">
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Co-Signer Signature" required>
                    <input required className={inputCls} value={cosigner.signature} onChange={(e) => updateCosigner('signature', e.target.value)} />
                  </Field>
                  <Field label="Date Signed" required>
                    <input required type="date" className={inputCls} value={cosigner.dateSigned} onChange={(e) => updateCosigner('dateSigned', e.target.value)} />
                  </Field>
                </div>
                <Field label="Additional Notes">
                  <textarea className={`${inputCls} min-h-[96px] resize-y`} value={cosigner.notes} onChange={(e) => updateCosigner('notes', e.target.value)} />
                </Field>
              </Section>
            </>
          )}

          {error && (
            <div className="space-y-3 rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
              <p className="font-semibold">Submission failed — Airtable didn&apos;t accept the application.</p>
              <p className="break-all font-mono text-xs text-red-600">{error}</p>
              <a
                href={buildMailtoFallback(applicationType, signer, cosigner)}
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
            {submitting ? 'Submitting…' : applicationType === 'cosigner' ? 'Submit co-signer form' : 'Submit signer application'}
          </button>
        </form>
      </div>
    </div>
  )
}

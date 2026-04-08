import { useMemo, useRef, useState } from 'react'
import { Seo } from '../lib/seo'
import { properties } from '../data/properties'

const AIRTABLE_BASE_ID = import.meta.env.VITE_AIRTABLE_BASE_ID || 'appNBX2inqfJMyqYV'
const APPLICATIONS_TABLE = import.meta.env.VITE_AIRTABLE_APPLICATIONS_TABLE || 'Applications'
const COSIGNERS_TABLE = import.meta.env.VITE_AIRTABLE_COAPPLICANTS_TABLE || 'Co-Signers'
const AIRTABLE_TOKEN = import.meta.env.VITE_AIRTABLE_TOKEN

const HISTORY_OPTIONS = ['No', 'Yes']
const LEASE_TERMS = [
  '3-Month',
  '9-Month',
  '12-Month',
  'Custom',
]

// ---------------------------------------------------------------------------
// Availability parsing
// Parses "available" strings from properties.js into structured date windows.
// Supported formats (case-insensitive):
//   "Available now"
//   "Available after Month D, YYYY"
//   "Unavailable"
//   "Available Month D, YYYY-Month D, YYYY and after Month D, YYYY"
// ---------------------------------------------------------------------------
function parseAvailability(availableStr) {
  const s = String(availableStr || '').trim().toLowerCase()
  if (!s || s === 'unavailable') return { windows: [], unavailable: true }
  if (s === 'available now') return { windows: [{ from: new Date(0), to: null }], unavailable: false }

  const windows = []

  // "available after Month D, YYYY" — open-ended from that date
  const afterRe = /available after ([a-z]+ \d+,\s*\d{4})/gi
  let m
  while ((m = afterRe.exec(s)) !== null) {
    const d = new Date(m[1])
    if (!Number.isNaN(d.getTime())) windows.push({ from: d, to: null })
  }

  // "available Month D, YYYY-Month D, YYYY" — fixed window
  const rangeRe = /available ([a-z]+ \d+,\s*\d{4})-([a-z]+ \d+,\s*\d{4})/gi
  while ((m = rangeRe.exec(s)) !== null) {
    const from = new Date(m[1])
    const to = new Date(m[2])
    if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime())) windows.push({ from, to })
  }

  return { windows, unavailable: windows.length === 0 }
}

// Returns true if the room is available for the given lease start date
function isRoomAvailableOnDate(availableStr, leaseStartDate) {
  if (!leaseStartDate) return true // no date chosen yet — don't block
  const { windows, unavailable } = parseAvailability(availableStr)
  if (unavailable) return false
  const start = new Date(leaseStartDate)
  return windows.some(({ from, to }) => {
    const afterFrom = start >= from
    const beforeTo = to === null || start <= to
    return afterFrom && beforeTo
  })
}

function getRoomAvailabilityLabel(availableStr) {
  const s = String(availableStr || '').trim()
  if (!s || s.toLowerCase() === 'unavailable') return 'Unavailable'
  return s
}

// Build PROPERTY_OPTIONS with full room availability data
const PROPERTY_OPTIONS = properties
  .map((property) => {
    const allRooms = (property.roomPlans || []).flatMap((plan) => plan.rooms || [])
    const uniqueRooms = []
    const seen = new Set()
    for (const room of allRooms) {
      if (!seen.has(room.name)) {
        seen.add(room.name)
        uniqueRooms.push({ name: room.name, available: room.available || 'Available now' })
      }
    }
    uniqueRooms.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    return {
      id: property.slug,
      name: property.name,
      address: property.address,
      rooms: uniqueRooms,
    }
  })
  .sort((a, b) => a.name.localeCompare(b.name))

// ---------------------------------------------------------------------------
// Field validators — each returns an error string or '' if valid
// ---------------------------------------------------------------------------
function validatePhone(value) {
  if (!value) return ''
  const digits = value.replace(/\D/g, '')
  if (digits.length !== 10 && digits.length !== 11) return 'Phone must be 10 digits (or 11 with country code)'
  return ''
}

function validateSSN(value) {
  if (!value) return ''
  const digits = value.replace(/\D/g, '')
  if (digits.length !== 9) return 'SSN must be exactly 9 digits (###-##-####)'
  // Basic SSN sanity: area 001-899 (not 000, not 666, not 900+), group not 00, serial not 0000
  const area = parseInt(digits.slice(0, 3), 10)
  const group = parseInt(digits.slice(3, 5), 10)
  const serial = parseInt(digits.slice(5, 9), 10)
  if (area === 0 || area === 666 || area >= 900) return 'SSN area number is invalid'
  if (group === 0) return 'SSN group number cannot be 00'
  if (serial === 0) return 'SSN serial number cannot be 0000'
  return ''
}

// WA Driver's License: 1 letter followed by exactly 10 digits (11 chars total)
function validateDriversLicense(value) {
  if (!value) return ''
  const clean = value.replace(/[\s-]/g, '').toUpperCase()
  if (!/^[A-Z]\d{10}$/.test(clean)) return "Driver's license must be 1 letter followed by 10 digits (e.g. W1234567890)"
  return ''
}

const EMAIL_TYPOS = {
  'gamil.com': 'gmail.com', 'gnail.com': 'gmail.com', 'gmal.com': 'gmail.com',
  'gmial.com': 'gmail.com', 'gmaill.com': 'gmail.com', 'gmail.con': 'gmail.com',
  'gmail.co': 'gmail.com', 'gmali.com': 'gmail.com',
  'yaho.com': 'yahoo.com', 'yahooo.com': 'yahoo.com', 'yahoo.con': 'yahoo.com',
  'yhoo.com': 'yahoo.com', 'yaoo.com': 'yahoo.com',
  'hotmal.com': 'hotmail.com', 'hotmial.com': 'hotmail.com', 'hotmail.con': 'hotmail.com',
  'hotmil.com': 'hotmail.com', 'homail.com': 'hotmail.com',
  'outlok.com': 'outlook.com', 'outloo.com': 'outlook.com', 'outlook.con': 'outlook.com',
  'iclod.com': 'icloud.com', 'icoud.com': 'icloud.com', 'icloud.con': 'icloud.com',
  'aol.con': 'aol.com', 'msn.con': 'msn.com',
}

function validateEmail(value) {
  if (!value) return ''
  const trimmed = value.trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed)) return 'Enter a valid email address (e.g. name@gmail.com)'
  const domain = trimmed.split('@')[1]?.toLowerCase()
  if (EMAIL_TYPOS[domain]) {
    const local = trimmed.split('@')[0]
    return `Did you mean ${local}@${EMAIL_TYPOS[domain]}?`
  }
  // Reject obviously fake TLDs > 10 chars or single char
  const tld = domain?.split('.').pop()
  if (tld && (tld.length < 2 || tld.length > 10)) return 'Enter a valid email address'
  return ''
}

function validateZip(value) {
  if (!value) return ''
  if (!/^\d{5}(-\d{4})?$/.test(value.trim())) return 'ZIP must be 5 digits (or 5+4 format)'
  return ''
}

function validateStreetAddress(value) {
  if (!value) return 'Street address is required'
  const v = value.trim()
  // Must start with a number (house number), followed by a street name
  if (!/^\d+\s+\S/.test(v)) return 'Enter a valid street address starting with a number (e.g. 123 Main St)'
  // Must be at least 6 chars and contain letters after the number
  if (v.length < 6 || !/\d+\s+[a-zA-Z]/.test(v)) return 'Enter a full street address (e.g. 4521 University Way NE)'
  return ''
}

function calculateAge(value) {
  const dob = new Date(value)
  const today = new Date()
  return today.getFullYear() - dob.getFullYear() - (today < new Date(today.getFullYear(), dob.getMonth(), dob.getDate()) ? 1 : 0)
}

function validateDOB(value, { requireAdult = true } = {}) {
  if (!value) return 'Date of birth is required'
  const dob = new Date(value)
  if (Number.isNaN(dob.getTime())) return 'Enter a valid date'
  const age = calculateAge(value)
  if (requireAdult && age < 18) return 'Applicant must be at least 18 years old'
  if (age > 120) return 'Enter a valid date of birth'
  return ''
}

function validateFullName(value) {
  if (!value) return ''
  const trimmed = value.trim()
  if (trimmed.length < 2) return 'Enter your full legal name'
  if (!/^[a-zA-ZÀ-ÿ\s'\-\.]+$/.test(trimmed)) return 'Name may only contain letters, spaces, hyphens, and apostrophes'
  const parts = trimmed.split(/\s+/)
  if (parts.length < 2) return 'Enter both first and last name'
  return ''
}

function validateIncome(value) {
  if (!value) return ''
  const n = Number(String(value).replace(/[^0-9.-]/g, ''))
  if (!Number.isFinite(n) || n < 0) return 'Enter a valid income amount'
  return ''
}

function validateState(value) {
  if (!value) return ''
  const abbrevs = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC']
  if (!abbrevs.includes(value.trim().toUpperCase())) return 'Enter a valid 2-letter US state abbreviation'
  return ''
}

// Run all signer-form validations, returns { fieldKey: errorMessage } object
function validateSignerForm(signer) {
  const errors = {}
  const add = (key, msg) => { if (msg && !errors[key]) errors[key] = msg }

  add('fullName', validateFullName(signer.fullName))
  add('dateOfBirth', validateDOB(signer.dateOfBirth))
  if (signer.ssn) add('ssn', validateSSN(signer.ssn))
  if (signer.license) add('license', validateDriversLicense(signer.license))
  add('phone', validatePhone(signer.phone))
  if (!signer.hasCosigner) add('hasCosigner', 'Please select Yes or No')
  if (!signer.reference1Name?.trim()) add('reference1Name', 'At least one reference name is required')
  if (!signer.reference1Phone?.trim()) {
    add('reference1Phone', 'At least one reference phone number is required')
  } else {
    add('reference1Phone', validatePhone(signer.reference1Phone))
  }
  if (signer.currentLandlordPhone) add('currentLandlordPhone', validatePhone(signer.currentLandlordPhone))
  if (signer.previousLandlordPhone) add('previousLandlordPhone', validatePhone(signer.previousLandlordPhone))
  if (signer.supervisorPhone) add('supervisorPhone', validatePhone(signer.supervisorPhone))
  if (signer.reference2Phone) add('reference2Phone', validatePhone(signer.reference2Phone))
  add('email', validateEmail(signer.email))
  if (signer.currentZip) add('currentZip', validateZip(signer.currentZip))
  if (signer.previousZip) add('previousZip', validateZip(signer.previousZip))
  if (signer.currentState) add('currentState', validateState(signer.currentState))
  if (signer.previousState) add('previousState', validateState(signer.previousState))
  if (signer.monthlyIncome) add('monthlyIncome', validateIncome(signer.monthlyIncome))
  if (signer.annualIncome) add('annualIncome', validateIncome(signer.annualIncome))

  if (signer.leaseStartDate && signer.leaseEndDate) {
    if (new Date(signer.leaseEndDate) <= new Date(signer.leaseStartDate)) {
      add('leaseEndDate', 'Lease End Date must be after Lease Start Date')
    }
  }
  if (signer.leaseStartDate) {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    if (new Date(signer.leaseStartDate) < today) add('leaseStartDate', 'Lease Start Date cannot be in the past')
  }
  if (signer.propertyName && signer.roomNumber && signer.leaseStartDate) {
    const prop = PROPERTY_OPTIONS.find((p) => p.name === signer.propertyName)
    const roomData = prop?.rooms.find((r) => r.name === signer.roomNumber)
    if (roomData && !isRoomAvailableOnDate(roomData.available, signer.leaseStartDate)) {
      const label = getRoomAvailabilityLabel(roomData.available)
      add('leaseStartDate', `Room ${signer.roomNumber} is not available on this date. ${label}`)
    }
  }

  return errors
}

function validateCosignerForm(cosigner) {
  const errors = {}
  const add = (key, msg) => { if (msg && !errors[key]) errors[key] = msg }

  add('fullName', validateFullName(cosigner.fullName))
  add('dateOfBirth', validateDOB(cosigner.dateOfBirth))
  if (cosigner.ssn) add('ssn', validateSSN(cosigner.ssn))
  if (cosigner.license) add('license', validateDriversLicense(cosigner.license))
  add('phone', validatePhone(cosigner.phone))
  add('email', validateEmail(cosigner.email))
  if (cosigner.zip) add('zip', validateZip(cosigner.zip))
  if (cosigner.state) add('state', validateState(cosigner.state))
  if (cosigner.supervisorPhone) add('supervisorPhone', validatePhone(cosigner.supervisorPhone))
  if (cosigner.monthlyIncome) add('monthlyIncome', validateIncome(cosigner.monthlyIncome))
  if (cosigner.annualIncome) add('annualIncome', validateIncome(cosigner.annualIncome))

  return errors
}

// ---------------------------------------------------------------------------
// Auto-formatting helpers
// ---------------------------------------------------------------------------
function formatPhoneInput(raw) {
  const digits = raw.replace(/\D/g, '').slice(0, 10)
  if (digits.length < 4) return digits
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

function formatSSNInput(raw) {
  const digits = raw.replace(/\D/g, '').slice(0, 9)
  if (digits.length < 4) return digits
  if (digits.length < 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`
}

// ---------------------------------------------------------------------------
// Address autocomplete component (Nominatim / OpenStreetMap)
// ---------------------------------------------------------------------------
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
    onSelect?.({ city, state, zip })
    setSuggestions([])
    setOpen(false)
  }

  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={handleChange}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 180)}
        placeholder={placeholder}
        required={required}
        autoComplete="street-address"
        className={className}
      />
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

const inputCls = 'w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-axis focus:ring-2 focus:ring-axis/20'
const selectCls = `${inputCls} appearance-none cursor-pointer`

const MAX_DATE = '2035-12-31'
const MIN_DOB = '1900-01-01'

function clampYear(dateStr) {
  if (!dateStr) return dateStr
  const [y, m, d] = dateStr.split('-')
  if (!y || y.length <= 4) return dateStr
  return `${y.slice(0, 4)}-${m}-${d}`
}

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
    skipPreviousAddress: false,
    noEmployment: false,
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
    noEmployment: false,
    bankruptcyHistory: '',
    criminalHistory: '',
    consent: false,
    signature: '',
    dateSigned: todayIsoDate(),
    notes: '',
  }
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 active:scale-95"
    >
      {copied ? (
        <>
          <svg className="h-3.5 w-3.5 text-teal-500" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l3 3 7-7"/></svg>
          Copied
        </>
      ) : (
        <>
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={1.8}><rect x="5" y="5" width="8" height="8" rx="1.5" strokeLinejoin="round"/><path d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5" strokeLinejoin="round"/></svg>
          Copy
        </>
      )}
    </button>
  )
}

function Field({ label, required, hint, error, children }) {
  return (
    <div {...(error ? { 'data-field-error': '1' } : {})}>
      <label className="mb-1.5 block text-sm font-semibold text-slate-800">
        {label}
        {required && <span className="ml-1 text-axis">*</span>}
      </label>
      {hint && <p className="mb-1.5 text-xs text-slate-400">{hint}</p>}
      <div className={error ? 'rounded-xl ring-2 ring-red-400' : ''}>
        {children}
      </div>
      {error && (
        <p className="mt-1.5 flex items-center gap-1 text-xs font-semibold text-red-600">
          <svg className="h-3 w-3 shrink-0" fill="currentColor" viewBox="0 0 16 16"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm-.75 4a.75.75 0 011.5 0v3.5a.75.75 0 01-1.5 0V5zm.75 7a1 1 0 110-2 1 1 0 010 2z"/></svg>
          {error}
        </p>
      )}
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

async function checkDuplicateApplication(email) {
  if (!AIRTABLE_TOKEN || !email) return false
  const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(APPLICATIONS_TABLE)}`)
  url.searchParams.set('maxRecords', '1')
  url.searchParams.set('filterByFormula', `{Signer Email} = '${email.replace(/'/g, "\\'")}'`)
  try {
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } })
    if (!res.ok) return false
    const data = await res.json()
    return (data.records?.length ?? 0) > 0
  } catch {
    return false
  }
}

async function findApplicationRecord({ applicationId, signerName }) {
  if (!AIRTABLE_TOKEN) throw new Error('VITE_AIRTABLE_TOKEN is not set in environment variables.')

  let filterByFormula = ''
  const numericId = Number(applicationId)

  // Support rec... record IDs and APP-rec... formula IDs in addition to numeric auto-numbers
  const rawId = String(applicationId || '')
  const recordId = rawId.startsWith('APP-') ? rawId.slice(4) : rawId
  const isRecordId = recordId.startsWith('rec') && recordId.length > 10

  if (isRecordId) {
    const response = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(APPLICATIONS_TABLE)}/${recordId}`,
      { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } },
    )
    if (!response.ok) {
      const body = await response.text()
      let message = `Airtable lookup error ${response.status}`
      try { message += `: ${JSON.parse(body)?.error?.message}` } catch { message += `: ${body}` }
      throw new Error(message)
    }
    return response.json()
  }

  if (applicationId && Number.isFinite(numericId)) {
    filterByFormula = `{Application ID} = ${numericId}`
  } else if (signerName) {
    filterByFormula = `{Signer Full Name} = '${escapeFormulaString(signerName)}'`
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
        `Signer Full Name: ${signer.fullName}`,
        `Signer Date of Birth: ${signer.dateOfBirth}`,
        `Signer SSN No.: ${signer.ssn || 'Not provided'}`,
        `Signer Driving License No.: ${signer.license}`,
        `Signer Phone Number: ${signer.phone}`,
        `Signer Email: ${signer.email}`,
        `Signer Current Address: ${signer.currentAddress}`,
        `Signer City: ${signer.currentCity}`,
        `Signer State: ${signer.currentState}`,
        `Signer ZIP: ${signer.currentZip}`,
        `Signer Employer: ${signer.employer || 'Not provided'}`,
        `Signer Employer Address: ${signer.employerAddress || 'Not provided'}`,
        `Signer Supervisor Name: ${signer.supervisorName || 'Not provided'}`,
        `Signer Supervisor Phone: ${signer.supervisorPhone || 'Not provided'}`,
        `Signer Job Title: ${signer.jobTitle || 'Not provided'}`,
        `Signer Monthly Income: ${signer.monthlyIncome || 'Not provided'}`,
        `Signer Annual Income: ${signer.annualIncome || 'Not provided'}`,
        `Signer Employment Start Date: ${signer.employmentStartDate || 'Not provided'}`,
        `Signer Other Income: ${signer.otherIncome || 'Not provided'}`,
        `Signer Bankruptcy History: ${signer.bankruptcyHistory}`,
        `Signer Criminal History: ${signer.criminalHistory}`,
        `Signer Consent: ${signer.consent ? 'Yes' : 'No'}`,
        `Signer Signature: ${signer.signature || 'Not provided'}`,
        `Signer Date Signed: ${signer.dateSigned}`,
        `Signer Notes: ${buildSignerNotes(signer)}`,
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

// ---------------------------------------------------------------------------
// Step definitions — each has a title and a per-step validator
// ---------------------------------------------------------------------------
const SIGNER_STEPS = [
  {
    title: 'Co-Signer',
    validate: (s) => {
      const e = {}
      if (!s.hasCosigner) e.hasCosigner = 'Please select Yes or No'
      return e
    },
  },
  {
    title: 'Property Information',
    validate: (s) => {
      const e = {}
      if (!s.propertyName) e.propertyName = 'Select a property'
      if (!s.leaseStartDate) e.leaseStartDate = 'Lease start date is required'
      if (!s.leaseEndDate) e.leaseEndDate = 'Lease end date is required'
      if (s.leaseStartDate && s.leaseEndDate && new Date(s.leaseEndDate) <= new Date(s.leaseStartDate)) {
        e.leaseEndDate = 'Must be after lease start date'
      }
      if (s.leaseStartDate) {
        const today = new Date(); today.setHours(0,0,0,0)
        if (new Date(s.leaseStartDate) < today) e.leaseStartDate = 'Cannot be in the past'
      }
      if (s.propertyName && s.roomNumber && s.leaseStartDate) {
        const prop = PROPERTY_OPTIONS.find((p) => p.name === s.propertyName)
        const room = prop?.rooms.find((r) => r.name === s.roomNumber)
        if (room && !isRoomAvailableOnDate(room.available, s.leaseStartDate)) {
          e.leaseStartDate = `Room ${s.roomNumber} is not available on this date — ${getRoomAvailabilityLabel(room.available)}`
        }
      }
      return e
    },
  },
  {
    title: 'Signer Information',
    validate: (s) => {
      const e = {}
      const name = validateFullName(s.fullName); if (name) e.fullName = name
      const dob = validateDOB(s.dateOfBirth, { requireAdult: s.hasCosigner !== 'Yes' }); if (dob) e.dateOfBirth = dob
      const phone = validatePhone(s.phone); if (phone) e.phone = phone
      const email = validateEmail(s.email); if (email) e.email = email
      if (s.ssn) { const v = validateSSN(s.ssn); if (v) e.ssn = v }
      if (s.license) { const v = validateDriversLicense(s.license); if (v) e.license = v }
      if (!s.license) e.license = 'Driver\'s license is required'
      return e
    },
  },
  {
    title: 'Current Address',
    validate: (s) => {
      const e = {}
      const addr = validateStreetAddress(s.currentAddress); if (addr) e.currentAddress = addr
      if (!s.currentCity?.trim()) e.currentCity = 'City is required'
      if (s.currentState) { const v = validateState(s.currentState); if (v) e.currentState = v }
      if (!s.currentState?.trim()) e.currentState = 'State is required'
      if (s.currentZip) { const v = validateZip(s.currentZip); if (v) e.currentZip = v }
      if (!s.currentZip?.trim()) e.currentZip = 'ZIP is required'
      if (!s.currentMoveInDate) e.currentMoveInDate = 'Move-in date is required'
      if (!s.currentMoveOutDate) e.currentMoveOutDate = 'Expected move-out date is required'
      if (s.currentMoveInDate && s.currentMoveOutDate && new Date(s.currentMoveOutDate) <= new Date(s.currentMoveInDate)) {
        e.currentMoveOutDate = 'Move-out must be after move-in'
      }
      if (s.currentLandlordPhone) { const v = validatePhone(s.currentLandlordPhone); if (v) e.currentLandlordPhone = v }
      return e
    },
  },
  {
    title: 'Previous Address',
    validate: (s) => {
      const e = {}
      if (s.skipPreviousAddress) return e
      if (s.previousAddress?.trim()) {
        const addr = validateStreetAddress(s.previousAddress); if (addr) e.previousAddress = addr
      }
      if (s.previousAddress?.trim() && !s.previousMoveInDate) e.previousMoveInDate = 'Move-in date is required'
      if (s.previousAddress?.trim() && !s.previousMoveOutDate) e.previousMoveOutDate = 'Move-out date is required'
      if (s.previousMoveInDate && s.previousMoveOutDate && new Date(s.previousMoveOutDate) <= new Date(s.previousMoveInDate)) {
        e.previousMoveOutDate = 'Move-out must be after move-in'
      }
      if (s.previousState) { const v = validateState(s.previousState); if (v) e.previousState = v }
      if (s.previousZip) { const v = validateZip(s.previousZip); if (v) e.previousZip = v }
      if (s.previousLandlordPhone) { const v = validatePhone(s.previousLandlordPhone); if (v) e.previousLandlordPhone = v }
      return e
    },
  },
  {
    title: 'Employment & Income',
    validate: (s) => {
      const e = {}
      if (!s.noEmployment) {
        if (s.supervisorPhone) { const v = validatePhone(s.supervisorPhone); if (v) e.supervisorPhone = v }
        if (s.monthlyIncome) { const v = validateIncome(s.monthlyIncome); if (v) e.monthlyIncome = v }
        if (s.annualIncome) { const v = validateIncome(s.annualIncome); if (v) e.annualIncome = v }
      }
      return e
    },
  },
  {
    title: 'References',
    validate: (s) => {
      const e = {}
      if (!s.reference1Name?.trim()) e.reference1Name = 'At least one reference name is required'
      if (!s.reference1Phone?.trim()) e.reference1Phone = 'Reference phone is required'
      else { const v = validatePhone(s.reference1Phone); if (v) e.reference1Phone = v }
      if (s.reference2Phone) { const v = validatePhone(s.reference2Phone); if (v) e.reference2Phone = v }
      return e
    },
  },
  { title: 'Additional Information', validate: () => ({}) },
  {
    title: 'Financial Background & Legal',
    validate: (s) => {
      const e = {}
      if (!s.evictionHistory) e.evictionHistory = 'Required'
      if (!s.bankruptcyHistory) e.bankruptcyHistory = 'Required'
      if (!s.criminalHistory) e.criminalHistory = 'Required'
      if (!s.consent) e.consent = 'You must consent to proceed'
      return e
    },
  },
  {
    title: 'Signature',
    validate: (s) => {
      const e = {}
      if (!s.signature?.trim()) e.signature = 'Signature is required'
      if (!s.dateSigned) e.dateSigned = 'Date signed is required'
      return e
    },
  },
]

const COSIGNER_STEPS = [
  { title: 'Link to Signer', validate: () => ({}) },
  {
    title: 'Co-Signer Information',
    validate: (c) => {
      const e = {}
      const name = validateFullName(c.fullName); if (name) e.fullName = name
      const dob = validateDOB(c.dateOfBirth); if (dob) e.dateOfBirth = dob
      const phone = validatePhone(c.phone); if (phone) e.phone = phone
      const email = validateEmail(c.email); if (email) e.email = email
      if (c.ssn) { const v = validateSSN(c.ssn); if (v) e.ssn = v }
      if (c.license) { const v = validateDriversLicense(c.license); if (v) e.license = v }
      if (!c.license) e.license = 'Driver\'s license is required'
      if (!c.currentAddress?.trim()) e.currentAddress = 'Address is required'
      if (c.state) { const v = validateState(c.state); if (v) e.state = v }
      if (c.zip) { const v = validateZip(c.zip); if (v) e.zip = v }
      return e
    },
  },
  {
    title: 'Employment & Income',
    validate: (c) => {
      const e = {}
      if (!c.noEmployment) {
        if (c.supervisorPhone) { const v = validatePhone(c.supervisorPhone); if (v) e.supervisorPhone = v }
        if (c.monthlyIncome) { const v = validateIncome(c.monthlyIncome); if (v) e.monthlyIncome = v }
        if (c.annualIncome) { const v = validateIncome(c.annualIncome); if (v) e.annualIncome = v }
      }
      return e
    },
  },
  {
    title: 'Financial Background & Legal',
    validate: (c) => {
      const e = {}
      if (!c.bankruptcyHistory) e.bankruptcyHistory = 'Required'
      if (!c.criminalHistory) e.criminalHistory = 'Required'
      if (!c.consent) e.consent = 'You must consent to proceed'
      return e
    },
  },
  {
    title: 'Signature',
    validate: (c) => {
      const e = {}
      if (!c.signature?.trim()) e.signature = 'Signature is required'
      if (!c.dateSigned) e.dateSigned = 'Date signed is required'
      return e
    },
  },
]

export default function Apply() {
  const [applicationType, setApplicationType] = useState('')
  const [step, setStep] = useState(0)
  const [signer, setSigner] = useState(defaultSigner())
  const [cosigner, setCosigner] = useState(defaultCosigner())
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submittedRecord, setSubmittedRecord] = useState(null)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})

  const steps = applicationType === 'cosigner' ? COSIGNER_STEPS : SIGNER_STEPS
  const totalSteps = steps.length
  const isLastStep = step === totalSteps - 1

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
    // Clear field error on change
    if (fieldErrors[key]) setFieldErrors((prev) => { const n = {...prev}; delete n[key]; return n })
  }

  function updateCosigner(key, value) {
    setCosigner((prev) => ({ ...prev, [key]: value }))
    if (fieldErrors[key]) setFieldErrors((prev) => { const n = {...prev}; delete n[key]; return n })
  }

  function handleNext() {
    const current = steps[step]
    const data = applicationType === 'cosigner' ? cosigner : signer
    const errs = current.validate(data)
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs)
      setTimeout(() => {
        const el = document.querySelector('[data-field-error]')
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 50)
      return
    }
    setFieldErrors({})
    setStep((s) => s + 1)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function handleBack() {
    setFieldErrors({})
    setStep((s) => s - 1)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleSubmit(event) {
    event.preventDefault()
    // Final step validation before submit
    const current = steps[step]
    const data = applicationType === 'cosigner' ? cosigner : signer
    const errs = current.validate(data)
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs)
      return
    }
    setSubmitting(true)
    setError('')
    setFieldErrors({})

    try {
      if (applicationType === 'signer') {
        if (!signer.consent) {
          throw new Error('The signer must consent to the credit and background check before submitting.')
        }

        const isDuplicate = await checkDuplicateApplication(signer.email)
        if (isDuplicate) {
          throw new Error(`An application has already been submitted with the email address "${signer.email}". If you believe this is an error, please contact leasing directly.`)
        }

        const fields = {
          // Identity
          'Signer Full Name': signer.fullName,
          'Signer Email': signer.email,
          'Signer Phone Number': signer.phone,
          'Signer Date of Birth': signer.dateOfBirth,
          'Signer SSN No.': signer.ssn || '',
          'Signer Driving License No.': signer.license,
          // Property
          'Property Name': signer.propertyName,
          'Property Address': signer.propertyAddress || '',
          'Room Number': signer.roomNumber || '',
          'Lease Term': signer.leaseTerm,
          'Lease Start Date': signer.leaseStartDate || null,
          'Lease End Date': signer.leaseEndDate || null,
          // Current address
          'Signer Current Address': signer.currentAddress,
          'Signer City': signer.currentCity,
          'Signer State': signer.currentState,
          'Signer ZIP': signer.currentZip,
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
          'Signer Employer': signer.employer || '',
          'Signer Employer Address': signer.employerAddress || '',
          'Signer Supervisor Name': signer.supervisorName || '',
          'Signer Supervisor Phone': signer.supervisorPhone || '',
          'Signer Job Title': signer.jobTitle || '',
          'Signer Monthly Income': toCurrencyNumber(signer.monthlyIncome),
          'Signer Annual Income': toCurrencyNumber(signer.annualIncome),
          'Signer Employment Start Date': signer.employmentStartDate || null,
          'Signer Other Income': signer.otherIncome || '',
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
          'Signer Bankruptcy History': signer.bankruptcyHistory,
          'Signer Criminal History': signer.criminalHistory,
          'Has Co-Signer': signer.hasCosigner,
          // Signature
          'Signer Consent for Credit and Background Check': signer.consent,
          'Signer Signature': signer.signature,
          'Signer Date Signed': signer.dateSigned,
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
    const rawAppId = submittedRecord?.fields?.['Application ID'] ?? submittedRecord?.id
    const appId = typeof rawAppId === 'number' ? `#${rawAppId}` : String(rawAppId || '').replace(/^APP-/, '')
    const isSigner = applicationType === 'signer'
    const firstName = isSigner ? signer.fullName.split(' ')[0] : cosigner.fullName.split(' ')[0]

    return (
      <div className="min-h-screen bg-cream-50">
        <Seo title="Application Submitted | Axis Seattle Housing" pathname="/apply" />
        <div className="mx-auto max-w-lg px-4 py-20 sm:py-28">
          {/* Check icon */}
          <div className="mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-full bg-teal-50 ring-8 ring-teal-50/60">
            <svg className="h-10 w-10 text-axis" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <h1 className="text-center text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">Application received</h1>
          <p className="mt-3 text-center text-base leading-7 text-slate-500">
            {isSigner
              ? `Thanks, ${firstName}! We'll review your application and reach out within 2 business days.`
              : `Thanks, ${firstName}! Your co-signer form has been linked to the signer's application.`}
          </p>

          {isSigner && appId && (
            <div className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 bg-slate-50 px-6 py-3">
                <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Your Application ID</span>
              </div>
              <div className="flex items-center justify-between gap-4 px-6 py-5">
                <span className="font-mono text-3xl font-black tracking-tight text-slate-900">{appId}</span>
                <CopyButton text={appId} />
              </div>
              {signer.hasCosigner === 'Yes' && (
                <div className="border-t border-slate-100 bg-teal-50 px-6 py-4">
                  <p className="text-sm leading-6 text-teal-800">
                    Share this ID with your co-signer — they'll need it to link their form to yours at <strong>/apply</strong>.
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="mt-8 flex flex-col gap-3">
            <a href="/apply" className="inline-block w-full rounded-full border border-slate-200 bg-white px-6 py-3 text-center text-sm font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50 transition">
              Submit another application
            </a>
            <a href="/" className="inline-block w-full rounded-full bg-slate-900 px-6 py-3 text-center text-sm font-semibold text-white hover:bg-slate-800 transition">
              Back to home
            </a>
          </div>
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

      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="mb-8">
          <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">Axis applications</div>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">Residential Rental Application</h1>
        </div>

        {/* Step 0 — type selection (always shown first, outside steps) */}
        {!applicationType && (
          <Section title="Who Are You Filing As?">
            <p className="text-sm leading-6 text-slate-500">Choose your role to begin the application.</p>
            <div className="mt-2 flex flex-wrap gap-3">
              <button type="button" onClick={() => { setApplicationType('signer'); setStep(0) }}
                className="rounded-full border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-700 hover:border-slate-900 hover:bg-slate-50 transition">
                Signer
              </button>
              <button type="button" onClick={() => { setApplicationType('cosigner'); setStep(0) }}
                className="rounded-full border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-700 hover:border-slate-900 hover:bg-slate-50 transition">
                Co-Signer
              </button>
            </div>
          </Section>
        )}

        {applicationType && (
          <>
            {/* Progress bar */}
            <div className="mb-6">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">
                  Step {step + 1} of {totalSteps} — {steps[step].title}
                </span>
                <button type="button" onClick={() => { setApplicationType(''); setStep(0); setFieldErrors({}) }}
                  className="text-xs text-slate-400 hover:text-slate-700 transition">
                  Change type
                </button>
              </div>
              <div className="h-1.5 w-full rounded-full bg-slate-200">
                <div
                  className="h-1.5 rounded-full bg-axis transition-all duration-300"
                  style={{ width: `${((step + 1) / totalSteps) * 100}%` }}
                />
              </div>
            </div>

        <form onSubmit={handleSubmit} className="space-y-6">

          {applicationType === 'signer' && step === 0 && (
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
                {fieldErrors.hasCosigner && <p className="mt-1.5 text-xs font-medium text-red-500" data-field-error="1">{fieldErrors.hasCosigner}</p>}
                {signer.hasCosigner === 'Yes' && (
                  <div className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-800">
                    After you submit, you'll receive an <strong>Application ID</strong>. Share it with your co-signer — they'll need it to link their form to yours.
                  </div>
                )}
              </Section>
          )}
          {applicationType === 'signer' && step === 1 && (
              <Section title="Property Information">
                <Field label="Property Name" required>
                  <select required className={selectCls} value={signer.propertyName} onChange={(e) => updateSigner('propertyName', e.target.value)}>
                    <option value="" disabled>Select a property…</option>
                    {PROPERTY_OPTIONS.map((property) => (
                      <option key={property.id} value={property.name}>{property.name}</option>
                    ))}
                  </select>
                </Field>

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Room Number">
                    <select className={selectCls} value={signer.roomNumber} onChange={(e) => updateSigner('roomNumber', e.target.value)} disabled={!selectedProperty}>
                      <option value="">{selectedProperty ? 'Select a room…' : 'Choose a property first'}</option>
                      {(selectedProperty?.rooms || []).map((room) => (
                        <option key={room.name} value={room.name}>{room.name}</option>
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
                  <Field label="Lease Start Date" required error={fieldErrors.leaseStartDate}>
                    <input required type="date" min={todayIsoDate()} max={MAX_DATE} className={inputCls} value={signer.leaseStartDate} onChange={(e) => updateSigner('leaseStartDate', clampYear(e.target.value))} />
                  </Field>
                  <Field label="Lease End Date" required error={fieldErrors.leaseEndDate}>
                    <input required type="date" min={signer.leaseStartDate || todayIsoDate()} max={MAX_DATE} className={inputCls} value={signer.leaseEndDate} onChange={(e) => updateSigner('leaseEndDate', clampYear(e.target.value))} />
                  </Field>
                </div>
              </Section>
          )}
          {applicationType === 'signer' && step === 2 && (
              <Section title="Signer Information">
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Full Name" required error={fieldErrors.fullName}>
                    <input required className={inputCls} value={signer.fullName} onChange={(e) => updateSigner('fullName', e.target.value)} />
                  </Field>
                  <Field label="Date of Birth" required error={fieldErrors.dateOfBirth}>
                    <input required type="date" min={MIN_DOB} max={todayIsoDate()} className={inputCls} value={signer.dateOfBirth} onChange={(e) => updateSigner('dateOfBirth', clampYear(e.target.value))} />
                  </Field>
                </div>

                <div className="grid gap-5 sm:grid-cols-3">
                  <Field label="Social Security #" hint="9 digits — ###-##-####" error={fieldErrors.ssn}>
                    <input className={inputCls} placeholder="123-45-6789" value={signer.ssn} onChange={(e) => updateSigner('ssn', formatSSNInput(e.target.value))} />
                  </Field>
                  <Field label="Driver's License / ID #" required hint="1 letter + 10 digits (e.g. W1234567890)" error={fieldErrors.license}>
                    <input required className={inputCls} placeholder="W1234567890" value={signer.license} onChange={(e) => updateSigner('license', e.target.value)} />
                  </Field>
                  <Field label="Phone Number" required hint="10 digits" error={fieldErrors.phone}>
                    <input required type="tel" className={inputCls} placeholder="(206) 555-0100" value={signer.phone} onChange={(e) => updateSigner('phone', formatPhoneInput(e.target.value))} />
                  </Field>
                </div>

                <Field label="Email" required error={fieldErrors.email}>
                  <input required type="email" className={inputCls} value={signer.email} onChange={(e) => updateSigner('email', e.target.value)} />
                </Field>
              </Section>
          )}
          {applicationType === 'signer' && step === 3 && (
              <Section title="Current Address">
                <p className="text-sm text-slate-500 -mt-1 mb-2">This is the address where you currently live.</p>
                <Field label="Street Address" required error={fieldErrors.currentAddress}>
                  <AddressAutocomplete
                    required
                    value={signer.currentAddress}
                    onChange={(val) => updateSigner('currentAddress', val)}
                    onSelect={({ city, state, zip }) => {
                      if (city) updateSigner('currentCity', city)
                      if (state) updateSigner('currentState', state)
                      if (zip) updateSigner('currentZip', zip)
                    }}
                    placeholder="123 Main St"
                    className={inputCls}
                  />
                </Field>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="City" required>
                    <input required className={inputCls} autoComplete="address-level2" placeholder="Seattle" value={signer.currentCity} onChange={(e) => updateSigner('currentCity', e.target.value)} />
                  </Field>
                  <Field label="State" required error={fieldErrors.currentState}>
                    <input required className={inputCls} autoComplete="address-level1" placeholder="WA" maxLength={2} value={signer.currentState} onChange={(e) => updateSigner('currentState', e.target.value.toUpperCase())} />
                  </Field>
                  <Field label="ZIP" required error={fieldErrors.currentZip}>
                    <input required className={inputCls} autoComplete="postal-code" placeholder="98105" value={signer.currentZip} onChange={(e) => updateSigner('currentZip', e.target.value)} />
                  </Field>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Landlord / Property Manager Name">
                    <input className={inputCls} value={signer.currentLandlordName} onChange={(e) => updateSigner('currentLandlordName', e.target.value)} />
                  </Field>
                  <Field label="Landlord Phone #" error={fieldErrors.currentLandlordPhone}>
                    <input type="tel" className={inputCls} placeholder="(206) 555-0100" value={signer.currentLandlordPhone} onChange={(e) => updateSigner('currentLandlordPhone', formatPhoneInput(e.target.value))} />
                  </Field>
                </div>

                <div className="grid gap-5 sm:grid-cols-3">
                  <Field label="Move-in Date" required error={fieldErrors.currentMoveInDate}>
                    <input required type="date" min={MIN_DOB} max={MAX_DATE} className={inputCls} value={signer.currentMoveInDate} onChange={(e) => updateSigner('currentMoveInDate', clampYear(e.target.value))} />
                  </Field>
                  <Field label="Move-out Date" required error={fieldErrors.currentMoveOutDate}>
                    <input required type="date" min={MIN_DOB} max={MAX_DATE} className={inputCls} value={signer.currentMoveOutDate} onChange={(e) => updateSigner('currentMoveOutDate', clampYear(e.target.value))} />
                  </Field>
                  <Field label="Reason for Leaving">
                    <input className={inputCls} value={signer.currentReasonForLeaving} onChange={(e) => updateSigner('currentReasonForLeaving', e.target.value)} />
                  </Field>
                </div>
              </Section>
          )}
          {applicationType === 'signer' && step === 4 && (
              <Section title="Previous Address">
                <p className="text-sm text-slate-500 -mt-1 mb-3">Only required if you have lived at your current address for <strong>less than 1 year</strong>. If you have been at your current address for 1 year or more, check the box below to skip this section.</p>
                <label className="flex items-center gap-2 mb-4 text-sm text-slate-700 cursor-pointer select-none">
                  <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-axis focus:ring-axis" checked={signer.skipPreviousAddress} onChange={(e) => updateSigner('skipPreviousAddress', e.target.checked)} />
                  I have lived at my current address for 1 year or more — skip this section
                </label>
                {!signer.skipPreviousAddress && <>
                <Field label="Street Address" error={fieldErrors.previousAddress}>
                  <AddressAutocomplete
                    value={signer.previousAddress}
                    onChange={(val) => updateSigner('previousAddress', val)}
                    onSelect={({ city, state, zip }) => {
                      if (city) updateSigner('previousCity', city)
                      if (state) updateSigner('previousState', state)
                      if (zip) updateSigner('previousZip', zip)
                    }}
                    placeholder="123 Main St"
                    className={inputCls}
                  />
                </Field>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="City">
                    <input className={inputCls} autoComplete="address-level2" placeholder="Seattle" value={signer.previousCity} onChange={(e) => updateSigner('previousCity', e.target.value)} />
                  </Field>
                  <Field label="State" error={fieldErrors.previousState}>
                    <input className={inputCls} autoComplete="address-level1" placeholder="WA" maxLength={2} value={signer.previousState} onChange={(e) => updateSigner('previousState', e.target.value.toUpperCase())} />
                  </Field>
                  <Field label="ZIP" error={fieldErrors.previousZip}>
                    <input className={inputCls} autoComplete="postal-code" placeholder="98105" value={signer.previousZip} onChange={(e) => updateSigner('previousZip', e.target.value)} />
                  </Field>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Landlord / Property Manager Name">
                    <input className={inputCls} value={signer.previousLandlordName} onChange={(e) => updateSigner('previousLandlordName', e.target.value)} />
                  </Field>
                  <Field label="Landlord Phone #" error={fieldErrors.previousLandlordPhone}>
                    <input type="tel" className={inputCls} placeholder="(206) 555-0100" value={signer.previousLandlordPhone} onChange={(e) => updateSigner('previousLandlordPhone', formatPhoneInput(e.target.value))} />
                  </Field>
                </div>

                <div className="grid gap-5 sm:grid-cols-3">
                  <Field label="Move-in Date" error={fieldErrors.previousMoveInDate}>
                    <input type="date" min={MIN_DOB} max={MAX_DATE} className={inputCls} value={signer.previousMoveInDate} onChange={(e) => updateSigner('previousMoveInDate', clampYear(e.target.value))} />
                  </Field>
                  <Field label="Move-out Date" error={fieldErrors.previousMoveOutDate}>
                    <input type="date" min={MIN_DOB} max={MAX_DATE} className={inputCls} value={signer.previousMoveOutDate} onChange={(e) => updateSigner('previousMoveOutDate', clampYear(e.target.value))} />
                  </Field>
                  <Field label="Reason for Leaving">
                    <input className={inputCls} value={signer.previousReasonForLeaving} onChange={(e) => updateSigner('previousReasonForLeaving', e.target.value)} />
                  </Field>
                </div>
                </>}
              </Section>
          )}
          {applicationType === 'signer' && step === 5 && (
              <Section title="Employment & Income">
                <label className="flex items-center gap-2 mb-4 text-sm text-slate-700 cursor-pointer select-none">
                  <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-axis focus:ring-axis" checked={signer.noEmployment} onChange={(e) => updateSigner('noEmployment', e.target.checked)} />
                  I am not currently employed
                </label>
                {!signer.noEmployment && <>
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
                  <Field label="Supervisor Phone #" error={fieldErrors.supervisorPhone}>
                    <input type="tel" className={inputCls} placeholder="(206) 555-0100" value={signer.supervisorPhone} onChange={(e) => updateSigner('supervisorPhone', formatPhoneInput(e.target.value))} />
                  </Field>
                </div>

                <div className="grid gap-5 sm:grid-cols-4">
                  <Field label="Job Title">
                    <input className={inputCls} value={signer.jobTitle} onChange={(e) => updateSigner('jobTitle', e.target.value)} />
                  </Field>
                  <Field label="Monthly Income ($)" error={fieldErrors.monthlyIncome}>
                    <input type="number" min="0" step="1" inputMode="numeric" className={inputCls} placeholder="0" value={signer.monthlyIncome} onChange={(e) => updateSigner('monthlyIncome', e.target.value)} />
                  </Field>
                  <Field label="Annual Income ($)" error={fieldErrors.annualIncome}>
                    <input type="number" min="0" step="1" inputMode="numeric" className={inputCls} placeholder="0" value={signer.annualIncome} onChange={(e) => updateSigner('annualIncome', e.target.value)} />
                  </Field>
                  <Field label="Employment Start Date">
                    <input type="date" min={MIN_DOB} max={MAX_DATE} className={inputCls} value={signer.employmentStartDate} onChange={(e) => updateSigner('employmentStartDate', clampYear(e.target.value))} />
                  </Field>
                </div>
                </>}

                <Field label="Other / Non-Employment Income ($)">
                  <p className="text-xs text-slate-400 mb-1">e.g. rental income, investments, child support, disability</p>
                  <input type="number" min="0" step="1" inputMode="numeric" className={inputCls} placeholder="0" value={signer.otherIncome} onChange={(e) => updateSigner('otherIncome', e.target.value)} />
                </Field>
              </Section>
          )}
          {applicationType === 'signer' && step === 6 && (
              <Section title="References">
                <p className="text-sm leading-6 text-slate-500">Provide at least one personal or professional reference (not a family member).</p>
                <div className="grid gap-5 sm:grid-cols-3">
                  <Field label="Name" required error={fieldErrors.reference1Name}>
                    <input required className={inputCls} placeholder="Jane Smith" value={signer.reference1Name} onChange={(e) => updateSigner('reference1Name', e.target.value)} />
                  </Field>
                  <Field label="Relationship" required>
                    <input required className={inputCls} placeholder="Colleague" value={signer.reference1Relationship} onChange={(e) => updateSigner('reference1Relationship', e.target.value)} />
                  </Field>
                  <Field label="Phone #" required error={fieldErrors.reference1Phone}>
                    <input required type="tel" className={inputCls} placeholder="(206) 555-0100" value={signer.reference1Phone} onChange={(e) => updateSigner('reference1Phone', formatPhoneInput(e.target.value))} />
                  </Field>
                </div>
                <div className="grid gap-5 sm:grid-cols-3">
                  <Field label="Name 2 (optional)">
                    <input className={inputCls} placeholder="John Doe" value={signer.reference2Name} onChange={(e) => updateSigner('reference2Name', e.target.value)} />
                  </Field>
                  <Field label="Relationship 2">
                    <input className={inputCls} placeholder="Professor" value={signer.reference2Relationship} onChange={(e) => updateSigner('reference2Relationship', e.target.value)} />
                  </Field>
                  <Field label="Phone # 2" error={fieldErrors.reference2Phone}>
                    <input type="tel" className={inputCls} placeholder="(206) 555-0101" value={signer.reference2Phone} onChange={(e) => updateSigner('reference2Phone', formatPhoneInput(e.target.value))} />
                  </Field>
                </div>
              </Section>
          )}
          {applicationType === 'signer' && step === 7 && (
              <Section title="Additional Information">
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Number of Occupants">
                    <input type="number" min="1" max="20" inputMode="numeric" className={inputCls} placeholder="1" value={signer.occupants} onChange={(e) => updateSigner('occupants', e.target.value)} />
                  </Field>
                  <Field label="Pets">
                    <input className={inputCls} value={signer.pets} onChange={(e) => updateSigner('pets', e.target.value)} />
                  </Field>
                </div>
              </Section>
          )}
          {applicationType === 'signer' && step === 8 && (
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
          )}
          {applicationType === 'signer' && step === 9 && (
              <Section title="Signature">
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Signer Signature" required>
                    <input required className={inputCls} value={signer.signature} onChange={(e) => updateSigner('signature', e.target.value)} />
                  </Field>
                  <Field label="Date Signed" required>
                    <input required type="date" min="2020-01-01" max={MAX_DATE} className={inputCls} value={signer.dateSigned} onChange={(e) => updateSigner('dateSigned', clampYear(e.target.value))} />
                  </Field>
                </div>
                <Field label="Additional Notes">
                  <textarea className={`${inputCls} min-h-[96px] resize-y`} value={signer.notes} onChange={(e) => updateSigner('notes', e.target.value)} />
                </Field>
              </Section>
          )}

          {applicationType === 'cosigner' && step === 0 && (
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
          )}
          {applicationType === 'cosigner' && step === 1 && (
              <Section title="Co-Signer Information">
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Full Name" required error={fieldErrors.fullName}>
                    <input required className={inputCls} value={cosigner.fullName} onChange={(e) => updateCosigner('fullName', e.target.value)} />
                  </Field>
                  <Field label="Email" required error={fieldErrors.email}>
                    <input required type="email" className={inputCls} value={cosigner.email} onChange={(e) => updateCosigner('email', e.target.value)} />
                  </Field>
                </div>

                <div className="grid gap-5 sm:grid-cols-3">
                  <Field label="Phone Number" required hint="10 digits" error={fieldErrors.phone}>
                    <input required type="tel" className={inputCls} placeholder="(206) 555-0100" value={cosigner.phone} onChange={(e) => updateCosigner('phone', e.target.value)} />
                  </Field>
                  <Field label="Date of Birth" required error={fieldErrors.dateOfBirth}>
                    <input required type="date" min={MIN_DOB} max={todayIsoDate()} className={inputCls} value={cosigner.dateOfBirth} onChange={(e) => updateCosigner('dateOfBirth', clampYear(e.target.value))} />
                  </Field>
                  <Field label="Driver's License / ID #" required hint="1 letter + 10 digits (e.g. W1234567890)" error={fieldErrors.license}>
                    <input required className={inputCls} placeholder="W1234567890" value={cosigner.license} onChange={(e) => updateCosigner('license', e.target.value)} />
                  </Field>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Social Security #" hint="9 digits — ###-##-####" error={fieldErrors.ssn}>
                    <input className={inputCls} placeholder="123-45-6789" value={cosigner.ssn} onChange={(e) => updateCosigner('ssn', e.target.value)} />
                  </Field>
                  <Field label="Current Address" required>
                    <AddressAutocomplete
                      required
                      value={cosigner.currentAddress}
                      onChange={(val) => updateCosigner('currentAddress', val)}
                      onSelect={({ city, state, zip }) => {
                        if (city) updateCosigner('city', city)
                        if (state) updateCosigner('state', state)
                        if (zip) updateCosigner('zip', zip)
                      }}
                      placeholder="123 Main St"
                      className={inputCls}
                    />
                  </Field>
                </div>

                <div className="grid gap-5 sm:grid-cols-3">
                  <Field label="City" required>
                    <input required className={inputCls} autoComplete="address-level2" placeholder="Seattle" value={cosigner.city} onChange={(e) => updateCosigner('city', e.target.value)} />
                  </Field>
                  <Field label="State" required error={fieldErrors.state}>
                    <input required className={inputCls} autoComplete="address-level1" placeholder="WA" maxLength={2} value={cosigner.state} onChange={(e) => updateCosigner('state', e.target.value.toUpperCase())} />
                  </Field>
                  <Field label="ZIP" required error={fieldErrors.zip}>
                    <input required className={inputCls} autoComplete="postal-code" placeholder="98105" value={cosigner.zip} onChange={(e) => updateCosigner('zip', e.target.value)} />
                  </Field>
                </div>
              </Section>
          )}
          {applicationType === 'cosigner' && step === 2 && (
              <Section title="Employment & Income">
                <label className="flex items-center gap-2 mb-4 text-sm text-slate-700 cursor-pointer select-none">
                  <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-axis focus:ring-axis" checked={cosigner.noEmployment} onChange={(e) => updateCosigner('noEmployment', e.target.checked)} />
                  I am not currently employed
                </label>
                {!cosigner.noEmployment && <>
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
                  <Field label="Supervisor Phone #" error={fieldErrors.supervisorPhone}>
                    <input type="tel" className={inputCls} value={cosigner.supervisorPhone} onChange={(e) => updateCosigner('supervisorPhone', e.target.value)} />
                  </Field>
                </div>

                <div className="grid gap-5 sm:grid-cols-4">
                  <Field label="Job Title">
                    <input className={inputCls} value={cosigner.jobTitle} onChange={(e) => updateCosigner('jobTitle', e.target.value)} />
                  </Field>
                  <Field label="Monthly Income ($)" error={fieldErrors.monthlyIncome}>
                    <input type="number" min="0" step="1" inputMode="numeric" className={inputCls} placeholder="0" value={cosigner.monthlyIncome} onChange={(e) => updateCosigner('monthlyIncome', e.target.value)} />
                  </Field>
                  <Field label="Annual Income ($)" error={fieldErrors.annualIncome}>
                    <input type="number" min="0" step="1" inputMode="numeric" className={inputCls} placeholder="0" value={cosigner.annualIncome} onChange={(e) => updateCosigner('annualIncome', e.target.value)} />
                  </Field>
                  <Field label="Employment Start Date">
                    <input type="date" min={MIN_DOB} max={MAX_DATE} className={inputCls} value={cosigner.employmentStartDate} onChange={(e) => updateCosigner('employmentStartDate', clampYear(e.target.value))} />
                  </Field>
                </div>
                </>}

                <Field label="Other / Non-Employment Income ($)">
                  <p className="text-xs text-slate-400 mb-1">e.g. rental income, investments, child support, disability</p>
                  <input type="number" min="0" step="1" inputMode="numeric" className={inputCls} placeholder="0" value={cosigner.otherIncome} onChange={(e) => updateCosigner('otherIncome', e.target.value)} />
                </Field>
              </Section>
          )}
          {applicationType === 'cosigner' && step === 3 && (
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
          )}
          {applicationType === 'cosigner' && step === 4 && (
              <Section title="Signature">
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Co-Signer Signature" required>
                    <input required className={inputCls} value={cosigner.signature} onChange={(e) => updateCosigner('signature', e.target.value)} />
                  </Field>
                  <Field label="Date Signed" required>
                    <input required type="date" min="2020-01-01" max={MAX_DATE} className={inputCls} value={cosigner.dateSigned} onChange={(e) => updateCosigner('dateSigned', clampYear(e.target.value))} />
                  </Field>
                </div>
                <Field label="Additional Notes">
                  <textarea className={`${inputCls} min-h-[96px] resize-y`} value={cosigner.notes} onChange={(e) => updateCosigner('notes', e.target.value)} />
                </Field>
              </Section>
          )}

          {error && (
            <div className="space-y-3 rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700">
              <p className="font-semibold">Submission failed — Airtable didn&apos;t accept the application.</p>
              <p className="break-all font-mono text-xs text-red-600">{error}</p>
              <a href={buildMailtoFallback(applicationType, signer, cosigner)} className="inline-block rounded-lg bg-red-700 px-4 py-2 text-xs font-semibold text-white hover:bg-red-800">
                Send via email instead
              </a>
            </div>
          )}

          <div className="flex gap-3">
            {step > 0 && (
              <button type="button" onClick={handleBack} className="rounded-full border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-700 hover:border-slate-400 transition">
                Back
              </button>
            )}
            {!isLastStep ? (
              <button type="button" onClick={handleNext} className="flex-1 rounded-full bg-slate-900 py-3 text-sm font-semibold text-white hover:bg-slate-800 transition">
                Continue
              </button>
            ) : (
              <button type="submit" disabled={submitting} className="flex-1 rounded-full bg-axis py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60 transition">
                {submitting ? 'Submitting…' : applicationType === 'cosigner' ? 'Submit co-signer form' : 'Submit application'}
              </button>
            )}
          </div>
        </form>
          </>
        )}
      </div>
    </div>
  )
}

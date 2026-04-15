import { useEffect, useMemo, useRef, useState } from 'react'
import { Seo } from '../lib/seo'
import { properties } from '../data/properties'
import { signLease, getSignedLeases } from '../lib/airtable'
import { EmbeddedStripeCheckout } from '../components/EmbeddedStripeCheckout'
import { readJsonResponse } from '../lib/readJsonResponse'
import { errorFromAirtableApiBody } from '../lib/airtablePermissionError'

const AIRTABLE_BASE_ID = import.meta.env.VITE_AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const APPLICATIONS_TABLE = import.meta.env.VITE_AIRTABLE_APPLICATIONS_TABLE || 'Applications'
const COSIGNERS_TABLE = import.meta.env.VITE_AIRTABLE_COAPPLICANTS_TABLE || 'Co-Signers'
const AIRTABLE_TOKEN = import.meta.env.VITE_AIRTABLE_TOKEN
const APPLICATION_SUBMISSION_STORAGE_KEY = 'axis_application_submission'
const APPLICATION_DRAFT_STORAGE_KEY = 'axis_application_draft'
const PRE_SUBMIT_KEY = 'axis_apply_prepay'
/** Airtable Applications record id (rec…); set before Stripe, cleared after successful submit. */
const APPLICATION_RECORD_ID_KEY = 'axis_application_record_id'
/** Stripe Checkout Session id after return_url (embedded); used to sync payment if webhook is slow. */
const APPLICATION_FEE_CHECKOUT_SESSION_KEY = 'axis_application_fee_checkout_session_id'

const HISTORY_OPTIONS = ['No', 'Yes']
const LEASE_TERMS = [
  '3-Month',
  '9-Month',
  '12-Month',
  'Month-to-Month (+$25/mo)',
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

// Returns true if the room is available for the requested lease window.
function isRoomAvailableForRange(availableStr, leaseStartDate, leaseEndDate) {
  if (!leaseStartDate) return true
  const { windows, unavailable } = parseAvailability(availableStr)
  if (unavailable) return false
  const start = new Date(leaseStartDate)
  const end = leaseEndDate ? new Date(leaseEndDate) : null
  return windows.some(({ from, to }) => {
    const afterFrom = start >= from
    const startWithinWindow = to === null || start <= to
    const endWithinWindow = end === null || to === null || end <= to
    return afterFrom && startWithinWindow && endWithinWindow
  })
}

function getRoomAvailabilityLabel(availableStr) {
  const s = String(availableStr || '').trim()
  if (!s || s.toLowerCase() === 'unavailable') return 'Unavailable'
  return s
}

// Look up the monthly rent number for a given property + room name
function getRoomMonthlyRent(propertyName, roomNumber) {
  if (!propertyName || !roomNumber) return 0
  const prop = properties.find((p) => p.name === propertyName)
  if (!prop) return 0
  for (const plan of (prop.roomPlans || [])) {
    const room = (plan.rooms || []).find((r) => r.name === roomNumber)
    if (room?.price) {
      const n = parseInt(String(room.price).replace(/[^0-9]/g, ''), 10)
      if (Number.isFinite(n) && n > 0) return n
    }
  }
  return 0
}

function getSecurityDeposit(propertyName, monthlyRent) {
  const prop = properties.find((p) => p.name === propertyName)
  if (prop?.securityDeposit) {
    const n = parseInt(String(prop.securityDeposit).replace(/[^0-9]/g, ''), 10)
    if (Number.isFinite(n) && n > 0) return n
  }
  return monthlyRent
}

function getUtilitiesFee(propertyName) {
  const prop = properties.find((p) => p.name === propertyName)
  if (prop?.utilitiesFee) {
    const n = parseInt(String(prop.utilitiesFee).replace(/[^0-9]/g, ''), 10)
    if (Number.isFinite(n) && n > 0) return n
  }
  return 0
}

/** Default when no per-property fee; keep in sync with `STRIPE_APPLICATION_FEE_USD` on the server. */
const DEFAULT_APPLICATION_FEE_USD = 0.01
const MAX_APPLICATION_FEE_USD = 9999

/** Parse `applicationFee` from marketing `properties.js`. Returns null → use default USD amount. */
function parseApplicationFeeFromMarketing(raw) {
  if (raw == null || raw === '') return null
  const s = String(raw).toLowerCase().trim()
  if (/\bcontact\b/.test(s)) return null
  const digitsOnly = String(raw).replace(/[^0-9]/g, '')
  if (!digitsOnly) {
    if (/\b(no fee|free|waive|waived)\b/.test(s)) return 0
    return null
  }
  const n = parseInt(digitsOnly, 10)
  if (!Number.isFinite(n)) return null
  return Math.min(MAX_APPLICATION_FEE_USD, Math.max(0, n))
}

function getApplicationFeeFromMarketing(propertyName) {
  if (!propertyName) return DEFAULT_APPLICATION_FEE_USD
  const prop = properties.find((p) => p.name === propertyName)
  const parsed = parseApplicationFeeFromMarketing(prop?.applicationFee)
  return parsed === null ? DEFAULT_APPLICATION_FEE_USD : parsed
}

/**
 * Final application fee in USD: optional per-property override from Airtable (via tour API),
 * otherwise marketing copy in `properties.js`.
 */
function getApplicationFeeDollars(propertyName, serverOverrides = {}) {
  if (!propertyName) return DEFAULT_APPLICATION_FEE_USD
  const key = String(propertyName).trim()
  if (serverOverrides && typeof serverOverrides[key] === 'number' && Number.isFinite(serverOverrides[key])) {
    return Math.min(MAX_APPLICATION_FEE_USD, Math.max(0, Math.round(serverOverrides[key] * 100) / 100))
  }
  return getApplicationFeeFromMarketing(propertyName)
}

/**
 * USD charged for the signer application fee (Stripe + submit gate). If the property has no fee
 * (`getApplicationFeeDollars` is 0), returns 0. Otherwise uses `VITE_STRIPE_APPLICATION_FEE_USD` when set,
 * else `DEFAULT_APPLICATION_FEE_USD` — keep in sync with `STRIPE_APPLICATION_FEE_USD` on the server.
 */
function getSignerStripeApplicationFeeUsd(propertyName, serverOverrides) {
  const base = getApplicationFeeDollars(propertyName, serverOverrides)
  if (base <= 0) return 0
  const raw = import.meta.env.VITE_STRIPE_APPLICATION_FEE_USD
  if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0) return Math.min(MAX_APPLICATION_FEE_USD, n)
  }
  return Math.min(MAX_APPLICATION_FEE_USD, DEFAULT_APPLICATION_FEE_USD)
}

// Marketing fallback when API data is unavailable.
const MARKETING_PROPERTY_OPTIONS = properties
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

/** Property must appear in the live tour API list to allow application submission. */
function propertyNameAllowedForApplication(propertyName, livePropertyOptions) {
  const name = String(propertyName || '').trim()
  if (!name) return false
  if (!Array.isArray(livePropertyOptions) || livePropertyOptions.length === 0) return false
  const pool = livePropertyOptions
  return pool.some((p) => p.name === name)
}

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

function validateDriversLicense(value) {
  if (!value) return ''
  const clean = value.trim()
  if (clean.length < 3) return "Enter a valid driver's license or ID number"
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

function generateAxisGroupApplicationId() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''
  for (let i = 0; i < 12; i += 1) s += alphabet[Math.floor(Math.random() * alphabet.length)]
  return `AXISGRP-${s}`
}

/** Normalize pasted group IDs (case/spacing; optional missing prefix). */
function normalizeGroupApplicationId(raw) {
  let s = String(raw || '').trim().toUpperCase().replace(/\s+/g, '')
  if (!s) return ''
  if (s.startsWith('#')) s = s.slice(1).trim()
  if (s.startsWith('AXISGRP-')) return s
  if (/^[A-Z0-9]{8,20}$/.test(s)) return `AXISGRP-${s}`
  return s
}

/**
 * Joining applicants must reference a group created by the first applicant (stored in Additional Notes).
 * @returns {Promise<{ ok: boolean, message?: string }>}
 */
async function verifyGroupApplicationJoin(groupIdRaw) {
  const gid = normalizeGroupApplicationId(groupIdRaw)
  if (!gid || !AIRTABLE_TOKEN) return { ok: false, message: 'Enter a valid Group ID.' }
  if (!/^AXISGRP-[A-Z0-9]{8,20}$/.test(gid)) {
    return { ok: false, message: 'Group ID should look like AXISGRP- plus letters/numbers.' }
  }
  const needleId = `AXIS_GROUP_APP_ID:${gid}`
  const needleRole = 'AXIS_GROUP_ROLE:first'
  const formula = `AND(FIND('${escapeFormulaString(needleId)}', {Additional Notes}), FIND('${escapeFormulaString(needleRole)}', {Additional Notes}))`
  const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(APPLICATIONS_TABLE)}`)
  url.searchParams.set('maxRecords', '5')
  url.searchParams.append('fields[]', 'Additional Notes')
  url.searchParams.set('filterByFormula', formula)
  try {
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } })
    if (!res.ok) return { ok: false, message: 'Could not verify Group ID. Try again or contact leasing.' }
    const data = await res.json()
    if (!data.records?.length) {
      return {
        ok: false,
        message:
          'No matching group found. The first roommate must submit first, then share the Group ID from their confirmation email/screen.',
      }
    }
    return { ok: true }
  } catch {
    return { ok: false, message: 'Could not verify Group ID. Check your connection and try again.' }
  }
}

/** Appends structured household + room-preference lines (managers read Additional Notes). */
function buildAxisApplicationMetaNotes(signer, resolvedGroupApplicationId) {
  const blocks = []
  const userNotes = String(signer.notes || '').trim()

  if (signer.applyAsGroup === 'Yes') {
    const gid = String(resolvedGroupApplicationId || '').trim()
    blocks.push('--- Household group (Axis) ---')
    blocks.push(`Applying as a group: Yes`)
    blocks.push(
      `Group applicant role: ${signer.groupApplicantRole === 'first' ? 'First to apply (primary)' : 'Joining with Group ID'}`,
    )
    if (signer.groupApplicantRole === 'first') {
      blocks.push(`Expected number of people in group: ${String(signer.groupSize || '').trim()}`)
    }
    if (gid) {
      blocks.push(`GROUP ID (share with roommates): ${gid}`)
      blocks.push(`AXIS_GROUP_APP_ID:${gid}`)
      blocks.push(`AXIS_GROUP_ROLE:${signer.groupApplicantRole === 'first' ? 'first' : 'member'}`)
      if (signer.groupApplicantRole === 'first') {
        blocks.push(`AXIS_GROUP_SIZE:${String(signer.groupSize || '').trim()}`)
      }
    }
    blocks.push('--- End household group ---')
    blocks.push('')
  } else {
    blocks.push('Applying as a group: No')
    blocks.push('')
  }

  if (signer.roomChoice2 || signer.roomChoice3) {
    blocks.push('--- Room preferences ---')
    blocks.push(`1st choice: ${signer.roomNumber || '—'}`)
    if (signer.roomChoice2) blocks.push(`2nd choice: ${signer.roomChoice2}`)
    if (signer.roomChoice3) blocks.push(`3rd choice: ${signer.roomChoice3}`)
    blocks.push('--- End room preferences ---')
    blocks.push('')
  }

  if (userNotes) {
    blocks.push('--- Applicant notes ---')
    blocks.push(userNotes)
  }

  return blocks.join('\n').trim()
}

/**
 * When env lists your Airtable field names, duplicate group / room-preference data into those columns.
 * (Otherwise only {@link buildAxisApplicationMetaNotes} is sent — dedicated columns stay empty.)
 * Use a plain text field for the Axis group id; formula columns cannot be written by the API.
 */
function optionalApplicationsTableSignerExtras(signer, resolvedGroupApplicationId) {
  const groupCheckboxField = String(import.meta.env.VITE_AIRTABLE_APPLICATION_GROUP_CHECKBOX_FIELD || '').trim()
  const groupSizeField = String(import.meta.env.VITE_AIRTABLE_APPLICATION_GROUP_SIZE_FIELD || '').trim()
  const axisGroupIdField = String(import.meta.env.VITE_AIRTABLE_APPLICATION_AXIS_GROUP_ID_FIELD || '').trim()
  const roomChoice2Field = String(import.meta.env.VITE_AIRTABLE_APPLICATION_ROOM_CHOICE_2_FIELD || '').trim()
  const roomChoice3Field = String(import.meta.env.VITE_AIRTABLE_APPLICATION_ROOM_CHOICE_3_FIELD || '').trim()

  const out = {}
  if (groupCheckboxField) {
    out[groupCheckboxField] = signer.applyAsGroup === 'Yes'
  }
  if (groupSizeField && signer.applyAsGroup === 'Yes' && signer.groupApplicantRole === 'first') {
    const n = String(signer.groupSize || '').trim()
    if (n) out[groupSizeField] = n
  }
  if (axisGroupIdField && signer.applyAsGroup === 'Yes' && String(resolvedGroupApplicationId || '').trim()) {
    out[axisGroupIdField] = String(resolvedGroupApplicationId).trim()
  }
  if (roomChoice2Field && signer.roomChoice2) out[roomChoice2Field] = signer.roomChoice2
  if (roomChoice3Field && signer.roomChoice3) out[roomChoice3Field] = signer.roomChoice3
  return out
}

function normalizeRoomKey(value) {
  return String(value || '')
    .replace(/^Unit\s+/i, 'Room ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function matchPropertyNameFromParam(propertyParam, livePropertyOptions) {
  const raw = String(propertyParam || '').trim()
  if (!raw) return ''
  const lower = raw.toLowerCase()
  const wantedSlug = slugify(raw)

  // Strip 'axis-' prefix used in Airtable property page slugs (e.g. axis-recXXXXXXXXXXXXXX)
  const withoutAxisPrefix = lower.startsWith('axis-') ? raw.slice(5) : raw

  const exactLiveName = (livePropertyOptions || []).find((p) => String(p.name || '').toLowerCase() === lower)
  if (exactLiveName) return exactLiveName.name

  const exactLiveId = (livePropertyOptions || []).find((p) => {
    const lid = String(p.id || '').toLowerCase()
    return lid === lower || lid === withoutAxisPrefix.toLowerCase()
  })
  if (exactLiveId) return exactLiveId.name

  const byMarketing = properties.find((p) => p.slug === lower || p.name.toLowerCase() === lower)
  if (byMarketing) {
    const liveByMarketingName = (livePropertyOptions || []).find((p) => p.name === byMarketing.name)
    if (liveByMarketingName) return liveByMarketingName.name
  }

  const slugMatch = (livePropertyOptions || []).find((p) => slugify(p.name) === wantedSlug)
  if (slugMatch) return slugMatch.name

  return ''
}

function matchRoomNameFromParam(roomParam, selectedProperty) {
  const raw = String(roomParam || '').trim()
  if (!raw || !selectedProperty?.rooms?.length) return ''
  const wanted = normalizeRoomKey(raw)
  const exact = selectedProperty.rooms.find((room) => normalizeRoomKey(room.name) === wanted)
  if (exact) return exact.name

  const num = raw.match(/\d+/)?.[0]
  if (num) {
    const byNum = selectedProperty.rooms.find((room) => String(room.name || '').replace(/\D/g, '') === num)
    if (byNum) return byNum.name
  }

  return ''
}

function defaultSigner() {
  return {
    propertyName: '',
    propertyAddress: '',
    roomNumber: '',
    roomChoice2: '',
    roomChoice3: '',
    applyAsGroup: '',
    groupApplicantRole: '',
    groupSize: '',
    groupIdInput: '',
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
          <svg className="h-3.5 w-3.5 text-axis" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 8l3 3 7-7"/></svg>
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

function Field({ label, required, hint, error, children, reserveHintSpace = false }) {
  return (
    <div {...(error ? { 'data-field-error': '1' } : {})}>
      <label className="mb-1.5 block text-sm font-semibold text-slate-800">
        {label}
        {required && <span className="ml-1 text-axis">*</span>}
      </label>
      {(hint || reserveHintSpace) && (
        <p className={`mb-1.5 min-h-[1.5rem] text-xs leading-5 ${hint ? 'text-slate-400' : 'invisible'}`}>
          {hint || 'placeholder'}
        </p>
      )}
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

async function submitApplicationRecord(tableName, fields) {
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
    const pe = errorFromAirtableApiBody(response.url, body)
    if (pe) throw pe
    let message = `Application service error ${response.status}`
    try {
      message += `: ${JSON.parse(body)?.error?.message}`
    } catch {
      message += `: ${body}`
    }
    throw new Error(message)
  }

  return response.json()
}

async function registerApplicationPaymentDraft({ email, fullName, propertyName, roomNumber }) {
  const res = await fetch('/api/portal?action=application-register-payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, fullName, propertyName, roomNumber }),
  })
  const data = await readJsonResponse(res)
  if (!res.ok) {
    throw new Error(data.error || 'Could not reserve your application. Try again or contact leasing.')
  }
  return data
}

async function syncApplicationStripeSession(applicationRecordId, sessionId) {
  if (!applicationRecordId?.startsWith('rec') || !sessionId?.startsWith('cs_')) return
  try {
    await fetch('/api/portal?action=application-stripe-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ applicationRecordId, sessionId }),
    })
  } catch {
    /* non-fatal — polling / webhook may still update Airtable */
  }
}

/** Poll until Airtable shows paid or already submitted (webhook or sync). */
async function pollApplicationPaid(applicationRecordId, { maxAttempts = 55, intervalMs = 900, sessionId } = {}) {
  if (sessionId) await syncApplicationStripeSession(applicationRecordId, sessionId)
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const r = await fetch(
        `/api/portal?action=application-payment-status&applicationRecordId=${encodeURIComponent(applicationRecordId)}`,
      )
      const data = await readJsonResponse(r)
      if (r.ok && (data.paid || data.submitted)) return true
    } catch {
      /* keep polling — transient API / deploy issues */
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return false
}

async function submitSignerApplicationThroughPortal({ applicationRecordId, fields, promoWaive, promoCode }) {
  const res = await fetch('/api/portal?action=application-submit-signer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      applicationRecordId,
      fields,
      promoWaive: Boolean(promoWaive),
      promoCode: promoCode || '',
    }),
  })
  const data = await readJsonResponse(res)
  if (!res.ok) {
    throw new Error(data.error || `Application save failed (${res.status}).`)
  }
  return data
}

async function checkDuplicateApplication(email) {
  if (!AIRTABLE_TOKEN || !email) return false
  const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(APPLICATIONS_TABLE)}`)
  url.searchParams.set('maxRecords', '1')
  // Ignore unpaid drafts (payment row created before Stripe); only block completed applications.
  url.searchParams.set(
    'filterByFormula',
    `AND({Signer Email} = '${escapeFormulaString(email)}', {Signer Signature} != '')`,
  )
  try {
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } })
    if (!res.ok) return false
    const data = await res.json()
    return (data.records?.length ?? 0) > 0
  } catch {
    return false
  }
}

function rangesOverlap(startA, endA, startB, endB) {
  const aStart = new Date(startA)
  const bStart = new Date(startB)
  if (Number.isNaN(aStart.getTime()) || Number.isNaN(bStart.getTime())) return false

  const aEnd = endA ? new Date(endA) : null
  const bEnd = endB ? new Date(endB) : null
  const aEndTime = aEnd && !Number.isNaN(aEnd.getTime()) ? aEnd.getTime() : Number.POSITIVE_INFINITY
  const bEndTime = bEnd && !Number.isNaN(bEnd.getTime()) ? bEnd.getTime() : Number.POSITIVE_INFINITY

  return aStart.getTime() <= bEndTime && bStart.getTime() <= aEndTime
}

async function checkRoomConflict(propertyName, roomNumber, leaseStartDate, leaseEndDate) {
  if (!AIRTABLE_TOKEN || !propertyName || !roomNumber || !leaseStartDate) return false
  const formula = `AND({Property Name} = '${escapeFormulaString(propertyName)}', {Room Number} = '${escapeFormulaString(roomNumber)}')`
  const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(APPLICATIONS_TABLE)}`)
  url.searchParams.set('maxRecords', '100')
  url.searchParams.append('fields[]', 'Lease Start Date')
  url.searchParams.append('fields[]', 'Lease End Date')
  url.searchParams.set('filterByFormula', formula)
  try {
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` } })
    if (!res.ok) return false
    const data = await res.json()
    return (data.records || []).some((record) =>
      rangesOverlap(
        leaseStartDate,
        leaseEndDate,
        record.fields?.['Lease Start Date'],
        record.fields?.['Lease End Date'],
      )
    )
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
      const pe = errorFromAirtableApiBody(response.url, body)
      if (pe) throw pe
      let message = `Application lookup error ${response.status}`
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
    const pe = errorFromAirtableApiBody(response.url, body)
    if (pe) throw pe
    let message = `Application lookup error ${response.status}`
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

function formatApplicationId(recordOrId) {
  const rawId = typeof recordOrId === 'string'
    ? recordOrId
    : recordOrId?.id || ''
  const normalized = String(rawId || '').trim().replace(/^APP-/, '')
  if (!normalized) return ''
  return normalized.startsWith('rec') ? `APP-${normalized}` : normalized
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
  const lines = (type === 'signer'
    ? [
        `Submission Type: Signer`,
        `Property Name: ${signer.propertyName}`,
        `Property Address Applying For: ${signer.propertyAddress || 'Not provided'}`,
        `Room Number (1st choice): ${signer.roomNumber || 'Not specified'}`,
        signer.roomChoice2 ? `Room 2nd choice: ${signer.roomChoice2}` : null,
        signer.roomChoice3 ? `Room 3rd choice: ${signer.roomChoice3}` : null,
        signer.applyAsGroup === 'Yes'
          ? `Group application: Yes — role ${signer.groupApplicantRole || '?'}${signer.groupSize ? ` — size ${signer.groupSize}` : ''}${signer.groupIdInput ? ` — group id input ${signer.groupIdInput}` : ''}`
          : 'Group application: No',
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
  ).filter(Boolean)

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
    title: 'Group application',
    validate: (s) => {
      const e = {}
      if (!s.applyAsGroup) e.applyAsGroup = 'Please select Yes or No'
      if (s.applyAsGroup === 'Yes') {
        if (!s.groupApplicantRole) e.groupApplicantRole = 'Choose whether you are the first person to apply or joining later'
        if (s.groupApplicantRole === 'first') {
          const n = parseInt(String(s.groupSize || '').trim(), 10)
          if (!Number.isFinite(n) || n < 2 || n > 30) e.groupSize = 'Enter how many people are applying together (2–30)'
        }
        if (s.groupApplicantRole === 'member') {
          if (!String(s.groupIdInput || '').trim()) {
            e.groupIdInput = 'Paste the Group ID the first applicant received after submitting'
          } else {
            const norm = normalizeGroupApplicationId(s.groupIdInput)
            if (!/^AXISGRP-[A-Z0-9]{8,20}$/.test(norm)) {
              e.groupIdInput = 'Use the full Group ID (starts with AXISGRP-) from the first applicant'
            }
          }
        }
      }
      return e
    },
  },
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
      const isMonthToMonth = s.leaseTerm === 'Month-to-Month (+$25/mo)'
      if (!s.propertyName) e.propertyName = 'Select a property'
      if (!s.roomNumber) e.roomNumber = 'Select your first-choice room'
      if (s.roomChoice2 && s.roomChoice2 === s.roomNumber) e.roomChoice2 = 'Must be different from your first choice'
      if (s.roomChoice3) {
        if (!s.roomChoice2) e.roomChoice3 = 'Select a second choice before a third'
        else if (s.roomChoice3 === s.roomNumber || s.roomChoice3 === s.roomChoice2) {
          e.roomChoice3 = 'Third choice must differ from first and second'
        }
      }
      if (!s.leaseStartDate) e.leaseStartDate = 'Lease start date is required'
      if (!isMonthToMonth && !s.leaseEndDate) e.leaseEndDate = 'Lease end date is required'
      if (s.leaseStartDate && s.leaseEndDate && new Date(s.leaseEndDate) <= new Date(s.leaseStartDate)) {
        e.leaseEndDate = 'Must be after lease start date'
      }
      if (s.leaseStartDate) {
        const today = new Date(); today.setHours(0,0,0,0)
        if (new Date(s.leaseStartDate) < today) e.leaseStartDate = 'Cannot be in the past'
      }
      if (s.propertyName && s.roomNumber && s.leaseStartDate) {
        const prop = MARKETING_PROPERTY_OPTIONS.find((p) => p.name === s.propertyName)
        const room = prop?.rooms.find((r) => r.name === s.roomNumber)
        if (room && !isRoomAvailableForRange(room.available, s.leaseStartDate, isMonthToMonth ? null : s.leaseEndDate)) {
          e[isMonthToMonth ? 'leaseStartDate' : 'leaseEndDate'] = `Room ${s.roomNumber} is not available for these dates — ${getRoomAvailabilityLabel(room.available)}`
        }
      }
      return e
    },
  },
  {
    title: 'Signer Information',
    validate: (s) => {
      const e = {}
      if (!s.fullName?.trim()) e.fullName = 'Full name is required'
      else {
        const name = validateFullName(s.fullName)
        if (name) e.fullName = name
      }
      const dob = validateDOB(s.dateOfBirth, { requireAdult: s.hasCosigner !== 'Yes' }); if (dob) e.dateOfBirth = dob
      if (!s.phone?.trim()) e.phone = 'Phone number is required'
      else {
        const phone = validatePhone(s.phone)
        if (phone) e.phone = phone
      }
      if (!s.email?.trim()) e.email = 'Email is required'
      else {
        const email = validateEmail(s.email)
        if (email) e.email = email
      }
      if (!s.ssn?.trim()) e.ssn = 'Social Security number is required'
      else {
        const v = validateSSN(s.ssn)
        if (v) e.ssn = v
      }
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
      if (!s.currentReasonForLeaving?.trim()) e.currentReasonForLeaving = 'Reason for leaving is required'
      return e
    },
  },
  {
    title: 'Previous Address',
    validate: (s) => {
      const e = {}
      if (s.skipPreviousAddress) return e
      const addr = validateStreetAddress(s.previousAddress); if (addr) e.previousAddress = addr
      if (!s.previousCity?.trim()) e.previousCity = 'City is required'
      if (!s.previousMoveInDate) e.previousMoveInDate = 'Move-in date is required'
      if (!s.previousMoveOutDate) e.previousMoveOutDate = 'Move-out date is required'
      if (s.previousMoveInDate && s.previousMoveOutDate && new Date(s.previousMoveOutDate) <= new Date(s.previousMoveInDate)) {
        e.previousMoveOutDate = 'Move-out must be after move-in'
      }
      if (!s.previousState?.trim()) e.previousState = 'State is required'
      else if (s.previousState) { const v = validateState(s.previousState); if (v) e.previousState = v }
      if (!s.previousZip?.trim()) e.previousZip = 'ZIP is required'
      else if (s.previousZip) { const v = validateZip(s.previousZip); if (v) e.previousZip = v }
      if (s.previousLandlordPhone) { const v = validatePhone(s.previousLandlordPhone); if (v) e.previousLandlordPhone = v }
      if (!s.previousReasonForLeaving?.trim()) e.previousReasonForLeaving = 'Reason for leaving is required'
      return e
    },
  },
  {
    title: 'Employment & Income',
    validate: (s) => {
      const e = {}
      if (!s.noEmployment) {
        if (!s.employer?.trim()) e.employer = 'Employer name is required'
        if (!s.employerAddress?.trim()) e.employerAddress = 'Employer address is required'
        if (!s.jobTitle?.trim()) e.jobTitle = 'Job title is required'
        if (!s.monthlyIncome) e.monthlyIncome = 'Monthly income is required'
        else { const v = validateIncome(s.monthlyIncome); if (v) e.monthlyIncome = v }
        if (!s.annualIncome) e.annualIncome = 'Annual income is required'
        else { const v = validateIncome(s.annualIncome); if (v) e.annualIncome = v }
        if (!s.employmentStartDate) e.employmentStartDate = 'Start date is required'
        if (!s.supervisorName?.trim()) e.supervisorName = 'Supervisor name is required'
        if (!s.supervisorPhone?.trim()) e.supervisorPhone = 'Supervisor phone is required'
        else { const v = validatePhone(s.supervisorPhone); if (v) e.supervisorPhone = v }
      }
      return e
    },
  },
  {
    title: 'References',
    validate: (s) => {
      const e = {}
      if (!s.reference1Name?.trim()) e.reference1Name = 'Name is required'
      if (!s.reference1Relationship?.trim()) e.reference1Relationship = 'Relationship is required'
      if (!s.reference1Phone?.trim()) e.reference1Phone = 'Phone is required'
      else { const v = validatePhone(s.reference1Phone); if (v) e.reference1Phone = v }
      if (!s.reference2Name?.trim()) e.reference2Name = 'Name is required'
      if (!s.reference2Relationship?.trim()) e.reference2Relationship = 'Relationship is required'
      if (!s.reference2Phone?.trim()) e.reference2Phone = 'Phone is required'
      else { const v = validatePhone(s.reference2Phone); if (v) e.reference2Phone = v }
      return e
    },
  },
  { title: 'Additional Information', validate: (s) => {
    const e = {}
    if (!s.occupants) e.occupants = 'Number of occupants is required'
    return e
  }},
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
  { title: 'Link to Signer', validate: (c) => {
    const e = {}
    if (!c.linkedApplicationId?.trim() && !c.linkedSignerName?.trim()) {
      e.linkedApplicationId = "Please enter the signer's Application ID or their full name"
    }
    return e
  }},
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
      if (!c.city?.trim()) e.city = 'City is required'
      if (!c.state?.trim()) e.state = 'State is required'
      else { const v = validateState(c.state); if (v) e.state = v }
      if (!c.zip?.trim()) e.zip = 'ZIP is required'
      else { const v = validateZip(c.zip); if (v) e.zip = v }
      return e
    },
  },
  {
    title: 'Employment & Income',
    validate: (c) => {
      const e = {}
      if (!c.noEmployment) {
        if (!c.employer?.trim()) e.employer = 'Employer name is required'
        if (!c.employerAddress?.trim()) e.employerAddress = 'Employer address is required'
        if (!c.jobTitle?.trim()) e.jobTitle = 'Job title is required'
        if (!c.monthlyIncome) e.monthlyIncome = 'Monthly income is required'
        else { const v = validateIncome(c.monthlyIncome); if (v) e.monthlyIncome = v }
        if (!c.annualIncome) e.annualIncome = 'Annual income is required'
        else { const v = validateIncome(c.annualIncome); if (v) e.annualIncome = v }
        if (!c.employmentStartDate) e.employmentStartDate = 'Start date is required'
        if (!c.supervisorName?.trim()) e.supervisorName = 'Supervisor name is required'
        if (!c.supervisorPhone?.trim()) e.supervisorPhone = 'Supervisor phone is required'
        else { const v = validatePhone(c.supervisorPhone); if (v) e.supervisorPhone = v }
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
  const storedSubmission = typeof window !== 'undefined'
    ? JSON.parse(window.sessionStorage.getItem(APPLICATION_SUBMISSION_STORAGE_KEY) || 'null')
    : null
  const storedDraft = typeof window !== 'undefined' && !storedSubmission
    ? JSON.parse(window.localStorage.getItem(APPLICATION_DRAFT_STORAGE_KEY) || 'null')
    : null
  const [applicationType, setApplicationType] = useState(storedDraft?.applicationType || '')
  const [step, setStep] = useState(storedDraft?.step || 0)
  const [signer, setSigner] = useState(storedDraft?.signer || defaultSigner())
  const [cosigner, setCosigner] = useState(storedDraft?.cosigner || defaultCosigner())
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(Boolean(storedSubmission))
  const [submittedRecord, setSubmittedRecord] = useState(storedSubmission?.submittedRecord || null)
  const [submissionSummary, setSubmissionSummary] = useState(storedSubmission)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [roomConflictWarning, setRoomConflictWarning] = useState(false)
  const [roomConflictAcknowledged, setRoomConflictAcknowledged] = useState(false)
  const [groupVerifyBusy, setGroupVerifyBusy] = useState(false)
  // Lease signing flow
  const [signedLeases, setSignedLeases] = useState(new Set())
  const [leaseStep, setLeaseStep] = useState(storedSubmission?.leaseStep || 'account')
  const [leaseSigned, setLeaseSigned] = useState(storedSubmission?.leaseSigned || false)
  const [moveInPaid, setMoveInPaid] = useState(storedSubmission?.moveInPaid || false)
  const [leaseSignatureInput, setLeaseSignatureInput] = useState('')
  const [leaseSigningLoading, setLeaseSigningLoading] = useState(false)
  const [leaseSigningError, setLeaseSigningError] = useState('')
  const [moveInPaymentLoading, setMoveInPaymentLoading] = useState(false)
  const [moveInPaymentError, setMoveInPaymentError] = useState('')
  // Application fee / promo
  const [appFeePaid, setAppFeePaid] = useState(storedSubmission?.appFeePaid || false)
  const [promoInput, setPromoInput] = useState(storedDraft?.promoInput || '')
  const [promoApplied, setPromoApplied] = useState(storedSubmission?.promoApplied || false)
  const [promoError, setPromoError] = useState('')
  // Pre-submission payment (fee paid before the application record is saved)
  const [prePaymentLoading, setPrePaymentLoading] = useState(false)
  const [prePaymentError, setPrePaymentError] = useState('')
  /** After Stripe embedded completes: server sync + poll before final PATCH. */
  const [feeConfirmBusy, setFeeConfirmBusy] = useState(false)
  const [embeddedCheckout, setEmbeddedCheckout] = useState(null)
  /** After Stripe return_url to fee_prepaid: wait for property list, then auto-submit. */
  const [deferFeePrepaidAutoSubmit, setDeferFeePrepaidAutoSubmit] = useState(false)
  const queryPrefillAppliedRef = useRef(false)

  const steps = applicationType === 'cosigner' ? COSIGNER_STEPS : SIGNER_STEPS
  const paymentStatus = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('payment') : ''
  const totalSteps = steps.length
  const isLastStep = step === totalSteps - 1

  const [propertyOptions, setPropertyOptions] = useState([])

  const selectedProperty = useMemo(
    () => propertyOptions.find((property) => property.name === signer.propertyName),
    [signer.propertyName, propertyOptions],
  )

  /** Property Name → Application Fee (USD) from Airtable Properties, when returned by tour API */
  const [applicationFeeOverrides, setApplicationFeeOverrides] = useState({})

  /** Reconcile fee state after refresh (webhook may have updated Airtable). */
  useEffect(() => {
    if (typeof window === 'undefined' || submitted || applicationType !== 'signer') return
    const recId = String(window.sessionStorage.getItem(APPLICATION_RECORD_ID_KEY) || '').trim()
    if (!recId.startsWith('rec')) return
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch(
          `/api/portal?action=application-payment-status&applicationRecordId=${encodeURIComponent(recId)}`,
        )
        const data = await readJsonResponse(r)
        if (cancelled || !r.ok) return
        if (data.paid) setAppFeePaid(true)
        if (data.submitted) {
          setPrePaymentError(
            'This application is already on file as submitted. Check your email for confirmation or contact Axis leasing with your Application record ID.',
          )
        }
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [submitted, applicationType])

  useEffect(() => {
    let cancelled = false
    fetch('/api/forms?action=tour')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || !Array.isArray(data?.properties)) return
        const liveOptions = data.properties
          .map((property) => {
            const name = String(property?.name || '').trim()
            if (!name) return null
            const rooms = Array.isArray(property?.rooms)
              ? property.rooms
                .map((room) => {
                  if (room == null) return ''
                  if (typeof room === 'object' && room !== null && 'name' in room) {
                    return String(room.name || '').trim()
                  }
                  return String(room || '').trim()
                })
                .filter(Boolean)
                .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
                .map((roomName) => ({ name: roomName, available: 'Available now' }))
              : []
            return {
              id: String(property?.id || name),
              name,
              address: String(property?.address || '').trim(),
              rooms,
            }
          })
          .filter(Boolean)
          .sort((a, b) => a.name.localeCompare(b.name))
        setPropertyOptions(liveOptions)

        const map = {}
        for (const p of data.properties) {
          const name = String(p?.name || '').trim()
          if (!name) continue
          const v = p.applicationFee
          if (typeof v === 'number' && Number.isFinite(v)) {
            map[name] = Math.min(MAX_APPLICATION_FEE_USD, Math.max(0, Math.round(v * 100) / 100))
          }
        }
        setApplicationFeeOverrides(map)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (queryPrefillAppliedRef.current) return
    if (applicationType !== 'signer') return
    if (!propertyOptions.length) return
    if (signer.propertyName || signer.roomNumber) {
      queryPrefillAppliedRef.current = true
      return
    }

    const params = new URLSearchParams(window.location.search)
    const propertyParam = params.get('property') || ''
    const roomParam = params.get('room') || ''
    if (!propertyParam && !roomParam) {
      queryPrefillAppliedRef.current = true
      return
    }

    const matchedPropertyName = matchPropertyNameFromParam(propertyParam, propertyOptions)
    if (!matchedPropertyName) {
      queryPrefillAppliedRef.current = true
      return
    }

    const selected = propertyOptions.find((p) => p.name === matchedPropertyName)
    const matchedRoomName = matchRoomNameFromParam(roomParam, selected)
    setSigner((prev) => ({
      ...prev,
      propertyName: matchedPropertyName,
      propertyAddress: selected?.address || '',
      roomNumber: matchedRoomName || '',
    }))
    queryPrefillAppliedRef.current = true
  }, [applicationType, propertyOptions, signer.propertyName, signer.roomNumber])

  const signerApplicationFeeUsd = useMemo(
    () => getSignerStripeApplicationFeeUsd(signer.propertyName, applicationFeeOverrides),
    [signer.propertyName, applicationFeeOverrides],
  )

  // Fetch currently active signed leases to show dynamic room occupancy
  useEffect(() => {
    async function fetchSignedLeases() {
      try {
        const leases = await getSignedLeases()
        const occupied = new Set(leases.map((l) => `${l.propertyName}:${l.roomNumber}`))
        setSignedLeases(occupied)
      } catch (e) {
        console.warn('Could not fetch signed leases:', e.message)
      }
    }
    fetchSignedLeases()
  }, [])

  // Persist lease/fee state back to sessionStorage so they survive page refresh
  useEffect(() => {
    if (!submitted || !submissionSummary) return
    const updated = { ...submissionSummary, leaseStep, leaseSigned, moveInPaid, appFeePaid, promoApplied }
    window.sessionStorage.setItem(APPLICATION_SUBMISSION_STORAGE_KEY, JSON.stringify(updated))
  }, [leaseStep, leaseSigned, moveInPaid, appFeePaid, promoApplied, submitted, submissionSummary])

  useEffect(() => {
    if (typeof window === 'undefined' || submitted) return
    const draft = {
      applicationType,
      step,
      signer,
      cosigner,
      promoInput,
    }
    window.localStorage.setItem(APPLICATION_DRAFT_STORAGE_KEY, JSON.stringify(draft))
  }, [applicationType, step, signer, cosigner, promoInput, submitted])

  // Detect app fee payment success on return from Stripe (post-submission flow)
  useEffect(() => {
    if (paymentStatus === 'fee_success' && !appFeePaid) {
      setAppFeePaid(true)
    }
  }, [paymentStatus, appFeePaid])

  useEffect(() => {
    if (paymentStatus === 'success' && !moveInPaid) {
      setMoveInPaid(true)
      setLeaseStep('lease')
    }
  }, [paymentStatus, moveInPaid])

  // Restore form state after Stripe embedded return_url (?payment=fee_prepaid&session_id=…)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const status = params.get('payment')
    if (status !== 'fee_prepaid') return
    const stripeSessionId = String(params.get('session_id') || '').trim()
    const pending = typeof window !== 'undefined'
      ? JSON.parse(window.sessionStorage.getItem(PRE_SUBMIT_KEY) || 'null')
      : null
    if (!pending || submitted) return
    if (stripeSessionId.startsWith('cs_')) {
      try {
        window.sessionStorage.setItem(APPLICATION_FEE_CHECKOUT_SESSION_KEY, stripeSessionId)
      } catch {
        /* ignore */
      }
    }
    window.sessionStorage.removeItem(PRE_SUBMIT_KEY)
    window.history.replaceState({}, '', '/apply')
    setSigner(pending.signer)
    setApplicationType(pending.applicationType || 'signer')
    setStep(typeof pending.step === 'number' ? pending.step : 0)
    setDeferFeePrepaidAutoSubmit(true)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // After return from Stripe (return_url), wait for Airtable "Application Paid" from webhook, then submit.
  useEffect(() => {
    if (!deferFeePrepaidAutoSubmit || submitted || submitting) return
    if (!Array.isArray(propertyOptions) || propertyOptions.length === 0) return
    setDeferFeePrepaidAutoSubmit(false)
    const stripeSessionId =
      typeof window !== 'undefined'
        ? String(window.sessionStorage.getItem(APPLICATION_FEE_CHECKOUT_SESSION_KEY) || '').trim()
        : ''
    ;(async () => {
      const recId =
        typeof window !== 'undefined'
          ? String(window.sessionStorage.getItem(APPLICATION_RECORD_ID_KEY) || '').trim()
          : ''
      if (!recId.startsWith('rec')) {
        setPrePaymentError(
          'Payment completed but we could not find your application reservation. Close this message and use Submit, or contact leasing.',
        )
        return
      }
      setFeeConfirmBusy(true)
      try {
        const paid = await pollApplicationPaid(recId, {
          sessionId: stripeSessionId.startsWith('cs_') ? stripeSessionId : undefined,
        })
        if (!paid) {
          setPrePaymentError(
            'Stripe is still confirming your payment. Wait a minute, refresh the page, then tap Submit — you will not be charged twice.',
          )
          return
        }
        setAppFeePaid(true)
        await handleSubmit({ preventDefault: () => {} }, { applicationRecordId: recId })
      } finally {
        try {
          window.sessionStorage.removeItem(APPLICATION_FEE_CHECKOUT_SESSION_KEY)
        } catch {
          /* ignore */
        }
        setFeeConfirmBusy(false)
      }
    })()
  }, [deferFeePrepaidAutoSubmit, propertyOptions, submitted, submitting]) // eslint-disable-line react-hooks/exhaustive-deps

  function updateSigner(key, value) {
    setSigner((prev) => {
      const next = { ...prev, [key]: value }
      if (key === 'propertyName') {
        next.roomNumber = ''
        next.roomChoice2 = ''
        next.roomChoice3 = ''
        next.propertyAddress = propertyOptions.find((property) => property.name === value)?.address || ''
        setRoomConflictWarning(false)
        setRoomConflictAcknowledged(false)
      }
      if (['propertyName', 'roomNumber', 'roomChoice2', 'roomChoice3', 'leaseStartDate', 'leaseEndDate', 'leaseTerm'].includes(key)) {
        setRoomConflictWarning(false)
        setRoomConflictAcknowledged(false)
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

  async function handleNext() {
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

    if (applicationType === 'signer' && step === 0 && signer.applyAsGroup === 'Yes' && signer.groupApplicantRole === 'member') {
      setGroupVerifyBusy(true)
      setFieldErrors({})
      try {
        const res = await verifyGroupApplicationJoin(signer.groupIdInput)
        if (!res.ok) {
          setFieldErrors({ groupIdInput: res.message || 'Could not verify Group ID.' })
          setTimeout(() => {
            const el = document.querySelector('[data-field-error]')
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }, 50)
          return
        }
      } finally {
        setGroupVerifyBusy(false)
      }
    }

    if (applicationType === 'signer' && step === 2) {
      const isMonthToMonth = signer.leaseTerm === 'Month-to-Month (+$25/mo)'
      const hasDatesForConflictCheck = Boolean(signer.leaseStartDate && (isMonthToMonth || signer.leaseEndDate))
      if (signer.propertyName && signer.roomNumber && hasDatesForConflictCheck) {
        const hasConflict = await checkRoomConflict(
          signer.propertyName,
          signer.roomNumber,
          signer.leaseStartDate,
          isMonthToMonth ? '' : signer.leaseEndDate,
        )
        setRoomConflictWarning(hasConflict)
        if (hasConflict && !roomConflictAcknowledged) {
          setRoomConflictAcknowledged(true)
          return
        }
      } else {
        setRoomConflictWarning(false)
        setRoomConflictAcknowledged(false)
      }
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

  async function handleSubmit(event, options = {}) {
    event.preventDefault()
    const { promoOverride = false, applicationRecordId: applicationRecordIdFromOptions = '' } = options
    // Final step validation before submit
    const current = steps[step]
    const data = applicationType === 'cosigner' ? cosigner : signer
    const errs = current.validate(data)
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs)
      return false
    }
    setSubmitting(true)
    setError('')
    setFieldErrors({})

    try {
      let savedRecord = null
      let resolvedGroupApplicationId = ''
      if (applicationType === 'signer') {
        const feeDueUsd = getSignerStripeApplicationFeeUsd(signer.propertyName, applicationFeeOverrides)
        const needsPaidStripe = feeDueUsd > 0 && !(promoApplied || promoOverride)

        let applicationRecordId = String(applicationRecordIdFromOptions || '').trim()
        if (typeof window !== 'undefined' && !applicationRecordId) {
          applicationRecordId = String(window.sessionStorage.getItem(APPLICATION_RECORD_ID_KEY) || '').trim()
        }

        if (needsPaidStripe && !applicationRecordId.startsWith('rec')) {
          throw new Error('Pay the application fee first using the Pay button at the bottom of this step.')
        }

        if (needsPaidStripe && applicationRecordId.startsWith('rec')) {
          let stPaid = appFeePaid
          let stSubmitted = false
          try {
            const stRes = await fetch(
              `/api/portal?action=application-payment-status&applicationRecordId=${encodeURIComponent(applicationRecordId)}`,
            )
            const stData = await readJsonResponse(stRes)
            if (stRes.ok) {
              stPaid = Boolean(stData.paid)
              stSubmitted = Boolean(stData.submitted)
            }
          } catch {
            /* ignore */
          }
          if (stSubmitted) {
            throw new Error(
              'This application is already submitted. Refresh the page to see your confirmation, or contact Axis leasing.',
            )
          }
          if (!stPaid) {
            const polled = await pollApplicationPaid(applicationRecordId, { maxAttempts: 28, intervalMs: 800 })
            if (!polled) {
              throw new Error(
                'Payment is still processing. Wait a few seconds and tap Submit again — you will not be charged twice. If this persists, contact leasing.',
              )
            }
          }
          setAppFeePaid(true)
        }

        if (!needsPaidStripe && !applicationRecordId.startsWith('rec')) {
          const reg = await registerApplicationPaymentDraft({
            email: signer.email,
            fullName: signer.fullName,
            propertyName: signer.propertyName,
            roomNumber: signer.roomNumber,
          })
          applicationRecordId = reg.applicationRecordId
          try {
            window.sessionStorage.setItem(APPLICATION_RECORD_ID_KEY, applicationRecordId)
          } catch {
            /* ignore */
          }
        }

        if (!signer.consent) {
          throw new Error('The signer must consent to the credit and background check before submitting.')
        }

        if (!Array.isArray(propertyOptions) || propertyOptions.length === 0) {
          throw new Error('Live property availability could not be verified. Refresh and try again, or contact Axis leasing.')
        }

        if (!propertyNameAllowedForApplication(signer.propertyName, propertyOptions)) {
          throw new Error(
            'This property is not accepting online applications (it may be unlisted). Choose a home from the list or contact Axis.',
          )
        }

        const isDuplicate = await checkDuplicateApplication(signer.email)
        if (isDuplicate) {
          throw new Error(`An application has already been submitted with the email address "${signer.email}". If you believe this is an error, please contact leasing directly.`)
        }

        if (signer.applyAsGroup === 'Yes') {
          if (signer.groupApplicantRole === 'first') {
            resolvedGroupApplicationId = generateAxisGroupApplicationId()
          } else if (signer.groupApplicantRole === 'member') {
            resolvedGroupApplicationId = normalizeGroupApplicationId(signer.groupIdInput)
          }
        }
        const additionalNotesPayload = buildAxisApplicationMetaNotes(signer, resolvedGroupApplicationId)

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
          'Month to Month': signer.leaseTerm === 'Month-to-Month (+$25/mo)',
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
          // Background
          'Eviction History': signer.evictionHistory,
          'Signer Bankruptcy History': signer.bankruptcyHistory,
          'Signer Criminal History': signer.criminalHistory,
          'Has Co-Signer': signer.hasCosigner,
          // Signature
          'Signer Consent for Credit and Background Check': signer.consent,
          'Signer Signature': signer.signature,
          'Signer Date Signed': signer.dateSigned,
          'Additional Notes': additionalNotesPayload,
          ...optionalApplicationsTableSignerExtras(signer, resolvedGroupApplicationId),
        }

        const savedRow = await submitSignerApplicationThroughPortal({
          applicationRecordId,
          fields,
          promoWaive: promoApplied || promoOverride,
          promoCode: promoApplied || promoOverride ? 'FEEWAIVE' : '',
        })
        savedRecord = { id: savedRow.id, fields: savedRow.fields }
        setSubmittedRecord(savedRecord)
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

        await submitApplicationRecord(COSIGNERS_TABLE, fields)
      } else {
        throw new Error('Choose whether this is a signer application or a co-signer form.')
      }

      const summary = applicationType === 'signer'
        ? {
            applicationType,
            firstName: signer.fullName.split(' ')[0],
            email: signer.email,
            propertyName: signer.propertyName,
            roomNumber: signer.roomNumber,
            hasCosigner: signer.hasCosigner,
            applyAsGroup: signer.applyAsGroup,
            groupApplicantRole: signer.groupApplicantRole || '',
            groupApplicationId: signer.applyAsGroup === 'Yes' ? resolvedGroupApplicationId : '',
            appId: formatApplicationId(savedRecord),
            submittedRecord: savedRecord || null,
            roomPrice: getRoomMonthlyRent(signer.propertyName, signer.roomNumber),
            leaseTerm: signer.leaseTerm,
            leaseStep: 'account',
            leaseSigned: false,
            moveInPaid: false,
            appFeePaid: true,
            promoApplied: promoApplied || promoOverride,
          }
        : {
            applicationType,
            firstName: cosigner.fullName.split(' ')[0],
            email: cosigner.email,
            appId: '',
            submittedRecord: null,
            leaseStep: 'account',
            leaseSigned: false,
            moveInPaid: false,
          }

      setSubmissionSummary(summary)
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(APPLICATION_SUBMISSION_STORAGE_KEY, JSON.stringify(summary))
        window.localStorage.removeItem(APPLICATION_DRAFT_STORAGE_KEY)
      }
      if (applicationType === 'signer' && savedRecord?.id) {
        void fetch('/api/portal?action=application-create-lease-draft', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ applicationRecordId: savedRecord.id }),
        }).catch((e) => console.warn('[apply] lease draft queue failed:', e))
      }
      setSubmitted(true)
      try {
        window.sessionStorage.removeItem(PRE_SUBMIT_KEY)
        window.sessionStorage.removeItem(APPLICATION_RECORD_ID_KEY)
      } catch {
        /* ignore */
      }
      return true
    } catch (submissionError) {
      console.error('Application submission failed:', submissionError)
      setError(submissionError.message || 'Submission failed.')
      return false
    } finally {
      setSubmitting(false)
    }
  }

  async function handlePrePaymentCheckout() {
    // Validate the current (last) step before redirecting to Stripe
    const current = steps[step]
    const errs = current.validate(signer)
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs)
      return
    }
    const amount = getSignerStripeApplicationFeeUsd(signer.propertyName, applicationFeeOverrides)
    if (amount <= 0) {
      setPrePaymentLoading(false)
      return
    }

    setPrePaymentLoading(true)
    setPrePaymentError('')
    let applicationRecordId = ''
    try {
      const reg = await registerApplicationPaymentDraft({
        email: signer.email,
        fullName: signer.fullName,
        propertyName: signer.propertyName,
        roomNumber: signer.roomNumber,
      })
      applicationRecordId = reg.applicationRecordId
      try {
        window.sessionStorage.setItem(APPLICATION_RECORD_ID_KEY, applicationRecordId)
      } catch {
        /* ignore */
      }
      if (reg.alreadyPaid) {
        setAppFeePaid(true)
        setPrePaymentLoading(false)
        setPrePaymentError('')
        return
      }
    } catch (e) {
      setPrePaymentLoading(false)
      setPrePaymentError(e.message || 'Could not start payment.')
      return
    }
    try {
      window.sessionStorage.setItem(
        PRE_SUBMIT_KEY,
        JSON.stringify({
          signer,
          applicationType: 'signer',
          step,
        }),
      )
    } catch (e) {
      console.warn('[apply] could not stash form for post-payment return:', e)
    }
    setEmbeddedCheckout({
      flow: 'application_fee',
      title: 'Application Fee',
      request: {
        residentName: signer.fullName,
        residentEmail: signer.email,
        propertyName: signer.propertyName,
        unitNumber: signer.roomNumber,
        amount,
        description: `Application fee — ${signer.propertyName || 'Axis housing'}`,
        category: 'application_fee',
        applicationRecordId,
        successPath: '/apply?payment=fee_prepaid',
        cancelPath: '/apply?payment=fee_cancelled',
      },
    })
  }

  async function handlePromoApplyAndSubmit() {
    const current = steps[step]
    const errs = current.validate(signer)
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs)
      return
    }

    const code = promoInput.trim().toUpperCase()
    if (!code) {
      setPromoError('Enter a promo code.')
      return
    }

    if (code !== 'FEEWAIVE') {
      setPromoError('Invalid or unavailable promo code.')
      return
    }

    setPromoError('')
    setPromoApplied(true)
    setPrePaymentError('')
    try {
      const reg = await registerApplicationPaymentDraft({
        email: signer.email,
        fullName: signer.fullName,
        propertyName: signer.propertyName,
        roomNumber: signer.roomNumber,
      })
      try {
        window.sessionStorage.setItem(APPLICATION_RECORD_ID_KEY, reg.applicationRecordId)
      } catch {
        /* ignore */
      }
      await handleSubmit({ preventDefault: () => {} }, {
        promoOverride: true,
        applicationRecordId: reg.applicationRecordId,
      })
    } catch (e) {
      setPromoApplied(false)
      setPromoError(e.message || 'Could not apply promo. Try again or contact leasing.')
    }
  }

  async function handleLeaseSign() {
    const sig = leaseSignatureInput.trim()
    if (!sig) { setLeaseSigningError('Please type your full legal name to sign.'); return }
    if (sig.split(/\s+/).length < 2) { setLeaseSigningError('Please enter your full legal name (first and last).'); return }
    const recordId = submissionSummary?.submittedRecord?.id || submittedRecord?.id
    if (!recordId) { setLeaseSigningError('Application record not found. Please contact leasing.'); return }
    setLeaseSigningLoading(true)
    setLeaseSigningError('')
    try {
      await signLease(recordId, sig)
      setLeaseSigned(true)
      setLeaseStep('complete')
    } catch (err) {
      setLeaseSigningError(err.message || 'Failed to record signature. Please try again.')
    } finally {
      setLeaseSigningLoading(false)
    }
  }

  async function handleMoveInPaymentCheckout() {
    const applicantName = submissionSummary?.firstName ? `${submissionSummary.firstName}` : signer.fullName
    const applicantEmail = submissionSummary?.email || signer.email
    const propertyName = submissionSummary?.propertyName || signer.propertyName
    const unitNumber = submissionSummary?.roomNumber || signer.roomNumber
    const recordId = submissionSummary?.submittedRecord?.id || submittedRecord?.id || ''
    const monthlyRent = submissionSummary?.roomPrice || getRoomMonthlyRent(propertyName, unitNumber)
    const deposit = getSecurityDeposit(propertyName, monthlyRent)
    const utilities = getUtilitiesFee(propertyName)
    const items = [
      { name: "First month's rent", amount: monthlyRent },
      { name: 'Security deposit', amount: deposit },
      { name: 'Utilities', amount: utilities },
    ].filter((item) => Number(item.amount) > 0)
    const total = items.reduce((sum, item) => sum + Number(item.amount || 0), 0)

    if (total <= 0) {
      setMoveInPaymentError('Could not determine rent amount. Please contact leasing to complete payment.')
      return
    }

    setLeaseStep('payment')

    setMoveInPaymentLoading(true)
    setMoveInPaymentError('')
    setEmbeddedCheckout({
      flow: 'move_in_payment',
      title: 'Move-In Charges',
      request: {
        residentId: recordId,
        residentName: applicantName,
        residentEmail: applicantEmail,
        propertyName,
        unitNumber,
        items,
        amount: total,
        description: `Move-in charges for ${unitNumber} at ${propertyName}`,
        category: 'move_in_payment',
        paymentRecordId: recordId,
        successPath: '/apply?payment=success',
        cancelPath: '/apply?payment=cancelled',
      },
    })
  }

  function handleEmbeddedCheckoutClose() {
    if (embeddedCheckout?.flow === 'application_fee') {
      setPrePaymentLoading(false)
      try {
        window.sessionStorage.removeItem(PRE_SUBMIT_KEY)
      } catch {
        /* ignore */
      }
    }
    if (embeddedCheckout?.flow === 'move_in_payment') {
      setMoveInPaymentLoading(false)
    }
    setEmbeddedCheckout(null)
  }

  async function handleEmbeddedCheckoutComplete(detail) {
    const flow = embeddedCheckout?.flow
    setEmbeddedCheckout(null)

    if (flow === 'application_fee') {
      setPrePaymentLoading(false)
      const sid = String(detail?.sessionId || '').trim()
      if (sid.startsWith('cs_')) {
        try {
          window.sessionStorage.setItem(APPLICATION_FEE_CHECKOUT_SESSION_KEY, sid)
        } catch {
          /* ignore */
        }
      }
      const recId =
        typeof window !== 'undefined'
          ? String(window.sessionStorage.getItem(APPLICATION_RECORD_ID_KEY) || '').trim()
          : ''
      if (!recId.startsWith('rec')) {
        setPrePaymentError(
          'We could not link this payment to your application row. Close this dialog and use Pay again, or contact leasing.',
        )
        return
      }
      setFeeConfirmBusy(true)
      try {
        const paid = await pollApplicationPaid(recId, {
          sessionId: sid.startsWith('cs_') ? sid : undefined,
        })
        if (!paid) {
          setPrePaymentError(
            'Stripe is still confirming your payment (usually a few seconds). Close this message, wait briefly, then tap Submit on the form — you will not be charged twice.',
          )
          return
        }
        setAppFeePaid(true)
        const ok = await handleSubmit({ preventDefault: () => {} }, { applicationRecordId: recId })
        if (!ok) {
          setPrePaymentError(
            'Payment went through, but we could not save your application. Read the red message on the form, fix any issues, then use Submit again (Stripe will not charge twice for the same checkout). Contact leasing if you need help.',
          )
        }
      } finally {
        try {
          window.sessionStorage.removeItem(APPLICATION_FEE_CHECKOUT_SESSION_KEY)
        } catch {
          /* ignore */
        }
        setFeeConfirmBusy(false)
      }
      return
    }

    if (flow === 'move_in_payment') {
      setMoveInPaymentLoading(false)
      setMoveInPaid(true)
      setLeaseStep('lease')
    }
  }

  if (submitted) {
    const fullAppId = formatApplicationId(submissionSummary?.appId || submittedRecord)
    const effectiveType = submissionSummary?.applicationType || applicationType
    const isSigner = effectiveType === 'signer'
    const propertyName = submissionSummary?.propertyName || signer.propertyName
    const roomNumber = submissionSummary?.roomNumber || signer.roomNumber
    const monthlyRent = submissionSummary?.roomPrice || getRoomMonthlyRent(propertyName, roomNumber)
    const deposit = getSecurityDeposit(propertyName, monthlyRent)
    const utilities = getUtilitiesFee(propertyName)
    const moveInTotal = (monthlyRent || 0) + deposit + utilities
    const moveInDone = moveInPaid

    function clearStoredSubmission() {
      if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem(APPLICATION_SUBMISSION_STORAGE_KEY)
        window.localStorage.removeItem(APPLICATION_DRAFT_STORAGE_KEY)
      }
      setSubmissionSummary(null)
      setSubmitted(false)
      setSubmittedRecord(null)
    }

    // Step index: 0=account 1=payment 2=lease/complete
    const stepIndex = leaseStep === 'account' ? 0 : leaseStep === 'payment' ? 1 : 2
    const allDone = moveInDone && leaseSigned

    function StepDot({ n, done, active }) {
      return (
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ring-2 transition-all
          ${done ? 'bg-axis ring-axis text-white' : active ? 'bg-white ring-axis text-axis' : 'bg-white ring-slate-200 text-slate-400'}`}>
          {done
            ? <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>
            : n}
        </div>
      )
    }

    return (
      <div className="min-h-screen bg-cream-50">
        <Seo title="Application Submitted | Axis" pathname="/apply" />
        <div className="mx-auto max-w-lg px-4 py-16 sm:py-24">

          {/* Header */}
          <div className="mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-full bg-axis/10 ring-8 ring-axis/10">
            <svg className="h-10 w-10 text-axis" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-center text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">Application received</h1>
          <p className="mt-3 text-center text-base leading-7 text-slate-500">
            {isSigner
              ? 'Thanks for applying! A manager will review your application and approve it — usually within 1–2 business days. You\'ll only be able to create your resident portal account and access your lease after your application is approved.'
              : "Thanks! Your co-signer form has been linked to the signer's application."}
          </p>

          {/* App ID */}
          {isSigner && fullAppId && (
            <div className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 bg-slate-50 px-6 py-3">
                <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Your Application ID</span>
              </div>
              <div className="flex items-center justify-between gap-4 px-6 py-5">
                <span className="font-mono text-2xl font-black tracking-tight text-slate-900 break-all">{fullAppId}</span>
                <CopyButton text={fullAppId} />
              </div>
              {(submissionSummary?.hasCosigner || signer.hasCosigner) === 'Yes' && (
                <div className="border-t border-slate-100 bg-axis/5 px-6 py-4">
                  <p className="text-sm leading-6 text-axis">
                    Share this ID with your co-signer — they'll need it to link their form to yours at <strong>/apply</strong>.
                  </p>
                </div>
              )}
            </div>
          )}

          {isSigner && submissionSummary?.groupApplicationId ? (
            <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 bg-slate-50 px-6 py-3">
                <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Household Group ID</span>
              </div>
              <div className="px-6 py-5">
                <p className="text-sm leading-6 text-slate-600">
                  {submissionSummary?.applyAsGroup === 'Yes' && submissionSummary?.groupApplicantRole === 'first'
                    ? 'Share this Group ID with every roommate who still needs to apply. Each person completes their own application and selects “joining with Group ID” on step 1.'
                    : 'We linked this application to your household group. Keep this ID for your records.'}
                </p>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
                  <span className="font-mono text-xl font-black tracking-tight text-slate-900 break-all">{submissionSummary.groupApplicationId}</span>
                  <CopyButton text={submissionSummary.groupApplicationId} />
                </div>
              </div>
            </div>
          ) : null}

          {isSigner && (
            <div className="mt-8">
              <h2 className="mb-5 text-lg font-bold text-slate-900">Move-In Steps</h2>

              {/* Step indicators */}
              <div className="mb-6 flex items-center gap-0">
                <StepDot n={1} done={stepIndex > 0} active={stepIndex === 0} />
                <div className={`h-0.5 flex-1 transition-all ${stepIndex > 0 ? 'bg-axis' : 'bg-slate-200'}`} />
                <StepDot n={2} done={moveInDone} active={stepIndex === 1} />
                <div className={`h-0.5 flex-1 transition-all ${moveInDone ? 'bg-axis' : 'bg-slate-200'}`} />
                <StepDot n={3} done={leaseSigned} active={stepIndex === 2 && !leaseSigned} />
              </div>

              {/* Step 1: Create Resident Account */}
              <div className={`overflow-hidden rounded-2xl border transition-all ${stepIndex === 0 ? 'border-axis/40 bg-white shadow-md' : 'border-slate-100 bg-slate-50'}`}>
                <div className="flex items-center gap-3 px-5 py-4">
                  <StepDot n={1} done={stepIndex > 0} active={stepIndex === 0} />
                  <div>
                    <div className="font-semibold text-slate-900">Create Your Resident Account</div>
                    <div className="text-xs text-slate-500">Access your lease, submit work orders, and manage your stay</div>
                  </div>
                </div>
                {stepIndex === 0 && (
                  <div className="border-t border-slate-100 px-5 pb-5 pt-4">
                    <p className="mb-4 text-sm leading-6 text-slate-600">
                      Once a manager approves your application, use your Application ID to create your resident portal account. Your name, email, and room details will be pre-loaded automatically.
                    </p>
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <a
                        href={`/portal?appId=${encodeURIComponent(fullAppId)}`}
                        className="inline-block rounded-full bg-axis px-6 py-3 text-center text-sm font-semibold text-white transition hover:opacity-90"
                      >
                        Create Resident Account
                      </a>
                      <button type="button" onClick={() => setLeaseStep('payment')}
                        className="rounded-full border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">
                        I already have an account →
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Step 2: Pay Move-In Costs */}
              <div className={`mt-3 overflow-hidden rounded-2xl border transition-all ${stepIndex === 1 && !allDone ? 'border-axis/40 bg-white shadow-md' : moveInDone ? 'border-axis/20 bg-axis/5' : 'border-slate-100 bg-slate-50 opacity-60'}`}>
                <div className="flex items-center gap-3 px-5 py-4">
                  <StepDot n={2} done={moveInDone} active={stepIndex === 1 && !moveInDone} />
                  <div>
                    <div className="font-semibold text-slate-900">Pay Move-In Fee & Security Deposit</div>
                    <div className="text-xs text-slate-500">Complete your required move-in charges through Stripe</div>
                  </div>
                </div>
                {moveInDone ? (
                  <div className="border-t border-axis/10 px-5 py-4">
                    <p className="text-sm font-semibold text-axis">Move-in payment complete — lease signing is unlocked.</p>
                  </div>
                ) : stepIndex === 1 && (
                  <div className="border-t border-slate-100 px-5 pb-5 pt-4">
                    {paymentStatus === 'cancelled' && (
                      <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                        Payment was cancelled. You can retry below.
                      </div>
                    )}
                    <div className="mb-4 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-600">First month's rent</span>
                        <span className="font-semibold text-slate-900">{monthlyRent ? `$${monthlyRent.toLocaleString()}` : '—'}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-600">Security deposit</span>
                        <span className="font-semibold text-slate-900">{deposit ? `$${deposit.toLocaleString()}` : '—'}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-600">Utilities</span>
                        <span className="font-semibold text-slate-900">{utilities ? `$${utilities.toLocaleString()}` : '—'}</span>
                      </div>
                      <div className="flex justify-between border-t border-slate-200 pt-2 text-sm">
                        <span className="font-bold text-slate-900">Total due today</span>
                        <span className="font-black text-slate-900">{moveInTotal ? `$${moveInTotal.toLocaleString()}` : '—'}</span>
                      </div>
                    </div>
                    {moveInPaymentError && (
                      <p className="mb-3 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700">{moveInPaymentError}</p>
                    )}
                    <button type="button" onClick={handleMoveInPaymentCheckout} disabled={moveInPaymentLoading}
                      className="rounded-full bg-axis px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50">
                      {moveInPaymentLoading ? 'Opening checkout…' : `Pay $${moveInTotal ? moveInTotal.toLocaleString() : '…'}`}
                    </button>
                    {!moveInTotal && (
                      <p className="mt-3 text-xs text-slate-400">Contact leasing to complete payment if amounts are not shown.</p>
                    )}
                  </div>
                )}
              </div>

              {/* Step 3: Sign Lease */}
              <div className={`mt-3 overflow-hidden rounded-2xl border transition-all ${stepIndex === 2 && !leaseSigned ? 'border-axis/40 bg-white shadow-md' : leaseSigned ? 'border-axis/20 bg-axis/5' : 'border-slate-100 bg-slate-50 opacity-60'}`}>
                <div className="flex items-center gap-3 px-5 py-4">
                  <StepDot n={3} done={leaseSigned} active={stepIndex === 2 && !leaseSigned} />
                  <div>
                    <div className="font-semibold text-slate-900">Sign Your Lease</div>
                    <div className="text-xs text-slate-500">This unlocks right after your move-in charges are paid</div>
                  </div>
                </div>
                {!moveInDone ? (
                  <div className="border-t border-slate-100 px-5 py-4">
                    <p className="text-sm text-slate-500">Pay your move-in fee and security deposit first, then you can sign your lease.</p>
                  </div>
                ) : leaseSigned ? (
                  <div className="border-t border-axis/10 px-5 py-4">
                    <p className="text-sm font-semibold text-axis">Lease signed successfully — your room is secured.</p>
                  </div>
                ) : stepIndex === 2 && (
                  <div className="border-t border-slate-100 px-5 pb-5 pt-4">
                    <p className="mb-1 text-sm font-semibold text-slate-700">Lease Agreement</p>
                    <div className="mb-4 max-h-40 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-5 text-slate-600">
                      By signing below, I agree to the lease terms for {roomNumber} at {propertyName}, including all policies regarding rent, maintenance, guest access, and early termination. I confirm that the information provided in my application is accurate and complete. I understand that false information may result in immediate termination of the lease. This digital signature constitutes a legally binding agreement.
                    </div>
                    <div className="mb-3">
                      <label className="mb-1.5 block text-sm font-semibold text-slate-700">
                        Type your full legal name to sign <span className="text-red-400">*</span>
                      </label>
                      <input
                        type="text"
                        value={leaseSignatureInput}
                        onChange={(e) => setLeaseSignatureInput(e.target.value)}
                        placeholder="First and Last Name"
                        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium italic text-slate-900 placeholder-slate-400 outline-none transition focus:border-axis focus:ring-2 focus:ring-axis/20"
                      />
                    </div>
                    <p className="mb-4 text-xs text-slate-400">
                      Signed on {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                    </p>
                    {leaseSigningError && (
                      <p className="mb-3 rounded-xl bg-red-50 px-4 py-2.5 text-sm text-red-700">{leaseSigningError}</p>
                    )}
                    <button type="button" onClick={handleLeaseSign} disabled={leaseSigningLoading}
                      className="rounded-full bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] px-6 py-3 text-sm font-semibold text-white shadow-[0_6px_18px_rgba(37,99,235,0.22)] transition hover:brightness-105 disabled:opacity-50">
                      {leaseSigningLoading ? 'Saving signature…' : 'Sign Lease'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="mt-10 flex flex-col gap-3">
            {allDone && (
              <a href="/portal" className="inline-block w-full rounded-full bg-axis px-6 py-3 text-center text-sm font-semibold text-white hover:opacity-90 transition">
                Go to Resident Portal
              </a>
            )}
            <a href="/apply" onClick={clearStoredSubmission} className="inline-block w-full rounded-full border border-slate-200 bg-white px-6 py-3 text-center text-sm font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50 transition">
              Submit another application
            </a>
            <a href="/" className="inline-block w-full rounded-full bg-slate-900 px-6 py-3 text-center text-sm font-semibold text-white hover:bg-slate-800 transition">
              Back to home
            </a>
          </div>
          <EmbeddedStripeCheckout
            open={Boolean(embeddedCheckout)}
            title={embeddedCheckout?.title || 'Secure Payment'}
            checkoutRequest={embeddedCheckout?.request}
            onClose={handleEmbeddedCheckoutClose}
            onComplete={handleEmbeddedCheckoutComplete}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-cream-50">
      <Seo
        title="Apply | Axis"
        description="Submit a signer or co-signer rental application for Axis."
        pathname="/apply"
      />

      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
        <div className="mb-8">
          <h1 className="text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">Residential Rental Application</h1>
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
              <Section title="Group application">
                <p className="text-sm leading-6 text-slate-500">
                  Applying with roommates? One person should submit first; everyone else joins with the same <strong>Group ID</strong> they receive.
                </p>
                <Field label="Are you applying as part of a household group?" required error={fieldErrors.applyAsGroup}>
                  <div className="flex flex-wrap gap-3">
                    {['Yes', 'No'].map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => {
                          setSigner((prev) => ({
                            ...prev,
                            applyAsGroup: opt,
                            ...(opt === 'No'
                              ? { groupApplicantRole: '', groupSize: '', groupIdInput: '' }
                              : {}),
                          }))
                          setFieldErrors((prev) => {
                            const n = { ...prev }
                            delete n.applyAsGroup
                            delete n.groupApplicantRole
                            delete n.groupSize
                            delete n.groupIdInput
                            return n
                          })
                        }}
                        className={`rounded-full px-6 py-2.5 text-sm font-semibold transition ${signer.applyAsGroup === opt ? 'bg-axis text-white shadow-[0_4px_12px_rgba(37,99,235,0.20)]' : 'border border-slate-200 bg-white text-slate-700 hover:border-slate-400'}`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </Field>

                {signer.applyAsGroup === 'Yes' && (
                  <>
                    <Field label="Are you the first person in your group to submit this application?" required error={fieldErrors.groupApplicantRole}>
                      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3">
                        {[
                          { value: 'first', label: 'Yes — I am first (I will get a Group ID to share)' },
                          { value: 'member', label: 'No — someone already applied first (I have a Group ID)' },
                        ].map(({ value, label }) => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => updateSigner('groupApplicantRole', value)}
                            className={`rounded-xl border px-4 py-3 text-left text-sm font-semibold transition sm:max-w-md ${
                              signer.groupApplicantRole === value
                                ? 'border-axis bg-axis/10 text-axis'
                                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </Field>

                    {signer.groupApplicantRole === 'first' && (
                      <Field label="How many people are in your group (including you)?" required error={fieldErrors.groupSize} hint="Everyone who will live together should submit their own application using this Group ID.">
                        <input
                          type="number"
                          min={2}
                          max={30}
                          inputMode="numeric"
                          className={inputCls}
                          value={signer.groupSize}
                          onChange={(e) => updateSigner('groupSize', e.target.value)}
                          placeholder="e.g. 3"
                        />
                      </Field>
                    )}

                    {signer.groupApplicantRole === 'member' && (
                      <Field
                        label="Group ID from the first applicant"
                        required
                        error={fieldErrors.groupIdInput}
                        hint="The first person to apply sees this after they submit — it starts with AXISGRP-."
                      >
                        <input
                          className={`${inputCls} font-mono`}
                          value={signer.groupIdInput}
                          onChange={(e) => updateSigner('groupIdInput', e.target.value)}
                          placeholder="AXISGRP-…"
                          autoComplete="off"
                        />
                      </Field>
                    )}
                  </>
                )}

                {groupVerifyBusy ? (
                  <p className="mt-3 text-sm text-slate-500">Checking Group ID…</p>
                ) : null}
              </Section>
          )}
          {applicationType === 'signer' && step === 1 && (
              <Section title="Co-Signer">
                <p className="text-sm leading-6 text-slate-500">Will someone be co-signing this application with you?</p>
                <div className="flex gap-3">
                  {['Yes', 'No'].map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => updateSigner('hasCosigner', opt)}
                      className={`rounded-full px-6 py-2.5 text-sm font-semibold transition ${signer.hasCosigner === opt ? 'bg-axis text-white shadow-[0_4px_12px_rgba(37,99,235,0.20)]' : 'border border-slate-200 bg-white text-slate-700 hover:border-slate-400'}`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
                {fieldErrors.hasCosigner && <p className="mt-1.5 text-xs font-medium text-red-500" data-field-error="1">{fieldErrors.hasCosigner}</p>}
                {signer.hasCosigner === 'Yes' && (
                  <div className="rounded-xl border border-axis/20 bg-axis/5 px-4 py-3 text-sm text-axis">
                    After you submit, you'll receive an <strong>Application ID</strong>. Share it with your co-signer — they'll need it to link their form to yours.
                    {signer.applyAsGroup === 'Yes' ? (
                      <span className="mt-2 block">
                        If you are the <strong>first</strong> roommate to apply, you will also get a <strong>Group ID</strong> — share that with everyone else in your household so their applications stay linked.
                      </span>
                    ) : null}
                  </div>
                )}
              </Section>
          )}
          {applicationType === 'signer' && step === 2 && (
              <Section title="Property Information">
                <Field label="Property Name" required>
                  <select required className={selectCls} value={signer.propertyName} onChange={(e) => updateSigner('propertyName', e.target.value)}>
                    <option value="" disabled>Select a property…</option>
                    {propertyOptions.map((property) => (
                      <option key={property.id} value={property.name}>{property.name}</option>
                    ))}
                  </select>
                </Field>

                <div className="grid gap-5 lg:grid-cols-2">
                  <div className="space-y-4 lg:col-span-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Room preferences</p>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <Field label="1st choice room" required error={fieldErrors.roomNumber}>
                        <select required className={selectCls} value={signer.roomNumber} onChange={(e) => updateSigner('roomNumber', e.target.value)} disabled={!selectedProperty}>
                          <option value="">{selectedProperty ? 'Select a room…' : 'Choose a property first'}</option>
                          {(selectedProperty?.rooms || []).map((room) => {
                            const isOccupied = signedLeases.has(`${signer.propertyName}:${room.name}`)
                            return (
                              <option key={room.name} value={room.name} disabled={isOccupied}>
                                {room.name}{isOccupied ? ' — Currently leased' : ''}
                              </option>
                            )
                          })}
                        </select>
                      </Field>
                      <Field label="2nd choice (optional)" error={fieldErrors.roomChoice2}>
                        <select className={selectCls} value={signer.roomChoice2} onChange={(e) => updateSigner('roomChoice2', e.target.value)} disabled={!selectedProperty}>
                          <option value="">No second choice</option>
                          {(selectedProperty?.rooms || [])
                            .filter((room) => room.name !== signer.roomNumber && room.name !== signer.roomChoice3)
                            .map((room) => {
                              const isOccupied = signedLeases.has(`${signer.propertyName}:${room.name}`)
                              return (
                                <option key={room.name} value={room.name} disabled={isOccupied}>
                                  {room.name}{isOccupied ? ' — Currently leased' : ''}
                                </option>
                              )
                            })}
                        </select>
                      </Field>
                      <Field label="3rd choice (optional)" error={fieldErrors.roomChoice3}>
                        <select className={selectCls} value={signer.roomChoice3} onChange={(e) => updateSigner('roomChoice3', e.target.value)} disabled={!selectedProperty}>
                          <option value="">No third choice</option>
                          {(selectedProperty?.rooms || [])
                            .filter((room) => room.name !== signer.roomNumber && room.name !== signer.roomChoice2)
                            .map((room) => {
                              const isOccupied = signedLeases.has(`${signer.propertyName}:${room.name}`)
                              return (
                                <option key={room.name} value={room.name} disabled={isOccupied}>
                                  {room.name}{isOccupied ? ' — Currently leased' : ''}
                                </option>
                              )
                            })}
                        </select>
                      </Field>
                    </div>
                    <p className="text-xs text-slate-500">Your first choice is used for availability and processing; 2nd and 3rd help us place household groups when possible.</p>
                  </div>
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
                  {signer.leaseTerm !== 'Month-to-Month (+$25/mo)' && (
                    <Field label="Lease End Date" required error={fieldErrors.leaseEndDate}>
                      <input required type="date" min={signer.leaseStartDate || todayIsoDate()} max={MAX_DATE} className={inputCls} value={signer.leaseEndDate} onChange={(e) => updateSigner('leaseEndDate', clampYear(e.target.value))} />
                    </Field>
                  )}
                </div>

                {roomConflictWarning && (
                  <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                    <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                    </svg>
                    <div className="text-sm text-amber-800">
                      <span className="font-semibold">Heads up:</span> Another applicant has already submitted an application for this room. You can still apply, but your application may compete with theirs. Contact Axis directly if you have questions.
                    </div>
                  </div>
                )}
              </Section>
          )}
          {applicationType === 'signer' && step === 3 && (
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
                  <Field label="Social Security #" required hint="9 digits — ###-##-####" error={fieldErrors.ssn}>
                    <input required className={inputCls} placeholder="123-45-6789" value={signer.ssn} onChange={(e) => updateSigner('ssn', formatSSNInput(e.target.value))} />
                  </Field>
                  <Field label="Driver's License / ID #" required hint="Enter your license or ID number." error={fieldErrors.license}>
                    <input required className={inputCls} placeholder="License or ID number" value={signer.license} onChange={(e) => updateSigner('license', e.target.value)} />
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
          {applicationType === 'signer' && step === 4 && (
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
                <div className="grid gap-5 sm:grid-cols-3">
                  <Field label="City" required error={fieldErrors.currentCity}>
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
                  <Field label="Landlord / Property Manager Name" error={fieldErrors.currentLandlordName}>
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
                  <Field label="Reason for Leaving" required error={fieldErrors.currentReasonForLeaving}>
                    <input required className={inputCls} value={signer.currentReasonForLeaving} onChange={(e) => updateSigner('currentReasonForLeaving', e.target.value)} />
                  </Field>
                </div>
              </Section>
          )}
          {applicationType === 'signer' && step === 5 && (
              <Section title="Previous Address">
                <p className="text-sm text-slate-500 -mt-1 mb-3">Only required if you have lived at your current address for <strong>less than 1 year</strong>. If you have been at your current address for 1 year or more, check the box below to skip this section.</p>
                <label className="flex items-center gap-2 mb-4 text-sm text-slate-700 cursor-pointer select-none">
                  <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-axis focus:ring-axis" checked={signer.skipPreviousAddress} onChange={(e) => updateSigner('skipPreviousAddress', e.target.checked)} />
                  I have lived at my current address for 1 year or more — skip this section
                </label>
                {!signer.skipPreviousAddress && <>
                <Field label="Street Address" required error={fieldErrors.previousAddress}>
                  <AddressAutocomplete
                    required
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
                <div className="grid gap-5 sm:grid-cols-3">
                  <Field label="City" required error={fieldErrors.previousCity}>
                    <input required className={inputCls} autoComplete="address-level2" placeholder="Seattle" value={signer.previousCity} onChange={(e) => updateSigner('previousCity', e.target.value)} />
                  </Field>
                  <Field label="State" required error={fieldErrors.previousState}>
                    <input required className={inputCls} autoComplete="address-level1" placeholder="WA" maxLength={2} value={signer.previousState} onChange={(e) => updateSigner('previousState', e.target.value.toUpperCase())} />
                  </Field>
                  <Field label="ZIP" required error={fieldErrors.previousZip}>
                    <input required className={inputCls} autoComplete="postal-code" placeholder="98105" value={signer.previousZip} onChange={(e) => updateSigner('previousZip', e.target.value)} />
                  </Field>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Landlord / Property Manager Name" error={fieldErrors.previousLandlordName}>
                    <input className={inputCls} value={signer.previousLandlordName} onChange={(e) => updateSigner('previousLandlordName', e.target.value)} />
                  </Field>
                  <Field label="Landlord Phone #" error={fieldErrors.previousLandlordPhone}>
                    <input type="tel" className={inputCls} placeholder="(206) 555-0100" value={signer.previousLandlordPhone} onChange={(e) => updateSigner('previousLandlordPhone', formatPhoneInput(e.target.value))} />
                  </Field>
                </div>

                <div className="grid gap-5 sm:grid-cols-3">
                  <Field label="Move-in Date" required error={fieldErrors.previousMoveInDate}>
                    <input required type="date" min={MIN_DOB} max={MAX_DATE} className={inputCls} value={signer.previousMoveInDate} onChange={(e) => updateSigner('previousMoveInDate', clampYear(e.target.value))} />
                  </Field>
                  <Field label="Move-out Date" required error={fieldErrors.previousMoveOutDate}>
                    <input required type="date" min={MIN_DOB} max={MAX_DATE} className={inputCls} value={signer.previousMoveOutDate} onChange={(e) => updateSigner('previousMoveOutDate', clampYear(e.target.value))} />
                  </Field>
                  <Field label="Reason for Leaving" required error={fieldErrors.previousReasonForLeaving}>
                    <input required className={inputCls} value={signer.previousReasonForLeaving} onChange={(e) => updateSigner('previousReasonForLeaving', e.target.value)} />
                  </Field>
                </div>
                </>}
              </Section>
          )}
          {applicationType === 'signer' && step === 6 && (
              <Section title="Employment & Income">
                <label className="flex items-center gap-2 mb-4 text-sm text-slate-700 cursor-pointer select-none">
                  <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-axis focus:ring-axis" checked={signer.noEmployment} onChange={(e) => updateSigner('noEmployment', e.target.checked)} />
                  I am not currently employed
                </label>
                {!signer.noEmployment && <>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Employer Name" required error={fieldErrors.employer}>
                    <input required className={inputCls} value={signer.employer} onChange={(e) => updateSigner('employer', e.target.value)} />
                  </Field>
                  <Field label="Employer Address" required error={fieldErrors.employerAddress}>
                    <input required className={inputCls} value={signer.employerAddress} onChange={(e) => updateSigner('employerAddress', e.target.value)} />
                  </Field>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Supervisor Name" required error={fieldErrors.supervisorName}>
                    <input required className={inputCls} value={signer.supervisorName} onChange={(e) => updateSigner('supervisorName', e.target.value)} />
                  </Field>
                  <Field label="Supervisor Phone #" required error={fieldErrors.supervisorPhone}>
                    <input required type="tel" className={inputCls} placeholder="(206) 555-0100" value={signer.supervisorPhone} onChange={(e) => updateSigner('supervisorPhone', formatPhoneInput(e.target.value))} />
                  </Field>
                </div>

                <div className="grid gap-5 sm:grid-cols-4">
                  <Field label="Job Title" required error={fieldErrors.jobTitle}>
                    <input required className={inputCls} value={signer.jobTitle} onChange={(e) => updateSigner('jobTitle', e.target.value)} />
                  </Field>
                  <Field label="Monthly Income ($)" required error={fieldErrors.monthlyIncome}>
                    <input required type="number" min="0" step="1" inputMode="numeric" className={inputCls} placeholder="0" value={signer.monthlyIncome} onChange={(e) => updateSigner('monthlyIncome', e.target.value)} />
                  </Field>
                  <Field label="Annual Income ($)" required error={fieldErrors.annualIncome}>
                    <input required type="number" min="0" step="1" inputMode="numeric" className={inputCls} placeholder="0" value={signer.annualIncome} onChange={(e) => updateSigner('annualIncome', e.target.value)} />
                  </Field>
                  <Field label="Employment Start Date" required error={fieldErrors.employmentStartDate}>
                    <input required type="date" min={MIN_DOB} max={MAX_DATE} className={inputCls} value={signer.employmentStartDate} onChange={(e) => updateSigner('employmentStartDate', clampYear(e.target.value))} />
                  </Field>
                </div>
                </>}

                <Field label="Other / Non-Employment Income ($)">
                  <p className="text-xs text-slate-400 mb-1">e.g. rental income, investments, child support, disability</p>
                  <input type="number" min="0" step="1" inputMode="numeric" className={inputCls} placeholder="0" value={signer.otherIncome} onChange={(e) => updateSigner('otherIncome', e.target.value)} />
                </Field>
              </Section>
          )}
          {applicationType === 'signer' && step === 7 && (
              <Section title="References">
                <p className="text-sm leading-6 text-slate-500">Provide at least one personal or professional reference (not a family member).</p>
                <div className="grid gap-5 sm:grid-cols-3">
                  <Field label="Name" required error={fieldErrors.reference1Name}>
                    <input required className={inputCls} placeholder="Jane Smith" value={signer.reference1Name} onChange={(e) => updateSigner('reference1Name', e.target.value)} />
                  </Field>
                  <Field label="Relationship" required error={fieldErrors.reference1Relationship}>
                    <input required className={inputCls} placeholder="Colleague" value={signer.reference1Relationship} onChange={(e) => updateSigner('reference1Relationship', e.target.value)} />
                  </Field>
                  <Field label="Phone #" required error={fieldErrors.reference1Phone}>
                    <input required type="tel" className={inputCls} placeholder="(206) 555-0100" value={signer.reference1Phone} onChange={(e) => updateSigner('reference1Phone', formatPhoneInput(e.target.value))} />
                  </Field>
                </div>
                <div className="grid gap-5 sm:grid-cols-3">
                  <Field label="Name 2" required error={fieldErrors.reference2Name}>
                    <input required className={inputCls} placeholder="John Doe" value={signer.reference2Name} onChange={(e) => updateSigner('reference2Name', e.target.value)} />
                  </Field>
                  <Field label="Relationship 2" required error={fieldErrors.reference2Relationship}>
                    <input required className={inputCls} placeholder="Professor" value={signer.reference2Relationship} onChange={(e) => updateSigner('reference2Relationship', e.target.value)} />
                  </Field>
                  <Field label="Phone # 2" required error={fieldErrors.reference2Phone}>
                    <input required type="tel" className={inputCls} placeholder="(206) 555-0101" value={signer.reference2Phone} onChange={(e) => updateSigner('reference2Phone', formatPhoneInput(e.target.value))} />
                  </Field>
                </div>
              </Section>
          )}
          {applicationType === 'signer' && step === 8 && (
              <Section title="Additional Information">
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Number of Occupants" required error={fieldErrors.occupants}>
                    <input required type="number" min="1" max="20" inputMode="numeric" className={inputCls} placeholder="1" value={signer.occupants} onChange={(e) => updateSigner('occupants', e.target.value)} />
                  </Field>
                  <Field label="Pets">
                    <input className={inputCls} value={signer.pets} onChange={(e) => updateSigner('pets', e.target.value)} />
                  </Field>
                </div>
              </Section>
          )}
          {applicationType === 'signer' && step === 9 && (
              <Section title="Financial Background / Legal">
                <div className="grid gap-5 sm:grid-cols-3">
                  <Field label="Eviction History" required error={fieldErrors.evictionHistory}>
                    <select required className={selectCls} value={signer.evictionHistory} onChange={(e) => updateSigner('evictionHistory', e.target.value)}>
                      <option value="" disabled>Select…</option>
                      {HISTORY_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </Field>
                  <Field label="Bankruptcy History" required error={fieldErrors.bankruptcyHistory}>
                    <select required className={selectCls} value={signer.bankruptcyHistory} onChange={(e) => updateSigner('bankruptcyHistory', e.target.value)}>
                      <option value="" disabled>Select…</option>
                      {HISTORY_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </Field>
                  <Field label="Criminal Convictions" required error={fieldErrors.criminalHistory}>
                    <select required className={selectCls} value={signer.criminalHistory} onChange={(e) => updateSigner('criminalHistory', e.target.value)}>
                      <option value="" disabled>Select…</option>
                      {HISTORY_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </Field>
                </div>

                <Field label="Consent for Credit and Background Check" required error={fieldErrors.consent}>
                  <label className="flex min-h-[52px] items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-700">
                    <input type="checkbox" checked={signer.consent} onChange={(e) => updateSigner('consent', e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-axis focus:ring-axis" />
                    I consent to a credit and background check.
                  </label>
                </Field>
              </Section>
          )}
          {applicationType === 'signer' && step === 10 && (
              <Section title="Signature">
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Signer Signature" required error={fieldErrors.signature}>
                    <input required className={inputCls} value={signer.signature} onChange={(e) => updateSigner('signature', e.target.value)} />
                  </Field>
                  <Field label="Date Signed" required error={fieldErrors.dateSigned}>
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
                  <Field label="Signer Application ID" hint="Recommended if you have their Application ID." error={fieldErrors.linkedApplicationId}>
                    <input className={inputCls} value={cosigner.linkedApplicationId} onChange={(e) => updateCosigner('linkedApplicationId', e.target.value)} />
                  </Field>
                  <Field label="Signer Full Name" hint="Use this when you do not have the Application ID.">
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
                    <input required type="tel" className={inputCls} placeholder="(206) 555-0100" value={cosigner.phone} onChange={(e) => updateCosigner('phone', formatPhoneInput(e.target.value))} />
                  </Field>
                  <Field label="Date of Birth" required error={fieldErrors.dateOfBirth} reserveHintSpace>
                    <input required type="date" min={MIN_DOB} max={todayIsoDate()} className={inputCls} value={cosigner.dateOfBirth} onChange={(e) => updateCosigner('dateOfBirth', clampYear(e.target.value))} />
                  </Field>
                  <Field label="Driver's License / ID #" required hint="Enter your license or ID number." error={fieldErrors.license}>
                    <input required className={inputCls} placeholder="License or ID number" value={cosigner.license} onChange={(e) => updateCosigner('license', e.target.value)} />
                  </Field>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Social Security #" hint="9 digits — ###-##-####" error={fieldErrors.ssn}>
                    <input className={inputCls} placeholder="123-45-6789" value={cosigner.ssn} onChange={(e) => updateCosigner('ssn', e.target.value)} />
                  </Field>
                  <Field label="Current Address" required error={fieldErrors.currentAddress} reserveHintSpace>
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
                  <Field label="City" required error={fieldErrors.city}>
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
                  <Field label="Employer Name" required error={fieldErrors.employer}>
                    <input required className={inputCls} value={cosigner.employer} onChange={(e) => updateCosigner('employer', e.target.value)} />
                  </Field>
                  <Field label="Employer Address" required error={fieldErrors.employerAddress}>
                    <input required className={inputCls} value={cosigner.employerAddress} onChange={(e) => updateCosigner('employerAddress', e.target.value)} />
                  </Field>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Supervisor Name" required error={fieldErrors.supervisorName}>
                    <input required className={inputCls} value={cosigner.supervisorName} onChange={(e) => updateCosigner('supervisorName', e.target.value)} />
                  </Field>
                  <Field label="Supervisor Phone #" error={fieldErrors.supervisorPhone}>
                    <input type="tel" className={inputCls} placeholder="(206) 555-0100" value={cosigner.supervisorPhone} onChange={(e) => updateCosigner('supervisorPhone', formatPhoneInput(e.target.value))} />
                  </Field>
                </div>

                <div className="grid gap-5 sm:grid-cols-4">
                  <Field label="Job Title" required error={fieldErrors.jobTitle}>
                    <input required className={inputCls} value={cosigner.jobTitle} onChange={(e) => updateCosigner('jobTitle', e.target.value)} />
                  </Field>
                  <Field label="Monthly Income ($)" required error={fieldErrors.monthlyIncome}>
                    <input required type="number" min="0" step="1" inputMode="numeric" className={inputCls} placeholder="0" value={cosigner.monthlyIncome} onChange={(e) => updateCosigner('monthlyIncome', e.target.value)} />
                  </Field>
                  <Field label="Annual Income ($)" required error={fieldErrors.annualIncome}>
                    <input required type="number" min="0" step="1" inputMode="numeric" className={inputCls} placeholder="0" value={cosigner.annualIncome} onChange={(e) => updateCosigner('annualIncome', e.target.value)} />
                  </Field>
                  <Field label="Employment Start Date" required error={fieldErrors.employmentStartDate}>
                    <input required type="date" min={MIN_DOB} max={MAX_DATE} className={inputCls} value={cosigner.employmentStartDate} onChange={(e) => updateCosigner('employmentStartDate', clampYear(e.target.value))} />
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
                  <Field label="Bankruptcy History" required error={fieldErrors.bankruptcyHistory}>
                    <select required className={selectCls} value={cosigner.bankruptcyHistory} onChange={(e) => updateCosigner('bankruptcyHistory', e.target.value)}>
                      <option value="" disabled>Select…</option>
                      {HISTORY_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </Field>
                  <Field label="Criminal Convictions" required error={fieldErrors.criminalHistory}>
                    <select required className={selectCls} value={cosigner.criminalHistory} onChange={(e) => updateCosigner('criminalHistory', e.target.value)}>
                      <option value="" disabled>Select…</option>
                      {HISTORY_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                    </select>
                  </Field>
                </div>

                <Field label="Consent for Credit and Background Check" required error={fieldErrors.consent}>
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
                  <Field label="Co-Signer Signature" required error={fieldErrors.signature}>
                    <input required className={inputCls} value={cosigner.signature} onChange={(e) => updateCosigner('signature', e.target.value)} />
                  </Field>
                  <Field label="Date Signed" required error={fieldErrors.dateSigned}>
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
              <p className="font-semibold">Submission failed — we couldn&apos;t save your application. Please try again or contact support.</p>
              <p className="break-all font-mono text-xs text-red-600">{error}</p>
              <a href={buildMailtoFallback(applicationType, signer, cosigner)} className="inline-block rounded-lg bg-red-700 px-4 py-2 text-xs font-semibold text-white hover:bg-red-800">
                Send via email instead
              </a>
            </div>
          )}

          {isLastStep && applicationType === 'signer' && prePaymentError && (
            <div className="mb-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{prePaymentError}</div>
          )}
          {isLastStep && applicationType === 'signer' && signer.propertyName ? (
            <div className="mb-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              {signerApplicationFeeUsd <= 0 ? (
                <p>
                  <strong>No application fee</strong> for this property.
                </p>
              ) : (
                <p>
                  Application fee: <strong>${signerApplicationFeeUsd.toLocaleString()}</strong>
                </p>
              )}
            </div>
          ) : null}
          {isLastStep && applicationType === 'signer' && (
            <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Promo Code</p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  type="text"
                  value={promoInput}
                  onChange={(e) => { setPromoInput(e.target.value); setPromoError('') }}
                  placeholder="Enter code"
                  className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-axis focus:ring-2 focus:ring-axis/20 uppercase"
                />
              </div>
              {promoError ? <p className="mt-2 text-xs text-red-600">{promoError}</p> : null}
            </div>
          )}
          <div className="flex gap-3">
            {step > 0 && (
              <button type="button" onClick={handleBack} className="rounded-full border border-slate-200 bg-white px-6 py-3 text-sm font-semibold text-slate-700 hover:border-slate-400 transition">
                Back
              </button>
            )}
            {!isLastStep ? (
              <button
                type="button"
                onClick={() => void handleNext()}
                disabled={groupVerifyBusy}
                className="flex-1 rounded-full bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] py-3 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(37,99,235,0.22)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {groupVerifyBusy ? 'Verifying…' : 'Continue'}
              </button>
            ) : applicationType === 'signer' ? (
              <button
                type="button"
                onClick={() => {
                  if (promoInput.trim()) handlePromoApplyAndSubmit()
                  else if (signerApplicationFeeUsd <= 0) handleSubmit({ preventDefault: () => {} })
                  else if (appFeePaid) handleSubmit({ preventDefault: () => {} })
                  else handlePrePaymentCheckout()
                }}
                disabled={prePaymentLoading || submitting || feeConfirmBusy}
                className="flex-1 rounded-full bg-axis py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60 transition"
              >
                {submitting
                  ? 'Finalizing submission…'
                  : feeConfirmBusy
                    ? 'Confirming payment…'
                    : prePaymentLoading
                      ? 'Opening payment…'
                      : promoInput.trim()
                        ? 'Submit Application'
                        : signerApplicationFeeUsd <= 0
                          ? 'Submit Application'
                          : appFeePaid
                            ? 'Submit Application'
                            : `Pay $${signerApplicationFeeUsd.toLocaleString()} & Submit`}
              </button>
            ) : (
              <button type="submit" disabled={submitting} className="flex-1 rounded-full bg-axis py-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60 transition">
                {submitting ? 'Submitting…' : 'Submit co-signer form'}
              </button>
            )}
          </div>
        </form>
        <EmbeddedStripeCheckout
          open={Boolean(embeddedCheckout)}
          title={embeddedCheckout?.title || 'Secure Payment'}
          checkoutRequest={embeddedCheckout?.request}
          onClose={handleEmbeddedCheckoutClose}
          onComplete={handleEmbeddedCheckoutComplete}
        />
          </>
        )}
      </div>
    </div>
  )
}

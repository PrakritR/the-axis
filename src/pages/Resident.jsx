import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { properties } from '../data/properties'
import {
  airtableReady,
  createResident,
  createWorkOrder,
  getAnnouncements,
  getMessages,
  getPaymentsForResident,
  getResidentByEmail,
  getResidentById,
  getWorkOrdersForResident,
  loginResident,
  sendMessage,
  updateResident,
} from '../lib/airtable'

const SESSION_KEY = 'axis_resident'

const requestCategories = ['Plumbing', 'Electrical', 'HVAC', 'Appliance', 'Pest', 'Structural', 'Other']
const urgencyOptions = ['Routine', 'Urgent', 'Emergency']
const entryOptions = ['Morning', 'Afternoon', 'Evening']

function normalizeUnitLabel(value) {
  return String(value || '')
    .replace(/^Unit\s+/i, 'Room ')
    .trim()
}

function extractRoomNumber(value) {
  const match = String(value || '').match(/(\d+)/)
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
}

function compareRoomLabels(a, b) {
  const numberDiff = extractRoomNumber(a) - extractRoomNumber(b)
  if (numberDiff !== 0) return numberDiff

  return String(a || '').localeCompare(String(b || ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  })
}

function announcementMatchesResident(item, resident) {
  const residentProperty = String(resident.House || '').trim()
  const residentRoom = normalizeUnitLabel(resident['Unit Number'] || '')
  const residentPropertyId = residentProperty.includes('4709A') ? '4709A'
    : residentProperty.includes('4709B') ? '4709B'
    : residentProperty.includes('5259') ? '5259'
    : ''
  const residentRoomKey = residentPropertyId && residentRoom ? `${residentPropertyId}-${residentRoom}` : ''
  const target = String(item.Target || '').trim().toLowerCase()

  if (!target || ['all', 'all properties', 'all residents', 'everyone'].includes(target)) return true

  const tokens = target
    .split(/[\n,;]+/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)

  const propertyMatches = [
    residentProperty.toLowerCase(),
    residentPropertyId.toLowerCase(),
  ].filter(Boolean)

  const roomMatches = [
    residentRoom.toLowerCase(),
    `${residentProperty.toLowerCase()} ${residentRoom.toLowerCase()}`.trim(),
    residentRoomKey.toLowerCase(),
    residentRoomKey.toLowerCase().replace(/-/g, ' '),
  ].filter(Boolean)

  return tokens.some((token) => propertyMatches.includes(token) || roomMatches.includes(token))
}

const houseOptions = properties.map((property) => {
  const floorPlanUnits = (property.floorPlans || []).flatMap((plan) => plan.units || [])
  const roomPlanUnits = (property.roomPlans || [])
    .flatMap((plan) => plan.rooms || [])
    .map((room) => normalizeUnitLabel(room.name))

  const units = Array.from(new Set(
    [...floorPlanUnits, ...roomPlanUnits]
      .filter(Boolean)
      .map(normalizeUnitLabel)
  )).sort(compareRoomLabels)

  return {
    house: property.name,
    units,
  }
})

function getUnitsForHouse(house) {
  return houseOptions.find((option) => option.house === house)?.units || []
}

const statusStyles = {
  Submitted: 'border-slate-200 bg-slate-100 text-slate-700',
  'In Progress': 'border-sky-200 bg-sky-50 text-sky-700',
  Resolved: 'border-emerald-200 bg-emerald-50 text-emerald-700',
}

const priorityStyles = {
  Routine: 'border-slate-200 bg-slate-100 text-slate-600',
  Urgent: 'border-amber-200 bg-amber-50 text-amber-700',
  Emergency: 'border-red-200 bg-red-50 text-red-700',
}

function formatDate(value) {
  if (!value) return 'No date'
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDateInput(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

function classNames(...values) {
  return values.filter(Boolean).join(' ')
}

const residentPaymentFields = [
  'Resident Payment URL',
  'Payment URL',
  'Payment Link',
  'Resident Portal URL',
  'Portal URL',
]

const paymentRecordLinkFields = [
  'Checkout URL',
  'Payment URL',
  'Payment Link',
  'Portal URL',
]

function firstAvailableLink(record, fields) {
  if (!record) return ''

  for (const field of fields) {
    const value = record[field]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }

  return ''
}

function resolveResidentPaymentUrl(resident, payments = []) {
  return (
    firstAvailableLink(resident, residentPaymentFields) ||
    payments.map((payment) => firstAvailableLink(payment, paymentRecordLinkFields)).find(Boolean) ||
    import.meta.env.VITE_RESIDENT_PAYMENT_URL ||
    ''
  )
}

function SectionCard({ title, description, children, action }) {
  return (
    <div className="rounded-[28px] border border-slate-200 bg-white shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-7">
        <div>
          <h2 className="text-xl font-black text-slate-900 sm:text-2xl">{title}</h2>
          {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
        </div>
        {action}
      </div>
      <div className="px-5 py-5 sm:px-7 sm:py-6">{children}</div>
    </div>
  )
}

function SetupRequired() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_100%)] px-4">
      <div className="w-full max-w-xl rounded-[28px] border border-slate-200 bg-white p-8 text-center shadow-soft">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-50">
          <svg className="h-6 w-6 text-amber-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>
        <h1 className="text-2xl font-black text-slate-900">Airtable Access Required</h1>
        <p className="mt-3 text-sm leading-7 text-slate-500">
          The Airtable token doesn't have access to the Resident Portal base. To fix this:
        </p>
        <ol className="mt-5 space-y-2 text-left text-sm text-slate-700">
          <li className="flex gap-2"><span className="font-bold text-axis">1.</span> Go to <strong>airtable.com/create/tokens</strong> and edit your token</li>
          <li className="flex gap-2"><span className="font-bold text-axis">2.</span> Under <strong>Base access</strong>, add the AXIS Forms base (<code className="rounded bg-slate-100 px-1 text-xs">appNBX2inqfJMyqYV</code>)</li>
          <li className="flex gap-2"><span className="font-bold text-axis">3.</span> Ensure scopes include <code className="rounded bg-slate-100 px-1 text-xs">data.records:read</code> and <code className="rounded bg-slate-100 px-1 text-xs">data.records:write</code></li>
          <li className="flex gap-2"><span className="font-bold text-axis">4.</span> Save the token — no code change needed</li>
        </ol>
      </div>
    </div>
  )
}

const authInputCls = 'w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10'

function AuthCard({ children }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(160deg,#f0fdf8_0%,#f8fafc_40%,#ffffff_100%)] px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-7 flex justify-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 shadow-lg">
            <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955a1.5 1.5 0 012.092 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75" />
            </svg>
          </div>
        </div>
        <div className="rounded-[28px] border border-slate-200 bg-white p-8 shadow-soft">
          {children}
        </div>
      </div>
    </div>
  )
}

function PasswordInput({ value, onChange, placeholder, autoComplete }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        required
        value={value}
        onChange={onChange}
        placeholder={placeholder || '••••••••'}
        autoComplete={autoComplete || 'current-password'}
        className={authInputCls + ' pr-11'}
      />
      <button type="button" onClick={() => setShow((v) => !v)} tabIndex={-1}
        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition">
        {show
          ? <svg className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"/></svg>
          : <svg className="h-4.5 w-4.5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"/><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
        }
      </button>
    </div>
  )
}

function AirtableLogin({ onLogin }) {
  const [mode, setMode] = useState('login') // 'login' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [house, setHouse] = useState(houseOptions[0]?.house || '')
  const [unitNumber, setUnitNumber] = useState('')
  const [phone, setPhone] = useState('')
  const [leaseStartDate, setLeaseStartDate] = useState('')
  const [leaseEndDate, setLeaseEndDate] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const availableUnits = useMemo(() => getUnitsForHouse(house), [house])

  useEffect(() => {
    if (availableUnits.length) setUnitNumber(availableUnits[0])
  }, [house])

  function switchMode(next) {
    setMode(next)
    setError('')
    setPassword('')
  }

  async function handleLogin(event) {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      const resident = await loginResident(email.trim(), password)
      if (!resident) {
        setError('Invalid email or password. Contact Axis if you need help accessing your account.')
        return
      }
      onLogin(resident)
    } catch (err) {
      setError(err.message || 'Login failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function handleSignup(event) {
    event.preventDefault()
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }
    if (leaseStartDate > leaseEndDate) { setError('Move-out date must be after the move-in date.'); return }
    setLoading(true)
    setError('')
    try {
      const existing = await getResidentByEmail(email.trim())
      if (existing) {
        setError('An account with this email already exists. Please sign in instead.')
        return
      }
      const resident = await createResident({
        Name: `${firstName.trim()} ${lastName.trim()}`.trim(),
        Email: email.trim(),
        Password: password,
        House: house,
        'Unit Number': unitNumber,
        Phone: phone.trim(),
        'Lease Start Date': leaseStartDate,
        'Lease End Date': leaseEndDate,
        Status: 'Active',
      })
      onLogin(resident)
    } catch (err) {
      setError(err.message || 'Could not create account. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthCard>
      {/* Tab switcher */}
      <div className="flex gap-1 rounded-2xl border border-slate-100 bg-slate-50 p-1 mb-6">
        {[['login', 'Sign in'], ['signup', 'Create account']].map(([id, label]) => (
          <button key={id} type="button" onClick={() => switchMode(id)}
            className={classNames('flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition',
              mode === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900')}>
            {label}
          </button>
        ))}
      </div>

      {mode === 'login' ? (
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Email</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" className={authInputCls} />
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Password</label>
            <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </div>
          {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
          <button type="submit" disabled={loading} className="w-full rounded-full bg-slate-900 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 transition">
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleSignup} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">First Name <span className="text-red-400">*</span></label>
              <input type="text" required value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Jane" autoComplete="given-name" className={authInputCls} />
            </div>
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Last Name <span className="text-red-400">*</span></label>
              <input type="text" required value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Smith" autoComplete="family-name" className={authInputCls} />
            </div>
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Email <span className="text-red-400">*</span></label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" className={authInputCls} />
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Password <span className="text-red-400">*</span></label>
            <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min. 6 characters" autoComplete="new-password" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">House <span className="text-red-400">*</span></label>
              <select required value={house} onChange={(e) => setHouse(e.target.value)} className={authInputCls}>
                {houseOptions.map((o) => <option key={o.house}>{o.house}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Room <span className="text-red-400">*</span></label>
              <select required value={unitNumber} onChange={(e) => setUnitNumber(e.target.value)} className={authInputCls}>
                {availableUnits.map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Phone <span className="text-red-400">*</span></label>
            <input type="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(206) 555-0100" autoComplete="tel" className={authInputCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Move In Date <span className="text-red-400">*</span></label>
              <input type="date" required value={leaseStartDate} onChange={(e) => setLeaseStartDate(e.target.value)} className={authInputCls} />
            </div>
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Move Out Date <span className="text-red-400">*</span></label>
              <input type="date" required value={leaseEndDate} onChange={(e) => setLeaseEndDate(e.target.value)} className={authInputCls} />
            </div>
          </div>
          {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
          <button type="submit" disabled={loading} className="w-full rounded-full bg-slate-900 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50 transition">
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>
      )}
    </AuthCard>
  )
}

function RequestComposer({ resident, onCreated }) {
  const [form, setForm] = useState({
    title: '',
    category: requestCategories[0],
    urgency: urgencyOptions[0],
    preferredEntry: entryOptions[0],
    description: '',
  })
  const [photo, setPhoto] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    setSuccess('')

    try {
      if (photo) {
        if (!photo.type.startsWith('image/')) {
          throw new Error('Please upload an image file for the issue photo.')
        }
        if (photo.size > 10 * 1024 * 1024) {
          throw new Error('Please keep the issue photo under 10 MB.')
        }
      }

      const created = await createWorkOrder({
        resident,
        title: form.title,
        category: form.category,
        urgency: form.urgency,
        preferredEntry: form.preferredEntry,
        description: form.description,
        photoFile: photo || null,
      })

      setForm({
        title: '',
        category: requestCategories[0],
        urgency: urgencyOptions[0],
        preferredEntry: entryOptions[0],
        description: '',
      })
      setPhoto(null)
      setSuccess('Request submitted successfully.')
      onCreated(created)
    } catch (err) {
      setError(err.message || 'Could not submit request.')
    } finally {
      setSubmitting(false)
    }
  }

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  return (
    <SectionCard title="Submit a Work Order" description="Create a new request for the Axis team.">
      <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="mb-2 block text-sm font-semibold text-slate-700">Issue Title</label>
          <input
            required
            value={form.title}
            onChange={(event) => updateField('title', event.target.value)}
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
            placeholder="Kitchen sink leaking"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-semibold text-slate-700">Category</label>
          <select
            value={form.category}
            onChange={(event) => updateField('category', event.target.value)}
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
          >
            {requestCategories.map((option) => <option key={option}>{option}</option>)}
          </select>
        </div>

        <div>
          <label className="mb-2 block text-sm font-semibold text-slate-700">Urgency</label>
          <select
            value={form.urgency}
            onChange={(event) => updateField('urgency', event.target.value)}
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
          >
            {urgencyOptions.map((option) => <option key={option}>{option}</option>)}
          </select>
        </div>

        <div className="sm:col-span-2">
          <label className="mb-2 block text-sm font-semibold text-slate-700">Description</label>
          <textarea
            required
            rows={5}
            value={form.description}
            onChange={(event) => updateField('description', event.target.value)}
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
            placeholder="Describe the issue, where it is located, and anything the team should know."
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-semibold text-slate-700">Preferred Entry Time</label>
          <select
            value={form.preferredEntry}
            onChange={(event) => updateField('preferredEntry', event.target.value)}
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
          >
            {entryOptions.map((option) => <option key={option}>{option}</option>)}
          </select>
        </div>

        <div>
          <label className="mb-2 block text-sm font-semibold text-slate-700">Issue Photo</label>
          <label className="flex min-h-[120px] cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center transition hover:border-slate-900 hover:bg-slate-100">
            <span className="text-sm font-semibold text-slate-700">
              {photo ? photo.name : 'Upload an image of the issue'}
            </span>
            <span className="mt-2 text-xs leading-6 text-slate-500">
              Optional. JPG, PNG, or HEIC up to 10 MB. The photo will be attached to the Airtable work order.
            </span>
            <input
              type="file"
              accept="image/*"
              onChange={(event) => setPhoto(event.target.files?.[0] || null)}
              className="hidden"
            />
          </label>
        </div>

        {success ? (
          <div className="sm:col-span-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {success}
          </div>
        ) : null}

        {error ? (
          <div className="sm:col-span-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
          >
            {submitting ? 'Submitting...' : 'Submit request'}
          </button>
        </div>
      </form>
    </SectionCard>
  )
}

function RequestThread({ workOrder, residentEmail }) {
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)

  const loadMessages = useCallback(async () => {
    const next = await getMessages(workOrder.id)
    setMessages(next)
  }, [workOrder.id])

  useEffect(() => {
    loadMessages()
  }, [loadMessages])

  async function handleSend(event) {
    event.preventDefault()
    if (!draft.trim()) return
    setSending(true)
    try {
      await sendMessage({
        workOrderId: workOrder.id,
        senderEmail: residentEmail,
        message: draft.trim(),
      })
      setDraft('')
      await loadMessages()
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="mt-5 rounded-[24px] border border-slate-200 bg-slate-50 p-4">
      <div className="space-y-3">
        {messages.length === 0 ? (
          <p className="text-sm text-slate-400">No updates yet for this request.</p>
        ) : (
          messages.map((message) => {
            const isAdmin = Boolean(message['Is Admin'])
            const timestamp = message.Timestamp || message.created_at
            return (
              <div key={message.id} className={classNames('flex', isAdmin ? 'justify-start' : 'justify-end')}>
                <div className={classNames(
                  'max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6',
                  isAdmin ? 'rounded-tl-sm bg-white text-slate-800' : 'rounded-tr-sm bg-slate-900 text-white'
                )}>
                  <div className={classNames('mb-1 text-[11px] font-bold uppercase tracking-[0.18em]', isAdmin ? 'text-slate-400' : 'text-white/55')}>
                    {isAdmin ? 'Axis Team' : 'You'}
                  </div>
                  <p>{message.Message}</p>
                  <div className={classNames('mt-2 text-[11px]', isAdmin ? 'text-slate-400' : 'text-white/55')}>
                    {formatDate(timestamp)}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      <form onSubmit={handleSend} className="mt-4 flex gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Send an update or reply..."
          className="flex-1 rounded-full border border-slate-200 px-4 py-2.5 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
        />
        <button
          type="submit"
          disabled={sending || !draft.trim()}
          className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  )
}

function RequestsList({ requests, residentEmail }) {
  const [expandedId, setExpandedId] = useState(null)

  if (requests.length === 0) {
    return (
      <SectionCard title="My Work Orders" description="Track maintenance requests and see updates from the Axis team.">
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-3xl">📋</div>
          <div>
            <p className="text-lg font-semibold text-slate-900">No work orders yet</p>
            <p className="mt-1 text-sm text-slate-500">When you submit a work order, it will appear here with status updates and management notes.</p>
          </div>
        </div>
      </SectionCard>
    )
  }

  return (
    <SectionCard title="My Work Orders" description="Track maintenance requests and see updates from the Axis team.">
      <div className="space-y-4">
        {requests.map((request) => {
          const status = request.Status || 'Submitted'
          const priority = request.Priority || 'Routine'
          const notes = request['Management Notes']
          const photo = Array.isArray(request.Photo) ? request.Photo[0] : null
          const isExpanded = expandedId === request.id

          return (
            <div key={request.id} className="rounded-[24px] border border-slate-200 p-5 transition hover:border-slate-300">
              <button
                type="button"
                onClick={() => setExpandedId((current) => current === request.id ? null : request.id)}
                className="w-full text-left"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-bold text-slate-900">{request.Title}</h3>
                      <span className={classNames('rounded-full border px-2.5 py-1 text-[11px] font-semibold', statusStyles[status] || statusStyles.Submitted)}>
                        {status}
                      </span>
                      <span className={classNames('rounded-full border px-2.5 py-1 text-[11px] font-semibold', priorityStyles[priority] || priorityStyles.Routine)}>
                        {priority}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-500">{request.Description}</p>
                  </div>
                  <div className="text-right text-xs text-slate-400">
                    <div>{request.Category}</div>
                    <div className="mt-1">{formatDate(request['Date Submitted'] || request.created_at)}</div>
                  </div>
                </div>
              </button>

              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl bg-slate-50 px-4 py-3">
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Preferred Entry</div>
                  <div className="mt-1 text-sm font-semibold text-slate-700">{request['Preferred Entry Time'] || 'Not specified'}</div>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3 sm:col-span-2">
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Management Notes</div>
                  <div className="mt-1 text-sm text-slate-600">{notes || 'No management notes yet.'}</div>
                </div>
              </div>

              {photo?.url ? (
                <div className="mt-4">
                  <a
                    href={photo.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-500"
                  >
                    View attached photo
                  </a>
                </div>
              ) : null}

              {isExpanded ? <RequestThread workOrder={request} residentEmail={residentEmail} /> : null}
            </div>
          )
        })}
      </div>
    </SectionCard>
  )
}

function AnnouncementsPanel({ items }) {
  return (
    <SectionCard title="Announcements" description="Updates from the Axis team for residents.">
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">No announcements are active right now.</p>
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <div key={item.id} className="rounded-[24px] border border-slate-200 p-5">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-bold text-slate-900">{item.Title}</h3>
                {item.Pinned ? (
                  <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-700">
                    Pinned
                  </span>
                ) : null}
                {item.Priority ? (
                  <span className={classNames('rounded-full border px-2.5 py-1 text-[11px] font-semibold', priorityStyles[item.Priority] || priorityStyles.Routine)}>
                    {item.Priority}
                  </span>
                ) : null}
              </div>
              {item['Short Summary'] ? <p className="mt-3 text-sm font-medium text-slate-500">{item['Short Summary']}</p> : null}
              <p className="mt-3 text-sm leading-7 text-slate-600">{item.Message}</p>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                <span>{formatDate(item['Start Date'] || item['Date Posted'] || item.CreatedAt)}</span>
                {item.Target ? <span>{item.Target}</span> : null}
              </div>
              {item['CTA Text'] && item['CTA Link'] ? (
                <a
                  href={item['CTA Link']}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 inline-flex rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-500"
                >
                  {item['CTA Text']}
                </a>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  )
}

function ProfilePanel({ resident, onUpdated }) {
  const defaultHouse = resident.House || houseOptions[0]?.house || ''
  const [name, setName] = useState(resident.Name || '')
  const [email, setEmail] = useState(resident.Email || '')
  const [house, setHouse] = useState(defaultHouse)
  const [phone, setPhone] = useState(resident.Phone || '')
  const [unitNumber, setUnitNumber] = useState(resident['Unit Number'] || getUnitsForHouse(defaultHouse)[0] || '')
  const [leaseStartDate, setLeaseStartDate] = useState(formatDateInput(resident['Lease Start Date']))
  const [leaseEndDate, setLeaseEndDate] = useState(formatDateInput(resident['Lease End Date']))
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [saveError, setSaveError] = useState('')
  const availableUnits = useMemo(() => getUnitsForHouse(house), [house])

  useEffect(() => {
    const nextHouse = resident.House || houseOptions[0]?.house || ''
    setName(resident.Name || '')
    setEmail(resident.Email || '')
    setHouse(nextHouse)
    setPhone(resident.Phone || '')
    setUnitNumber(resident['Unit Number'] || getUnitsForHouse(nextHouse)[0] || '')
    setLeaseStartDate(formatDateInput(resident['Lease Start Date']))
    setLeaseEndDate(formatDateInput(resident['Lease End Date']))
  }, [resident])

  useEffect(() => {
    if (!availableUnits.length) return
    if (!availableUnits.includes(unitNumber)) {
      setUnitNumber(availableUnits[0])
    }
  }, [availableUnits, unitNumber])

  async function handleSubmit(event) {
    event.preventDefault()
    if (leaseStartDate > leaseEndDate) {
      setSaveError('Move-out date must be after the move-in date.')
      return
    }
    setSaving(true)
    setMessage('')
    setSaveError('')
    try {
      const updated = await updateResident(resident.id, {
        Name: name,
        Email: email,
        House: house,
        'Unit Number': unitNumber,
        Phone: phone,
        'Lease Start Date': leaseStartDate || null,
        'Lease End Date': leaseEndDate || null,
      })
      onUpdated(updated)
      setMessage('Profile updated successfully.')
    } catch (err) {
      setSaveError(err.message || 'Could not save profile right now. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SectionCard title="My Profile" description="Update your resident details here.">
      <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-2 block text-sm font-semibold text-slate-700">Full Name</label>
          <input
            type="text"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Your full name"
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
          />
        </div>
        <div>
          <label className="mb-2 block text-sm font-semibold text-slate-700">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
          />
        </div>
        <div>
          <label className="mb-2 block text-sm font-semibold text-slate-700">House</label>
          <select
            value={house}
            onChange={(event) => setHouse(event.target.value)}
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
          >
            {houseOptions.map((option) => <option key={option.house}>{option.house}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-2 block text-sm font-semibold text-slate-700">Unit</label>
          <select
            value={unitNumber}
            onChange={(event) => setUnitNumber(event.target.value)}
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
          >
            {availableUnits.map((option) => <option key={option}>{option}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-2 block text-sm font-semibold text-slate-700">Phone Number</label>
          <input
            required
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
          />
        </div>
        <div>
          <label className="mb-2 block text-sm font-semibold text-slate-700">Move In Date</label>
          <input
            type="date"
            required
            value={leaseStartDate}
            onChange={(event) => setLeaseStartDate(event.target.value)}
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
          />
        </div>
        <div>
          <label className="mb-2 block text-sm font-semibold text-slate-700">Move Out Date</label>
          <input
            type="date"
            required
            value={leaseEndDate}
            onChange={(event) => setLeaseEndDate(event.target.value)}
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
          />
        </div>
        <div className="sm:col-span-2">
          {message ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}
          {saveError ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{saveError}</div> : null}
        </div>
        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save profile'}
          </button>
        </div>
      </form>
    </SectionCard>
  )
}

const paymentStatusStyles = {
  Paid: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  Pending: 'border-amber-200 bg-amber-50 text-amber-700',
  Overdue: 'border-red-200 bg-red-50 text-red-700',
  Partial: 'border-sky-200 bg-sky-50 text-sky-700',
}

function PaymentsPanel({ resident }) {
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    getPaymentsForResident(resident)
      .then(setPayments)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [resident])

  const outstanding = payments.filter((p) => p.Status !== 'Paid').reduce((sum, p) => sum + (Number(p.Amount) || 0), 0)
  const nextDue = payments.find((p) => p.Status === 'Pending' || p.Status === 'Overdue')
  const paymentUrl = useMemo(() => resolveResidentPaymentUrl(resident, payments), [resident, payments])

  return (
    <SectionCard title="Lease & Payments" description="Manage rent, lease continuation, and account balances in one place.">
      {loading ? <p className="text-sm text-slate-400">Loading payments...</p> : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {!loading && !error && (
        <>
          <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-5">
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Lease Actions</div>
              <h3 className="mt-3 text-xl font-black text-slate-900">Pay rent, extend your lease, or continue your stay.</h3>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Use the payment system below whenever you are ready to make a payment or continue your lease.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                {paymentUrl ? (
                  <>
                    <a href={paymentUrl} className="rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800">
                      Pay rent
                    </a>
                    <a href={paymentUrl} className="rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-500">
                      Extend lease
                    </a>
                    <a href={paymentUrl} className="rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-500">
                      Continue lease
                    </a>
                  </>
                ) : (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                    Payment setup is not available on this account yet. Contact Axis and we’ll help you complete rent or lease continuation.
                  </div>
                )}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
              <div className="rounded-2xl bg-slate-50 px-4 py-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Outstanding Balance</div>
                <div className={classNames('mt-2 text-2xl font-black', outstanding > 0 ? 'text-red-600' : 'text-emerald-600')}>
                  {outstanding > 0 ? `$${outstanding.toLocaleString()}` : '$0'}
                </div>
              </div>
              <div className="rounded-2xl bg-slate-50 px-4 py-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Next Due</div>
                <div className="mt-2 text-lg font-black text-slate-900">{nextDue ? nextDue.Month || formatDate(nextDue['Due Date']) : '—'}</div>
                {nextDue?.['Due Date'] && <div className="mt-0.5 text-xs text-slate-400">{formatDate(nextDue['Due Date'])}</div>}
              </div>
              <div className="rounded-2xl bg-slate-50 px-4 py-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Total Payments</div>
                <div className="mt-2 text-lg font-black text-slate-900">{payments.length}</div>
              </div>
            </div>
          </div>

          {payments.length === 0 ? (
            <p className="mt-6 text-sm text-slate-400">No payment records yet. Contact Axis if you have questions about your balance.</p>
          ) : (
            <div className="mt-6 space-y-3">
              {payments.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 px-4 py-3">
                  <div>
                    <div className="font-semibold text-slate-900">{p.Month || 'Payment'}</div>
                    {p.Notes && <div className="mt-0.5 text-xs text-slate-400">{p.Notes}</div>}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-sm font-bold text-slate-900">${Number(p.Amount || 0).toLocaleString()}</div>
                    <span className={classNames('rounded-full border px-2.5 py-1 text-[11px] font-semibold', paymentStatusStyles[p.Status] || paymentStatusStyles.Pending)}>
                      {p.Status || 'Pending'}
                    </span>
                    {p['Paid Date'] && <div className="text-xs text-slate-400">Paid {formatDate(p['Paid Date'])}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </SectionCard>
  )
}

function Dashboard({ resident, onResidentUpdated, onSignOut }) {
  const [tab, setTab] = useState('requests')
  const [requests, setRequests] = useState([])
  const [announcements, setAnnouncements] = useState([])
  const [loading, setLoading] = useState(true)

  const residentEmail = resident.Email
  const hasStatusUpdates = useMemo(
    () => requests.some((item) => item.Status && item.Status !== 'Submitted'),
    [requests]
  )

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [nextRequests, nextAnnouncements] = await Promise.all([
        getWorkOrdersForResident(resident),
        getAnnouncements(),
      ])

      setRequests(nextRequests)
      setAnnouncements(nextAnnouncements.filter((item) => announcementMatchesResident(item, resident)))
    } finally {
      setLoading(false)
    }
  }, [resident])

  useEffect(() => {
    loadData()
  }, [loadData])

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_55%,#f8fafc_100%)]">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-6">
          <div>
            <div className="text-sm font-semibold text-slate-900">Resident Portal</div>
            <div className="mt-1 text-sm text-slate-500">{residentEmail}</div>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="rounded-full border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-500"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="mb-8 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-4xl font-black tracking-tight text-slate-900">Welcome back, {resident.Name || 'Resident'}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-500">
              Manage your profile, submit work orders, review announcements, and handle lease-related payments in one place.
            </p>
          </div>
          {hasStatusUpdates ? (
            <div className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-700">
              You have request updates to review
            </div>
          ) : null}
        </div>

        <div className="mb-6 flex flex-wrap gap-2 rounded-[24px] border border-slate-200 bg-white p-2 shadow-soft">
          {[
            ['requests', 'My Work Orders'],
            ['new', 'New Work Order'],
            ['payments', 'Lease & Payments'],
            ['announcements', 'Announcements'],
            ['profile', 'My Profile'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={classNames(
                'rounded-[18px] px-4 py-3 text-sm font-semibold transition',
                tab === id ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="rounded-[28px] border border-slate-200 bg-white px-6 py-16 text-center text-sm text-slate-400 shadow-soft">
            Loading resident portal...
          </div>
        ) : null}

        {!loading && tab === 'requests' ? <RequestsList requests={requests} residentEmail={residentEmail} /> : null}
        {!loading && tab === 'new' ? <RequestComposer resident={resident} onCreated={async () => { await loadData(); setTab('requests') }} /> : null}
        {!loading && tab === 'payments' ? <PaymentsPanel resident={resident} /> : null}
        {!loading && tab === 'announcements' ? <AnnouncementsPanel items={announcements} /> : null}
        {!loading && tab === 'profile' ? <ProfilePanel resident={resident} onUpdated={onResidentUpdated} /> : null}
      </div>
    </div>
  )
}

export default function Resident() {
  const [resident, setResident] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!airtableReady) {
      setLoading(false)
      return
    }
    const storedId = sessionStorage.getItem(SESSION_KEY)
    if (!storedId) {
      setLoading(false)
      return
    }
    let mounted = true
    getResidentById(storedId)
      .then((r) => { if (mounted && r) setResident(r) })
      .catch(() => { sessionStorage.removeItem(SESSION_KEY) })
      .finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [])

  function handleLogin(r) {
    sessionStorage.setItem(SESSION_KEY, r.id)
    setResident(r)
  }

  function handleSignOut() {
    sessionStorage.removeItem(SESSION_KEY)
    setResident(null)
  }

  if (!airtableReady) return <SetupRequired />
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_100%)] text-sm text-slate-400">
        Loading resident portal...
      </div>
    )
  }
  if (!resident) return <AirtableLogin onLogin={handleLogin} />

  return (
    <Dashboard
      resident={resident}
      onResidentUpdated={setResident}
      onSignOut={handleSignOut}
    />
  )
}

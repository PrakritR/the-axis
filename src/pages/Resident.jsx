import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { properties } from '../data/properties'
import {
  airtableReady,
  createWorkOrder,
  getAnnouncements,
  getMessages,
  getResidentByEmail,
  getWorkOrdersForResident,
  sendMessage,
  syncResidentFromAuth,
  updateResident,
} from '../lib/airtable'
import { supabase, supabaseReady, uploadResidentPhoto } from '../lib/supabase'

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
        <h1 className="text-2xl font-black text-slate-900">Resident Portal Setup Required</h1>
        <p className="mt-3 text-sm leading-7 text-slate-500">
          The resident portal needs both Supabase and Airtable configured before it can authenticate residents and load requests.
        </p>
        <div className="mt-6 space-y-2 rounded-2xl bg-slate-50 p-4 text-left font-mono text-xs text-slate-700">
          <div>VITE_SUPABASE_URL</div>
          <div>VITE_SUPABASE_ANON_KEY</div>
          <div>VITE_AIRTABLE_TOKEN</div>
          <div>VITE_AIRTABLE_BASE_ID</div>
        </div>
      </div>
    </div>
  )
}

function EmailLogin({ initialError = '' }) {
  const defaultHouse = houseOptions[0]?.house || ''
  const defaultUnit = getUnitsForHouse(defaultHouse)[0] || ''
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [house, setHouse] = useState(defaultHouse)
  const [unitNumber, setUnitNumber] = useState(defaultUnit)
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState(initialError)
  const availableUnits = useMemo(() => getUnitsForHouse(house), [house])

  useEffect(() => {
    if (!availableUnits.length) return
    if (!availableUnits.includes(unitNumber)) {
      setUnitNumber(availableUnits[0])
    }
  }, [availableUnits, unitNumber])

  useEffect(() => {
    setError(initialError)
  }, [initialError])

  async function handleSubmit(event) {
    event.preventDefault()
    setLoading(true)
    setMessage('')
    setError('')

    try {
      if (mode === 'signup') {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
        })

        if (signUpError) throw signUpError

        const existingResident = await getResidentByEmail(email)
        await syncResidentFromAuth({
          user: {
            id: data?.user?.id || existingResident?.['Supabase User ID'] || `pending-${email}`,
            email,
          },
          resident: existingResident,
          profile: {
            name: fullName,
            house,
            unitNumber,
            phone,
          },
        })

        setMessage('Account created. You can now sign in with your email and password.')
        setMode('login')
        setPassword('')
        setFullName('')
        setHouse(defaultHouse)
        setUnitNumber(defaultUnit)
        setPhone('')
        return
      }

      if (mode === 'reset') {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/resident`,
        })

        if (resetError) throw resetError

        setMessage(`Password reset email sent to ${email}.`)
        return
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (signInError) throw signInError
    } catch (err) {
      setError(err.message || 'Authentication failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_100%)] px-4">
      <div className="w-full max-w-md rounded-[28px] border border-slate-200 bg-white p-8 shadow-soft">
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-900 text-white">
            <svg className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 8.25v7.5A2.25 2.25 0 0119.5 18H4.5a2.25 2.25 0 01-2.25-2.25v-7.5m19.5 0L12 13.5 2.25 8.25m19.5 0L19.5 6H4.5l-2.25 2.25" />
            </svg>
          </div>
          <h1 className="mt-5 text-3xl font-black text-slate-900">Resident Portal</h1>
          <p className="mt-2 text-sm leading-7 text-slate-500">
            {mode === 'login'
              ? 'Sign in with your resident email and password to view requests, updates, announcements, and your profile.'
              : mode === 'signup'
                ? 'Create your resident account and we will create or update your Airtable resident profile automatically.'
                : 'Reset your password and we will email you a recovery link.'}
          </p>
          {mode === 'signup' ? (
            <p className="mt-2 text-xs leading-6 text-slate-400">
              Your password is stored securely in Supabase Auth. Airtable stores only resident profile data and request history.
            </p>
          ) : null}
        </div>

        <div className="mt-8 flex gap-1 rounded-2xl border border-slate-200 bg-slate-50 p-1">
          {[
            ['login', 'Sign in'],
            ['signup', 'Create account'],
            ['reset', 'Reset password'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setMode(id)
                setMessage('')
                setError('')
                setPassword('')
                if (id !== 'signup') {
                  setFullName('')
                  setHouse(defaultHouse)
                  setUnitNumber(defaultUnit)
                  setPhone('')
                }
              }}
              className={classNames(
                'flex-1 rounded-xl px-3 py-2.5 text-sm font-semibold transition',
                mode === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Resident Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
            />
          </div>

          {mode === 'signup' ? (
            <>
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Full Name</label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder="Your full name"
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">House</label>
                <select
                  required
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
                  required
                  value={unitNumber}
                  onChange={(event) => setUnitNumber(event.target.value)}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
                >
                  {availableUnits.map((option) => <option key={option}>{option}</option>)}
                </select>
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Phone</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="(555) 555-5555"
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
                />
              </div>
            </>
          ) : null}

          {mode !== 'reset' ? (
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={mode === 'signup' ? 'Create a password' : 'Enter your password'}
                className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
              />
            </div>
          ) : null}

          {message ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {message}
            </div>
          ) : null}

          {error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full bg-slate-900 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
          >
            {loading
              ? 'Please wait...'
              : mode === 'login'
                ? 'Sign in'
                : mode === 'signup'
                  ? 'Create account'
                  : 'Send reset email'}
          </button>
        </form>
      </div>
    </div>
  )
}

function PasswordRecovery({ onDone }) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    setMessage('')
    setError('')

    if (password.length < 8) {
      setError('Use at least 8 characters for the new password.')
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) throw updateError

      setMessage('Password updated successfully. You can now continue into the resident portal.')
    } catch (err) {
      setError(err.message || 'Could not update password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_100%)] px-4">
      <div className="w-full max-w-md rounded-[28px] border border-slate-200 bg-white p-8 shadow-soft">
        <div className="text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-900 text-white">
            <svg className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 0h10.5A2.25 2.25 0 0119.5 12.75v6A2.25 2.25 0 0117.25 21h-10.5A2.25 2.25 0 014.5 18.75v-6A2.25 2.25 0 016.75 10.5z" />
            </svg>
          </div>
          <h1 className="mt-5 text-3xl font-black text-slate-900">Set a New Password</h1>
          <p className="mt-2 text-sm leading-7 text-slate-500">
            Choose a new password for your resident account, then return to the portal.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">New Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Confirm Password</label>
            <input
              type="password"
              required
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
            />
          </div>

          {message ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {message}
            </div>
          ) : null}

          {error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 rounded-full bg-slate-900 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              {loading ? 'Updating...' : 'Update password'}
            </button>
            <button
              type="button"
              onClick={onDone}
              className="rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:border-slate-500"
            >
              Back
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function NotAuthorized({ email, onSignOut }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_100%)] px-4">
      <div className="w-full max-w-lg rounded-[28px] border border-slate-200 bg-white p-8 text-center shadow-soft">
        <h1 className="text-2xl font-black text-slate-900">Access Not Available</h1>
        <p className="mt-3 text-sm leading-7 text-slate-500">
          We authenticated <span className="font-semibold text-slate-700">{email}</span>, but the resident profile could not be completed yet.
          Try signing in again, or contact Axis if this email should already be active.
        </p>
        <button
          type="button"
          onClick={onSignOut}
          className="mt-6 rounded-full border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-500"
        >
          Sign out
        </button>
      </div>
    </div>
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
      let photoAttachment = null

      if (photo) {
        if (!photo.type.startsWith('image/')) {
          throw new Error('Please upload an image file for the issue photo.')
        }

        if (photo.size > 10 * 1024 * 1024) {
          throw new Error('Please keep the issue photo under 10 MB.')
        }

        photoAttachment = await uploadResidentPhoto({
          file: photo,
          residentId: resident.id,
        })
      }

      const created = await createWorkOrder({
        resident,
        title: form.title,
        category: form.category,
        urgency: form.urgency,
        preferredEntry: form.preferredEntry,
        description: form.description,
        photoAttachment,
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
      <SectionCard title="My Requests" description="Track maintenance and support issues submitted under your resident email.">
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-3xl">📋</div>
          <div>
            <p className="text-lg font-semibold text-slate-900">No requests yet</p>
            <p className="mt-1 text-sm text-slate-500">When you submit a work order, it will appear here with status updates and management notes.</p>
          </div>
        </div>
      </SectionCard>
    )
  }

  return (
    <SectionCard title="My Requests" description="Track maintenance and support issues submitted under your resident email.">
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
                {item.Priority ? (
                  <span className={classNames('rounded-full border px-2.5 py-1 text-[11px] font-semibold', priorityStyles[item.Priority] || priorityStyles.Routine)}>
                    {item.Priority}
                  </span>
                ) : null}
              </div>
              <p className="mt-3 text-sm leading-7 text-slate-600">{item.Body}</p>
              <div className="mt-3 text-xs text-slate-400">{formatDate(item['Date Posted'])}</div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  )
}

function ProfilePanel({ resident, onUpdated }) {
  const defaultHouse = resident.House || houseOptions[0]?.house || ''
  const [house, setHouse] = useState(defaultHouse)
  const [phone, setPhone] = useState(resident.Phone || '')
  const [unitNumber, setUnitNumber] = useState(resident['Unit Number'] || getUnitsForHouse(defaultHouse)[0] || '')
  const [leaseStartDate, setLeaseStartDate] = useState(formatDateInput(resident['Lease Start Date']))
  const [leaseEndDate, setLeaseEndDate] = useState(formatDateInput(resident['Lease End Date']))
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const availableUnits = useMemo(() => getUnitsForHouse(house), [house])

  useEffect(() => {
    const nextHouse = resident.House || houseOptions[0]?.house || ''
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
    setSaving(true)
    setMessage('')
    try {
      const updated = await updateResident(resident.id, {
        House: house,
        'Unit Number': unitNumber,
        Phone: phone,
        'Lease Start Date': leaseStartDate || null,
        'Lease End Date': leaseEndDate || null,
      })
      onUpdated(updated)
      setMessage('Profile updated.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SectionCard title="My Profile" description="Resident information pulled from Airtable.">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl bg-slate-50 px-4 py-3">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Name</div>
          <div className="mt-1 text-sm font-semibold text-slate-700">{resident.Name || 'Not set'}</div>
        </div>
        <div className="rounded-2xl bg-slate-50 px-4 py-3">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">House</div>
          <div className="mt-1 text-sm font-semibold text-slate-700">{resident.House || 'Not set'}</div>
        </div>
        <div className="rounded-2xl bg-slate-50 px-4 py-3">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Unit</div>
          <div className="mt-1 text-sm font-semibold text-slate-700">{resident['Unit Number'] || 'Not set'}</div>
        </div>
        <div className="rounded-2xl bg-slate-50 px-4 py-3">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Email</div>
          <div className="mt-1 text-sm font-semibold text-slate-700">{resident.Email}</div>
        </div>
        <div className="rounded-2xl bg-slate-50 px-4 py-3">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Lease Start Date</div>
          <div className="mt-1 text-sm font-semibold text-slate-700">{formatDate(resident['Lease Start Date'])}</div>
        </div>
        <div className="rounded-2xl bg-slate-50 px-4 py-3">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Lease End Date</div>
          <div className="mt-1 text-sm font-semibold text-slate-700">{formatDate(resident['Lease End Date'])}</div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="mt-5 max-w-md space-y-3">
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
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
          />
        </div>
        <div>
          <label className="mb-2 block text-sm font-semibold text-slate-700">Lease Start Date</label>
          <input
            type="date"
            value={leaseStartDate}
            onChange={(event) => setLeaseStartDate(event.target.value)}
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
          />
        </div>
        <div>
          <label className="mb-2 block text-sm font-semibold text-slate-700">Lease End Date</label>
          <input
            type="date"
            value={leaseEndDate}
            onChange={(event) => setLeaseEndDate(event.target.value)}
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
          />
        </div>
        {message ? <div className="text-sm text-emerald-700">{message}</div> : null}
        <button
          type="submit"
          disabled={saving}
          className="rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save profile'}
        </button>
      </form>
    </SectionCard>
  )
}

function Dashboard({ session, resident, onResidentUpdated, onSignOut }) {
  const [tab, setTab] = useState('requests')
  const [requests, setRequests] = useState([])
  const [announcements, setAnnouncements] = useState([])
  const [loading, setLoading] = useState(true)

  const residentEmail = resident.Email || session.user.email
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
      setAnnouncements(nextAnnouncements)
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
              Submit work orders, review updates from the Axis team, and keep your resident info current in one place.
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
            ['requests', 'My Requests'],
            ['new', 'New Request'],
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
        {!loading && tab === 'new' ? <RequestComposer resident={resident} onCreated={loadData} /> : null}
        {!loading && tab === 'announcements' ? <AnnouncementsPanel items={announcements} /> : null}
        {!loading && tab === 'profile' ? <ProfilePanel resident={resident} onUpdated={onResidentUpdated} /> : null}
      </div>
    </div>
  )
}

export default function Resident() {
  const [session, setSession] = useState(null)
  const [resident, setResident] = useState(null)
  const [loading, setLoading] = useState(true)
  const [authMode, setAuthMode] = useState('default')
  const [authError, setAuthError] = useState('')

  useEffect(() => {
    if (!supabaseReady || !airtableReady) {
      setLoading(false)
      return undefined
    }

    let mounted = true

    async function hydrate(nextSession) {
      if (!mounted) return

      if (!nextSession?.user?.email) {
        setSession(null)
        setResident(null)
        setLoading(false)
        return
      }

      setLoading(true)
      setSession(nextSession)

      try {
        const existingResident = await getResidentByEmail(nextSession.user.email)
        const matchedResident = await syncResidentFromAuth({
          user: nextSession.user,
          resident: existingResident,
        })
        if (!mounted) return
        setResident(matchedResident)
      } finally {
        if (mounted) setLoading(false)
      }
    }

    supabase.auth.getSession().then(({ data }) => {
      hydrate(data.session)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      hydrate(nextSession)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : ''
    if (!hash) return

    const params = new URLSearchParams(hash)
    const errorDescription = params.get('error_description')
    const errorCode = params.get('error_code')
    const type = params.get('type')

    if (type === 'recovery') {
      setAuthMode('recovery')
    } else if (errorDescription || errorCode) {
      const decoded = errorDescription
        ? decodeURIComponent(errorDescription.replace(/\+/g, ' '))
        : 'Authentication link is invalid or expired.'
      setAuthError(decoded)
      setAuthMode('default')
    }

    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }, [])

  async function handleSignOut() {
    await supabase.auth.signOut()
  }

  if (!supabaseReady || !airtableReady) return <SetupRequired />
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_100%)] text-sm text-slate-400">
        Loading resident portal...
      </div>
    )
  }
  if (!session && authMode === 'recovery') {
    return <PasswordRecovery onDone={() => setAuthMode('default')} />
  }
  if (!session) return <EmailLogin initialError={authError} />
  if (!resident) return <NotAuthorized email={session.user.email} onSignOut={handleSignOut} />

  return (
    <Dashboard
      session={session}
      resident={resident}
      onResidentUpdated={setResident}
      onSignOut={handleSignOut}
    />
  )
}

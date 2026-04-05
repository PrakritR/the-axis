import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  airtableReady,
  createWorkOrder,
  getAnnouncements,
  getMessages,
  getResidentByEmail,
  getWorkOrdersForResident,
  sendMessage,
  updateResident,
} from '../lib/airtable'
import { supabase, supabaseReady } from '../lib/supabase'

const requestCategories = ['Plumbing', 'Electrical', 'HVAC', 'Appliance', 'Pest', 'Structural', 'Other']
const urgencyOptions = ['Routine', 'Urgent', 'Emergency']
const entryOptions = ['Morning', 'Afternoon', 'Evening']

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

function EmailLogin() {
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    setLoading(true)
    setMessage('')
    setError('')

    try {
      const resident = await getResidentByEmail(email)
      if (!resident) {
        throw new Error('That email is not listed in the Residents table yet. Ask Axis to add you first.')
      }

      if (mode === 'signup') {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
        })

        if (signUpError) throw signUpError

        setMessage('Account created. You can now sign in with your email and password.')
        setMode('login')
        setPassword('')
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
      setError(err.message || 'Could not send magic link.')
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
                ? 'Create your password-based resident account using the email already listed in Airtable.'
                : 'Reset your password and we will email you a recovery link.'}
          </p>
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

function NotAuthorized({ email, onSignOut }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#f8fafc_0%,#ffffff_100%)] px-4">
      <div className="w-full max-w-lg rounded-[28px] border border-slate-200 bg-white p-8 text-center shadow-soft">
        <h1 className="text-2xl font-black text-slate-900">Access Not Available</h1>
        <p className="mt-3 text-sm leading-7 text-slate-500">
          <span className="font-semibold text-slate-700">{email}</span> is not listed in the Residents table yet.
          Add this email to Airtable before signing in again.
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
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    setSuccess('')

    try {
      const created = await createWorkOrder({
        resident,
        title: form.title,
        category: form.category,
        urgency: form.urgency,
        preferredEntry: form.preferredEntry,
        description: form.description,
      })

      setForm({
        title: '',
        category: requestCategories[0],
        urgency: urgencyOptions[0],
        preferredEntry: entryOptions[0],
        description: '',
      })
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

        <div className="flex items-end">
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-6 text-amber-800">
            Photo uploads are not enabled yet in this version. Include as much detail as possible in the description.
          </div>
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
          const notes = request.Notes
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
                  <div className="mt-1 text-sm font-semibold text-slate-700">{request['Preferred Date/Time'] || 'Not specified'}</div>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3 sm:col-span-2">
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Management Notes</div>
                  <div className="mt-1 text-sm text-slate-600">{notes || 'No management notes yet.'}</div>
                </div>
              </div>

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
  const [phone, setPhone] = useState(resident.Phone || '')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    setPhone(resident.Phone || '')
  }, [resident])

  async function handleSubmit(event) {
    event.preventDefault()
    setSaving(true)
    setMessage('')
    try {
      const updated = await updateResident(resident.id, { Phone: phone })
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
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Unit</div>
          <div className="mt-1 text-sm font-semibold text-slate-700">{resident['Unit Number'] || 'Not set'}</div>
        </div>
        <div className="rounded-2xl bg-slate-50 px-4 py-3">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Email</div>
          <div className="mt-1 text-sm font-semibold text-slate-700">{resident.Email}</div>
        </div>
        <div className="rounded-2xl bg-slate-50 px-4 py-3">
          <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Lease End Date</div>
          <div className="mt-1 text-sm font-semibold text-slate-700">{formatDate(resident['Lease End Date'])}</div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="mt-5 max-w-md space-y-3">
        <div>
          <label className="mb-2 block text-sm font-semibold text-slate-700">Phone Number</label>
          <input
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-900/10"
          />
        </div>
        {message ? <div className="text-sm text-emerald-700">{message}</div> : null}
        <button
          type="submit"
          disabled={saving}
          className="rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save phone number'}
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
        const matchedResident = await getResidentByEmail(nextSession.user.email)
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
  if (!session) return <EmailLogin />
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

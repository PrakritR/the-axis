import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import ManagerInboxPage from '../components/manager-inbox/ManagerInboxPage'
import Modal from '../components/Modal'
import PortalShell, { StatCard, StatusPill, DataTable } from '../components/PortalShell'
import {
  adminApproveProperty,
  adminPatchApplication,
  adminRejectApplication,
  adminUnapproveApplication,
  adminRejectProperty,
  adminUnrejectProperty,
  adminRequestPropertyEdits,
  adminSetManagerActive,
  adminDeleteProperty,
  adminUnlistProperty,
  adminRelistProperty,
  adminSetPropertyInternalNotes,
  isAdminPortalAirtableConfigured,
  loadAdminPortalDataset,
  loadResidentsForAdmin,
  fetchAdminProfileRecordById,
  fetchAdminProfileRecord,
  updateAdminMeetingAvailability,
} from '../lib/adminPortalAirtable.js'
import { readJsonResponse } from '../lib/readJsonResponse'
import { authenticateAdminPortal } from '../lib/adminPortalSignIn'
import {
  markDeveloperPortalActive,
  clearDeveloperPortalFlags,
  seedDeveloperManagerSession,
  seedInternalStaffManagerSession,
} from '../lib/developerPortal'
import { ApplicationDetailPanel } from '../lib/applicationDetailPanel.jsx'
import { PropertyDetailPanel } from '../lib/propertyDetailPanel.jsx'
import { AXIS_ADMIN_SESSION_KEY } from './adminSessionConstants'
import AdminProfilePanel from './AdminProfilePanel.jsx'
import AdminLeasingTab from './AdminLeasingTab.jsx'
import {
  getAllPortalInternalThreadMessages,
  fetchInboxThreadStateMap,
  portalInboxAirtableConfigured,
  portalInboxThreadKeyFromRecord,
} from '../lib/airtable.js'

export { AXIS_ADMIN_SESSION_KEY } from './adminSessionConstants'

const AdminPortalCalendarTab = lazy(() =>
  import('../pages/Manager.jsx').then((m) => ({ default: m.CalendarTabPanel })),
)

const AIRTABLE_TOKEN = import.meta.env.VITE_AIRTABLE_TOKEN
const CORE_BASE_ID = import.meta.env.VITE_AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const CORE_AIRTABLE_BASE_URL = `https://api.airtable.com/v0/${CORE_BASE_ID}`

async function fetchAdminCalendarEventsCount() {
  if (!AIRTABLE_TOKEN) return 0
  let total = 0
  let offset = null
  do {
    const url = new URL(`${CORE_AIRTABLE_BASE_URL}/Scheduling`)
    if (offset) url.searchParams.set('offset', offset)
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`,
      },
    })
    const body = await readJsonResponse(res)
    if (!res.ok) {
      const msg = body?.error?.message || `Could not load scheduling rows (${res.status})`
      throw new Error(msg)
    }
    const rows = Array.isArray(body?.records) ? body.records : []
    total += rows.length
    offset = body?.offset || null
  } while (offset)
  return total
}

const PROPERTY_STATUS_LABEL = {
  pending: 'Pending approval',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  rejected: 'Rejected',
  live: 'Live',
  inactive: 'Inactive',
  unlisted: 'Unlisted',
}

const NAV_BASE = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'properties', label: 'Properties' },
  { id: 'accounts', label: 'Managers' },
  { id: 'leasing', label: 'Leasing' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'messages', label: 'Inbox' },
  { id: 'profile', label: 'Profile' },
]

/** All signed-in admin users can review applications from this UI. */
function canReviewApplicationsFromAdmin() {
  return true
}

function adminApplicationActorMeta(user) {
  return { name: user.name || user.email || 'Admin', role: 'Admin' }
}

const adminSelectCls =
  'rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/20'

/** Property detail toolbar — plain border, top-right cluster (see Listed tab pattern). */
const adminPropToolbarBtn =
  'rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold shadow-sm transition hover:bg-slate-50 disabled:opacity-50'

// ─── Admin Meeting Availability ───────────────────────────────────────────────
const ADMIN_AVAIL_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function parseAdminAvailText(text) {
  const result = {}
  for (const d of ADMIN_AVAIL_DAYS) result[d] = []
  const lines = String(text || '').split('\n')
  for (const line of lines) {
    const match = line.match(/^(\w+):\s*(.+)/)
    if (!match) continue
    const day = ADMIN_AVAIL_DAYS.find((d) => d.toLowerCase() === match[1].toLowerCase())
    if (!day) continue
    for (const part of match[2].split(',').map((s) => s.trim())) {
      const rm = part.match(/^(\d+)-(\d+)$/)
      if (!rm) continue
      const s = parseInt(rm[1], 10)
      const e = parseInt(rm[2], 10)
      if (s < e) result[day].push({ start: s, end: e })
    }
  }
  return result
}

function encodeAdminAvailText(weekly) {
  const lines = []
  for (const day of ADMIN_AVAIL_DAYS) {
    const ranges = (weekly[day] || []).filter((r) => r.start < r.end)
    if (!ranges.length) continue
    lines.push(`${day}: ${ranges.map((r) => `${r.start}-${r.end}`).join(', ')}`)
  }
  return lines.join('\n')
}

function adminMinutesToTimeInput(minutes) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function adminTimeInputToMinutes(value) {
  const [h, m] = String(value || '').split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  return h * 60 + m
}

function adminDisplayTime(minutes) {
  return new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function AdminMeetingAvailabilitySection({ user }) {
  const [selectedDay, setSelectedDay] = useState('Mon')
  const [weekly, setWeekly] = useState(() => {
    const r = {}
    for (const d of ADMIN_AVAIL_DAYS) r[d] = []
    return r
  })
  const [profileRecordId, setProfileRecordId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function loadProfile() {
      setLoading(true)
      try {
        let profile = null
        const rid = user?.airtableRecordId
        if (rid) {
          profile = await fetchAdminProfileRecordById(rid)
        }
        if (!profile && user?.email) {
          profile = await fetchAdminProfileRecord(user.email)
        }
        if (!cancelled && profile) {
          setProfileRecordId(profile.id)
          setWeekly(parseAdminAvailText(profile['Meeting Availability'] || ''))
        }
      } catch {
        /* non-fatal */
      }
      if (!cancelled) setLoading(false)
    }
    loadProfile()
    return () => { cancelled = true }
  }, [user?.email, user?.airtableRecordId])

  async function handleSave() {
    if (!profileRecordId) {
      toast.error(
        'Admin profile record not found. Sign in via an Airtable-linked admin account to save availability.',
      )
      return
    }
    setSaving(true)
    try {
      const encoded = encodeAdminAvailText(weekly)
      await updateAdminMeetingAvailability(profileRecordId, encoded)
      toast.success('Meeting availability saved!')
    } catch (err) {
      toast.error(err?.message || 'Could not save availability. Make sure the Admin Profile table has a "Meeting Availability" field.')
    } finally {
      setSaving(false)
    }
  }

  const dayRanges = weekly[selectedDay] || []
  const disabled = saving || !profileRecordId

  function addRange() {
    const last = dayRanges[dayRanges.length - 1]
    const start = last ? Math.min(last.end + 30, 22 * 60) : 9 * 60
    const end = Math.min(start + 60, 22 * 60)
    setWeekly((prev) => ({ ...prev, [selectedDay]: [...(prev[selectedDay] || []), { start, end }] }))
  }

  function removeRange(idx) {
    setWeekly((prev) => ({
      ...prev,
      [selectedDay]: (prev[selectedDay] || []).filter((_, i) => i !== idx),
    }))
  }

  function updateRange(idx, partial) {
    setWeekly((prev) => {
      const next = [...(prev[selectedDay] || [])]
      next[idx] = { ...next[idx], ...partial }
      return { ...prev, [selectedDay]: next }
    })
  }

  const totalSlotsAcrossWeek = ADMIN_AVAIL_DAYS.reduce((n, d) => n + (weekly[d]?.length || 0), 0)

  return (
    <div className="mb-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-1 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-black text-slate-900">My Meeting Availability</h2>
          <p className="mt-1 text-sm text-slate-500">
            Set when you're available for meetings. People will see these slots when booking a meeting with you.
          </p>
        </div>
        {!loading && !profileRecordId && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Sign in with an Airtable-linked admin account to edit availability.
          </div>
        )}
      </div>

      {loading ? (
        <div className="mt-5 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
          Loading availability…
        </div>
      ) : (
        <>
          {/* Day selector tabs */}
          <div className="mt-5 flex flex-wrap gap-2">
            {ADMIN_AVAIL_DAYS.map((day) => {
              const count = weekly[day]?.length || 0
              const isActive = selectedDay === day
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => setSelectedDay(day)}
                  className={
                    isActive
                      ? 'rounded-full bg-[#2563eb] px-4 py-2 text-sm font-semibold text-white shadow-sm'
                      : 'rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-white transition'
                  }
                >
                  {day}
                  {count > 0 && (
                    <span className={`ml-1.5 text-xs ${isActive ? 'text-blue-200' : 'text-slate-400'}`}>
                      ({count})
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Time ranges for selected day */}
          <div className="mt-4 space-y-3">
            {dayRanges.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                No availability set for {selectedDay}. Click "Add time slot" to add hours.
              </div>
            ) : (
              dayRanges.map((range, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-[1fr_auto_1fr_auto] items-end gap-2 rounded-2xl border border-slate-200 bg-white p-3"
                >
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-slate-500">Start</label>
                    <input
                      type="time"
                      step="1800"
                      value={adminMinutesToTimeInput(range.start)}
                      disabled={disabled}
                      onChange={(e) => {
                        const m = adminTimeInputToMinutes(e.target.value)
                        if (m != null) updateRange(idx, { start: m })
                      }}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-800 outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/20 disabled:opacity-60"
                    />
                  </div>
                  <span className="pb-2 text-sm font-semibold text-slate-400">to</span>
                  <div>
                    <label className="mb-1 block text-[11px] font-semibold text-slate-500">End</label>
                    <input
                      type="time"
                      step="1800"
                      value={adminMinutesToTimeInput(range.end)}
                      disabled={disabled}
                      onChange={(e) => {
                        const m = adminTimeInputToMinutes(e.target.value)
                        if (m != null && m > range.start) updateRange(idx, { end: m })
                      }}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-800 outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/20 disabled:opacity-60"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeRange(idx)}
                    disabled={disabled}
                    className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-40"
                  >
                    Remove
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Summary of active days */}
          {totalSlotsAcrossWeek > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {ADMIN_AVAIL_DAYS.filter((d) => weekly[d]?.length > 0).map((d) => (
                <div key={d} className="rounded-xl bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800">
                  {d}: {weekly[d].map((r) => `${adminDisplayTime(r.start)}–${adminDisplayTime(r.end)}`).join(', ')}
                </div>
              ))}
            </div>
          )}

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={addRange}
              disabled={disabled}
              className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-white transition disabled:opacity-40"
            >
              + Add time slot
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !profileRecordId}
              className="rounded-xl bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] px-5 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save availability'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function AdminPropertyInternalNotesEditor({ recordId, savedValue, formDisabled, onSaved }) {
  const [text, setText] = useState(() => String(savedValue ?? ''))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setText(String(savedValue ?? ''))
  }, [recordId, savedValue])

  const dirty = String(text).trim() !== String(savedValue ?? '').trim()

  async function handleSave() {
    if (!recordId || !dirty || saving || formDisabled) return
    setSaving(true)
    try {
      await adminSetPropertyInternalNotes(recordId, text)
      await onSaved()
      toast.success('Internal notes saved')
    } catch (err) {
      toast.error(
        err?.message ||
          'Could not save internal notes. Add an "Internal Notes" long-text field on Properties, or set VITE_AIRTABLE_PROPERTY_INTERNAL_NOTES_FIELD to your column name.',
      )
    } finally {
      setSaving(false)
    }
  }

  const disabled = Boolean(formDisabled || saving)

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
      <label className="block text-sm">
        <span className="font-semibold text-slate-700">Internal notes (admin only)</span>
        <p className="mt-0.5 text-xs font-normal text-slate-500">
          For Axis staff only — not shown to managers or residents.
        </p>
        <textarea
          className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-[#2563eb]/15 disabled:opacity-60"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={disabled}
          placeholder="Screening notes, risk flags, follow-ups…"
        />
      </label>
      <button
        type="button"
        onClick={handleSave}
        disabled={!dirty || disabled}
        className="mt-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save internal notes'}
      </button>
    </div>
  )
}

function sortAccountsByMode(list, mode) {
  const copy = [...list]
  const house = (a) => String(a.houseSortKey || '')
  const acct = (a) => String(a.businessName || a.name || a.email || '').toLowerCase()
  if (mode === 'house_asc') {
    copy.sort(
      (a, b) =>
        house(a).localeCompare(house(b), undefined, { sensitivity: 'base' }) || acct(a).localeCompare(acct(b)),
    )
  } else if (mode === 'house_desc') {
    copy.sort(
      (a, b) =>
        house(b).localeCompare(house(a), undefined, { sensitivity: 'base' }) || acct(a).localeCompare(acct(b)),
    )
  } else if (mode === 'account_asc') {
    copy.sort((a, b) => acct(a).localeCompare(acct(b)))
  }
  return copy
}

function sortApplicationsByMode(list, mode) {
  const copy = [...list]
  const prop = (r) => String(r.propertyName || '').toLowerCase()
  const app = (r) => String(r.applicantName || '').toLowerCase()
  if (mode === 'house_asc') {
    copy.sort(
      (a, b) =>
        prop(a).localeCompare(prop(b), undefined, { sensitivity: 'base' }) || app(a).localeCompare(app(b)),
    )
  } else if (mode === 'house_desc') {
    copy.sort(
      (a, b) =>
        prop(b).localeCompare(prop(a), undefined, { sensitivity: 'base' }) || app(a).localeCompare(app(b)),
    )
  } else if (mode === 'applicant_asc') {
    copy.sort((a, b) => app(a).localeCompare(app(b)) || prop(a).localeCompare(prop(b)))
  }
  return copy
}

const loginInputCls =
  'mt-1 w-full rounded-xl border border-slate-600 bg-slate-900/40 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-500/40'

function propertyTone(st) {
  if (st === 'live') return 'green'
  if (st === 'pending') return 'amber'
  if (st === 'changes_requested') return 'violet'
  if (st === 'rejected') return 'red'
  if (st === 'unlisted') return 'violet'
  return 'slate'
}

function residentApprovedForProperty(resident) {
  if (!resident || typeof resident !== 'object') return false
  const approvedRaw = resident.Approved
  if (approvedRaw === true || approvedRaw === 1 || approvedRaw === '1') return true
  const statusRaw = String(resident.Status || resident['Approval Status'] || '').trim().toLowerCase()
  return statusRaw === 'approved' || statusRaw === 'active' || statusRaw === 'live'
}

function PortalHandoffCard({ accounts, residents, user }) {
  const [selectedManagerId, setSelectedManagerId] = useState('')
  const [selectedResidentId, setSelectedResidentId] = useState('')

  function openManagerPortal() {
    const manager = accounts.find((a) => a.id === selectedManagerId)
    if (!manager) return
    sessionStorage.setItem('axis_manager', JSON.stringify({
      id: manager.id,
      email: manager.email,
      name: manager.name,
    }))
    window.location.assign('/manager')
  }

  function openResidentPortal() {
    const resident = residents.find((r) => r.id === selectedResidentId)
    if (!resident) return
    sessionStorage.setItem('axis_resident', resident.id)
    window.location.assign('/resident')
  }

  const activeManagers = accounts.filter((a) => a.enabled)
  const sortedManagers = [...activeManagers].sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }),
  )
  const sortedResidents = [...residents].sort((a, b) =>
    String(a.Name || '').localeCompare(String(b.Name || ''), undefined, { sensitivity: 'base' }),
  )

  return (
    <div className="rounded-3xl border border-sky-200/90 bg-[linear-gradient(135deg,#f0f9ff_0%,#ffffff_100%)] p-5 shadow-sm">
      <h2 className="text-sm font-black text-slate-900">Open portals as a specific account</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-sky-800">Manager portal</div>
          <div className="flex gap-2">
            <select
              value={selectedManagerId}
              onChange={(e) => setSelectedManagerId(e.target.value)}
              className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400/30"
            >
              <option value="">— choose manager —</option>
              {sortedManagers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}{m.managedHousesLabel && m.managedHousesLabel !== '—' ? ` · ${m.managedHousesLabel}` : ''}
                </option>
              ))}
              {sortedManagers.length === 0 ? (
                <option disabled value="">No active managers found</option>
              ) : null}
            </select>
            <button
              type="button"
              disabled={!selectedManagerId}
              onClick={openManagerPortal}
              className="rounded-xl bg-[#2563eb] px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Open
            </button>
          </div>
        </div>
        <div>
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-sky-800">Resident portal</div>
          <div className="flex gap-2">
            <select
              value={selectedResidentId}
              onChange={(e) => setSelectedResidentId(e.target.value)}
              className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400/30"
            >
              <option value="">— choose resident —</option>
              {sortedResidents.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.Name || r.Email || r.id}
                  {r.House ? ` · ${r.House}` : ''}
                  {r['Unit Number'] ? ` ${r['Unit Number']}` : ''}
                </option>
              ))}
              {sortedResidents.length === 0 ? (
                <option disabled value="">Loading residents…</option>
              ) : null}
            </select>
            <button
              type="button"
              disabled={!selectedResidentId}
              onClick={openResidentPortal}
              className="rounded-xl bg-[#2563eb] px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Open
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function AdminLoginView({ onAuthenticated }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function handleSignIn(e) {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      const result = await authenticateAdminPortal(email, password)
      if (result.ok) {
        onAuthenticated(result.user)
        toast.success('Signed in')
        return
      }
      setErr(result.error || 'Sign-in failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-900 px-6 py-12">
      <div className="w-full max-w-md rounded-3xl border border-slate-700 bg-slate-800 p-8 shadow-xl">
        <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-sky-400">Axis Admin</div>
        <h1 className="mt-2 text-2xl font-black text-white">Admin portal</h1>

        <form onSubmit={handleSignIn} className="mt-6 space-y-4">
          <label className="block text-sm font-semibold text-slate-300">
            Email
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={loginInputCls}
              placeholder="you@company.com"
            />
          </label>
          <label className="block text-sm font-semibold text-slate-300">
            Password
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={loginInputCls}
            />
          </label>
          {err ? <p className="text-sm text-red-300">{err}</p> : null}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-2xl bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] py-3 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(37,99,235,0.25)] transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default function AdminPortal() {
  const [session, setSession] = useState(() => {
    try {
      const raw = sessionStorage.getItem(AXIS_ADMIN_SESSION_KEY)
      return raw ? JSON.parse(raw) : null
    } catch {
      return null
    }
  })
  const [tab, setTab] = useState(() => {
    const h = window.location.hash.slice(1)
    return NAV_BASE.some((n) => n.id === h) ? h : 'dashboard'
  })
  useEffect(() => { window.location.hash = tab }, [tab])
  /** Within Properties: pending | request_change | approved | unlisted | rejected */
  const [propertiesSection, setPropertiesSection] = useState('pending')
  /** Within Applications: all | pending | approved | rejected */
  const [applicationsFilter, setApplicationsFilter] = useState('all')
  const [managersFilter, setManagersFilter] = useState('current')
  const [selectedManagerAccountId, setSelectedManagerAccountId] = useState(null)
  const [managerActionBusy, setManagerActionBusy] = useState(false)
  const [properties, setProperties] = useState(() => [])
  const [accounts, setAccounts] = useState(() => [])
  const [applications, setApplications] = useState(() => [])
  const [selectedApprovalId, setSelectedApprovalId] = useState(null)
  const [selectedApplicationId, setSelectedApplicationId] = useState(null)
  const [residents, setResidents] = useState([])
  const [dataLoading, setDataLoading] = useState(false)
  const [approvalBusy, setApprovalBusy] = useState(false)
  const [applicationReviewBusy, setApplicationReviewBusy] = useState(false)
  const [managerTableSort, setManagerTableSort] = useState('house_asc')
  const [applicationsTableSort, setApplicationsTableSort] = useState('house_asc')
  const [unopenedThreadCount, setUnopenedThreadCount] = useState(0)
  const [calendarEventsCount, setCalendarEventsCount] = useState(0)
  const [propertiesSearch, setPropertiesSearch] = useState('')
  const [managersSearch, setManagersSearch] = useState('')
  const [applicationsManagerFilter, setApplicationsManagerFilter] = useState('')
  const [applicationsHouseFilter, setApplicationsHouseFilter] = useState('')
  const [requestEditsModalOpen, setRequestEditsModalOpen] = useState(false)
  const [requestEditsNotes, setRequestEditsNotes] = useState('')
  const airtableConfigWarned = useRef(false)

  const user = session

  useEffect(() => {
    if (session) markDeveloperPortalActive()
  }, [session])

  const refreshPortalData = useCallback(async () => {
    if (!session) return
    if (!isAdminPortalAirtableConfigured()) return
    setDataLoading(true)
    try {
      const [next, residentList, calendarCount] = await Promise.all([
        loadAdminPortalDataset(),
        loadResidentsForAdmin().catch(() => []),
        fetchAdminCalendarEventsCount().catch(() => 0),
      ])
      setProperties(next.properties)
      setAccounts(next.accounts)
      setApplications(next.applications)
      setResidents(residentList)
      setCalendarEventsCount(calendarCount)
    } catch (e) {
      toast.error(e?.message || 'Could not load data.')
    } finally {
      setDataLoading(false)
    }
  }, [session])

  useEffect(() => {
    if (!session) return
    if (!isAdminPortalAirtableConfigured()) {
      if (!airtableConfigWarned.current) {
        airtableConfigWarned.current = true
        toast.error('Admin data needs API token and base ID configured (same as manager portal).')
      }
      return
    }
    refreshPortalData()
  }, [session, refreshPortalData])

  function persistSession(u) {
    setSession(u)
    sessionStorage.setItem(AXIS_ADMIN_SESSION_KEY, JSON.stringify(u))
    if (u) markDeveloperPortalActive()
  }

  function handleSignOut() {
    sessionStorage.removeItem(AXIS_ADMIN_SESSION_KEY)
    clearDeveloperPortalFlags()
    setSession(null)
    window.location.replace('/portal')
  }

  // Unopened threads for dashboard badge
  useEffect(() => {
    if (!session?.email || !portalInboxAirtableConfigured()) return
    let cancelled = false
    async function fetchUnopenedCount() {
      try {
        const [msgs, stateMap] = await Promise.all([
          getAllPortalInternalThreadMessages(),
          fetchInboxThreadStateMap(session.email),
        ])
        const latestByThread = new Map()
        for (const m of msgs) {
          const tk = portalInboxThreadKeyFromRecord(m)
          if (!tk) continue
          const ts = m.Timestamp ? new Date(m.Timestamp) : null
          if (!ts) continue
          const prev = latestByThread.get(tk)
          if (!prev || ts > prev) latestByThread.set(tk, ts)
        }
        let unopened = 0
        for (const [tk, latest] of latestByThread) {
          const state = stateMap.get(tk)
          if (!state?.lastReadAt || latest > state.lastReadAt) unopened++
        }
        if (!cancelled) setUnopenedThreadCount(unopened)
      } catch {
        // non-fatal — badge just stays at 0
      }
    }
    fetchUnopenedCount()
    return () => { cancelled = true }
  }, [session])

  useEffect(() => {
    if (tab !== 'applications') setSelectedApplicationId(null)
  }, [tab])

  useEffect(() => {
    if (tab !== 'properties') setSelectedApprovalId(null)
  }, [tab])

  useEffect(() => {
    if (tab !== 'properties') setRequestEditsModalOpen(false)
  }, [tab])

  useEffect(() => {
    if (!selectedApprovalId) setRequestEditsModalOpen(false)
  }, [selectedApprovalId])

  useEffect(() => {
    setSelectedApprovalId(null)
  }, [propertiesSection])

  const navItems = useMemo(() => NAV_BASE, [])

  /** First-time submissions awaiting admin review (not admin “request change” flow). */
  const pendingReviewProperties = useMemo(() => properties.filter((p) => p.status === 'pending'), [properties])
  /** Admin asked manager to edit; waiting on manager resubmit → then returns to pending review. */
  const requestChangeProperties = useMemo(() => properties.filter((p) => p.status === 'changes_requested'), [properties])
  const propertiesAwaitingAdminAttention = useMemo(
    () => pendingReviewProperties.length,
    [pendingReviewProperties],
  )
  const approvedProperties = useMemo(
    () => properties.filter((p) => p.status === 'approved' || p.status === 'live'),
    [properties],
  )
  const unlistedProperties = useMemo(() => properties.filter((p) => p.status === 'unlisted'), [properties])
  const rejectedProperties = useMemo(() => properties.filter((p) => p.status === 'rejected'), [properties])
  const pendingApps = useMemo(
    () => applications.filter((a) => a.approvalPending).length,
    [applications],
  )
  const sortedAccounts = useMemo(
    () => sortAccountsByMode(accounts, managerTableSort),
    [accounts, managerTableSort],
  )
  const filteredAccounts = useMemo(
    () => managersFilter === 'current'
      ? sortedAccounts.filter((a) => a.enabled !== false)
      : sortedAccounts.filter((a) => a.enabled === false),
    [sortedAccounts, managersFilter],
  )
  const sortedApplications = useMemo(
    () => sortApplicationsByMode(applications, applicationsTableSort),
    [applications, applicationsTableSort],
  )
  const filteredApplications = useMemo(() => {
    if (applicationsFilter === 'pending') return sortedApplications.filter((a) => a.approvalPending)
    if (applicationsFilter === 'approved') return sortedApplications.filter((a) => a.approvalState === 'approved')
    if (applicationsFilter === 'rejected') return sortedApplications.filter((a) => a.approvalState === 'rejected')
    return sortedApplications
  }, [sortedApplications, applicationsFilter])

  const searchedPendingReview = useMemo(() => {
    const q = propertiesSearch.trim().toLowerCase()
    if (!q) return pendingReviewProperties
    return pendingReviewProperties.filter((p) => `${p.name} ${p.address}`.toLowerCase().includes(q))
  }, [pendingReviewProperties, propertiesSearch])
  const searchedRequestChange = useMemo(() => {
    const q = propertiesSearch.trim().toLowerCase()
    if (!q) return requestChangeProperties
    return requestChangeProperties.filter((p) => `${p.name} ${p.address}`.toLowerCase().includes(q))
  }, [requestChangeProperties, propertiesSearch])
  /** Rows + empty copy for the two admin review queues (pending vs manager resubmit cycle). */
  const propertyReviewQueue = useMemo(() => {
    if (propertiesSection === 'pending') {
      return {
        rows: searchedPendingReview,
        empty: 'No properties awaiting review',
        queueHint: null,
      }
    }
    if (propertiesSection === 'request_change') {
      return {
        rows: searchedRequestChange,
        empty: 'No properties in request change.',
        queueHint: null,
      }
    }
    return { rows: null, empty: '', queueHint: null }
  }, [propertiesSection, searchedPendingReview, searchedRequestChange])
  const searchedApprovedProperties = useMemo(() => {
    const q = propertiesSearch.trim().toLowerCase()
    if (!q) return approvedProperties
    return approvedProperties.filter((p) => `${p.name} ${p.address}`.toLowerCase().includes(q))
  }, [approvedProperties, propertiesSearch])
  const searchedUnlistedProperties = useMemo(() => {
    const q = propertiesSearch.trim().toLowerCase()
    if (!q) return unlistedProperties
    return unlistedProperties.filter((p) => `${p.name} ${p.address}`.toLowerCase().includes(q))
  }, [unlistedProperties, propertiesSearch])
  const searchedRejectedProperties = useMemo(() => {
    const q = propertiesSearch.trim().toLowerCase()
    if (!q) return rejectedProperties
    return rejectedProperties.filter((p) => `${p.name} ${p.address}`.toLowerCase().includes(q))
  }, [rejectedProperties, propertiesSearch])
  const searchedAccounts = useMemo(() => {
    const q = managersSearch.trim().toLowerCase()
    if (!q) return filteredAccounts
    return filteredAccounts.filter((a) => `${a.businessName || ''} ${a.name || ''} ${a.email || ''} ${a.managedHousesLabel || ''}`.toLowerCase().includes(q))
  }, [filteredAccounts, managersSearch])
  const searchedApplications = useMemo(() => {
    let result = filteredApplications
    if (applicationsManagerFilter) result = result.filter((a) => a.ownerId === applicationsManagerFilter)
    if (applicationsHouseFilter) result = result.filter((a) => a.propertyName === applicationsHouseFilter)
    return result
  }, [filteredApplications, applicationsManagerFilter, applicationsHouseFilter])

  const applicationHouseOptions = useMemo(() => {
    const set = new Set()
    for (const p of properties) {
      const name = String(p?.name || '').trim()
      if (name) set.add(name)
    }
    for (const r of residents) {
      if (!residentApprovedForProperty(r)) continue
      const house = String(r?.House || r?.['Property Name'] || '').trim()
      if (house) set.add(house)
    }
    for (const a of applications) {
      const house = String(a?.propertyName || '').trim()
      if (house) set.add(house)
    }
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
  }, [properties, residents, applications])

  const ownerLabel = (ownerId) => accounts.find((a) => a.id === ownerId)?.businessName || accounts.find((a) => a.id === ownerId)?.name || ownerId

  if (!session) {
    return <AdminLoginView onAuthenticated={persistSession} />
  }

  const approval = properties.find((p) => p.id === selectedApprovalId)
  const selectedApplication = applications.find((a) => a.id === selectedApplicationId)

  return (
    <PortalShell
      brandTitle="Axis"
      desktopNav="sidebar"
      navItems={navItems}
      activeId={tab}
      onNavigate={setTab}
      onSignOut={handleSignOut}
    >
      <div className="mx-auto w-full max-w-[1600px]">
      {tab === 'dashboard' && (
        <div className="space-y-6">
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-black uppercase tracking-[0.08em] text-slate-900">
                {user?.name ? `WELCOME ${user.name.split(' ')[0]}` : 'DASHBOARD'}
              </h1>
            </div>
            {dataLoading ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" />
                Syncing…
              </span>
            ) : (
              <button
                type="button"
                onClick={refreshPortalData}
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50"
              >
                Refresh
              </button>
            )}
          </div>

          {/* Portal handoff — top */}
          {isAdminPortalAirtableConfigured() ? (
            <PortalHandoffCard accounts={accounts} residents={residents} user={user} />
          ) : null}

          {/* Action-needed banner */}
          {propertiesAwaitingAdminAttention > 0 ? (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-400 text-xs font-black text-white">
                {propertiesAwaitingAdminAttention}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-amber-900">Action needed</p>
                <p className="text-xs text-amber-800">
                  {`${pendingReviewProperties.length} propert${pendingReviewProperties.length === 1 ? 'y' : 'ies'} pending review`}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setTab('properties')
                    setPropertiesSection('pending')
                  }}
                  className="rounded-xl bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-600"
                >
                  Review properties
                </button>
              </div>
            </div>
          ) : null}

          {/* Metrics grid — unified light blue tint */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {/* Properties pending */}
            <button
              type="button"
              onClick={() => { setTab('properties'); setPropertiesSection('pending') }}
              className="flex flex-col gap-1 rounded-3xl border border-sky-200/90 bg-sky-50 p-5 text-left transition hover:border-sky-300 hover:bg-sky-100/80 hover:shadow-sm"
            >
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-sky-800">Properties · Pending review</span>
              <span className="text-3xl font-black tabular-nums text-slate-900">{pendingReviewProperties.length}</span>
            </button>

            {/* Subscribed managers */}
            <button
              type="button"
              onClick={() => setTab('accounts')}
              className="flex flex-col gap-1 rounded-3xl border border-sky-200/90 bg-sky-50 p-5 text-left transition hover:border-sky-300 hover:bg-sky-100/80 hover:shadow-sm"
            >
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-sky-800">Managers · Subscribed</span>
              <span className="text-3xl font-black tabular-nums text-slate-900">{accounts.filter((a) => a.enabled).length}</span>
            </button>

            {/* Calendar events */}
            <button
              type="button"
              onClick={() => setTab('calendar')}
              className="flex flex-col gap-1 rounded-3xl border border-sky-200/90 bg-sky-50 p-5 text-left transition hover:border-sky-300 hover:bg-sky-100/80 hover:shadow-sm"
            >
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-sky-800">Calendar · Events</span>
              <span className="text-3xl font-black tabular-nums text-slate-900">{calendarEventsCount}</span>
            </button>

            {/* Residents */}
            <button
              type="button"
              onClick={() => setTab('messages')}
              className="flex flex-col gap-1 rounded-3xl border border-sky-200/90 bg-sky-50 p-5 text-left transition hover:border-sky-300 hover:bg-sky-100/80 hover:shadow-sm"
            >
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-sky-800">Residents</span>
              <span className="text-3xl font-black tabular-nums text-slate-900">{residents.length}</span>
            </button>
          </div>

          {/* Inbox — full width (matches portal handoff strip) */}
          <div className="rounded-3xl border border-sky-200/90 bg-[linear-gradient(135deg,#f0f9ff_0%,#ffffff_100%)] p-5 shadow-sm">
            <button
              type="button"
              onClick={() => setTab('messages')}
              className="flex w-full flex-col gap-1 rounded-2xl border border-transparent p-0 text-left transition hover:border-sky-300/60 hover:bg-sky-50/60 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-1 sm:py-0.5"
            >
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-sky-800">Inbox · Unopened</span>
              <span className="text-3xl font-black tabular-nums text-slate-900">{unopenedThreadCount}</span>
            </button>
          </div>
        </div>
      )}

      {tab === 'properties' && (
        <div className="space-y-6">
          <div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[#2563eb]/20 bg-[#2563eb]/5 text-[#2563eb]" aria-hidden>
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
                  </svg>
                </span>
                <h1 className="text-2xl font-black text-slate-900">Properties</h1>
              </div>
              {dataLoading ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" />
                  Syncing…
                </span>
              ) : (
                <button
                  type="button"
                  onClick={refreshPortalData}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50"
                >
                  Refresh
                </button>
              )}
            </div>
            <div className="grid gap-2 rounded-[28px] border border-slate-200 bg-slate-50 p-2 sm:grid-cols-2 xl:grid-cols-5">
              {[
                ['pending', 'Pending review', pendingReviewProperties.length],
                ['request_change', 'Request change', requestChangeProperties.length],
                ['approved', 'Listed', approvedProperties.length],
                ['unlisted', 'Unlisted', unlistedProperties.length],
                ['rejected', 'Rejected', rejectedProperties.length],
              ].map(([key, label, count]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPropertiesSection(key)}
                  className={`rounded-2xl border px-4 py-3 text-left transition ${
                    propertiesSection === key
                      ? 'border-[#2563eb]/30 bg-white text-slate-900 shadow-[0_10px_24px_rgba(37,99,235,0.14)]'
                      : 'border-transparent text-slate-600 hover:border-slate-200 hover:bg-white/70 hover:text-slate-900'
                  }`}
                >
                  <div className="text-lg font-black leading-none tabular-nums text-slate-900">{count}</div>
                  <div className="mt-1 text-sm font-semibold">{label}</div>
                </button>
              ))}
            </div>
          </div>

          {propertyReviewQueue.rows ? (
            <>
              <DataTable
                empty={propertyReviewQueue.empty}
                columns={[
                  { key: 'n', label: 'Property', render: (d) => <><div className="font-semibold">{d.name}</div><div className="text-xs text-slate-500">{d.address}</div></> },
                  { key: 'o', label: 'Manager', render: (d) => ownerLabel(d.ownerId) },
                  { key: 's', label: 'Status', render: (d) => <StatusPill tone={propertyTone(d.status)}>{PROPERTY_STATUS_LABEL[d.status] || d.status}</StatusPill> },
                  { key: 'dt', label: 'Submitted', render: (d) => new Date(d.submittedAt).toLocaleDateString() },
                  { key: 'a', label: '', render: (d) => (
                    <button
                      type="button"
                      className="text-sm font-semibold text-[#2563eb]"
                      onClick={() => setSelectedApprovalId(selectedApprovalId === d.id ? null : d.id)}
                    >
                      {selectedApprovalId === d.id ? 'Hide' : 'Review'}
                    </button>
                  ) },
                ]}
                rows={propertyReviewQueue.rows.map((p) => ({ key: p.id, data: p }))}
              />
              {approval ? (
                <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-lg font-black">{approval.name}</h2>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {propertiesSection === 'request_change' ? (
                        <button
                          type="button"
                          disabled={approvalBusy}
                          onClick={async () => {
                            if (!window.confirm(`Permanently delete "${approval.name}"? This cannot be undone.`)) return
                            if (!approval?.id) return
                            setApprovalBusy(true)
                            try {
                              await adminDeleteProperty(approval.id)
                              toast.success('Property deleted')
                              setSelectedApprovalId(null)
                              await refreshPortalData()
                            } catch (err) {
                              toast.error(err.message || 'Delete failed')
                            } finally {
                              setApprovalBusy(false)
                            }
                          }}
                          className={`${adminPropToolbarBtn} text-red-700`}
                        >
                          {approvalBusy ? 'Working…' : 'Delete property'}
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            disabled={approvalBusy}
                            className={`${adminPropToolbarBtn} text-emerald-700`}
                            onClick={async () => {
                              if (!approval?.id) return
                              setApprovalBusy(true)
                              try {
                                await adminApproveProperty(approval.id)
                                await refreshPortalData()
                                toast.success('Property approved')
                                setSelectedApprovalId(null)
                              } catch (e) {
                                toast.error(e?.message || 'Approve failed')
                              } finally {
                                setApprovalBusy(false)
                              }
                            }}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            disabled={approvalBusy}
                            className={`${adminPropToolbarBtn} text-amber-900`}
                            onClick={() => {
                              if (!approval?.id) return
                              setRequestEditsNotes(String(approval.editRequestNotes || ''))
                              setRequestEditsModalOpen(true)
                            }}
                          >
                            Request edits
                          </button>
                          <button
                            type="button"
                            disabled={approvalBusy}
                            className={`${adminPropToolbarBtn} text-red-700`}
                            onClick={async () => {
                              if (!approval?.id) return
                              setApprovalBusy(true)
                              try {
                                await adminRejectProperty(approval.id)
                                await refreshPortalData()
                                toast.success('Property rejected')
                                setSelectedApprovalId(null)
                              } catch (e) {
                                toast.error(e?.message || 'Reject failed')
                              } finally {
                                setApprovalBusy(false)
                              }
                            }}
                          >
                            Reject
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <p className="text-sm text-slate-600">{approval.description}</p>
                  <PropertyDetailPanel property={approval} ownerLabel={ownerLabel(approval.ownerId)} />
                  {approval.editRequestNotes ? (
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800">
                      <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Current notes for manager</div>
                      <p className="mt-2 whitespace-pre-wrap">{approval.editRequestNotes}</p>
                    </div>
                  ) : null}
                  <AdminPropertyInternalNotesEditor
                    recordId={approval.id}
                    savedValue={approval.adminNotesInternal}
                    formDisabled={approvalBusy}
                    onSaved={refreshPortalData}
                  />
                </div>
              ) : null}
            </>
          ) : propertiesSection === 'approved' ? (
            <>
              <DataTable
                empty="No listed properties"
                columns={[
                  { key: 'n', label: 'Property', render: (d) => <><div className="font-semibold">{d.name}</div><div className="text-xs text-slate-500">{d.address}</div></> },
                  { key: 'o', label: 'Manager', render: (d) => ownerLabel(d.ownerId) },
                  { key: 's', label: 'Status', render: (d) => <StatusPill tone={propertyTone(d.status)}>{PROPERTY_STATUS_LABEL[d.status] || d.status}</StatusPill> },
                  { key: 'a', label: '', render: (d) => (
                    <button type="button" className="text-sm font-semibold text-[#2563eb]" onClick={() => setSelectedApprovalId(selectedApprovalId === d.id ? null : d.id)}>
                      {selectedApprovalId === d.id ? 'Hide' : 'Details'}
                    </button>
                  ) },
                ]}
                rows={searchedApprovedProperties.map((p) => ({ key: p.id, data: p }))}
              />
              {approval && propertiesSection === 'approved' ? (
                <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="text-lg font-black">{approval.name}</h2>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <button
                        type="button"
                        disabled={approvalBusy}
                        onClick={async () => {
                          if (!window.confirm(`Unlist "${approval.name}"? It will stay in the portal but hide from the public site.`)) return
                          setApprovalBusy(true)
                          try {
                            await adminUnlistProperty(approval.id)
                            toast.success('Property unlisted')
                            setSelectedApprovalId(null)
                            await refreshPortalData()
                          } catch (err) {
                            toast.error(err.message || 'Unlist failed (add a "Listed" checkbox on Properties if missing).')
                          } finally {
                            setApprovalBusy(false)
                          }
                        }}
                        className={`${adminPropToolbarBtn} text-slate-800`}
                      >
                        Unlist
                      </button>
                      <button
                        type="button"
                        disabled={approvalBusy}
                        onClick={() => {
                          if (!approval?.id) return
                          setRequestEditsNotes(String(approval.editRequestNotes || ''))
                          setRequestEditsModalOpen(true)
                        }}
                        className={`${adminPropToolbarBtn} text-amber-900`}
                      >
                        Request edits
                      </button>
                      <button
                        type="button"
                        disabled={approvalBusy}
                        onClick={async () => {
                          if (!window.confirm(`Permanently delete "${approval.name}"? This cannot be undone.`)) return
                          setApprovalBusy(true)
                          try {
                            await adminDeleteProperty(approval.id)
                            toast.success('Property deleted')
                            setSelectedApprovalId(null)
                            await refreshPortalData()
                          } catch (err) {
                            toast.error(err.message || 'Delete failed')
                          } finally {
                            setApprovalBusy(false)
                          }
                        }}
                        className={`${adminPropToolbarBtn} text-red-700`}
                      >
                        {approvalBusy ? 'Working…' : 'Delete property'}
                      </button>
                    </div>
                  </div>
                  <p className="text-sm text-slate-600">{approval.description}</p>
                  <PropertyDetailPanel property={approval} ownerLabel={ownerLabel(approval.ownerId)} />
                  <AdminPropertyInternalNotesEditor
                    recordId={approval.id}
                    savedValue={approval.adminNotesInternal}
                    formDisabled={approvalBusy}
                    onSaved={refreshPortalData}
                  />
                </div>
              ) : null}
            </>
          ) : propertiesSection === 'unlisted' ? (
            <>
              <DataTable
                empty="No unlisted properties"
                columns={[
                  { key: 'n', label: 'Property', render: (d) => <><div className="font-semibold">{d.name}</div><div className="text-xs text-slate-500">{d.address}</div></> },
                  { key: 'o', label: 'Manager', render: (d) => ownerLabel(d.ownerId) },
                  { key: 's', label: 'Status', render: (d) => <StatusPill tone={propertyTone(d.status)}>{PROPERTY_STATUS_LABEL[d.status] || d.status}</StatusPill> },
                  { key: 'a', label: '', render: (d) => (
                    <button type="button" className="text-sm font-semibold text-[#2563eb]" onClick={() => setSelectedApprovalId(selectedApprovalId === d.id ? null : d.id)}>
                      {selectedApprovalId === d.id ? 'Hide' : 'Details'}
                    </button>
                  ) },
                ]}
                rows={searchedUnlistedProperties.map((p) => ({ key: p.id, data: p }))}
              />
              {approval && propertiesSection === 'unlisted' ? (
                <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="text-lg font-black">{approval.name}</h2>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <button
                        type="button"
                        disabled={approvalBusy}
                        onClick={async () => {
                          setApprovalBusy(true)
                          try {
                            await adminRelistProperty(approval.id)
                            toast.success('Property listed again')
                            setSelectedApprovalId(null)
                            await refreshPortalData()
                          } catch (err) {
                            toast.error(err.message || 'Relist failed (add a "Listed" checkbox on Properties if missing).')
                          } finally {
                            setApprovalBusy(false)
                          }
                        }}
                        className={`${adminPropToolbarBtn} text-emerald-700`}
                      >
                        Relist
                      </button>
                      <button
                        type="button"
                        disabled={approvalBusy}
                        onClick={() => {
                          if (!approval?.id) return
                          setRequestEditsNotes(String(approval.editRequestNotes || ''))
                          setRequestEditsModalOpen(true)
                        }}
                        className={`${adminPropToolbarBtn} text-amber-900`}
                      >
                        Request edits
                      </button>
                      <button
                        type="button"
                        disabled={approvalBusy}
                        onClick={async () => {
                          if (!window.confirm(`Permanently delete "${approval.name}"? This cannot be undone.`)) return
                          setApprovalBusy(true)
                          try {
                            await adminDeleteProperty(approval.id)
                            toast.success('Property deleted')
                            setSelectedApprovalId(null)
                            await refreshPortalData()
                          } catch (err) {
                            toast.error(err.message || 'Delete failed')
                          } finally {
                            setApprovalBusy(false)
                          }
                        }}
                        className={`${adminPropToolbarBtn} text-red-700`}
                      >
                        {approvalBusy ? 'Working…' : 'Delete property'}
                      </button>
                    </div>
                  </div>
                  <p className="text-sm text-slate-600">Hidden from the public marketing site; still approved in Axis.</p>
                  <p className="text-sm text-slate-600">{approval.description}</p>
                  <PropertyDetailPanel property={approval} ownerLabel={ownerLabel(approval.ownerId)} />
                  <AdminPropertyInternalNotesEditor
                    recordId={approval.id}
                    savedValue={approval.adminNotesInternal}
                    formDisabled={approvalBusy}
                    onSaved={refreshPortalData}
                  />
                </div>
              ) : null}
            </>
          ) : (
            <>
              <DataTable
                empty="No rejected properties"
                columns={[
                  { key: 'n', label: 'Property', render: (d) => <><div className="font-semibold">{d.name}</div><div className="text-xs text-slate-500">{d.address}</div></> },
                  { key: 'o', label: 'Manager', render: (d) => ownerLabel(d.ownerId) },
                  { key: 's', label: 'Status', render: (d) => <StatusPill tone={propertyTone(d.status)}>{PROPERTY_STATUS_LABEL[d.status] || d.status}</StatusPill> },
                  { key: 'dt', label: 'Submitted', render: (d) => new Date(d.submittedAt).toLocaleDateString() },
                  { key: 'a', label: '', render: (d) => (
                    <button type="button" className="text-sm font-semibold text-[#2563eb]" onClick={() => setSelectedApprovalId(selectedApprovalId === d.id ? null : d.id)}>
                      {selectedApprovalId === d.id ? 'Hide' : 'Details'}
                    </button>
                  ) },
                ]}
                rows={searchedRejectedProperties.map((p) => ({ key: p.id, data: p }))}
              />
              {approval && propertiesSection === 'rejected' ? (
                <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="text-lg font-black">{approval.name}</h2>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <button
                        type="button"
                        disabled={approvalBusy}
                        className={`${adminPropToolbarBtn} text-amber-900`}
                        onClick={async () => {
                          if (!approval?.id) return
                          setApprovalBusy(true)
                          try {
                            await adminUnrejectProperty(approval.id)
                            await refreshPortalData()
                            toast.success('Property moved back to pending review')
                            setPropertiesSection('pending')
                            setSelectedApprovalId(null)
                          } catch (e) {
                            toast.error(e?.message || 'Could not move property back to pending')
                          } finally {
                            setApprovalBusy(false)
                          }
                        }}
                      >
                        Unreject (move to pending)
                      </button>
                    </div>
                  </div>
                  <p className="text-sm text-slate-600">{approval.description}</p>
                  <PropertyDetailPanel property={approval} ownerLabel={ownerLabel(approval.ownerId)} />
                  <AdminPropertyInternalNotesEditor
                    recordId={approval.id}
                    savedValue={approval.adminNotesInternal}
                    formDisabled={approvalBusy}
                    onSaved={refreshPortalData}
                  />
                </div>
              ) : null}
            </>
          )}
          {requestEditsModalOpen && approval ? (
            <Modal
              onClose={() => {
                if (!approvalBusy) setRequestEditsModalOpen(false)
              }}
            >
              <h3 className="pr-10 text-lg font-black text-slate-900">Request edits from manager</h3>
              <p className="mt-2 text-sm text-slate-600">
                The listing will be unlisted until the manager updates and resubmits. Describe what they should change (required).
              </p>
              <label className="mt-4 block text-sm font-semibold text-slate-800" htmlFor="axis-admin-edit-request-notes">
                Notes for manager <span className="text-red-600">*</span>
              </label>
              <textarea
                id="axis-admin-edit-request-notes"
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-300 focus:ring-1 focus:ring-slate-200"
                rows={6}
                value={requestEditsNotes}
                onChange={(e) => setRequestEditsNotes(e.target.value)}
                placeholder="e.g. Update room 2 rent, add parking fee, and fix the address spelling."
              />
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  disabled={approvalBusy}
                  className={`${adminPropToolbarBtn} px-4 py-2 text-sm text-slate-700`}
                  onClick={() => setRequestEditsModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={approvalBusy || !requestEditsNotes.trim()}
                  className={`${adminPropToolbarBtn} px-4 py-2 text-sm text-amber-900 disabled:opacity-50`}
                  onClick={async () => {
                    if (!approval?.id) return
                    setApprovalBusy(true)
                    try {
                      await adminRequestPropertyEdits(approval.id, requestEditsNotes)
                      await refreshPortalData()
                      toast.success('Edit request sent — property unlisted until the manager resubmits')
                      setRequestEditsModalOpen(false)
                      setSelectedApprovalId(null)
                      setPropertiesSection('request_change')
                    } catch (e) {
                      toast.error(
                        e?.message ||
                          'Update failed. Add long-text field "Admin Edit Request" (or set VITE_AIRTABLE_PROPERTY_EDIT_REQUEST_FIELD) on Properties.',
                      )
                    } finally {
                      setApprovalBusy(false)
                    }
                  }}
                >
                  {approvalBusy ? 'Saving…' : 'Send to manager'}
                </button>
              </div>
            </Modal>
          ) : null}
        </div>
      )}

      {tab === 'accounts' && ((
        () => {
          const selectedManagerAccount = accounts.find((a) => a.id === selectedManagerAccountId) ?? null
          return (
            <div className="space-y-6">
              <div>
                <div className="mb-4">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[#2563eb]/20 bg-[#2563eb]/5 text-[#2563eb]" aria-hidden>
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor" aria-hidden>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
                      </svg>
                    </span>
                    <h1 className="text-2xl font-black text-slate-900">Managers</h1>
                  </div>
                </div>
                <div className="grid gap-2 rounded-[28px] border border-slate-200 bg-slate-50 p-2 sm:grid-cols-2">
                  {[['current', 'Current subscribers', accounts.filter((a) => a.enabled !== false).length], ['past', 'Past subscribers', accounts.filter((a) => a.enabled === false).length]].map(([key, label, count]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => { setManagersFilter(key); setSelectedManagerAccountId(null) }}
                      className={`rounded-2xl border px-4 py-3 text-left transition ${
                        managersFilter === key
                          ? 'border-[#2563eb]/30 bg-white text-slate-900 shadow-[0_10px_24px_rgba(37,99,235,0.14)]'
                          : 'border-transparent text-slate-600 hover:border-slate-200 hover:bg-white/70 hover:text-slate-900'
                      }`}
                    >
                      <div className="text-lg font-black leading-none tabular-nums text-slate-900">{count}</div>
                      <div className="mt-1 text-sm font-semibold">{label}</div>
                    </button>
                  ))}
                </div>
              </div>
              <DataTable
                empty={`No ${managersFilter === 'current' ? 'active' : 'past'} managers`}
                columns={[
                  { key: 'n', label: 'Account', render: (d) => <><div className="font-semibold">{d.businessName || d.name}</div><div className="text-xs text-slate-500">{d.email}</div></> },
                  { key: 'h', label: 'House / property', render: (d) => <span className="text-slate-700">{d.managedHousesLabel || '—'}</span> },
                  { key: 'v', label: 'Verification', render: (d) => <StatusPill tone={d.verificationStatus === 'verified' ? 'green' : 'amber'}>{d.verificationStatus}</StatusPill> },
                  { key: 'p', label: 'Properties', render: (d) => d.propertyCount },
                  { key: 'act', label: '', render: (d) => (
                    <button
                      type="button"
                      className="text-sm font-semibold text-[#2563eb] hover:underline"
                      onClick={() => setSelectedManagerAccountId(selectedManagerAccountId === d.id ? null : d.id)}
                    >
                      {selectedManagerAccountId === d.id ? 'Hide details' : 'Details'}
                    </button>
                  ) },
                ]}
                rows={searchedAccounts.map((a) => ({ key: a.id, data: a }))}
              />
              {selectedManagerAccount ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="mb-5 flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-lg font-black text-slate-900">{selectedManagerAccount.businessName || selectedManagerAccount.name}</h2>
                      <p className="mt-0.5 text-sm text-slate-500">{selectedManagerAccount.email}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedManagerAccountId(null)}
                      className="rounded-lg p-1 text-slate-400 hover:text-slate-600"
                      aria-label="Close"
                    >
                      <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                    </button>
                  </div>
                  <dl className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">House / property</dt>
                      <dd className="mt-1 text-sm text-slate-800">{selectedManagerAccount.managedHousesLabel || '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Properties</dt>
                      <dd className="mt-1 text-sm text-slate-800">{selectedManagerAccount.propertyCount}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Verification</dt>
                      <dd className="mt-1"><StatusPill tone={selectedManagerAccount.verificationStatus === 'verified' ? 'green' : 'amber'}>{selectedManagerAccount.verificationStatus}</StatusPill></dd>
                    </div>
                    <div>
                      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Status</dt>
                      <dd className="mt-1"><StatusPill tone={selectedManagerAccount.enabled !== false ? 'green' : 'red'}>{selectedManagerAccount.enabled !== false ? 'Active' : 'Disabled'}</StatusPill></dd>
                    </div>
                  </dl>
                  <div className="mt-6 border-t border-slate-100 pt-5">
                    <button
                      type="button"
                      disabled={managerActionBusy}
                      className={`rounded-2xl px-5 py-2.5 text-sm font-semibold transition disabled:opacity-50 ${
                        selectedManagerAccount.enabled !== false
                          ? 'bg-red-50 text-red-700 hover:bg-red-100'
                          : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                      }`}
                      onClick={async () => {
                        const next = selectedManagerAccount.enabled === false
                        setManagerActionBusy(true)
                        setAccounts((ac) => ac.map((x) => (x.id === selectedManagerAccount.id ? { ...x, enabled: next } : x)))
                        try {
                          await adminSetManagerActive(selectedManagerAccount.id, next)
                          toast.success(next ? 'Manager account enabled' : 'Manager account disabled')
                          await refreshPortalData()
                        } catch (err) {
                          toast.error(err?.message || 'Could not update manager')
                          await refreshPortalData()
                        } finally {
                          setManagerActionBusy(false)
                        }
                      }}
                    >
                      {managerActionBusy ? 'Saving…' : selectedManagerAccount.enabled !== false ? 'Disable account' : 'Enable account'}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )
        }
      )())}

      {tab === 'leasing' && (
        <AdminLeasingTab adminUser={user} accounts={accounts} />
      )}

      {tab === 'messages' && (
        <ManagerInboxPage
          adminFullInbox
          manager={{ email: user.email || '', name: user.name || user.email || 'Admin' }}
          allowedPropertyNames={[]}
          adminComposeManagers={accounts
            .filter((a) => String(a.email || '').includes('@'))
            .map((a) => ({
              id: a.id,
              email: String(a.email).trim().toLowerCase(),
              label: `${a.businessName || a.name || 'Manager'} · ${a.email}`,
            }))}
          adminComposeResidents={residents
            .filter((r) => r.id && String(r.id).startsWith('rec'))
            .map((r) => ({
              id: r.id,
              email: String(r.Email || '').trim(),
              label: [r.Name, r.House].filter(Boolean).join(' · ') || String(r.Email || r.id),
            }))}
        />
      )}

      {tab === 'calendar' && (
        <Suspense
          fallback={(
            <div className="rounded-3xl border border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500">
              Loading calendar…
            </div>
          )}
        >
          <AdminPortalCalendarTab
            loadAllSchedulingRows
            manager={{ email: user?.email || '', name: user?.name || user?.email || 'Admin' }}
            allowedPropertyNames={[]}
          />
        </Suspense>
      )}

      {tab === 'profile' && (
        <AdminProfilePanel
          user={user}
          onUserUpdate={(partial) => {
            setSession((prev) => {
              if (!prev) return prev
              const next = { ...prev, ...partial }
              try {
                sessionStorage.setItem(AXIS_ADMIN_SESSION_KEY, JSON.stringify(next))
              } catch {
                /* ignore */
              }
              return next
            })
          }}
        />
      )}
      </div>
    </PortalShell>
  )
}

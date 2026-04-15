import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  HOUSING_MESSAGE_CATEGORIES,
  normalizeHousingMessageCategoryId,
} from '../lib/housingSite'
import {
  housingPublicAdminPropertyConversationThread,
  housingPublicAdminGeneralConversationThread,
  PORTAL_INBOX_CHANNEL_INTERNAL,
  portalInboxAirtableConfigured,
  sendMessage,
  siteManagerConversationThreadKey,
} from '../lib/airtable'
import { errorFromAirtableApiBody } from '../lib/airtablePermissionError'

const AIRTABLE_BASE_ID = import.meta.env.VITE_AIRTABLE_BASE_ID || 'appol57LKtMKaQ75T'
const AIRTABLE_TOKEN = import.meta.env.VITE_AIRTABLE_TOKEN

export const inputCls =
  'w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder-slate-400 outline-none transition focus:border-axis focus:bg-white focus:ring-2 focus:ring-axis/20'
export const selectCls = `${inputCls} appearance-none cursor-pointer`

export const DEFAULT_PROPERTIES = [
  { id: '4709a', name: '4709A 8th Ave', address: '4709A 8th Ave NE, Seattle, WA', managerEmail: '', rooms: ['Room 1', 'Room 2', 'Room 3', 'Room 4', 'Room 5', 'Room 6', 'Room 7', 'Room 8', 'Room 9', 'Room 10'] },
  { id: '4709b', name: '4709B 8th Ave', address: '4709B 8th Ave NE, Seattle, WA', managerEmail: '', rooms: ['Room 1', 'Room 2', 'Room 3', 'Room 4', 'Room 5', 'Room 6', 'Room 7', 'Room 8', 'Room 9'] },
  { id: '5259', name: '5259 Brooklyn Ave NE', address: '5259 Brooklyn Ave NE, Seattle, WA', managerEmail: '', rooms: ['Room 1', 'Room 2', 'Room 3', 'Room 4', 'Room 5', 'Room 6', 'Room 7', 'Room 8', 'Room 9'] },
]

function looksLikeEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim())
}

/** Routes public housing messages: each submit gets a new Thread Key (never merged by property/email alone). */
function housingMessageThreadKey(selectedProperty) {
  if (!selectedProperty) {
    return {
      threadKey: housingPublicAdminGeneralConversationThread(),
      routeLine: 'Portal route: Admin · general inquiry (no property selected)',
    }
  }
  const mgrEmail = [selectedProperty.managerEmail, selectedProperty.manager].find((x) => looksLikeEmail(x))
  if (mgrEmail) {
    const e = String(mgrEmail).trim().toLowerCase()
    return {
      threadKey: siteManagerConversationThreadKey(e),
      routeLine: `Portal route: Site manager inbox (${e})`,
    }
  }
  return {
    threadKey: housingPublicAdminPropertyConversationThread(selectedProperty.id),
    routeLine:
      'Portal route: Admin · property inquiry (add a “Site Manager Email” field or Notes line “Site Manager Email: …” on this property to route to the manager portal)',
  }
}

export function formatPhone(raw) {
  const digits = raw.replace(/\D/g, '').slice(0, 10)
  if (digits.length < 4) return digits
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}

function normalizeRoomKey(s) {
  return String(s || '')
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

function matchPropertyParamToId(propertyParam, propsList) {
  const raw = String(propertyParam || '').trim()
  if (!raw || !propsList?.length) return null
  const lower = raw.toLowerCase()
  const normalizedSlug = slugify(raw)

  const byId = propsList.find((p) => String(p.id || '').trim().toLowerCase() === lower)
  if (byId) return byId.id

  const byName = propsList.find((p) => String(p.name || '').trim().toLowerCase() === lower)
  if (byName) return byName.id

  const bySlug = propsList.find((p) => slugify(p.name) === normalizedSlug)
  if (bySlug) return bySlug.id

  return null
}

function matchHouseToPropertyId(house, propsList) {
  const h = String(house || '').trim().toLowerCase()
  if (!h || !propsList?.length) return null
  const byId = [...propsList].sort((a, b) => String(b.id).length - String(a.id).length)
  for (const p of byId) {
    if (h.includes(String(p.id).toLowerCase())) return p.id
  }
  for (const p of propsList) {
    const n = (p.name || '').toLowerCase()
    if (n.length >= 4 && h.includes(n)) return p.id
  }
  return null
}

function pickRoomFromUnit(unitRaw, roomList) {
  if (!roomList?.length) return ''
  const norm = String(unitRaw || '').replace(/^Unit\s+/i, 'Room ').trim()
  if (!norm) return ''
  const nk = normalizeRoomKey(norm)
  const exact = roomList.find((r) => normalizeRoomKey(r) === nk)
  if (exact) return exact
  const num = norm.match(/\d+/)?.[0]
  if (num) {
    const byNum = roomList.find((r) => r.replace(/\D/g, '') === num)
    if (byNum) return byNum
  }
  return ''
}

function MessageSentSuccess({ email, onReset }) {
  return (
    <div className="flex flex-col items-center gap-4 py-10 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-50">
        <svg className="h-7 w-7 text-axis" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <div>
        <p className="text-lg font-black text-slate-900">Message sent!</p>
        <p className="mt-1 text-sm text-slate-500">We&apos;ll follow up at {email} within 2 business days</p>
      </div>
      <button type="button" onClick={onReset} className="mt-2 text-xs font-semibold text-axis hover:underline">
        Send another
      </button>
    </div>
  )
}

export function PropertyRoomPicker({
  properties,
  selectedId,
  onSelectProperty,
  room,
  onSelectRoom,
  roomRequired = true,
  idPrefix = 'housing',
}) {
  const [propertyQuery, setPropertyQuery] = useState('')
  const sorted = useMemo(() => [...properties].sort((a, b) => a.name.localeCompare(b.name)), [properties])

  const displayProperties = useMemo(() => {
    const q = propertyQuery.trim().toLowerCase()
    const filtered = q
      ? sorted.filter(
          (prop) =>
            prop.name.toLowerCase().includes(q) || (prop.address || '').toLowerCase().includes(q)
        )
      : sorted
    const sel = sorted.find((x) => x.id === selectedId)
    if (sel && !filtered.some((x) => x.id === selectedId)) {
      return [sel, ...filtered]
    }
    return filtered
  }, [sorted, propertyQuery, selectedId])

  const p = sorted.find((x) => x.id === selectedId)
  const propSelectId = `${idPrefix}-property`
  const roomSelectId = `${idPrefix}-room`
  const searchId = `${idPrefix}-property-search`

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor={propSelectId} className="mb-2 block text-sm font-semibold text-slate-700">
          Property{' '}
          <span className="font-normal text-slate-400">{roomRequired ? '(required)' : '(optional)'}</span>
        </label>
        {sorted.length > 3 ? (
          <>
            <label htmlFor={searchId} className="sr-only">
              Search properties by name or address
            </label>
            <input
              id={searchId}
              type="search"
              className={`${inputCls} mb-3`}
              placeholder="Search by name or address…"
              value={propertyQuery}
              onChange={(e) => setPropertyQuery(e.target.value)}
              autoComplete="off"
            />
          </>
        ) : null}
        <select
          id={propSelectId}
          className={selectCls}
          value={selectedId || ''}
          onChange={(e) => {
            const v = e.target.value
            onSelectProperty(v || null)
            onSelectRoom('')
          }}
        >
          <option value="">{roomRequired ? 'Select a property…' : 'No specific property'}</option>
          {displayProperties.map((prop) => (
            <option key={prop.id} value={prop.id}>
                {prop.name}
            </option>
          ))}
        </select>
        {sorted.length > 3 && displayProperties.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No properties match that search</p>
        ) : null}
        {p ? (
          <p className="mt-2 text-xs font-medium text-[#2563eb]">
            {p.address || p.manager ? (
              <>
                {p.address || ''}
                {p.address && p.manager ? ' | ' : ''}
                {p.manager ? `Manager: ${p.manager}` : ''}
              </>
            ) : null}
          </p>
        ) : null}
      </div>
      {p ? (
        <div>
          <label htmlFor={roomSelectId} className="mb-2 block text-sm font-semibold text-slate-700">
            Room <span className="font-normal text-slate-400">{roomRequired ? '(required)' : '(optional)'}</span>
          </label>
          <select
            id={roomSelectId}
            className={selectCls}
            value={room}
            onChange={(e) => onSelectRoom(e.target.value)}
          >
            <option value="">{roomRequired ? 'Select a room…' : 'No specific room'}</option>
            {(p.rooms || []).map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
            <option value="Not sure yet">Not sure yet</option>
          </select>
        </div>
      ) : null}
    </div>
  )
}

/**
 * @param {'marketing' | 'resident'} [props.variant]
 * @param {{ name?: string, email?: string, phone?: string, house?: string, unitNumber?: string }} [props.prefill]
 * @param {string} [props.formIdPrefix] — ids for inputs (accessibility)
 */
export function HousingMessageForm({ variant = 'marketing', prefill = null, formIdPrefix = 'housing-msg' }) {
  const location = useLocation()
  const [properties, setProperties] = useState([])
  const [propertiesLoading, setPropertiesLoading] = useState(true)
  const [property, setProperty] = useState(null)
  const [room, setRoom] = useState('')
  const [category, setCategory] = useState('')
  const [otherDetails, setOtherDetails] = useState('')
  const [form, setFormState] = useState({ name: '', email: '', phone: '', message: '' })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  const selectedProperty = properties.find((p) => p.id === property)

  function set(k, v) {
    setFormState((prev) => ({ ...prev, [k]: v }))
  }

  useEffect(() => {
    if (variant !== 'marketing') return
    const raw = new URLSearchParams(location.search).get('category') || ''
    const id = normalizeHousingMessageCategoryId(raw)
    if (id) setCategory(id)
  }, [location.search, variant])

  useEffect(() => {
    if (properties.length === 0) return
    const params = new URLSearchParams(location.search)
    const propertyParam = params.get('property') || ''
    const roomParam = params.get('room') || ''
    if (!propertyParam) return

    const matchedPropertyId = matchPropertyParamToId(propertyParam, properties)
    if (!matchedPropertyId) return

    setProperty(matchedPropertyId)
    const prop = properties.find((p) => p.id === matchedPropertyId)
    const pickedRoom = pickRoomFromUnit(roomParam, prop?.rooms || [])
    setRoom(pickedRoom || '')
  }, [location.search, properties])

  useEffect(() => {
    let cancelled = false
    fetch('/api/forms?action=tour')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        const normalize = (list) =>
          list.map((p) => ({
            ...p,
            managerEmail: p.managerEmail != null ? String(p.managerEmail) : '',
            rooms: p.rooms?.length ? p.rooms : DEFAULT_PROPERTIES.find((f) => f.id === p.id)?.rooms || [],
          }))
        if (Array.isArray(data?.properties)) {
          setProperties(normalize(data.properties))
          return
        }
        setProperties([])
      })
      .catch(() => {
        if (!cancelled) {
          setProperties([])
        }
      })
      .finally(() => {
        if (!cancelled) setPropertiesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!prefill || variant !== 'resident') return
    setFormState((prev) => ({
      ...prev,
      name: prefill.name?.trim() || prev.name,
      email: prefill.email?.trim() || prev.email,
      phone: prefill.phone ? formatPhone(prefill.phone) : prev.phone,
    }))
  }, [prefill, variant])

  useEffect(() => {
    if (!prefill?.house || variant !== 'resident' || properties.length === 0) return
    const id = matchHouseToPropertyId(prefill.house, properties)
    if (!id) return
    setProperty(id)
    const prop = properties.find((p) => p.id === id)
    const rooms = prop?.rooms || []
    const picked = pickRoomFromUnit(prefill.unitNumber, rooms)
    if (picked) setRoom(picked)
  }, [prefill, properties, variant])

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    if (!category) {
      setError('Please select what you need help with.')
      setSubmitting(false)
      return
    }
    if (category === 'other' && !otherDetails.trim()) {
      setError('Please describe what you need help with.')
      setSubmitting(false)
      return
    }
    if (category !== 'other' && !form.message.trim()) {
      setError('Please add a short message.')
      setSubmitting(false)
      return
    }
    const catLabel = HOUSING_MESSAGE_CATEGORIES.find((c) => c.id === category)?.label || category
    const { threadKey, routeLine } = housingMessageThreadKey(selectedProperty)
    const contactBlock = `From: ${form.name.trim() || '—'}\nEmail: ${form.email}\nPhone: ${form.phone || '—'}\n\n`
    let header = `${routeLine}\n\nCategory: ${catLabel}\n\n`
    if (variant === 'resident') {
      header += 'Source: Resident portal\n\n'
    }
    if (category === 'other' && otherDetails.trim()) {
      header += `Details: ${otherDetails.trim()}\n\n`
    }
    if (selectedProperty) {
      header += `Property: ${selectedProperty.name}\n`
      if (room) header += `Room: ${room}\n`
      header += '\n'
    }
    const messageSummary = contactBlock + header + form.message
    try {
      if (portalInboxAirtableConfigured()) {
        try {
          await sendMessage({
            senderEmail: form.email,
            message: messageSummary,
            isAdmin: false,
            threadKey,
            channel: PORTAL_INBOX_CHANNEL_INTERNAL,
            subject: `[Housing] ${catLabel}`,
          })
        } catch (portalErr) {
          console.warn('[HousingMessageForm] Messages table write failed (inquiry may still be saved):', portalErr)
        }
      }

      const inquiryUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Inquiries`
      const res = await fetch(inquiryUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: {
            'Full Name': form.name,
            Email: form.email,
            'Phone Number': form.phone,
            'Inquiry Type': 'Housing',
            'Message Summary': messageSummary,
          },
          typecast: true,
        }),
      })
      const inquiryBody = await res.text()
      const permErr = errorFromAirtableApiBody(res.url || inquiryUrl, inquiryBody)
      if (permErr) throw permErr
      if (!res.ok) throw new Error(`Error ${res.status}`)
      setSubmitted(true)
    } catch (err) {
      setError(err.message || 'Submission failed.')
    } finally {
      setSubmitting(false)
    }
  }

  function handleReset() {
    setSubmitted(false)
    setCategory('')
    setOtherDetails('')
    if (variant === 'resident' && prefill) {
      setFormState({
        name: prefill.name?.trim() || '',
        email: prefill.email?.trim() || '',
        phone: prefill.phone ? formatPhone(prefill.phone) : '',
        message: '',
      })
      const id = matchHouseToPropertyId(prefill.house, properties)
      if (id) {
        setProperty(id)
        const prop = properties.find((p) => p.id === id)
        setRoom(pickRoomFromUnit(prefill.unitNumber, prop?.rooms || []))
      } else {
        setProperty(null)
        setRoom('')
      }
    } else {
      setProperty(null)
      setRoom('')
      setFormState({ name: '', email: '', phone: '', message: '' })
    }
  }

  if (submitted) {
    return <MessageSentSuccess email={form.email} onReset={handleReset} />
  }

  const categoryId = `${formIdPrefix}-category`
  const otherId = `${formIdPrefix}-other`

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <h3 className="mb-1 text-lg font-bold tracking-tight text-slate-900">Topic</h3>
        <p className="mb-4 text-sm text-slate-500">
          {variant === 'resident' ? (
            <>
              For rent, payments, or maintenance, use <strong>Payments</strong> and <strong>Work Orders</strong> in this portal.
              Messages here go to leasing for lease questions, the neighborhood, availability, and similar topics.
            </>
          ) : (
            <>
              For rent, payments, maintenance, or portal login issues, use the{' '}
              <Link to="/portal" className="font-semibold text-axis underline decoration-axis/30 underline-offset-2 hover:decoration-axis">
                resident portal
              </Link>
              . These topics are for leasing questions, the area around our homes, and availability.
            </>
          )}
        </p>
        <div>
          <label htmlFor={categoryId} className="mb-2 block text-sm font-semibold text-slate-700">
            What do you need help with? <span className="text-axis">*</span>
          </label>
          <select
            id={categoryId}
            required
            value={category}
            onChange={(e) => {
              const next = e.target.value
              setCategory(next)
              if (next !== 'other') setOtherDetails('')
            }}
            className={selectCls}
          >
            <option value="" disabled>
              Select a topic
            </option>
            {HOUSING_MESSAGE_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          {category === 'other' ? (
            <div className="mt-4">
              <label htmlFor={otherId} className="mb-2 block text-sm font-semibold text-slate-700">
                Describe what you need <span className="text-axis">*</span>
              </label>
              <textarea
                id={otherId}
                required
                value={otherDetails}
                onChange={(e) => setOtherDetails(e.target.value)}
                className={`${inputCls} min-h-[100px] resize-y`}
                placeholder="Tell us what is going on so we can route your message correctly."
              />
            </div>
          ) : null}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <h3 className="mb-1 text-lg font-bold tracking-tight text-slate-900">Property context</h3>
        <p className="mb-4 text-sm text-slate-500">
          Optional. With many homes on file, search and pick from the list instead of scrolling long pages.
        </p>
        {propertiesLoading ? (
          <p className="text-sm text-slate-500">Loading properties…</p>
        ) : properties.length === 0 ? (
          <p className="text-sm text-slate-500">No live homes are listed yet. You can still send a message without choosing a property</p>
        ) : (
          <PropertyRoomPicker
            idPrefix={formIdPrefix}
            properties={properties}
            selectedId={property}
            onSelectProperty={setProperty}
            room={room}
            onSelectRoom={setRoom}
            roomRequired={false}
          />
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <h3 className="mb-1 text-lg font-bold tracking-tight text-slate-900">Your contact &amp; message</h3>
        <p className="mb-4 text-sm text-slate-500">We will reply to the email you provide</p>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">
                Name <span className="text-axis">*</span>
              </label>
              <input
                required
                className={inputCls}
                placeholder="Jane Smith"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">
                Email <span className="text-axis">*</span>
              </label>
              <input
                required
                type="email"
                className={inputCls}
                placeholder="jane@email.com"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">Phone</label>
            <input
              type="tel"
              className={inputCls}
              placeholder="(206) 555-0100"
              value={form.phone}
              onChange={(e) => set('phone', formatPhone(e.target.value))}
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-semibold text-slate-700">
              {category === 'other' ? (
                <>
                  Additional details <span className="font-normal text-slate-400">(optional)</span>
                </>
              ) : (
                <>
                  Message <span className="text-axis">*</span>
                </>
              )}
            </label>
            <textarea
              required={category !== 'other'}
              className={`${inputCls} min-h-[120px] resize-y`}
              placeholder={category === 'other' ? 'Anything else we should know…' : 'Tell us more so we can help…'}
              value={form.message}
              onChange={(e) => set('message', e.target.value)}
            />
          </div>
        </div>
      </section>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-full bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] py-3.5 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(37,99,235,0.25)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? 'Sending…' : 'Send message'}
      </button>
    </form>
  )
}

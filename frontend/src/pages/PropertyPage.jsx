import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useParams, Link, useLocation } from 'react-router-dom'
import { usePropertyListingChrome } from '../contexts/PropertyListingChromeContext'
import PropertyGallery from '../components/PropertyGallery'
import PropertyMediaPlaceholder from '../components/PropertyMediaPlaceholder'
import MapView from '../components/Map.jsx'
import { properties } from '../data/properties'
import { fetchPropertyRecordById, propertyListingVisibleForMarketing, fetchBlockedTourDatesByName } from '../lib/airtable'
import { mapAirtableRecordToPropertyPage, marketingSlugForAirtablePropertyId } from '../lib/airtablePublicListings'
import {
  formatBathroomCountForDisplay,
  parseAvailabilityAfterStartingPhrases,
  partitionRoomListingFields,
} from '../lib/listingRoomDisplay.js'
import { Seo, buildPropertySchema } from '../lib/seo'
import { getStartingRent } from '../lib/pricing'
import Modal from '../components/Modal'
import scrollToTop from '../utils/scrollToTop'
/** Space reserved below the fixed section nav so the gallery never sits underneath (wrap, fonts, subpixels). */
const SECTION_NAV_LAYOUT_BUFFER_PX = 20

// ─── Tour availability helpers ────────────────────────────────────────────────
function extractMultilineNoteValuePublic(notes, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const startRe = new RegExp(`(?:^|\\n)${escaped}:\\s*`, 'i')
  const s = String(notes || '')
  const startMatch = s.match(startRe)
  if (!startMatch) return ''
  const after = s.slice(startMatch.index + startMatch[0].length)
  const stopMatch = after.match(/\n[A-Za-z][A-Za-z ]*:/)
  const block = stopMatch ? after.slice(0, stopMatch.index) : after
  return block.trim()
}

function tourAvailabilityFromRaw(rec) {
  const f = rec || {}
  const explicit = String(f['Tour Availability'] || f['Calendar Availability'] || '').trim()
  const fromNotes = extractMultilineNoteValuePublic(String(f['Notes'] || ''), 'Tour Availability')
  return explicit || fromNotes
}

function displayTimeFromMins(minutes) {
  const hrs24 = Math.floor(minutes / 60)
  const mins = minutes % 60
  let hrs12 = hrs24 % 12
  if (hrs12 === 0) hrs12 = 12
  const ampm = hrs24 >= 12 ? 'PM' : 'AM'
  return `${hrs12}:${String(mins).padStart(2, '0')} ${ampm}`
}

function slotsForDateFromAvailText(text, dateKey) {
  const d = new Date(`${dateKey}T00:00:00`)
  if (isNaN(d.getTime())) return []
  const dayAbbr = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]
  const slots = []
  const lines = String(text || '').split(/\n|;/).map((l) => l.trim()).filter(Boolean)
  for (const line of lines) {
    const m = line.match(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s*[:\-]\s*(.+)$/i)
    if (!m) continue
    const day = m[1][0].toUpperCase() + m[1].slice(1, 3).toLowerCase()
    if (day !== dayAbbr) continue
    const tokens = m[2].split(',').map((t) => t.trim()).filter(Boolean)
    for (const token of tokens) {
      const pair = token.match(/^(\d+)-(\d+)$/)
      if (pair) {
        const start = Number(pair[1])
        const end = Number(pair[2])
        if (end > start) slots.push(`${displayTimeFromMins(start)} - ${displayTimeFromMins(end)}`)
        continue
      }
      if (/\d+:\d+/.test(token)) slots.push(token)
    }
  }
  return slots
}

function dayHasAvailability(text, dateKey) {
  return slotsForDateFromAvailText(text, dateKey).length > 0
}

// ─── TourBookingModal ─────────────────────────────────────────────────────────
function TourBookingModal({ open, onClose, propertyName, tourAvailabilityText, propertyId }) {
  const [blockedDates, setBlockedDates] = useState(new Set())
  const [loadingBlocked, setLoadingBlocked] = useState(false)
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedTime, setSelectedTime] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  const hasAvailability = Boolean(String(tourAvailabilityText || '').trim())

  useEffect(() => {
    if (!open) return
    setSelectedDate(''); setSelectedTime(''); setName(''); setEmail(''); setPhone('')
    setNotes(''); setSubmitted(false); setError('')
    if (!propertyName) { setBlockedDates(new Set()); return }
    setLoadingBlocked(true)
    fetchBlockedTourDatesByName(propertyName)
      .then((records) => {
        const s = new Set()
        records.forEach((r) => {
          const d = String(r['Date'] || '').trim().slice(0, 10)
          if (d) s.add(d)
        })
        setBlockedDates(s)
      })
      .catch(() => setBlockedDates(new Set()))
      .finally(() => setLoadingBlocked(false))
  }, [open, propertyName])

  const availableDates = useMemo(() => {
    const dates = []
    const today = new Date()
    for (let i = 1; i <= 45; i++) {
      const d = new Date(today)
      d.setDate(today.getDate() + i)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      const blocked = blockedDates.has(key)
      const hasSlots = hasAvailability ? dayHasAvailability(tourAvailabilityText, key) : true
      dates.push({ key, date: d, blocked, hasSlots })
    }
    return dates
  }, [blockedDates, tourAvailabilityText, hasAvailability])

  const timeSlots = useMemo(() => {
    if (!selectedDate || !hasAvailability) return []
    return slotsForDateFromAvailText(tourAvailabilityText, selectedDate)
  }, [selectedDate, tourAvailabilityText, hasAvailability])

  useEffect(() => { setSelectedTime('') }, [selectedDate])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (!selectedDate) { setError('Pick a date.'); return }
    if (hasAvailability && !selectedTime) { setError('Pick a time slot.'); return }
    if (!name.trim()) { setError('Your name is required.'); return }
    if (!email.trim()) { setError('Your email is required.'); return }
    setSubmitting(true)
    try {
      const body = {
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        type: 'Tour',
        property: propertyName,
        preferredDate: selectedDate,
        preferredTime: selectedTime || 'To be confirmed',
        notes: notes.trim() || undefined,
      }
      const res = await fetch('/api/forms?action=tour', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
      setSubmitted(true)
    } catch (err) {
      setError(err.message || 'Could not book tour. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  const months = []
  availableDates.forEach(({ key, date, blocked, hasSlots }) => {
    const monthKey = key.slice(0, 7)
    const monthLabel = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    let last = months[months.length - 1]
    if (!last || last.monthKey !== monthKey) {
      months.push({ monthKey, monthLabel, days: [] })
      last = months[months.length - 1]
    }
    last.days.push({ key, date, blocked, hasSlots })
  })

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-lg font-black text-slate-900">Schedule a tour</h2>
            {propertyName && <p className="text-xs text-slate-500">{propertyName}</p>}
          </div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 text-slate-500 hover:bg-slate-50">
            ✕
          </button>
        </div>

        {submitted ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-2xl">✓</div>
            <h3 className="text-xl font-black text-slate-900">Tour request sent!</h3>
            <p className="text-sm text-slate-500">We'll confirm your tour for {selectedDate}{selectedTime ? ` at ${selectedTime}` : ''} shortly.</p>
            <button type="button" onClick={onClose} className="mt-2 rounded-full bg-axis px-6 py-2.5 text-sm font-semibold text-white">Done</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-y-auto">
            <div className="space-y-5 px-5 py-4">
              <div>
                <div className="mb-2 text-xs font-bold text-slate-700">Pick a date</div>
                {loadingBlocked ? (
                  <div className="text-xs text-slate-400">Loading availability…</div>
                ) : (
                  <div className="space-y-4">
                    {months.map(({ monthKey, monthLabel, days }) => {
                      const firstDay = new Date(monthKey + '-01T00:00:00')
                      const firstDow = firstDay.getDay()
                      return (
                        <div key={monthKey}>
                          <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">{monthLabel}</div>
                          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase tracking-wider text-slate-400">
                            {['S','M','T','W','T','F','S'].map((d, i) => <div key={`${monthKey}-${i}`}>{d}</div>)}
                          </div>
                          <div className="mt-1 grid grid-cols-7 gap-1">
                            {Array.from({ length: firstDow }, (_, i) => <div key={`pad-${i}`} />)}
                            {days.map(({ key, date, blocked, hasSlots }) => {
                              const selectable = !blocked && hasSlots
                              const selected = selectedDate === key
                              return (
                                <button
                                  key={key}
                                  type="button"
                                  disabled={!selectable}
                                  onClick={() => setSelectedDate(selected ? '' : key)}
                                  className={[
                                    'h-9 w-full rounded-xl text-xs font-semibold transition',
                                    selected ? 'bg-axis text-white shadow-md' :
                                    blocked ? 'bg-red-50 text-red-400 line-through cursor-not-allowed' :
                                    !hasSlots ? 'text-slate-300 cursor-not-allowed' :
                                    'bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
                                  ].join(' ')}
                                >
                                  {date.getDate()}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {selectedDate && timeSlots.length > 0 && (
                <div>
                  <div className="mb-2 text-xs font-bold text-slate-700">Pick a time</div>
                  <div className="flex flex-wrap gap-2">
                    {timeSlots.map((slot) => (
                      <button
                        key={slot}
                        type="button"
                        onClick={() => setSelectedTime(selectedTime === slot ? '' : slot)}
                        className={[
                          'rounded-full border px-3 py-1.5 text-xs font-semibold transition',
                          selectedTime === slot ? 'border-axis bg-axis text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400',
                        ].join(' ')}
                      >
                        {slot}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {selectedDate && !hasAvailability && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  No specific time slots set yet — we'll reach out to confirm a time.
                </div>
              )}

              <div className="space-y-3">
                <div className="text-xs font-bold text-slate-700">Your details</div>
                <input
                  type="text"
                  placeholder="Full name *"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-axis focus:ring-2 focus:ring-axis/20"
                />
                <input
                  type="email"
                  placeholder="Email address *"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-axis focus:ring-2 focus:ring-axis/20"
                />
                <input
                  type="tel"
                  placeholder="Phone number (optional)"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-axis focus:ring-2 focus:ring-axis/20"
                />
                <textarea
                  rows={2}
                  placeholder="Any questions or notes? (optional)"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-axis focus:ring-2 focus:ring-axis/20"
                />
              </div>

              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
              )}
            </div>

            <div className="border-t border-slate-100 px-5 py-4">
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-full bg-axis py-3 text-sm font-semibold text-white shadow-sm transition hover:brightness-105 disabled:opacity-60"
              >
                {submitting ? 'Sending…' : 'Request tour'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

function AvailableBadge({ text, bookedFrom, bookedUntil }) {
  const normalized = (text || '').toLowerCase().trim()
  const isBooked = normalized === 'booked'
  const isUnavailable = normalized === 'unavailable' || normalized === 'currently unavailable'
  const isNow = !isBooked && !isUnavailable && isAvailabilityActive(text)
  const displayText = (() => {
    if (isBooked && bookedUntil) {
      const until = parseMonthDayYear(bookedUntil)
      if (until) {
        const nextDay = new Date(until.getTime() + 86400000)
        return `Available after ${nextDay.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
      }
    }
    return text
  })()
  const cls = (isBooked || isUnavailable)
    ? 'bg-red-50 text-red-700 border border-red-200'
    : isNow
      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
      : 'bg-amber-50 text-amber-700 border border-amber-200'
  const dot = (isBooked || isUnavailable) ? 'bg-red-500' : isNow ? 'bg-emerald-500' : 'bg-amber-500'

  return (
    <span
      className={`flex min-w-0 max-w-full items-start gap-1.5 rounded-2xl px-2.5 py-1.5 text-xs font-semibold leading-snug break-words [overflow-wrap:anywhere] ${cls}`}
    >
      <span className={`mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
      <span className="min-w-0 flex-1">{displayText}</span>
    </span>
  )
}

function startOfToday() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return today
}

function parseMonthDayYear(value, fallbackYear) {
  const match = (value || '').trim().match(/^([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?$/)
  if (!match) return null

  const [, monthName, day, explicitYear] = match
  const year = Number(explicitYear || fallbackYear)
  const parsed = new Date(`${monthName} ${day}, ${year}`)
  if (Number.isNaN(parsed.getTime())) return null

  parsed.setHours(0, 0, 0, 0)
  return parsed
}

function parseAvailabilityDate(value, fallbackYear) {
  const cleaned = (value || '').trim()
  if (!cleaned) return null

  return parseMonthDayYear(cleaned, fallbackYear)
}

function buildAvailabilityWindows(text) {
  const normalized = (text || '')
    .replace(/\u2013/g, '-')
    .replace(/\s+/g, ' ')
    .trim()

  if (!normalized) return []

  const windows = []

  // Move-in on or after the stated calendar day (matches listing copy from airtablePublicListings).
  for (const start of parseAvailabilityAfterStartingPhrases(normalized)) {
    windows.push({ start, end: null })
  }

  const rangeRegex = /([A-Za-z]+ \d{1,2}(?:,\s*\d{4})?)\s*-\s*([A-Za-z]+ \d{1,2}, \d{4})/gi
  let rangeMatch
  while ((rangeMatch = rangeRegex.exec(normalized)) !== null) {
    const [, startText, endText] = rangeMatch
    const yearMatch = endText.match(/(\d{4})/)
    const year = yearMatch ? Number(yearMatch[1]) : undefined
    const start = parseAvailabilityDate(startText, year)
    const end = parseAvailabilityDate(endText)
    if (start && end) {
      windows.push({ start, end })
    }
  }

  return windows.sort((a, b) => a.start.getTime() - b.start.getTime())
}

function isAvailabilityActive(text) {
  const normalized = (text || '').toLowerCase()
  if (!normalized) return false
  if (normalized.includes('currently unavailable')) return false
  if (normalized.includes('available now')) return true

  const today = startOfToday()
  const windows = buildAvailabilityWindows(text)

  return windows.some(({ start, end }) => {
    if (!start) return false
    if (!end) return today >= start
    return today >= start && today <= end
  })
}

function normalizeFeatureLabel(value) {
  const raw = (value || '').toString().trim()
  if (!raw) return ''

  const compact = raw
    .replace(/^in-unit\s+/i, '')
    .replace(/\s*\(.*?\)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const title = compact
    .split(' ')
    .map((word) => {
      const lower = word.toLowerCase()
      if (lower === 'ac') return 'AC'
      if (lower === 'wifi') return 'Wi-Fi'
      return lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join(' ')

  return title
}

function formatStartingRent(value) {
  if (!value) return ''
  return String(value)
    .replace(/\/\s*month/gi, '')
    .replace(/\/\s*mo/gi, '')
    .trim()
}

function extractRoomNumber(name) {
  const match = (name || '').match(/(\d+)/)
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER
}

function compareRoomNames(a, b) {
  const numberDiff = extractRoomNumber(a?.name) - extractRoomNumber(b?.name)
  if (numberDiff !== 0) return numberDiff

  return String(a?.name || '').localeCompare(String(b?.name || ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  })
}

function getBathroomVideoMeta(planTitle, videos = []) {
  const title = (planTitle || '').toLowerCase()
  let target = ''

  if (title.includes('first floor')) target = 'first floor bathroom'
  if (title.includes('second floor')) target = 'second floor bathroom'
  if (title.includes('third floor')) target = 'third floor bathroom'

  if (!target) return null

  const match = videos.find((video) => (video.label || '').toLowerCase().includes(target))
  return match ? { src: match.src, label: match.label, placeholder: !!match.placeholder, placeholderText: match.placeholderText } : null
}

function getSharedSpaceVideos(videos = []) {
  const pick = (matcher) => {
    const match = videos.find((video) => matcher((video.label || '').toLowerCase()))
    return match
      ? { src: match.src, label: match.label, placeholder: !!match.placeholder, placeholderText: match.placeholderText }
      : null
  }

  return [
    pick((label) => label.includes('kitchen')),
    pick((label) => label.includes('living area') || label.includes('living room')),
  ].filter(Boolean)
}

function getBathroomVideoMetaForRoom(roomName, planTitle, videos = [], propertySlug = '') {
  const roomNumber = extractRoomNumber(roomName)

  if (propertySlug === '4709b-8th-ave') {
    if (roomNumber === 1) {
      return getBathroomVideoMeta('first floor', videos)
    }

    if (roomNumber >= 2 && roomNumber <= 5) {
      return getBathroomVideoMeta('second floor', videos)
    }

    if (roomNumber >= 6 && roomNumber <= 9) {
      return getBathroomVideoMeta('third floor', videos)
    }
  }

  if (roomNumber >= 1 && roomNumber <= 2) {
    return getBathroomVideoMeta('first floor', videos)
  }

  if (roomNumber >= 3 && roomNumber <= 5) {
    return getBathroomVideoMeta('second floor', videos)
  }

  if (roomNumber >= 6 && roomNumber <= 9) {
    return getBathroomVideoMeta('third floor', videos)
  }

  return getBathroomVideoMeta(planTitle, videos)
}

/** Legacy `details` strings → `bathroomSetup` + `featureTags` (Airtable rows already ship the new shape). */
function enrichListingRoomForDisplay(room) {
  const r = room && typeof room === 'object' ? room : {}
  if (Array.isArray(r.featureTags)) return r
  const detailsStr = typeof r.details === 'string' ? r.details.trim() : ''
  if (detailsStr) {
    const { bathroomSetup, featureTags } = partitionRoomListingFields({ notes: detailsStr })
    return {
      ...r,
      bathroomSetup: bathroomSetup || undefined,
      featureTags,
      details: bathroomSetup || undefined,
    }
  }
  return { ...r, featureTags: [] }
}

function buildRoomPlanDisplay(property) {
  if (!Array.isArray(property.roomPlans)) return []

  if (property.slug !== '5259-brooklyn-ave-ne') {
    return [...property.roomPlans]
      .map((plan) => {
        const sortedRooms = [...plan.rooms].sort(compareRoomNames)
        return {
          ...plan,
          rooms: sortedRooms.map((room) => ({
            ...enrichListingRoomForDisplay(room),
            floorTitle: plan.title,
            videoPlaceholder: room.videoPlaceholder,
            videoPlaceholderText: room.videoPlaceholderText,
            bathroomVideo: getBathroomVideoMetaForRoom(room.name, plan.title, property.videos, property.slug)?.src,
            bathroomVideoLabel: getBathroomVideoMetaForRoom(room.name, plan.title, property.videos, property.slug)?.label,
            bathroomVideoPlaceholder: getBathroomVideoMetaForRoom(room.name, plan.title, property.videos, property.slug)?.placeholder,
            bathroomVideoPlaceholderText: getBathroomVideoMetaForRoom(room.name, plan.title, property.videos, property.slug)?.placeholderText,
          })),
        }
      })
      .sort((a, b) => compareRoomNames(a.rooms[0], b.rooms[0]))
  }

  const tierMeta = {
    '$865/month': {
      title: '2-Person Bathroom Share',
      summary: 'Rooms 1 and 2 share one bathroom',
      order: 0,
    },
    '$825/month': {
      title: '3-Person Bathroom Share',
      summary: 'Rooms 3, 4, and 5 share one bathroom',
      order: 1,
    },
    '$800/month': {
      title: '4-Person Bathroom Share',
      summary: 'Rooms 6, 7, 8, and 9 share one bathroom',
      order: 2,
    },
  }

  const grouped = new Map()

  property.roomPlans.forEach((plan) => {
    plan.rooms.forEach((room) => {
      const bathroomVideo = getBathroomVideoMetaForRoom(room.name, plan.title, property.videos, property.slug)
      const meta = tierMeta[room.price] || {
        title: plan.title,
        summary: '',
        order: 99,
      }

      if (!grouped.has(room.price)) {
        grouped.set(room.price, {
          title: meta.title,
          priceRange: room.price,
          summary: meta.summary,
          roomsAvailable: 0,
          rooms: [],
          sortOrder: meta.order,
        })
      }

      const group = grouped.get(room.price)
      group.rooms.push({
        ...enrichListingRoomForDisplay(room),
        floorTitle: plan.title,
        pricingTierTitle: meta.title,
        pricingTierSummary: meta.summary,
        bathroomVideo: bathroomVideo?.src,
        bathroomVideoLabel: bathroomVideo?.label,
        bathroomVideoPlaceholder: bathroomVideo?.placeholder,
        bathroomVideoPlaceholderText: bathroomVideo?.placeholderText,
      })
      if ((room.available || '').toLowerCase() !== 'booked') group.roomsAvailable += 1
    })
  })

  return Array.from(grouped.values())
    .sort((a, b) => a.sortOrder - b.sortOrder || extractRoomNumber(a.rooms[0]?.name) - extractRoomNumber(b.rooms[0]?.name))
    .map((group) => ({
      ...group,
      rooms: [...group.rooms].sort((a, b) => extractRoomNumber(a.name) - extractRoomNumber(b.name)),
    }))
}

function FloorPlanCard({plan, onDetail}){
  const [expanded, setExpanded] = useState(false)
  const roomsToShow = expanded ? plan.rooms : plan.rooms.slice(0, 3)
  const available = plan.roomsAvailable || plan.rooms.length
  const scarce = available === 1

  return (
    <div className="w-full min-w-0 max-w-full border border-slate-200 bg-white overflow-hidden rounded-xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-6 sm:py-5">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400 break-words">{plan.title}</div>
          <div className="mt-1.5 text-lg font-black text-slate-900 break-words">{plan.priceRange}</div>
          {plan.summary && <div className="mt-1 text-sm text-slate-500 break-words">{plan.summary}</div>}
          {scarce && (
            <div className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-semibold text-amber-600">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
              1 room remaining at this price
            </div>
          )}
        </div>
        <div className="shrink-0 text-right">
          <div className="text-2xl font-black text-slate-900">{available}</div>
          <div className="text-xs text-slate-400">room{available !== 1 ? 's' : ''}</div>
        </div>
      </div>

      {/* Column headers */}
      <div className="hidden sm:grid grid-cols-12 gap-3 bg-slate-50 px-6 py-2.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 border-b border-slate-100">
        <div className="col-span-4">Room</div>
        <div className="col-span-3">Price</div>
        <div className="col-span-3">Availability</div>
        <div className="col-span-2" />
      </div>

      {/* Rows */}
      <div className="min-w-0 divide-y divide-slate-100 overflow-hidden px-4 sm:px-6">
        {roomsToShow.map((r, idx) => (
          <div key={idx} className="min-w-0 py-4 sm:grid sm:grid-cols-12 sm:items-start sm:gap-3">
            {/* Room name — always shown */}
            <div className="min-w-0 sm:col-span-4">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="min-w-0 break-words font-semibold text-slate-900">{r.name}</span>
                {r.video && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-axis/10 px-2 py-0.5 text-[10px] font-semibold text-axis">
                    <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" aria-hidden><polygon points="5,3 19,12 5,21" fill="currentColor"/></svg>
                    Tour
                  </span>
                )}
                {Array.isArray(r.images) && r.images.length > 0 ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                    {r.images.length} photo{r.images.length !== 1 ? 's' : ''}
                  </span>
                ) : null}
              </div>
              {(r.floorTitle || r.bathroomSetup || r.details) && (
                <div className="mt-0.5 space-y-1">
                  {r.floorTitle ? (
                    <div className="text-xs text-slate-400 break-words">{r.floorTitle}</div>
                  ) : null}
                  {(r.bathroomSetup || r.details) ? (
                    <div className="text-xs text-slate-500 break-words">{r.bathroomSetup || r.details}</div>
                  ) : null}
                  {Array.isArray(r.featureTags) && r.featureTags.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {r.featureTags.slice(0, 6).map((tag) => (
                        <span
                          key={`${r.name}-${tag}`}
                          className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600"
                        >
                          {normalizeFeatureLabel(tag)}
                        </span>
                      ))}
                      {r.featureTags.length > 6 ? (
                        <span className="self-center text-[10px] text-slate-400">+{r.featureTags.length - 6} more</span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            {/* Mobile-only: Price and Availability stacked as separate full-width rows */}
            <div className="mt-3 min-w-0 w-full max-w-full space-y-2.5 sm:hidden">
              <div className="flex min-w-0 items-start justify-between gap-3">
                <span className="shrink-0 pt-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Price</span>
                <span className="min-w-0 break-words text-right font-bold text-slate-900">{r.price}</span>
              </div>
              <div className="min-w-0 w-full max-w-full">
                <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Availability</div>
                <AvailableBadge text={r.available} bookedFrom={r.bookedFrom} bookedUntil={r.bookedUntil} />
              </div>
            </div>

            {/* Desktop-only: Price column */}
            <div className="hidden min-w-0 sm:col-span-3 sm:block">
              <div className="break-words font-bold text-slate-900">{r.price}</div>
            </div>

            {/* Desktop-only: Availability column */}
            <div className="hidden min-w-0 sm:col-span-3 sm:block">
              <AvailableBadge text={r.available} bookedFrom={r.bookedFrom} bookedUntil={r.bookedUntil} />
            </div>

            {/* Details button — full width on mobile */}
            <div className="mt-3 min-w-0 w-full sm:col-span-2 sm:mt-0 sm:flex sm:w-auto sm:justify-end">
              <button
                type="button"
                onClick={() => onDetail && onDetail(r)}
                className="box-border w-full max-w-full rounded-full border border-slate-300 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700 transition hover:border-axis hover:text-axis sm:w-auto sm:min-w-[5.5rem] sm:py-2"
              >
                Details
              </button>
            </div>
          </div>
        ))}
      </div>

      {plan.rooms.length > 3 && (
        <div className="border-t border-slate-100 px-5 py-3 sm:px-6">
          <button
            type="button"
            onClick={() => setExpanded(s => !s)}
            className="text-sm font-semibold text-axis transition hover:opacity-75"
          >
            {expanded ? '↑ Show less' : `Show ${plan.rooms.length - 3} more room${plan.rooms.length - 3 !== 1 ? 's' : ''} ↓`}
          </button>
        </div>
      )}
    </div>
  )
}

function VideoPlaceholderCard({ label, text }) {
  return (
    <div className="mt-4 rounded-[18px] overflow-hidden border border-slate-200">
      <div className="bg-axis px-4 py-2.5 flex items-center gap-2">
        <svg className="w-4 h-4 text-white/90" viewBox="0 0 24 24" fill="none" aria-hidden><polygon points="5,3 19,12 5,21" fill="currentColor"/></svg>
        <span className="text-xs font-bold uppercase tracking-[0.14em] text-white/85">{label}</span>
      </div>
      <div className="bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.18),transparent_32%),linear-gradient(180deg,#0f172a_0%,#020617_100%)] px-5 py-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/10 text-blue-300">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden><polygon points="5,3 19,12 5,21" fill="currentColor"/></svg>
        </div>
        <div className="mt-4 text-sm font-semibold text-white">Video placeholder</div>
        <div className="mt-2 text-sm leading-6 text-white/80">{text || 'Tour video coming soon.'}</div>
      </div>
    </div>
  )
}

function getSharedSpaceDetailMeta(video) {
  if (video?.__meta && typeof video.__meta === 'object') {
    return video.__meta
  }
  const label = (video?.label || '').toLowerCase()
  if (label.includes('kitchen')) {
    return {
      title: 'Kitchen Tour',
      rowSummary: 'Shared kitchen layout, appliances, prep space, and day-to-day cooking flow.',
      summary: 'See how the shared kitchen is set up for daily use, from appliances and counter space to how the room connects with the rest of the home.',
      description: 'This tour gives renters a quick read on the kitchen layout, where cooking and dining happen, and whether the shared setup feels practical for everyday townhouse living.',
      bullets: ['Counter and appliance layout', 'Cooking and dining flow', 'How the kitchen connects to the home'],
    }
  }

  return {
    title: 'Living Area Tour',
    rowSummary: 'Shared lounge layout, seating setup, and how the common area feels to use.',
    summary: 'Preview the shared living area so renters can see the seating setup, open layout, and how the main lounge space works in everyday life.',
    description: 'This tour helps renters understand the scale of the common area, where people can sit or study, and how the living room connects back to the kitchen and circulation through the townhouse.',
    bullets: ['Shared seating setup', 'Open common-area layout', 'Connection to the kitchen and entry'],
  }
}

function buildSharedSpaceMetaFromRow(row) {
  const title = String(row?.title || 'Shared Space').trim()
  const summary = String(row?.description || 'Shared common area').trim()
  const access = String(row?.accessLabel || '').trim()
  const images = Array.isArray(row?.images) ? row.images.length : 0
  const videos = Array.isArray(row?.videos) ? row.videos.length : 0
  return {
    title,
    rowSummary: summary,
    summary,
    description: summary,
    bullets: [
      access ? `Access: ${access}` : 'Access: All rooms',
      images > 0 ? `${images} photo${images === 1 ? '' : 's'} available` : 'Photos coming soon',
      videos > 0 ? `${videos} video${videos === 1 ? '' : 's'} available` : 'Video coming soon',
    ],
  }
}

function openSharedSpaceFromRow(row, setActiveSharedSpace) {
  const videos = Array.isArray(row?.videos) ? row.videos : []
  const firstVideo = videos[0] || null
  setActiveSharedSpace({
    ...(firstVideo || {}),
    src: firstVideo?.src || '',
    placeholder: !firstVideo || !!firstVideo.placeholder,
    placeholderText: firstVideo?.placeholderText || `${row?.title || 'Shared space'} video coming soon.`,
    images: Array.isArray(row?.images) ? row.images : [],
    __meta: buildSharedSpaceMetaFromRow(row),
  })
}

export default function PropertyPage(){
  const { slug } = useParams()
  const { hash } = useLocation()
  const listingChrome = usePropertyListingChrome()
  const pStatic = properties.find((x) => x.slug === slug)
  const [pDynamic, setPDynamic] = useState(null)
  const [dynamicLoading, setDynamicLoading] = useState(false)
  const [tourAvailabilityText, setTourAvailabilityText] = useState('')
  const [dynamicPropertyId, setDynamicPropertyId] = useState('')
  const [showTourModal, setShowTourModal] = useState(false)

  useEffect(() => {
    if (pStatic) {
      setPDynamic(null)
      setTourAvailabilityText('')
      setDynamicPropertyId('')
      return undefined
    }
    const rid = String(slug || '').startsWith('axis-') ? String(slug).slice('axis-'.length) : ''
    if (!/^rec[a-zA-Z0-9]{14,}$/.test(rid)) {
      setPDynamic(null)
      setTourAvailabilityText('')
      setDynamicPropertyId('')
      return undefined
    }
    let cancelled = false
    setDynamicLoading(true)
    fetchPropertyRecordById(rid)
      .then((rec) => {
        if (cancelled || !rec) {
          if (!cancelled) { setPDynamic(null); setTourAvailabilityText(''); setDynamicPropertyId('') }
          return
        }
        const expected = marketingSlugForAirtablePropertyId(rec.id)
        if (!propertyListingVisibleForMarketing(rec) || expected !== slug) {
          setPDynamic(null)
          setTourAvailabilityText('')
          setDynamicPropertyId('')
          return
        }
        setPDynamic(mapAirtableRecordToPropertyPage(rec))
        setTourAvailabilityText(tourAvailabilityFromRaw(rec))
        setDynamicPropertyId(rec.id || '')
      })
      .catch(() => {
        if (!cancelled) { setPDynamic(null); setTourAvailabilityText(''); setDynamicPropertyId('') }
      })
      .finally(() => {
        if (!cancelled) setDynamicLoading(false)
      })
    return () => { cancelled = true }
  }, [slug, pStatic])

  const p = pStatic || pDynamic

  const [showAllPhotos, setShowAllPhotos] = useState(false)
  const [modalPlan, setModalPlan] = useState(null)
  const [modalImages, setModalImages] = useState([])
  const [activeTab, setActiveTab] = useState('overview')
  const [showScarcityPopup, setShowScarcityPopup] = useState(false)
  const [activeSharedSpace, setActiveSharedSpace] = useState(null)
  const [activeBathroom, setActiveBathroom] = useState(null)
  const sectionRefs = useRef({})
  const sectionNavRef = useRef(null)
  /** Reserve layout space — section nav is `fixed` (page-wrapper overflow breaks `sticky`). */
  const [sectionNavHeight, setSectionNavHeight] = useState(80)
  /** Ignore scroll-spy updates while a tab click or hash scroll is animating */
  const scrollSpyLockUntilRef = useRef(0)

  const displayedRoomPlansForEffect = p ? buildRoomPlanDisplay(p) : []
  const scarcePlanForEffect = displayedRoomPlansForEffect.find(
    (plan) => (plan.roomsAvailable || plan.rooms.length) === 1
  )

  /** In-nav: floor plans (rooms + bathrooms + shared spaces), amenities, lease basics (+ bundles), location (map). */
  const sectionNavTabs = useMemo(() => {
    if (!p) return []
    const plans = buildRoomPlanDisplay(p)
    const sharedVideos = getSharedSpaceVideos(p.videos || [])
    const hasSharedList = (p.sharedSpacesList || []).length > 0
    const hasBathrooms = (p.bathroomsList || []).length > 0
    const hasFloorPlans =
      plans.length > 0 || hasBathrooms || hasSharedList || sharedVideos.length > 0
    const amenities = Array.isArray(p.communityAmenities) ? p.communityAmenities : []
    const hasAmenities = amenities.length > 0
    const hasLeaseBasics =
      Boolean(p._fromAirtable) ||
      String(p.policies || '').trim().length > 0 ||
      (Array.isArray(p.leasingPackages) && p.leasingPackages.length > 0) ||
      String(p.listingAvailabilitySummary || '').trim().length > 0 ||
      Boolean(p.applicationFeeDisplay) ||
      Boolean(p.moveInChargesDisplay) ||
      String(p.applicationFee || '').trim().length > 0 ||
      String(p.securityDeposit || '').trim().length > 0 ||
      String(p.utilitiesFee || '').trim().length > 0 ||
      String(p.petsPolicy || '').trim().length > 0 ||
      Boolean(p.administrationFeeDisplay) ||
      Boolean(p.showFeesOnListing) ||
      (Array.isArray(p.listingPricingBullets) && p.listingPricingBullets.length > 0) ||
      String(p.pricingNotesForListing || '').trim().length > 0
    const hasLocation =
      Boolean(String(p.address || '').trim()) ||
      Boolean(p._fromAirtable && p.location && typeof p.location.lat === 'number' && typeof p.location.lng === 'number')
    const tabs = []
    if (hasFloorPlans) tabs.push(['floor-plans', 'Floor plans'])
    if (hasAmenities) tabs.push(['amenities', 'Amenities'])
    if (hasLeaseBasics) tabs.push(['lease-basics', 'Lease basics'])
    if (hasLocation) tabs.push(['location', 'Location'])
    return tabs
  }, [p])

  const showSectionNav = sectionNavTabs.length > 0

  useEffect(() => {
    if (!showSectionNav) setSectionNavHeight(0)
  }, [showSectionNav])

  /** Scroll-spy order: gallery first (`overview`), then each section below. */
  const sectionScrollOrder = useMemo(() => ['overview', ...sectionNavTabs.map(([id]) => id)], [sectionNavTabs])

  const sectionNavIds = useMemo(() => new Set(sectionScrollOrder), [sectionScrollOrder])

  // Sync tab from URL hash only when there is a hash (empty hash: leave active tab to scroll-spy / user scroll).
  useEffect(() => {
    const sectionId = (hash || '').replace('#', '')
    if (!sectionId) return
    if (sectionNavIds.has(sectionId)) {
      setActiveTab(sectionId)
    } else {
      setActiveTab('overview')
    }
  }, [hash, sectionNavIds])

  useEffect(() => {
    if (!sectionNavIds.has(activeTab)) {
      setActiveTab('overview')
    }
  }, [sectionNavIds, activeTab])

  useEffect(() => {
    setShowScarcityPopup(false)
    if (!p || !scarcePlanForEffect) return undefined

    const timer = window.setTimeout(() => {
      setShowScarcityPopup(true)
    }, 1200)

    return () => window.clearTimeout(timer)
  }, [p, scarcePlanForEffect?.title, scarcePlanForEffect?.priceRange])

  const getSectionScrollOffset = useCallback(() => {
    const nav = document.getElementById('section-nav')
    const chromeH =
      listingChrome && typeof listingChrome.siteChromeInsetPx === 'number'
        ? listingChrome.siteChromeInsetPx
        : (() => {
            const chrome = document.getElementById('site-sticky-chrome')
            return chrome ? chrome.getBoundingClientRect().height : 0
          })()
    const navH = nav ? nav.getBoundingClientRect().height : 0
    const gap = 16
    return chromeH + navH + gap
  }, [listingChrome])

  // Scroll window only; offset = full sticky site chrome (promo + header) + in-page section nav.
  const scrollToId = useCallback(
    (id) => {
      const el = sectionRefs.current[id] || document.getElementById(id)
      if (!el) return false

      const offset = getSectionScrollOffset()
      const top = Math.max(0, el.getBoundingClientRect().top + window.scrollY - offset)
      window.scrollTo({ top, behavior: 'smooth' })
      return true
    },
    [getSectionScrollOffset]
  )

  /**
   * Pick the last section whose top edge has reached the sticky “activation line” (viewport px from top).
   * Uses getBoundingClientRect() only (no + scrollY) so it stays correct when ancestors use transforms
   * (e.g. Framer Motion on AnimatedPage).
   */
  const updateActiveTabFromScrollPosition = useCallback(() => {
    if (typeof window === 'undefined') return
    if (Date.now() < scrollSpyLockUntilRef.current) return

    const line = getSectionScrollOffset()
    let nextId = 'overview'

    for (const id of sectionScrollOrder) {
      const el = sectionRefs.current[id] || document.getElementById(id)
      if (!el) continue
      const top = el.getBoundingClientRect().top
      if (top <= line + 1) nextId = id
    }

    setActiveTab((prev) => (prev === nextId ? prev : nextId))
  }, [getSectionScrollOffset, sectionScrollOrder])

  const measureSectionNavSpacer = useCallback(() => {
    const nav = sectionNavRef.current
    if (!nav) return
    setSectionNavHeight(Math.ceil(nav.getBoundingClientRect().height) + SECTION_NAV_LAYOUT_BUFFER_PX)
  }, [])

  // Fixed section nav under site chrome; inset from context when property chrome auto-hides.
  useEffect(() => {
    if (!p) return undefined
    const chrome = document.getElementById('site-sticky-chrome')
    const nav = sectionNavRef.current || document.getElementById('section-nav')
    if (!nav) return undefined
    function syncStickyTop() {
      const h =
        listingChrome && typeof listingChrome.siteChromeInsetPx === 'number'
          ? listingChrome.siteChromeInsetPx
          : chrome
            ? Math.ceil(chrome.getBoundingClientRect().height)
            : 0
      nav.style.top = `${h}px`
      requestAnimationFrame(() => updateActiveTabFromScrollPosition())
    }
    syncStickyTop()
    const ro = chrome
      ? new ResizeObserver(() => {
          syncStickyTop()
          requestAnimationFrame(measureSectionNavSpacer)
        })
      : null
    if (chrome && ro) ro.observe(chrome)
    window.addEventListener('resize', syncStickyTop)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', syncStickyTop)
      nav.style.removeProperty('top')
    }
  }, [p, listingChrome, updateActiveTabFromScrollPosition, measureSectionNavSpacer])

  useLayoutEffect(() => {
    if (!p) return undefined
    const nav = sectionNavRef.current
    if (!nav) return undefined
    measureSectionNavSpacer()
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(measureSectionNavSpacer)
    })
    ro.observe(nav)
    return () => ro.disconnect()
  }, [p, sectionNavTabs, measureSectionNavSpacer])

  // Remeasure after fonts / late layout so spacer matches wrapped nav height.
  useEffect(() => {
    if (!p) return undefined
    const bump = () => requestAnimationFrame(measureSectionNavSpacer)
    const t1 = window.setTimeout(bump, 0)
    const t2 = window.setTimeout(bump, 320)
    let cancelled = false
    document.fonts?.ready?.then(() => {
      if (!cancelled) bump()
    })
    return () => {
      cancelled = true
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [p, sectionNavTabs, measureSectionNavSpacer])

  // Hash links: App skips scrollIntoView on /properties/* so we can apply the same offset as tab clicks.
  useEffect(() => {
    if (!p) return undefined
    const raw = (hash || '').replace('#', '')
    if (!raw) return undefined
    let targetId = raw === 'highlights' ? 'overview' : raw
    if (raw === 'map') targetId = sectionNavIds.has('location') ? 'location' : 'overview'
    if (raw === 'house-details') {
      targetId = sectionNavIds.has('amenities') ? 'amenities' : sectionNavIds.has('lease-basics') ? 'lease-basics' : 'overview'
    }
    if (raw === 'bathrooms' || raw === 'shared-spaces') targetId = 'floor-plans'
    if (!sectionNavIds.has(targetId)) return undefined
    scrollSpyLockUntilRef.current = Date.now() + 900
    const t = window.setTimeout(() => scrollToId(targetId), 0)
    return () => clearTimeout(t)
  }, [hash, sectionNavIds, p, scrollToId])

  // Scroll-spy: active tab follows the section aligned with the sticky chrome + nav (IntersectionObserver-style
  // behavior via position checks; recomputed on scroll/resize and when section layout may change).
  useEffect(() => {
    if (!p) return undefined

    let ticking = false
    function onScrollOrResize() {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        ticking = false
        updateActiveTabFromScrollPosition()
      })
    }

    // Window + scrollingElement: some environments attach scroll to documentElement/body instead of window.
    const scrollEl = document.scrollingElement || document.documentElement
    window.addEventListener('scroll', onScrollOrResize, { passive: true })
    if (scrollEl && scrollEl !== window) {
      scrollEl.addEventListener('scroll', onScrollOrResize, { passive: true })
    }
    window.addEventListener('resize', onScrollOrResize, { passive: true })
    window.visualViewport?.addEventListener?.('resize', onScrollOrResize, { passive: true })

    const ids = sectionScrollOrder
    const elements = ids
      .map((id) => sectionRefs.current[id])
      .filter(Boolean)
    let observer
    if (elements.length > 0 && typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(onScrollOrResize, {
        root: null,
        rootMargin: '0px',
        threshold: [0, 0.05, 0.1, 0.25, 0.5, 0.75, 1],
      })
      elements.forEach((el) => observer.observe(el))
    }

    requestAnimationFrame(() => updateActiveTabFromScrollPosition())

    return () => {
      window.removeEventListener('scroll', onScrollOrResize)
      if (scrollEl && scrollEl !== window) {
        scrollEl.removeEventListener('scroll', onScrollOrResize)
      }
      window.removeEventListener('resize', onScrollOrResize)
      window.visualViewport?.removeEventListener?.('resize', onScrollOrResize)
      observer?.disconnect()
    }
  }, [p, sectionScrollOrder, updateActiveTabFromScrollPosition])

  if (!pStatic && dynamicLoading) {
    return <div className="container mx-auto px-6 py-16 text-center text-sm text-slate-600">Loading listing…</div>
  }

  if (!p) {
    return <div className="container mx-auto px-6 py-12">Property not found</div>
  }

  const galleryImages = (p.images && p.images.length) ? p.images : []

  const includedItems = modalPlan
    ? (Array.isArray(modalPlan.room.featureTags) ? modalPlan.room.featureTags : [])
        .map(normalizeFeatureLabel)
        .filter(Boolean)
    : []

  const displayedRoomPlans = displayedRoomPlansForEffect
  const useBrooklynStyleHeadings = p.slug === '5259-brooklyn-ave-ne' || p._fromAirtable
  const roomPlansHeading = useBrooklynStyleHeadings ? 'Pricing & Availability' : 'Floor Plans'
  const scarcePlan = scarcePlanForEffect
  const startingRent = formatStartingRent(getStartingRent(p))
  const sharedSpaceVideos = getSharedSpaceVideos(p.videos || [])
  const sharedSpacesList = p.sharedSpacesList || []

  return (
    <div className="page-wrapper py-6 sm:py-8 w-full">
      <Seo
        title={`${p.name} | Axis`}
        description={`${p.summary} View pricing and availability.`}
        pathname={`/properties/${p.slug}`}
        image={galleryImages[0]}
        structuredData={buildPropertySchema(p)}
      />
      <div className="main-container">
        {showSectionNav ? (
          <div
            ref={sectionNavRef}
            id="section-nav"
            className="fixed left-0 right-0 z-[45] w-full border-b border-slate-200 bg-white/95 shadow-[0_1px_0_0_rgba(15,23,42,0.06)] backdrop-blur-md supports-[backdrop-filter]:bg-white/90"
          >
            <div className="mx-auto max-w-[1480px] px-4 py-3 sm:px-6 sm:py-3.5 lg:px-10">
              <nav
                className="flex w-full max-w-full flex-wrap items-center justify-start gap-x-3 gap-y-2.5 overflow-x-auto scrollbar-none sm:gap-x-4 sm:gap-y-3 md:justify-center md:gap-x-5 lg:gap-x-6 [&::-webkit-scrollbar]:hidden"
                aria-label="Property sections"
              >
                {sectionNavTabs.map(([id, label]) => (
                  <button
                    type="button"
                    key={id}
                    aria-current={activeTab === id ? 'true' : undefined}
                    onClick={() => {
                      scrollSpyLockUntilRef.current = Date.now() + 900
                      setActiveTab(id)
                      scrollToId(id)
                    }}
                    className={`shrink-0 rounded-full px-4 py-2.5 text-sm font-semibold transition sm:px-5 sm:text-[15px] ${
                      activeTab === id
                        ? 'bg-axis text-white shadow-sm'
                        : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </nav>
            </div>
          </div>
        ) : null}

        {/* Flow spacer — fixed nav is out of document flow */}
        <div aria-hidden="true" className="w-full shrink-0" style={{ height: showSectionNav ? sectionNavHeight : 0 }} />

        <div
          id="overview"
          ref={(node) => { sectionRefs.current.overview = node }}
          className="property-gallery mx-auto max-w-[1480px] scroll-mt-32 px-4 pt-6 sm:px-6 sm:pt-7 md:scroll-mt-44 lg:px-10 lg:pt-8"
        >
          <h1 className="sr-only">{p.name}</h1>
          <PropertyGallery images={galleryImages} videos={p.videos || []} />
        </div>

      <div className="mx-auto mt-8 grid min-w-0 max-w-[1480px] gap-10 px-4 sm:mt-10 sm:px-6 md:grid-cols-12 lg:px-10">
        <div className="min-w-0 md:col-span-9">

          {/* Floor plans: rooms, bathrooms, shared spaces (single scroll section) */}
          {sectionNavTabs.some(([id]) => id === 'floor-plans') ? (
            <section id="floor-plans" ref={(node) => { sectionRefs.current['floor-plans'] = node }} className="mt-14 min-w-0 scroll-mt-32 md:scroll-mt-44">
              <div className="flex min-w-0 flex-wrap items-end justify-between gap-x-4 gap-y-3">
                <div className="min-w-0 flex-1">
                  <h2 className="font-editorial text-3xl font-black leading-tight text-slate-900 sm:text-4xl">{roomPlansHeading}</h2>
                  <p className="mt-2 text-sm text-slate-600">Rooms, bathrooms, and shared spaces for this home.</p>
                </div>
                {displayedRoomPlans.length > 0 ? (
                  <div className="shrink-0 text-sm text-slate-500">
                    {displayedRoomPlans.reduce((acc, pl) => acc + pl.rooms.length, 0)} rooms listed
                  </div>
                ) : null}
              </div>
              {displayedRoomPlans.length > 0 ? (
                <div className="mt-8 min-w-0 space-y-5">
                  {displayedRoomPlans.map((plan, i) => (
                    <FloorPlanCard key={i} plan={plan} onDetail={(room)=> setModalPlan({plan, room})} />
                  ))}
                </div>
              ) : null}

              {(p.bathroomsList || []).length > 0 ? (
                <div className={displayedRoomPlans.length > 0 ? 'mt-14' : 'mt-8'}>
                  <div className="flex items-end justify-between gap-4">
                    <h3 className="font-editorial text-2xl font-black leading-tight text-slate-900 sm:text-3xl">Bathrooms</h3>
                    <div className="shrink-0 text-sm text-slate-500">
                      {(() => {
                        const n =
                          typeof p.baths === 'number' && Number.isFinite(p.baths) && p.baths > 0
                            ? p.baths
                            : (p.bathroomsList || []).length
                        return `${formatBathroomCountForDisplay(n)} bathroom${n === 1 ? '' : 's'}`
                      })()}
                    </div>
                  </div>
                  <div className="mt-6 w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <div className="hidden sm:grid sm:grid-cols-12 sm:gap-3 sm:border-b sm:border-slate-100 sm:bg-slate-50 sm:px-6 sm:py-2.5 sm:text-[10px] sm:font-bold sm:uppercase sm:tracking-[0.16em] sm:text-slate-400">
                      <div className="sm:col-span-3">Bathroom</div>
                      <div className="sm:col-span-4">Details</div>
                      <div className="sm:col-span-3">Room access</div>
                      <div className="sm:col-span-2 sm:text-right">Media</div>
                    </div>
                    <div className="divide-y divide-slate-100 px-4 sm:px-6">
                      {(p.bathroomsList || []).map((row, rowIdx) => (
                        <div key={`${row.title}-${rowIdx}`} className="grid grid-cols-1 gap-3 py-4 sm:grid-cols-12 sm:items-center">
                          <div className="sm:col-span-3">
                            <div className="font-semibold text-slate-900">{row.title}</div>
                            <div className="mt-0.5 text-xs text-slate-500">House bathroom</div>
                          </div>
                          <div className="sm:col-span-4 text-sm text-slate-600">{row.description}</div>
                          <div className="sm:col-span-3 text-xs font-semibold uppercase tracking-[0.12em] text-axis">{row.accessLabel || '—'}</div>
                          <div className="sm:col-span-2 sm:text-right">
                            <button
                              type="button"
                              onClick={() => setActiveBathroom(row)}
                              className="inline-flex items-center rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-axis hover:text-axis"
                            >
                              {(() => {
                                const nImg = (row.images || []).length
                                const nVid = (row.videos || []).length
                                if (!nImg && !nVid) return 'Details'
                                const parts = []
                                if (nImg) parts.push(`${nImg} photo${nImg !== 1 ? 's' : ''}`)
                                if (nVid) parts.push(`${nVid} video${nVid !== 1 ? 's' : ''}`)
                                return parts.join(', ')
                              })()}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {sharedSpacesList.length > 0 || sharedSpaceVideos.length > 0 ? (
                <div className={(displayedRoomPlans.length > 0 || (p.bathroomsList || []).length > 0) ? 'mt-14' : 'mt-8'}>
                  <div className="flex items-end justify-between gap-4">
                    <h3 className="font-editorial text-2xl font-black leading-tight text-slate-900 sm:text-3xl">Shared spaces</h3>
                    <div className="shrink-0 text-sm text-slate-500">
                      {sharedSpacesList.length + sharedSpaceVideos.length} shared spaces
                    </div>
                  </div>
                  <div className="mt-6 w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <div className="hidden sm:grid grid-cols-12 gap-3 border-b border-slate-100 bg-slate-50 px-6 py-2.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                      <div className="col-span-3">Space</div>
                      <div className="col-span-4">Details</div>
                      <div className="col-span-3">Access</div>
                      <div className="col-span-2 text-right">Action</div>
                    </div>
                    <div className="divide-y divide-slate-100 px-4 sm:px-6">
                      {sharedSpacesList.map((row, rowIdx) => (
                        <div key={`${row.title}-${rowIdx}`} className="grid grid-cols-1 gap-3 py-4 sm:grid-cols-12 sm:items-center">
                          <div className="sm:col-span-3">
                            <div className="font-semibold text-slate-900">{row.title}</div>
                            <div className="mt-0.5 text-xs text-slate-500">Shared area</div>
                          </div>
                          <div className="sm:col-span-4 text-sm text-slate-600">
                            {row.description || 'Shared common area'}
                          </div>
                          <div className="sm:col-span-3 text-xs font-semibold uppercase tracking-[0.12em] text-axis">
                            {row.accessLabel || 'All rooms'}
                          </div>
                          <div className="sm:col-span-2 sm:text-right">
                            <button
                              type="button"
                              onClick={() => openSharedSpaceFromRow(row, setActiveSharedSpace)}
                              className="inline-flex items-center rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-axis hover:text-axis"
                            >
                              Details
                            </button>
                          </div>
                        </div>
                      ))}

                      {sharedSpaceVideos.map((video) => {
                        const meta = getSharedSpaceDetailMeta(video)
                        return (
                          <div key={video.label} className="grid grid-cols-1 gap-3 py-4 sm:grid-cols-12 sm:items-center">
                            <div className="sm:col-span-3">
                              <div className="font-semibold text-slate-900">{meta.title.replace(' Tour', '')}</div>
                              <div className="mt-0.5 text-xs text-slate-500">Shared area video</div>
                            </div>
                            <div className="sm:col-span-4 text-sm text-slate-600">{meta.rowSummary}</div>
                            <div className="sm:col-span-3 text-xs font-semibold uppercase tracking-[0.12em] text-axis">All rooms</div>
                            <div className="sm:col-span-2 sm:text-right">
                              <button
                                type="button"
                                onClick={() => setActiveSharedSpace({ ...video, images: [] })}
                                className="inline-flex items-center rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-axis hover:text-axis"
                              >
                                Details
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          {sectionNavTabs.some(([id]) => id === 'amenities') ? (
            <section
              id="amenities"
              ref={(node) => {
                sectionRefs.current.amenities = node
              }}
              className="mt-14 min-w-0 scroll-mt-32 md:scroll-mt-44"
            >
              <h2 className="font-editorial text-3xl font-black leading-tight text-slate-900 sm:text-4xl">Amenities</h2>
              <ul className="mt-8 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {(p.communityAmenities || []).map((a) => (
                  <li
                    key={a}
                    className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-800"
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-axis" aria-hidden />
                    {a}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {sectionNavTabs.some(([id]) => id === 'lease-basics') ? (
            <section
              id="lease-basics"
              ref={(node) => {
                sectionRefs.current['lease-basics'] = node
              }}
              className="mt-14 min-w-0 scroll-mt-32 md:scroll-mt-44"
            >
              <h2 className="font-editorial text-3xl font-black leading-tight text-slate-900 sm:text-4xl">Lease basics</h2>
              <p className="mt-2 text-sm text-slate-600">Lease length, fees, utilities, pets, and move-in details.</p>

              <div className="mt-8 overflow-hidden rounded-xl border border-slate-200 bg-white text-sm">
                <table className="w-full border-collapse text-left">
                  <tbody>
                    <tr className="border-b border-slate-100">
                      <th
                        scope="row"
                        className="w-[34%] max-w-[220px] align-top bg-slate-50/80 px-4 py-3.5 text-xs font-bold uppercase tracking-wide text-slate-500 sm:px-5 sm:py-4"
                      >
                        Lease length
                      </th>
                      <td className="align-top px-4 py-3.5 font-semibold leading-relaxed text-slate-900 sm:px-5 sm:py-4">
                        {String(p.policies || '').trim() ? (
                          p.policies
                        ) : (
                          <span className="font-medium text-slate-500">Contact Axis for current lease options.</span>
                        )}
                      </td>
                    </tr>
                    <tr className="border-b border-slate-100">
                      <th
                        scope="row"
                        className="align-top bg-slate-50/80 px-4 py-3.5 text-xs font-bold uppercase tracking-wide text-slate-500 sm:px-5 sm:py-4"
                      >
                        Application fee
                      </th>
                      <td className="align-top px-4 py-3.5 font-semibold text-slate-900 sm:px-5 sm:py-4">
                        {p.applicationFeeDisplay ||
                          (p.applicationFee ? `${p.applicationFee} application fee` : '—')}
                      </td>
                    </tr>
                    <tr className="border-b border-slate-100">
                      <th
                        scope="row"
                        className="align-top bg-slate-50/80 px-4 py-3.5 text-xs font-bold uppercase tracking-wide text-slate-500 sm:px-5 sm:py-4"
                      >
                        Security deposit
                      </th>
                      <td className="align-top px-4 py-3.5 font-semibold text-slate-900 sm:px-5 sm:py-4">{p.securityDeposit || '—'}</td>
                    </tr>
                    {p.administrationFeeDisplay ? (
                      <tr className="border-b border-slate-100">
                        <th
                          scope="row"
                          className="align-top bg-slate-50/80 px-4 py-3.5 text-xs font-bold uppercase tracking-wide text-slate-500 sm:px-5 sm:py-4"
                        >
                          Administrative costs
                        </th>
                        <td className="align-top px-4 py-3.5 font-semibold text-slate-900 sm:px-5 sm:py-4">
                          {p.administrationFeeDisplay}
                        </td>
                      </tr>
                    ) : null}
                    {p.utilitiesFee ? (
                      <tr className="border-b border-slate-100">
                        <th
                          scope="row"
                          className="align-top bg-slate-50/80 px-4 py-3.5 text-xs font-bold uppercase tracking-wide text-slate-500 sm:px-5 sm:py-4"
                        >
                          Utilities
                        </th>
                        <td className="align-top px-4 py-3.5 font-semibold text-slate-900 sm:px-5 sm:py-4">{p.utilitiesFee}</td>
                      </tr>
                    ) : null}
                    {p.petsPolicy ? (
                      <tr className="border-b border-slate-100">
                        <th
                          scope="row"
                          className="align-top bg-slate-50/80 px-4 py-3.5 text-xs font-bold uppercase tracking-wide text-slate-500 sm:px-5 sm:py-4"
                        >
                          Pets
                        </th>
                        <td className="align-top px-4 py-3.5 font-semibold text-slate-900 sm:px-5 sm:py-4">{p.petsPolicy}</td>
                      </tr>
                    ) : null}
                    {p.moveInChargesDisplay ? (
                      <tr className="border-b border-slate-100">
                        <th
                          scope="row"
                          className="align-top bg-slate-50/80 px-4 py-3.5 text-xs font-bold uppercase tracking-wide text-slate-500 sm:px-5 sm:py-4"
                        >
                          Move-in charges
                        </th>
                        <td className="align-top px-4 py-3.5 font-semibold text-slate-900 sm:px-5 sm:py-4">{p.moveInChargesDisplay}</td>
                      </tr>
                    ) : null}
                    {p.listingAvailabilitySummary ? (
                      <tr className="border-b-0">
                        <th
                          scope="row"
                          className="align-top bg-slate-50/80 px-4 py-3.5 text-xs font-bold uppercase tracking-wide text-slate-500 sm:px-5 sm:py-4"
                        >
                          Availability
                        </th>
                        <td className="align-top px-4 py-3.5 font-semibold text-slate-900 sm:px-5 sm:py-4">{p.listingAvailabilitySummary}</td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              {p.showFeesOnListing && (p.listingPricingBullets?.length > 0 || p.pricingNotesForListing) ? (
                <div className="mt-8 rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-5 sm:px-6">
                  <h3 className="text-sm font-black uppercase tracking-[0.12em] text-slate-600">Pricing transparency</h3>
                  <p className="mt-1 text-xs text-slate-600">
                    Provided by the property manager for this listing. Confirm final amounts in your lease.
                  </p>
                  {p.listingPricingBullets?.length > 0 ? (
                    <ul className="mt-4 list-disc space-y-2 pl-5 text-sm font-medium text-slate-800">
                      {p.listingPricingBullets.map((line, idx) => (
                        <li key={idx}>{line}</li>
                      ))}
                    </ul>
                  ) : null}
                  {p.pricingNotesForListing ? (
                    <p className="mt-4 text-sm leading-relaxed text-slate-700">{p.pricingNotesForListing}</p>
                  ) : null}
                </div>
              ) : null}

              {(p.securityDeposit || p.administrationFeeDisplay || p.applicationFeeDisplay || p.moveInChargesDisplay) ? (
                <div className="mt-8 rounded-2xl border border-stone-200 bg-[#faf8f5] px-4 py-5 sm:px-6">
                  <h3 className="text-sm font-black uppercase tracking-[0.12em] text-stone-600">Fee overview</h3>
                  <p className="mt-1 text-xs text-stone-600">
                    Typical move-in and recurring charges for this listing. Final amounts are confirmed in your lease.
                  </p>
                  <div className="mt-5 grid gap-4 md:grid-cols-3">
                    <div className="rounded-xl border border-stone-200/90 bg-white px-4 py-4 shadow-sm">
                      <h4 className="text-[10px] font-bold uppercase tracking-[0.12em] text-stone-500">Move-in costs</h4>
                      <ul className="mt-3 space-y-3 text-sm text-stone-800">
                        {p.securityDeposit ? (
                          <li>
                            <span className="font-bold">Security deposit (refundable)</span>
                            <div className="mt-0.5 font-black tabular-nums text-stone-900">{p.securityDeposit}</div>
                            <p className="mt-1 text-[11px] font-medium text-stone-500">Held per Washington law; not a fee.</p>
                          </li>
                        ) : null}
                        {p.administrationFeeDisplay ? (
                          <li>
                            <span className="font-bold">Administrative costs (non-refundable)</span>
                            <div className="mt-0.5 font-black tabular-nums text-stone-900">{p.administrationFeeDisplay}</div>
                            <p className="mt-1 text-[11px] font-medium text-stone-500">Processing / admin — separate from the security deposit.</p>
                          </li>
                        ) : null}
                        {p.applicationFeeDisplay ? (
                          <li>
                            <span className="font-bold">Application fee</span>
                            <div className="mt-0.5 font-semibold text-stone-900">{p.applicationFeeDisplay}</div>
                          </li>
                        ) : null}
                        {p.moveInChargesDisplay ? (
                          <li>
                            <span className="font-bold">Other move-in charges</span>
                            <div className="mt-0.5 font-semibold text-stone-900">{p.moveInChargesDisplay}</div>
                          </li>
                        ) : null}
                        {!p.securityDeposit && !p.administrationFeeDisplay && !p.applicationFeeDisplay && !p.moveInChargesDisplay ? (
                          <li className="text-xs text-stone-500">See table above for details.</li>
                        ) : null}
                      </ul>
                    </div>
                    <div className="rounded-xl border border-stone-200/90 bg-white px-4 py-4 shadow-sm">
                      <h4 className="text-[10px] font-bold uppercase tracking-[0.12em] text-stone-500">Other fees</h4>
                      <ul className="mt-3 list-disc space-y-2 pl-4 text-xs leading-relaxed text-stone-600">
                        <li>Late rent may incur a fee if not received by the due date stated in the lease.</li>
                        <li>Returned payments / NSF: actual bank fees as allowed by law.</li>
                        <li>Early move-out: damages and mitigation per lease — not an automatic penalty.</li>
                      </ul>
                    </div>
                    <div className="rounded-xl border border-stone-200/90 bg-white px-4 py-4 shadow-sm">
                      <h4 className="text-[10px] font-bold uppercase tracking-[0.12em] text-stone-500">Pets &amp; add-ons</h4>
                      <p className="mt-3 text-xs leading-relaxed text-stone-600">
                        {String(p.petsPolicy || '').trim() || 'Pet policy and optional add-ons (parking, storage, etc.) vary by property — confirm with Axis before applying.'}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}

              {Array.isArray(p.leasingPackages) && p.leasingPackages.length > 0 ? (
                <div className="mt-10">
                  <h3 className="text-sm font-black uppercase tracking-[0.14em] text-slate-500">Room &amp; full-house bundles</h3>
                  <p className="mt-2 text-sm text-slate-600">Combined monthly rates when renting multiple rooms or the full house.</p>
                  <div className="mt-4 w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <div className="hidden sm:grid sm:grid-cols-12 sm:gap-3 sm:border-b sm:border-slate-100 sm:bg-slate-50 sm:px-6 sm:py-2.5 sm:text-[10px] sm:font-bold sm:uppercase sm:tracking-[0.16em] sm:text-slate-400">
                      <div className="sm:col-span-4">Bundle</div>
                      <div className="sm:col-span-5">Rooms included</div>
                      <div className="sm:col-span-3 sm:text-right">Monthly rent</div>
                    </div>
                    <div className="divide-y divide-slate-100 px-4 sm:px-6">
                      {p.leasingPackages.map((pkg, idx) => (
                        <div key={`${pkg.title}-${idx}`} className="grid grid-cols-1 gap-2 py-4 sm:grid-cols-12 sm:items-center sm:gap-3">
                          <div className="font-semibold text-slate-900 sm:col-span-4">{pkg.title}</div>
                          <div className="text-sm text-slate-600 sm:col-span-5">
                            {(pkg.rooms || []).length ? (pkg.rooms || []).join(', ') : '—'}
                          </div>
                          <div className="text-sm font-black text-axis sm:col-span-3 sm:text-right">{pkg.totalRent || '—'}</div>
                          {pkg.details ? <div className="text-xs text-slate-500 sm:col-span-12">{pkg.details}</div> : null}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          {sectionNavTabs.some(([id]) => id === 'location') ? (
            <section
              id="location"
              ref={(node) => {
                sectionRefs.current.location = node
              }}
              className="mt-14 min-w-0 scroll-mt-32 md:scroll-mt-44"
            >
              <h2 className="font-editorial text-3xl font-black leading-tight text-slate-900 sm:text-4xl">Location</h2>
              <p className="mt-3 text-base font-semibold text-slate-900">{p.address || 'Seattle, WA'}</p>
              {p.location && typeof p.location.lat === 'number' && typeof p.location.lng === 'number' ? (
                <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 shadow-sm">
                  <div className="h-[min(420px,55vh)] w-full min-h-[260px]">
                    <MapView lat={p.location.lat} lng={p.location.lng} zoom={15} />
                  </div>
                </div>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-3">
                {p.location && typeof p.location.lat === 'number' && typeof p.location.lng === 'number' ? (
                  <a
                    href={`https://www.google.com/maps?q=${p.location.lat},${p.location.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex text-sm font-semibold text-axis hover:underline"
                  >
                    Open in Google Maps
                  </a>
                ) : null}
                {p.address ? (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.address)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex text-sm font-semibold text-axis hover:underline"
                  >
                    Search this address in Google Maps
                  </a>
                ) : null}
              </div>
            </section>
          ) : null}

          {modalPlan && (
            <Modal onClose={() => setModalPlan(null)}>
              <div className="p-1">
                <div className="flex items-start justify-between gap-4 pr-12">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-[0.18em] text-axis">{modalPlan.room.floorTitle || modalPlan.plan.title}</div>
                    <h3 className="mt-1 text-2xl font-black text-slate-900">{modalPlan.room.name}</h3>
                    {(modalPlan.room.pricingTierTitle || modalPlan.room.pricingTierSummary) && (
                      <div className="mt-1 text-sm text-slate-500">
                        {[modalPlan.room.pricingTierTitle, modalPlan.room.pricingTierSummary].filter(Boolean).join(' • ')}
                      </div>
                    )}
                  </div>
                  <AvailableBadge text={modalPlan.room.available} bookedFrom={modalPlan.room.bookedFrom} bookedUntil={modalPlan.room.bookedUntil} />
                </div>
                <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Monthly rent</div>
                    <div className="mt-2 text-2xl font-black text-slate-900">{modalPlan.room.price}</div>
                  </div>
                  <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Bathroom setup</div>
                    <div className="mt-2 text-sm font-semibold text-slate-700">
                      {modalPlan.room.bathroomSetup || modalPlan.room.details || 'Contact for bathroom details'}
                    </div>
                  </div>
                  <div className="rounded-[18px] border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Status</div>
                    <div className="mt-2"><AvailableBadge text={modalPlan.room.available} bookedFrom={modalPlan.room.bookedFrom} bookedUntil={modalPlan.room.bookedUntil} /></div>
                  </div>
                </div>
                {modalPlan.room.video && (
                  <div className="mt-4 rounded-[18px] overflow-hidden border border-slate-200">
                    <div className="bg-axis px-4 py-2.5 flex items-center gap-2">
                      <svg className="w-4 h-4 text-white/90" viewBox="0 0 24 24" fill="none" aria-hidden><polygon points="5,3 19,12 5,21" fill="currentColor"/></svg>
                      <span className="text-xs font-bold uppercase tracking-[0.14em] text-white/85">Room Tour</span>
                    </div>
                    <video
                      src={modalPlan.room.video}
                      controls
                      playsInline
                      className="w-full max-h-64 bg-black"
                    >
                      <source src={modalPlan.room.video} type="video/quicktime" />
                      <source src={modalPlan.room.video} type="video/mp4" />
                    </video>
                  </div>
                )}
                {!modalPlan.room.video && modalPlan.room.videoPlaceholder && (
                  <VideoPlaceholderCard
                    label="Room Tour"
                    text={modalPlan.room.videoPlaceholderText || 'Room tour coming soon.'}
                  />
                )}
                {modalPlan.room.bathroomVideo && (
                  <div className="mt-4 rounded-[18px] overflow-hidden border border-slate-200">
                    <div className="bg-axis px-4 py-2.5 flex items-center gap-2">
                      <svg className="w-4 h-4 text-white/90" viewBox="0 0 24 24" fill="none" aria-hidden><polygon points="5,3 19,12 5,21" fill="currentColor"/></svg>
                      <span className="text-xs font-bold uppercase tracking-[0.14em] text-white/85">{modalPlan.room.bathroomVideoLabel || 'Bathroom Tour'}</span>
                    </div>
                    <video
                      src={modalPlan.room.bathroomVideo}
                      controls
                      playsInline
                      className="w-full max-h-64 bg-black"
                    >
                      <source src={modalPlan.room.bathroomVideo} type="video/quicktime" />
                      <source src={modalPlan.room.bathroomVideo} type="video/mp4" />
                    </video>
                  </div>
                )}
                {!modalPlan.room.bathroomVideo && modalPlan.room.bathroomVideoPlaceholder && (
                  <VideoPlaceholderCard
                    label={modalPlan.room.bathroomVideoLabel || 'Bathroom Tour'}
                    text={modalPlan.room.bathroomVideoPlaceholderText || 'Bathroom tour coming soon.'}
                  />
                )}
                {Array.isArray(modalPlan.room.images) && modalPlan.room.images.length > 0 ? (
                  <div className="mt-5">
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Room photos</div>
                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {modalPlan.room.images.map((src) => (
                        <div key={src} className="overflow-hidden rounded-[18px] border border-slate-200">
                          <img src={src} alt={`${modalPlan.room.name} photo`} className="h-56 w-full object-cover" />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {includedItems.length > 0 ? (
                  <div className="mt-4 rounded-[18px] border border-blue-100 bg-blue-50 px-4 py-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-600">In this room</div>
                    <div className="mt-2 text-sm text-slate-700">Furniture and features included with this room:</div>
                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {includedItems.map((item, ii) => (
                        <div
                          key={`${item}-${ii}`}
                          className="flex items-center gap-2 rounded-xl border border-blue-200/80 bg-white px-3 py-2 text-xs font-semibold text-slate-800"
                        >
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-axis" aria-hidden />
                          {item}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                  <Link to={`/apply?property=${p.slug}&room=${encodeURIComponent(modalPlan.room.name)}`} onClick={scrollToTop} className="flex-1 rounded-full bg-axis py-3 text-center text-sm font-semibold text-white shadow-soft transition hover:opacity-95">Apply for this room</Link>
                  <Link to={`/contact?section=housing&tab=message&property=${p.slug}&room=${encodeURIComponent(modalPlan.room.name)}`} onClick={() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' })} className="flex-1 rounded-full border border-slate-300 py-3 text-center text-sm font-semibold text-slate-700 transition hover:border-axis hover:text-axis">Ask a question</Link>
                </div>
              </div>
            </Modal>
          )}
          {activeSharedSpace && (
            <Modal onClose={() => setActiveSharedSpace(null)}>
              <div className="p-1">
                <div className="flex items-start justify-between gap-4 pr-12">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-[0.18em] text-axis">Shared Spaces</div>
                    <h3 className="mt-1 text-2xl font-black text-slate-900">{getSharedSpaceDetailMeta(activeSharedSpace).title}</h3>
                    <div className="mt-2 text-sm leading-6 text-slate-500">{getSharedSpaceDetailMeta(activeSharedSpace).summary}</div>
                  </div>
                </div>
                <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {getSharedSpaceDetailMeta(activeSharedSpace).bullets.map((bullet) => (
                    <div key={bullet} className="rounded-[18px] border border-slate-200 bg-slate-50 p-4">
                      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Highlight</div>
                      <div className="mt-2 text-sm font-semibold text-slate-700">{bullet}</div>
                    </div>
                  ))}
                </div>
                {Array.isArray(activeSharedSpace.images) && activeSharedSpace.images.length > 0 ? (
                  <div className="mt-4 rounded-[18px] overflow-hidden border border-slate-200">
                    <img
                      src={activeSharedSpace.images[0]}
                      alt={`${getSharedSpaceDetailMeta(activeSharedSpace).title} photo`}
                      className="h-64 w-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="mt-4 h-64 overflow-hidden rounded-[18px] border border-slate-200">
                    <PropertyMediaPlaceholder className="h-full w-full" compact label="Photos coming soon" />
                  </div>
                )}

                {activeSharedSpace.src && !activeSharedSpace.placeholder ? (
                  <div className="mt-4 rounded-[18px] overflow-hidden border border-slate-200">
                    <div className="bg-axis px-4 py-2.5 flex items-center gap-2">
                      <svg className="w-4 h-4 text-white/90" viewBox="0 0 24 24" fill="none" aria-hidden><polygon points="5,3 19,12 5,21" fill="currentColor"/></svg>
                      <span className="text-xs font-bold uppercase tracking-[0.14em] text-white/85">{getSharedSpaceDetailMeta(activeSharedSpace).title}</span>
                    </div>
                    <video controls playsInline className="w-full max-h-64 bg-black">
                      <source src={activeSharedSpace.src} type="video/quicktime" />
                      <source src={activeSharedSpace.src} type="video/mp4" />
                    </video>
                  </div>
                ) : (
                  <VideoPlaceholderCard
                    label={getSharedSpaceDetailMeta(activeSharedSpace).title}
                    text={activeSharedSpace.placeholderText || `${getSharedSpaceDetailMeta(activeSharedSpace).title} coming soon.`}
                  />
                )}
                <div className="mt-4 rounded-[18px] border border-blue-100 bg-blue-50 px-4 py-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-600">What this shows</div>
                  <div className="mt-2 text-sm leading-6 text-slate-700">{getSharedSpaceDetailMeta(activeSharedSpace).description}</div>
                </div>
              </div>
            </Modal>
          )}
          {activeBathroom && (
            <Modal onClose={() => setActiveBathroom(null)}>
              <div className="p-1">
                <div className="flex items-start justify-between gap-4 pr-12">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-[0.18em] text-axis">Bathroom</div>
                    <h3 className="mt-1 text-2xl font-black text-slate-900">{activeBathroom.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{activeBathroom.description}</p>
                    {activeBathroom.accessLabel ? (
                      <p className="mt-2 text-xs font-bold uppercase tracking-[0.12em] text-axis">{activeBathroom.accessLabel}</p>
                    ) : null}
                  </div>
                </div>
                {Array.isArray(activeBathroom.videos) && activeBathroom.videos.length > 0 ? (
                  <div className="mt-5 space-y-3">
                    {activeBathroom.videos.map((v) => (
                      <div key={v.src} className="overflow-hidden rounded-[18px] border border-slate-200 bg-black">
                        <video src={v.src} className="h-56 w-full object-contain" controls playsInline />
                        {v.label ? <div className="bg-slate-900 px-3 py-2 text-xs font-semibold text-white">{v.label}</div> : null}
                      </div>
                    ))}
                  </div>
                ) : null}
                {Array.isArray(activeBathroom.images) && activeBathroom.images.length > 0 ? (
                  <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {activeBathroom.images.map((src) => (
                      <div key={src} className="overflow-hidden rounded-[18px] border border-slate-200">
                        <img src={src} alt={`${activeBathroom.title} photo`} className="h-56 w-full object-cover" />
                      </div>
                    ))}
                  </div>
                ) : null}
                {(!activeBathroom.images || activeBathroom.images.length === 0) &&
                (!activeBathroom.videos || activeBathroom.videos.length === 0) ? (
                  <div className="mt-5 h-64 overflow-hidden rounded-[18px] border border-slate-200">
                    <PropertyMediaPlaceholder className="h-full w-full" compact label="Photos and videos coming soon" />
                  </div>
                ) : null}
              </div>
            </Modal>
          )}
        </div>

        <div className="hidden md:block md:col-span-3">
          <aside className="w-full md:sticky top-24 space-y-4">
            <div className="overflow-hidden rounded-[18px] border border-slate-200 bg-stone-50">
              <div className="px-6 py-6">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Starting from</div>
                <div className="mt-2 text-4xl font-black leading-tight text-slate-900 break-words">{startingRent}</div>
                <div className="mt-1 text-sm text-slate-500">per month</div>
              </div>
              <div className="flex flex-col gap-2.5 border-t border-slate-200 p-5">
                <button
                  type="button"
                  onClick={() => setShowTourModal(true)}
                  className="w-full rounded-full bg-axis py-3 text-center text-sm font-semibold text-white transition hover:opacity-95"
                >Schedule a tour</button>
                <Link
                  to={`/apply?property=${p.slug}`}
                  onClick={scrollToTop}
                  className="w-full rounded-full border border-slate-300 py-3 text-center text-sm font-semibold text-slate-700 transition hover:border-slate-500"
                >Apply online</Link>
              </div>
            </div>

            <div className="rounded-[18px] border border-slate-200 bg-white p-5">
              <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Quick facts</div>
              <div className="mt-3 divide-y divide-slate-100">
                {[
                  ['Neighborhood', p.neighborhood],
                  ['Bedrooms', p.beds],
                  [
                    'Bathrooms',
                    p.baths === '' || p.baths == null
                      ? '—'
                      : typeof p.baths === 'number'
                        ? formatBathroomCountForDisplay(p.baths)
                        : String(p.baths),
                  ],
                  ['Type', p.type],
                ].map(([label, val]) => (
                  <div key={label} className="flex items-center justify-between py-2.5">
                    <span className="text-xs font-semibold text-slate-500">{label}</span>
                    <span className="text-xs font-bold text-slate-900">{val}</span>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </div>
      </div>

      {/* Mobile bottom spacer so content doesn't hide behind sticky CTA */}
      <div className="h-20 md:hidden" aria-hidden />

      {/* Mobile sticky CTA — floating liquid glass so it stays visible on white pages */}
      <div className="pointer-events-none fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-[25] md:hidden">
        <div
          className="pointer-events-auto flex items-center gap-2.5 rounded-[22px] border border-slate-200/90 bg-white/80 px-4 py-3 shadow-[0_20px_50px_rgba(15,23,42,0.14),0_0_0_1px_rgba(15,23,42,0.06),inset_0_1px_0_0_rgba(255,255,255,0.95)] backdrop-blur-2xl backdrop-saturate-150"
        >
          <div className="min-w-0 flex-1">
            <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-500">Starting from</div>
            <div className="truncate text-base font-black leading-tight text-slate-900">{startingRent}/mo</div>
          </div>
          <button
            type="button"
            onClick={() => setShowTourModal(true)}
            className="shrink-0 rounded-full border border-slate-300/90 bg-white/60 px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm backdrop-blur-sm transition active:scale-95"
          >
            Schedule a tour
          </button>
          <Link
            to={`/apply?property=${p.slug}`}
            onClick={scrollToTop}
            className="shrink-0 rounded-full bg-[linear-gradient(180deg,#2f76ff_0%,#2450eb_100%)] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_4px_16px_rgba(37,99,235,0.35)] transition active:scale-95"
          >
            Apply
          </Link>
        </div>
      </div>
      {showTourModal && (
        <TourBookingModal
          open={showTourModal}
          onClose={() => setShowTourModal(false)}
          propertyName={p?.name || p?.title || ''}
          tourAvailabilityText={tourAvailabilityText}
          propertyId={dynamicPropertyId}
        />
      )}
    </div>
  )
}

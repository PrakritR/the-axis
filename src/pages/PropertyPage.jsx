import React, { useEffect, useRef, useState } from 'react'
import { useParams, Link, useLocation } from 'react-router-dom'
import MapView from '../components/Map'
import PropertyGallery from '../components/PropertyGallery'
import { properties } from '../data/properties'
import { Seo, buildPropertySchema } from '../lib/seo'
import { getStartingRent } from '../lib/pricing'
import Modal from '../components/Modal'
import scrollToTop from '../utils/scrollToTop'
import { getAmenityIcon } from '../components/AmenityIcon'


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

  const afterRegex = /after ([A-Za-z]+ \d{1,2}, \d{4})/gi
  let afterMatch
  while ((afterMatch = afterRegex.exec(normalized)) !== null) {
    const afterDate = parseMonthDayYear(afterMatch[1])
    const start = afterDate ? new Date(afterDate.getTime() + 86400000) : null
    if (start) {
      windows.push({ start, end: null })
    }
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

function parseMonthlyRentValue(value) {
  if (!value) return null
  const match = String(value).match(/\$([\d,]+)/)
  if (!match) return null
  const amount = Number(match[1].replace(/,/g, ''))
  return Number.isFinite(amount) ? amount : null
}

function formatMonthlyCurrency(value) {
  if (!Number.isFinite(value)) return ''
  return `$${value.toLocaleString()}/month`
}

function formatCompactMonthlyCurrency(value) {
  if (!Number.isFinite(value)) return ''
  return `$${value.toLocaleString()}/mo`
}

function buildRentTotals(property) {
  if (!Array.isArray(property.roomPlans) || property.roomPlans.length === 0) {
    return { totalHouseRent: null, floorTotals: [] }
  }

  const floorTotals = property.roomPlans.map((plan) => ({
    title: plan.title,
    total: (plan.rooms || []).reduce((sum, room) => {
      const amount = parseMonthlyRentValue(room.price)
      return sum + (amount || 0)
    }, 0),
  }))

  return {
    totalHouseRent: floorTotals.reduce((sum, floor) => sum + floor.total, 0),
    floorTotals,
  }
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

function buildRoomPlanDisplay(property) {
  if (!Array.isArray(property.roomPlans)) return []

  if (property.slug !== '5259-brooklyn-ave-ne') {
    return [...property.roomPlans]
      .map((plan) => {
        const sortedRooms = [...plan.rooms].sort(compareRoomNames)
        return {
          ...plan,
          rooms: sortedRooms.map((room) => ({
            ...room,
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
        ...room,
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
              </div>
              {(r.floorTitle || r.details) && (
                <div className="mt-0.5 text-xs text-slate-400 break-words">{[r.floorTitle, r.details].filter(Boolean).join(' · ')}</div>
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

export default function PropertyPage(){
  const { slug } = useParams()
  const { hash } = useLocation()
  const p = properties.find(x=>x.slug===slug)

  const [showAllPhotos, setShowAllPhotos] = useState(false)
  const [modalPlan, setModalPlan] = useState(null)
  const [modalImages, setModalImages] = useState([])
  const [activeTab, setActiveTab] = useState('overview')
  const [showScarcityPopup, setShowScarcityPopup] = useState(false)
  const [activeSharedSpace, setActiveSharedSpace] = useState(null)
  const sectionRefs = useRef({})

  const displayedRoomPlansForEffect = p ? buildRoomPlanDisplay(p) : []
  const scarcePlanForEffect = displayedRoomPlansForEffect.find(
    (plan) => (plan.roomsAvailable || plan.rooms.length) === 1
  )

  useEffect(() => {
    const sectionId = (hash || '').replace('#', '')
    if (!sectionId) {
      setActiveTab('overview')
      return
    }
    if (['overview', 'floor-plans', 'shared-spaces', 'leasing', 'highlights', 'amenities', 'policies', 'map'].includes(sectionId)) {
      setActiveTab(sectionId)
    }
  }, [hash])

  useEffect(() => {
    setShowScarcityPopup(false)
    if (!p || !scarcePlanForEffect) return undefined

    const timer = window.setTimeout(() => {
      setShowScarcityPopup(true)
    }, 1200)

    return () => window.clearTimeout(timer)
  }, [p, scarcePlanForEffect?.title, scarcePlanForEffect?.priceRange])

  function getScrollContainer(node){
    let parent = node?.parentElement || null
    while(parent){
      const style = window.getComputedStyle(parent)
      const hasScrollableOverflow = /(auto|scroll|overlay)/.test(style.overflowY)
      if (hasScrollableOverflow && parent.scrollHeight > parent.clientHeight) {
        return parent
      }
      parent = parent.parentElement
    }
    return document.scrollingElement || document.documentElement
  }

  // helper to scroll to an id while accounting for sticky chrome
  function scrollToId(id){
    const el = sectionRefs.current[id] || document.getElementById(id)
    if(!el) return false

    const header = document.querySelector('header')
    const headerH = header ? header.offsetHeight : 0
    const nav = document.getElementById('section-nav')
    const navH = window.matchMedia('(min-width: 768px)').matches && nav ? nav.offsetHeight : 0
    const gap = 12
    const offset = headerH + navH + gap
    const container = getScrollContainer(el)

    if (container === document.documentElement || container === document.body || container === document.scrollingElement) {
      const top = Math.max(0, el.getBoundingClientRect().top + window.scrollY - offset)
      window.scrollTo({ top, behavior: 'smooth' })
      document.documentElement.scrollTop = top
      document.body.scrollTop = top
      return true
    }

    const containerRect = container.getBoundingClientRect()
    const targetTop = el.getBoundingClientRect().top - containerRect.top + container.scrollTop - offset
    container.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' })

    return true
  }

  if (!p) {
    return <div className="container mx-auto px-6 py-12">Property not found</div>
  }

  const is4709 = p.slug === '4709a-8th-ave'
  const galleryImages = (p.images && p.images.length) ? p.images : []

  // allow properties to explicitly declare community vs unit amenities. fall back to old `amenities` slicing
  const community = p.communityAmenities || (p.amenities || []).slice(0,4)
  const unitFeatures = p.unitAmenities || (p.amenities || []).slice(4,12)

  // Deduplicate and ensure no overlap: community features should be distinct from unit features
  const normalize = s => (s || '').toString().trim().toLowerCase()
  const seen = new Set()
  const communityUnique = []
  for(const a of community){
    const n = normalize(a)
    if(!n || seen.has(n)) continue
    seen.add(n)
    communityUnique.push(a)
  }
  const unitUnique = []
  for(const a of unitFeatures){
    const n = normalize(a)
    if(!n || seen.has(n)) continue // skip if already in community
    if(unitUnique.map(x=>normalize(x)).includes(n)) continue
    unitUnique.push(a)
  }

  // Polished description for 4709A, otherwise use property summary
  const description = is4709
    ? [
        'Spacious 10-bedroom townhouse in Seattle. The three-story layout balances private bedrooms with generous shared living areas, making it a practical option for larger households.',
        'Common spaces include a full kitchen and a comfortable living area on the first floor. The home features in-unit laundry, three full bathrooms across the home, and a half bathroom on the first floor.'
      ]
    : [p.summary]

  const includedItems = modalPlan
    ? Array.from(new Set([
        'Bed',
        'Desk',
        'Keypad lock',
        ...(Array.isArray(p.unitAmenities) ? p.unitAmenities : []),
        ...(modalPlan.room.details ? modalPlan.room.details.split(',') : []),
      ].map(normalizeFeatureLabel).filter(Boolean)))
    : []

  const displayedRoomPlans = displayedRoomPlansForEffect
  const roomPlansHeading = p.slug === '5259-brooklyn-ave-ne' ? 'Pricing & Availability' : 'Floor Plans'
  const roomPlansLabel = p.slug === '5259-brooklyn-ave-ne' ? 'Pricing tiers' : 'Availability'
  const scarcePlan = scarcePlanForEffect
  const startingRent = formatStartingRent(getStartingRent(p))
  const rentTotals = buildRentTotals(p)
  const sharedSpaceVideos = getSharedSpaceVideos(p.videos || [])
  const leasingPackages = p.leasingPackages || []

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
        <div
          id="overview"
          ref={(node) => { sectionRefs.current.overview = node }}
          className="property-gallery mx-auto max-w-[1480px] scroll-mt-28 px-4 pt-6 sm:px-6 sm:pt-8 md:scroll-mt-40 lg:px-10 lg:pt-10"
        >
          <h1 className="sr-only">{p.name}</h1>
          <PropertyGallery images={galleryImages} videos={p.videos || []} />
        </div>

      <div className="mx-auto mt-12 grid min-w-0 max-w-[1480px] gap-10 px-4 sm:px-6 md:grid-cols-12 lg:px-10">
        <div className="min-w-0 md:col-span-9">

          <div id="section-nav" className="mt-8 border-b border-slate-200 bg-white/95 backdrop-blur-sm md:sticky md:top-16 md:z-20">
            <nav className="flex gap-1 overflow-x-auto py-2 scrollbar-none">
              {[
                ['overview','Overview'],
                ['floor-plans','Floor Plans'],
                ['shared-spaces','Shared Spaces'],
                ['policies','Lease basics'],
                ['amenities','Amenities'],
                ['leasing','Bundles & leasing'],
                ['map','Map'],
              ].map(([id, label]) => (
                <button
                  type="button"
                  key={id}
                  onClick={(event) => {
                    setActiveTab(id)
                    scrollToId(id)
                  }}
                  className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition ${
                    activeTab === id
                      ? 'bg-axis text-white'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </nav>
          </div>

          {/* Floor Plans */}
          {displayedRoomPlans.length > 0 && (
            <section id="floor-plans" ref={(node) => { sectionRefs.current['floor-plans'] = node }} className="mt-10 min-w-0 scroll-mt-28 md:scroll-mt-40">
              <div className="flex min-w-0 flex-wrap items-end justify-between gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1">
                  <h2 className="font-editorial text-3xl leading-tight text-slate-900 sm:text-4xl">{roomPlansHeading}</h2>
                </div>
                <div className="shrink-0 text-sm text-slate-500">
                  {displayedRoomPlans.reduce((acc, pl) => acc + pl.rooms.length, 0)} rooms listed
                </div>
              </div>
              <div className="mt-5 min-w-0 space-y-4">
                {displayedRoomPlans.map((plan, i) => (
                  <FloorPlanCard key={i} plan={plan} onDetail={(room)=> setModalPlan({plan, room})} />
                ))}
              </div>
            </section>
          )}

          {sharedSpaceVideos.length > 0 ? (
            <section id="shared-spaces" ref={(node) => { sectionRefs.current['shared-spaces'] = node }} className="mt-10 scroll-mt-28 md:scroll-mt-40">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <h2 className="font-editorial text-3xl leading-tight text-slate-900 sm:text-4xl">Kitchen and living area</h2>
                </div>
                <div className="shrink-0 text-sm text-slate-500">
                  {sharedSpaceVideos.length} shared spaces
                </div>
              </div>
              <div className="mt-5 overflow-hidden rounded-[18px] border border-slate-200 bg-white">
                <div className="hidden sm:grid grid-cols-12 gap-3 border-b border-slate-100 bg-slate-50 px-6 py-3 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
                  <div className="col-span-4">Space</div>
                  <div className="col-span-6">Overview</div>
                  <div className="col-span-2 text-right"></div>
                </div>
                <div className="divide-y divide-slate-100 px-4 sm:px-6">
                  {sharedSpaceVideos.map((video) => {
                    const meta = getSharedSpaceDetailMeta(video)
                    return (
                      <div key={video.label} className="grid grid-cols-1 items-center gap-2 py-4 sm:grid-cols-12 sm:gap-3">
                        <div className="sm:col-span-4">
                          <div className="font-semibold text-slate-900">{meta.title.replace(' Tour', '')}</div>
                          <div className="mt-0.5 text-xs text-slate-500">Shared common area</div>
                        </div>
                        <div className="sm:col-span-6">
                          <div className="text-sm text-slate-600">{meta.rowSummary}</div>
                        </div>
                        <div className="sm:col-span-2 flex justify-end">
                          <button
                            type="button"
                            onClick={() => setActiveSharedSpace(video)}
                            className="w-full sm:w-auto rounded-full border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-500"
                          >
                            Details
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </section>
          ) : null}

          <section id="policies" ref={(node) => { sectionRefs.current.policies = node }} className="mt-10 scroll-mt-28 md:scroll-mt-40">
            <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Lease Basics</div>
            <div className="mt-5 overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.06)]">
              {[
                ...(p.policies ? [{ emoji:'📋', label:'Lease terms', value: p.policies }] : []),
                { emoji:'📄', label:'Application', value: `Fee: ${p.applicationFee || 'Contact us'}` },
                { emoji:'💲', label:'Move-in charges', value: `First month rent + ${p.securityDeposit || '$500'} deposit` },
                { emoji:'🔒', label:'Security deposit', value: p.securityDeposit || '$500' },
                { emoji:'📶', label:'Utilities', value: 'Flat fee: $175/month — includes cleaning (bi-monthly), WiFi, water & trash' },
                { emoji:'🐾', label:'Pets', value: 'Pets may be allowed' },
              ].map(({ emoji, label, value }, i, arr) => (
                <div key={label} className={`flex items-start gap-3 px-5 py-4 sm:gap-4 sm:px-8 sm:py-5 ${i < arr.length - 1 ? 'border-b border-slate-100' : ''}`}>
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center text-base sm:h-10 sm:w-10 sm:text-lg">{emoji}</div>
                  <div className="min-w-0 flex-1">
                    <div className="break-words text-[13px] font-bold text-slate-900 sm:text-sm">{label}</div>
                    <div className="mt-0.5 break-words text-[13px] leading-5 text-slate-500 sm:text-sm sm:leading-6">{value}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>

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
                    <div className="mt-2 text-sm font-semibold text-slate-700">{modalPlan.room.details || 'Shared bathroom'}</div>
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
                <div className="mt-4 rounded-[18px] border border-blue-100 bg-blue-50 px-4 py-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-600">What's included</div>
                  <div className="mt-2 text-sm text-slate-700">This room includes the following features:</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {includedItems.map((item) => (
                      <span key={item} className="rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-semibold text-blue-700">
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                  <Link to={`/apply?property=${p.slug}&room=${encodeURIComponent(modalPlan.room.name)}`} onClick={scrollToTop} className="flex-1 rounded-full bg-axis py-3 text-center text-sm font-semibold text-white shadow-soft transition hover:opacity-95">Apply for this room</Link>
                  <Link to="/contact?section=housing&tab=message" onClick={() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' })} className="flex-1 rounded-full border border-slate-300 py-3 text-center text-sm font-semibold text-slate-700 transition hover:border-axis hover:text-axis">Ask a question</Link>
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

          {/* Amenities */}
          <section id="amenities" ref={(node) => { sectionRefs.current.amenities = node }} className="mt-10 scroll-mt-28 md:scroll-mt-40">
            <div className="grid gap-8 border-t border-slate-200 pt-10 lg:grid-cols-[280px_minmax(0,1fr)]">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Features</div>
              </div>
              <div className="space-y-10">
                {communityUnique.length > 0 && (
                  <div>
                    <div className="mb-4 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Shared spaces and house features</div>
                    <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                      {communityUnique.map((a, i) => (
                        <div key={i} className="flex items-start gap-3 border-t border-slate-200 pt-4">
                          <div className="mt-0.5 text-axis">{getAmenityIcon(a, 'sm')}</div>
                          <div className="text-sm leading-6 text-slate-700">{a}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {unitUnique.length > 0 && (
                  <div>
                    <div className="mb-4 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">In each room</div>
                    <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                      {unitUnique.map((a, i) => (
                        <div key={i} className="flex items-start gap-3 border-t border-slate-200 pt-4">
                          <div className="mt-0.5 text-axis">{getAmenityIcon(a, 'sm')}</div>
                          <div className="text-sm leading-6 text-slate-700">{a}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>

          {(rentTotals.totalHouseRent > 0 || leasingPackages.length > 0 || (p.leaseTerms && p.leaseTerms.length > 0)) ? (
            <section id="leasing" ref={(node) => { sectionRefs.current.leasing = node }} className="mt-10 scroll-mt-28 md:scroll-mt-40">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <h2 className="font-editorial text-3xl leading-tight text-slate-900 sm:text-4xl">Pricing &amp; leasing</h2>
              </div>

              <div className="mt-6 overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.06)]">
                {rentTotals.totalHouseRent > 0 ? (
                  <div className="border-b border-slate-100 bg-[linear-gradient(180deg,#fafaf9_0%,#ffffff_100%)] px-6 py-6 sm:px-8 sm:py-7">
                    <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Full house</div>
                    <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
                      <div className="text-3xl font-black tracking-tight text-slate-900 sm:text-[2.5rem]">
                        {formatCompactMonthlyCurrency(rentTotals.totalHouseRent)}
                      </div>
                    </div>
                  </div>
                ) : null}

                {leasingPackages.length > 0 ? (
                  <div className="border-b border-slate-100 px-6 py-6 sm:px-8">
                    <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Grouped packages</div>
                    <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      {leasingPackages.map((pkg) => (
                        <div
                          key={pkg.title}
                          className="rounded-[18px] border border-slate-200 bg-stone-50/90 px-5 py-5"
                        >
                          <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">{pkg.title}</div>
                          <div className="mt-2 text-2xl font-black leading-none text-slate-900">
                            {pkg.totalRent.replace('/month', '/mo')}
                          </div>
                          <div className="mt-3 text-sm leading-relaxed text-slate-500">{pkg.rooms.join(' · ')}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {p.leaseTerms?.length > 0 ? (
                  <div className="px-6 py-6 sm:px-8 sm:py-7">
                    <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Lease lengths</div>
                    <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-600">
                      <span className="font-semibold text-slate-800">3-, 9-, and 12-month</span>
                      {' '}leases are available, plus custom or month-to-month when it makes sense. Start and end dates are flexible. Room rates in the list above apply per month; your total depends on which rooms you take and your lease window.
                    </p>
                    <Link
                      to="/contact?section=housing&tab=message"
                      onClick={() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' })}
                      className="mt-5 inline-flex rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-axis hover:text-axis"
                    >
                      Discuss your timeline
                    </Link>
                  </div>
                ) : null}

                {(rentTotals.totalHouseRent > 0 || leasingPackages.length > 0) ? (
                  <div className="border-t border-slate-100 bg-slate-50/60 px-6 py-3.5 text-xs leading-5 text-slate-500 sm:px-8">
                    Rent figures above do not include utilities or the house fee — see Lease basics for move-in costs and what&apos;s included.
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}

          {/* Map */}
          <section id="map" ref={(node) => { sectionRefs.current.map = node }} className="mt-10 mb-14 scroll-mt-28 md:scroll-mt-40">
            <div className="grid gap-8 border-t border-slate-200 pt-10 lg:grid-cols-[320px_minmax(0,1fr)]">
              <div>
                <h2 className="font-editorial text-3xl leading-tight text-slate-900 sm:text-4xl">Location</h2>
                <p className="mt-3 text-base leading-8 text-slate-600">{p.neighborhood}</p>
                <div className="mt-6 border-t border-slate-200 pt-4 text-sm leading-7 text-slate-600">{p.address}</div>
              </div>
              <div className="overflow-hidden rounded-[18px] border border-slate-200">
                {p.location ? (
                  <div className="h-[260px] sm:h-[420px]">
                    <MapView lat={p.location.lat} lng={p.location.lng} zoom={15} />
                  </div>
                ) : (
                  <div className="flex h-[420px] items-center justify-center bg-slate-50 text-sm text-slate-400">Map unavailable for {p.address}</div>
                )}
              </div>
            </div>
          </section>
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
                  onClick={() => scrollToId('floor-plans')}
                  className="w-full rounded-full bg-axis py-3 text-sm font-semibold text-white transition hover:opacity-95"
                >Check availability</button>
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
                  ['Bathrooms', p.baths],
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
            onClick={() => scrollToId('floor-plans')}
            className="shrink-0 rounded-full border border-slate-300/90 bg-white/60 px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm backdrop-blur-sm transition active:scale-95"
          >
            Rooms
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
    </div>
  )
}

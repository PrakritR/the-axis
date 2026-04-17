import React from 'react'
import { formatApplicationDetailValue } from './applicationDetailPanel.jsx'
import { parseAxisListingMetaBlock } from './axisListingMeta.js'
import {
  normalizeLeasingFromMeta,
  PROPERTY_EDIT_REQUEST_FIELD,
  PROPERTY_AIR,
  PROPERTIES_LEASING_META_KEYS,
  MAX_LAUNDRY_SLOTS,
  laundryTypeField,
  laundryRoomsSharingField,
} from './managerPropertyFormAirtableMap.js'
import { buildAdminPropertyDetailSyntheticAirtable } from './adminPortalPropertiesSupabase.js'

const MAX_ROOMS = 20
const MAX_BATHROOMS = 10
const MAX_KITCHENS = 3
const MAX_SHARED_SPACES = 13 // matches MAX_SHARED_SPACE_SLOTS in managerPropertyFormAirtableMap.js

function roomFields(n) {
  return [
    [`Room ${n} Name`, `Room ${n} name`],
    [`Room ${n} Rent`, `Room ${n} rent`],
    [`Room ${n} Availability`, `Room ${n} availability`],
    [`Room ${n} Furnished`, `Room ${n} furnished`],
    [`Room ${n} Utilities Description`, `Room ${n} utilities`],
    [`Room ${n} Utilities Cost`, `Room ${n} utilities cost`],
    [`Room ${n} Notes`, `Room ${n} notes`],
  ]
}

function bathroomFields(n) {
  return [
    [`Bathroom ${n}`, `Bathroom ${n} description`],
    [`Rooms Sharing Bathroom ${n}`, `Bathroom ${n} shared by`],
  ]
}

function kitchenFields(n) {
  return [
    [`Kitchen ${n}`, `Kitchen ${n} description`],
    [`Rooms Sharing Kitchen ${n}`, `Kitchen ${n} shared by`],
  ]
}

function sharedSpaceFields(n) {
  return [
    [`Shared Space ${n} Name`, `Shared space ${n} name`],
    [`Shared Space ${n} Type`, `Shared space ${n} type`],
    [`Access to Shared Space ${n}`, `Shared space ${n} access`],
  ]
}

function parseLabeledLinesBlock(value) {
  const lines = String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const items = []
  for (const line of lines) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const label = line.slice(0, idx).trim()
    const val = line.slice(idx + 1).trim()
    if (!label || !val) continue
    items.push({ label, value: val })
  }
  return items.length >= 3 ? items : []
}

function humanizeMetaKey(key) {
  const s = String(key || '')
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .trim()
  if (!s) return 'Field'
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Pretty-print Move In Charges JSON for the property detail panel. */
function formatMoveInChargesJsonDisplay(raw) {
  const str = String(raw ?? '').trim()
  if (!str) return null
  try {
    const parsed = JSON.parse(str)
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return JSON.stringify(parsed, null, 2)
    }
    const lines = parsed.map((row, i) => {
      if (!row || typeof row !== 'object') return `• Row ${i + 1}: (invalid)`
      const name = String(row.name ?? '').trim() || 'Charge'
      const amt = String(row.amount ?? '').trim()
      const req = Boolean(row.requiredBeforeSigning)
      const amtPart = amt !== '' ? (Number.isFinite(Number(amt)) ? `$${amt}` : amt) : '—'
      const reqPart = req ? 'required before signing' : 'not required before signing'
      return `• ${name} — ${amtPart} — ${reqPart}`
    })
    return lines.join('\n')
  } catch {
    return str
  }
}

function metaPropertyListingItems(meta) {
  const out = []
  const pushIf = (label, value) => {
    const v = formatApplicationDetailValue(value)
    if (v) out.push({ label, value: v })
  }
  pushIf('Property type', meta.propertyTypeOther)
  const bt = Number(meta.bathroomTotalDecimal)
  if (Number.isFinite(bt) && bt > 0) out.push({ label: 'Total bathrooms', value: String(bt) })
  const windows = Array.isArray(meta.listingAvailabilityWindows) ? meta.listingAvailabilityWindows : []
  if (windows.length) {
    const parts = windows
      .map((window) => {
        const start = String(window?.start || '').trim()
        const end = String(window?.end || '').trim()
        if (!start) return ''
        return end ? `${start} - ${end}` : `${start} onward`
      })
      .filter(Boolean)
    if (parts.length) out.push({ label: 'Move-in availability', value: parts.join('; ') })
  }
  return out
}

function metaRoomsToItems(meta) {
  const rooms = Array.isArray(meta?.roomsDetail) ? meta.roomsDetail : []
  if (!rooms.length) return []
  const items = []
  for (const room of rooms) {
    if (!room || typeof room !== 'object') continue
    const label = String(room.label || '').trim() || 'Room'
    const pushIf = (suffix, value) => {
      const v = formatApplicationDetailValue(value)
      if (v) items.push({ label: `${label} ${suffix}`, value: v })
    }
    pushIf('Rent', room.rent)
    pushIf('Availability', room.availability)
    pushIf('Furnished', room.furnished)
    pushIf('Utilities', room.utilities)
    pushIf('Utilities cost', room.utilitiesCost)
    pushIf('Notes', room.notes)
    pushIf('Bathroom setup', room.bathroomSetup)
    pushIf('Furniture included', room.furnitureIncluded)
    pushIf('Features', room.additionalFeatures)
    if (room.unavailable === true || room.unavailable === 1) {
      items.push({ label: `${label} unavailable`, value: 'Yes' })
    }
  }
  return items
}

function metaFinancialItems(meta) {
  if (!meta?.financials || typeof meta.financials !== 'object') return []
  const out = []
  const pushIf = (label, value) => {
    const v = formatApplicationDetailValue(value)
    if (v) out.push({ label, value: v })
  }
  pushIf('Security deposit', meta.financials.securityDeposit)
  pushIf('Move-in charges', meta.financials.moveInCharges)
  const seen = new Set(['securityDeposit', 'moveInCharges'])
  for (const [key, value] of Object.entries(meta.financials)) {
    if (seen.has(key)) continue
    pushIf(humanizeMetaKey(key), value)
  }
  return out
}

function metaLeasingItems(meta) {
  if (!meta?.leasing || typeof meta.leasing !== 'object') return []
  const norm = normalizeLeasingFromMeta(meta.leasing)
  const out = []
  const pushIf = (label, value) => {
    const v = formatApplicationDetailValue(value)
    if (v) out.push({ label, value: v })
  }
  pushIf('Full house price', norm.fullHousePrice)
  pushIf('Promotional full house price', norm.promoPrice)
  pushIf('Lease length information', norm.leaseLengthInfo)
  for (const bundle of norm.bundles) {
    const name = String(bundle.name || 'Leasing package').trim() || 'Leasing package'
    pushIf(`${name} monthly rent`, bundle.price)
    if (bundle.rooms?.length) {
      out.push({
        label: `${name} rooms included`,
        value: bundle.rooms.map((room) => String(room).trim()).filter(Boolean).join(', '),
      })
    }
  }
  return out
}

function metaSharedSpacesItems(meta) {
  const rows = Array.isArray(meta.sharedSpacesDetail) ? meta.sharedSpacesDetail : []
  const out = []
  rows.forEach((row, index) => {
    if (!row || typeof row !== 'object') return
    const title = String(row.title || row.name || `Shared space ${index + 1}`).trim()
    const desc = String(row.description || row.notes || '').trim()
    const imageCount = Array.isArray(row.imageUrls) ? row.imageUrls.filter(Boolean).length : 0
    const bits = [desc, imageCount ? `${imageCount} photo(s)` : ''].filter(Boolean)
    if (bits.length) out.push({ label: title, value: bits.join(' · ') })
  })
  return out
}

function metaMediaItems(meta) {
  const videos = Array.isArray(meta.listingVideos) ? meta.listingVideos : []
  if (!videos.length) return []
  const lines = videos
    .map((video, index) => {
      const row = video && typeof video === 'object' ? video : {}
      const label = String(row.label || `Video ${index + 1}`).trim()
      const url = String(row.url || row.src || '').trim()
      if (row.placeholder) return `${label}${row.placeholderText ? ` - ${row.placeholderText}` : ' (coming soon)'}`
      return url ? `${label}: ${url}` : label || null
    })
    .filter(Boolean)
  return lines.length ? [{ label: 'Listing videos', value: lines.join('\n') }] : []
}

/** Logical groupings for Properties / House rows in admin review */
export const PROPERTY_FIELD_GROUPS = [
  {
    title: 'Listing',
    fields: [
      ['Name', 'Property name'],
      [PROPERTY_AIR.propertyName, 'Property name (Airtable)'],
      [PROPERTY_AIR.propertyType, 'Property type'],
      ['Address', 'Address'],
      ['Housing Type', 'Housing type'],
      [PROPERTIES_LEASING_META_KEYS.leaseLengthInformation, 'Lease length information'],
      [PROPERTIES_LEASING_META_KEYS.fullHousePrice, 'Full house price'],
      [PROPERTIES_LEASING_META_KEYS.promotionalFullHousePrice, 'Promotional full house price'],
      ['Description', 'Description'],
      ['Amenities', 'Amenities'],
      ['Pets', 'Pets'],
      ['Notes', 'Submission notes'],
      ['Other Info', 'Other / additional info'],
    ],
  },
  {
    title: 'Approval & status',
    fields: [
      ['Approved', 'Approved'],
      ['Approval Status', 'Approval status'],
      ['Status', 'Status'],
      ['Axis Admin Listing Status', 'Admin listing status'],
      [PROPERTY_EDIT_REQUEST_FIELD, 'Edit request notes (manager)'],
    ],
  },
  {
    title: 'Fees',
    fields: [
      ['Utilities Fee', 'Utilities fee'],
      ['Security Deposit', 'Security deposit'],
      ['Application Fee', 'Application fee'],
    ],
  },
  {
    title: 'Counts',
    fields: [
      ['Room Count', 'Rooms'],
      ['Bathroom Count', 'Bathrooms'],
      ['Kitchen Count', 'Kitchens'],
      ['Number of Shared Spaces', 'Shared spaces'],
    ],
  },
  {
    title: 'Bathroom access summary',
    fields: [
      ['Bathroom Access', 'Bathroom access overview'],
    ],
  },
  {
    title: 'Laundry',
    fields: [
      ['Laundry', 'Laundry on site'],
      ['Laundry Type', 'Laundry type'],
      ['Laundry Description', 'Laundry description'],
      ['Rooms Sharing Laundry', 'Rooms sharing laundry'],
    ],
  },
  {
    title: 'Parking',
    fields: [
      ['Parking', 'Parking available'],
      ['Parking Type', 'Parking type'],
      ['Parking Fee', 'Parking fee'],
    ],
  },
  {
    title: 'Management',
    fields: [
      [PROPERTY_AIR.managerProfile, 'Manager profile'],
      ['Owner ID', 'Owner ID'],
      ['Manager Email', 'Manager email'],
      ['Site Manager Email', 'Site manager email'],
    ],
  },
  {
    title: 'Lease signing & move-in',
    fields: [
      [PROPERTY_AIR.leaseAccessRequirement, 'Lease access requirement'],
      [PROPERTY_AIR.requiredBeforeSigningSummary, 'Required before signing (summary)'],
      [PROPERTY_AIR.feesRequiredBeforeSigning, 'Fees required before signing'],
      [PROPERTY_AIR.moveInChargesJson, 'Move-in charge lines'],
    ],
  },
  {
    title: 'Partner / admin notes',
    fields: [
      ['Internal Notes', 'Internal notes'],
      ['Admin Notes', 'Admin notes'],
      ['Axis Partner Notes', 'Partner notes (visible)'],
      ['Partner Notes', 'Partner notes'],
    ],
  },
]

/**
 * @param {{ property: { id: string, name: string, address?: string, status: string, _airtable: object }, ownerLabel?: string }} props
 */
export function PropertyDetailPanel({ property, ownerLabel }) {
  const raw = property?._airtable || buildAdminPropertyDetailSyntheticAirtable(property)
  if (!raw) return null

  const fmt = formatApplicationDetailValue
  const shownKeys = new Set(['id', 'created_at'])
  const sections = []
  const parsedExtraSections = []

  // ── Core field groups ──────────────────────────────────────────────────────
  for (const group of PROPERTY_FIELD_GROUPS) {
    const items = []
    for (const [key, label] of group.fields) {
      shownKeys.add(key)
      let value = raw[key]
      if (key === 'Other Info' && typeof value === 'string') {
        value = parseAxisListingMetaBlock(value).userText
      }
      if (key === PROPERTY_AIR.moveInChargesJson) {
        const pretty = formatMoveInChargesJsonDisplay(value)
        const v = pretty || fmt(value)
        if (v) items.push({ label, value: v })
        continue
      }
      const v = fmt(value)
      if (v) items.push({ label, value: v })
    }
    if (items.length) sections.push({ title: group.title, items })
  }

  for (const key of Object.keys(raw)) {
    if (typeof raw[key] !== 'string') continue
    const parsedMeta = parseAxisListingMetaBlock(raw[key])
    if (!parsedMeta.meta) continue
    shownKeys.add(key)
    if (parsedMeta.userText) {
      const parsedLines = parseLabeledLinesBlock(parsedMeta.userText)
      if (parsedLines.length) {
        parsedExtraSections.push({ title: `${key} notes`, items: parsedLines })
      }
    }
    const propertyItems = metaPropertyListingItems(parsedMeta.meta)
    if (propertyItems.length) parsedExtraSections.push({ title: 'Listing details', items: propertyItems })
    const roomItems = metaRoomsToItems(parsedMeta.meta)
    if (roomItems.length) parsedExtraSections.push({ title: 'Listing rooms', items: roomItems })
    const financialItems = metaFinancialItems(parsedMeta.meta)
    if (financialItems.length) parsedExtraSections.push({ title: 'Listing financials', items: financialItems })
    const leasingItems = metaLeasingItems(parsedMeta.meta)
    if (leasingItems.length) parsedExtraSections.push({ title: 'Listing leasing', items: leasingItems })
    const sharedItems = metaSharedSpacesItems(parsedMeta.meta)
    if (sharedItems.length) parsedExtraSections.push({ title: 'Listing shared spaces', items: sharedItems })
    const mediaItems = metaMediaItems(parsedMeta.meta)
    if (mediaItems.length) parsedExtraSections.push({ title: 'Listing media', items: mediaItems })
  }

  // ── Dynamic room sections ──────────────────────────────────────────────────
  const roomCount = Number(raw['Room Count']) || 0
  const roomItems = []
  for (let n = 1; n <= Math.min(roomCount || MAX_ROOMS, MAX_ROOMS); n++) {
    const hasAny = roomFields(n).some(([key]) => raw[key] != null && raw[key] !== '' && raw[key] !== false)
    if (!hasAny) continue
    for (const [key, label] of roomFields(n)) {
      shownKeys.add(key)
      const v = fmt(raw[key])
      if (v) roomItems.push({ label, value: v })
    }
  }
  // Also mark all possible room keys as shown to avoid "Other fields" duplication
  for (let n = 1; n <= MAX_ROOMS; n++) {
    for (const [key] of roomFields(n)) shownKeys.add(key)
  }
  if (roomItems.length) sections.push({ title: 'Rooms', items: roomItems })

  // ── Dynamic bathroom sections ──────────────────────────────────────────────
  const bathroomCount = Number(raw['Bathroom Count']) || 0
  const bathroomItems = []
  for (let n = 1; n <= Math.min(bathroomCount || MAX_BATHROOMS, MAX_BATHROOMS); n++) {
    const hasAny = bathroomFields(n).some(([key]) => raw[key] != null && raw[key] !== '')
    if (!hasAny) continue
    for (const [key, label] of bathroomFields(n)) {
      shownKeys.add(key)
      const v = fmt(raw[key])
      if (v) bathroomItems.push({ label, value: v })
    }
  }
  for (let n = 1; n <= MAX_BATHROOMS; n++) {
    for (const [key] of bathroomFields(n)) shownKeys.add(key)
  }
  if (bathroomItems.length) sections.push({ title: 'Bathrooms', items: bathroomItems })

  // ── Dynamic kitchen sections ───────────────────────────────────────────────
  const kitchenCount = Number(raw['Kitchen Count']) || 0
  const kitchenItems = []
  for (let n = 1; n <= Math.min(kitchenCount || MAX_KITCHENS, MAX_KITCHENS); n++) {
    const hasAny = kitchenFields(n).some(([key]) => raw[key] != null && raw[key] !== '')
    if (!hasAny) continue
    for (const [key, label] of kitchenFields(n)) {
      shownKeys.add(key)
      const v = fmt(raw[key])
      if (v) kitchenItems.push({ label, value: v })
    }
  }
  for (let n = 1; n <= MAX_KITCHENS; n++) {
    for (const [key] of kitchenFields(n)) shownKeys.add(key)
  }
  if (kitchenItems.length) sections.push({ title: 'Kitchens', items: kitchenItems })

  // ── Dynamic laundry sections (Laundry 1 Type, Rooms Sharing Laundry 1, …) ─
  const laundryItems = []
  for (let n = 1; n <= MAX_LAUNDRY_SLOTS; n++) {
    const typeKey = laundryTypeField(n)
    const shareKey = laundryRoomsSharingField(n)
    const hasAny =
      (raw[typeKey] != null && raw[typeKey] !== '') || (raw[shareKey] != null && raw[shareKey] !== '')
    if (!hasAny) continue
    shownKeys.add(typeKey)
    shownKeys.add(shareKey)
    const typeV = fmt(raw[typeKey])
    const shareV = fmt(raw[shareKey])
    if (typeV) laundryItems.push({ label: `Laundry ${n} type`, value: typeV })
    if (shareV) laundryItems.push({ label: `Rooms sharing laundry ${n}`, value: shareV })
  }
  if (laundryItems.length) sections.push({ title: 'Laundry (by unit)', items: laundryItems })

  // ── Shared spaces ──────────────────────────────────────────────────────────
  shownKeys.add('Number of Shared Spaces')
  const spaceCount = Number(raw['Number of Shared Spaces']) || 0
  const sharedItems = []
  for (let n = 1; n <= Math.min(spaceCount || MAX_SHARED_SPACES, MAX_SHARED_SPACES); n++) {
    const hasAny = sharedSpaceFields(n).some(([key]) => {
      const v = raw[key]
      return v != null && v !== '' && !(Array.isArray(v) && v.length === 0)
    })
    if (!hasAny) continue
    for (const [key, label] of sharedSpaceFields(n)) {
      shownKeys.add(key)
      const v = fmt(raw[key])
      if (v) sharedItems.push({ label, value: v })
    }
  }
  for (let n = 1; n <= MAX_SHARED_SPACES; n++) {
    for (const [key] of sharedSpaceFields(n)) shownKeys.add(key)
  }
  if (sharedItems.length) sections.push({ title: 'Shared Spaces', items: sharedItems })

  // ── Remaining / unknown fields ─────────────────────────────────────────────
  const otherItems = []
  for (const key of Object.keys(raw).sort((a, b) => a.localeCompare(b))) {
    if (shownKeys.has(key)) continue
    const v = fmt(raw[key])
    if (v) otherItems.push({ label: humanizeMetaKey(key), value: v })
  }
  sections.push(...parsedExtraSections)
  if (otherItems.length) sections.push({ title: 'Other fields', items: otherItems })

  const submitted = raw.created_at
    ? (() => {
        try {
          return new Date(raw.created_at).toLocaleString()
        } catch {
          return String(raw.created_at)
        }
      })()
    : null

  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-6 space-y-5">
      <div className="min-w-0">
        <h3 className="text-base font-black text-slate-900">Full property record</h3>
        <p className="mt-1 text-sm text-slate-600">
          {property.name}
          {ownerLabel && ownerLabel !== '—' ? ` · ${ownerLabel}` : ''}
        </p>
        <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Status: {property.status}</p>
      </div>

      <dl className="space-y-0 border-t border-slate-200 pt-4">
        {property.address && property.address !== '—' ? (
          <div className="grid gap-1 border-b border-slate-200 py-2 sm:grid-cols-[minmax(0,200px)_1fr] sm:gap-4">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Address</dt>
            <dd className="text-sm text-slate-800">{property.address}</dd>
          </div>
        ) : null}
        {submitted ? (
          <div className="grid gap-1 border-b border-slate-200 py-2 sm:grid-cols-[minmax(0,200px)_1fr] sm:gap-4">
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Submitted</dt>
            <dd className="text-sm text-slate-800">{submitted}</dd>
          </div>
        ) : null}
      </dl>

      {sections.map((sec) => (
        <div key={sec.title}>
          <h4 className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">{sec.title}</h4>
          <dl className="rounded-2xl border border-slate-200 bg-white px-4">
            {sec.items.map((row) => (
              <div
                key={`${sec.title}-${row.label}`}
                className="grid gap-1 border-b border-slate-100 py-2.5 last:border-b-0 sm:grid-cols-[minmax(0,200px)_1fr] sm:gap-4"
              >
                <dt className="text-xs font-semibold text-slate-500">{row.label}</dt>
                <dd className="break-words text-sm leading-relaxed text-slate-900 whitespace-pre-wrap">{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  )
}
